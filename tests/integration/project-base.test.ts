import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { RUNTIME_VERIFICATION_INVOCATION_CONTRACT } from '../../platform/compiler/verify/runtime-verification-invocation-contract.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { ensureProjectBase } from '../../platform/shared/project-base.ts';
import { loadRuntimeDependencySpec } from '../../platform/shared/runtime-dependency-spec.ts';
import { expectContainsAll, expectContainsNone } from '../helpers/assertion-helpers.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

type RuntimePackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
describe('project base', () => {
  test('reuses the production build for the Playwright runtime smoke', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);

      const runtimeSpec = await loadRuntimeDependencySpec();
      const { projectPackagePath, projectRoot } = getWorkspacePaths(workspaceRoot);
      const projectPackage = await readJson<RuntimePackageJson & { scripts: Record<string, string> }>(projectPackagePath);
      const playwrightConfig = await fs.readFile(path.join(projectRoot, 'playwright.config.ts'), 'utf8');

      expect(runtimeSpec.devDependencies['@playwright/test']).toBeDefined();
      expect(runtimeSpec.devDependencies['ts-morph']).toBeDefined();
      expect(projectPackage.devDependencies['@playwright/test']).toBe(runtimeSpec.devDependencies['@playwright/test']);
      expect(projectPackage.scripts.dev).toBe('next dev --webpack');
      expect(projectPackage.scripts['test:acceptance']).toBe('playwright test --config playwright.config.ts');
      expect(projectPackage.scripts['verify:runtime:full']).toBe('bun run build && bun run test:unit && bun run test:acceptance');
      expect(projectPackage.scripts['test:fast']).not.toContain('playwright');
      expect(playwrightConfig).toContain("trace: 'retain-on-failure'");
      expect(playwrightConfig).toContain('workers: 1');
      expect(playwrightConfig).toContain("'node_modules/next/dist/bin/next'");
      expect(playwrightConfig).not.toContain('next dev');
    }, 'engineering-compiler-runtime-trace-');
  });

  test('project base delegates isolated acceptance server lifecycle to the verifier', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const playwrightConfig = await fs.readFile(path.join(projectRoot, 'playwright.config.ts'), 'utf8');

      expect(RUNTIME_VERIFICATION_INVOCATION_CONTRACT.build.moduleRelativePath).toBe('next/dist/bin/next');
      expectContainsAll(playwrightConfig, [
        "process.env.SEC_ISOLATED_VERIFICATION === '1'",
        'const webServerCommand = [',
        "'bun'",
        "'--no-env-file'",
        "'--no-install'",
        "'node_modules/next/dist/bin/next'",
        "'start'",
        'webServer: isolatedVerification ? undefined : {',
        "cwd: '.'",
        'command: webServerCommand',
        'reuseExistingServer: !process.env.CI'
      ]);
      expectContainsNone(playwrightConfig, [
        "? [\n      'node'",
        '.bin/next',
        'next start --hostname',
        '--config=../.isolated-process/runtime/bunfig.toml',
        "'npx'",
        'bun run',
        'process.env.PATH',
        'process.env.ComSpec',
        'process.env.PATHEXT'
      ]);
    }, 'engineering-compiler-runtime-command-');
  });
});
