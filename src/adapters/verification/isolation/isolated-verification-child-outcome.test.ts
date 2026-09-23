import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT,
  buildSemanticMutationIsolatedChildOutcome,
  parseSemanticMutationIsolatedChildOutcomeBytes,
  semanticMutationIsolatedChildOutcomeBytes
} from '../../../assurance/verification/semantic-mutation/isolated-child-outcome.ts';
import {
  publishSemanticMutationIsolatedChildOutcome,
  semanticMutationIsolatedChildOutcomePath,
  semanticMutationIsolatedChildOutcomePendingPath
} from './isolated-verification-child-outcome.ts';

test('isolated child outcome round-trips only its canonical durable bytes', () => {
  const outcome = buildSemanticMutationIsolatedChildOutcome('verify-all', 'pipeline-verify');
  const bytes = semanticMutationIsolatedChildOutcomeBytes(outcome);

  expect(parseSemanticMutationIsolatedChildOutcomeBytes(bytes)).toEqual(outcome);
  expect(() => parseSemanticMutationIsolatedChildOutcomeBytes(
    new TextEncoder().encode(`${new TextDecoder().decode(bytes)}[]`)
  )).toThrow('bytes are invalid');
});

test('isolated child outcome rejects duplicate keys before its domain validator', () => {
  const bytes = new TextEncoder().encode(JSON.stringify({
    formatVersion: SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT,
    status: 'failed',
    stage: 'preflight'
  }).replace('"status":"failed"', '"status":"failed","status":"failed"'));

  expect(() => parseSemanticMutationIsolatedChildOutcomeBytes(bytes))
    .toThrow('bytes are invalid');
});

test('isolated child outcome rejects nested and oversized noncanonical documents', () => {
  const nested = new TextEncoder().encode(JSON.stringify({
    formatVersion: SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT,
    status: 'failed',
    stage: { value: 'preflight' }
  }));
  const oversized = new TextEncoder().encode(JSON.stringify({
    formatVersion: SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT,
    status: 'failed',
    stage: 'preflight',
    padding: 'x'.repeat(512)
  }));

  expect(() => parseSemanticMutationIsolatedChildOutcomeBytes(nested))
    .toThrow('bytes are invalid');
  expect(() => parseSemanticMutationIsolatedChildOutcomeBytes(oversized))
    .toThrow('bytes are invalid');
});


test.skipIf(process.platform === 'win32')(
  'isolated child outcome publication refuses a substituted pending leaf',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sec-isolated-child-outcome-'));
    try {
      await mkdir(path.join(root, '.isolated-process', 'child'), { recursive: true });
      const outside = path.join(root, 'outside.json');
      await writeFile(outside, 'outside\n', 'utf8');
      await symlink(outside, semanticMutationIsolatedChildOutcomePendingPath(root), 'file');

      const outcome = buildSemanticMutationIsolatedChildOutcome('verify-all', 'pipeline-verify');
      await expect(publishSemanticMutationIsolatedChildOutcome(root, outcome)).rejects.toThrow();
      expect(await readFile(outside, 'utf8')).toBe('outside\n');
      await expect(readFile(semanticMutationIsolatedChildOutcomePath(root), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
