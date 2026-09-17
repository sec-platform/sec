import path from 'node:path';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { isCanonicalPortableLogicalPath, portableLogicalPathCollisionKey } from '../../../contracts/logical-path.ts';
import { uniqueSorted } from '../../../contracts/canonical.ts';
import { createTaskGroupEffectFence, mapTaskGroup } from '../../../execution/task-group.ts';
import { throwIfNativeAborted } from '../../../contracts/native-abort.ts';
import { publishExclusiveCanonicalWorkspaceFile, publishExpectedCanonicalWorkspaceFile } from "../../filesystem/file-publication.ts";
import { type CommitFence } from "../../../contracts/commit-fence.ts";
import { packageJsonRelativePath, srcRelativePath, testsRelativePath, tsconfigRelativePath } from "../../workspace-context.ts";
import { resolvePathInside } from "../../../contracts/relative-path.ts";
import type { LockFile } from '../../../compiler/contract.ts';
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

export async function generateRuntimeLibraryScaffold(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence,
  signal?: AbortSignal
): Promise<string[]> {
  workspaceRoot = path.resolve(workspaceRoot);
  if (commitFence !== undefined && typeof commitFence !== 'function') throw new TypeError('Scaffold commit fence must be callable');
  throwIfNativeAborted(signal);
  const features = Object.freeze(buildRuntimeLibraryFeatures(lock));
  const entries = runtimeLibraryScaffoldDefinitions
    .filter((definition) => definition.enabled?.(features) ?? true)
    .map((definition) => ({
      relativePath: definition.relativePath,
      source: definition.render(features)
    }));

  const targets = entries.map(entry => {
    const targetPath = resolvePathInside(workspaceRoot, entry.relativePath);
    if (!targetPath) throw new Error(`Runtime library scaffold path escapes native workspace root: ${entry.relativePath}`);
    return Object.freeze({ ...entry, targetPath });
  });
  await mapTaskGroup(targets, async (entry, _index, groupSignal) => {
    throwIfNativeAborted(groupSignal);
    const current = readOptionalRetainedOrdinaryFile(entry.targetPath, `Runtime library target ${entry.relativePath}`);
    if (current !== null && decodeExactUtf8(current, `Runtime library target ${entry.relativePath}`) === entry.source) return;
    const input = { workspaceRoot, targetPath: entry.targetPath, bytes: Buffer.from(entry.source, 'utf8'),
      label: `Runtime library output ${entry.relativePath}`, commitFence: createTaskGroupEffectFence(groupSignal, commitFence) };
    if (current === null) await publishExclusiveCanonicalWorkspaceFile(input);
    else await publishExpectedCanonicalWorkspaceFile({ ...input, expectedBytes: current });
  }, { signal });

  return uniqueSorted([...BASE_RUNTIME_SCAFFOLD_PATHS, ...entries.map((entry) => entry.relativePath)]);
}
