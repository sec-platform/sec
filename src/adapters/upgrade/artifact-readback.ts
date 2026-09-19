import path from 'node:path';

import {
  decodeExactUtf8,
  readOptionalRetainedOrdinaryLeaf,
  retainOptionalDirectory
} from '../runtime-state/physical/runtime/retained-file-read.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { resolveWorkspaceArtifactPath } from "../workspace-context.ts";
import { CompilerError } from '../../compiler/errors.ts';
import {
  parseUpgradeDiagnosticsJson,
  parseUpgradeExecutionTerminalJson,
  parseUpgradePlanJson,
  validateUpgradeArtifactSet,
  type UpgradeArtifactSet,
  type UpgradeExecutionTerminal,
  type UpgradePlan
} from '../../semantics/upgrade/upgrade-artifact.ts';

function readOptionalCanonicalJson<T>(
  parent: NonNullable<ReturnType<typeof retainOptionalDirectory>>,
  absolutePath: string,
  label: string,
  parse: (source: string) => T
): T | null {
  const bytes = readOptionalRetainedOrdinaryLeaf(parent, path.basename(absolutePath));
  return bytes === null ? null : parse(decodeExactUtf8(bytes, label));
}

/** Reads the complete persisted Upgrade artifact set under one retained parent. */
export function readUpgradeArtifactSet(workspaceRoot: string): UpgradeArtifactSet {
  const planPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);
  const executionTerminalPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.upgradeExecutionTerminal
  );
  const diagnosticsPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.upgradeDiagnostics
  );
  const parentPath = path.dirname(planPath);
  if (path.dirname(executionTerminalPath) !== parentPath || path.dirname(diagnosticsPath) !== parentPath) {
    throw new Error('Upgrade artifacts must share one canonical parent.');
  }
  const parent = retainOptionalDirectory(parentPath, 'Upgrade artifact parent');
  return validateUpgradeArtifactSet({
    plan: parent === null
      ? null
      : readOptionalCanonicalJson(parent, planPath, 'Upgrade plan', parseUpgradePlanJson),
    executionTerminal: parent === null
      ? null
      : readOptionalCanonicalJson(
          parent,
          executionTerminalPath,
          'Upgrade execution terminal',
          parseUpgradeExecutionTerminalJson
        ),
    diagnostics: parent === null
      ? null
      : readOptionalCanonicalJson(
          parent,
          diagnosticsPath,
          'Upgrade diagnostics',
          parseUpgradeDiagnosticsJson
        )
  });
}


function requireCanonicalUpgradeJson<T>(
  absolutePath: string,
  label: string,
  parse: (source: string) => T,
  missingMessage: string
): T {
  const parent = retainOptionalDirectory(path.dirname(absolutePath), `${label} parent`);
  if (parent === null) {
    throw new CompilerError('UPGRADE-BLOCKED-005', missingMessage);
  }
  const bytes = readOptionalRetainedOrdinaryLeaf(parent, path.basename(absolutePath));
  if (bytes === null) {
    throw new CompilerError('UPGRADE-BLOCKED-005', missingMessage);
  }
  return parse(decodeExactUtf8(bytes, label));
}

export function requirePersistedUpgradePlan(workspaceRoot: string): UpgradePlan {
  return requireCanonicalUpgradeJson(
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan),
    'Upgrade plan readback',
    parseUpgradePlanJson,
    'Upgrade plan readback is absent after publication'
  );
}

export function requirePersistedUpgradeExecutionTerminal(
  workspaceRoot: string
): UpgradeExecutionTerminal {
  return requireCanonicalUpgradeJson(
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
    'Upgrade execution terminal readback',
    parseUpgradeExecutionTerminalJson,
    'Upgrade execution terminal readback is absent after publication'
  );
}
