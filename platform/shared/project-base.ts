import path from 'node:path';
import { ensureDir, pathExists, writeJson, writeText } from './fs.ts';
import { getWorkspacePaths } from './paths.ts';
import { buildRuntimePackageManifest, loadRuntimeDependencySpec } from './runtime-dependency-spec.ts';
import { writeYaml } from './yaml.ts';

export async function ensureProjectBase(workspaceRoot: string): Promise<void> {
  const {
    projectRoot,
    developerSourceRoot,
    sourceSlotsRoot,
    sourceOverridesRoot,
    sourcePoliciesRoot,
    sourceAcceptanceRoot,
    sourceAssetsRoot,
    sourcePrivateRegistryRoot,
    sourceViewsRoot,
    sourceEnvRoot,
    privateRegistryRoot,
    generatedDir,
    projectPackagePath,
    provenancePath,
    overrideManifestPath,
    policySpecPath
  } = getWorkspacePaths(workspaceRoot);
  await ensureDir(projectRoot);
  await ensureDir(path.join(projectRoot, 'app'));
  await ensureDir(path.join(projectRoot, 'app', 'api'));
  await ensureDir(path.join(projectRoot, 'components'));
  await ensureDir(path.join(projectRoot, 'lib'));
  await ensureDir(path.join(projectRoot, 'src', 'runtime'));
  await ensureDir(path.join(projectRoot, 'src', 'installed'));
  await ensureDir(path.join(projectRoot, 'tests', 'unit'));
  await ensureDir(path.join(projectRoot, 'tests', 'acceptance'));
  await ensureDir(path.join(projectRoot, 'tests', 'runtime', 'unit'));
  await ensureDir(path.join(projectRoot, 'tests', 'runtime', 'acceptance'));
  await ensureDir(path.join(projectRoot, 'custom'));
  await ensureDir(path.join(projectRoot, 'overrides'));
  await ensureDir(path.join(projectRoot, 'overrides', 'rules'));
  await ensureDir(path.join(projectRoot, 'overrides', 'patches'));
  await ensureDir(path.join(projectRoot, 'overrides', 'manifests'));
  await ensureDir(path.join(projectRoot, 'policies'));
  await ensureDir(developerSourceRoot);
  await ensureDir(sourceSlotsRoot);
  await ensureDir(sourceOverridesRoot);
  await ensureDir(path.join(sourceOverridesRoot, 'rules'));
  await ensureDir(path.join(sourceOverridesRoot, 'patches'));
  await ensureDir(path.join(sourceOverridesRoot, 'manifests'));
  await ensureDir(sourcePoliciesRoot);
  await ensureDir(sourceAcceptanceRoot);
  await ensureDir(sourceAssetsRoot);
  await ensureDir(sourcePrivateRegistryRoot);
  await ensureDir(sourceViewsRoot);
  await ensureDir(sourceEnvRoot);
  await ensureDir(generatedDir);
  await ensureDir(path.join(projectRoot, 'prisma'));
  await ensureDir(privateRegistryRoot);

  for (const sourceDir of [
    sourceSlotsRoot,
    sourcePoliciesRoot,
    sourceAcceptanceRoot,
    sourceAssetsRoot,
    sourcePrivateRegistryRoot,
    sourceViewsRoot,
    sourceEnvRoot
  ]) {
    await writeText(path.join(sourceDir, '.gitkeep'), '\n');
  }

  for (const overrideDir of ['rules', 'patches', 'manifests']) {
    await writeText(path.join(sourceOverridesRoot, overrideDir, '.gitkeep'), '\n');
  }

  for (const overrideDir of ['rules', 'patches', 'manifests']) {
    await writeText(path.join(projectRoot, 'overrides', overrideDir, '.gitkeep'), '\n');
  }

  const runtimeDependencySpec = await loadRuntimeDependencySpec();
  await writeJson(projectPackagePath, {
    ...buildRuntimePackageManifest('generated-customer-admin', runtimeDependencySpec),
    scripts: {
      dev: 'next dev',
      build: 'next build --webpack',
      'test:fast': 'node --test --experimental-test-isolation=none',
      'test:unit': 'vitest run --config vitest.config.ts',
      'test:acceptance': 'playwright test --config playwright.config.ts',
      'verify:runtime:service': 'npm run test:unit',
      'verify:runtime:full': 'npm run build && npm run test:unit && npm run test:acceptance',
      'verify:runtime': 'npm run verify:runtime:full',
      test: 'npm run test:fast && npm run test:unit'
    }
  });

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
      types: ['node'],
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
      'vitest.config.ts',
      'playwright.config.ts'
    ],
    exclude: ['node_modules']
  });

  await writeText(path.join(projectRoot, 'next.config.mjs'), `const nextConfig = {};

export default nextConfig;
`);
  await writeText(
    path.join(projectRoot, 'next-env.d.ts'),
    `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file is managed by the compiler runtime scaffold.
`
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
`);
  await writeText(
    path.join(projectRoot, 'vitest.config.ts'),
    `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/runtime/unit/**/*.test.ts'],
    environment: 'node'
  }
});
`
  );
  await writeText(
    path.join(projectRoot, 'playwright.config.ts'),
    `import { defineConfig } from '@playwright/test';

const port = parseInt(process.env.TEST_PORT ?? '3001', 10);
const baseURL = \`http://127.0.0.1:\${port}\`;

export default defineConfig({
  testDir: './tests/runtime/acceptance',
  reporter: 'line',
  workers: 1,
  use: {
    baseURL,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: \`next dev --hostname 127.0.0.1 --port \${port}\`,
    url: \`\${baseURL}/login\`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
});
`
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
`
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
`
    );
  }

  if (!(await pathExists(policySpecPath))) {
    await writeYaml(policySpecPath, {
      policies: []
    });
  }

  if (!(await pathExists(provenancePath))) {
    await writeJson(provenancePath, {
      formatVersion: '1',
      artifacts: []
    });
  }

  if (!(await pathExists(overrideManifestPath))) {
    await writeYaml(overrideManifestPath, {
      overrides: []
    });
  }
}
