import { readFileSync } from 'node:fs';
import path from 'node:path';
import { issueActiveWorkPackageOwnerObservation } from '../../../src/adapters/self-hosting/control/task/contract/active-work-observation.ts';

/** Synthetic Work producer for closeout consumer integration only.
 * The live documentation resolver has its own contract suite. This fixture uses
 * the same lower-level issuer as branch-lifecycle-temp-repo tests, retaining the
 * opaque brand and all consumer-side identity/state checks.
 */
export function observeCloseoutFixtureWork(repositoryRoot: string) {
  const state = JSON.parse(readFileSync(path.join(repositoryRoot, 'provider-state.json'), 'utf8'));
  if (path.resolve(state.repositoryRoot) !== path.resolve(repositoryRoot)) {
    throw new Error('Closeout Work fixture repository root mismatch');
  }
  const selected = state.activeWorkObservationState ?? (state.activeWorkPackageSelected ? 'active' : 'none');
  if (!['active', 'none', 'invalid', 'unresolved'].includes(selected)) {
    throw new Error('Closeout Work fixture state is invalid');
  }
  return issueActiveWorkPackageOwnerObservation({
    repository: state.repository,
    defaultBranch: 'main',
    defaultSha: selected === 'unresolved' ? null : state.liveDefaultSha,
    observedAt: '2026-08-09T14:05:00.000Z',
    state: selected,
    branch: selected === 'active' ? state.branch : null,
    manifest: selected === 'active' ? state.activeWorkManifest : null,
    reason: selected === 'active' ? null : `synthetic Work fixture: ${selected}`
  });
}
