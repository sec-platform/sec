import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { compileRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
import { compileSourceProgramOperationProducerClosure } from './producer-closure.ts';
import { compileVirtualRepositorySourceProgramCompilation } from './repository-compilation.ts';
import { releaseTypeScriptSourceProgramWorkspace } from './typescript.ts';
import { compileVirtualWorkspaceSourceSnapshot } from './workspace-source-snapshot.ts';

afterAll(releaseTypeScriptSourceProgramWorkspace);

function compilation(sources: Readonly<Record<string, string>>) {
  const files = Object.entries(sources).map(([path, source]) => ({
    path, source, contentDigest: rawSha256(source), mode: '100644' as const
  }));
  const membership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: files.map(file => file.path),
    descriptorSources: files.filter(file => file.path.endsWith('/module.json'))
      .map(file => ({ descriptorPath: file.path, source: file.source }))
  });
  const snapshot = compileVirtualWorkspaceSourceSnapshot({
    subject: { kind: 'virtual-mutation', provenance: {
      kind: 'source-program-virtual-mutation', baseSnapshotDigest: rawSha256('file-loader-oracle-base'),
      mutationDigest: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest })))
    } },
    files, moduleMembership: membership
  });
  return compileVirtualRepositorySourceProgramCompilation({ workspaceSnapshot: snapshot });
}

test('static and dynamic file imports retain a declaration sidecar and the actual asset without an evaluation edge', () => {
  for (const entry of [
    'import worker from "./worker.mjs" with { type: "file" }; export { worker };',
    'export async function locate() { return (await import("./worker.mjs", { with: { type: "file" } })).default; }'
  ]) {
    const result = compilation({
      'package.json': '{"type":"module"}',
      'src/example/module.json': '{"importGraph":"runtime","externalEntrypoints":[]}',
      'src/example/main.ts': entry,
      'src/example/worker.d.mts': 'declare const worker: string; export default worker;',
      'src/example/worker.mjs': 'throw new Error("asset must not execute"); export default "wrong";'
    });
    const graph = result.workspaceSnapshot.moduleGraph;
    const references = graph.references.filter(reference => reference.from === 'src/example/main.ts'
      && reference.specifier === './worker.mjs');
    expect(references).toHaveLength(1);
    expect(references[0]!.resolvedTarget).toBe('src/example/worker.d.mts');
    expect(references[0]!.runtime).toEqual({ kind: 'asset', target: 'src/example/worker.mjs' });
    expect(graph.directDependencies('src/example/main.ts')).toContain('src/example/worker.d.mts');
    expect(graph.directDependencies('src/example/main.ts')).toContain('src/example/worker.mjs');
    expect(graph.directRuntimeDependencies('src/example/main.ts')).toEqual([]);
  }
});

test('a retained file asset does not propagate its computed import into the producer evaluation closure', () => {
  const descriptor = JSON.stringify({ importGraph: 'runtime', externalEntrypoints: ['src/example/runtime.ts'],
    capabilityProviders: [{ capability: 'example.verify', operations: ['verify'] }] });
  const sources = {
    'package.json': '{"type":"module"}',
    'src/example/module.json': descriptor,
    'src/example/runtime.ts': 'import worker from "./asset.ts" with { type: "file" }; export function verify() { return worker; }',
    'src/example/asset.ts': 'const target = "./not-fixed.ts"; void import(target); export default "payload";'
  };
  const result = compilation(sources);
  expect(result.workspaceSnapshot.moduleGraph.unresolvedFiles).toContain('src/example/asset.ts');
  expect(result.workspaceSnapshot.moduleGraph.directRuntimeDependencies('src/example/runtime.ts')).toEqual([]);
  const closure = compileSourceProgramOperationProducerClosure(result, { capability: 'example.verify', operation: 'verify' });
  expect(closure.authority).toBe('source-evidence-only');
  expect(closure.implementationFiles).toContainEqual(expect.objectContaining({
    path: 'src/example/asset.ts', contentDigest: rawSha256(sources['src/example/asset.ts'])
  }));
  const ordinary = compilation({ ...sources,
    'src/example/runtime.ts': sources['src/example/runtime.ts'].replace(' with { type: "file" }', '') });
  expect(ordinary.workspaceSnapshot.moduleGraph.directRuntimeDependencies('src/example/runtime.ts'))
    .toEqual(['src/example/asset.ts']);
  expect(() => compileSourceProgramOperationProducerClosure(ordinary, { capability: 'example.verify', operation: 'verify' }))
    .toThrow(expect.objectContaining({ code: 'reachable-loader-resource-unresolved' }));
});

test('a module import and file path for the same specifier stay distinct in graph and test capability binding', () => {
  const operation = 'src/example/operation.ts';
  const result = compilation({
    'package.json': '{"type":"module"}',
    'src/example/module.json': JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [operation],
      capabilityProviders: [{ capability: 'example.operation', operations: ['runOperation'] }] }),
    [operation]: 'export default async function runOperation(subject: string) { return subject; } export { runOperation };',
    'tests/mixed.test.ts': [
      'import { test } from "bun:test";',
      'import { runOperation } from "../src/example/operation.ts";',
      'import moduleDefault from "../src/example/operation.ts";',
      'import assetPath from "../src/example/operation.ts" with { type: "file" };',
      'test("module call", async () => { await runOperation("subject"); });',
      'test("module default call", async () => { await moduleDefault("subject"); });',
      'test("asset path", () => { assetPath("subject"); });'
    ].join('\n')
  });
  const graph = result.workspaceSnapshot.moduleGraph;
  const imports = graph.references.filter(reference => reference.from === 'tests/mixed.test.ts'
    && reference.specifier === '../src/example/operation.ts');
  expect(imports).toHaveLength(2);
  expect(imports.map(reference => reference.runtime.kind).sort()).toEqual(['asset', 'module']);
  expect(graph.directRuntimeDependencies('tests/mixed.test.ts')).toEqual([operation]);
  const observations = result.testObservations;
  expect(observations.references).toContainEqual(expect.objectContaining({
    kind: 'call', name: 'runOperation', targetPath: operation, sourceRelation: 'declaration'
  }));
  expect(observations.references).toContainEqual(expect.objectContaining({
    kind: 'call', name: 'moduleDefault', targetPath: operation, sourceRelation: 'declaration'
  }));
  expect(observations.references.some(reference => reference.kind === 'call'
    && reference.name === 'assetPath' && reference.targetPath === operation)).toBe(false);
  const moduleCase = observations.registrations.find(registration => registration.title === 'module call');
  const assetCase = observations.registrations.find(registration => registration.title === 'asset path');
  expect(moduleCase).toBeDefined();
  expect(assetCase).toBeDefined();
  const moduleCapabilities = observations.capabilities.filter(capability => moduleCase!.capabilityObservationIds.includes(capability.observationId));
  expect(moduleCapabilities).toContainEqual(expect.objectContaining({
    transport: 'repository-provider', providerCapability: 'example.operation', operation: 'runOperation'
  }));
  const assetCapabilities = observations.capabilities.filter(capability => assetCase!.capabilityObservationIds.includes(capability.observationId));
  expect(assetCapabilities.some(capability => capability.providerCapability === 'example.operation')).toBe(false);
});

for (const route of [
  { name: 'namespace default', carrier: '', ordinary: 'declaration',
    entry: 'import * as value from "./operation.ts" with { type: "file" }; export function probe() { return value.default("subject"); }' },
  { name: 'named binding', carrier: '', ordinary: 'call-result',
    entry: 'import { runOperation as assetRun } from "./operation.ts" with { type: "file" }; export function probe() { return assetRun("subject"); }' },
  { name: 'dynamic namespace', carrier: '', ordinary: 'declaration',
    entry: 'const value = await import("./operation.ts", { with: { type: "file" } }); export function probe() { return value.default("subject"); }' },
  { name: 'dynamic destructuring', carrier: '', ordinary: 'module-input',
    entry: 'const { default: assetRun } = await import("./operation.ts", { with: { type: "file" } }); export function probe() { return assetRun("subject"); }' },
  { name: 'explicit reexport', ordinary: 'call-result', carrier: 'export { default as assetRun } from "./operation.ts" with { type: "file" };',
    entry: 'import { assetRun } from "./carrier.ts"; export function probe() { return assetRun("subject"); }' },
  { name: 'local reexport', ordinary: 'call-result', carrier: 'import value from "./operation.ts" with { type: "file" }; export { value as assetRun };',
    entry: 'import { assetRun } from "./carrier.ts"; export function probe() { return assetRun("subject"); }' },
  { name: 'star reexport', ordinary: 'call-result', carrier: 'export * from "./operation.ts" with { type: "file" };',
    entry: 'import { runOperation as assetRun } from "./carrier.ts"; export function probe() { return assetRun("subject"); }' }
]) {
  test(`file ${route.name} cannot borrow a module call or return identity through the compiler`, () => {
    const operation = 'src/example/operation.ts';
    const sources = {
      'package.json': '{"type":"module"}',
      'src/example/module.json': JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [operation],
        capabilityProviders: [{ capability: 'example.operation', operations: ['runOperation'] }] }),
      [operation]: 'export default function runOperation(subject: string) { return subject; } export { runOperation };',
      'src/example/carrier.ts': route.carrier || 'export {};',
      'src/example/consumer.ts': route.entry
    };
    const asset = compilation(sources).typeScriptCompilation.model;
    expect(asset.references.some(reference => reference.path === 'src/example/consumer.ts'
      && reference.kind === 'call' && reference.targetPath === operation)).toBe(false);
    const assetProbe = asset.declarations.find(declaration => declaration.path === 'src/example/consumer.ts' && declaration.name === 'probe');
    expect(assetProbe).toBeDefined();
    expect(asset.returnProvenances.find(provenance => provenance.declarationObservationId === assetProbe!.observationId)?.normalReturns)
      .toEqual([{ kind: 'opaque' }]);
    const asModule = (source: string) => source.replace(' with { type: "file" }', '').replace(', { with: { type: "file" } }', '');
    const ordinary = compilation({ ...sources,
      'src/example/carrier.ts': asModule(sources['src/example/carrier.ts']),
      'src/example/consumer.ts': asModule(sources['src/example/consumer.ts'])
    }).typeScriptCompilation.model;
    // The existing analyzer retains dynamic-destructuring module inputs but
    // does not issue its BindingElement a callable declaration. Namespace
    // member calls are known; their return callback remains conservative.
    expect(ordinary.references.some(reference => reference.path === 'src/example/consumer.ts'
      && reference.kind === 'call' && reference.targetPath === operation)).toBe(route.ordinary !== 'module-input');
    if (route.ordinary === 'module-input') expect(ordinary.references).toContainEqual(expect.objectContaining({
      path: 'src/example/consumer.ts', kind: 'import', targetPath: operation
    }));
    const ordinaryProbe = ordinary.declarations.find(declaration => declaration.path === 'src/example/consumer.ts' && declaration.name === 'probe');
    const returns = ordinary.returnProvenances.find(provenance => provenance.declarationObservationId === ordinaryProbe!.observationId)?.normalReturns;
    if (route.ordinary === 'call-result') expect(returns).toContainEqual(expect.objectContaining({ kind: 'call-result' }));
    else expect(returns).toEqual([{ kind: 'opaque' }]);
  });
}

test('an unrelated file star cannot erase the compiler proven local export of its carrier', () => {
  const carrier = 'src/example/carrier.ts';
  const model = compilation({
    'package.json': '{"type":"module"}',
    'src/example/module.json': '{"importGraph":"runtime","externalEntrypoints":[]}',
    'src/example/asset.ts': 'export function unrelatedAssetValue() { return 2; }',
    [carrier]: 'export function ownOperation() { return 1; } export * from "./asset.ts" with { type: "file" };',
    'src/example/consumer.ts': [
      'import { ownOperation } from "./carrier.ts";',
      'import * as carrier from "./carrier.ts";',
      'export function namedProbe() { return ownOperation(); }',
      'export function namespaceProbe() { return carrier.ownOperation(); }'
    ].join('\n')
  }).typeScriptCompilation.model;
  const calls = model.references.filter(reference => reference.path === 'src/example/consumer.ts'
    && reference.kind === 'call' && reference.targetPath === carrier);
  expect(calls).toHaveLength(2);
  for (const name of ['namedProbe', 'namespaceProbe']) {
    const declaration = model.declarations.find(declaration => declaration.path === 'src/example/consumer.ts' && declaration.name === name);
    expect(declaration).toBeDefined();
    expect(model.returnProvenances.find(provenance => provenance.declarationObservationId === declaration!.observationId)?.normalReturns)
      .toContainEqual(expect.objectContaining({ kind: 'call-result' }));
  }
});

test('the actual Bun file loader returns local static and dynamic asset paths without evaluating throwing source bytes', () => {
  expect(Bun.version).toBe('1.4.4');
  const directory = mkdtempSync(path.join(tmpdir(), 'gift-file-loader-'));
  try {
    const asset = path.join(directory, 'throwing-asset.mjs');
    const content = 'throw new Error("file asset was evaluated"); export default "not a path";\n';
    writeFileSync(asset, content, 'utf8');
    const entry = path.join(directory, 'entry.mjs');
    writeFileSync(entry, [
      'import staticPath from "./throwing-asset.mjs" with { type: "file" };',
      'const dynamicPath = (await import("./throwing-asset.mjs", { with: { type: "file" } })).default;',
      'console.log(JSON.stringify({ version: Bun.version, staticPath, dynamicPath }));'
    ].join('\n'), 'utf8');
    const child = spawnSync(process.execPath, ['--no-env-file', entry], {
      cwd: directory, encoding: 'utf8', timeout: 10_000, windowsHide: true
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const observed = JSON.parse(child.stdout.trim()) as { version: string; staticPath: unknown; dynamicPath: unknown };
    expect(observed.version).toBe('1.4.4');
    for (const value of [observed.staticPath, observed.dynamicPath]) {
      expect(typeof value).toBe('string');
      const actualPath = path.resolve(directory, value as string);
      expect(actualPath).toBe(asset);
      expect(readFileSync(actualPath, 'utf8')).toBe(content);
    }
  } finally {
    expect(path.dirname(path.resolve(directory))).toBe(path.resolve(tmpdir()));
    expect(path.basename(directory).startsWith('gift-file-loader-')).toBe(true);
    rmSync(directory, { recursive: true, force: true });
  }
});
