import path from 'node:path';
import { ensureDir, pathExists, writeJson, writeText, type CommitFence } from '../runtime/files.ts';
import { getWorkspacePaths } from '../runtime/paths.ts';
import { emptyOverrideManifest } from '../../semantic/provenance/index.ts';
import { buildRuntimePackageManifest, loadRuntimeDependencySpec } from '../../toolchain/dependencies/spec.ts';
import { writeYaml } from '../../shared/yaml.ts';

function childDirectories(root: string, relativePaths: readonly string[]): string[] {
  return relativePaths.map((relativePath) => path.join(root, relativePath));
}

export async function ensureProjectBase(
  workspaceRoot: string,
  commitFence?: CommitFence
): Promise<void> {
  const {
    projectRoot,
    developerSourceRoot,
    sourceCodeRoot,
    sourceModelRoot,
    sourceBlocksRoot,
    sourcePatchesRoot,
    sourceSlotsRoot,
    sourceOverridesRoot,
    sourcePoliciesRoot,
    sourceAcceptanceRoot,
    sourceAssetsRoot,
    sourcePrivateRegistryRoot,
    sourceEnvRoot,
    privateRegistryRoot,
    controlRoot,
    controlStateRoot,
    controlEvidenceRoot,
    controlProvenanceRoot,
    controlGraphRoot,
    controlWorkflowRoot,
    controlAuditRoot,
    controlCiRoot,
    localStateRoot,
    generatedDir,
    projectPackagePath,
    provenancePath,
    overrideManifestPath,
    policySpecPath
  } = getWorkspacePaths(workspaceRoot);
  const projectOverrideDirs = childDirectories(path.join(projectRoot, 'overrides'), ['rules', 'patches', 'manifests']);
  const sourceOverrideDirs = childDirectories(sourceOverridesRoot, ['rules', 'patches', 'manifests']);
  const sourceCodeDirs = childDirectories(sourceCodeRoot, ['server', 'shared', 'integrations', 'opaque', 'lab']);
  const sourceModelDirs = childDirectories(sourceModelRoot, ['capabilities', 'entities', 'flows', 'permissions']);
  const sourceAssetDirs = childDirectories(sourceAssetsRoot, ['copy', 'design', 'fixtures', 'seeds']);
  const sourceEnvDirs = childDirectories(sourceEnvRoot, ['templates', 'bindings']);
  const localStateDirs = childDirectories(localStateRoot, ['cache', 'tmp', 'indexes', 'test-workspaces', 'generated-preview', 'ai-sessions']);

  const projectDirs = [
    projectRoot,
    ...childDirectories(projectRoot, [
      'lib',
      path.join('src', 'runtime'),
      path.join('src', 'installed'),
      path.join('tests', 'unit'),
      path.join('tests', 'runtime', 'unit'),
      'custom',
      'overrides',
      'policies',
      'prisma'
    ]),
    ...projectOverrideDirs
  ];
  const sourceLayerDirs = [
    developerSourceRoot,
    sourceCodeRoot,
    sourceModelRoot,
    sourceBlocksRoot,
    sourcePatchesRoot,
    sourceSlotsRoot,
    ...sourceCodeDirs,
    sourceOverridesRoot,
    ...sourceOverrideDirs,
    sourcePoliciesRoot,
    sourceAcceptanceRoot,
    ...sourceModelDirs,
    sourceAssetsRoot,
    ...sourceAssetDirs,
    sourcePrivateRegistryRoot,
    sourceEnvRoot,
    ...sourceEnvDirs
  ];
  const controlDirs = [
    controlRoot,
    controlStateRoot,
    controlEvidenceRoot,
    controlProvenanceRoot,
    controlGraphRoot,
    controlWorkflowRoot,
    controlAuditRoot,
    controlCiRoot
  ];

  for (const directory of [
    ...projectDirs,
    ...sourceLayerDirs,
    ...controlDirs,
    localStateRoot,
    ...localStateDirs,
    generatedDir,
    privateRegistryRoot
  ]) {
    await ensureDir(directory, commitFence);
  }

  for (const directory of [
    sourceSlotsRoot,
    ...sourceCodeDirs,
    ...sourceOverrideDirs,
    sourcePoliciesRoot,
    sourceAcceptanceRoot,
    ...sourceModelDirs,
    sourceAssetsRoot,
    ...sourceAssetDirs,
    sourcePrivateRegistryRoot,
    sourceEnvRoot,
    ...sourceEnvDirs,
    controlStateRoot,
    controlEvidenceRoot,
    controlProvenanceRoot,
    controlGraphRoot,
    controlWorkflowRoot,
    controlAuditRoot,
    controlCiRoot,
    ...projectOverrideDirs
  ]) {
    await writeText(path.join(directory, '.gitkeep'), '\n', commitFence);
  }

  const runtimeDependencySpec = await loadRuntimeDependencySpec();
  await writeJson(projectPackagePath, {
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

  await writeJson(path.join(projectRoot, 'tsconfig.json'), {
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
      'lib/**/*.ts',
      'src/**/*.ts',
      'tests/**/*.ts',
      'custom/**/*.ts',
      'bunfig.toml'
    ],
    exclude: ['node_modules']
  }, commitFence);

  await writeText(
    path.join(projectRoot, 'bunfig.toml'),
    `[test]\n`,
    commitFence
  );
  await writeText(
    path.join(projectRoot, 'src', 'runtime', 'database.ts'),
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

  const prismaSchemaPath = path.join(projectRoot, 'prisma', 'schema.prisma');
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
      formatVersion: '1',
      artifacts: []
    }, commitFence);
  }

  if (!(await pathExists(overrideManifestPath))) {
    await writeYaml(overrideManifestPath, emptyOverrideManifest(), commitFence);
  }

}
