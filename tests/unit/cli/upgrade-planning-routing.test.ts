import { expect, test } from 'bun:test';

import { writeJson } from '../../../src/adapters/filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { projectUpgradePlan, projectUpgradePreview } from '../../../src/application/upgrade-planning.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { formatUpgradePlanning } from '../../../src/entry/cli/upgrade-planning.ts';
import { createUpgradePreview, type UpgradePlan } from '../../../src/semantics/upgrade/upgrade-artifact.ts';
import { buildUpgradeExecutionTerminalArtifact, buildUpgradePlanArtifact } from '../../helpers/upgrade-fixtures.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

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

test('upgrade plan routing uses application projection and entry rendering without changing JSON authority', async () => {
  const plan = buildUpgradePlanArtifact();
  const originalPlan = structuredClone(plan);
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
  // State, migration identity and verification requirements matter; prose layout does not.
  function expectPlannedUpgrade(text: string): void {
    for (const meaning of [
      /Upgrade\s+auth\/basic-session(?=$|[\s;,()])[^\n]*0\.1\.0(?=$|[\s;,()])[^\n]*0\.1\.1(?=$|[\s;,()])/u,
      /Status\W+planned(?=$|[\s;,()])/u,
      /\bmigrations\W+1(?=$|[\s;,()])/u,
      /\bpreflight checks\W+9(?=$|[\s;,()])/u,
      /Migration kinds[^\n]*\bfile-replace=1(?=$|[\s;,()])/u,
      /Operation roles[^\n]*\bfile=1(?=$|[\s;,()])/u,
      /Impacts[^\n]*src\/installed\/auth\/session\.ts(?=$|[\s;,()])/u,
      /Preflight evidence\W+5(?=$|[\s;,()])/u,
      /Requires verification\W+true(?=$|[\s;,()])[^\n]*\b1 migrations(?=$|[\s;,()])/u,
      /Migration mig-auth-session-refresh\W+file-replace(?=$|[\s;,()])/u,
      /Migration mig-auth-session-refresh(?=[\s:])[^\n]*\btarget=src\/installed\/auth\/session\.ts(?=$|[\s;,()])/u,
      /Migration mig-auth-session-refresh(?=[\s:])[^\n]*\bsource=files\/src\/installed\/auth\/session\.ts(?=$|[\s;,()])/u,
      /Migration mig-auth-session-refresh(?=[\s:])[^\n]*\brole=file(?=$|[\s;,()])/u,
      /Migration mig-auth-session-refresh(?=[\s:])[^\n]*\brequiresVerification=true(?=$|[\s;,()])/u
    ]) expect(text).toMatch(meaning);
    for (const check of ['version-range', 'migration-entries', 'migration-targets']) {
      expect(text).toMatch(new RegExp(`Preflight ${check}\\W+passed(?=$|[\\s;,()])[^\\n]*\\bevidence=1(?=$|[\\s;,()])`, 'u'));
    }
  }
  expectPlannedUpgrade(formatUpgradePlanning(planned));

  const applied = projectUpgradePlan(
    plan,
    buildUpgradeExecutionTerminalArtifact(plan, { settlement: 'applied' })
  );
  expect(applied.presentation).toBe('applied');
  expect(formatUpgradePlanning(applied)).toMatch(/Status\W+applied(?=$|[\s;,()])/u);

  const preview = projectUpgradePreview(previewFromPlan(plan));
  expect(preview.presentation).toBe('preview');
  expect(formatUpgradePlanning(preview)).toMatch(/Upgrade\s+auth\/basic-session(?=$|[\s;,()])[^\n]*\bdry-run(?=$|[\s;,()])/u);
  expect(formatUpgradePlanning(preview)).toMatch(/Status\W+preview(?=$|[\s;,()])/u);

  await withTempWorkspace(async (workspaceRoot) => {
    const planPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);
    await writeJson(planPath, originalPlan);

    const { stdout } = await expectCliSuccess(workspaceRoot, ['upgrade', 'plan']);
    expectPlannedUpgrade(stdout);

    const json = await expectCliJson(workspaceRoot, ['upgrade', 'plan', '--json']);
    expect(json).toEqual(originalPlan);
  }, 'upgrade-planning-routing-');
});
