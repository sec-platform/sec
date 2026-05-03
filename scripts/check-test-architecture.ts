import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

async function readText(relativePath: string): Promise<string> {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function listFiles(directory: string, predicate: (file: string) => boolean): Promise<string[]> {
  const absolute = path.join(root, directory);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.join(directory, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      files.push(...await listFiles(relative, predicate));
    } else if (predicate(relative)) {
      files.push(relative);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const packageJson = JSON.parse(await readText('package.json')) as { scripts?: Record<string, string> };
  assert(
    packageJson.scripts?.['imports:check'] === 'bun ./platform/dev-runner.ts imports:check',
    'imports:check must be non-mutating; use imports:organize for local rewrites.'
  );

  const workflow = await readText('.github/workflows/compiler-ci.yml');
  assert(!/--frozen-lockfile\\s+--frozen-lockfile/u.test(workflow), 'CI must not duplicate --frozen-lockfile.');
  assert(workflow.includes('run: bun install --frozen-lockfile'), 'CI must use bun install --frozen-lockfile.');
  assert(workflow.includes('git diff --exit-code'), 'CI must check clean workspace after static checks.');

  const contractFreeze = await readText('platform/shared/contract-freeze-contract.ts');
  assert(!contractFreeze.includes('tests/e2e/'), 'contract-freeze targets must not include slow e2e tests.');

  const contractTest = await readText('tests/contract/contracts.test.ts');
  assert(!contractTest.includes('v0.1 pipeline runs end to end in a temporary workspace'), 'contract-freeze test must not expect slow e2e patterns.');
  assert(!/toHaveLength\\(1[45]\\)/u.test(contractTest), 'contract-freeze test must not hardcode old target counts.');

  const slowTests = await listFiles('tests/e2e', (file) => file.endsWith('.slow.test.ts'));
  const missingTimeouts: string[] = [];
  for (const file of slowTests) {
    const source = await readText(file);
    const testBlocks = [...source.matchAll(/^test\(/gm)];
    if (testBlocks.length === 0) continue;
    if (!/},\s*\d+\);\s*$/m.test(source)) {
      missingTimeouts.push(file);
    }
  }
  assert(missingTimeouts.length === 0, `slow e2e tests require explicit timeout: ${missingTimeouts.join(', ')}`);

  console.log('Test architecture checks passed.');
}

await main();
