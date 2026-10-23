import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const python = '/usr/bin/python3.12';
const pythonTests = fileURLToPath(new URL('./linux-verification-unit-helper.test.py', import.meta.url));
function helperUnavailable(native: boolean): string | undefined {
  if (process.platform !== 'linux') return 'requires Linux';
  if (!native) return;
  if (process.geteuid?.() !== 0) return 'requires root';
  try {
    if (readFileSync('/proc/1/comm', 'utf8').trim() !== 'systemd') return 'requires the real systemd manager';
  } catch { return 'cannot observe the real systemd manager'; }
}
const filesystemUnavailable = helperUnavailable(false);
const nativeUnavailable = helperUnavailable(true);
const qualification = (reason: string | undefined) => reason ? ` [NOT_VERIFIED: ${reason}]` : '';

// Only this file's Python fixture process is controlled here. unittest still
// owns discovery, selection and assertions; this is not a replacement runner.
async function runPythonFixture(args: string[], timeout: number, env: NodeJS.ProcessEnv = process.env) {
  const child = spawn(python, ['-B', '-I', '-S', pythonTests, ...args], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'], env
  });
  let stdout = '', stderr = '', bytes = 0;
  const failures: unknown[] = [];
  let stopped = false;
  let finish: (result: { code: number | null; signal: NodeJS.Signals | null }) => void;
  let reapTimer: ReturnType<typeof setTimeout> | undefined;
  function stop(reason: string) {
    if (stopped) return;
    stopped = true;
    failures.push(new Error(reason));
    // Do not signal a former leader's numeric PGID after observing its exit.
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failures.push(error); }
    }
    reapTimer = setTimeout(() => {
      failures.push(new Error('Python fixture did not close within the independent 5 s reap budget; process settlement is unverified'));
      // An escaped pipe holder must not prevent original-identity recovery.
      // Closing our read ends is not evidence that its resources are retired.
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      finish({ code: child.exitCode, signal: child.signalCode });
    }, 5_000);
  }
  function capture(stream: 'stdout' | 'stderr', data: Buffer) {
    const remaining = Math.max(0, 64 * 1024 - bytes);
    if (stream === 'stdout') stdout += data.subarray(0, remaining).toString('utf8');
    else stderr += data.subarray(0, remaining).toString('utf8');
    bytes += data.length;
    if (bytes > 64 * 1024) stop('Python fixture output exceeded 64 KiB; diagnostics are truncated');
  }
  child.stdout.on('data', (data: Buffer) => capture('stdout', data));
  child.stderr.on('data', (data: Buffer) => capture('stderr', data));
  child.on('error', error => { failures.push(error); });
  const timer = setTimeout(() => stop(`Python fixture exceeded its ${timeout - 5_000} ms work budget`), timeout - 5_000);
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    finish = resolve;
    // Normally close observes exit and pipe closure. The separate reap bound
    // reports unknown settlement instead of blocking the recovery controller.
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  clearTimeout(reapTimer);
  if (failures.length || result.code !== 0 || result.signal !== null) {
    throw new AggregateError(failures, `Python fixture ${args.join(' ')}: exit=${result.code}, signal=${result.signal}\n${stdout}\n${stderr}`);
  }
  return stderr;
}

function assertExecutedWithoutSkips(stderr: string, expectedTests?: number) {
  // unittest reports skipped suites as exit 0 / OK too. Neither proves native execution.
  expect(stderr).not.toMatch(/\bskipped\b/i);
  const count = /\bRan (\d+) tests? in\b/.exec(stderr);
  expect(count).not.toBeNull();
  expect(Number(count?.[1])).toBeGreaterThan(0);
  if (expectedTests !== undefined) expect(Number(count?.[1])).toBe(expectedTests);
}

test.skipIf(filesystemUnavailable !== undefined)('native helper filesystem contracts' + qualification(filesystemUnavailable), async () => {
  assertExecutedWithoutSkips(await runPythonFixture(['RuntimeCopyPermissions', '-v'], 20_000));
}, 25_000);

test.skipIf(nativeUnavailable !== undefined)('native namespace init reaps adopted children and preserves main status' + qualification(nativeUnavailable), async () => {
  // Two 20 s workloads, each with a separate 5 s reap budget, 5 s
  // startup/reporting, and the launcher's own 5 s reap budget.
  assertExecutedWithoutSkips(await runPythonFixture([
    'NativeRecoveryIntegration.test_namespace_init_reaps_adopted_children_and_preserves_main_status', '-v'
  ], 60_000), 1);
}, 65_000);

test.skipIf(nativeUnavailable !== undefined)('native original control and unobserved workload are recovered' + qualification(nativeUnavailable), async () => {
  const root = mkdtempSync(join(tmpdir(), 'sec-native-recovery-integration-'));
  const identity = statSync(root, { bigint: true });
  const device = String(identity.dev), inode = String(identity.ino);
  const failures: unknown[] = [];
  try {
    // 45 s work + Python's independent 30 s cleanup + 5 s child reap +
    // 5 s reporting, then the launcher's separate 5 s reap budget.
    assertExecutedWithoutSkips(await runPythonFixture([
      'NativeRecoveryIntegration.test_original_control_and_unobserved_workload_are_recovered', '-v'
    ], 90_000, { ...process.env, SEC_NATIVE_RECOVERY_FIXTURE: root,
      SEC_NATIVE_RECOVERY_FIXTURE_DEVICE: device, SEC_NATIVE_RECOVERY_FIXTURE_INODE: inode }), 1);
  } catch (error) { failures.push(error); }
  try {
    // Survives a killed test interpreter: original identities were persisted
    // before spawning resources. Only the cleanup controller may retire root.
    // 30 s cleanup + 5 s startup/reporting + 5 s launcher reap.
    await runPythonFixture(['--recover-fixture', root, device, inode], 40_000);
    try { lstatSync(root); throw new Error('Native fixture root was not retired'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, `Native recovery fixture failed; original locator: ${root}`);
}, 135_000);
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
    parseLinuxVerificationUnitResult({ receipt: rehash(receipt), stdout: '', stderr: '', outputFiles: {} }, invocation);
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
    expect(() => canonicalLinuxVerificationUnitInvocation({ ...invocation, kind: 'source-program', cwd: 'scratch' }))
      .toThrow(/\bdependency canary\b.*\bscratch cwd\b/u);
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
