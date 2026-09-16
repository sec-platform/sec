import { expect, test } from 'bun:test';

import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  WorkspaceTransitionContractError,
  type WorkspaceTransitionCapabilityObservation
} from './contract.ts';
import { compileWorkspaceTransitionPlan } from './plan.ts';
import { parseWorkspaceTransitionTrigger } from './trigger.ts';

const SHA1_A = '1'.repeat(40);
const SHA1_B = '2'.repeat(40);
const SHA256_A = 'a'.repeat(64);
const SHA256_B = 'b'.repeat(64);

function observation(
  disposition: WorkspaceTransitionCapabilityObservation['disposition'],
  owner: string
): WorkspaceTransitionCapabilityObservation {
  return {
    disposition,
    observationDigest: sha256({ owner, disposition }) as `sha256:${string}`
  };
}

test('post-checkout binds Git arguments to the observed current head and canonical flag', () => {
  expect(parseWorkspaceTransitionTrigger({
    event: 'post-checkout',
    arguments: ['0'.repeat(40), SHA1_A, '1'],
    currentHead: SHA1_A,
    objectIdLength: 40
  })).toEqual({
    event: 'post-checkout',
    previousHead: null,
    newHead: SHA1_A,
    checkoutKind: 'branch'
  });

  expect(() => parseWorkspaceTransitionTrigger({
    event: 'post-checkout',
    arguments: [SHA1_A, SHA1_B, '0'],
    currentHead: SHA1_A,
    objectIdLength: 40
  })).toThrow('differs from the observed current head');
});

test('post-merge carries only Git squash semantics and the observed head', () => {
  expect(parseWorkspaceTransitionTrigger({
    event: 'post-merge',
    arguments: ['0'],
    currentHead: SHA256_A,
    objectIdLength: 64
  })).toEqual({ event: 'post-merge', currentHead: SHA256_A, squash: false });
});

test('post-rewrite parses bounded exact records and rejects future extra information', () => {
  const encoder = new TextEncoder();
  expect(parseWorkspaceTransitionTrigger({
    event: 'post-rewrite',
    arguments: ['rebase'],
    currentHead: SHA256_B,
    objectIdLength: 64,
    standardInput: encoder.encode(`${SHA256_A} ${SHA256_B}\n`)
  })).toEqual({
    event: 'post-rewrite',
    currentHead: SHA256_B,
    command: 'rebase',
    records: [{ oldHead: SHA256_A, newHead: SHA256_B }]
  });

  try {
    parseWorkspaceTransitionTrigger({
      event: 'post-rewrite',
      arguments: ['amend'],
      currentHead: SHA1_B,
      objectIdLength: 40,
      standardInput: encoder.encode(`${SHA1_A} ${SHA1_B} future\n`)
    });
    throw new Error('expected parser rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceTransitionContractError);
    expect((error as WorkspaceTransitionContractError).code)
      .toBe('workspace-transition-rewrite-extra-unsupported');
  }
});

test('readiness matrix derives zero, one or two Effects and a single fresh-process boundary', () => {
  const trigger = parseWorkspaceTransitionTrigger({
    event: 'post-merge',
    arguments: ['1'],
    currentHead: SHA1_A,
    objectIdLength: 40
  });
  const worktreeIdentityDigest = sha256('worktree') as `sha256:${string}`;

  const ready = compileWorkspaceTransitionPlan({
    trigger,
    worktreeIdentityDigest,
    dependency: observation('ready', 'dependency'),
    hooks: observation('ready', 'hooks')
  });
  expect(ready.decision).toBe('no-effect');
  expect(ready.requiredEffects).toEqual([]);

  const hooksOnly = compileWorkspaceTransitionPlan({
    trigger,
    worktreeIdentityDigest,
    dependency: observation('ready', 'dependency'),
    hooks: observation('materialization-required', 'hooks')
  });
  expect(hooksOnly.requiredEffects).toEqual(['managed-git-hooks.materialize']);
  expect(hooksOnly.freshProcessBoundary).toBe('none');

  const both = compileWorkspaceTransitionPlan({
    trigger,
    worktreeIdentityDigest,
    dependency: observation('materialization-required', 'dependency'),
    hooks: observation('materialization-required', 'hooks')
  });
  expect(both.requiredEffects).toEqual([
    'compiler-dependency-tree.materialize',
    'managed-git-hooks.materialize'
  ]);
  expect(both.freshProcessBoundary).toBe('after-compiler-dependency-tree');

  const dependencyFirst = compileWorkspaceTransitionPlan({
    trigger,
    worktreeIdentityDigest,
    dependency: observation('materialization-required', 'dependency'),
    hooks: observation('deferred', 'hooks')
  });
  expect(dependencyFirst.requiredEffects).toEqual([
    'compiler-dependency-tree.materialize'
  ]);
  expect(dependencyFirst.freshProcessBoundary).toBe('after-compiler-dependency-tree');
});

test('an unresolved owner observation blocks the complete Effect set', () => {
  const plan = compileWorkspaceTransitionPlan({
    trigger: parseWorkspaceTransitionTrigger({
      event: 'post-merge',
      arguments: ['0'],
      currentHead: SHA1_A,
      objectIdLength: 40
    }),
    worktreeIdentityDigest: sha256('worktree') as `sha256:${string}`,
    dependency: observation('materialization-required', 'dependency'),
    hooks: observation('unresolved', 'hooks')
  });
  expect(plan.decision).toBe('blocked');
  expect(plan.requiredEffects).toEqual([]);
  expect(plan.blockers).toEqual(['managed-git-hooks']);
});
