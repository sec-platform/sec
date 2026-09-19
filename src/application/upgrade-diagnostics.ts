import { upgradeDiagnosticsAttributionParts } from '../assurance/verification/review/contract/upgrade.ts';
import type { UpgradeDiagnostics } from '../semantics/upgrade/upgrade-artifact.ts';

export type UpgradeDiagnosticsSource = UpgradeDiagnostics;

export type UpgradeDiagnosticsView = Readonly<{
  phase: UpgradeDiagnostics['phase'];
  blockId: string;
  targetVersion: string;
  status: UpgradeDiagnostics['status'];
  failedCheck: string;
  errorCode: string;
  message: string;
  attribution: readonly string[];
}>;

export function projectUpgradeDiagnostics(diagnostics: UpgradeDiagnostics): UpgradeDiagnosticsView {
  return {
    phase: diagnostics.phase,
    blockId: diagnostics.blockId,
    targetVersion: diagnostics.targetVersion,
    status: diagnostics.status,
    failedCheck: diagnostics.failedCheck,
    errorCode: diagnostics.errorCode,
    message: diagnostics.message,
    attribution: upgradeDiagnosticsAttributionParts(diagnostics.details)
  };
}
