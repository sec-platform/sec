import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AUTHORING_SEMANTIC_CONTRACT_INDEX_MAX_INPUT_BYTES,
  AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH, AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION,
  buildSemanticContractSourceCandidate,
  loadAuthoringSemanticContractSources,
  semanticContractSourceRevision
} from '../../src/compiler/parse/load-authoring-semantic-contracts.ts';
import { SEMANTIC_CONTRACT_FORMAT_VERSION, type LoadedSemanticContract, type SemanticContract } from '../../src/semantics/definitions/types.ts';
import { YamlInputLimitError, YamlSyntaxError } from '../../src/adapters/formats/yaml.ts';
import { modelRelativePath } from '../../src/workspace/contract/types.ts';

function contract(id = 'contract-a') {
  return { formatVersion: SEMANTIC_CONTRACT_FORMAT_VERSION, id, namespace: id } as SemanticContract;
}
function loaded() { return { blockId: 'block/a', contractPath: `${modelRelativePath}/a.yaml`, contract: contract() }; }
async function using(run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const f = await fixture(); try { await run(f); } finally { await fs.rm(f.root, { recursive: true, force: true }); }
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sec-authoring-input-'));
  const indexPath = path.join(root, ...AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH.split('/'));
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  const writeIndex = (contracts: unknown[]) => fs.writeFile(indexPath, JSON.stringify({ formatRevision: AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION, contracts }));
  const writeContract = async (name: string, value: unknown = contract(name)) => {
    const relative = `${modelRelativePath}/${name}.yaml`;
    await fs.writeFile(path.join(root, ...relative.split('/')), JSON.stringify(value));
    return relative;
  };
  return { root, indexPath, writeIndex, writeContract };
}

test('candidate fingerprint describes the same captured value when a caller getter changes on reread', () => {
  let reads = 0;
  const input: LoadedSemanticContract = { ...loaded(), get contract() { return contract(++reads === 1 ? 'first' : 'second'); } };
  const value = buildSemanticContractSourceCandidate('workspace-authoring', input);
  assert.equal(reads, 1); assert.equal(value.loadedContract.contract.id, 'first');
  assert.equal(value.sourceRevision, semanticContractSourceRevision(value.sourceKind, value.loadedContract));
});

test('normal source revision format remains unchanged and shared freeze owns only the clone', () => {
  const input = loaded();
  const expected = semanticContractSourceRevision('workspace-authoring', input);
  const value = buildSemanticContractSourceCandidate('workspace-authoring', input);
  assert.equal(value.sourceRevision, expected); assert.ok(Object.isFrozen(value.loadedContract.contract));
  assert.equal(Object.isFrozen(input.contract), false);
  input.contract.id = 'changed'; assert.equal(value.loadedContract.contract.id, 'contract-a');
});

test('uncloneable source values are refused without manufacturing a candidate', () => {
  assert.throws(() => buildSemanticContractSourceCandidate('workspace-authoring',
    { ...loaded(), callback() {} } as LoadedSemanticContract));
});

test('missing index is observed once as optional absence; empty declared index stays empty', () => using(async f => {
  assert.deepEqual(await loadAuthoringSemanticContractSources(f.root, new Set()), []);
  await f.writeIndex([]); assert.deepEqual(await loadAuthoringSemanticContractSources(f.root, new Set()), []);
}));

test('index collection and entries use one exact structural decoder', () => using(async f => {
  for (const raw of [null, {}, { formatRevision: 'other', contracts: [] },
    { formatRevision: AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION, contracts: null },
    { formatRevision: AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION, contracts: [], extra: true }]) {
    await fs.writeFile(f.indexPath, JSON.stringify(raw));
    await assert.rejects(loadAuthoringSemanticContractSources(f.root, new Set()), e => (e as { code?: string }).code === 'CONTRACT-SEMANTIC-019');
  }
  for (const entry of [null, { blockId: 7, path: 'a' }, { blockId: 'block/a', path: 7 }, { blockId: 'block/a', path: 'a', extra: true }]) {
    await f.writeIndex([entry]);
    await assert.rejects(loadAuthoringSemanticContractSources(f.root, new Set(['block/a'])), e => (e as { code?: string }).code === 'CONTRACT-SEMANTIC-020');
  }
}));

test('resolved membership and path constraints are still separate from schema acceptance', () => using(async f => {
  const resolved = new Set(['block/a']);
  await f.writeIndex([{ blockId: 'block/unresolved', path: `${modelRelativePath}/a.yaml` }]);
  await assert.rejects(loadAuthoringSemanticContractSources(f.root, resolved), e => (e as { code?: string }).code === 'CONTRACT-SEMANTIC-020');
  for (const p of ['../escape.yaml', 'src/a.yaml', `${modelRelativePath}/a.json`, AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH]) {
    await f.writeIndex([{ blockId: 'block/a', path: p }]);
    await assert.rejects(loadAuthoringSemanticContractSources(f.root, resolved), e => (e as { code?: string }).code === 'CONTRACT-SEMANTIC-021');
  }
  await f.writeIndex([{ blockId: 'block/a', path: `${modelRelativePath}/a.yaml` }, { blockId: 'block/a', path: `${modelRelativePath}/a.yaml` }]);
  await assert.rejects(loadAuthoringSemanticContractSources(f.root, resolved), e => (e as { code?: string }).code === 'CONTRACT-SEMANTIC-022');
}));

test('resolved membership is fixed before the asynchronous index read', () => using(async f => {
  const p = await f.writeContract('a'); await f.writeIndex([{ blockId: 'block/a', path: p }]);
  const resolved = new Set(['block/a']); const pending = loadAuthoringSemanticContractSources(f.root, resolved); resolved.clear();
  const values = await pending; assert.equal(values[0]!.loadedContract.blockId, 'block/a');
}));

test('root and sorted result paths stay fixed across caller chdir', () => using(async f => {
  const a = await f.writeContract('a'), b = await f.writeContract('b');
  await f.writeIndex([{ blockId: 'block/a', path: b }, { blockId: 'block/a', path: a }]);
  const cwd = process.cwd();
  try {
    process.chdir(f.root); const pending = loadAuthoringSemanticContractSources('.', new Set(['block/a'])); process.chdir(tmpdir());
    const values = await pending; assert.deepEqual(values.map(v => v.loadedContract.contractPath), [a, b]);
  } finally { process.chdir(cwd); }
}));

test('index syntax failures are not mistaken for absent optional sources', () => using(async f => {
  await fs.writeFile(f.indexPath, 'contracts: []\ncontracts: []\n');
  await assert.rejects(loadAuthoringSemanticContractSources(f.root, new Set()), YamlSyntaxError);
  await fs.writeFile(f.indexPath, ' '.repeat(AUTHORING_SEMANTIC_CONTRACT_INDEX_MAX_INPUT_BYTES + 1));
  await assert.rejects(loadAuthoringSemanticContractSources(f.root, new Set()), YamlInputLimitError);
  await fs.writeFile(f.indexPath, Uint8Array.of(0xff));
  await assert.rejects(loadAuthoringSemanticContractSources(f.root, new Set()));
}));

test('a contract parser warning cannot bypass the same strict source policy', () => using(async f => {
  const p = await f.writeContract('a'); await f.writeIndex([{ blockId: 'block/a', path: p }]);
  await fs.writeFile(path.join(f.root, ...p.split('/')), `formatVersion: '1'\nid: !unknown a\nnamespace: a\n`);
  await assert.rejects(loadAuthoringSemanticContractSources(f.root, new Set(['block/a'])), YamlSyntaxError);
}));

test('a failed source read joins every already-started peer before returning', () => using(async f => {
  const a = await f.writeContract('a'), b = await f.writeContract('b');
  await f.writeIndex([{ blockId: 'block/a', path: a }, { blockId: 'block/a', path: b }]);
  const original = fs.readFile, primary = new Error('source failed');
  let release!: () => void, started!: () => void, refused!: () => void;
  const held = new Promise<void>(r => { release = r; });
  const entered = new Promise<void>(r => { started = r; });
  const failed = new Promise<void>(r => { refused = r; });
  let returned = false;
  fs.readFile = (async (...args: Parameters<typeof fs.readFile>) => {
    if (String(args[0]) === path.join(f.root, ...a.split('/'))) { started(); await held; }
    if (String(args[0]) === path.join(f.root, ...b.split('/'))) { await entered; refused(); throw primary; }
    return Reflect.apply(original, fs, args);
  }) as typeof fs.readFile;
  const outcome = loadAuthoringSemanticContractSources(f.root, new Set(['block/a'])).then(
    () => ({ succeeded: true }), error => ({ succeeded: false, error })
  ).finally(() => { returned = true; });
  try {
    await failed; await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(returned, false);
    release(); const result = await outcome; assert.equal(result.succeeded, false);
    if ('error' in result) assert.equal(result.error, primary);
  } finally { release(); await outcome; fs.readFile = original; }
}));
