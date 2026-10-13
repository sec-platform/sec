import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY } from '../../../verification/platform/ci/contract/revision.ts';
import {
  canonicalLinuxVerificationUnitInvocation,
  LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST,
  LINUX_VERIFICATION_UNIT_PROFILE,
  linuxVerificationUnitInvocationDigest,
  parseLinuxVerificationUnitReceipt,
  parseLinuxVerificationUnitResult,
  type LinuxVerificationUnitInvocation
} from '../contract/linux-verification-unit.ts';
import {
  assertLinuxVerificationUnitResult,
  getLinuxVerificationUnitRecovery,
  parseLinuxVerificationUnitFailureDiagnostic,
  type LinuxVerificationUnitSession
} from './linux-verification-unit.ts';

const digest = `sha256:${'0'.repeat(64)}` as const;

test('native failure diagnostics retain complete binary stderr and reject altered or qualifying data', () => {
  const stderr = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.alloc(2048, 65)]);
  const failure = { schema: 'sec-linux-native-unit-failure-v1', qualification: 'not-issued', phase: 'dependency-prepare/preflight',
    unitName: 'sec-native-' + 'a'.repeat(32) + '.service', errorType: 'NativeFailure', message: 'original failure',
    exitCode: 23, execMainCode: 1, execMainStatus: 23, stderrBase64: stderr.toString('base64'),
    stderrBytes: stderr.length, stderrDigest: rawSha256(stderr), stderrComplete: true, cleanupFailures: [] };
  const decoded = parseLinuxVerificationUnitFailureDiagnostic(Buffer.from(JSON.stringify(failure)), stderr.length);
  expect(Buffer.from(decoded.stderrBase64, 'base64')).toEqual(stderr);
  expect(decoded.execMainStatus).toBe(23);
  for (const changed of [{ ...failure, stderrBytes: 48 }, { ...failure, stderrDigest: digest },
    { ...failure, qualification: 'issued' }, { ...failure, receipt: {} }]) {
    expect(() => parseLinuxVerificationUnitFailureDiagnostic(Buffer.from(JSON.stringify(changed)), stderr.length)).toThrow();
  }
  expect(() => parseLinuxVerificationUnitFailureDiagnostic(Buffer.from(JSON.stringify(failure)), stderr.length - 1)).toThrow();
});

test.skipIf(process.platform !== 'linux')('native runtime permissions survive caller umasks and execution phases', () => {
  const result = spawnSync('/usr/bin/python3.12', ['-B', '-I', '-S', fileURLToPath(new URL('./linux-verification-unit-helper.test.py', import.meta.url))], {
    encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toContain('OK');
  expect(result.status).toBe(0);
});
const invocation: LinuxVerificationUnitInvocation = {
  kind: 'lifecycle-canary', argv: [], cwd: 'candidate', environment: {},
  outputFiles: [], maxStdoutBytes: 64, maxStderrBytes: 64
};

/** Historical codec fixture only. It has never represented a live unit. */
function historicalReceipt() {
  const git = { baseSha: 'a'.repeat(40), baseTreeSha: 'b'.repeat(40), headSha: 'a'.repeat(40), headTreeSha: 'b'.repeat(40), status: '' };
  const body = {
    schema: 'sec-linux-native-verification-unit-receipt-v1', profileRevision: LINUX_VERIFICATION_UNIT_PROFILE.revision,
    profileDigest: LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST, operationIdentityDigest: digest,
    boundAttemptDigest: digest, providerIdentityDigest: digest, inputDigest: digest,
    invocationDigest: linuxVerificationUnitInvocationDigest(invocation), deadlineAtUnixMs: 1,
    unit: {
      name: `sec-native-${'0'.repeat(32)}.service`, invocationId: '1'.repeat(32),
      managerBootId: '00000000-0000-0000-0000-000000000000', managerStartTime: '1',
      cgroupPath: `/system.slice/sec-native-${'0'.repeat(32)}.service`, mainPid: 3, mainPidStartTime: '2',
      managerMainPid: 2, managerMainPidStartTime: '1',
      namespaceIdentities: { mount: 'mnt:[1]', pid: 'pid:[2]', network: 'net:[3]', user: 'user:[4]', ipc: 'ipc:[5]' },
      rootDevice: '1', rootInode: '2', workingDirectory: '/sec-runtime/workspace',
      workingDirectoryDevice: '1', workingDirectoryInode: '3', trustedPackageReadable: true, outputWritable: true
    },
    inputs: { runtimeManifestDigest: digest, bundleDigest: digest, dependencyContentDigest: null, sutArchiveDigest: null },
    gitBefore: git, gitAfter: git,
    execution: { exitCode: 0, stdoutDigest: rawSha256(''), stderrDigest: rawSha256(''), stdoutBytes: 0, stderrBytes: 0, outputTruncated: false },
    outputFiles: [], settlement: { unitInactive: true, cgroupEmpty: true, privateMountsRetired: true, inputsRetired: true }
  };
  return { ...body, receiptDigest: sha256(body) };
}

function rehash(value: ReturnType<typeof historicalReceipt>) {
  const { receiptDigest: _digest, ...body } = value;
  return { ...body, receiptDigest: sha256(body) };
}

describe('native verification unit data and live authority separation', () => {
  test('historical bytes decode without reviving a session, result or recovery capability', () => {
    const receipt = historicalReceipt();
    expect(parseLinuxVerificationUnitReceipt(receipt).unit.namespaceIdentities.ipc).toBe('ipc:[5]');
    const result = parseLinuxVerificationUnitResult({ receipt, stdout: '', stderr: '', outputFiles: {} }, invocation);
    const structural = { providerIdentityDigest: digest, inputDigest: digest, deadlineAtUnixMs: 1 } as unknown as LinuxVerificationUnitSession;
    expect(() => assertLinuxVerificationUnitResult(result, structural)).toThrow('not issued');
    expect(() => getLinuxVerificationUnitRecovery(structural)).toThrow('not issued');
  });

  test('original native-only profile bytes remain historical data after host-input admission', () => {
    const receipt = historicalReceipt();
    // Original profile at Git blob 0bf8987c82b91617ff3b2f3598752c57d70ef256.
    // Pin its old bytes identity instead of deriving an oracle from the new profile.
    receipt.profileDigest = 'sha256:b6f74d0a78704d71c723b79d4dca9cbce3f0b62d795c3e4d29ff981c6efc42cd' as typeof receipt.profileDigest;
    const decoded = parseLinuxVerificationUnitReceipt(rehash(receipt));
    expect(decoded.profileDigest).toBe(receipt.profileDigest);
    expect(decoded.profileDigest).not.toBe(LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST);
    const result = parseLinuxVerificationUnitResult({ receipt: rehash(receipt), stdout: '', stderr: '', outputFiles: {} }, invocation);
    expect(() => assertLinuxVerificationUnitResult(result, {} as LinuxVerificationUnitSession)).toThrow('not issued');
    receipt.profileDigest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as typeof receipt.profileDigest;
    expect(() => parseLinuxVerificationUnitReceipt(rehash(receipt))).toThrow('profile differs');
  });

  test('every terminal domain is required independently of a caller-recomputed digest', () => {
    for (const key of ['unitInactive', 'cgroupEmpty', 'privateMountsRetired', 'inputsRetired'] as const) {
      const value = historicalReceipt();
      value.settlement[key] = false;
      expect(() => parseLinuxVerificationUnitReceipt(rehash(value))).toThrow('settlement is incomplete');
    }
  });

  test('namespace prefixes, actual probes and unchanged Git subject are mandatory', () => {
    const wrongNamespace = historicalReceipt(); wrongNamespace.unit.namespaceIdentities.ipc = 'net:[5]';
    expect(() => parseLinuxVerificationUnitReceipt(rehash(wrongNamespace))).toThrow('namespace identity');
    const unreadable = historicalReceipt(); unreadable.unit.trustedPackageReadable = false;
    expect(() => parseLinuxVerificationUnitReceipt(rehash(unreadable))).toThrow('readiness');
    const changed = historicalReceipt(); changed.gitAfter = { ...changed.gitAfter, headSha: 'c'.repeat(40) };
    expect(() => parseLinuxVerificationUnitReceipt(rehash(changed))).toThrow('source changed');
    expect(() => parseLinuxVerificationUnitReceipt({ ...historicalReceipt(), callerQualified: true })).toThrow();
  });

  test('output bytes cannot be replaced by a historical receipt or truncated result', () => {
    expect(() => parseLinuxVerificationUnitResult({ receipt: historicalReceipt(), stdout: 'YQ==', stderr: '', outputFiles: {} }, invocation)).toThrow('output bytes');
    const truncated = historicalReceipt(); truncated.execution.outputTruncated = true;
    expect(() => parseLinuxVerificationUnitReceipt(rehash(truncated))).toThrow('incomplete');
  });

  test('one canonical invocation owner binds stdin and restricts privileged argv and scratch cwd', () => {
    expect(linuxVerificationUnitInvocationDigest(invocation)).toBe(linuxVerificationUnitInvocationDigest({ ...invocation, stdin: undefined }));
    expect(linuxVerificationUnitInvocationDigest({ ...invocation, stdin: new Uint8Array() })).not.toBe(linuxVerificationUnitInvocationDigest(invocation));
    expect(() => canonicalLinuxVerificationUnitInvocation({ ...invocation, kind: 'hosted-sut', cwd: 'trusted', argv: ['caller-root-code.ts'] })).toThrow('fixed entry');
    expect(() => canonicalLinuxVerificationUnitInvocation({ ...invocation, cwd: 'scratch' })).toThrow();
    expect(() => canonicalLinuxVerificationUnitInvocation({ ...invocation, environment: { NODE_PATH: '/caller' } })).toThrow('namespace');
    expect(() => canonicalLinuxVerificationUnitInvocation({ ...invocation, outputFiles: [{ path: '/sec-runtime/output/../escape', maxBytes: 1 }] })).toThrow('escapes');
  });

  test('only the existing six SUT capabilities survive the fixed trusted entry', () => {
    expect(LINUX_VERIFICATION_UNIT_PROFILE.trustedSutCapabilities).toEqual([...CI_VERIFICATION_HOSTED_SANDBOX_POLICY.outerSutContainerCapabilities]);
    expect(LINUX_VERIFICATION_UNIT_PROFILE.namespaceSetupCapabilities).toEqual(['SETGID', 'SETPCAP', 'SETUID', 'SYS_ADMIN']);
    expect(LINUX_VERIFICATION_UNIT_PROFILE.deniedPersistentKernelCalls).toEqual(['add_key', 'keyctl', 'request_key']);
    expect(LINUX_VERIFICATION_UNIT_PROFILE.systemdMinimumVersion).toBe(255);
  });
});
