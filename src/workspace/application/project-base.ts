import path from 'node:path';
import { emptyOverrideManifest, PROVENANCE_FORMAT_VERSION } from '../../semantic/provenance/contract/types.ts';
import { buildRuntimePackageManifest, loadRuntimeDependencySpec } from '../../toolchain/dependencies/spec.ts';
import {
  CI_ARTIFACT_FILES,
  fixedCiArtifactPaths,
  uniqueSortedCiArtifactPaths
} from '../../verification/ci-artifacts/contract/manifest.ts';
import { ensureDir, pathExists, writeJson, writeText, type CommitFence } from '../runtime/files.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../runtime/paths.ts';
import { writeYaml } from '../yaml.ts';

function childDirectories(root: string, relativePaths: readonly string[]): string[] {
  return relativePaths.map((relativePath) => path.join(root, relativePath));
}

function artifactParentDirectories(root: string): string[] {
  const relativeParents = uniqueSortedCiArtifactPaths(
    fixedCiArtifactPaths().map((artifactPath) => path.posix.dirname(artifactPath))
  );
  return childDirectories(root, relativeParents);
}

export async function ensureProjectBase(
  workspaceRoot: string,
  commitFence?: CommitFence
): Promise<void> {
  const {
    workspaceRoot: root,
    modelRoot,
    modelBlocksRoot,
    privateRegistryRoot,
    policiesRoot,
    overridesRoot,
    srcRoot,
    slotsRoot,
    testsRoot,
    packageJsonPath,
    tsconfigPath,
    prismaRoot,
    secRoot,
    artifactsRoot,
    cacheRoot,
    workspaceWriteLeaseRoot
  } = getWorkspacePaths(workspaceRoot);
  const runtimeRoot = path.join(srcRoot, 'runtime');
  const installedRoot = path.join(srcRoot, 'installed');
  const testUnitRoot = path.join(testsRoot, 'unit');
  const runtimeTestUnitRoot = path.join(testsRoot, 'runtime', 'unit');
  const overrideDirs = childDirectories(overridesRoot, ['rules', 'patches', 'manifests']);
  const provenancePath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance);
  const artifactParents = artifactParentDirectories(root);
  const policySpecPath = path.join(policiesRoot, 'policy.spec.yaml');
  const overrideManifestPath = path.join(overridesRoot, 'override-manifest.yaml');

  for (const directory of [
    root,
    modelRoot,
    modelBlocksRoot,
    privateRegistryRoot,
    policiesRoot,
    overridesRoot,
    ...overrideDirs,
    srcRoot,
    runtimeRoot,
    installedRoot,
    slotsRoot,
    testsRoot,
    testUnitRoot,
    runtimeTestUnitRoot,
    prismaRoot,
    secRoot,
    artifactsRoot,
    ...artifactParents,
    cacheRoot,
    workspaceWriteLeaseRoot
  ]) {
    await ensureDir(directory, commitFence);
  }

  for (const directory of [
    modelBlocksRoot,
    privateRegistryRoot,
    ...overrideDirs,
    installedRoot,
    slotsRoot,
    testUnitRoot,
    runtimeTestUnitRoot
  ]) {
    await writeText(path.join(directory, '.gitkeep'), '\n', commitFence);
  }

  const runtimeDependencySpec = await loadRuntimeDependencySpec();
  await writeJson(packageJsonPath, {
    ...buildRuntimePackageManifest('generated-customer-admin', runtimeDependencySpec),
    scripts: {
      'test:fast': 'node --test --experimental-test-isolation=none',
      'test:unit': 'bun test tests/runtime/unit',
      'verify:runtime:service': 'bun run test:unit',
      'verify:runtime:full': 'bun run test:unit',
      'verify:runtime': 'bun run verify:runtime:full',
      test: 'bun run test:fast && bun run test:unit'
    }
  }, commitFence);

  await writeJson(tsconfigPath, {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      incremental: true,
      types: ['node', 'bun'],
      lib: ['ES2022'],
      skipLibCheck: true,
      plugins: []
    },
    include: [
      'src/**/*.ts',
      'tests/**/*.ts',
      'bunfig.toml'
    ],
    exclude: ['node_modules']
  }, commitFence);

  await writeText(
    path.join(root, 'bunfig.toml'),
    `[test]\n`,
    commitFence
  );
  await writeText(
    path.join(runtimeRoot, 'database.ts'),
    `export interface CustomerInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
}

export interface NormalizedCustomerInput {
  name: string;
  email: string;
  phone: string;
  company: string;
}

export interface CustomerRecord extends NormalizedCustomerInput {
  id: number;
  tenantId: string;
}

export interface CustomerAttachmentInput {
  customerId: number;
  fileName: string;
  contentType: string;
  size: number;
  contentText: string;
}

export interface CustomerAttachmentRecord extends CustomerAttachmentInput {
  id: number;
  tenantId: string;
  createdAt: string;
}

export interface EmailNotificationRecord {
  id: number;
  tenantId: string;
  entity: string;
  entityId: string;
  eventType: string;
  recipient: string;
  subject: string;
  body: string;
  createdAt: string;
}

export interface AuditEntryRecord {
  actorId: string;
  tenantId: string;
  action: string;
  entity: string;
  entityId: string;
  occurredAt: string;
}

export type TicketStatus = 'open' | 'in_progress' | 'closed';

export interface TicketInput {
  title: string;
  description?: string;
  status?: TicketStatus;
  assigneeId?: string;
  dueDate?: string;
}

export interface TicketRecord {
  id: number;
  tenantId: string;
  title: string;
  description: string;
  status: TicketStatus;
  assigneeId: string;
  dueDate: string;
  createdBy: string;
  updatedAt: string;
}

export interface TicketAttachmentInput {
  ticketId: number;
  fileName: string;
  contentType: string;
  size: number;
  contentText: string;
}

export interface TicketAttachmentRecord extends TicketAttachmentInput {
  id: number;
  tenantId: string;
  createdAt: string;
}

export interface TicketCommentInput {
  ticketId: number;
  body: string;
}

export interface TicketCommentRecord extends TicketCommentInput {
  id: number;
  tenantId: string;
  authorId: string;
  createdAt: string;
}

export interface WorklogInput {
  ticketId: number;
  minutes: number;
  note?: string;
}

export interface WorklogRecord extends WorklogInput {
  id: number;
  tenantId: string;
  note: string;
  authorId: string;
  createdAt: string;
}

export interface Database {
  nextCustomerId: number;
  customers: CustomerRecord[];
  nextCustomerAttachmentId: number;
  customerAttachments: CustomerAttachmentRecord[];
  nextEmailNotificationId: number;
  emailNotifications: EmailNotificationRecord[];
  auditEntries: AuditEntryRecord[];
  nextTicketId: number;
  tickets: TicketRecord[];
  nextTicketAttachmentId: number;
  ticketAttachments: TicketAttachmentRecord[];
  nextTicketCommentId: number;
  ticketComments: TicketCommentRecord[];
  nextWorklogId: number;
  worklogs: WorklogRecord[];
}

export type RuntimePersistence = 'memory' | 'postgres-contract';

export interface RuntimeStore {
  persistence: RuntimePersistence;
  database: Database;
}

export function createDatabase(): Database {
  return {
    nextCustomerId: 1,
    customers: [],
    nextCustomerAttachmentId: 1,
    customerAttachments: [],
    nextEmailNotificationId: 1,
    emailNotifications: [],
    auditEntries: [],
    nextTicketId: 1,
    tickets: [],
    nextTicketAttachmentId: 1,
    ticketAttachments: [],
    nextTicketCommentId: 1,
    ticketComments: [],
    nextWorklogId: 1,
    worklogs: []
  };
}

export function createRuntimeStore(persistence: RuntimePersistence = 'memory'): RuntimeStore {
  return {
    persistence,
    database: createDatabase()
  };
}

export function getRuntimeDatabase(store: RuntimeStore): Database {
  return store.database;
}
`,
    commitFence
  );

  const prismaSchemaPath = path.join(prismaRoot, 'schema.prisma');
  if (!(await pathExists(prismaSchemaPath))) {
    await writeText(
      prismaSchemaPath,
      `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
`,
      commitFence
    );
  }

  if (!(await pathExists(policySpecPath))) {
    await writeYaml(policySpecPath, {
      policies: []
    }, commitFence);
  }

  if (!(await pathExists(provenancePath))) {
    await writeJson(provenancePath, {
      formatVersion: PROVENANCE_FORMAT_VERSION,
      artifacts: []
    }, commitFence);
  }

  if (!(await pathExists(overrideManifestPath))) {
    await writeYaml(overrideManifestPath, emptyOverrideManifest(), commitFence);
  }

}
