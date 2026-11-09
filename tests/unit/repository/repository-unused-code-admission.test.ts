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
const surfaces = ['src', 'tests'] as const;
type TestSources = Readonly<Record<(typeof surfaces)[number], Readonly<Record<string, string>>>>;

async function verificationFailure(entriesBySurface: TestSources, provider?: string): Promise<CodedFailure | undefined> {
  return withTempWorkspace(async root => {
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
    for (const surface of surfaces) {
      const directory = path.join(root, surface);
      await fs.mkdir(directory);
      for (const [name, source] of Object.entries(entriesBySurface[surface])) {
        await fs.writeFile(path.join(directory, name), source);
      }
      if (provider !== undefined) await fs.writeFile(path.join(directory, 'provider.ts'), provider);
    }
    const fixtureConfig = {
      ...config.config,
      compilerOptions: { ...config.config.compilerOptions, types: [] }
    };
    await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify(fixtureConfig));
    const parsed = ts.parseJsonConfigFileContent(fixtureConfig, ts.sys, root);
    assert.deepEqual(parsed.errors.map(value => value.code), []);
    for (const surface of surfaces) {
      for (const name of Object.keys(entriesBySurface[surface])) {
        assert.ok(parsed.fileNames.some(file => path.resolve(file) === path.join(root, surface, name)),
          `The repository configuration must select ${surface}/${name}`);
      }
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

async function rejectsUnused(): Promise<void> {
  // One native TypeScript Program preserves independent diagnostics from both
  // selected source surfaces without compiling the same standard libraries twice.
  const cases = [
    { file: 'unused-local.ts', source: 'const discarded = 1; export const result = 2;', binding: 'discarded', column: 7 },
    { file: 'unused-parameter.ts', source: 'export function evaluate(unused: number) { return 1; }', binding: 'unused', column: 26 }
  ] as const;
  const entries = Object.fromEntries(cases.map(({ file, source }) => [file, source]));
  const failure = await verificationFailure({ src: entries, tests: entries });
  assert.ok(failure, 'Unused code must reject project verification');
  assert.match(failure.message, /\bTS6133:/u);
  const details = failure.details;
  assert.ok(Array.isArray(details));
  assert.equal(details.length, cases.length * surfaces.length,
    'Every source surface must report both independent unused declarations');
  for (const surface of surfaces) {
    for (const { file, binding, column } of cases) {
      const matched = details.filter((detail): detail is string => (
        typeof detail === 'string' && detail.includes(`/${surface}/${file}:1:${column} `)
      ));
      assert.equal(matched.length, 1, `Expected one unused-declaration diagnostic for ${surface}/${file}`);
      assert.match(matched[0]!, /is declared but its value is never read/u);
      assert.ok(matched[0]!.includes(`'${binding}'`));
    }
  }
}

test('src and tests reject unused locals and parameters through repository policy', async () => {
  await rejectsUnused();
});

test('src and tests keep used declarations, deliberate callback positions and public contracts', async () => {
  const entries = {
    'used.ts': 'const value = 1; export function evaluate() { return value; }',
    'callback.ts': 'export function callback(_error: unknown, value: number) { return value; }',
    'public.ts': 'export type PublicContract = { value: number }; export const entrypoint = 1;',
    'entry.ts': 'import "./provider.js"; export const result = 2;'
  };
  assert.equal(await verificationFailure(
    { src: entries, tests: entries }, 'export const initialized = 1;'
  ), undefined);
});
