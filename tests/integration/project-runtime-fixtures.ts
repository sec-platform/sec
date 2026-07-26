import fs from 'node:fs/promises';
import path from 'node:path';
import {
  EXACT_PLAYWRIGHT_PACKAGE_NAMES,
  loadRuntimeDependencySpec,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES
} from '../../platform/shared/runtime-dependency-spec.ts';

export async function installRuntimeDeps(cwd: string): Promise<void> {
  const runtimeSpec = await loadRuntimeDependencySpec();
  const packageNames = new Set([
    ...RUNTIME_DEPENDENCY_PACKAGE_NAMES,
    ...EXACT_PLAYWRIGHT_PACKAGE_NAMES
  ]);
  await Promise.all([...packageNames].map(async (packageName) => {
    const packagePath = path.join(cwd, 'node_modules', ...packageName.split('/'), 'package.json');
    await fs.mkdir(path.dirname(packagePath), { recursive: true });
    await fs.writeFile(packagePath, `${JSON.stringify({
      name: packageName,
      version: EXACT_PLAYWRIGHT_PACKAGE_NAMES.includes(
        packageName as (typeof EXACT_PLAYWRIGHT_PACKAGE_NAMES)[number]
      )
        ? runtimeSpec.devDependencies['@playwright/test']
        : '0.0.0-fixture'
    })}\n`, 'utf8');
  }));
}
