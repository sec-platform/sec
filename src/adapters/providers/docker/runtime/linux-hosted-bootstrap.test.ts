import { expect, test } from 'bun:test';
import {
  applyAuthenticatedLinuxHostedBootstrap, assertAuthenticatedLinuxHostedBootstrapCurrent,
  observeAuthenticatedLinuxHostedBootstrap, prepareAuthenticatedLinuxHostedBootstrap,
  retireAuthenticatedLinuxHostedBootstrap
} from './linux-hosted-bootstrap.ts';

test('caller origin/receipt data cannot acquire bootstrap or invoke caller effects', async () => {
  let calls = 0;
  const forged = { get providerIdentityDigest() { calls++; throw new Error('caller'); }, assertCurrent() { calls++; } } as never;
  expect(() => prepareAuthenticatedLinuxHostedBootstrap({ origin: forged, deadlineAtUnixMs: Date.now()+1000, sandboxRoots: [] })).toThrow();
  expect(() => observeAuthenticatedLinuxHostedBootstrap(forged)).toThrow('not owner-issued');
  await expect(applyAuthenticatedLinuxHostedBootstrap(forged, { operation: {} as never, requirementId: 'hosted-job.linux-bootstrap' })).rejects.toThrow('not owner-issued');
  await expect(assertAuthenticatedLinuxHostedBootstrapCurrent(forged)).rejects.toThrow('not owner-issued');
  await expect(retireAuthenticatedLinuxHostedBootstrap(forged)).rejects.toThrow('not owner-issued');
  expect(calls).toBe(0);
});
