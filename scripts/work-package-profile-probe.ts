import path from 'node:path';

import { CodexDevelopmentVerificationDigest } from '../platform/shared/ci-evidence-contract.ts';
import {
  runObservedCommand,
  type ObservedCommandOptions,
  type ObservedCommandOutcome
} from '../platform/shared/observed-process.ts';
import type {
  WorkPackageGateIdentityProbeCompleteReasonV4,
  WorkPackageGateIdentityProbeEvidenceV4,
  WorkPackageGateIdentitySetEvidenceV1
} from './work-package-gate-contract.ts';

const PROFILE_PROBE_TIMEOUT_MS = 30_000;
const PROFILE_PROBE_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const MAPPING_ROOT =
  'Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppContainer\\Mappings';
const REGISTRY_PATH = `HKCU\\${MAPPING_ROOT}`;

const PROFILE_QUERY_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$mappingRoot = $args[0]',
  '$registryPath = $args[1]',
  'try { $root = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($mappingRoot, $false) } catch { exit 11 }',
  'if ($null -eq $root) { @{ disposition = "registry-root-absent"; values = @() } | ConvertTo-Json -Compress; exit 0 }',
  '$root.Dispose()',
  '$reg = Join-Path $env:SystemRoot "System32\\reg.exe"',
  '$lines = & $reg query $registryPath /s 2>$null',
  'if ($LASTEXITCODE -ne 0) { exit 7 }',
  '$values = foreach ($line in $lines) {',
  '  foreach ($match in [regex]::Matches($line.ToLowerInvariant(), "sec\\.sm3\\.[a-z0-9.]+")) { $match.Value }',
  '}',
  '@{ disposition = "observed"; values = @($values | Sort-Object -Unique) } | ConvertTo-Json -Compress'
].join('; ');

export interface WorkPackageAuthorityProbeBudget {
  readonly timeoutMs: number;
  readonly terminationDeadlineMs: number;
  readonly terminationGraceMs: number;
}

export type WorkPackageProfileProbeParseDisposition =
  | 'not-attempted'
  | 'json-invalid'
  | 'shape-invalid'
  | 'contract-invalid'
  | 'accepted';

export type WorkPackageProfileProbeClassification =
  | 'powershell-spawn-failed'
  | 'registry-open-failed'
  | 'reg-query-nonzero'
  | 'powershell-failed'
  | 'unexpected-stderr'
  | 'lifecycle-failed'
  | 'output-limit'
  | 'deadline'
  | 'parse-failed'
  | 'registry-root-absent'
  | 'observed'
  | 'not-applicable';

export interface WorkPackageProfileProbeDiagnosticV1 {
  readonly probe: 'app-container-profiles';
  readonly invocationDigest: string | null;
  readonly executableIdentityDigests: Readonly<{
    readonly powershell: string;
    readonly reg: string;
  }> | null;
  readonly budget: WorkPackageAuthorityProbeBudget | null;
  readonly attempted: boolean;
  readonly outcome: ObservedCommandOutcome | null;
  readonly outerDeadlineExceeded: boolean;
  readonly decode: Readonly<{
    readonly stage: WorkPackageProfileProbeParseDisposition;
    readonly disposition: 'observed' | 'registry-root-absent' | null;
    readonly identities: WorkPackageGateIdentitySetEvidenceV1 | null;
  }>;
  readonly classification: WorkPackageProfileProbeClassification;
}

export interface WorkPackageProfileProbeResult {
  readonly projectedProbe: WorkPackageGateIdentityProbeEvidenceV4;
  readonly diagnostic: WorkPackageProfileProbeDiagnosticV1;
}

interface WorkPackageProfileProbeDependencies {
  readonly platform: NodeJS.Platform;
  readonly systemRoot: string;
  readonly monotonicNowMs: () => number;
  readonly runCommand: typeof runObservedCommand;
  readonly beforeSpawn?: () => Promise<void>;
}

const DEFAULT_DEPENDENCIES: WorkPackageProfileProbeDependencies = Object.freeze({
  platform: process.platform,
  systemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? String.raw`C:\Windows`,
  monotonicNowMs: () => performance.now(),
  runCommand: runObservedCommand
});

function identitySetEvidence(values: readonly string[]): WorkPackageGateIdentitySetEvidenceV1 {
  const canonical = [...new Set(values)].sort();
  return Object.freeze({
    count: canonical.length,
    digest: CodexDevelopmentVerificationDigest(canonical)
  });
}

function completeIdentityProbe(
  reason: WorkPackageGateIdentityProbeCompleteReasonV4,
  values: readonly string[]
): WorkPackageGateIdentityProbeEvidenceV4 {
  return Object.freeze({ complete: true, reason, identities: identitySetEvidence(values) });
}

function unknownIdentityProbe(
  reason: 'deadline' | 'host-tool-failed' | 'lifecycle-failed' | 'output-limit' | 'parse-failed'
): WorkPackageGateIdentityProbeEvidenceV4 {
  return Object.freeze({ complete: false, reason, identities: null });
}

export function workPackageAuthorityProbeBudget(
  deadlineAtMs: number,
  nowMs: number
): WorkPackageAuthorityProbeBudget | null {
  const totalBudgetMs = Math.min(
    PROFILE_PROBE_TIMEOUT_MS,
    Math.floor(deadlineAtMs - nowMs)
  );
  if (totalBudgetMs < 3) return null;
  const terminationDeadlineMs = Math.max(
    1,
    Math.min(20_000, Math.floor(totalBudgetMs / 4))
  );
  return Object.freeze({
    timeoutMs: totalBudgetMs - terminationDeadlineMs,
    terminationDeadlineMs,
    terminationGraceMs: Math.max(1, Math.min(5_000, terminationDeadlineMs))
  });
}

export function workPackageProbeOutcomeAccepted(
  outcome: ObservedCommandOutcome,
  completedAtMs = 0,
  deadlineAtMs = Number.POSITIVE_INFINITY
): boolean {
  return outcome.status === 'exited' && outcome.exitCode === 0 &&
    !outcome.stdout.observerTruncated && !outcome.stderr.observerTruncated &&
    outcome.stderr.bytes === 0 && outcome.termination.treeClosed && completedAtMs < deadlineAtMs;
}

export function workPackageProbeFailureReason(
  outcome: ObservedCommandOutcome,
  completedAtMs: number,
  deadlineAtMs: number
): 'deadline' | 'host-tool-failed' | 'lifecycle-failed' | 'output-limit' | null {
  if (outcome.stdout.observerTruncated || outcome.stderr.observerTruncated) return 'output-limit';
  if (outcome.status === 'timed-out' || outcome.trigger === 'timed-out' || completedAtMs >= deadlineAtMs) {
    return 'deadline';
  }
  if (['lifecycle-failed', 'observer-failed', 'tree-unproven', 'termination-unproven']
    .includes(outcome.status) || outcome.termination.treeClosed !== true) return 'lifecycle-failed';
  return workPackageProbeOutcomeAccepted(outcome, completedAtMs, deadlineAtMs)
    ? null
    : 'host-tool-failed';
}

function executablePaths(systemRoot: string): Readonly<{
  powershell: string;
  reg: string;
  systemDirectory: string;
}> {
  const configuredRoot = path.isAbsolute(systemRoot) ? systemRoot : String.raw`C:\Windows`;
  const systemDirectory = path.join(configuredRoot, 'System32');
  return Object.freeze({
    powershell: path.join(systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    reg: path.join(systemDirectory, 'reg.exe'),
    systemDirectory
  });
}

export function workPackageProfileProbeExecutablePaths(systemRoot?: string): Readonly<{
  powershell: string;
  reg: string;
}> {
  const executables = executablePaths(systemRoot ?? DEFAULT_DEPENDENCIES.systemRoot);
  return Object.freeze({ powershell: executables.powershell, reg: executables.reg });
}

function classifyRejectedOutcome(outcome: ObservedCommandOutcome): WorkPackageProfileProbeClassification {
  if (outcome.stdout.observerTruncated || outcome.stderr.observerTruncated) return 'output-limit';
  if (outcome.status === 'timed-out' || outcome.trigger === 'timed-out') return 'deadline';
  if (['lifecycle-failed', 'observer-failed', 'tree-unproven', 'termination-unproven']
    .includes(outcome.status) || !outcome.termination.treeClosed) return 'lifecycle-failed';
  if (outcome.status === 'spawn-failed' && !outcome.started) return 'powershell-spawn-failed';
  if (outcome.status === 'exited' && outcome.exitCode === 11) return 'registry-open-failed';
  if (outcome.status === 'exited' && outcome.exitCode === 7) return 'reg-query-nonzero';
  if (outcome.status === 'exited' && outcome.exitCode === 0 && outcome.stderr.bytes > 0) {
    return 'unexpected-stderr';
  }
  return 'powershell-failed';
}

function classifyProbeFailure(
  failure: 'deadline' | 'host-tool-failed' | 'lifecycle-failed' | 'output-limit',
  outcome: ObservedCommandOutcome
): WorkPackageProfileProbeClassification {
  if (failure === 'deadline') return 'deadline';
  if (failure === 'lifecycle-failed') return 'lifecycle-failed';
  if (failure === 'output-limit') return 'output-limit';
  return classifyRejectedOutcome(outcome);
}

function parseProfileEnvelope(bytes: Buffer): Readonly<{
  stage: Exclude<WorkPackageProfileProbeParseDisposition, 'not-attempted'>;
  disposition: 'observed' | 'registry-root-absent' | null;
  values: readonly string[] | null;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString()) as unknown;
  } catch {
    return Object.freeze({ stage: 'json-invalid', disposition: null, values: null });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(['disposition', 'values']) ||
    !['observed', 'registry-root-absent'].includes(String((parsed as { disposition?: unknown }).disposition))) {
    return Object.freeze({ stage: 'shape-invalid', disposition: null, values: null });
  }
  const envelope = parsed as {
    readonly disposition: 'observed' | 'registry-root-absent';
    readonly values: unknown;
  };
  if (!Array.isArray(envelope.values) || envelope.values.some((value) =>
    typeof value !== 'string' || !/^sec\.sm3\.[a-z0-9.]+$/u.test(value)) ||
    (envelope.disposition === 'registry-root-absent' && envelope.values.length !== 0)) {
    return Object.freeze({ stage: 'contract-invalid', disposition: null, values: null });
  }
  return Object.freeze({
    stage: 'accepted',
    disposition: envelope.disposition,
    values: Object.freeze([...new Set(envelope.values as string[])].sort())
  });
}

export async function runWorkPackageProfileProbe(
  deadlineAtMs = Number.POSITIVE_INFINITY,
  dependencyOverrides: Partial<WorkPackageProfileProbeDependencies> = {}
): Promise<WorkPackageProfileProbeResult> {
  const dependencies = Object.freeze({ ...DEFAULT_DEPENDENCIES, ...dependencyOverrides });
  if (dependencies.platform !== 'win32') {
    return Object.freeze({
      projectedProbe: completeIdentityProbe('not-applicable', []),
      diagnostic: Object.freeze({
        probe: 'app-container-profiles',
        invocationDigest: null,
        executableIdentityDigests: null,
        budget: null,
        attempted: false,
        outcome: null,
        outerDeadlineExceeded: false,
        decode: Object.freeze({ stage: 'not-attempted', disposition: null, identities: null }),
        classification: 'not-applicable'
      })
    });
  }
  const executables = executablePaths(dependencies.systemRoot);
  const nowMs = dependencies.monotonicNowMs();
  const budget = workPackageAuthorityProbeBudget(deadlineAtMs, nowMs);
  if (budget === null) {
    return Object.freeze({
      projectedProbe: unknownIdentityProbe('deadline'),
      diagnostic: Object.freeze({
        probe: 'app-container-profiles',
        invocationDigest: null,
        executableIdentityDigests: null,
        budget: null,
        attempted: false,
        outcome: null,
        outerDeadlineExceeded: true,
        decode: Object.freeze({ stage: 'not-attempted', disposition: null, identities: null }),
        classification: 'deadline'
      })
    });
  }
  const args = Object.freeze([
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    PROFILE_QUERY_SCRIPT, MAPPING_ROOT, REGISTRY_PATH
  ]);
  const env = Object.freeze({
    PATH: '',
    SystemRoot: path.dirname(executables.systemDirectory) || dependencies.systemRoot,
    SYSTEMROOT: path.dirname(executables.systemDirectory) || dependencies.systemRoot,
    WINDIR: path.dirname(executables.systemDirectory) || dependencies.systemRoot
  });
  const options: ObservedCommandOptions = {
    ...(dependencies.beforeSpawn ? { beforeSpawn: dependencies.beforeSpawn } : {}),
    cwd: executables.systemDirectory,
    env,
    envMode: 'replace',
    maxObservedOutputBytes: PROFILE_PROBE_OUTPUT_LIMIT_BYTES,
    terminationDeadlineMs: budget.terminationDeadlineMs,
    terminationGraceMs: budget.terminationGraceMs,
    timeoutMs: budget.timeoutMs
  };
  const invocationDigest = CodexDevelopmentVerificationDigest({
    domain: 'work-package-profile-probe-invocation-v1',
    command: executables.powershell,
    args,
    cwd: options.cwd,
    env,
    envMode: options.envMode,
    maxObservedOutputBytes: options.maxObservedOutputBytes,
    terminationDeadlineMs: options.terminationDeadlineMs,
    terminationGraceMs: options.terminationGraceMs,
    timeoutMs: options.timeoutMs,
    authorityRevalidation: dependencies.beforeSpawn ? 'before-spawn-v1' : null
  });
  const executableIdentityDigests = Object.freeze({
    powershell: CodexDevelopmentVerificationDigest({
      domain: 'work-package-profile-probe-executable-v1',
      path: executables.powershell
    }),
    reg: CodexDevelopmentVerificationDigest({
      domain: 'work-package-profile-probe-executable-v1',
      path: executables.reg
    })
  });
  const stdoutChunks: Buffer[] = [];
  const outcome = await dependencies.runCommand(executables.powershell, args, {
    ...options,
    onOutput: (stream, chunk) => {
      if (stream === 'stdout') stdoutChunks.push(Buffer.from(chunk));
    }
  });
  const completedAtMs = dependencies.monotonicNowMs();
  const outerDeadlineExceeded = completedAtMs >= deadlineAtMs;
  const failure = workPackageProbeFailureReason(outcome, completedAtMs, deadlineAtMs);
  if (failure !== null) {
    return Object.freeze({
      projectedProbe: unknownIdentityProbe(failure),
      diagnostic: Object.freeze({
        probe: 'app-container-profiles',
        invocationDigest,
        executableIdentityDigests,
        budget,
        attempted: true,
        outcome,
        outerDeadlineExceeded,
        decode: Object.freeze({ stage: 'not-attempted', disposition: null, identities: null }),
        classification: classifyProbeFailure(failure, outcome)
      })
    });
  }
  const decoded = parseProfileEnvelope(Buffer.concat(stdoutChunks));
  if (decoded.stage !== 'accepted' || decoded.disposition === null || decoded.values === null) {
    return Object.freeze({
      projectedProbe: unknownIdentityProbe('parse-failed'),
      diagnostic: Object.freeze({
        probe: 'app-container-profiles',
        invocationDigest,
        executableIdentityDigests,
        budget,
        attempted: true,
        outcome,
        outerDeadlineExceeded,
        decode: Object.freeze({ stage: decoded.stage, disposition: null, identities: null }),
        classification: 'parse-failed'
      })
    });
  }
  const identities = identitySetEvidence(decoded.values);
  const projectedReason = decoded.disposition === 'registry-root-absent'
    ? 'namespace-absent'
    : decoded.disposition;
  return Object.freeze({
    projectedProbe: completeIdentityProbe(projectedReason, decoded.values),
    diagnostic: Object.freeze({
      probe: 'app-container-profiles',
      invocationDigest,
      executableIdentityDigests,
      budget,
      attempted: true,
      outcome,
      outerDeadlineExceeded,
      decode: Object.freeze({ stage: 'accepted', disposition: decoded.disposition, identities }),
      classification: decoded.disposition
    })
  });
}
