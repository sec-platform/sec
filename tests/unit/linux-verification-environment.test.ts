import { describe, expect, test } from 'bun:test';

import {
  computeLinuxVerificationRunnerInputDigest,
  parseLinuxVerificationEnvironmentAuthority,
  LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY,
  LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST,
  LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_PATH,
  LINUX_VERIFICATION_TRUSTED_RUNTIME_DOCKERFILE_PATH
} from '../../src/adapters/providers/linux-verification/contract.ts';

describe('SEC Linux verification environment authority', () => {
  test('governs distinct stable identities and dynamic provenance policy once', () => {
    const value = LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
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
    const value = structuredClone(LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY);
    const originalInputDigest = computeLinuxVerificationRunnerInputDigest(value);
    value.runtime.resources.sut.cpus += 1;
    const parsed = parseLinuxVerificationEnvironmentAuthority(value);
    expect(parsed.image)
      .toEqual(LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.image);
    expect(computeLinuxVerificationRunnerInputDigest(parsed)).toBe(originalInputDigest);

    const changedPackage = structuredClone(LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY);
    changedPackage.ubuntu.packages = [...changedPackage.ubuntu.packages, 'make'];
    expect(computeLinuxVerificationRunnerInputDigest(
      parseLinuxVerificationEnvironmentAuthority(changedPackage)
    )).not.toBe(originalInputDigest);
  });

  test('binds the trusted Bun generation to one executable capability', () => {
    const trustedRuntime = LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime;
    expect(trustedRuntime.bunArchiveUrl)
      .toContain(`/bun-v${trustedRuntime.bunVersion}/`);
    expect(trustedRuntime.bunExecutablePath)
      .toBe(LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_PATH);
    expect(trustedRuntime.bunExecutableDigest)
      .toBe(LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST);
    expect(trustedRuntime.bunExecutableDigest).not.toBe(trustedRuntime.bunArchiveDigest);
    expect(trustedRuntime.dockerfilePath)
      .toBe(LINUX_VERIFICATION_TRUSTED_RUNTIME_DOCKERFILE_PATH);
    expect(trustedRuntime.dockerfilePath.endsWith('/trusted-runtime.Dockerfile')).toBe(true);
    const generationImageIds = new Set([
      trustedRuntime.imageDigest,
      ...trustedRuntime.retirements.map(({ imageId }) => imageId)
    ]);
    expect(trustedRuntime.retirements.every((retirement) =>
      retirement.imageId !== trustedRuntime.imageDigest
        && retirement.imageId !== retirement.replacementImageId
        && generationImageIds.has(retirement.replacementImageId)
    )).toBe(true);
    expect(trustedRuntime.retirements.some((retirement) =>
      retirement.replacementImageId === trustedRuntime.imageDigest
    )).toBe(true);
  });

  test('rejects cross-field drift and unknown parallel owners', () => {
    const badBase = structuredClone(LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY) as unknown as Record<string, unknown>;
    (badBase.ubuntu as Record<string, unknown>).baseDigest = `sha256:${'f'.repeat(64)}`;
    expect(() => parseLinuxVerificationEnvironmentAuthority(badBase))
      .toThrow('Ubuntu base reference must bind its declared digest');

    const parallelOwner = structuredClone(LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY) as unknown as Record<string, unknown>;
    parallelOwner.imageDigest = `sha256:${'a'.repeat(64)}`;
    expect(() => parseLinuxVerificationEnvironmentAuthority(parallelOwner)).toThrow();

    const untrustedArchive = structuredClone(LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY);
    untrustedArchive.archives.node.url = untrustedArchive.archives.node.url.replace(
      'nodejs.org', 'mirror.example'
    );
    expect(() => parseLinuxVerificationEnvironmentAuthority(untrustedArchive))
      .toThrow('outside the governed trust domain');

    const unboundRetirement = structuredClone(LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY);
    unboundRetirement.trustedRuntime.retirements[0]!.replacementImageId =
      `sha256:${'e'.repeat(64)}`;
    expect(() => parseLinuxVerificationEnvironmentAuthority(unboundRetirement))
      .toThrow('retirement chain must terminate at the current immutable image');

    for (const dockerfilePath of [
      '../trusted-runtime.Dockerfile',
      '/config/verification/trusted-runtime.Dockerfile',
      'config\\verification\\trusted-runtime.Dockerfile'
    ]) {
      const escapedDockerfile = structuredClone(LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY);
      escapedDockerfile.trustedRuntime.dockerfilePath = dockerfilePath;
      expect(() => parseLinuxVerificationEnvironmentAuthority(escapedDockerfile)).toThrow();
    }
  });
});
