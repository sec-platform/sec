import { expect, test } from 'bun:test';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { workPackageGateProbeOutcomeAcceptedForTests } from '../../scripts/run-work-package-gate.ts';
import {
  assertWorkPackageGateResidueCensusV4,
  type WorkPackageGateResidueCensusV4
} from '../../scripts/work-package-gate-contract.ts';

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

test('retired profile census evidence stays absent and cannot authorize a runtime retry', async () => {
  const evidencePath = path.join(
    repoRoot,
    'docs',
    'evidence',
    'v0-4-semantic-mutation-profile-census-repair-verification.json'
  );
  await expect(stat(evidencePath)).rejects.toMatchObject({ code: 'ENOENT' });

  const runner = await readFile(path.join(repoRoot, 'scripts', 'run-work-package-gate.ts'), 'utf8');
  expect(runner).not.toContain('v0-4-semantic-mutation-profile-census-repair-verification.json');
  expect(runner).not.toContain('retryAuthorized');
});
