import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assertWorkPackageGateResidueCensusV4,
  type WorkPackageGateResidueCensusV4
} from '../../scripts/work-package-gate-contract.ts';
import { workPackageGateProbeOutcomeAcceptedForTests } from '../../scripts/run-work-package-gate.ts';

const repoRoot = path.resolve(import.meta.dir, '../..');
const emptyIdentities = Object.freeze({
  count: 0,
  digest: `sha256:${'0'.repeat(64)}`
});

test('V4 Gate has no global AppContainer profile census path', async () => {
  expect(typeof workPackageGateProbeOutcomeAcceptedForTests).toBe('function');
  const runner = await readFile(path.join(repoRoot, 'scripts', 'run-work-package-gate.ts'), 'utf8');
  for (const forbidden of [
    'WORK_PACKAGE_PROFILE_MAPPING_ROOT',
    'WORK_PACKAGE_PROFILE_QUERY_SCRIPT',
    'PROFILE_PROBE_TIMEOUT_MS',
    'boundedProfileIdentities',
    'workPackageGateProfileCensusForTests',
    'workPackageGateProfileQueryScriptForTests',
    'profileSetMatches',
    'Microsoft.Win32.RegistryKey',
    'AppContainer\\Mappings'
  ]) expect(runner).not.toContain(forbidden);
});

test('V4 residue contract accepts only namespace structure and ACL authority', () => {
  const census: WorkPackageGateResidueCensusV4 = Object.freeze({
    structure: Object.freeze({
      complete: true,
      reason: 'namespace-absent',
      counts: Object.freeze({
        workspaceRoots: 0,
        recoveryOwners: 0,
        pendingOwners: 0,
        nativeResults: 0,
        writerLeases: 0
      }),
      recoveryAuthorities: emptyIdentities
    }),
    aclPresentOwners: Object.freeze({
      complete: true,
      reason: 'namespace-absent',
      identities: emptyIdentities
    })
  });
  expect(() => assertWorkPackageGateResidueCensusV4(census)).not.toThrow();
  expect(JSON.stringify(census)).not.toContain('appContainerProfiles');
  expect(() => assertWorkPackageGateResidueCensusV4({
    ...census,
    appContainerProfiles: Object.freeze({
      complete: true,
      reason: 'observed',
      identities: emptyIdentities
    })
  })).toThrow();
});

test('failed real census evidence stays immutable and cannot authorize a retry', async () => {
  const evidencePath = path.join(
    repoRoot,
    'docs',
    'evidence',
    'v0-4-semantic-mutation-profile-census-repair-verification.json'
  );
  const bytes = await readFile(evidencePath);
  expect(createHash('sha256').update(bytes).digest('hex'))
    .toBe('ae7f10c990d05b345a7ac64bf3c7294e77ccb6d837fd340c42ca4bdc2329762c');
  const evidence = JSON.parse(bytes.toString()) as {
    readonly status: string;
    readonly result: {
      readonly realCensusAttempted: boolean;
      readonly complete: boolean;
      readonly reason: unknown;
      readonly reasonAvailability: string;
      readonly rawRegistryOutputPersisted: boolean;
      readonly rawProfileIdentityPersisted: boolean;
      readonly retryAuthorized: boolean;
      readonly classification: string;
    };
  };
  expect(evidence.status).toBe('failed');
  expect(evidence.result).toEqual({
    realCensusAttempted: true,
    complete: false,
    reason: null,
    reasonAvailability: 'not-emitted-by-test-assertion',
    rawRegistryOutputPersisted: false,
    rawProfileIdentityPersisted: false,
    retryAuthorized: false,
    classification: 'profile-census-incomplete-unreported-reason'
  });
});
