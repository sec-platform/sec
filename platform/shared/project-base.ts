import path from 'node:path';
import { ensureDir, writeJson, writeText } from './fs.ts';
import { getWorkspacePaths } from './paths.ts';

export async function ensureProjectBase(workspaceRoot: string): Promise<void> {
  const { projectRoot, generatedDir, projectPackagePath } = getWorkspacePaths(workspaceRoot);
  await ensureDir(projectRoot);
  await ensureDir(path.join(projectRoot, 'src', 'runtime'));
  await ensureDir(path.join(projectRoot, 'src', 'installed'));
  await ensureDir(path.join(projectRoot, 'tests', 'unit'));
  await ensureDir(path.join(projectRoot, 'tests', 'acceptance'));
  await ensureDir(path.join(projectRoot, 'custom'));
  await ensureDir(generatedDir);
  await ensureDir(path.join(projectRoot, 'prisma'));

  await writeJson(projectPackagePath, {
    name: 'generated-customer-admin',
    private: true,
    type: 'module',
    scripts: {
      test: 'node --test --experimental-test-isolation=none'
    }
  });

  await writeJson(path.join(projectRoot, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
      strict: true,
      noEmit: true,
      types: ['node'],
      lib: ['ES2022'],
      skipLibCheck: true
    },
    include: ['src/**/*.ts', 'tests/**/*.ts', 'custom/**/*.ts']
  });

  await writeText(
    path.join(projectRoot, 'src', 'runtime', 'database.ts'),
    `export interface CustomerInput {\n  name?: string;\n  email?: string;\n  phone?: string;\n  company?: string;\n}\n\nexport interface NormalizedCustomerInput {\n  name: string;\n  email: string;\n  phone: string;\n  company: string;\n}\n\nexport interface CustomerRecord extends NormalizedCustomerInput {\n  id: number;\n  tenantId: string;\n}\n\nexport interface Database {\n  nextCustomerId: number;\n  customers: CustomerRecord[];\n}\n\nexport function createDatabase(): Database {\n  return {\n    nextCustomerId: 1,\n    customers: []\n  };\n}\n`
  );

  await writeText(
    path.join(projectRoot, 'prisma', 'schema.prisma'),
    `generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "sqlite"\n  url      = "file:./dev.db"\n}\n`
  );
}
