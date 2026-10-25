import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { typecheckProject } from '../../../src/adapters/verification/typecheck-project.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const configFile = path.join(repositoryRoot, 'tsconfig.json');
const config = ts.readConfigFile(configFile, ts.sys.readFile);
if (config.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
/** Exercise the JS project-verification entry used by workspace verification
 * and template validation, not a test-owned compiler program. Copy the real
 * repository configuration, including unused policies and include/exclude.
 * Only ambient package selection is disabled: these fixtures need standard
 * libraries and local imports, not Node/Bun packages or dependency installs.
 * This does not qualify the separate native repository typecheck entry or
 * claim checker equivalence. Export reachability remains Knip/graph work.
 */
async function verificationFailure(entries: Readonly<Record<string, string>>, surface: 'src' | 'tests', provider?: string): Promise<CodedFailure | undefined> {
  return withTempWorkspace(async root => {
    const directory = path.join(root, surface);
    await fs.mkdir(directory);
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
    for (const [name, source] of Object.entries(entries)) await fs.writeFile(path.join(directory, name), source);
    if (provider !== undefined) await fs.writeFile(path.join(directory, 'provider.ts'), provider);
    const fixtureConfig = {
      ...config.config,
      compilerOptions: { ...config.config.compilerOptions, types: [] }
    };
    await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify(fixtureConfig));
    const parsed = ts.parseJsonConfigFileContent(fixtureConfig, ts.sys, root);
    assert.deepEqual(parsed.errors.map(value => value.code), []);
    for (const name of Object.keys(entries)) {
      assert.ok(parsed.fileNames.some(file => path.resolve(file) === path.join(directory, name)), 'The repository configuration must select every fixture entry');
    }
    try {
      await typecheckProject(root, { isolated: false }, {
        async ensureProjectDependencies() {
          assert.fail('The dependency-free fixture must not install packages');
        },
        async withProjectDependencyBridge(projectRoot, use) {
          assert.equal(projectRoot, root);
          return use();
        }
      });
      return undefined;
    } catch (error) {
      assert.ok(error instanceof CodedFailure);
      assert.equal(error.code, 'VERIFY-BUILD-005', 'Only completed compiler diagnostics may reject the fixture');
      return error;
    }
  }, 'sec-unused-admission-');
}

async function rejectsUnused(source: string, surface: 'src' | 'tests', binding: string, column: number, provider?: string): Promise<void> {
  const failure = await verificationFailure({ 'entry.ts': source }, surface, provider);
  assert.ok(failure, 'Unused code must reject project verification');
  assert.match(failure.message, /\bTS6133:/u);
  // Each negative fixture has exactly one unused binding. Checking the entire
  // diagnostic list prevents a primary unused error hiding an unrelated error.
  assert.ok(Array.isArray(failure.details));
  assert.equal(failure.details.length, 1, 'The fixture must not fail for another reason');
  assert.equal(typeof failure.details[0], 'string');
  assert.ok(failure.details[0].includes(`/${surface}/entry.ts:1:${column} `));
  assert.ok(failure.details[0].includes(`'${binding}'`));
}

for (const surface of ['src', 'tests'] as const) {
  test(`${surface} rejects dead locals and private forwarding helpers`, async () => {
    await rejectsUnused('const discarded = 1; export const result = 2;', surface, 'discarded', 7);
    await rejectsUnused('function redundant(value: number) { return value; } export const result = 2;', surface, 'redundant', 10);
  });

  test(`${surface} rejects unused value imports, type imports and parameters`, async () => {
    await rejectsUnused('import { value } from "./provider.js"; export const result = 2;', surface, 'value', 1, 'export const value = 1;');
    await rejectsUnused('import type { Payload } from "./provider.js"; export const result = 2;', surface, 'Payload', 1, 'export type Payload = { value: number };');
    await rejectsUnused('export function evaluate(unused: number) { return 1; }', surface, 'unused', 26);
  });

  test(`${surface} keeps used declarations, deliberate callback positions and public contracts`, async () => {
    assert.equal(await verificationFailure({
      'used.ts': 'const value = 1; export function evaluate() { return value; }',
      'callback.ts': 'export function callback(_error: unknown, value: number) { return value; }',
      'public.ts': 'export type PublicContract = { value: number }; export const entrypoint = 1;',
      'entry.ts': 'import "./provider.js"; export const result = 2;'
    }, surface, 'export const initialized = 1;'), undefined);
  });
}
