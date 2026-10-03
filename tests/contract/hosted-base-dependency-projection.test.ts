import { expect, test } from 'bun:test';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION, CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { CodexDevelopmentHostedActionDependencySourceRoot } from '../../src/adapters/verification/platform/ci/verification-materialization.ts';

test('new per-job archive projects the trusted base dependency root while legacy keeps its old root', () => {
  const roots = { baseRoot: '/trusted/exact-base', candidateRoot: '/private/candidate-data' };
  expect(CodexDevelopmentHostedActionDependencySourceRoot({ ...roots,
    executionEnvironmentRevision: CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION })).toBe('/trusted/exact-base/node_modules');
  expect(CodexDevelopmentHostedActionDependencySourceRoot({ ...roots,
    executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION })).toBe('/private/candidate-data/node_modules');
});

test('unknown profiles and noncanonical source roots cannot select a dependency location', () => {
  for (const executionEnvironmentRevision of ['github-hosted-per-job-v1', 'caller-runtime', `${CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION}-other`]) {
    expect(() => CodexDevelopmentHostedActionDependencySourceRoot({ executionEnvironmentRevision,
      baseRoot: '/trusted/base', candidateRoot: '/candidate' })).toThrow();
  }
  for (const baseRoot of ['relative', '/trusted/../other', '/trusted/base/']) {
    expect(() => CodexDevelopmentHostedActionDependencySourceRoot({ baseRoot, candidateRoot: '/candidate',
      executionEnvironmentRevision: CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION })).toThrow();
  }
});
