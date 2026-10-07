import { describe, expect, test } from 'bun:test';

import {
  computeSecLinuxVerificationRunnerInputDigest,
  parseSecLinuxVerificationEnvironmentAuthority,
  parseSecLinuxVerificationNativeRuntimeManifest,
  SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY,
  SEC_LINUX_VERIFICATION_NATIVE_PROFILE,
  SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST,
  SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_PATH,
  SEC_LINUX_VERIFICATION_TRUSTED_RUNTIME_DOCKERFILE_PATH,
  type SecLinuxVerificationNativeRuntimeManifest
} from '../../src/adapters/providers/linux-verification/contract.ts';

import {
  observeSecLinuxVerificationNativeRuntimeInput,
  requireSecLinuxVerificationNativeRuntimeInput,
  resolveSecLinuxVerificationNativeRuntimeInput,
  type SecLinuxVerificationNativeRuntimeInput
} from '../../src/adapters/providers/linux-verification/materialization.ts';

describe('SEC Linux verification environment authority', () => {
  test('governs distinct stable identities and dynamic provenance policy once', () => {
    const value = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
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
    const value = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY);
    const originalInputDigest = computeSecLinuxVerificationRunnerInputDigest(value);
    value.runtime.resources.sut.cpus += 1;
    const parsed = parseSecLinuxVerificationEnvironmentAuthority(value);
    expect(parsed.image)
      .toEqual(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.image);
    expect(computeSecLinuxVerificationRunnerInputDigest(parsed)).toBe(originalInputDigest);

    const changedPackage = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY);
    changedPackage.ubuntu.packages = [...changedPackage.ubuntu.packages, 'make'];
    expect(computeSecLinuxVerificationRunnerInputDigest(
      parseSecLinuxVerificationEnvironmentAuthority(changedPackage)
    )).not.toBe(originalInputDigest);
  });

  test('binds the trusted Bun generation to one executable capability', () => {
    const trustedRuntime = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime;
    expect(trustedRuntime.bunArchiveUrl)
      .toContain(`/bun-v${trustedRuntime.bunVersion}/`);
    expect(trustedRuntime.bunExecutablePath)
      .toBe(SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_PATH);
    expect(trustedRuntime.bunExecutableDigest)
      .toBe(SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST);
    expect(trustedRuntime.bunExecutableDigest).not.toBe(trustedRuntime.bunArchiveDigest);
    expect(trustedRuntime.dockerfilePath)
      .toBe(SEC_LINUX_VERIFICATION_TRUSTED_RUNTIME_DOCKERFILE_PATH);
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
    const badBase = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY) as unknown as Record<string, unknown>;
    (badBase.ubuntu as Record<string, unknown>).baseDigest = `sha256:${'f'.repeat(64)}`;
    expect(() => parseSecLinuxVerificationEnvironmentAuthority(badBase))
      .toThrow('Ubuntu base reference must bind its declared digest');

    const parallelOwner = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY) as unknown as Record<string, unknown>;
    parallelOwner.imageDigest = `sha256:${'a'.repeat(64)}`;
    expect(() => parseSecLinuxVerificationEnvironmentAuthority(parallelOwner)).toThrow();

    const untrustedArchive = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY);
    untrustedArchive.archives.node.url = untrustedArchive.archives.node.url.replace(
      'nodejs.org', 'mirror.example'
    );
    expect(() => parseSecLinuxVerificationEnvironmentAuthority(untrustedArchive))
      .toThrow('outside the governed trust domain');

    const unboundRetirement = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY);
    unboundRetirement.trustedRuntime.retirements[0]!.replacementImageId =
      `sha256:${'e'.repeat(64)}`;
    expect(() => parseSecLinuxVerificationEnvironmentAuthority(unboundRetirement))
      .toThrow('retirement chain must terminate at the current immutable image');

    for (const dockerfilePath of [
      '../trusted-runtime.Dockerfile',
      '/config/verification/trusted-runtime.Dockerfile',
      'config\\verification\\trusted-runtime.Dockerfile'
    ]) {
      const escapedDockerfile = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY);
      escapedDockerfile.trustedRuntime.dockerfilePath = dockerfilePath;
      expect(() => parseSecLinuxVerificationEnvironmentAuthority(escapedDockerfile)).toThrow();
    }
  });
});


// Synthetic structural vectors are never accepted content or physical qualification.
function nativeManifestVector(): SecLinuxVerificationNativeRuntimeManifest {
  const trusted = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime;
  return {
    schema: 'sec-linux-verification-native-runtime-manifest-v1',
    platform: 'linux/amd64',
    sources: [{ id: 'bun', kind: 'archive', url: trusted.bunArchiveUrl,
      digest: trusted.bunArchiveDigest, version: trusted.bunVersion }],
    files: [
      { path: 'bin', type: 'directory', mode: 0o755 },
      { path: 'bin/sh', type: 'symlink', mode: 0o777, target: '../usr/bin/env', sourceId: 'bun' },
      { path: 'usr', type: 'directory', mode: 0o755 },
      { path: 'usr/bin', type: 'directory', mode: 0o755 },
      ...['env', 'git', 'python3', 'setpriv', 'unshare'].map((name) => ({
        path: `usr/bin/${name}`, type: 'file' as const, mode: 0o755,
        size: 1, digest: `sha256:${'a'.repeat(64)}` as const, sourceId: 'bun'
      })),
      { path: 'usr/local', type: 'directory', mode: 0o755 },
      { path: 'usr/local/bin', type: 'directory', mode: 0o755 },
      { path: 'usr/local/bin/bun', type: 'file', mode: 0o755, size: 1,
        digest: trusted.bunExecutableDigest, sourceId: 'bun' }
    ]
  };
}

describe('native runtime content admission', () => {
  test('parses a bounded content description without granting runtime authority', () => {
    const vector = nativeManifestVector();
    const parsed = parseSecLinuxVerificationNativeRuntimeManifest(vector);
    expect(parsed).toEqual(vector);
    expect(() => requireSecLinuxVerificationNativeRuntimeInput({
      rootPath: '/synthetic', platform: 'linux/amd64', manifest: parsed,
      manifestDigest: `sha256:${'a'.repeat(64)}`
    } as SecLinuxVerificationNativeRuntimeInput)).toThrow('original materialization owner');
  });

  test('rejects path aliases, missing parents, escaping links and duplicate paths', () => {
    for (const invalidPath of ['../bin', '/bin', 'a/../bin', 'a\\bin']) {
      const vector = nativeManifestVector();
      vector.files[0]!.path = invalidPath;
      expect(() => parseSecLinuxVerificationNativeRuntimeManifest(vector)).toThrow();
    }
    for (const target of ['../../outside', '/outside', '../missing', 'sh']) {
      const vector = nativeManifestVector();
      (vector.files[1] as { target: string }).target = target;
      expect(() => parseSecLinuxVerificationNativeRuntimeManifest(vector)).toThrow();
    }
    const duplicate = nativeManifestVector();
    duplicate.files.push(duplicate.files[0]!);
    expect(() => parseSecLinuxVerificationNativeRuntimeManifest(duplicate)).toThrow('unique');
    const missingParent = nativeManifestVector();
    missingParent.files = missingParent.files.filter(({ path }) => path !== 'usr/local');
    expect(() => parseSecLinuxVerificationNativeRuntimeManifest(missingParent)).toThrow('parents');
  });

  test('rejects privilege modes, missing sources, invalid hashes and unbounded bytes', () => {
    for (const mode of [0o4755, 0o777]) {
      const vector = nativeManifestVector();
      vector.files[4]!.mode = mode;
      expect(() => parseSecLinuxVerificationNativeRuntimeManifest(vector)).toThrow();
    }
    for (const change of [
      { sourceId: 'absent' }, { size: -1 }, { size: Number.MAX_SAFE_INTEGER }, { digest: 'sha256:bad' }
    ]) {
      const vector = nativeManifestVector();
      Object.assign(vector.files[4]!, change);
      expect(() => parseSecLinuxVerificationNativeRuntimeManifest(vector)).toThrow();
    }
    const changedBun = nativeManifestVector();
    Object.assign(changedBun.files.at(-1)!, { digest: `sha256:${'b'.repeat(64)}` });
    expect(() => parseSecLinuxVerificationNativeRuntimeManifest(changedBun)).toThrow('accepted Bun');
    const missingPython = nativeManifestVector();
    missingPython.files = missingPython.files.filter(({ path }) => path !== 'usr/bin/python3');
    expect(() => parseSecLinuxVerificationNativeRuntimeManifest(missingPython)).toThrow('target is missing');
    const unknownSource = nativeManifestVector();
    unknownSource.sources[0]!.url = 'https://example.com/runtime.zip';
    expect(() => parseSecLinuxVerificationNativeRuntimeManifest(unknownSource)).toThrow('original accepted source');
  });

  test('admits the physical snapshot byte boundary and rejects one excess byte', () => {
    const limit = 4 * 1024 * 1024 * 1024;
    const atBoundary = nativeManifestVector();
    const files = atBoundary.files.filter((entry) => entry.type === 'file');
    files[0]!.size = limit - (files.length - 1);
    expect(() => parseSecLinuxVerificationNativeRuntimeManifest(atBoundary)).not.toThrow();
    files[0]!.size += 1;
    expect(() => parseSecLinuxVerificationNativeRuntimeManifest(atBoundary))
      .toThrow('verification-unit content byte bound');
  });

  test('requires the executable namespace launcher inside the runtime root', () => {
    for (const executable of ['usr/bin/unshare', 'usr/bin/setpriv']) {
      const missing = nativeManifestVector();
      missing.files = missing.files.filter(({ path }) => path !== executable);
      expect(() => parseSecLinuxVerificationNativeRuntimeManifest(missing)).toThrow('target is missing');
      const notExecutable = nativeManifestVector();
      notExecutable.files.find(({ path }) => path === executable)!.mode = 0o644;
      expect(() => parseSecLinuxVerificationNativeRuntimeManifest(notExecutable))
        .toThrow(`executable is missing: ${executable}`);
    }
  });

  test('keeps private mount roots out of runtime content without rejecting nested names', () => {
    for (const root of ['sec-runtime', 'authenticated-input', 'tmp', 'proc', 'dev', 'sys']) {
      const vector = nativeManifestVector();
      vector.files.push({ path: root, type: 'directory', mode: 0o755 });
      vector.files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
      expect(() => parseSecLinuxVerificationNativeRuntimeManifest(vector)).toThrow('reserved verification-unit root');
    }
    for (const allowedPath of ['usr/tmp', 'tmp-assets']) {
      const nested = nativeManifestVector();
      nested.files.push({ path: allowedPath, type: 'directory', mode: 0o755 });
      nested.files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
      expect(() => parseSecLinuxVerificationNativeRuntimeManifest(nested)).not.toThrow();
    }
  });

  test('preserves the native input blocker before looking at transport paths', () => {
    expect(SEC_LINUX_VERIFICATION_NATIVE_PROFILE.acceptedContent.status).toBe('unresolved');
    expect(() => resolveSecLinuxVerificationNativeRuntimeInput({ rootPath: '/absent', manifest: {} }))
      .toThrow('Exact native Ubuntu package closure');
    expect(() => observeSecLinuxVerificationNativeRuntimeInput({ repositoryRoot: '/absent' }))
      .toThrow('Exact native Ubuntu package closure');
    const relabeled = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY);
    relabeled.nativeRuntime.acceptedContent = {
      status: 'accepted', manifestDigest: relabeled.image.runtimeContentDigest
    };
    expect(() => parseSecLinuxVerificationEnvironmentAuthority(relabeled)).toThrow('cannot relabel');
    const value = structuredClone(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY);
    const original = computeSecLinuxVerificationRunnerInputDigest(value);
    value.nativeRuntime.acceptedContent = { status: 'unresolved', reason: 'A different unresolved observation.' };
    expect(computeSecLinuxVerificationRunnerInputDigest(parseSecLinuxVerificationEnvironmentAuthority(value)))
      .toBe(original);
  });
});
