import { CompilerError } from '../../compiler/errors.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { addGeneratedPaths } from '../../compiler/contract/lock-schema.ts';
import { classifyPreflightFailure } from '../../compiler/upgrade/planning.ts';
import { isEmptyDiagnosticsDetails } from '../../compiler/upgrade/failure.ts';
import { formatJsonFile } from '../../contracts/json-text.ts';
import type { CommitFence } from '../../contracts/commit-fence.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import {
  parseUpgradeExecutionTerminalJson,
  UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
  validateUpgradeDiagnostics,
  type UpgradeDiagnostics,
  type UpgradeExecutionTerminal,
  type UpgradePlan
} from '../../semantics/upgrade/upgrade-artifact.ts';
import { writeProvenance } from '../compilation/emit/write-provenance.ts';
import { publishExistingParentCanonicalWorkspaceFile } from '../filesystem/file-publication.ts';
import { writeJson } from '../filesystem/files.ts';
import {
  decodeExactUtf8,
  readOptionalRetainedOrdinaryFile
} from '../runtime-state/physical/runtime/retained-file-read.ts';
import { resolveWorkspaceArtifactPath } from '../workspace-context.ts';
import { requirePersistedUpgradeExecutionTerminal, requirePersistedUpgradePlan } from './artifact-readback.ts';

async function recordUpgradeGeneratedArtifact(
  workspaceRoot: string,
  lock: LockFile,
  artifactPaths: readonly string[],
  commitFence: CommitFence
): Promise<void> {
  addGeneratedPaths(lock, artifactPaths);
  await writeProvenance(workspaceRoot, lock, commitFence);
}

export async function publishUpgradePlan(
  workspaceRoot: string,
  plan: UpgradePlan,
  commitFence: CommitFence
): Promise<UpgradePlan> {
  await writeJson(
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan),
    plan,
    commitFence
  );
  const readback = requirePersistedUpgradePlan(workspaceRoot);
  if (readback.planRevision !== plan.planRevision) {
    throw new CompilerError('UPGRADE-BLOCKED-005', 'Upgrade plan readback differs from publication');
  }
  return readback;
}

export async function writeUpgradeDiagnostics(
  workspaceRoot: string,
  blockId: string,
  targetVersion: string,
  provenance:
    | {
        phase: 'planning';
        workspaceIdentityDigest: string;
        planningRequestRevision: `sha256:${string}`;
      }
    | {
        phase: 'apply' | 'recovery';
        plan: UpgradePlan;
        terminal: UpgradeExecutionTerminal;
      },
  error: CompilerError,
  lock: LockFile | null,
  commitFence: CommitFence
): Promise<void> {
  const upgradeDiagnosticsPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.upgradeDiagnostics
  );
  const details = isEmptyDiagnosticsDetails(error.details) ? undefined : error.details;
  const diagnostics: UpgradeDiagnostics = provenance.phase === 'planning'
    ? validateUpgradeDiagnostics({
        formatVersion: UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
        artifactKind: 'upgrade-diagnostics',
        status: 'blocked',
        phase: 'planning',
        workspaceIdentityDigest: provenance.workspaceIdentityDigest,
        planningRequestRevision: provenance.planningRequestRevision,
        blockId,
        targetVersion,
        failedCheck: classifyPreflightFailure(error.code),
        errorCode: error.code,
        message: error.message,
        ...(details === undefined ? {} : { details })
      })
    : validateUpgradeDiagnostics({
        formatVersion: UPGRADE_DIAGNOSTICS_FORMAT_VERSION,
        artifactKind: 'upgrade-diagnostics',
        status: 'blocked',
        phase: provenance.phase,
        workspaceIdentityDigest: provenance.plan.workspaceIdentityDigest,
        operationIdentityDigest: provenance.plan.operationIdentityDigest,
        planRevision: provenance.plan.planRevision,
        attemptRevision: provenance.terminal.attempt.attemptRevision,
        executionTerminalRevision: provenance.terminal.terminalRevision,
        blockId,
        targetVersion,
        failedCheck: classifyPreflightFailure(error.code),
        errorCode: error.code,
        message: error.message,
        ...(details === undefined ? {} : { details })
      });
  await writeJson(upgradeDiagnosticsPath, diagnostics, commitFence);
  if (lock === null) return;
  await recordUpgradeGeneratedArtifact(
    workspaceRoot,
    lock,
    provenance.phase === 'planning'
      ? [CI_ARTIFACT_FILES.upgradeDiagnostics]
      : [
          CI_ARTIFACT_FILES.upgradePlan,
          CI_ARTIFACT_FILES.upgradeExecutionTerminal,
          CI_ARTIFACT_FILES.upgradeDiagnostics
        ],
    commitFence
  );
}

export async function publishUpgradeExecutionTerminal(
  workspaceRoot: string,
  terminal: UpgradeExecutionTerminal,
  commitFence: CommitFence
): Promise<UpgradeExecutionTerminal> {
  await publishExistingParentCanonicalWorkspaceFile({
    workspaceRoot,
    targetPath: resolveWorkspaceArtifactPath(
      workspaceRoot,
      CI_ARTIFACT_FILES.upgradeExecutionTerminal
    ),
    bytes: Buffer.from(formatJsonFile(terminal), 'utf8'),
    label: 'Upgrade execution terminal',
    commitFence
  });
  const readback = requirePersistedUpgradeExecutionTerminal(workspaceRoot);
  if (readback.terminalRevision !== terminal.terminalRevision) {
    throw new CompilerError(
      'UPGRADE-BLOCKED-005',
      'Upgrade execution terminal readback differs from publication'
    );
  }
  return readback;
}

export function resolveUpgradeExecutionTerminalPublication(
  workspaceRoot: string,
  expected: UpgradeExecutionTerminal
): 'committed' | 'absent' | 'unknown' {
  try {
    const bytes = readOptionalRetainedOrdinaryFile(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
      'Upgrade execution terminal commit resolution'
    );
    if (bytes === null) return 'absent';
    const expectedBytes = Buffer.from(formatJsonFile(expected), 'utf8');
    if (!Buffer.from(bytes).equals(expectedBytes)) return 'unknown';
    const parsed = parseUpgradeExecutionTerminalJson(
      decodeExactUtf8(bytes, 'Upgrade execution terminal commit resolution')
    );
    return parsed.terminalRevision === expected.terminalRevision ? 'committed' : 'unknown';
  } catch {
    return 'unknown';
  }
}
