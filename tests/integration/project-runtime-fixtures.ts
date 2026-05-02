import fs from 'node:fs/promises';
import path from 'node:path';

export async function installRuntimeDeps(cwd: string): Promise<void> {
  const nextPackagePath = path.join(cwd, 'node_modules', 'next', 'package.json');
  await fs.mkdir(path.dirname(nextPackagePath), { recursive: true });
  await fs.writeFile(nextPackagePath, '{\n  "name": "next",\n  "version": "0.0.0"\n}\n', 'utf8');
}
