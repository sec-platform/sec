import { expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext
} from '../../../../execution/operation/semantic.ts';
import { acquirePhysicalMutationLease } from '../../../runtime-state/physical/runtime/mutation-lease.ts';
import { inspectNoFollowDirectoryChain } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  externalProviderCoordinationLeaseName,
  issueExternalProviderCoordinationLeaseTestIssuerForTests,
  secUserExternalProviderCoordinationPath,
  withExternalProviderCoordinationLeaseAtOwnerIssuedRoot
} from '../../../runtime-state/workspace-state/external-provider-coordination-lease.ts';
import {
  DOCKER_DESKTOP_COORDINATION_PROVIDER_ID,
  dockerDesktopCoordinationInput
} from './launcher-lock.ts';

const digest = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;
const requirementId = 'external.container-engine-launcher-test';
const testIssuer = issueExternalProviderCoordinationLeaseTestIssuerForTests();

function providerOperation(providerIdentityDigest = digest('a')) {
  const contractDigest = sha256({ contract: requirementId }) as `sha256:${string}`;
  const plan = compileSemanticOperationPlan({
    aggregateBudgets: [{ resource: 'duration-ms', maximum: 300_000 }],
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest }),
    deadlineAtUnixMs: Date.now() + 300_000,
    decisionDigest: sha256({ decision: requirementId }) as `sha256:${string}`,
    intentDigest: sha256({ intent: requirementId }) as `sha256:${string}`,
    operation: 'external.container-engine-launcher-test',
    requirements: [{
      contractDigest,
      effectKinds: ['filesystem', 'provider'],
      failureKinds: ['container-engine.desktop-launcher-path-unavailable'],
      id: requirementId
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    contractDigest,
    providerIdentityDigest,
    requirementId
  })]);
}

function dockerCoordination(
  endpointHost: string,
  providerIdentityDigest = digest('a')
) {
  return dockerDesktopCoordinationInput({
    endpointHost,
    providerOperation: providerOperation(providerIdentityDigest),
    repositoryRoot: process.cwd(),
    requirementId
  });
}

test('Docker launcher lock exists only beneath the owner-issued directory', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-docker-launcher-lock-'));
  const endpointHost = 'npipe:////./pipe/dockerDesktopLinuxEngine';
  const displacedCoordinationDirectory = `${root}-displaced-coordination`;
  const originalLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = '';
  try {
    const owner = inspectNoFollowDirectoryChain(root, 'test-owned launcher coordination root');
    const coordinationDirectory = secUserExternalProviderCoordinationPath({
      localAppData: root,
      repositoryRoot: process.cwd()
    });
    let observedNames: string[] = [];
    const result = await withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
      coordination: dockerCoordination(endpointHost),
      issuer: testIssuer,
      root: owner,
      operation: async () => {
        observedNames = readdirSync(coordinationDirectory);
        const contender = await withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
          coordination: dockerCoordination(endpointHost, digest('c')),
          issuer: testIssuer,
          root: owner,
          operation: async () => 'unexpected'
        });
        expect(contender).toBeNull();
        if (process.platform === 'win32') {
          expect(() => renameSync(
            coordinationDirectory,
            displacedCoordinationDirectory
          )).toThrow(expect.objectContaining({ code: 'EBUSY' }));
        }
        return 'settled';
      }
    });
    expect(result).toBe('settled');
    expect(observedNames).toEqual([externalProviderCoordinationLeaseName({
      endpointIdentity: endpointHost,
      providerId: DOCKER_DESKTOP_COORDINATION_PROVIDER_ID
    })]);
    expect(readdirSync(coordinationDirectory)).toEqual([]);
    expect(coordinationDirectory.includes(`${path.sep}Docker${path.sep}`)).toBe(false);
  } finally {
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    rmSync(root, { recursive: true, force: true });
    rmSync(displacedCoordinationDirectory, { recursive: true, force: true });
  }
});

test('Docker launcher lock reclaims a lease whose process lost its handle', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-docker-launcher-recovery-'));
  const endpointHost = 'npipe:////./pipe/dockerDesktopLinuxEngine';
  try {
    const owner = inspectNoFollowDirectoryChain(root, 'test-owned launcher recovery root');
    const coordinationDirectory = secUserExternalProviderCoordinationPath({
      localAppData: root,
      repositoryRoot: process.cwd()
    });
    const initial = await withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
      coordination: dockerCoordination(endpointHost),
      issuer: testIssuer,
      root: owner,
      operation: async () => 'initial-settled'
    });
    expect(initial).toBe('initial-settled');

    const exitedProcess = Bun.spawn([process.execPath, '-e', ''], {
      stderr: 'ignore',
      stdout: 'ignore'
    });
    const deadOwnerPid = exitedProcess.pid;
    expect(await exitedProcess.exited).toBe(0);
    const coordinationIdentity = inspectNoFollowDirectoryChain(
      coordinationDirectory,
      'test-owned Docker launcher recovery directory'
    ).target;
    const abandonedLease = acquirePhysicalMutationLease(
      coordinationIdentity,
      externalProviderCoordinationLeaseName({
        endpointIdentity: endpointHost,
        providerId: DOCKER_DESKTOP_COORDINATION_PROVIDER_ID
      }),
      { ownerPid: deadOwnerPid, ttlMs: 10_000 }
    );
    expect(abandonedLease).not.toBeNull();

    const recovered = await withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
      coordination: dockerCoordination(endpointHost, digest('e')),
      issuer: testIssuer,
      root: owner,
      operation: async () => 'recovered'
    });
    expect(recovered).toBe('recovered');
    expect(readdirSync(coordinationDirectory)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
