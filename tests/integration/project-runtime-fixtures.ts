import fs from 'node:fs/promises';
import path from 'node:path';
import { RUNTIME_DEPENDENCY_PACKAGE_NAMES } from '../../platform/shared/runtime-dependency-spec.ts';

export async function installRuntimeDeps(cwd: string): Promise<void> {
  await Promise.all(RUNTIME_DEPENDENCY_PACKAGE_NAMES.map(async (packageName) => {
    const packagePath = path.join(cwd, 'node_modules', ...packageName.split('/'), 'package.json');
    await fs.mkdir(path.dirname(packagePath), { recursive: true });
    await fs.writeFile(packagePath, `${JSON.stringify({
      name: packageName,
      version: '0.0.0-fixture'
    })}\n`, 'utf8');
  }));
}
