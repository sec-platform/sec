import { expect, test } from 'bun:test';

import {
  assertWorkPackageGateResidueCensusV4,
  type WorkPackageGateResidueCensusV4
} from '../../scripts/work-package-gate-contract.ts';

const emptyIdentities = Object.freeze({
  count: 0,
  digest: `sha256:${'0'.repeat(64)}`
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
