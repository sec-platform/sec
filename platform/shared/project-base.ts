import path from 'node:path';
import { ensureDir, pathExists, writeJson, writeText, type CommitFence } from './fs.ts';
import { getWorkspacePaths } from './paths.ts';
import { emptyOverrideManifest } from './provenance-types.ts';
import { buildRuntimePackageManifest, loadRuntimeDependencySpec } from './runtime-dependency-spec.ts';
import { writeYaml } from './yaml.ts';

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
    sourceViewsRoot,
    sourceViewMutationsRoot,
    sourceEnvRoot,
    privateRegistryRoot,
    controlRoot,
    controlStateRoot,
    controlEvidenceRoot,
    controlProvenanceRoot,
    controlGraphRoot,
    controlWorkflowRoot,
    controlWorkbenchRoot,
    controlAuditRoot,
    controlCiRoot,
    localStateRoot,
    generatedDir,
    generatedViewsDir,
    projectPackagePath,
    provenancePath,
    overrideManifestPath,
    legacyOverrideManifestPath,
    policySpecPath
  } = getWorkspacePaths(workspaceRoot);
  const projectOverrideDirs = childDirectories(path.join(projectRoot, 'overrides'), ['rules', 'patches', 'manifests']);
  const sourceOverrideDirs = childDirectories(sourceOverridesRoot, ['rules', 'patches', 'manifests']);
  const sourceCodeDirs = childDirectories(sourceCodeRoot, ['app', 'server', 'ui', 'shared', 'integrations', 'opaque', 'lab']);
  const sourceModelDirs = childDirectories(sourceModelRoot, ['capabilities', 'entities', 'flows', 'permissions']);
  const sourceAssetDirs = childDirectories(sourceAssetsRoot, ['copy', 'design', 'fixtures', 'seeds']);
  const sourceViewDirs = childDirectories(sourceViewsRoot, ['workspace', 'graphs', 'screens', 'forms', 'tables', 'dashboards', 'editors']);
  const sourceEnvDirs = childDirectories(sourceEnvRoot, ['templates', 'bindings']);
  const localStateDirs = childDirectories(localStateRoot, ['cache', 'tmp', 'indexes', 'test-workspaces', 'generated-preview', 'ai-sessions']);

  const projectDirs = [
    projectRoot,
    ...childDirectories(projectRoot, [
      'app',
      path.join('app', 'api'),
      'components',
      'lib',
      path.join('src', 'runtime'),
      path.join('src', 'installed'),
      path.join('tests', 'unit'),
      path.join('tests', 'acceptance'),
      path.join('tests', 'runtime', 'unit'),
      path.join('tests', 'runtime', 'acceptance'),
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
    sourceViewsRoot,
    ...sourceViewDirs,
    sourceViewMutationsRoot,
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
    controlWorkbenchRoot,
    generatedViewsDir,
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
    sourceViewsRoot,
    ...sourceViewDirs,
    sourceViewMutationsRoot,
    sourceEnvRoot,
    ...sourceEnvDirs,
    controlStateRoot,
    controlEvidenceRoot,
    controlProvenanceRoot,
    controlGraphRoot,
    controlWorkflowRoot,
    generatedViewsDir,
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
      dev: 'next dev --webpack',
      build: 'next build --webpack',
      'test:fast': 'node --test --experimental-test-isolation=none',
      'test:unit': 'bun test tests/runtime/unit',
      'test:acceptance': 'playwright test --config playwright.config.ts',
      'verify:runtime:service': 'bun run test:unit',
      'verify:runtime:full': 'bun run build && bun run test:unit && bun run test:acceptance',
      'verify:runtime': 'bun run verify:runtime:full',
      test: 'bun run test:fast && bun run test:unit'
    }
  }, commitFence);

  await writeJson(path.join(projectRoot, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      allowJs: true,
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
      strict: true,
      noEmit: true,
      jsx: 'react-jsx',
      esModuleInterop: true,
      resolveJsonModule: true,
      incremental: true,
      types: ['node', 'bun'],
      lib: ['DOM', 'DOM.Iterable', 'ES2022'],
      skipLibCheck: true,
      plugins: [{ name: 'next' }]
    },
    include: [
      'next-env.d.ts',
      '.next/types/**/*.ts',
      '.next/dev/types/**/*.ts',
      'app/**/*.ts',
      'app/**/*.tsx',
      'components/**/*.ts',
      'components/**/*.tsx',
      'lib/**/*.ts',
      'src/**/*.ts',
      'tests/**/*.ts',
      'tests/**/*.tsx',
      'custom/**/*.ts',
      'bunfig.toml',
      'playwright.config.ts'
    ],
    exclude: ['node_modules']
  }, commitFence);

  await writeText(path.join(projectRoot, 'next.config.mjs'), `const nextConfig = {};

export default nextConfig;
`, commitFence);
  await writeText(
    path.join(projectRoot, 'next-env.d.ts'),
    `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file is managed by the compiler runtime scaffold.
`,
    commitFence
  );
  await writeText(path.join(projectRoot, 'app', 'globals.css'), `:root {
  color-scheme: light;
  font-family: 'Segoe UI', sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f4f4ef;
  color: #17211f;
}

a {
  color: inherit;
  text-decoration: none;
}

main {
  max-width: 960px;
  margin: 0 auto;
  padding: 32px 20px 80px;
}

.card {
  background: #ffffff;
  border: 1px solid #d3d9d0;
  border-radius: 18px;
  padding: 20px;
  box-shadow: 0 10px 24px rgba(23, 33, 31, 0.06);
}

.stack {
  display: grid;
  gap: 16px;
}

.row {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

label {
  display: grid;
  gap: 6px;
  font-size: 14px;
}

input,
button,
textarea,
select {
  font: inherit;
}

input,
textarea,
select {
  width: 100%;
  border: 1px solid #b7c3b8;
  border-radius: 12px;
  padding: 10px 12px;
  background: #ffffff;
}

button {
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  background: #1d6f5f;
  color: white;
  cursor: pointer;
}

button.secondary {
  background: #dfe8e3;
  color: #17211f;
}

ul.clean {
  list-style: none;
  padding: 0;
  margin: 0;
}

ul.clean li {
  padding: 12px 0;
  border-bottom: 1px solid #e3e8e1;
}

nav a {
  padding: 8px 12px;
  border-radius: 999px;
  background: #edf4ef;
}

pre.json {
  overflow: auto;
  padding: 16px;
  border-radius: 16px;
  background: #0f1d19;
  color: #e6fff8;
}
`, commitFence);
  await writeText(
    path.join(projectRoot, 'bunfig.toml'),
    `[test]
`,
    commitFence
  );
  await writeText(
    path.join(projectRoot, 'playwright.config.ts'),
    `import { defineConfig } from '@playwright/test';

const port = parseInt(process.env.TEST_PORT ?? '3001', 10);
const baseURL = \`http://127.0.0.1:\${port}\`;
const isolatedBunConfig = process.env.SEC_ISOLATED_VERIFICATION === '1'
  ? ['--config=../.isolated-process/runtime/bunfig.toml']
  : [];
const webServerCommand = [
  'bun',
  '--no-env-file',
  ...isolatedBunConfig,
  '--no-install',
  'node_modules/next/dist/bin/next',
  'start',
  '--hostname',
  '127.0.0.1',
  '--port',
  String(port)
].join(' ');

export default defineConfig({
  testDir: './tests/runtime/acceptance',
  reporter: 'line',
  workers: 1,
  use: {
    baseURL,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: webServerCommand,
    cwd: '.',
    url: \`\${baseURL}/login\`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
});
`,
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

  if (!(await pathExists(legacyOverrideManifestPath))) {
    await writeYaml(legacyOverrideManifestPath, emptyOverrideManifest(), commitFence);
  }
}
