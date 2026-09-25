import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationEffectKind
} from '../../../execution/operation/semantic.ts';
import { acquirePhysicalMutationLease } from '../physical/runtime/mutation-lease.ts';
import { inspectNoFollowDirectoryChain } from '../physical/runtime/physical-no-follow.ts';
import {
  ExternalProviderCoordinationLeaseError,
  assertExternalProviderCoordinationLease,
  externalProviderCoordinationLeaseName,
  issueExternalProviderCoordinationLeaseTestIssuerForTests,
  secUserExternalProviderCoordinationPath,
  withExternalProviderCoordinationLeaseAtOwnerIssuedRoot
} from './external-provider-coordination-lease.ts';
import { resolveWorkspaceRuntimeRoots } from './paths.ts';

const digest = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;
const requirementId = 'external.provider.coordination-test';
const testIssuer = issueExternalProviderCoordinationLeaseTestIssuerForTests();

function providerOperation(input: Readonly<{
  deadlineAtUnixMs?: number;
  effectKinds?: readonly OperationEffectKind[];
  providerEpochDigest?: `sha256:${string}`;
}> = {}): BoundSemanticOperation {
  const contractDigest = sha256({ contract: requirementId }) as `sha256:${string}`;
  const plan = compileSemanticOperationPlan({
    aggregateBudgets: [{ resource: 'duration-ms', maximum: 600_000 }],
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest }),
    deadlineAtUnixMs: input.deadlineAtUnixMs ?? Date.now() + 600_000,
    decisionDigest: sha256({ decision: requirementId }) as `sha256:${string}`,
    intentDigest: sha256({ intent: requirementId }) as `sha256:${string}`,
    operation: 'external.provider.coordination-test',
    requirements: [{
      contractDigest,
      effectKinds: input.effectKinds ?? ['filesystem', 'provider'],
      failureKinds: ['external.provider.coordination-failed'],
      id: requirementId
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    contractDigest,
    providerIdentityDigest: input.providerEpochDigest ?? digest('a'),
    requirementId
  })]);
}

function coordination(operation = providerOperation()) {
  return Object.freeze({
    endpointIdentity: 'npipe:////./pipe/dockerDesktopLinuxEngine',
    operation,
    providerId: 'docker.desktop',
    requirementId,
    repositoryRoot: process.cwd()
  });
}

test.skipIf(process.platform !== 'win32')(
  'user external-provider coordination is isolated beneath canonical SEC Runtime State',
  async () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), 'sec-provider-coordination-'));
    const originalLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = '';
    try {
      const root = inspectNoFollowDirectoryChain(rootPath, 'test provider coordination owner');
      const expectedDirectory = secUserExternalProviderCoordinationPath({
        localAppData: root.target.path,
        repositoryRoot: process.cwd()
      });
      let observedNames: string[] = [];
      let firstCoordinationDigest: `sha256:${string}` | null = null;
      const first = await withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
        coordination: coordination(),
        issuer: testIssuer,
        root,
        operation: async (lease) => {
          assertExternalProviderCoordinationLease(lease);
          firstCoordinationDigest = lease.coordinationDigest;
          expect(lease.operationIdentityDigest).toBe(
            coordination().operation.plan.identity.identityDigest
          );
          expect(lease.providerEpochDigest).toBe(digest('a'));
          expect(lease.deadlineAtUnixMs - Date.now()).toBeLessThanOrEqual(300_000);
          observedNames = readdirSync(expectedDirectory);
          const contender = await withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
            coordination: coordination(providerOperation({ providerEpochDigest: digest('c') })),
            issuer: testIssuer,
            root,
            operation: async () => 'unexpected'
          });
          expect(contender).toBeNull();
          return 'settled';
        }
      });

      expect(first).toBe('settled');
      let successorCoordinationDigest: `sha256:${string}` | null = null;
      const successor = await withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
        coordination: coordination(providerOperation({ providerEpochDigest: digest('e') })),
        issuer: testIssuer,
        root,
        operation: async (lease) => {
          successorCoordinationDigest = lease.coordinationDigest;
          return 'successor-settled';
        }
      });
      expect(successor).toBe('successor-settled');
      expect(successorCoordinationDigest).not.toBe(firstCoordinationDigest);
      expect(observedNames).toEqual([
        externalProviderCoordinationLeaseName(coordination())
      ]);
      expect(readdirSync(expectedDirectory)).toEqual([]);
      const canonicalRoots = resolveWorkspaceRuntimeRoots({
        environment: { LOCALAPPDATA: rootPath },
        repositoryRoot: process.cwd()
      });
      expect(path.dirname(expectedDirectory)).toBe(canonicalRoots.stateRoot);
      expect(expectedDirectory.includes(`${path.sep}Docker${path.sep}`)).toBe(false);
    } finally {
      if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = originalLocalAppData;
      rmSync(rootPath, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'external-provider coordination rejects unavailable paths and blocks same-path replacement',
  async () => {
    const missingRootPath = mkdtempSync(path.join(tmpdir(), 'sec-provider-missing-'));
    const missingRoot = inspectNoFollowDirectoryChain(missingRootPath, 'test missing owner');
    rmSync(missingRootPath, { recursive: true, force: true });
    await expect(withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
      coordination: coordination(),
      issuer: testIssuer,
      root: missingRoot,
      operation: async () => 'unreachable'
    })).rejects.toMatchObject({ reason: 'path-unavailable' });

    const replacementRootPath = mkdtempSync(path.join(tmpdir(), 'sec-provider-replacement-'));
    const displacedRootPath = `${replacementRootPath}-displaced`;
    try {
      const replacementRoot = inspectNoFollowDirectoryChain(
        replacementRootPath,
        'test replacement owner'
      );
      let replacementPrevented = false;
      const replacementAttempt = withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
        coordination: coordination(),
        issuer: testIssuer,
        root: replacementRoot,
        operation: async () => {
          try {
            renameSync(replacementRootPath, displacedRootPath);
          } catch (error) {
            if (process.platform === 'win32' && error !== null && typeof error === 'object'
                && 'code' in error && error.code === 'EBUSY') {
              replacementPrevented = true;
              return 'replacement-prevented';
            }
            throw error;
          }
          return 'must-not-settle';
        }
      });
      if (process.platform === 'win32') {
        expect(await replacementAttempt).toBe('replacement-prevented');
        expect(replacementPrevented).toBe(true);
      } else {
        await expect(replacementAttempt).rejects.toBeInstanceOf(
          ExternalProviderCoordinationLeaseError
        );
      }
    } finally {
      rmSync(replacementRootPath, { recursive: true, force: true });
      rmSync(displacedRootPath, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'acknowledgement failure settles retained resources and preserves the primary failure',
  async () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), 'sec-provider-ack-failure-'));
    try {
      const root = inspectNoFollowDirectoryChain(rootPath, 'test acknowledgement failure owner');
      await withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
        coordination: coordination(), issuer: testIssuer, root,
        operation: async () => 'initialize'
      });
      const coordinationDirectory = inspectNoFollowDirectoryChain(
        secUserExternalProviderCoordinationPath({
          localAppData: rootPath,
          repositoryRoot: process.cwd()
        }),
        'test acknowledgement failure coordination directory'
      ).target;
      const abandoned = acquirePhysicalMutationLease(
        coordinationDirectory,
        externalProviderCoordinationLeaseName(coordination()),
        { ownerPid: 2_147_483_000 }
      );
      expect(abandoned).not.toBeNull();
      let operationCalled = false;
      await expect(withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
        coordination: coordination(),
        issuer: testIssuer,
        root,
        testOnlyBeforeRecoveryAcknowledgement: (leasePath) => {
          writeFileSync(leasePath, 'faulted acknowledgement bytes\n', 'utf8');
        },
        operation: async () => {
          operationCalled = true;
          return 'unreachable';
        }
      })).rejects.toMatchObject({
        reason: 'settlement-unknown',
        cause: expect.any(AggregateError)
      });
      expect(operationCalled).toBe(false);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'external-provider coordination accepts a canonical copied semantic projection',
  async () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), 'sec-provider-projection-'));
    try {
      const root = inspectNoFollowDirectoryChain(rootPath, 'test projection coordination owner');
      const projectedOperation = {
        ...providerOperation()
      } as BoundSemanticOperation;
      await expect(withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
        coordination: coordination(projectedOperation),
        issuer: testIssuer,
        root,
        operation: async () => 'projection-accepted'
      })).resolves.toBe('projection-accepted');
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'external-provider coordination rejects expired and structurally forged capabilities',
  async () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), 'sec-provider-invalid-'));
    try {
      const root = inspectNoFollowDirectoryChain(rootPath, 'test invalid coordination owner');
      await expect(withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
        coordination: coordination(providerOperation({ deadlineAtUnixMs: Date.now() - 1 })),
        issuer: testIssuer,
        root,
        operation: async () => 'unreachable'
      })).rejects.toMatchObject({ reason: 'deadline-exhausted' });
      expect(() => assertExternalProviderCoordinationLease({
        coordinationDigest: digest('d'),
        deadlineAtUnixMs: Date.now() + 1,
        endpointIdentity: coordination().endpointIdentity,
        operationIdentityDigest: coordination().operation.plan.identity.identityDigest,
        providerEpochDigest: digest('a'),
        providerId: 'docker.desktop'
      })).toThrow('not owner-issued');
      const providerOperationForForgery = providerOperation();
      const structurallyForgedOperation = {
        ...providerOperationForForgery,
        plan: { ...providerOperationForForgery.plan }
      } as BoundSemanticOperation;
      await expect(withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
        coordination: coordination(structurallyForgedOperation),
        issuer: testIssuer,
        root,
        operation: async () => 'unreachable'
      })).rejects.toMatchObject({ reason: 'invalid-input' });
      await expect(withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
        coordination: coordination(providerOperation({ effectKinds: ['provider'] })),
        issuer: testIssuer,
        root,
        operation: async () => 'unreachable'
      })).rejects.toMatchObject({ reason: 'invalid-input' });
      await expect(withExternalProviderCoordinationLeaseAtOwnerIssuedRoot({
        coordination: coordination(),
        issuer: { kind: 'external-provider-coordination-test-issuer' } as const,
        root,
        operation: async () => 'unreachable'
      })).rejects.toMatchObject({ reason: 'invalid-input' });
      expect(existsSync(secUserExternalProviderCoordinationPath({
        localAppData: rootPath,
        repositoryRoot: process.cwd()
      }))).toBe(false);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  }
);
