import { expect, test } from 'bun:test';
import type { AuthenticatedGitHubJobOrigin } from '../../../../providers/github-api/hosted-job-origin.ts';
import {
  HostedJobRuntimeEffectError as EffectErrorFromLauncher,
  executeHostedJobSutPhase as executeFromLauncher
} from './hosted-job-runtime.ts';
import {
  createHostedJobRuntimeOperation, executeHostedJobSutPhase, HostedJobRuntimeEffectError
} from './hosted-job-sut-runtime.ts';

test('the launcher preserves the original SUT function and effect-error identities', () => {
  expect(executeFromLauncher).toBe(executeHostedJobSutPhase);
  expect(EffectErrorFromLauncher).toBe(HostedJobRuntimeEffectError);
  const failure = new HostedJobRuntimeEffectError({ originIdentityDigest: 'origin',
    operationIdentityDigest: 'operation', containerName: 'container', containerId: null,
    removalConfirmed: false }, undefined);
  expect(failure instanceof EffectErrorFromLauncher).toBe(true);
  expect(failure.retained.removalConfirmed).toBe(false);
});

test('the extracted operation owner rejects a forged origin before borrowing the Engine', () => {
  let engineObserved = false;
  const engine = {
    get providerIdentityDigest(): `sha256:${string}` { engineObserved = true; throw new Error('Engine observed'); },
    get deadlineAtUnixMs(): number { engineObserved = true; throw new Error('Engine observed'); }
  };
  expect(() => createHostedJobRuntimeOperation(engine, Object.freeze({}) as AuthenticatedGitHubJobOrigin,
    'execute-hosted-action-sut', 'setup')).toThrow();
  expect(engineObserved).toBe(false);
});
