import { settleWorkspaceCallback } from '../../../../tests/testkit/workspace-cleanup.ts';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  buildSemanticMutationIsolatedChildOutcome,
  parseSemanticMutationIsolatedChildOutcomeBytes,
  semanticMutationIsolatedChildOutcomeBytes
} from '../../../assurance/verification/semantic-mutation/isolated-child-outcome.ts';
import {
  publishSemanticMutationIsolatedChildOutcome,
  semanticMutationIsolatedChildOutcomePath,
  semanticMutationIsolatedChildOutcomePendingPath
} from './isolated-verification-child-outcome.ts';

test('isolated child outcome accepts only its bounded exact canonical wire', () => {
  const expected = { formatVersion: 'semantic-mutation-isolated-child-outcome-v1',
    status: 'failed', stage: 'verify-all', boundary: 'pipeline-verify' };
  const canonical = '{"formatVersion":"semantic-mutation-isolated-child-outcome-v1","status":"failed","stage":"verify-all","boundary":"pipeline-verify"}\n';
  const outcome = buildSemanticMutationIsolatedChildOutcome('verify-all', 'pipeline-verify');
  const bytes = semanticMutationIsolatedChildOutcomeBytes(outcome);
  expect(bytes).toEqual(new TextEncoder().encode(canonical));
  expect(parseSemanticMutationIsolatedChildOutcomeBytes(bytes)).toEqual(expected);
  for (const source of [
    `${canonical}[]`,
    '{"formatVersion":"semantic-mutation-isolated-child-outcome-v1","status":"failed","status":"failed","stage":"preflight"}',
    '{"formatVersion":"semantic-mutation-isolated-child-outcome-v1","status":"failed","stage":{"value":"preflight"}}',
    '{"formatVersion":"semantic-mutation-isolated-child-outcome-v1","status":"failed","stage":"preflight"}' + ' '.repeat(512)
  ]) {
    expect(() => parseSemanticMutationIsolatedChildOutcomeBytes(new TextEncoder().encode(source)))
      .toThrow('bytes are invalid');
  }
});

test.skipIf(process.platform === 'win32')(
  'isolated child outcome publication refuses a substituted pending leaf',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sec-isolated-child-outcome-'));
    await settleWorkspaceCallback(async () => {
      await mkdir(path.join(root, '.isolated-process', 'child'), { recursive: true });
      const outside = path.join(root, 'outside.json');
      await writeFile(outside, 'outside\n', 'utf8');
      await symlink(outside, semanticMutationIsolatedChildOutcomePendingPath(root), 'file');

      const outcome = buildSemanticMutationIsolatedChildOutcome('verify-all', 'pipeline-verify');
      await expect(publishSemanticMutationIsolatedChildOutcome(root, outcome)).rejects.toThrow();
      expect(await readFile(outside, 'utf8')).toBe('outside\n');
      await expect(readFile(semanticMutationIsolatedChildOutcomePath(root), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' });
    }, async () => {
      await rm(root, { recursive: true, force: true });
    });
  }
);
