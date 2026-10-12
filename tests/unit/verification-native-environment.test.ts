import { describe, expect, test } from 'bun:test';

import {
  CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT,
  CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENTS,
  CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT,
  createCiVerificationLocalExecutionEnvironment,
  createCiVerificationNativeHostedExecutionEnvironment,
  createCiVerificationNativeLocalExecutionEnvironment,
  parseCiVerificationHostedExecutionEnvironment,
  resolveCiVerificationHostedExecutionEnvironment
} from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { createCiVerificationNativeProviderRevision } from '../../src/adapters/verification/platform/action/contract/environment.ts';

describe('native verification environment acceptance', () => {
  test('unresolved native content cannot acquire a local or hosted identity', () => {
    // The checked-in native content is deliberately unresolved. Source support
    // and a syntactically valid digest are not accepted runtime bytes.
    expect(createCiVerificationNativeProviderRevision('local')).toBeNull();
    expect(createCiVerificationNativeProviderRevision('hosted')).toBeNull();
    expect(() => createCiVerificationNativeLocalExecutionEnvironment())
      .toThrow('native execution environment content is unresolved');
    expect(() => createCiVerificationNativeHostedExecutionEnvironment())
      .toThrow('native execution environment content is unresolved');
    expect(CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENTS).toEqual([
      CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT,
      CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT
    ]);
  });

  test('historical profiles retain one unambiguous parser and reconstruction domain', () => {
    const revisions = CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENTS.map(
      (value) => value.executionEnvironmentRevision
    );
    expect(new Set(revisions).size).toBe(revisions.length);
    for (const environment of [
      CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT,
      CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT
    ]) {
      expect(resolveCiVerificationHostedExecutionEnvironment(environment.executionEnvironmentRevision))
        .toBe(environment);
      expect(parseCiVerificationHostedExecutionEnvironment(structuredClone(environment)))
        .toBe(environment);
    }
  });

  test('unknown native identities and mixed profiles fail closed', () => {
    const historical = CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT;
    for (const candidate of [
      { ...historical, executionEnvironmentRevision:
        `github-actions:github-hosted:linux:x64:native-verification-unit-v1:execution-policy-sha256:${'a'.repeat(64)}` },
      { ...historical, runnerImage: null },
      { ...historical, toolchainRevision: 'bun@0.0.0' },
      { ...historical, nativeRuntimeManifestDigest: `sha256:${'b'.repeat(64)}` }
    ]) {
      expect(() => parseCiVerificationHostedExecutionEnvironment(candidate))
        .toThrow(/hosted execution environment/);
    }
    expect(() => resolveCiVerificationHostedExecutionEnvironment('sec-linux-native-verification-unit-v1'))
      .toThrow(/hosted execution environment/);
  });

  test('historical local identity remains data-only while native acceptance is unresolved', () => {
    expect(createCiVerificationLocalExecutionEnvironment({
      os: 'linux', arch: 'x64', bunVersion: '1.4.0'
    })).toEqual({
      contractRevision: 'sec-ci-verification-action-environment-v2',
      kind: 'local', os: 'linux', arch: 'x64', runnerImage: null,
      toolchainRevision: 'bun@1.4.0',
      executionEnvironmentRevision: 'local-dev-runner:linux:x64:bun-1.4.0:action-producer-v2'
    });
  });
});
