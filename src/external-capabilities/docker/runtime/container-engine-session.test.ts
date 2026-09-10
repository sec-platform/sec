import { expect, test } from 'bun:test';

import { issueRuntimeGenerationCensusReceiptForTests } from '../../../runtime-state/physical/runtime/runtime-endpoint-residue.ts';
import { sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecOperationDigest
} from '../../../system-architecture/operation/semantic.ts';
import { createDockerEndpointIdentity } from '../contract/daemon.ts';
import {
  assertContainerEngineOperationScopeAdmission,
  compileContainerEngineAdmissionProviderIdentity,
  compileContainerEngineOperationArguments,
  compileContainerEngineReadyProviderIdentity
} from './container-engine-session.ts';

const endpoint = createDockerEndpointIdentity({
  architecture: 'x86_64',
  contextName: 'desktop-linux',
  daemonId: 'daemon-test',
  endpointHost: 'npipe:////./pipe/dockerDesktopLinuxEngine',
  osType: 'linux'
});
const digest = (value: unknown): SecOperationDigest => sha256(value) as SecOperationDigest;

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

test('a non-authority resource envelope cannot open a provider settlement scope', () => {
  const contractDigest = sha256({ contract: 'container-engine-scope-test' }) as SecOperationDigest;
  const realProviderIdentityDigest = sha256({
    provider: 'retained-container-engine'
  }) as SecOperationDigest;
  const resourceEnvelopeIdentityDigest = sha256({
    provider: 'resource-envelope-only'
  }) as SecOperationDigest;
  const deadlineAtUnixMs = Date.now() + 60_000;
  const plan = compileSecSemanticOperationPlan({
    operation: 'external.container-engine.scope-test',
    intentDigest: sha256({ intent: 'scope-test' }) as SecOperationDigest,
    decisionDigest: sha256({ decision: 'scope-test' }) as SecOperationDigest,
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
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest })
  });
  const resourceEnvelope = bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
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
