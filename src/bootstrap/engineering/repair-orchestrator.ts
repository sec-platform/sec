import path from 'node:path';
import { readOptionalRetainedJson } from '../../adapters/runtime-state/physical/runtime/retained-file-read.ts';
import type { RepairPlan } from '../../semantics/repair/types.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../assurance/verification/contract/types.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { resolveWorkspaceArtifactPath } from "../../adapters/workspace-context.ts";
import type {
  LockFile
} from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { assertPassStatus } from "../../compiler/contract/lock-schema.ts";
import { readLockFile, saveLock } from "../../adapters/workspace/lock.ts";
import {
  buildRepairPlan,
  writeRepairPlan
} from '../../adapters/verification/repair/build-repair-plan.ts';

type RepairInputs = Readonly<{
  lock: LockFile;
  repairPlan: RepairPlan;
}>;

function loadRepairInputs(workspaceRoot: string): RepairInputs {
  const verificationReportPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.verificationReport
  );
  const lock = readLockFile(workspaceRoot);

  assertPassStatus(
    lock,
    'verify',
    'pending',
    new CompilerError('REPAIR-BLOCKED-002', 'verify must run before repair'),
    'differs'
  );

  const report = readOptionalRetainedJson<VerificationReport>(
    verificationReportPath,
    'Repair Verification report'
  );
  if (report === null) {
    throw new CompilerError('REPAIR-BLOCKED-002', 'verification-report.json is missing');
  }

  return Object.freeze({
    lock,
    repairPlan: buildRepairPlan(report)
  });
}

async function previewRepairWorkspace(workspaceRoot: string): Promise<RepairInputs> {
  const inputs = loadRepairInputs(workspaceRoot);
  // Preview is an observation only. A blocked/skipped plan is useful preview
  // output and must not mutate Lock status or persist a control artifact.
  return inputs;
}

export async function repairWorkspace(
  workspaceRoot = process.cwd(),
  options: { dryRun?: boolean } = {},
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<{ lock: LockFile; repairPlan: RepairPlan }> {
  workspaceRoot = path.resolve(workspaceRoot);
  if (options.dryRun) {
    const { lock, repairPlan } = await previewRepairWorkspace(workspaceRoot);
    return { lock, repairPlan };
  }

  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async (token) => {
    const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, token);
    const { lock, repairPlan } = loadRepairInputs(workspaceRoot);

    try {
      if (repairPlan.status === 'blocked') {
        lock.passStatus.repair = 'failed';
        await writeRepairPlan(workspaceRoot, repairPlan, lock, commitFence);
        throw new CompilerError(
          'REPAIR-BLOCKED-001',
          repairPlan.blockers?.[0]?.reason ?? 'Repair is blocked for current verification failure',
          { blockers: repairPlan.blockers ?? [] }
        );
      }
      lock.passStatus.repair = 'skipped';
      await writeRepairPlan(workspaceRoot, repairPlan, lock, commitFence);
      return { lock, repairPlan };
    } catch (error) {
      lock.passStatus.repair = 'failed';
      await saveLock(workspaceRoot, lock, commitFence);
      throw error;
    }
  });
}
