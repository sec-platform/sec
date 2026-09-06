import path from 'node:path';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { isCanonicalPortableLogicalPath, portableLogicalPathCollisionKey } from '../../system-architecture/foundation/contract/logical-path.ts';
import { uniqueSorted } from '../../system-architecture/foundation/runtime/canonical.ts';
import { runTaskGroup } from '../../system-architecture/foundation/runtime/concurrency.ts';
import { throwIfNativeAborted } from '../../system-architecture/foundation/runtime/native-abort.ts';
import { publishExclusiveCanonicalWorkspaceFile, publishExpectedCanonicalWorkspaceFile, type CommitFence } from '../../workspace/files.ts';
import {
  packageJsonRelativePath,
  resolvePathInside,
  srcRelativePath,
  testsRelativePath,
  tsconfigRelativePath
} from '../../workspace/runtime/paths.ts';
import type { LockFile } from '../contract.ts';
import { TemplateEngine } from './template-engine.ts';

const BASE_RUNTIME_SCAFFOLD_PATHS = [
  packageJsonRelativePath,
  tsconfigRelativePath,
  `${srcRelativePath}/runtime/database.ts`,
  `${srcRelativePath}/runtime/store.ts`
] as const;

type RuntimeLibraryFeatures = {
  auditEnabled: boolean;
  customerEnabled: boolean;
  exportCsvEnabled: boolean;
  fileUploadEnabled: boolean;
  notifyEmailEnabled: boolean;
  postgresEnabled: boolean;
  rbacEnabled: boolean;
  tableFilterEnabled: boolean;
  ticketEnabled: boolean;
  ticketReportingEnabled: boolean;
  worklogEnabled: boolean;
};

type RuntimeLibraryScaffoldDefinition = {
  relativePath: string;
  enabled?: (features: RuntimeLibraryFeatures) => boolean;
  render: (features: RuntimeLibraryFeatures) => string;
};

function renderStoreLibrary(features: RuntimeLibraryFeatures): string {
  return TemplateEngine.render('lib/store.ts.template', {
    persistence: features.postgresEnabled ? 'postgres-contract' : 'memory'
  });
}

function renderCustomerRuntimeUnitTest(features: RuntimeLibraryFeatures): string {
  const postgresTables = [
    'customers',
    'customer_attachments',
    'email_notifications',
    'audit_entries',
    ...(features.ticketEnabled ? ['tickets', 'ticket_attachments', 'ticket_comments'] : []),
    ...(features.ticketEnabled && features.worklogEnabled ? ['worklogs'] : [])
  ];
  return TemplateEngine.render('tests/runtime/unit/customer-runtime.test.ts.template', {
    ...features,
    postgresTableList: postgresTables.map((table) => `      '${table}'`).join(',\n')
  });
}

function renderTicketRuntimeUnitTest(features: RuntimeLibraryFeatures): string {
  return TemplateEngine.render('tests/runtime/unit/ticket-runtime.test.ts.template', features);
}

function defineRuntimeLibraryScaffold(
  relativePath: string,
  render: (features: RuntimeLibraryFeatures) => string,
  enabled?: (features: RuntimeLibraryFeatures) => boolean
): RuntimeLibraryScaffoldDefinition {
  if (!isCanonicalPortableLogicalPath(relativePath)) {
    throw new Error(`Runtime library scaffold path is not canonical: ${relativePath}`);
  }
  return { relativePath, render, ...(enabled ? { enabled } : {}) };
}

const runtimeLibraryScaffoldDefinitions: RuntimeLibraryScaffoldDefinition[] = [
  defineRuntimeLibraryScaffold(`${srcRelativePath}/runtime/store.ts`, renderStoreLibrary),
  defineRuntimeLibraryScaffold(
    `${testsRelativePath}/runtime/unit/customer-runtime.test.ts`,
    renderCustomerRuntimeUnitTest,
    (features) => features.customerEnabled
  ),
  defineRuntimeLibraryScaffold(
    `${testsRelativePath}/runtime/unit/ticket-runtime.test.ts`,
    renderTicketRuntimeUnitTest,
    (features) => features.ticketEnabled
  )
];

const scaffoldDefinitionPaths = runtimeLibraryScaffoldDefinitions.map(
  (definition) => definition.relativePath
);
if (new Set(scaffoldDefinitionPaths.map((value) => portableLogicalPathCollisionKey(
  value,
  'Runtime library scaffold path'
))).size !== scaffoldDefinitionPaths.length) {
  throw new Error('Runtime library scaffold definitions contain duplicate output paths');
}

function buildRuntimeLibraryFeatures(lock: LockFile): RuntimeLibraryFeatures {
  const blockIds = new Set(lock.resolvedBlocks.map((block) => block.id));
  const has = (blockId: string): boolean => blockIds.has(blockId);
  return {
    auditEnabled: has('audit/basic'),
    customerEnabled: has('entity/customer-basic'),
    exportCsvEnabled: has('export/csv-basic'),
    fileUploadEnabled: has('file/upload'),
    notifyEmailEnabled: has('notify/email-basic'),
    postgresEnabled: has('infra/postgres'),
    rbacEnabled: has('rbac/basic'),
    tableFilterEnabled: has('table/filter-search'),
    ticketEnabled: has('ticket/basic'),
    ticketReportingEnabled: has('reporting/ticket-summary'),
    worklogEnabled: has('worklog/basic')
  };
}

function readOptionalScaffoldSource(targetPath: string, relativePath: string) {
  const bytes = readOptionalRetainedOrdinaryFile(
    targetPath,
    `Runtime library target ${relativePath}`
  );
  return bytes === null ? null : { bytes, text: decodeExactUtf8(bytes, `Runtime library target ${relativePath}`) };
}

export async function generateRuntimeLibraryScaffold(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence,
  signal?: AbortSignal
): Promise<string[]> {
  workspaceRoot = path.resolve(workspaceRoot);
  throwIfNativeAborted(signal);
  if (commitFence !== undefined && typeof commitFence !== 'function') throw new TypeError('Scaffold commit fence must be callable');
  const features = Object.freeze(buildRuntimeLibraryFeatures(lock));
  const entries = runtimeLibraryScaffoldDefinitions
    .filter((definition) => definition.enabled?.(features) ?? true)
    .map((definition) => ({
      relativePath: definition.relativePath,
      source: definition.render(features)
    })).map(entry => {
      const targetPath = resolvePathInside(workspaceRoot, entry.relativePath);
      if (!targetPath) throw new Error(`Runtime library scaffold path escapes native workspace root: ${entry.relativePath}`);
      return { ...entry, targetPath };
    });

  await runTaskGroup(entries.map(entry => async (childSignal: AbortSignal) => {
    const current = readOptionalScaffoldSource(entry.targetPath, entry.relativePath);
    if (current?.text === entry.source) return;
    const publication = {
      workspaceRoot, targetPath: entry.targetPath, bytes: Buffer.from(entry.source, 'utf8'),
      label: `Runtime library output ${entry.relativePath}`,
      commitFence: async () => {
        throwIfNativeAborted(childSignal);
        await commitFence?.();
        throwIfNativeAborted(childSignal);
      }
    };
    if (current === null) await publishExclusiveCanonicalWorkspaceFile(publication);
    else await publishExpectedCanonicalWorkspaceFile({ ...publication, expectedBytes: current.bytes });
  }), { signal });

  return uniqueSorted([...BASE_RUNTIME_SCAFFOLD_PATHS, ...entries.map((entry) => entry.relativePath)]);
}
