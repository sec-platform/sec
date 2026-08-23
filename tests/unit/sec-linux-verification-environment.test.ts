import { describe, expect, test } from 'bun:test';

import {
  computeSecLinuxVerificationRunnerInputDigestV1,
  parseSecLinuxVerificationEnvironmentAuthorityV1,
  SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1
} from '../../platform/shared/sec-linux-verification-environment.ts';

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
      progressAdmission: 'buildkit-monotonic-v1'
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
});
