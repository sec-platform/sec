import { expect, test } from 'bun:test';

import type { GitReadSession } from '../../../providers/git-read/runtime/session.ts';
import { resolveSourceCheckpointStatusFromSession } from '../../control/documentation/document-control-source-checkpoint.ts';

import {
  assertDevelopmentSourceCheckpointCandidateIdentity,
  assertDevelopmentSourceCheckpointIndexDigest,
  assertDevelopmentSourceCheckpointNonDefaultRef,
  decodeDevelopmentCommitCommand,
  validateDevelopmentSourceCheckpointRequest
} from './source-checkpoint-contract.ts';

const request = Object.freeze({
  trustedMain: '1'.repeat(40), base: '2'.repeat(40), expectedHead: '3'.repeat(40),
  expectedRef: 'refs/heads/worker', expectedTree: '4'.repeat(40),
  expectedIndex: `sha256:${'5'.repeat(64)}` as const,
  ownedPaths: Object.freeze(['src/one.ts', 'src/two.ts'])
});
const args = [
  'checkpoint', '--source-checkpoint', '--workspace', '/candidate',
  '--trusted-main', request.trustedMain, '--base', request.base,
  '--expected-head', request.expectedHead, '--expected-ref', request.expectedRef,
  '--expected-tree', request.expectedTree, '--expected-index', request.expectedIndex,
  '--owned-path', 'src/two.ts', '--owned-path', 'src/one.ts'
];

test('source checkpoint command narrows the original commit entrypoint to one exact candidate', () => {
  expect(decodeDevelopmentCommitCommand(args, '/trusted')).toEqual({
    repositoryRoot: '/candidate', message: 'checkpoint', sourceCheckpoint: request
  });
  expect(decodeDevelopmentCommitCommand(['ordinary commit'], '/candidate')).toEqual({
    repositoryRoot: '/candidate', message: 'ordinary commit'
  });
  expect(Object.isFrozen(validateDevelopmentSourceCheckpointRequest(request).ownedPaths)).toBe(true);
});

test('source checkpoint grammar rejects unbound workspaces, duplicate switches and incomplete identities', () => {
  for (const option of [
    '--source-checkpoint', '--workspace', '--trusted-main', '--base', '--expected-head',
    '--expected-ref', '--expected-tree', '--expected-index'
  ]) {
    const index = args.indexOf(option);
    const incomplete = [...args];
    incomplete.splice(index, option === '--source-checkpoint' ? 1 : 2);
    expect(() => decodeDevelopmentCommitCommand(incomplete, '/trusted')).toThrow();
  }
  for (const extra of [
    ['--source-checkpoint'], ['--workspace', '/other'], ['--trusted-root', '/other'],
    ['--owned-path', 'src/one.ts'], ['--skip-normalization'], ['--new-state-root', '/tmp/other']
  ]) expect(() => decodeDevelopmentCommitCommand([...args, ...extra], '/trusted')).toThrow();
});

test('source checkpoint rejects symbolic revisions and broad or escaping ownership', () => {
  for (const trustedMain of ['main', 'HEAD', '1'.repeat(39)]) {
    expect(() => validateDevelopmentSourceCheckpointRequest({ ...request, trustedMain })).toThrow();
  }
  for (const expectedRef of ['main', 'refs/tags/tag', 'refs/heads/a..b', 'refs/heads/a.lock']) {
    expect(() => validateDevelopmentSourceCheckpointRequest({ ...request, expectedRef })).toThrow();
  }
  for (const ownedPaths of [[], ['src/*'], ['../outside'], ['.git/index'], ['/absolute'], ['src/a', 'src/a']]) {
    expect(() => validateDevelopmentSourceCheckpointRequest({ ...request, ownedPaths })).toThrow();
  }
});

test('exact candidate comparison rejects each independently drifting identity', () => {
  const observed = {
    ref: request.expectedRef, head: request.expectedHead,
    tree: request.expectedTree, index: request.expectedIndex
  };
  expect(() => assertDevelopmentSourceCheckpointCandidateIdentity(request, observed)).not.toThrow();
  for (const key of ['ref', 'head', 'tree', 'index'] as const) {
    expect(() => assertDevelopmentSourceCheckpointCandidateIdentity(request, { ...observed, [key]: 'drift' })).toThrow();
  }
});

test('trusted main policy rejects its default branch regardless of the candidate base policy', () => {
  expect(() => assertDevelopmentSourceCheckpointNonDefaultRef('refs/heads/main', 'main')).toThrow('default branch');
  expect(() => assertDevelopmentSourceCheckpointNonDefaultRef('refs/heads/trunk', 'trunk')).toThrow('default branch');
  expect(() => assertDevelopmentSourceCheckpointNonDefaultRef('refs/heads/worker', 'main')).not.toThrow();
});

test('scope must observe the requested index, not an earlier narrower index', () => {
  const earlierNarrowIndex = `sha256:${'6'.repeat(64)}`;
  expect(() => assertDevelopmentSourceCheckpointIndexDigest(request.expectedIndex, earlierNarrowIndex)).toThrow('exact requested index');
  expect(() => assertDevelopmentSourceCheckpointIndexDigest(request.expectedIndex, request.expectedIndex)).not.toThrow();
});

test('the shared-session source observer rejects a structural session before reading', async () => {
  let reads = 0;
  const foreign = { cwd: '/candidate', run() { reads++; throw new Error('must not read'); } } as unknown as GitReadSession;
  await expect(resolveSourceCheckpointStatusFromSession(foreign, request)).rejects.toThrow('production-issued');
  expect(reads).toBe(0);
});
