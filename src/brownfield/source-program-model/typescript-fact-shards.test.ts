import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST } from './typescript-fact-shards.ts';
import {
  compileTypeScriptSourceProgramModel,
  compileTypeScriptSourceProgramModelIncremental,
  releaseTypeScriptSourceProgramWorkspace
} from './typescript.ts';

const moduleMembership = Object.freeze({
  descriptors: Object.freeze([]),
  graphRoots: Object.freeze([]),
  moduleRoots: Object.freeze([]),
  moduleForPath: () => null
});

function sourceInput(sources: Readonly<Record<string, string>>) {
  const files = Object.entries(sources)
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([path, source]) => Object.freeze({ path, source, contentDigest: rawSha256(source) }));
  return Object.freeze({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
}

test('TypeScript fact shards reuse unchanged semantic facts and remain clean-compile equivalent', () => {
  const initialInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 1;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n",
    'src/example/leaf.ts': 'export const LEAF = 1;\n'
  });
  const initial = compileTypeScriptSourceProgramModelIncremental(initialInput, null);
  const changedInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 2;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n",
    'src/example/leaf.ts': 'export const LEAF = 1;\n'
  });
  const changed = compileTypeScriptSourceProgramModelIncremental(changedInput, initial.state);
  const initialByPath = new Map(initial.state.factShards.map((shard) => [shard.path, shard] as const));
  const changedByPath = new Map(changed.state.factShards.map((shard) => [shard.path, shard] as const));

  expect(changed.mode).toBe('incremental');
  expect(changed.model).toEqual(compileTypeScriptSourceProgramModel(changedInput));
  expect(changedByPath.get('src/example/leaf.ts')).toBe(initialByPath.get('src/example/leaf.ts'));
  expect(changedByPath.get('src/example/contract.ts')).not.toBe(initialByPath.get('src/example/contract.ts'));
  expect(changed.state.factShards.every(({ schemaDigest }) =>
    schemaDigest === SOURCE_PROGRAM_TYPESCRIPT_FACT_SHARD_SCHEMA_DIGEST)).toBe(true);
  expect(changed.model.modelDigest).not.toBe(initial.model.modelDigest);
  const nextRevision = compileTypeScriptSourceProgramModelIncremental(Object.freeze({
    ...changedInput,
    sourceRevision: sha256({ parent: changedInput.sourceRevision, unrelatedRepositoryChange: true })
  }), changed.state);
  expect(nextRevision.mode).toBe('exact');
  expect(nextRevision.state.factShards.every((shard, index) =>
    shard === changed.state.factShards[index])).toBe(true);
  expect(nextRevision.model.modelDigest).not.toBe(changed.model.modelDigest);
  releaseTypeScriptSourceProgramWorkspace();
});

test('TypeScript root digest binds raw bytes even when a caller reuses a declared content digest', () => {
  const initialInput = sourceInput({
    'src/example/value.ts': 'export const VALUE = 1;\n'
  });
  const initial = compileTypeScriptSourceProgramModelIncremental(initialInput, null);
  const staleDigestInput = Object.freeze({
    ...initialInput,
    files: Object.freeze(initialInput.files.map((file) => Object.freeze({
      ...file,
      source: 'export const VALUE = 2;\n'
    })))
  });
  const changed = compileTypeScriptSourceProgramModelIncremental(staleDigestInput, initial.state);

  expect(changed.state.factShards[0]?.rawFileDigest)
    .not.toBe(initial.state.factShards[0]?.rawFileDigest);
  expect(changed.model.modelDigest).not.toBe(initial.model.modelDigest);
  expect(changed.model).toEqual(compileTypeScriptSourceProgramModel(staleDigestInput));
  releaseTypeScriptSourceProgramWorkspace();
});

test('sealed fact shards remain the incremental authority after the TypeScript workspace is released', () => {
  const initialInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 1;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n"
  });
  const initial = compileTypeScriptSourceProgramModelIncremental(initialInput, null);
  releaseTypeScriptSourceProgramWorkspace();
  const changedInput = sourceInput({
    'src/example/contract.ts': 'export const VALUE = 2;\n',
    'src/example/consumer.ts': "import { VALUE } from './contract.ts';\nexport const RESULT = VALUE;\n"
  });
  const changed = compileTypeScriptSourceProgramModelIncremental(changedInput, initial.state);

  expect(changed.mode).toBe('incremental');
  expect(changed.model).toEqual(compileTypeScriptSourceProgramModel(changedInput));
  releaseTypeScriptSourceProgramWorkspace();
});

test('non-production TypeScript files cannot poison the exact incremental identity', () => {
  const input = sourceInput({
    'src/example/value.ts': 'export const VALUE = 1;\n',
    'tests/example/value.test.ts': "import { expect, test } from 'bun:test';\ntest('value', () => expect(1).toBe(1));\n"
  });
  const initial = compileTypeScriptSourceProgramModelIncremental(input, null);
  const exact = compileTypeScriptSourceProgramModelIncremental(input, initial.state);

  expect(exact.mode).toBe('exact');
  expect(exact.invalidatedPaths).toEqual([]);
  expect(exact.model).toBe(initial.model);
  expect(exact.state).toBe(initial.state);
  expect(exact.state.factShards[0]).toBe(initial.state.factShards[0]);
  releaseTypeScriptSourceProgramWorkspace();
});
