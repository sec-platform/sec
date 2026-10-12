import { expect, test } from 'bun:test';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readJson } from "../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { RepairPlan } from '../../src/semantics/repair/types.ts';
import { expectCliJson, runCliInProcess as runCli } from '../testkit/cli.ts';
import { withWorkspaceScenario } from '../testkit/workspace.ts';

test('repair reports failed verification as an owner-classified blocker and persists the same durable plan', async () => {
  await withWorkspaceScenario('composed-default', async (workspaceRoot) => {
    const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
    const failurePath = path.join(workspaceRoot, 'tests/unit/000-repair-failure.test.ts');
    const failureSource = 'export function runSuite(): void { throw new Error("independent repair unit failure"); }\n';
    await writeFile(failurePath, failureSource);
    const verification = await runCli(workspaceRoot, ['verify', '--lane', 'fast']);
    expect(verification.code).toBe(1);
    expect(verification.stderr).toContain('independent repair unit failure');

    const preview = await expectCliJson<RepairPlan>(
      workspaceRoot,
      ['repair', '--dry-run', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(preview.status).toBe('blocked');
    expect(preview.tasks).toEqual([]);
    expect(preview.blockers).toHaveLength(1);
    expect(preview.blockers?.[0]).toMatchObject({ boundary: 'unknown' });
    expect(preview.blockers?.[0]?.failurePoints[0]).toMatchObject({
      lane: 'fast',
      kind: 'unit',
      issueType: 'unknown',
      repairable: false
    });
    await expect(lstat(repairPlanPath)).rejects.toMatchObject({ code: 'ENOENT' });

    const applied = await runCli(workspaceRoot, ['repair', '--json', '--compact']);
    expect(applied.code).toBe(1);
    expect(applied.stderr).toContain('REPAIR-BLOCKED-001');
    const written = await readJson<RepairPlan>(repairPlanPath);
    expect(JSON.parse(applied.stdout)).toEqual(written);

    const readback = await expectCliJson<RepairPlan>(
      workspaceRoot,
      ['repair', 'plan', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(readback).toEqual(written);
    expect(await readFile(failurePath, 'utf8')).toBe(failureSource);
  });
}, 120000);

test('repair skips source mutation after passing verification and persists the terminal observation', async () => {
  await withWorkspaceScenario('locked-all-default', async (workspaceRoot) => {
    const result = await expectCliJson<RepairPlan>(
      workspaceRoot,
      ['repair', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    expect(result).toMatchObject({
      status: 'skipped',
      sourceVerificationStatus: 'passed',
      requiresVerification: false,
      tasks: []
    });
  });
}, 120000);
