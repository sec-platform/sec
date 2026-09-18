import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { settleWorkspaceCallback } from '../testkit/workspace-cleanup.ts';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const configFile = path.join(repositoryRoot, 'tsconfig.json');
const config = ts.readConfigFile(configFile, ts.sys.readFile);
if (config.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
/** Exercise TypeScript against native temporary source files using the real
 * repository configuration, including its include/exclude selection. Only
 * automatic ambient package selection is disabled: these fixture programs
 * need standard libraries, not Node/Bun declarations. Unused policies are not
 * set by the test. Reachability of exports remains separate Knip/graph work.
 */
async function diagnostics(source: string, surface: 'src' | 'tests', provider?: string): Promise<readonly ts.Diagnostic[]> {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sec-unused-admission-'));
  return settleWorkspaceCallback(async () => {
    const directory = path.join(root, surface);
    await fs.mkdir(directory);
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');
    await fs.writeFile(path.join(directory, 'entry.ts'), source);
    if (provider !== undefined) await fs.writeFile(path.join(directory, 'provider.ts'), provider);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    assert.deepEqual(parsed.errors.map(value => value.code), []);
    assert.ok(parsed.fileNames.some(file => path.resolve(file) === path.join(directory, 'entry.ts')), 'The repository configuration must select the fixture');
    const options: ts.CompilerOptions = { ...parsed.options, types: [] };
    return ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, options));
  }, () => fs.rm(root, { recursive: true, force: true }));
}

const unusedCodes: ReadonlySet<number> = new Set([6133, 6192, 6196, 6198, 6199]);
async function rejectsUnused(source: string, surface: 'src' | 'tests', provider?: string): Promise<void> {
  const result = await diagnostics(source, surface, provider);
  assert.ok(result.some(value => unusedCodes.has(value.code)), 'Unused code must produce a compiler error');
  assert.deepEqual(result.filter(value => !unusedCodes.has(value.code)).map(value => ({ code: value.code,
    message: ts.flattenDiagnosticMessageText(value.messageText, '\n') })), [], 'The fixture must not fail for a different reason');
}
async function accepts(source: string, surface: 'src' | 'tests', provider?: string): Promise<void> {
  assert.deepEqual((await diagnostics(source, surface, provider)).map(value => ({ code: value.code,
    message: ts.flattenDiagnosticMessageText(value.messageText, '\n') })), []);
}

for (const surface of ['src', 'tests'] as const) {
  test(`${surface} rejects dead locals and private forwarding helpers`, async () => {
    await rejectsUnused('const discarded = 1; export const result = 2;', surface);
    await rejectsUnused('function redundant(value: number) { return value; } export const result = 2;', surface);
  });

  test(`${surface} rejects unused value imports, type imports and parameters`, async () => {
    await rejectsUnused('import { value } from "./provider.js"; export const result = 2;', surface, 'export const value = 1;');
    await rejectsUnused('import type { Payload } from "./provider.js"; export const result = 2;', surface, 'export type Payload = { value: number };');
    await rejectsUnused('export function evaluate(unused: number) { return 1; }', surface);
  });

  test(`${surface} keeps used declarations, deliberate callback positions and public contracts`, async () => {
    await accepts('const value = 1; export function evaluate() { return value; }', surface);
    await accepts('export function callback(_error: unknown, value: number) { return value; }', surface);
    await accepts('export type PublicContract = { value: number }; export const entrypoint = 1;', surface);
  });

  test(`${surface} does not classify explicit side-effect imports as unused bindings`, async () => {
    await accepts('import "./provider.js"; export const result = 2;', surface, 'export const initialized = 1;');
  });
}
