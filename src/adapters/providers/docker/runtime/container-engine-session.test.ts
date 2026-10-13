import { expect, test } from 'bun:test';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import { issueRuntimeGenerationCensusReceiptForTests } from '../../../runtime-state/physical/runtime/runtime-endpoint-residue.ts';
import {
  createDockerEndpointIdentity,
  DockerDaemonAvailabilityFailure
} from '../contract/daemon.ts';
import {
  assertContainerEngineOperationScopeAdmission,
  compileContainerEngineAdmissionProviderIdentity,
  compileContainerEngineOperationArguments,
  compileContainerEngineReadyProviderIdentity,
  compileObservedContainerEngineProviderIdentity,
  observeBeforeDockerDesktopLifecycleAdmission
} from './container-engine-session.ts';

const endpoint = createDockerEndpointIdentity({
  architecture: 'x86_64',
  contextName: 'desktop-linux',
  daemonId: 'daemon-test',
  endpointHost: 'npipe:////./pipe/dockerDesktopLinuxEngine',
  osType: 'linux'
});
const digest = (value: unknown): OperationDigest => sha256(value) as OperationDigest;

test('Container Engine projection injects the retained endpoint outside caller arguments', () => {
  expect(compileContainerEngineOperationArguments(endpoint, {
    kind: 'container-list',
    arguments: ['--all']
  })).toEqual([
    '--host',
    endpoint.endpointHost,
    'container',
    'ls',
    '--all'
  ]);
});

test('Container Engine callers cannot replace the retained endpoint', () => {
  expect(() => compileContainerEngineOperationArguments(endpoint, {
    kind: 'container-list',
    arguments: ['--host', 'npipe:////./pipe/attacker']
  })).toThrow('operation cannot replace the retained endpoint');
});

test('ready provider identity is a successor of exact admission resources and attempt', () => {
  const physical = Object.freeze({
    path: 'C:\\provider-root',
    finalPath: '\\\\?\\C:\\provider-root',
    device: 'device',
    inode: 'inode',
    objectId: 'object'
  });
  const authorityProviderIdentityDigest = digest('authority-provider');
  const generationCensus = issueRuntimeGenerationCensusReceiptForTests({
    providerIdentityDigest: authorityProviderIdentityDigest,
    states: ['present']
  });
  const admissionInput = {
    authorityProviderIdentityDigest,
    projectionProviderIdentityDigest: digest('projection-provider'),
    environmentDigest: digest('canonical-child-environment'),
    operationIdentityDigest: digest('operation'),
    boundAttemptDigest: digest('attempt'),
    executable: {
      path: 'C:\\docker.exe',
      size: 1,
      byteDigest: digest('executable-bytes'),
      contentDigest: digest('executable-content')
    },
    workingDirectory: physical,
    runtimeStateRoots: [{ root: physical, directory: physical }],
    generationCensus
  } as const;
  const admission = compileContainerEngineAdmissionProviderIdentity(admissionInput);
  expect(compileContainerEngineAdmissionProviderIdentity({
    ...admissionInput,
    boundAttemptDigest: digest('transplanted-attempt')
  })).not.toBe(admission);
  const transplantedCensus = issueRuntimeGenerationCensusReceiptForTests({
    providerIdentityDigest: digest('different-authority-provider'),
    states: ['present']
  });
  expect(() => compileContainerEngineAdmissionProviderIdentity({
    ...admissionInput,
    generationCensus: transplantedCensus
  })).toThrow('authority provider changed');
  const ready = compileContainerEngineReadyProviderIdentity({
    admissionProviderIdentityDigest: admission,
    endpoint
  });
  expect(ready).not.toBe(admission);
  expect(compileContainerEngineReadyProviderIdentity({
    admissionProviderIdentityDigest: digest('different-admission'),
    endpoint
  })).not.toBe(ready);
});

test('observed provider identity binds sealed command inputs without runtime-state preimage', () => {
  const physical = Object.freeze({
    path: 'C:\\provider-root', finalPath: '\\\\?\\C:\\provider-root',
    device: 'device', inode: 'inode', objectId: 'object'
  });
  const input = {
    authorityProviderIdentityDigest: digest('authority-provider'),
    projectionProviderIdentityDigest: digest('projection-provider'),
    environmentDigest: digest('canonical-child-environment'),
    operationIdentityDigest: digest('operation'),
    boundAttemptDigest: digest('attempt'),
    executable: {
      path: 'C:\\docker.exe', size: 1,
      byteDigest: digest('executable-bytes'), contentDigest: digest('executable-content')
    },
    workingDirectory: physical
  } as const;
  const observed = compileObservedContainerEngineProviderIdentity(input);
  expect(compileObservedContainerEngineProviderIdentity({
    ...input,
    environmentDigest: digest('different-sealed-environment')
  })).not.toBe(observed);
});

test('ready daemon observation does not admit Docker Desktop host runtime state', async () => {
  const available = Object.freeze({ code: 0, stdout: '{"ID":"daemon"}', stderr: '' });
  let lifecycleAdmissions = 0;
  await expect(observeBeforeDockerDesktopLifecycleAdmission({
    platform: 'win32',
    endpointHost: endpoint.endpointHost,
    observe: async () => available,
    admitAndEnsureStarted: async () => {
      lifecycleAdmissions += 1;
      throw new Error('host runtime state must stay unopened');
    }
  })).resolves.toBe(available);
  expect(lifecycleAdmissions).toBe(0);
});

test('only endpoint unavailability admits Docker Desktop host runtime state', async () => {
  const recovered = Object.freeze({ code: 0, stdout: '{"ID":"daemon"}', stderr: '' });
  let lifecycleAdmissions = 0;
  await expect(observeBeforeDockerDesktopLifecycleAdmission({
    platform: 'win32',
    endpointHost: endpoint.endpointHost,
    observe: async () => {
      throw new DockerDaemonAvailabilityFailure({
        endpointHost: endpoint.endpointHost,
        reason: 'endpoint-unavailable',
        phase: 'endpoint-observe'
      });
    },
    admitAndEnsureStarted: async () => {
      lifecycleAdmissions += 1;
      return recovered;
    }
  })).resolves.toBe(recovered);
  expect(lifecycleAdmissions).toBe(1);

  await expect(observeBeforeDockerDesktopLifecycleAdmission({
    platform: 'win32',
    endpointHost: endpoint.endpointHost,
    observe: async () => {
      throw new DockerDaemonAvailabilityFailure({
        endpointHost: endpoint.endpointHost,
        reason: 'deadline-exhausted',
        phase: 'endpoint-observe'
      });
    },
    admitAndEnsureStarted: async () => {
      lifecycleAdmissions += 1;
      return recovered;
    }
  })).rejects.toMatchObject({ reason: 'deadline-exhausted' });
  expect(lifecycleAdmissions).toBe(1);
});

test('unmanaged endpoints and non-Windows hosts never admit Desktop lifecycle state', async () => {
  for (const target of [
    { platform: 'win32' as const, endpointHost: 'unix:///var/run/docker.sock' },
    { platform: 'linux' as const, endpointHost: endpoint.endpointHost }
  ]) {
    let lifecycleAdmissions = 0;
    const unavailable = new DockerDaemonAvailabilityFailure({
      endpointHost: target.endpointHost,
      reason: 'endpoint-unavailable',
      phase: 'endpoint-observe'
    });
    await expect(observeBeforeDockerDesktopLifecycleAdmission({
      ...target,
      observe: async () => { throw unavailable; },
      admitAndEnsureStarted: async () => {
        lifecycleAdmissions += 1;
        throw new Error('unrelated lifecycle must stay unopened');
      }
    })).rejects.toBe(unavailable);
    expect(lifecycleAdmissions).toBe(0);
  }
});

test('a non-authority resource envelope cannot open a provider settlement scope', () => {
  const contractDigest = sha256({ contract: 'container-engine-scope-test' }) as OperationDigest;
  const realProviderIdentityDigest = sha256({
    provider: 'retained-container-engine'
  }) as OperationDigest;
  const resourceEnvelopeIdentityDigest = sha256({
    provider: 'resource-envelope-only'
  }) as OperationDigest;
  const deadlineAtUnixMs = Date.now() + 60_000;
  const plan = compileSemanticOperationPlan({
    operation: 'external.container-engine.scope-test',
    intentDigest: sha256({ intent: 'scope-test' }) as OperationDigest,
    decisionDigest: sha256({ decision: 'scope-test' }) as OperationDigest,
    deadlineAtUnixMs,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 60_000 },
      { resource: 'output-bytes', maximum: 1024 },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [{
      id: 'external.container-engine-process',
      contractDigest,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: [
        'container-engine.admission-failed',
        'container-engine.desktop-launcher-path-unavailable',
        'container-engine.endpoint-unavailable',
        'container-engine.process-settlement-failed',
        'container-engine.runtime-endpoint-residue'
      ]
    }],
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest })
  });
  const resourceEnvelope = bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: 'external.container-engine-process',
    contractDigest,
    providerIdentityDigest: resourceEnvelopeIdentityDigest
  })]);
  expect(() => assertContainerEngineOperationScopeAdmission({
    operation: resourceEnvelope,
    requirementId: 'external.container-engine-process',
    providerIdentityDigest: realProviderIdentityDigest,
    sessionDeadlineAtUnixMs: deadlineAtUnixMs
  })).toThrow('does not bind this retained Container Engine provider');
});
