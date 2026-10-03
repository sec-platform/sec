import { expect, test } from 'bun:test';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../src/adapters/providers/linux-verification/contract.ts';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import {
  assertHostedJobRuntimeReceiptBinding, createHostedJobRuntimeReceipt, hostedJobRuntimeReceiptComplete,
  parseHostedJobRuntimeReceipt, parseHostedJobRuntimeReceiptBytes, type HostedJobRuntimeReceipt
} from '../../src/adapters/verification/platform/ci/contract/hosted-job-runtime.ts';
import { assertHostedJobContainerReadback, createHostedJobContainerSpec } from '../../src/adapters/verification/platform/ci/runtime/hosted-job-container.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

const digest = `sha256:${'d'.repeat(64)}`;
const environment = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
function observation(): HostedJobRuntimeReceipt {
  // This fixture represents explicitly declared observations. Its constructor
  // is not the expected oracle or a substitute for an authenticated publisher.
  return createHostedJobRuntimeReceipt({
    origin: { repository: 'sec-platform/sec', repositoryId: '123',
      workflowPath: '.github/workflows/compiler-pr-validation.yml', workflowSha: 'a'.repeat(40),
      trustedSourceSha: 'a'.repeat(40), trustedSourceTreeSha: 'b'.repeat(40), runId: '900', runAttempt: 1,
      jobId: '902', checkRunId: '901', policyJobId: 'execute-verification-action-sut', role: 'sut',
      identityDigest: digest, workflowSourceDigest: digest, launcherSourceDigest: digest,
      originalDeadlineAtUnixMs: 1_790_004_000_000 },
    operation: { phase: 'execute-hosted-action-sut', actionKey: digest, operationIdentityDigest: digest,
      boundAttemptDigest: digest, deadlineAtUnixMs: 1_790_003_999_000 },
    materialization: { specDigest: digest, runtimeManifestDigest: environment.image.runtimeContentDigest,
      dockerProjectionDigest: environment.image.dockerProjectionDigest, provenanceArtifactDigest: digest,
      executionImageDigest: environment.trustedRuntime.imageDigest,
      bunExecutableDigest: environment.trustedRuntime.bunExecutableDigest,
      engineProviderIdentityDigest: digest, ociExporterIdentityDigest: digest },
    container: { id: 'c'.repeat(64), name: 'sec-hosted-job-902-fixture', ownershipDigest: digest,
      creationReadbackDigest: digest, startedReadbackDigest: digest, terminalReadbackDigest: digest },
    execution: { started: true, settled: true, startedAtUnixMs: 1_790_000_000_000, settledAtUnixMs: 1_790_000_001_000, exitCode: 0, stdoutBytes: 123, stderrBytes: 0,
      outputDigest: digest, outputTruncated: false, sandboxObservationDigest: digest },
    cleanup: { containerAbsent: true, providerScopeSettled: true, outputSettled: true, ownedSourcesReleased: true }
  });
}
function rehash(value: object): unknown {
  const { receiptDigest: _discarded, ...content } = value as HostedJobRuntimeReceipt;
  return { ...content, receiptDigest: sha256(content) };
}

test('complete observations are data, with explicit own-job and independent materialization comparison', () => {
  const receipt = observation();
  expect(hostedJobRuntimeReceiptComplete(receipt)).toBe(true);
  assertHostedJobRuntimeReceiptBinding(receipt, { origin: receipt.origin, phase: 'execute-hosted-action-sut',
    actionKey: digest, executionImageDigest: environment.trustedRuntime.imageDigest, ociExporterIdentityDigest: digest });
  for (const changed of [{ runId: '999' }, { runAttempt: 2 }, { jobId: '999' }, { checkRunId: '999' },
    { workflowSha: 'f'.repeat(40) }, { role: 'trusted' as const }]) {
    expect(() => assertHostedJobRuntimeReceiptBinding(receipt, { origin: { ...receipt.origin, ...changed },
      phase: 'execute-hosted-action-sut', actionKey: digest,
      executionImageDigest: environment.trustedRuntime.imageDigest, ociExporterIdentityDigest: digest })).toThrow();
  }
});

test('self-rehashing cannot relabel legacy evidence or replace required immutable runtime bytes', () => {
  const receipt = observation();
  expect(() => parseHostedJobRuntimeReceipt(rehash({ ...receipt, providerRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION }))).toThrow();
  for (const key of ['runtimeManifestDigest', 'dockerProjectionDigest', 'executionImageDigest', 'bunExecutableDigest'] as const) {
    expect(() => parseHostedJobRuntimeReceipt(rehash({ ...receipt,
      materialization: { ...receipt.materialization, [key]: `sha256:${'f'.repeat(64)}` } }))).toThrow();
  }
  expect(() => parseHostedJobRuntimeReceipt(rehash({ ...receipt, materialization: null }))).toThrow();
});

test('role, source, phase and original deadline remain closed even for canonically hashed receipts', () => {
  const receipt = observation();
  expect(() => parseHostedJobRuntimeReceipt(rehash({ ...receipt, origin: { ...receipt.origin, role: 'trusted' } }))).toThrow();
  expect(() => parseHostedJobRuntimeReceipt(rehash({ ...receipt, origin: { ...receipt.origin, trustedSourceSha: 'f'.repeat(40) } }))).toThrow();
  expect(() => parseHostedJobRuntimeReceipt(rehash({ ...receipt, operation: { ...receipt.operation, phase: 'arbitrary-command' } }))).toThrow();
  expect(() => parseHostedJobRuntimeReceipt(rehash({ ...receipt,
    operation: { ...receipt.operation, deadlineAtUnixMs: receipt.origin.originalDeadlineAtUnixMs + 1 } }))).toThrow();
});

test('unknown process state, other-job preflight, overflow or incomplete cleanup never becomes complete observation', () => {
  const receipt = observation();
  for (const changed of [{ started: false }, { settled: false }, { exitCode: null },
    { startedAtUnixMs: null, settledAtUnixMs: null }, { settledAtUnixMs: null },
    { outputTruncated: true }, { stdoutBytes: 8 * 1024 * 1024 + 1 },
    { stderrBytes: 8 * 1024 * 1024 + 1 }, { sandboxObservationDigest: null }]) {
    const parsed = parseHostedJobRuntimeReceipt(rehash({ ...receipt, execution: { ...receipt.execution, ...changed } }));
    expect(hostedJobRuntimeReceiptComplete(parsed)).toBe(false);
  }
  for (const key of ['containerAbsent', 'providerScopeSettled', 'outputSettled', 'ownedSourcesReleased'] as const) {
    const parsed = parseHostedJobRuntimeReceipt(rehash({ ...receipt, cleanup: { ...receipt.cleanup, [key]: false } }));
    expect(hostedJobRuntimeReceiptComplete(parsed)).toBe(false);
  }
  const missingReadback = parseHostedJobRuntimeReceipt(rehash({ ...receipt,
    container: { ...receipt.container, terminalReadbackDigest: null } }));
  expect(hostedJobRuntimeReceiptComplete(missingReadback)).toBe(false);
});

test('receipt transport rejects duplicate keys, extensions, malformed IDs and forged digest', () => {
  const receipt = observation();
  const source = JSON.stringify(receipt).replace('"runId":"900"', '"runId":"900","runId":"900"');
  expect(() => parseHostedJobRuntimeReceiptBytes(Buffer.from(source))).toThrow();
  expect(() => parseHostedJobRuntimeReceipt(rehash({ ...receipt, callerAuthority: true }))).toThrow();
  expect(() => parseHostedJobRuntimeReceipt(rehash({ ...receipt, container: { ...receipt.container, id: 'mutable-name' } }))).toThrow();
  expect(() => parseHostedJobRuntimeReceipt({ ...receipt, receiptDigest: `sha256:${'0'.repeat(64)}` })).toThrow();
});

function containerFixture() {
  const id = 'a'.repeat(64);
  const labels = { 'sec.hosted-job.operation': digest, 'sec.hosted-job.role': 'sut' };
  const spec = createHostedJobContainerSpec({ name: 'sec-hosted-901-test', role: 'sut', labels,
    appArmorProfile: `sec-sut-${'e'.repeat(32)}`,
    sourceRoot: '/trusted-checkout', inputs: [{ source: '/private-input/resolution.json', target: '/sec-input/resolution.json' }] });
  // Independent Docker wire shape for the frozen outer-SUT requirements.
  const value = { Id: id, Name: '/sec-hosted-901-test', Image: environment.trustedRuntime.imageDigest,
    AppArmorProfile: `sec-sut-${'e'.repeat(32)}`,
    Config: { User: '0:0', WorkingDir: '/workspace', Entrypoint: ['/bin/sleep'], Cmd: ['infinity'],
      Labels: labels, Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'LANG=C.UTF-8'] },
    HostConfig: { RestartPolicy: { Name: 'no', MaximumRetryCount: 0 }, Privileged: false, ReadonlyRootfs: true, Init: true,
      CapDrop: ['ALL'], CapAdd: ['CAP_CHOWN', 'CAP_SETGID', 'CAP_SETPCAP', 'CAP_SETUID', 'CAP_SYS_ADMIN', 'CAP_SYS_CHROOT'],
      SecurityOpt: ['no-new-privileges:true', `apparmor=sec-sut-${'e'.repeat(32)}`], PidsLimit: 256, Memory: 4_294_967_296, NanoCpus: 2_000_000_000,
      NetworkMode: 'none', IpcMode: 'private', PidMode: '', CgroupnsMode: 'private', Binds: null,
      PortBindings: {}, Devices: [], DeviceRequests: null,
      Tmpfs: { '/workspace': 'rw,exec,nosuid,nodev,mode=1777', '/tmp': 'rw,exec,nosuid,nodev,mode=1777' } },
    State: { Running: true, ExitCode: 0 }, ExecIDs: null,
    Mounts: [{ Type: 'bind', Source: '/trusted-checkout', Destination: '/sec-trusted', RW: false, Propagation: 'rprivate' },
      { Type: 'bind', Source: '/private-input/resolution.json', Destination: '/sec-input/resolution.json', RW: false, Propagation: 'rprivate' }] };
  return { id, spec, value };
}

test('outer SUT creation selects exact old resource/capability boundary without listener or registration', () => {
  const fixture = containerFixture();
  const argv = fixture.spec.arguments;
  expect(argv.slice(argv.indexOf('--memory'), argv.indexOf('--memory') + 2)).toEqual(['--memory', '4g']);
  expect(argv.slice(argv.indexOf('--network'), argv.indexOf('--network') + 2)).toEqual(['--network', 'none']);
  expect(argv.slice(argv.indexOf('--restart'), argv.indexOf('--restart') + 2)).toEqual(['--restart', 'no']);
  expect(argv.filter(value => value === '--cap-add')).toHaveLength(6);
  expect(argv.join(' ')).not.toContain('docker.sock');
  expect(argv.join(' ')).not.toContain('Runner.Listener');
  expect(argv.join(' ')).not.toContain('TOKEN');
  expect(assertHostedJobContainerReadback({ source: Buffer.from(JSON.stringify([fixture.value])),
    spec: fixture.spec, containerId: fixture.id }).running).toBe(true);
});

test('outer boundary readback rejects foreign IDs, writable/extra/duplicate mounts, privilege and host namespaces', () => {
  const fixture = containerFixture();
  const read = (value: unknown) => assertHostedJobContainerReadback({ source: Buffer.from(JSON.stringify([value])),
    spec: fixture.spec, containerId: fixture.id });
  expect(() => read({ ...fixture.value, Id: 'f'.repeat(64) })).toThrow();
  expect(() => read({ ...fixture.value, AppArmorProfile: 'docker-default' })).toThrow();
  expect(() => read({ ...fixture.value, AppArmorProfile: 'unconfined' })).toThrow();
  expect(() => read({ ...fixture.value, Image: `sha256:${'f'.repeat(64)}` })).toThrow();
  expect(() => read({ ...fixture.value, Config: { ...fixture.value.Config,
    Labels: { ...fixture.value.Config.Labels, 'sec.hosted-job.operation': `sha256:${'f'.repeat(64)}` } } })).toThrow();
  for (const patch of [{ Privileged: true }, { ReadonlyRootfs: false }, { Init: false },
    { NetworkMode: 'host' }, { PidMode: 'host' }, { IpcMode: 'host' }, { CgroupnsMode: 'host' },
    { Memory: 8_589_934_592 }, { PidsLimit: 512 }, { NanoCpus: 4_000_000_000 }, { Devices: 'unknown' },
    { CapAdd: ['ALL'] }, { SecurityOpt: [] }, { RestartPolicy: { Name: 'always', MaximumRetryCount: 0 } }]) {
    expect(() => read({ ...fixture.value, HostConfig: { ...fixture.value.HostConfig, ...patch } })).toThrow();
  }
  expect(() => read({ ...fixture.value, Mounts: [{ ...fixture.value.Mounts[0], RW: true }, fixture.value.Mounts[1]] })).toThrow();
  expect(() => read({ ...fixture.value, Mounts: [fixture.value.Mounts[0], fixture.value.Mounts[0]] })).toThrow();
  expect(() => read({ ...fixture.value, Mounts: [...fixture.value.Mounts,
    { Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker.sock', RW: false, Propagation: 'rprivate' }] })).toThrow();
  for (const name of ['GH_TOKEN', 'GITHUB_OUTPUT', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']) {
    expect(() => read({ ...fixture.value, Config: { ...fixture.value.Config, Env: [`${name}=forged`] } })).toThrow();
  }
});
