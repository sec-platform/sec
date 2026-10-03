import { canonicalEquals, sha256 } from '../../../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../../../contracts/exact-json.ts';
import { CI_HOSTED_JOB_RUNTIME_POLICY } from '../contract/hosted-job-runtime-policy.ts';

export interface HostedJobContainerSpec {
  readonly name: string;
  readonly role: 'control' | 'trusted' | 'sut';
  readonly labels: Readonly<Record<string, string>>;
  readonly sourceRoot: string;
  readonly inputs: readonly Readonly<{ source: string; target: string }>[];
  readonly appArmorProfile: string | null;
  readonly arguments: readonly string[];
}

/** Pure effect plan. It neither issues an Engine nor authenticates its paths. */
export function createHostedJobContainerSpec(input: Readonly<{
  name: string;
  role: HostedJobContainerSpec['role'];
  labels: Readonly<Record<string, string>>;
  sourceRoot: string;
  inputs: readonly Readonly<{ source: string; target: string }>[];
  appArmorProfile: string | null;
}>): HostedJobContainerSpec {
  if (!/^sec-hosted-[a-z0-9-]{1,110}$/u.test(input.name)
      || !input.sourceRoot.startsWith('/') || /[,\n\r\0]/u.test(input.sourceRoot)
      || (input.role === 'sut' ? typeof input.appArmorProfile !== 'string'
        || !/^sec-sut-[0-9a-f]{32}$/u.test(input.appArmorProfile) : input.appArmorProfile !== null)
      || input.inputs.length > 3 || new Set(input.inputs.map(value => value.target)).size !== input.inputs.length
      || input.inputs.some(value => !value.source.startsWith('/') || /[,\n\r\0]/u.test(value.source)
        || !['/sec-input/resolution.json', '/sec-input/ticket.json', '/sec-input/candidate.tar'].includes(value.target))) {
    throw new Error('Hosted job container plan has invalid bounded input paths or name.');
  }
  const limits = CI_HOSTED_JOB_RUNTIME_POLICY.resourceLimits[input.role];
  const labels = Object.freeze({ ...input.labels });
  if (Object.keys(labels).some(key => !key.startsWith('sec.hosted-job.')
      || !/^[a-z0-9.-]+$/u.test(key) || /[\n\r\0]/u.test(labels[key]!))) {
    throw new Error('Hosted job ownership labels are invalid.');
  }
  const inputs = Object.freeze(input.inputs.map(value => Object.freeze({ ...value })));
  const args = [ '--name', input.name, '--restart', 'no', '--read-only', '--init', '--user', '0:0',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    ...(input.appArmorProfile === null ? [] : ['--security-opt', `apparmor=${input.appArmorProfile}`]),
    '--pids-limit', String(limits.pids), '--cpus', String(limits.cpus), '--memory', `${limits.memoryGiB}g`,
    '--network', input.role === 'sut' ? 'none' : 'bridge', '--ipc', 'private', '--cgroupns', 'private',
    '--workdir', '/workspace', '--entrypoint', '/bin/sleep',
    '--tmpfs', '/workspace:rw,exec,nosuid,nodev,mode=1777',
    '--tmpfs', '/tmp:rw,exec,nosuid,nodev,mode=1777',
    '--mount', `type=bind,source=${input.sourceRoot},target=/sec-trusted,readonly`,
    ...inputs.flatMap(value => ['--mount', `type=bind,source=${value.source},target=${value.target},readonly`]),
    ...(input.role === 'sut' ? CI_HOSTED_JOB_RUNTIME_POLICY.sutCapAdd.flatMap(capability => ['--cap-add', capability]) : []),
    ...Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
    CI_HOSTED_JOB_RUNTIME_POLICY.image, 'infinity' ];
  return Object.freeze({ name: input.name, role: input.role, labels,
    sourceRoot: input.sourceRoot, inputs, appArmorProfile: input.appArmorProfile, arguments: Object.freeze(args) });
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Hosted container readback is not an object.');
  return value as Record<string, unknown>;
}

export interface HostedJobContainerReadback {
  readonly id: string;
  readonly running: boolean;
  readonly exitCode: number;
  readonly activeExecIds: readonly string[];
  readonly observationDigest: `sha256:${string}`;
}

/** Exact configuration/ownership readback; no resource is removed by a decoder. */
export function assertHostedJobContainerReadback(input: Readonly<{
  source: Uint8Array;
  spec: HostedJobContainerSpec;
  containerId: string;
}>): HostedJobContainerReadback {
  const list = parseExactJsonBytes(input.source, 'Hosted container inspect', { maximumInputBytes: 512 * 1024, maximumDepth: 20 });
  if (!Array.isArray(list) || list.length !== 1 || !/^[0-9a-f]{64}$/u.test(input.containerId)) throw new Error('Hosted container exact-ID census is invalid.');
  const value = record(list[0]);
  const config = record(value.Config);
  const host = record(value.HostConfig);
  const state = record(value.State);
  const labels = record(config.Labels);
  const caps = Array.isArray(host.CapAdd) ? host.CapAdd.map(value => String(value).replace(/^CAP_/u, '')).sort() : [];
  const expectedCaps = input.spec.role === 'sut' ? [...CI_HOSTED_JOB_RUNTIME_POLICY.sutCapAdd].sort() : [];
  const limits = CI_HOSTED_JOB_RUNTIME_POLICY.resourceLimits[input.spec.role];
  const expectedMounts = [{ source: input.spec.sourceRoot, target: '/sec-trusted' }, ...input.spec.inputs];
  if (value.Id !== input.containerId || value.Name !== `/${input.spec.name}` || value.Image !== CI_HOSTED_JOB_RUNTIME_POLICY.image
      || config.User !== '0:0' || config.WorkingDir !== '/workspace'
      || !canonicalEquals(config.Entrypoint, ['/bin/sleep']) || !canonicalEquals(config.Cmd, ['infinity'])
      || !canonicalEquals(host.RestartPolicy, { Name: 'no', MaximumRetryCount: 0 })
      || host.Privileged !== false || host.ReadonlyRootfs !== true || host.Init !== true
      || !canonicalEquals(host.CapDrop, ['ALL']) || !canonicalEquals(caps, expectedCaps)
      || !canonicalEquals(host.SecurityOpt, ['no-new-privileges:true',
        ...(input.spec.appArmorProfile === null ? [] : [`apparmor=${input.spec.appArmorProfile}`])])
      || input.spec.appArmorProfile !== null && value.AppArmorProfile !== input.spec.appArmorProfile
      || host.PidsLimit !== limits.pids || host.Memory !== limits.memoryGiB * 1024 ** 3
      || host.NanoCpus !== limits.cpus * 1_000_000_000
      || host.NetworkMode !== (input.spec.role === 'sut' ? 'none' : 'bridge')
      || host.IpcMode !== 'private' || host.PidMode !== '' || host.CgroupnsMode !== 'private'
      || host.Binds !== null || (host.PortBindings !== null && Object.keys(record(host.PortBindings)).length !== 0)
      || (host.Devices !== null && (!Array.isArray(host.Devices) || host.Devices.length !== 0))
      || (host.DeviceRequests !== null && (!Array.isArray(host.DeviceRequests) || host.DeviceRequests.length !== 0))
      || !canonicalEquals(host.Tmpfs, { '/workspace': 'rw,exec,nosuid,nodev,mode=1777', '/tmp': 'rw,exec,nosuid,nodev,mode=1777' })
      || Object.entries(input.spec.labels).some(([key, expected]) => labels[key] !== expected)
      || Object.keys(labels).some(key => key.startsWith('sec.hosted-job.') && !(key in input.spec.labels))
      || !Array.isArray(value.Mounts) || value.Mounts.length !== expectedMounts.length
      || new Set(value.Mounts.map(mount => record(mount).Destination)).size !== expectedMounts.length
      || value.Mounts.some(mount => {
        const observed = record(mount);
        return observed.Type !== 'bind' || observed.RW !== false || observed.Propagation !== 'rprivate'
          || !expectedMounts.some(expected => observed.Source === expected.source && observed.Destination === expected.target);
      })) throw new Error('Hosted container boundary or ownership changed; resource is preserved.');
  if (!Array.isArray(config.Env) || config.Env.some(entry => typeof entry !== 'string'
      || /^(?:.*(?:TOKEN|PASSWORD|SECRET|CREDENTIAL).*|GITHUB_.*|ACTIONS_.*|DOCKER_HOST)=/iu.test(entry))) {
    throw new Error('Hosted container inherits an inadmissible credential or command channel.');
  }
  if (typeof state.Running !== 'boolean' || !Number.isSafeInteger(state.ExitCode)
      || (value.ExecIDs !== null && (!Array.isArray(value.ExecIDs)
        || value.ExecIDs.some(id => typeof id !== 'string' || !/^[0-9a-f]{64}$/u.test(id))))) {
    throw new Error('Hosted container process readback is incomplete.');
  }
  return Object.freeze({ id: input.containerId, running: state.Running, exitCode: Number(state.ExitCode),
    activeExecIds: Object.freeze(value.ExecIDs === null ? [] : [...value.ExecIDs as string[]]),
    observationDigest: sha256(value) });
}
