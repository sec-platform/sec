import { expect, test } from 'bun:test';

import { projectUpgradePlan, projectUpgradePreview } from '../../src/application/upgrade-planning.ts';
import { formatUpgradePlanning } from '../../src/entry/cli/upgrade-planning.ts';
import {
  createUpgradePreview,
  type UpgradePlan
} from '../../src/semantics/upgrade/upgrade-artifact.ts';
import {
  buildUpgradeExecutionTerminalArtifact,
  buildUpgradePlanArtifact
} from '../helpers/upgrade-fixtures.ts';

function previewFromPlan(plan: UpgradePlan) {
  const {
    formatVersion: _formatVersion,
    artifactKind: _artifactKind,
    workspaceIdentityDigest: _workspaceIdentityDigest,
    operationIdentityDigest: _operationIdentityDigest,
    planRevision: _planRevision,
    ...planning
  } = plan;
  return createUpgradePreview({ artifactKind: 'unbound-upgrade-preview', ...planning });
}

test('upgrade planning projection owns bounded presentation for planned, applied and preview states', () => {
  const plan = buildUpgradePlanArtifact();
  const planned = projectUpgradePlan(plan, null);

  expect(planned).toMatchObject({
    blockId: 'auth/basic-session',
    fromVersion: '0.1.0',
    toVersion: '0.1.1',
    presentation: 'planned',
    migrationCount: 1,
    preflightCheckCount: 9,
    migrationKindCounts: [{ id: 'file-replace', count: 1 }],
    operationRoleCounts: [{ id: 'file', count: 1 }],
    impacts: ['src/installed/auth/session.ts'],
    preflightEvidenceCount: 5,
    requiresVerificationCount: 1
  });
  expect(planned.migrations).toEqual([{
    id: 'mig-auth-session-refresh',
    kind: 'file-replace',
    target: 'src/installed/auth/session.ts',
    source: 'files/src/installed/auth/session.ts',
    role: 'file',
    requiresVerification: true
  }]);
  expect(planned.preflightChecks.map((check) => check.id)).toEqual([
    'version-range',
    'migration-entries',
    'migration-targets'
  ]);
  expect(formatUpgradePlanning(planned)).toBe([
    'Upgrade auth/basic-session 0.1.0 -> 0.1.1',
    'Status: planned; migrations: 1; preflight checks: 9',
    'Migration kinds: file-replace=1',
    'Operation roles: file=1',
    'Impacts: src/installed/auth/session.ts',
    'Preflight evidence: 5',
    'Requires verification: true (1 migrations)',
    'Migration mig-auth-session-refresh: file-replace; target=src/installed/auth/session.ts; source=files/src/installed/auth/session.ts; role=file; requiresVerification=true',
    'Preflight version-range: passed; evidence=1',
    'Preflight migration-entries: passed; evidence=1',
    'Preflight migration-targets: passed; evidence=1'
  ].join('\n'));

  const applied = projectUpgradePlan(
    plan,
    buildUpgradeExecutionTerminalArtifact(plan, { settlement: 'applied' })
  );
  expect(applied.presentation).toBe('applied');
  expect(formatUpgradePlanning(applied).split('\n')[1]).toStartWith('Status: applied;');

  const preview = projectUpgradePreview(previewFromPlan(plan));
  expect(preview.presentation).toBe('preview');
  expect(formatUpgradePlanning(preview).split('\n')[0]).toBe(
    'Upgrade auth/basic-session 0.1.0 -> 0.1.1 (dry-run)'
  );
});
