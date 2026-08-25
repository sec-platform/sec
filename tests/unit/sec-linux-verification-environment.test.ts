import { describe, expect, test } from 'bun:test';

import {
  computeSecLinuxVerificationRunnerInputDigestV1,
  parseSecLinuxVerificationEnvironmentAuthorityV1,
  SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1
} from '../../platform/runtime/environments/sec-linux-verification-v1/authority.ts';

describe('SEC Linux verification environment authority', () => {
  test('governs distinct stable identities and dynamic provenance policy once', () => {
    const value = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1;
    expect(value.image.runtimeContentDigest).not.toBe(value.image.dockerProjectionDigest);
    expect(value.provenance).toEqual({
      materializationMode: 'max',
      dockerProjectionMode: 'disabled',
      receiptSchema: 'sec-environment-oci-cache-receipt-v2'
    });
    expect(value.provider).toMatchObject({
      progressMode: 'rawjson',
      progressAdmission: 'buildkit-monotonic-v1',
      buildx: {
        builderName: 'sec-linux-verification-buildx-v1',
        nodeName: 'sec-linux-verification-buildx-node-v1',
        driver: 'docker-container',
        buildkitImage: 'moby/buildkit@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8',
        buildkitImageId: 'sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8',
        cacheNamespace: 'sec-linux-verification-buildx-cache-v1',
        allowNetworkHost: true,
        gcPolicy: 'provider-native-content-addressed-v1',
        keepStorageMegabytes: 21_475,
        gcSweepTimeoutMs: 120_000
      }
    });
    expect(value.image.retirements[0]).toMatchObject({
      imageId: 'sha256:418e9f00110157ff610061685f9175a1af6966baa77e6d153eb43bd49893f63f',
      replacementImageId: value.image.dockerProjectionDigest
    });
  });

  test('keeps independently invalidated runtime resources outside image identities', () => {
    const value = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1);
    const originalInputDigest = computeSecLinuxVerificationRunnerInputDigestV1(value);
    value.runtime.resources.sut.cpus += 1;
    const parsed = parseSecLinuxVerificationEnvironmentAuthorityV1(value);
    expect(parsed.image)
      .toEqual(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1.image);
    expect(computeSecLinuxVerificationRunnerInputDigestV1(parsed)).toBe(originalInputDigest);

    const changedPackage = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1);
    changedPackage.ubuntu.packages = [...changedPackage.ubuntu.packages, 'make'];
    expect(computeSecLinuxVerificationRunnerInputDigestV1(
      parseSecLinuxVerificationEnvironmentAuthorityV1(changedPackage)
    )).not.toBe(originalInputDigest);
  });

  test('rejects cross-field drift and unknown parallel owners', () => {
    const badBase = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1) as unknown as Record<string, unknown>;
    (badBase.ubuntu as Record<string, unknown>).baseDigest = `sha256:${'f'.repeat(64)}`;
    expect(() => parseSecLinuxVerificationEnvironmentAuthorityV1(badBase))
      .toThrow('Ubuntu base reference must bind its declared digest');

    const parallelOwner = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1) as unknown as Record<string, unknown>;
    parallelOwner.imageDigest = `sha256:${'a'.repeat(64)}`;
    expect(() => parseSecLinuxVerificationEnvironmentAuthorityV1(parallelOwner)).toThrow();

    const untrustedArchive = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1);
    untrustedArchive.archives.node.url = untrustedArchive.archives.node.url.replace(
      'nodejs.org', 'mirror.example'
    );
    expect(() => parseSecLinuxVerificationEnvironmentAuthorityV1(untrustedArchive))
      .toThrow('outside the governed trust domain');
  });

  test('binds the runner input digest to the provider-owned Buildx boundary', () => {
    const baseline = computeSecLinuxVerificationRunnerInputDigestV1(
      SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1
    );
    const changed = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1);
    changed.provider.buildx.builderName = 'another-builder';
    expect(computeSecLinuxVerificationRunnerInputDigestV1(
      parseSecLinuxVerificationEnvironmentAuthorityV1(changed)
    )).not.toBe(baseline);

    for (const mutate of [
      (authority: typeof changed) => { authority.provider.buildx.nodeName = 'another-node'; },
      (authority: typeof changed) => {
        authority.provider.buildx.buildkitImage =
          `moby/buildkit@sha256:${'a'.repeat(64)}`;
        authority.provider.buildx.buildkitImageId = `sha256:${'a'.repeat(64)}`;
      }
    ]) {
      const drifted = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1);
      mutate(drifted);
      expect(computeSecLinuxVerificationRunnerInputDigestV1(
        parseSecLinuxVerificationEnvironmentAuthorityV1(drifted)
      )).not.toBe(baseline);
    }

    const invalidBudget = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1);
    invalidBudget.provider.buildx.keepStorageMegabytes += 1;
    expect(() => parseSecLinuxVerificationEnvironmentAuthorityV1(invalidBudget))
      .toThrow('expected 21475');
    const invalidNetworkHost = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1);
    invalidNetworkHost.provider.buildx.allowNetworkHost = false as never;
    expect(() => parseSecLinuxVerificationEnvironmentAuthorityV1(invalidNetworkHost))
      .toThrow();
  });
});
