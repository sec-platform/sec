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
  // State, migration identity and verification requirements matter; prose layout does not.
  function expectPlannedUpgrade(text: string): void {
    for (const meaning of [
      /Upgrade\s+auth\/basic-session(?=$|[\s;,()])[^\n]*0\.1\.0(?=$|[\s;,()])[^\n]*0\.1\.1(?=$|[\s;,()])/u,
      /Status\W+planned(?=$|[\s;,()])/u,
      /\bmigrations\W+1(?=$|[\s;,()])/u,
      /\bpreflight checks\W+9(?=$|[\s;,()])/u,
      /Preflight evidence\W+5(?=$|[\s;,()])/u,
      /Requires verification\W+true(?=$|[\s;,()])[^\n]*\b1 migrations(?=$|[\s;,()])/u,
    ]) expect(text).toMatch(meaning);
    const lines = text.split('\n');
    expect(lines.filter(line => /^Migration (?!kinds:)/u.test(line))
      .map(line => line.split(';').map(field => field.trim()).sort())).toEqual([[
      'Migration mig-auth-session-refresh: file-replace',
      'target=src/installed/auth/session.ts',
      'source=files/src/installed/auth/session.ts',
      'role=file', 'requiresVerification=true'
    ].sort()]);
    for (const [prefix, value] of [
      ['Migration kinds:', 'file-replace=1'],
      ['Operation roles:', 'file=1'],
      ['Impacts:', 'src/installed/auth/session.ts']
    ] as const) expect(lines.find(line => line.startsWith(prefix))?.slice(prefix.length).trim()).toBe(value);
    expect(lines.filter(line => /^Preflight (?!evidence:)/u.test(line))
      .map(line => line.slice('Preflight '.length, line.indexOf(':')))).toEqual([
      'version-range', 'migration-entries', 'migration-targets'
    ]);
    for (const check of ['version-range', 'migration-entries', 'migration-targets']) {
      expect(text).toMatch(new RegExp(`Preflight ${check}\\W+passed(?=$|[\\s;,()])[^\\n]*\\bevidence=1(?=$|[\\s;,()])`, 'u'));
    }
  }

  const applied = projectUpgradePlan(
    plan,
    buildUpgradeExecutionTerminalArtifact(plan, { settlement: 'applied' })
  );
  expect(applied.presentation).toBe('applied');
  expect(formatUpgradePlanning(applied)).toMatch(/Status\W+applied(?=$|[\s;,()])/u);

  const preview = projectUpgradePreview(previewFromPlan(plan));
  expect(preview.presentation).toBe('preview');
  const previewText = formatUpgradePlanning(preview);
  expect(previewText).toMatch(/Upgrade\s+auth\/basic-session(?=$|[\s;,()])[^\n]*\bdry-run(?=$|[\s;,()])/u);
  expect(previewText).toMatch(/Status\W+preview(?=$|[\s;,()])/u);

  await withTempWorkspace(async (workspaceRoot) => {
    const planPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);
    await writeJson(planPath, plan);

    const { stdout } = await expectCliSuccess(workspaceRoot, ['upgrade', 'plan']);
    expectPlannedUpgrade(stdout);

    const json = await expectCliJson(workspaceRoot, ['upgrade', 'plan', '--json']);
    expect(json).toEqual(plan);
  }, 'upgrade-planning-routing-');
});
