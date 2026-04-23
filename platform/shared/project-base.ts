import path from 'node:path';
import { ensureDir, pathExists, writeJson, writeText } from './fs.ts';
import { getWorkspacePaths } from './paths.ts';
import { writeYaml } from './yaml.ts';

export async function ensureProjectBase(workspaceRoot: string): Promise<void> {
  const {
    projectRoot,
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
  await ensureDir(generatedDir);
  await ensureDir(path.join(projectRoot, 'prisma'));
  await ensureDir(privateRegistryRoot);

  await writeJson(projectPackagePath, {
    name: 'generated-customer-admin',
    private: true,
    type: 'module',
    dependencies: {
      next: '^16.2.4',
      react: '^19.2.5',
      'react-dom': '^19.2.5'
    },
    devDependencies: {
      '@playwright/test': '^1.59.1',
      '@types/node': '^22.15.30',
      '@types/react': '^19.2.14',
      '@types/react-dom': '^19.2.3',
      typescript: '^5.8.3',
      vitest: '^4.1.5'
    },
    scripts: {
      dev: 'next dev',
      build: 'next build',
      'test:fast': 'node --test --experimental-test-isolation=none',
      'test:unit': 'vitest run --config vitest.config.ts',
      'test:acceptance': 'playwright test --config playwright.config.ts',
      'verify:runtime': 'npm run build && npm run test:unit && npm run test:acceptance',
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

  await writeText(path.join(projectRoot, 'next.config.mjs'), `const nextConfig = {};\n\nexport default nextConfig;\n`);
  await writeText(
    path.join(projectRoot, 'next-env.d.ts'),
    `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n\n// NOTE: This file is managed by the compiler runtime scaffold.\n`
  );
  await writeText(path.join(projectRoot, 'app', 'globals.css'), `:root {\n  color-scheme: light;\n  font-family: 'Segoe UI', sans-serif;\n}\n\n* {\n  box-sizing: border-box;\n}\n\nbody {\n  margin: 0;\n  background: #f4f4ef;\n  color: #17211f;\n}\n\na {\n  color: inherit;\n  text-decoration: none;\n}\n\nmain {\n  max-width: 960px;\n  margin: 0 auto;\n  padding: 32px 20px 80px;\n}\n\n.card {\n  background: #ffffff;\n  border: 1px solid #d3d9d0;\n  border-radius: 18px;\n  padding: 20px;\n  box-shadow: 0 10px 24px rgba(23, 33, 31, 0.06);\n}\n\n.stack {\n  display: grid;\n  gap: 16px;\n}\n\n.row {\n  display: flex;\n  gap: 12px;\n  align-items: center;\n  flex-wrap: wrap;\n}\n\nlabel {\n  display: grid;\n  gap: 6px;\n  font-size: 14px;\n}\n\ninput,\nbutton,\ntextarea,\nselect {\n  font: inherit;\n}\n\ninput,\ntextarea,\nselect {\n  width: 100%;\n  border: 1px solid #b7c3b8;\n  border-radius: 12px;\n  padding: 10px 12px;\n  background: #ffffff;\n}\n\nbutton {\n  border: 0;\n  border-radius: 999px;\n  padding: 10px 16px;\n  background: #1d6f5f;\n  color: white;\n  cursor: pointer;\n}\n\nbutton.secondary {\n  background: #dfe8e3;\n  color: #17211f;\n}\n\nul.clean {\n  list-style: none;\n  padding: 0;\n  margin: 0;\n}\n\nul.clean li {\n  padding: 12px 0;\n  border-bottom: 1px solid #e3e8e1;\n}\n\nnav a {\n  padding: 8px 12px;\n  border-radius: 999px;\n  background: #edf4ef;\n}\n\npre.json {\n  overflow: auto;\n  padding: 16px;\n  border-radius: 16px;\n  background: #0f1d19;\n  color: #e6fff8;\n}\n`);
  await writeText(
    path.join(projectRoot, 'vitest.config.ts'),
    `import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({\n  test: {\n    include: ['tests/runtime/unit/**/*.test.ts'],\n    environment: 'node'\n  }\n});\n`
  );
  await writeText(
    path.join(projectRoot, 'playwright.config.ts'),
    `import { defineConfig } from '@playwright/test';\n\nconst baseURL = 'http://127.0.0.1:3001';\n\nexport default defineConfig({\n  testDir: './tests/runtime/acceptance',\n  reporter: 'line',\n  use: {\n    baseURL,\n    trace: 'off'\n  },\n  webServer: {\n    command: 'next dev --hostname 127.0.0.1 --port 3001',\n    url: \`\${baseURL}/login\`,\n    reuseExistingServer: !process.env.CI,\n    timeout: 120000\n  }\n});\n`
  );

  await writeText(
    path.join(projectRoot, 'src', 'runtime', 'database.ts'),
    `export interface CustomerInput {\n  name?: string;\n  email?: string;\n  phone?: string;\n  company?: string;\n}\n\nexport interface NormalizedCustomerInput {\n  name: string;\n  email: string;\n  phone: string;\n  company: string;\n}\n\nexport interface CustomerRecord extends NormalizedCustomerInput {\n  id: number;\n  tenantId: string;\n}\n\nexport interface Database {\n  nextCustomerId: number;\n  customers: CustomerRecord[];\n}\n\nexport function createDatabase(): Database {\n  return {\n    nextCustomerId: 1,\n    customers: []\n  };\n}\n`
  );

  const prismaSchemaPath = path.join(projectRoot, 'prisma', 'schema.prisma');
  if (!(await pathExists(prismaSchemaPath))) {
    await writeText(
      prismaSchemaPath,
      `generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "sqlite"\n  url      = "file:./dev.db"\n}\n`
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
