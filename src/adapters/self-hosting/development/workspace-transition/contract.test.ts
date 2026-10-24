import { expect, test } from 'bun:test';

import {
  WorkspaceTransitionContractError
} from './contract.ts';
import { parseWorkspaceTransitionTrigger } from './trigger.ts';

const SHA1_A = '1'.repeat(40);
const SHA1_B = '2'.repeat(40);
const SHA256_A = 'a'.repeat(64);
const SHA256_B = 'b'.repeat(64);

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
