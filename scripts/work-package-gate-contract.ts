import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { CodexDevelopmentVerificationDigest } from '../platform/shared/ci-evidence-contract.ts';
import {
  CodexDevelopmentParseWorkPackageManifestV1,
  CodexDevelopmentWorkPackageManifestDigest
} from './codex/work-package-contract.ts';

export const WORK_PACKAGE_GATE_EVIDENCE_SCHEMA_V1 = 'codex-work-package-gate-evidence-v1' as const;
export const WORK_PACKAGE_GATE_EVIDENCE_SCHEMA_V4 = 'codex-work-package-gate-evidence-v4' as const;
export const WORK_PACKAGE_GATE_EVENT_SCHEMA_V1 = 'codex-work-package-gate-event-v1' as const;
export const WORK_PACKAGE_GATE_EVENT_SCHEMA_V4 = 'codex-work-package-gate-event-v4' as const;
export const WORK_PACKAGE_GATE_STATE_SCHEMA_V1 = 'codex-work-package-gate-state-v1' as const;
export const WORK_PACKAGE_GATE_STATE_SCHEMA_V4 = 'codex-work-package-gate-state-v4' as const;
export const WORK_PACKAGE_GATE_CHECKPOINT_SCHEMA_V4 = 'codex-work-package-gate-checkpoint-v4' as const;
export const WORK_PACKAGE_GATE_EXECUTION_MANIFEST_ID = 'sm3-r2-bounded-runtime-gate-v1' as const;
export const WORK_PACKAGE_GATE_EXECUTION_MANIFEST_PATH =
  'docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md' as const;
export const WORK_PACKAGE_GATE_EXECUTION_MANIFEST_DIGEST =
  'sha256:158e813f64b958510357d86240d85ee3bb084b81e9f95033806ee48360815951' as const;
const WORK_PACKAGE_GATE_R2_EXECUTION_MANIFEST_ID = WORK_PACKAGE_GATE_EXECUTION_MANIFEST_ID;
const WORK_PACKAGE_GATE_R2_EXECUTION_MANIFEST_PATH = WORK_PACKAGE_GATE_EXECUTION_MANIFEST_PATH;
const WORK_PACKAGE_GATE_R2_EXECUTION_MANIFEST_DIGEST = WORK_PACKAGE_GATE_EXECUTION_MANIFEST_DIGEST;
export const WORK_PACKAGE_GATE_EXECUTION_MANIFEST_ID_V4 = 'sm3-r3-actionable-runtime-gate-v4' as const;
export const WORK_PACKAGE_GATE_EXECUTION_MANIFEST_PATH_V4 =
  'docs/work-packages/sm3-r3-actionable-runtime-gate-v4.md' as const;
export const WORK_PACKAGE_GATE_EXECUTION_MANIFEST_DIGEST_V4 =
  'sha256:752d8c32c01ecf67cda207a900953493d75ab1c949c97c44cb7f0eb8e0ab3d24' as const;
export const WORK_PACKAGE_GATE_SELECTION_MANIFEST_ID = 'sm3-r1-focused-blocker-repair-v1' as const;
export const WORK_PACKAGE_GATE_SELECTION_MANIFEST_PATH =
  'docs/work-packages/sm3-r1-focused-blocker-repair-v1.md' as const;
export const WORK_PACKAGE_GATE_SELECTION_MANIFEST_DIGEST =
  'sha256:a19487b18cdcb23c2c85c189253a0aa8bfd1229e5f9fd4a6a62c919687367af6' as const;
export const WORK_PACKAGE_GATE_ARGV_DIGEST =
  'sha256:edf2c83f4b2a57e6d218f058fccba3f754eaf9fde834f96b57b2cc296403518d' as const;
export const WORK_PACKAGE_GATE_RUN_DIRECTORY_V4 = '.tmp/sm3-r3-v4-work-package-gate' as const;
export const WORK_PACKAGE_GATE_RUN_DIRECTORY_IDENTITY_DIGEST_V4 =
  'sha256:460b94157868151fac54fdc20a7e362afc485a59cc15ef578b49c3e7f44b53d7' as const;
export const WORK_PACKAGE_GATE_NAMESPACE_V4 = 'gate-460b94157868151fac54fdc20a7e362a-owned' as const;
export const WORK_PACKAGE_GATE_NAMESPACE_IDENTITY_DIGEST_V4 =
  'sha256:f27ef9263db647480c16092911eb1a1c75f1bf4b4878477e9f8e558942310cf2' as const;
export const WORK_PACKAGE_GATE_SNAPSHOT_IDENTITY_DIGEST_V4 =
  'sha256:79ed001223508de924f5f173aaaabc443af17fdb87a29a5ee29d4f944b56fd77' as const;
export const WORK_PACKAGE_GATE_NAMESPACE_ROOT_IDENTITY_DIGEST_V4 =
  'sha256:421ddb30ba1977e8fff3bba2cad54de7e9c5fb547519d4d79587ca2cd3f75c81' as const;

export const WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4 = Object.freeze({
  'docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json': 'sha256:6acd57b02a319268b2ce2b0e81508894addd71b9d20d37d6d463c286a90fe8a3',
  'docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json': 'sha256:205ce268f49596d4b289f555f71a88d5012b805d53941b9f729a4a29d6625e34',
  'docs/work-packages/sm3-r1-focused-blocker-repair-v1.md': 'sha256:a19487b18cdcb23c2c85c189253a0aa8bfd1229e5f9fd4a6a62c919687367af6',
  'docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md': 'sha256:158e813f64b958510357d86240d85ee3bb084b81e9f95033806ee48360815951',
  'docs/work-packages/sm3-r3-actionable-runtime-gate-v1.md': 'sha256:9f22ea4bab729864adb2a570338b6fb4f9fd9991cda8c1281a7ede101e6923ca',
  'docs/work-packages/sm3-r3-actionable-runtime-gate-v2.md': 'sha256:c52948a492cdd90b55b5716b250f1756daa84547265c1f5520b2e2e2c5bddb04',
  'docs/work-packages/sm3-r3-actionable-runtime-gate-v3.md': 'sha256:40ca3a7a81ee630100001786c45daf50584df86c09bbb29b16a1a864d08122c3',
  'platform/compiler/compose/template-engine.ts': 'sha256:4244c932ee62cbaa95deb948edc95a086cb9dcd913546c2dd24199c276fff0d0',
  'platform/compiler/emit/write-local-views.ts': 'sha256:e5d4ac83a590c96bdab6b6de063cfd5c4610e88265e68acdea1a3d5078749710',
  'platform/compiler/semantic-mutation/mutation-recovery-record.ts': 'sha256:a48cd6c1020c3893d5ffa907f9f7242cdd575affb4b12406da41065fad7d522b',
  'platform/compiler/semantic-mutation/mutation-terminal-record.ts': 'sha256:0fad4a395f81581e24e7ebbcce27917d7d432bc94b020463fb0ed26b0f45a743',
  'platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts': 'sha256:bb26bb576b1efe91a92bbde3487c26683d1643f30d762648e91820238565c45e',
  'platform/orchestrator/workspace-orchestrator.ts': 'sha256:c5a2a0bb78928b0193cd7caa99756923f7fe75a9718fd80c1aa7aaf3cde02007',
  'platform/shared/observed-process.ts': 'sha256:fcc8af07f57b47ce8bd553dee3f44f3392b6de1bb69e550d643c9192b0b252df',
  'platform/shared/windows-appcontainer-executor.ts': 'sha256:ed9c918dd2109d1cab3100496232838c5f6ba1badbaa115d292c24d8b238457f',
  'platform/shared/windows-appcontainer-native-helper.ts': 'sha256:fafe83d7ba029c31bdf99c1a64e35f1c063f687021b7f53652d2cf04a7760944',
  'platform/shared/workspace-write-lease.ts': 'sha256:3b4adf7cfcb1857f59bb17e3f0a9ce25d571d1dfd740457148d346f29de38d68',
  'tests/contract/semantic-mutation-apply-contract.test.ts': 'sha256:1b6ea1100ff79c6f22fa4f198549a6cd0d8647024ac3479ec02eaae04aaf3a24',
  'tests/integration/pipeline-workspace-write-lease.test.ts': 'sha256:e039203824a945c0e097d57cce4b3fd1949ef51a929e920724b9295698644ef1',
  'tests/unit/semantic-mutation-apply.test.ts': 'sha256:7035519278b6717f036af2dccdfce87cf0886bada066ec4e4a113460ddb3ffd6',
  'tests/unit/semantic-mutation-isolated-child-fence.test.ts': 'sha256:d109c09ea089b11a226a52aed99142049ea5f820cdad92f55f240874490fd82f',
  'tests/unit/semantic-mutation-runtime-materialization.test.ts': 'sha256:fccad2edfddc5a49d961d8c7f800ad0b6500af30c31fd262517ef2543f5d31b1',
  'tests/unit/windows-appcontainer-executor.test.ts': 'sha256:2ee690a213bd4e5e834a9e25e8dd3c9ffab14b50c1057975f537a945b80917ae',
  'tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts': 'sha256:00041f830b808f071ce4f289108a34b60a1fec9a18bebfe01603e73c630a8ea3',
  'tests/unit/workspace-write-lease.test.ts': 'sha256:6536d2cd28a520be241bfe2ecb07c81706afd293a55fd29f4f4dfceeec07fa87'
} as const);

export const WORK_PACKAGE_GATE_LOCAL_ARTIFACT_LEDGER_V4 = Object.freeze({
  '.tmp/sm3-r2-work-package-gate/evidence.json': 'sha256:17c86874b0370a19c1171ed28c275f6cb5315f96e5b7512fb89135b4e04143be',
  '.tmp/sm3-r2-work-package-gate/events.jsonl': 'sha256:cd0adb9c928b82dbd184d755b95e8199a6e03ef03373067a0a0cc9c6466585e4',
  '.tmp/sm3-r2-work-package-gate/checkpoint.json': 'sha256:3d1954c975b19c441d01ac46c2504fc2f20b32f27f84087b39364a0084b0f92a',
  '.tmp/sm3-r2-work-package-gate/state.json': 'sha256:d7406514c1035c03f0d11cffce32154efc75bf08f1aeb6f68a23fb908e81c52a'
} as const);

export const WORK_PACKAGE_GATE_PROTECTED_LEDGER_DIGEST_V4 =
  CodexDevelopmentVerificationDigest({
    custody: WORK_PACKAGE_GATE_CUSTODY_LEDGER_V4,
    localArtifacts: WORK_PACKAGE_GATE_LOCAL_ARTIFACT_LEDGER_V4
  });

export type WorkPackageGateStatus = 'passed' | 'failed' | 'timed-out' | 'unknown';
export type WorkPackageGateEventKind =
  | 'started'
  | 'heartbeat'
  | 'deadline'
  | 'termination'
  | 'recovery'
  | 'residue'
  | 'completed';

export interface WorkPackageGateSelectionV1 {
  readonly executionManifestId: string;
  readonly executionManifestPath: string;
  readonly executionManifestDigest: string;
  readonly selectionManifestId: string;
  readonly selectionManifestPath: string;
  readonly selectionManifestDigest: string;
  readonly selectionIndex: number;
  readonly argv: readonly string[];
  readonly argvDigest: string;
  readonly testFiles: readonly string[];
  readonly testFileCount: 39;
  readonly perTestTimeoutMs: 600_000;
}

export interface WorkPackageGateStreamEvidenceV1 {
  readonly bytes: number;
  readonly digest: string;
  readonly observerTruncated: boolean;
}

export interface WorkPackageGateTerminationEvidenceV1 {
  readonly requested: boolean;
  readonly gracefulAttempted: boolean;
  readonly forcedAttempted: boolean;
  readonly childCloseObserved: boolean;
  readonly streamsDrained: boolean;
  readonly treeClosed: boolean;
}

export interface WorkPackageGateChildEvidenceV1 {
  readonly status: string;
  readonly trigger: string | null;
  readonly started: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly stdout: WorkPackageGateStreamEvidenceV1;
  readonly stderr: WorkPackageGateStreamEvidenceV1;
  readonly termination: WorkPackageGateTerminationEvidenceV1;
}

export interface WorkPackageGateIdentitySetEvidenceV1 {
  readonly count: number;
  readonly digest: string;
}

export type WorkPackageGateIdentityProbeCompleteReasonV4 =
  | 'observed'
  | 'not-applicable'
  | 'namespace-absent';

export type WorkPackageGateIdentityProbeUnknownReasonV4 =
  | 'not-probed'
  | 'deadline'
  | 'host-tool-failed'
  | 'lifecycle-failed'
  | 'output-limit'
  | 'parse-failed'
  | 'identity-changed';

export type WorkPackageGateIdentityProbeEvidenceV4 =
  | Readonly<{
    complete: true;
    reason: WorkPackageGateIdentityProbeCompleteReasonV4;
    identities: WorkPackageGateIdentitySetEvidenceV1;
  }>
  | Readonly<{
    complete: false;
    reason: WorkPackageGateIdentityProbeUnknownReasonV4;
    identities: null;
  }>;

export interface WorkPackageGateResidueCensusV1 {
  readonly workspaceRoots: number;
  readonly recoveryOwners: number;
  readonly pendingOwners: number;
  readonly nativeResults: number;
  readonly writerLeases: number;
  readonly appContainerProfiles: WorkPackageGateIdentitySetEvidenceV1 | null;
  readonly aclPresentOwners: WorkPackageGateIdentitySetEvidenceV1 | null;
}

export interface WorkPackageGateStructureCountsV4 {
  readonly workspaceRoots: number;
  readonly recoveryOwners: number;
  readonly pendingOwners: number;
  readonly nativeResults: number;
  readonly writerLeases: number;
}

export type WorkPackageGateStructureProbeEvidenceV4 =
  | Readonly<{
    complete: true;
    reason: 'observed' | 'namespace-absent';
    counts: WorkPackageGateStructureCountsV4;
    recoveryAuthorities: WorkPackageGateIdentitySetEvidenceV1;
  }>
  | Readonly<{
    complete: false;
    reason: 'not-probed' | 'deadline' | 'scan-failed' | 'identity-changed';
    counts: null;
    recoveryAuthorities: null;
  }>;

export interface WorkPackageGateResidueCensusV4 {
  readonly structure: WorkPackageGateStructureProbeEvidenceV4;
  readonly aclPresentOwners: WorkPackageGateIdentityProbeEvidenceV4;
}

export interface WorkPackageGateDiagnosticV4 {
  readonly status: 'actionable' | 'non-actionable';
  readonly selectionIndexes: readonly number[];
  readonly failureMarkerCount: number;
  readonly unmappedMarkerCount: number;
  readonly malformedMarkerCount: number;
  readonly oversizedLineCount: number;
  readonly utf8Invalid: boolean;
  readonly ansiInvalid: boolean;
  readonly observerTruncated: boolean;
  readonly parserFailure: boolean;
}

export interface WorkPackageGateEventV1 {
  readonly schema: typeof WORK_PACKAGE_GATE_EVENT_SCHEMA_V1;
  readonly sequence: number;
  readonly kind: WorkPackageGateEventKind;
  readonly elapsedMs: number;
  readonly phase: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly subjectDigest: string | null;
  readonly previousDigest: string | null;
  readonly eventDigest: string;
}

export interface WorkPackageGateEventV4 extends Omit<WorkPackageGateEventV1, 'schema' | 'kind'> {
  readonly schema: typeof WORK_PACKAGE_GATE_EVENT_SCHEMA_V4;
  readonly kind: Exclude<WorkPackageGateEventKind, 'heartbeat'>;
}

export interface WorkPackageGateStateV1 {
  readonly schema: typeof WORK_PACKAGE_GATE_STATE_SCHEMA_V1;
  readonly runId: string;
  readonly status: 'running' | WorkPackageGateStatus;
  readonly phase: string;
  readonly elapsedMs: number;
  readonly sequence: number;
  readonly journalDigest: string | null;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}

export interface WorkPackageGateStateV4 extends Omit<WorkPackageGateStateV1, 'schema'> {
  readonly schema: typeof WORK_PACKAGE_GATE_STATE_SCHEMA_V4;
}

export interface WorkPackageGateEvidenceDraftV1 {
  readonly runId: string;
  readonly status: WorkPackageGateStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly selection: WorkPackageGateSelectionV1;
  readonly repository: {
    readonly headSha: string;
    readonly treeSha: string;
    readonly headShaAfter: string | null;
    readonly treeShaAfter: string | null;
    readonly worktreeBeforeDigest: string;
    readonly worktreeAfterDigest: string | null;
    readonly executionSnapshotDigest: string;
    readonly executionSnapshotAfterDigest: string | null;
    readonly executionSnapshotRemoved: boolean;
  };
  readonly timeouts: {
    readonly watchdogMs: number;
    readonly cleanupMs: number;
  };
  readonly child: WorkPackageGateChildEvidenceV1;
  readonly recovery: {
    readonly attempted: boolean;
    readonly complete: boolean;
    readonly reason: 'not-needed' | 'authority-preserved' | 'completed' | 'failed';
  };
  readonly residue: {
    readonly before: WorkPackageGateResidueCensusV1 | null;
    readonly after: WorkPackageGateResidueCensusV1 | null;
    readonly namespaceRemoved: boolean;
  };
  readonly journal: {
    readonly lastSequence: number;
    readonly digest: string;
  };
}

export type WorkPackageGateEvidenceV1 = WorkPackageGateEvidenceDraftV1 & {
  readonly schema: typeof WORK_PACKAGE_GATE_EVIDENCE_SCHEMA_V1;
  readonly evidenceDigest: string;
};

export interface WorkPackageGateExecutionAuthorityV4 {
  readonly protectedLedgerDigest: string;
  readonly runDirectoryIdentityDigest: string;
  readonly namespaceIdentityDigest: string;
  readonly snapshotIdentityDigest: string;
  readonly namespaceRootIdentityDigest: string;
}

export interface WorkPackageGateRecoveryEvidenceV4 {
  readonly attempted: boolean;
  readonly complete: boolean;
  readonly reason: 'not-needed' | 'authority-preserved' | 'completed' | 'failed';
  readonly authorization: WorkPackageGateIdentitySetEvidenceV1 | null;
}

export interface WorkPackageGateEvidenceDraftV4 extends Omit<
  WorkPackageGateEvidenceDraftV1,
  'recovery' | 'residue'
> {
  readonly authority: WorkPackageGateExecutionAuthorityV4;
  readonly diagnostic: WorkPackageGateDiagnosticV4;
  readonly recovery: WorkPackageGateRecoveryEvidenceV4;
  readonly residue: {
    readonly preflight: WorkPackageGateResidueCensusV4 | null;
    readonly postChild: WorkPackageGateResidueCensusV4 | null;
    readonly postRecovery: WorkPackageGateResidueCensusV4 | null;
    readonly final: WorkPackageGateResidueCensusV4 | null;
    readonly namespaceRemovalAttempted: boolean;
    readonly namespaceRemoved: boolean;
  };
}

export type WorkPackageGateEvidenceV4 = WorkPackageGateEvidenceDraftV4 & {
  readonly schema: typeof WORK_PACKAGE_GATE_EVIDENCE_SCHEMA_V4;
  readonly evidenceDigest: string;
};

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} keys are invalid`);
  }
}

function plainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function digest(value: unknown): string {
  return CodexDevelopmentVerificationDigest(value);
}

function normalizedManifestPath(value: string, label: string): string {
  if (!/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(value)) {
    throw new Error(`${label} must be a canonical Work Package path`);
  }
  return value;
}

function parseOwnerBatch(command: string): {
  readonly argv: readonly string[];
  readonly testFiles: readonly string[];
} {
  if (command.trim() !== command || /\s{2,}|[\t\r\n'"`|&;<>$()]/u.test(command)) {
    throw new Error('Gate selection command contains shell or non-canonical whitespace syntax');
  }
  const argv = command.split(' ');
  if (argv[0] !== 'bun' || argv[1] !== 'test' || argv.at(-2) !== '--timeout' || argv.at(-1) !== '600000') {
    throw new Error('Gate selection must be one bun test command with the frozen 600000 ms timeout');
  }
  const testFiles = argv.slice(2, -2);
  if (testFiles.length !== 39 || new Set(testFiles).size !== 39) {
    throw new Error('Gate selection must contain exactly 39 unique test files');
  }
  for (const file of testFiles) {
    if (!/^tests\/(?:unit|contract|integration)\/[a-z0-9][a-z0-9./-]*\.test\.ts$/u.test(file) ||
      file.includes('//') || file.split('/').some((segment) => segment === '.' || segment === '..')) {
      throw new Error('Gate selection contains a non-canonical test path');
    }
  }
  return { argv: Object.freeze(argv), testFiles: Object.freeze(testFiles) };
}

export function parseFrozenWorkPackageGateSelection(input: {
  readonly executionManifestSource: string;
  readonly executionManifestPath: string;
  readonly selectionManifestSource: string;
  readonly selectionManifestPath: string;
  readonly selectionIndex: number;
}): WorkPackageGateSelectionV1 {
  const executionManifestPath = normalizedManifestPath(
    input.executionManifestPath,
    'Execution manifest path'
  );
  const selectionManifestPath = normalizedManifestPath(
    input.selectionManifestPath,
    'Selection manifest path'
  );
  if (!Number.isSafeInteger(input.selectionIndex) || input.selectionIndex < 0) {
    throw new Error('Selection index must be a non-negative safe integer');
  }
  const execution = CodexDevelopmentParseWorkPackageManifestV1(
    input.executionManifestSource,
    executionManifestPath
  );
  const selection = CodexDevelopmentParseWorkPackageManifestV1(
    input.selectionManifestSource,
    selectionManifestPath
  );
  if (execution.base !== selection.base) throw new Error('Execution and selection manifests must share a base');
  const selectionManifestDigest = CodexDevelopmentWorkPackageManifestDigest(
    input.selectionManifestSource
  );
  const executionManifestDigest = CodexDevelopmentWorkPackageManifestDigest(
    input.executionManifestSource
  );
  if (executionManifestPath !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_PATH ||
    execution.id !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_ID ||
    executionManifestDigest !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_DIGEST ||
    selectionManifestPath !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_PATH ||
    selection.id !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_ID ||
    input.selectionIndex !== 0 ||
    selectionManifestDigest !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_DIGEST) {
    throw new Error('Gate selection does not match the exact frozen R1/R2 binding');
  }
  const command = selection.tests[input.selectionIndex];
  if (command === undefined) throw new Error('Selection index is outside the frozen manifest');
  const parsed = parseOwnerBatch(command);
  const argvDigest = digest(parsed.argv);
  if (argvDigest !== WORK_PACKAGE_GATE_ARGV_DIGEST) {
    throw new Error('Gate selection argv does not match the frozen owner batch');
  }
  return Object.freeze({
    executionManifestId: execution.id,
    executionManifestPath,
    executionManifestDigest,
    selectionManifestId: selection.id,
    selectionManifestPath,
    selectionManifestDigest,
    selectionIndex: input.selectionIndex,
    argv: parsed.argv,
    argvDigest,
    testFiles: parsed.testFiles,
    testFileCount: 39,
    perTestTimeoutMs: 600_000
  });
}

export function parseFrozenWorkPackageGateSelectionV4(input: {
  readonly executionManifestSource: string;
  readonly executionManifestPath: string;
  readonly selectionManifestSource: string;
  readonly selectionManifestPath: string;
  readonly selectionIndex: number;
}): WorkPackageGateSelectionV1 {
  const executionManifestPath = normalizedManifestPath(
    input.executionManifestPath,
    'Execution manifest path'
  );
  const selectionManifestPath = normalizedManifestPath(
    input.selectionManifestPath,
    'Selection manifest path'
  );
  if (!Number.isSafeInteger(input.selectionIndex) || input.selectionIndex < 0) {
    throw new Error('Selection index must be a non-negative safe integer');
  }
  const execution = CodexDevelopmentParseWorkPackageManifestV1(
    input.executionManifestSource,
    executionManifestPath
  );
  const selection = CodexDevelopmentParseWorkPackageManifestV1(
    input.selectionManifestSource,
    selectionManifestPath
  );
  if (execution.base !== selection.base) throw new Error('Execution and selection manifests must share a base');
  const selectionManifestDigest = CodexDevelopmentWorkPackageManifestDigest(
    input.selectionManifestSource
  );
  const executionManifestDigest = CodexDevelopmentWorkPackageManifestDigest(
    input.executionManifestSource
  );
  if (executionManifestPath !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_PATH_V4 ||
    execution.id !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_ID_V4 ||
    executionManifestDigest !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_DIGEST_V4 ||
    selectionManifestPath !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_PATH ||
    selection.id !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_ID ||
    input.selectionIndex !== 0 ||
    selectionManifestDigest !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_DIGEST) {
    throw new Error('Gate selection does not match the exact frozen R1/R3-v4 binding');
  }
  const command = selection.tests[input.selectionIndex];
  if (command === undefined) throw new Error('Selection index is outside the frozen manifest');
  const parsed = parseOwnerBatch(command);
  const argvDigest = digest(parsed.argv);
  if (argvDigest !== WORK_PACKAGE_GATE_ARGV_DIGEST) {
    throw new Error('Gate selection argv does not match the frozen owner batch');
  }
  return Object.freeze({
    executionManifestId: execution.id,
    executionManifestPath,
    executionManifestDigest,
    selectionManifestId: selection.id,
    selectionManifestPath,
    selectionManifestDigest,
    selectionIndex: input.selectionIndex,
    argv: parsed.argv,
    argvDigest,
    testFiles: parsed.testFiles,
    testFileCount: 39,
    perTestTimeoutMs: 600_000
  });
}

export function finalizeWorkPackageGateEvent(input: {
  readonly sequence: number;
  readonly kind: WorkPackageGateEventKind;
  readonly elapsedMs: number;
  readonly phase: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly subject?: unknown;
  readonly previousDigest: string | null;
}): WorkPackageGateEventV1 {
  const { subject, ...event } = input;
  const withoutDigest = {
    ...event,
    schema: WORK_PACKAGE_GATE_EVENT_SCHEMA_V1,
    subjectDigest: subject === undefined ? null : digest(subject)
  };
  return Object.freeze({ ...withoutDigest, eventDigest: digest(withoutDigest) });
}

export function assertWorkPackageGateEvent(
  value: unknown,
  expectedPreviousDigest?: string | null
): asserts value is WorkPackageGateEventV1 {
  plainObject(value, 'Work Package gate event');
  exactKeys(value, [
    'schema', 'sequence', 'kind', 'elapsedMs', 'phase', 'stdoutBytes', 'stderrBytes',
    'subjectDigest', 'previousDigest', 'eventDigest'
  ], 'Work Package gate event');
  if (value.schema !== WORK_PACKAGE_GATE_EVENT_SCHEMA_V1 ||
    !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1 ||
    !['started', 'heartbeat', 'deadline', 'termination', 'recovery', 'residue', 'completed'].includes(String(value.kind)) ||
    !Number.isFinite(value.elapsedMs) || Number(value.elapsedMs) < 0 ||
    typeof value.phase !== 'string' || value.phase.length < 1 || value.phase.length > 64 ||
    !Number.isSafeInteger(value.stdoutBytes) || Number(value.stdoutBytes) < 0 ||
    !Number.isSafeInteger(value.stderrBytes) || Number(value.stderrBytes) < 0 ||
    (value.subjectDigest !== null && !/^sha256:[0-9a-f]{64}$/u.test(String(value.subjectDigest))) ||
    (value.previousDigest !== null && !/^sha256:[0-9a-f]{64}$/u.test(String(value.previousDigest))) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(value.eventDigest))) {
    throw new Error('Work Package gate event is invalid');
  }
  if (expectedPreviousDigest !== undefined && value.previousDigest !== expectedPreviousDigest) {
    throw new Error('Work Package gate event hash chain is invalid');
  }
  const { eventDigest, ...withoutDigest } = value;
  if (eventDigest !== digest(withoutDigest)) throw new Error('Work Package gate event digest mismatch');
}

export function finalizeWorkPackageGateEventV4(input: {
  readonly sequence: number;
  readonly kind: Exclude<WorkPackageGateEventKind, 'heartbeat'>;
  readonly elapsedMs: number;
  readonly phase: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly subject: unknown;
  readonly previousDigest: string | null;
}): WorkPackageGateEventV4 {
  const { subject, ...event } = input;
  const withoutDigest = {
    ...event,
    schema: WORK_PACKAGE_GATE_EVENT_SCHEMA_V4,
    subjectDigest: digest(subject)
  };
  return Object.freeze({ ...withoutDigest, eventDigest: digest(withoutDigest) });
}

export function assertWorkPackageGateEventV4(
  value: unknown,
  expectedPreviousDigest?: string | null
): asserts value is WorkPackageGateEventV4 {
  plainObject(value, 'Work Package gate V4 event');
  exactKeys(value, [
    'schema', 'sequence', 'kind', 'elapsedMs', 'phase', 'stdoutBytes', 'stderrBytes',
    'subjectDigest', 'previousDigest', 'eventDigest'
  ], 'Work Package gate V4 event');
  if (value.schema !== WORK_PACKAGE_GATE_EVENT_SCHEMA_V4 ||
    !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1 ||
    !['started', 'deadline', 'termination', 'recovery', 'residue', 'completed'].includes(String(value.kind)) ||
    !Number.isFinite(value.elapsedMs) || Number(value.elapsedMs) < 0 ||
    typeof value.phase !== 'string' || value.phase.length < 1 || value.phase.length > 64 ||
    !Number.isSafeInteger(value.stdoutBytes) || Number(value.stdoutBytes) < 0 ||
    !Number.isSafeInteger(value.stderrBytes) || Number(value.stderrBytes) < 0 ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(value.subjectDigest)) ||
    (value.previousDigest !== null && !/^sha256:[0-9a-f]{64}$/u.test(String(value.previousDigest))) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(value.eventDigest))) {
    throw new Error('Work Package gate V4 event is invalid');
  }
  if (expectedPreviousDigest !== undefined && value.previousDigest !== expectedPreviousDigest) {
    throw new Error('Work Package gate V4 event hash chain is invalid');
  }
  const { eventDigest, ...withoutDigest } = value;
  if (eventDigest !== digest(withoutDigest)) throw new Error('Work Package gate V4 event digest mismatch');
}

export function finalizeWorkPackageGateEvidenceV1(
  draft: WorkPackageGateEvidenceDraftV1
): WorkPackageGateEvidenceV1 {
  const withoutDigest = { ...draft, schema: WORK_PACKAGE_GATE_EVIDENCE_SCHEMA_V1 };
  return Object.freeze({ ...withoutDigest, evidenceDigest: digest(withoutDigest) });
}

export function finalizeWorkPackageGateEvidence(
  draft: WorkPackageGateEvidenceDraftV1
): WorkPackageGateEvidenceV1 {
  return finalizeWorkPackageGateEvidenceV1(draft);
}

export function finalizeWorkPackageGateEvidenceV4(
  draft: WorkPackageGateEvidenceDraftV4
): WorkPackageGateEvidenceV4 {
  const withoutDigest = { ...draft, schema: WORK_PACKAGE_GATE_EVIDENCE_SCHEMA_V4 };
  return Object.freeze({ ...withoutDigest, evidenceDigest: digest(withoutDigest) });
}

function assertDigest(value: unknown, label: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(String(value))) throw new Error(`${label} must be a SHA-256 digest`);
}

function assertIdentitySet(value: unknown, label: string): asserts value is WorkPackageGateIdentitySetEvidenceV1 {
  plainObject(value, label);
  exactKeys(value, ['count', 'digest'], label);
  if (!Number.isSafeInteger(value.count) || Number(value.count) < 0) {
    throw new Error(`${label}.count is invalid`);
  }
  assertDigest(value.digest, `${label}.digest`);
}

function assertCensusV1(value: unknown, label: string): asserts value is WorkPackageGateResidueCensusV1 {
  plainObject(value, label);
  exactKeys(value, [
    'workspaceRoots', 'recoveryOwners', 'pendingOwners', 'nativeResults', 'writerLeases',
    'appContainerProfiles', 'aclPresentOwners'
  ], label);
  for (const key of ['workspaceRoots', 'recoveryOwners', 'pendingOwners', 'nativeResults', 'writerLeases'] as const) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0) throw new Error(`${label}.${key} is invalid`);
  }
  for (const key of ['appContainerProfiles', 'aclPresentOwners'] as const) {
    const identitySet = value[key];
    if (identitySet === null) continue;
    assertIdentitySet(identitySet, `${label}.${key}`);
  }
}

function assertIdentityProbe(
  value: unknown,
  label: string
): asserts value is WorkPackageGateIdentityProbeEvidenceV4 {
  plainObject(value, label);
  exactKeys(value, ['complete', 'reason', 'identities'], label);
  const completeReasons = ['observed', 'not-applicable', 'namespace-absent'];
  const unknownReasons = [
    'not-probed', 'deadline', 'host-tool-failed', 'lifecycle-failed', 'output-limit',
    'parse-failed', 'identity-changed'
  ];
  if (typeof value.complete !== 'boolean' ||
    ![...completeReasons, ...unknownReasons].includes(String(value.reason))) {
    throw new Error(`${label} disposition is invalid`);
  }
  if (value.complete !== completeReasons.includes(String(value.reason)) ||
    value.complete !== (value.identities !== null)) {
    throw new Error(`${label} disposition is contradictory`);
  }
  if (value.identities !== null) assertIdentitySet(value.identities, `${label}.identities`);
  if (['not-applicable', 'namespace-absent'].includes(String(value.reason)) &&
    (value.identities as WorkPackageGateIdentitySetEvidenceV1).count !== 0) {
    throw new Error(`${label} authoritative absence must be empty`);
  }
}

function assertCensusV4(value: unknown, label: string): asserts value is WorkPackageGateResidueCensusV4 {
  plainObject(value, label);
  exactKeys(value, ['structure', 'aclPresentOwners'], label);
  plainObject(value.structure, `${label}.structure`);
  exactKeys(value.structure, ['complete', 'reason', 'counts', 'recoveryAuthorities'], `${label}.structure`);
  const completeReasons = ['observed', 'namespace-absent'];
  const unknownReasons = ['not-probed', 'deadline', 'scan-failed', 'identity-changed'];
  if (typeof value.structure.complete !== 'boolean' ||
    ![...completeReasons, ...unknownReasons].includes(String(value.structure.reason)) ||
    value.structure.complete !== completeReasons.includes(String(value.structure.reason)) ||
    value.structure.complete !== (value.structure.counts !== null) ||
    value.structure.complete !== (value.structure.recoveryAuthorities !== null)) {
    throw new Error(`${label}.structure disposition is contradictory`);
  }
  if (value.structure.counts !== null) {
    plainObject(value.structure.counts, `${label}.structure.counts`);
    exactKeys(value.structure.counts, [
      'workspaceRoots', 'recoveryOwners', 'pendingOwners', 'nativeResults', 'writerLeases'
    ], `${label}.structure.counts`);
    for (const key of ['workspaceRoots', 'recoveryOwners', 'pendingOwners', 'nativeResults', 'writerLeases'] as const) {
      if (!Number.isSafeInteger(value.structure.counts[key]) || Number(value.structure.counts[key]) < 0) {
        throw new Error(`${label}.structure.counts.${key} is invalid`);
      }
    }
    assertIdentitySet(value.structure.recoveryAuthorities, `${label}.structure.recoveryAuthorities`);
    const counts = value.structure.counts as unknown as WorkPackageGateStructureCountsV4;
    if ((counts.recoveryOwners + counts.pendingOwners === 0) !==
      (value.structure.recoveryAuthorities.count === 0)) {
      throw new Error(`${label}.structure recovery authority is contradictory`);
    }
    if (value.structure.reason === 'namespace-absent' &&
      (Object.values(counts).some((count) => count !== 0) ||
        value.structure.recoveryAuthorities.count !== 0)) {
      throw new Error(`${label}.structure namespace absence must be empty`);
    }
  }
  assertIdentityProbe(value.aclPresentOwners, `${label}.aclPresentOwners`);
}

function assertFailureIndex(
  value: unknown,
  label: string,
  child: WorkPackageGateChildEvidenceV1
): asserts value is WorkPackageGateDiagnosticV4 {
  plainObject(value, label);
  exactKeys(value, [
    'status', 'selectionIndexes', 'failureMarkerCount', 'unmappedMarkerCount',
    'malformedMarkerCount', 'oversizedLineCount', 'utf8Invalid', 'ansiInvalid',
    'observerTruncated', 'parserFailure'
  ], label);
  if (!['actionable', 'non-actionable'].includes(String(value.status)) ||
    !Array.isArray(value.selectionIndexes) || value.selectionIndexes.length > 39 ||
    value.selectionIndexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= 39) ||
    value.selectionIndexes.some((index, position, values) => position > 0 && index <= values[position - 1]!) ||
    !Number.isSafeInteger(value.failureMarkerCount) || Number(value.failureMarkerCount) < 0 ||
    !Number.isSafeInteger(value.unmappedMarkerCount) || Number(value.unmappedMarkerCount) < 0 ||
    !Number.isSafeInteger(value.malformedMarkerCount) || Number(value.malformedMarkerCount) < 0 ||
    !Number.isSafeInteger(value.oversizedLineCount) || Number(value.oversizedLineCount) < 0 ||
    Number(value.unmappedMarkerCount) > Number(value.failureMarkerCount) ||
    value.selectionIndexes.length > Number(value.failureMarkerCount) - Number(value.unmappedMarkerCount) ||
    typeof value.utf8Invalid !== 'boolean' || typeof value.ansiInvalid !== 'boolean' ||
    typeof value.observerTruncated !== 'boolean' || typeof value.parserFailure !== 'boolean' ||
    value.observerTruncated !== (child.stdout.observerTruncated || child.stderr.observerTruncated)) {
    throw new Error(`${label} is invalid`);
  }
  const expectedActionable = child.status === 'exited' && child.exitCode !== null && child.exitCode !== 0 &&
    value.selectionIndexes.length > 0 && Number(value.failureMarkerCount) > 0 &&
    Number(value.unmappedMarkerCount) === 0 && Number(value.malformedMarkerCount) === 0 &&
    Number(value.oversizedLineCount) === 0 && value.utf8Invalid === false &&
    value.ansiInvalid === false && value.observerTruncated === false && value.parserFailure === false;
  if ((value.status === 'actionable') !== expectedActionable) {
    throw new Error(`${label} actionable algebra is contradictory`);
  }
}

export function assertWorkPackageGateResidueCensusV4(
  value: unknown
): asserts value is WorkPackageGateResidueCensusV4 {
  assertCensusV4(value, 'Work Package gate V4 residue census');
}

export function assertWorkPackageGateDiagnosticV4(
  value: unknown,
  child: WorkPackageGateChildEvidenceV1
): asserts value is WorkPackageGateDiagnosticV4 {
  assertFailureIndex(value, 'Work Package gate V4 diagnostic', child);
}

function assertStream(
  value: unknown,
  label: string
): asserts value is WorkPackageGateStreamEvidenceV1 {
  plainObject(value, label);
  exactKeys(value, ['bytes', 'digest', 'observerTruncated'], label);
  if (!Number.isSafeInteger(value.bytes) || Number(value.bytes) < 0 ||
    typeof value.observerTruncated !== 'boolean') throw new Error(`${label} is invalid`);
  assertDigest(value.digest, `${label}.digest`);
}

function assertWorkPackageGateEvidenceV1Frozen(
  value: unknown
): asserts value is WorkPackageGateEvidenceV1 {
  plainObject(value, 'Work Package gate V1 evidence');
  exactKeys(value, [
    'schema', 'runId', 'status', 'startedAt', 'completedAt', 'durationMs', 'selection',
    'repository', 'timeouts', 'child', 'recovery', 'residue', 'journal', 'evidenceDigest'
  ], 'Work Package gate V1 evidence');
  if (value.schema !== WORK_PACKAGE_GATE_EVIDENCE_SCHEMA_V1 ||
    typeof value.runId !== 'string' || value.runId.length > 128 || !/^[a-z0-9-]+$/u.test(value.runId) ||
    !['passed', 'failed', 'timed-out', 'unknown'].includes(String(value.status)) ||
    !Number.isFinite(Date.parse(String(value.startedAt))) ||
    !Number.isFinite(Date.parse(String(value.completedAt))) ||
    !Number.isFinite(value.durationMs) || Number(value.durationMs) < 0) {
    throw new Error('Work Package gate V1 evidence header is invalid');
  }
  plainObject(value.selection, 'Work Package gate V1 selection');
  exactKeys(value.selection, [
    'executionManifestId', 'executionManifestPath', 'executionManifestDigest',
    'selectionManifestId', 'selectionManifestPath', 'selectionManifestDigest',
    'selectionIndex', 'argv', 'argvDigest', 'testFiles', 'testFileCount', 'perTestTimeoutMs'
  ], 'Work Package gate V1 selection');
  assertDigest(value.selection.executionManifestDigest, 'executionManifestDigest');
  assertDigest(value.selection.selectionManifestDigest, 'selectionManifestDigest');
  assertDigest(value.selection.argvDigest, 'argvDigest');
  if (!Array.isArray(value.selection.argv) || digest(value.selection.argv) !== value.selection.argvDigest ||
    !Array.isArray(value.selection.testFiles) || value.selection.testFiles.length !== 39 ||
    value.selection.testFileCount !== 39 || value.selection.perTestTimeoutMs !== 600_000) {
    throw new Error('Work Package gate V1 selection proof is invalid');
  }
  const reparsed = parseOwnerBatch(value.selection.argv.join(' '));
  if (JSON.stringify(reparsed.testFiles) !== JSON.stringify(value.selection.testFiles) ||
    value.selection.selectionIndex !== 0 ||
    value.selection.executionManifestId !== WORK_PACKAGE_GATE_R2_EXECUTION_MANIFEST_ID ||
    value.selection.executionManifestPath !== WORK_PACKAGE_GATE_R2_EXECUTION_MANIFEST_PATH ||
    value.selection.executionManifestDigest !== WORK_PACKAGE_GATE_R2_EXECUTION_MANIFEST_DIGEST ||
    value.selection.selectionManifestId !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_ID ||
    value.selection.selectionManifestPath !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_PATH ||
    value.selection.selectionManifestDigest !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_DIGEST ||
    value.selection.argvDigest !== WORK_PACKAGE_GATE_ARGV_DIGEST) {
    throw new Error('Work Package gate V1 selection binding is invalid');
  }
  plainObject(value.repository, 'Work Package gate V1 repository');
  exactKeys(value.repository, [
    'headSha', 'treeSha', 'headShaAfter', 'treeShaAfter', 'worktreeBeforeDigest',
    'worktreeAfterDigest', 'executionSnapshotDigest', 'executionSnapshotAfterDigest',
    'executionSnapshotRemoved'
  ], 'Work Package gate V1 repository');
  for (const key of ['headSha', 'treeSha'] as const) {
    if (!/^[0-9a-f]{40}$/u.test(String(value.repository[key]))) {
      throw new Error(`repository.${key} is invalid`);
    }
  }
  for (const key of ['headShaAfter', 'treeShaAfter'] as const) {
    if (value.repository[key] !== null && !/^[0-9a-f]{40}$/u.test(String(value.repository[key]))) {
      throw new Error(`repository.${key} is invalid`);
    }
  }
  assertDigest(value.repository.worktreeBeforeDigest, 'worktreeBeforeDigest');
  assertDigest(value.repository.executionSnapshotDigest, 'executionSnapshotDigest');
  if (value.repository.worktreeAfterDigest !== null) {
    assertDigest(value.repository.worktreeAfterDigest, 'worktreeAfterDigest');
  }
  if (value.repository.executionSnapshotAfterDigest !== null) {
    assertDigest(value.repository.executionSnapshotAfterDigest, 'executionSnapshotAfterDigest');
  }
  if (typeof value.repository.executionSnapshotRemoved !== 'boolean') {
    throw new Error('repository.executionSnapshotRemoved is invalid');
  }
  plainObject(value.timeouts, 'Work Package gate V1 timeouts');
  exactKeys(value.timeouts, ['watchdogMs', 'cleanupMs'], 'Work Package gate V1 timeouts');
  if (value.timeouts.watchdogMs !== 1_800_000 || value.timeouts.cleanupMs !== 120_000) {
    throw new Error('Work Package gate V1 timeout contract is invalid');
  }
  plainObject(value.child, 'Work Package gate V1 child');
  exactKeys(value.child, [
    'status', 'trigger', 'started', 'exitCode', 'signal', 'durationMs', 'stdout', 'stderr', 'termination'
  ], 'Work Package gate V1 child');
  if (!['exited', 'spawn-failed', 'aborted', 'fence-lost', 'lifecycle-failed', 'observer-failed', 'timed-out',
    'tree-unproven', 'termination-unproven'].includes(String(value.child.status)) ||
    (value.child.trigger !== null && !['aborted', 'fence-lost', 'lifecycle-failed', 'observer-failed', 'timed-out']
      .includes(String(value.child.trigger))) ||
    typeof value.child.started !== 'boolean' ||
    (value.child.exitCode !== null && !Number.isSafeInteger(value.child.exitCode)) ||
    (value.child.signal !== null && !/^SIG[A-Z0-9]+$/u.test(String(value.child.signal))) ||
    !Number.isFinite(value.child.durationMs) || Number(value.child.durationMs) < 0) {
    throw new Error('Work Package gate V1 child outcome is invalid');
  }
  assertStream(value.child.stdout, 'Work Package gate V1 stdout');
  assertStream(value.child.stderr, 'Work Package gate V1 stderr');
  plainObject(value.child.termination, 'Work Package gate V1 termination');
  exactKeys(value.child.termination, [
    'requested', 'gracefulAttempted', 'forcedAttempted', 'childCloseObserved', 'streamsDrained', 'treeClosed'
  ], 'Work Package gate V1 termination');
  for (const key of Object.keys(value.child.termination)) {
    if (typeof value.child.termination[key] !== 'boolean') {
      throw new Error('Work Package gate V1 termination evidence is invalid');
    }
  }
  if ((!value.child.termination.requested &&
      (value.child.termination.gracefulAttempted || value.child.termination.forcedAttempted)) ||
    (value.child.started && value.child.termination.treeClosed &&
      (!value.child.termination.childCloseObserved || !value.child.termination.streamsDrained))) {
    throw new Error('Work Package gate V1 termination state is contradictory');
  }
  plainObject(value.recovery, 'Work Package gate V1 recovery');
  exactKeys(value.recovery, ['attempted', 'complete', 'reason'], 'Work Package gate V1 recovery');
  if (typeof value.recovery.attempted !== 'boolean' || typeof value.recovery.complete !== 'boolean' ||
    !['not-needed', 'authority-preserved', 'completed', 'failed'].includes(String(value.recovery.reason))) {
    throw new Error('Work Package gate V1 recovery evidence is invalid');
  }
  const recoveryAlgebraValid =
    (value.recovery.reason === 'not-needed' && !value.recovery.attempted && value.recovery.complete) ||
    (value.recovery.reason === 'authority-preserved' && !value.recovery.attempted && !value.recovery.complete) ||
    (value.recovery.reason === 'completed' && value.recovery.attempted && value.recovery.complete) ||
    (value.recovery.reason === 'failed' && value.recovery.attempted && !value.recovery.complete);
  if (!recoveryAlgebraValid) throw new Error('Work Package gate V1 recovery state is contradictory');
  plainObject(value.residue, 'Work Package gate V1 residue');
  exactKeys(value.residue, ['before', 'after', 'namespaceRemoved'], 'Work Package gate V1 residue');
  if (typeof value.residue.namespaceRemoved !== 'boolean') {
    throw new Error('Work Package gate V1 namespace cleanup evidence is invalid');
  }
  if (value.residue.before !== null) assertCensusV1(value.residue.before, 'Work Package gate V1 residue before');
  if (value.residue.after !== null) assertCensusV1(value.residue.after, 'Work Package gate V1 residue after');
  plainObject(value.journal, 'Work Package gate V1 journal');
  exactKeys(value.journal, ['lastSequence', 'digest'], 'Work Package gate V1 journal');
  if (!Number.isSafeInteger(value.journal.lastSequence) || Number(value.journal.lastSequence) < 1) {
    throw new Error('Work Package gate V1 journal sequence is invalid');
  }
  assertDigest(value.journal.digest, 'journal digest');
  const before = value.residue.before as WorkPackageGateResidueCensusV1 | null;
  const after = value.residue.after as WorkPackageGateResidueCensusV1 | null;
  const cleanCompletion = before !== null && after !== null && value.child.started === true &&
    !value.child.stdout.observerTruncated && !value.child.stderr.observerTruncated &&
    value.child.termination.childCloseObserved === true && value.child.termination.streamsDrained === true &&
    value.child.termination.treeClosed === true && value.recovery.complete === true &&
    before.workspaceRoots === 0 && before.recoveryOwners === 0 && before.pendingOwners === 0 &&
    before.nativeResults === 0 && before.writerLeases === 0 && before.appContainerProfiles !== null &&
    before.aclPresentOwners !== null && before.aclPresentOwners.count === 0 &&
    after.workspaceRoots === 0 && after.recoveryOwners === 0 && after.pendingOwners === 0 &&
    after.nativeResults === 0 && after.writerLeases === 0 && after.appContainerProfiles !== null &&
    after.aclPresentOwners !== null && after.aclPresentOwners.count === 0 &&
    after.appContainerProfiles.count === before.appContainerProfiles.count &&
    after.appContainerProfiles.digest === before.appContainerProfiles.digest &&
    value.residue.namespaceRemoved === true && value.repository.headSha === value.repository.headShaAfter &&
    value.repository.treeSha === value.repository.treeShaAfter &&
    value.repository.worktreeBeforeDigest === value.repository.worktreeAfterDigest &&
    value.repository.executionSnapshotDigest === value.repository.executionSnapshotAfterDigest &&
    value.repository.executionSnapshotRemoved === true;
  if (value.status === 'passed') {
    if (!cleanCompletion || value.child.status !== 'exited' || value.child.trigger !== null ||
      value.child.termination.requested !== false || value.child.exitCode !== 0) {
      throw new Error('Passed Work Package gate evidence is incomplete');
    }
  } else if (value.status === 'failed') {
    if (!cleanCompletion || value.child.status !== 'exited' || value.child.trigger !== null ||
      value.child.termination.requested !== false || value.child.exitCode === null || value.child.exitCode === 0) {
      throw new Error('Failed Work Package gate evidence is inconsistent');
    }
  } else if (value.status === 'timed-out') {
    if (!cleanCompletion || value.child.status !== 'timed-out' || value.child.trigger !== 'timed-out' ||
      value.child.termination.requested !== true || value.child.exitCode !== null) {
      throw new Error('Timed-out Work Package gate evidence is inconsistent');
    }
  }
  const { evidenceDigest, ...withoutDigest } = value;
  assertDigest(evidenceDigest, 'evidence digest');
  if (evidenceDigest !== digest(withoutDigest)) {
    throw new Error('Work Package gate V1 evidence digest mismatch');
  }
}

function assertWorkPackageGateEvidenceV4Internal(
  value: unknown
): asserts value is WorkPackageGateEvidenceV4 {
  plainObject(value, 'Work Package gate evidence');
  const evidenceKeys = [
    'schema', 'runId', 'status', 'startedAt', 'completedAt', 'durationMs', 'selection',
    'repository', 'timeouts', 'child', 'recovery', 'residue', 'journal', 'evidenceDigest',
    'authority', 'diagnostic'
  ];
  exactKeys(value, evidenceKeys, 'Work Package gate evidence');
  if (value.schema !== WORK_PACKAGE_GATE_EVIDENCE_SCHEMA_V4 ||
    typeof value.runId !== 'string' || value.runId.length > 128 || !/^[a-z0-9-]+$/u.test(value.runId) ||
    !['passed', 'failed', 'timed-out', 'unknown'].includes(String(value.status)) ||
    !Number.isFinite(Date.parse(String(value.startedAt))) ||
    !Number.isFinite(Date.parse(String(value.completedAt))) ||
    !Number.isFinite(value.durationMs) || Number(value.durationMs) < 0) {
    throw new Error('Work Package gate evidence header is invalid');
  }
  plainObject(value.selection, 'Work Package gate selection');
  exactKeys(value.selection, [
    'executionManifestId', 'executionManifestPath', 'executionManifestDigest',
    'selectionManifestId', 'selectionManifestPath', 'selectionManifestDigest',
    'selectionIndex', 'argv', 'argvDigest', 'testFiles', 'testFileCount', 'perTestTimeoutMs'
  ], 'Work Package gate selection');
  assertDigest(value.selection.executionManifestDigest, 'executionManifestDigest');
  assertDigest(value.selection.selectionManifestDigest, 'selectionManifestDigest');
  assertDigest(value.selection.argvDigest, 'argvDigest');
  if (!Array.isArray(value.selection.argv) || digest(value.selection.argv) !== value.selection.argvDigest ||
    !Array.isArray(value.selection.testFiles) || value.selection.testFiles.length !== 39 ||
    value.selection.testFileCount !== 39 || value.selection.perTestTimeoutMs !== 600_000) {
    throw new Error('Work Package gate selection proof is invalid');
  }
  const reparsed = parseOwnerBatch(value.selection.argv.join(' '));
  if (JSON.stringify(reparsed.testFiles) !== JSON.stringify(value.selection.testFiles) ||
    value.selection.selectionIndex !== 0 ||
    value.selection.executionManifestId !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_ID_V4 ||
    value.selection.executionManifestPath !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_PATH_V4 ||
    value.selection.executionManifestDigest !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_DIGEST_V4 ||
    value.selection.selectionManifestId !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_ID ||
    value.selection.selectionManifestPath !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_PATH ||
    value.selection.selectionManifestDigest !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_DIGEST ||
    value.selection.argvDigest !== WORK_PACKAGE_GATE_ARGV_DIGEST) {
    throw new Error('Work Package gate selection binding is invalid');
  }
  plainObject(value.repository, 'Work Package gate repository');
  exactKeys(value.repository, [
    'headSha', 'treeSha', 'headShaAfter', 'treeShaAfter',
    'worktreeBeforeDigest', 'worktreeAfterDigest', 'executionSnapshotDigest',
    'executionSnapshotAfterDigest', 'executionSnapshotRemoved'
  ], 'Work Package gate repository');
  for (const key of ['headSha', 'treeSha'] as const) {
    if (!/^[0-9a-f]{40}$/u.test(String(value.repository[key]))) throw new Error(`repository.${key} is invalid`);
  }
  for (const key of ['headShaAfter', 'treeShaAfter'] as const) {
    if (value.repository[key] !== null && !/^[0-9a-f]{40}$/u.test(String(value.repository[key]))) {
      throw new Error(`repository.${key} is invalid`);
    }
  }
  assertDigest(value.repository.worktreeBeforeDigest, 'worktreeBeforeDigest');
  assertDigest(value.repository.executionSnapshotDigest, 'executionSnapshotDigest');
  if (value.repository.worktreeAfterDigest !== null) {
    assertDigest(value.repository.worktreeAfterDigest, 'worktreeAfterDigest');
  }
  if (value.repository.executionSnapshotAfterDigest !== null) {
    assertDigest(value.repository.executionSnapshotAfterDigest, 'executionSnapshotAfterDigest');
  }
  if (typeof value.repository.executionSnapshotRemoved !== 'boolean') {
    throw new Error('repository.executionSnapshotRemoved is invalid');
  }
  plainObject(value.authority, 'Work Package gate execution authority');
  exactKeys(value.authority, [
    'protectedLedgerDigest', 'runDirectoryIdentityDigest', 'namespaceIdentityDigest',
    'snapshotIdentityDigest', 'namespaceRootIdentityDigest'
  ], 'Work Package gate execution authority');
  if (value.authority.protectedLedgerDigest !== WORK_PACKAGE_GATE_PROTECTED_LEDGER_DIGEST_V4 ||
    value.authority.runDirectoryIdentityDigest !== WORK_PACKAGE_GATE_RUN_DIRECTORY_IDENTITY_DIGEST_V4 ||
    value.authority.namespaceIdentityDigest !== WORK_PACKAGE_GATE_NAMESPACE_IDENTITY_DIGEST_V4 ||
    value.authority.snapshotIdentityDigest !== WORK_PACKAGE_GATE_SNAPSHOT_IDENTITY_DIGEST_V4 ||
    value.authority.namespaceRootIdentityDigest !== WORK_PACKAGE_GATE_NAMESPACE_ROOT_IDENTITY_DIGEST_V4) {
    throw new Error('Work Package gate execution authority binding is invalid');
  }
  plainObject(value.timeouts, 'Work Package gate timeouts');
  exactKeys(value.timeouts, ['watchdogMs', 'cleanupMs'], 'Work Package gate timeouts');
  if (value.timeouts.watchdogMs !== 1_800_000 || value.timeouts.cleanupMs !== 120_000) {
    throw new Error('Work Package gate timeout contract is invalid');
  }
  plainObject(value.child, 'Work Package gate child');
  exactKeys(value.child, [
    'status', 'trigger', 'started', 'exitCode', 'signal', 'durationMs',
    'stdout', 'stderr', 'termination'
  ], 'Work Package gate child');
  if (!['exited', 'spawn-failed', 'aborted', 'fence-lost', 'lifecycle-failed', 'observer-failed', 'timed-out',
    'tree-unproven', 'termination-unproven'].includes(String(value.child.status)) ||
    (value.child.trigger !== null && !['aborted', 'fence-lost', 'lifecycle-failed', 'observer-failed', 'timed-out']
      .includes(String(value.child.trigger))) ||
    typeof value.child.started !== 'boolean' ||
    (value.child.exitCode !== null && !Number.isSafeInteger(value.child.exitCode)) ||
    (value.child.signal !== null && !/^SIG[A-Z0-9]+$/u.test(String(value.child.signal))) ||
    !Number.isFinite(value.child.durationMs) || Number(value.child.durationMs) < 0) {
    throw new Error('Work Package gate child outcome is invalid');
  }
  assertStream(value.child.stdout, 'Work Package gate stdout');
  assertStream(value.child.stderr, 'Work Package gate stderr');
  plainObject(value.child.termination, 'Work Package gate termination');
  exactKeys(value.child.termination, [
    'requested', 'gracefulAttempted', 'forcedAttempted', 'childCloseObserved',
    'streamsDrained', 'treeClosed'
  ], 'Work Package gate termination');
  for (const key of Object.keys(value.child.termination)) {
    if (typeof value.child.termination[key] !== 'boolean') {
      throw new Error('Work Package gate termination evidence is invalid');
    }
  }
  if ((!value.child.termination.requested &&
      (value.child.termination.gracefulAttempted || value.child.termination.forcedAttempted)) ||
    (value.child.started && value.child.termination.treeClosed &&
      (!value.child.termination.childCloseObserved || !value.child.termination.streamsDrained))) {
    throw new Error('Work Package gate termination state is contradictory');
  }
  assertFailureIndex(
    value.diagnostic,
    'Work Package gate failure index',
    value.child as unknown as WorkPackageGateChildEvidenceV1
  );
  plainObject(value.recovery, 'Work Package gate recovery');
  exactKeys(value.recovery, [
    'attempted', 'complete', 'reason', 'authorization'
  ], 'Work Package gate recovery');
  if (typeof value.recovery.attempted !== 'boolean' || typeof value.recovery.complete !== 'boolean' ||
    !['not-needed', 'authority-preserved', 'completed', 'failed'].includes(String(value.recovery.reason))) {
    throw new Error('Work Package gate recovery evidence is invalid');
  }
  if (value.recovery.authorization !== null) {
    assertIdentitySet(value.recovery.authorization, 'Work Package gate recovery authorization');
  }
  const recoveryRequiresAuthority = ['completed', 'failed'].includes(String(value.recovery.reason)) &&
    value.recovery.attempted === true;
  if (recoveryRequiresAuthority !==
    (value.recovery.authorization !== null && value.recovery.authorization.count > 0)) {
    throw new Error('Work Package gate recovery authorization is contradictory');
  }
  const recoveryAlgebraValid =
    (value.recovery.reason === 'not-needed' && !value.recovery.attempted && value.recovery.complete) ||
    (value.recovery.reason === 'authority-preserved' && !value.recovery.attempted && !value.recovery.complete) ||
    (value.recovery.reason === 'completed' && value.recovery.attempted && value.recovery.complete) ||
    (value.recovery.reason === 'failed' && value.recovery.attempted && !value.recovery.complete);
  if (!recoveryAlgebraValid) throw new Error('Work Package gate recovery state is contradictory');
  plainObject(value.residue, 'Work Package gate residue');
  exactKeys(value.residue, [
    'preflight', 'postChild', 'postRecovery', 'final',
    'namespaceRemovalAttempted', 'namespaceRemoved'
  ], 'Work Package gate residue');
  if (typeof value.residue.namespaceRemoved !== 'boolean' ||
    typeof value.residue.namespaceRemovalAttempted !== 'boolean') {
    throw new Error('Work Package gate namespace cleanup evidence is invalid');
  }
  for (const key of ['preflight', 'postChild', 'postRecovery', 'final'] as const) {
    if (value.residue[key] !== null) {
      assertCensusV4(value.residue[key], `Work Package gate residue ${key}`);
    }
  }
  if (value.residue.namespaceRemoved && !value.residue.namespaceRemovalAttempted) {
    throw new Error('Work Package gate namespace removal result has no durable attempt');
  }
  const postChild = value.residue.postChild as WorkPackageGateResidueCensusV4 | null;
  const postChildComplete = postChild?.structure.complete === true;
  const observedRecoveryAuthority = postChild !== null && postChild.structure.complete &&
    postChild.structure.recoveryAuthorities.count > 0 &&
    postChild.structure.counts.recoveryOwners + postChild.structure.counts.pendingOwners > 0;
  const recoveryHasAuthorization = value.recovery.authorization !== null;
  const exactRecoveryDisposition =
    (value.recovery.reason === 'not-needed' && postChildComplete && !observedRecoveryAuthority &&
      !recoveryHasAuthorization) ||
    (value.recovery.reason === 'authority-preserved' && !postChildComplete && !recoveryHasAuthorization) ||
    (['completed', 'failed'].includes(String(value.recovery.reason)) && observedRecoveryAuthority &&
      recoveryHasAuthorization);
  if (!exactRecoveryDisposition || observedRecoveryAuthority !== recoveryHasAuthorization ||
    (value.recovery.authorization !== null && (postChild === null || !postChild.structure.complete ||
      postChild.structure.recoveryAuthorities.count !== value.recovery.authorization.count ||
      postChild.structure.recoveryAuthorities.digest !== value.recovery.authorization.digest))) {
    throw new Error('Work Package gate recovery authorization is not bound to post-child census');
  }
  const childTreeClosed = value.child.termination.treeClosed === true;
  if ((!childTreeClosed && (value.residue.postChild !== null || value.recovery.complete ||
    value.residue.postRecovery !== null || value.residue.namespaceRemovalAttempted ||
    value.residue.namespaceRemoved || value.residue.final !== null ||
    value.repository.executionSnapshotRemoved)) ||
    (value.residue.final !== null && !value.residue.namespaceRemoved)) {
    throw new Error('Work Package gate cleanup evidence exists before the child tree closed');
  }
  plainObject(value.journal, 'Work Package gate journal');
  exactKeys(value.journal, ['lastSequence', 'digest'], 'Work Package gate journal');
  if (!Number.isSafeInteger(value.journal.lastSequence) || Number(value.journal.lastSequence) < 1) {
    throw new Error('Work Package gate journal sequence is invalid');
  }
  assertDigest(value.journal.digest, 'journal digest');
  const commonCleanCompletion =
    value.child.started === true &&
    !value.child.stdout.observerTruncated && !value.child.stderr.observerTruncated &&
    value.child.termination.childCloseObserved === true &&
    value.child.termination.streamsDrained === true &&
    value.child.termination.treeClosed === true && value.recovery.complete === true &&
    value.residue.namespaceRemoved === true &&
    value.repository.headSha === value.repository.headShaAfter &&
    value.repository.treeSha === value.repository.treeShaAfter &&
    value.repository.worktreeBeforeDigest === value.repository.worktreeAfterDigest &&
    value.repository.executionSnapshotDigest === value.repository.executionSnapshotAfterDigest &&
    value.repository.executionSnapshotRemoved === true;
  let cleanCompletion = false;
  if (value.residue.preflight !== null &&
    value.residue.postChild !== null && value.residue.postRecovery !== null &&
    value.residue.final !== null) {
    const before = value.residue.preflight as unknown as WorkPackageGateResidueCensusV4;
    const postChild = value.residue.postChild as unknown as WorkPackageGateResidueCensusV4;
    const postRecovery = value.residue.postRecovery as unknown as WorkPackageGateResidueCensusV4;
    const after = value.residue.final as unknown as WorkPackageGateResidueCensusV4;
    const beforeCounts = before.structure.complete ? before.structure.counts : null;
    const afterCounts = after.structure.complete ? after.structure.counts : null;
    cleanCompletion = commonCleanCompletion &&
      beforeCounts !== null && beforeCounts.workspaceRoots === 0 &&
      beforeCounts.recoveryOwners === 0 && beforeCounts.pendingOwners === 0 &&
      beforeCounts.nativeResults === 0 && beforeCounts.writerLeases === 0 &&
      before.aclPresentOwners.complete &&
      before.aclPresentOwners.identities?.count === 0 &&
      postChild.structure.complete && postRecovery.structure.complete &&
      postRecovery.structure.counts.workspaceRoots === 0 &&
      postRecovery.structure.counts.recoveryOwners === 0 &&
      postRecovery.structure.counts.pendingOwners === 0 &&
      postRecovery.structure.counts.nativeResults === 0 &&
      postRecovery.structure.counts.writerLeases === 0 &&
      postRecovery.structure.recoveryAuthorities.count === 0 &&
      after.structure.complete && after.structure.reason === 'namespace-absent' &&
      afterCounts !== null && afterCounts.workspaceRoots === 0 &&
      afterCounts.recoveryOwners === 0 && afterCounts.pendingOwners === 0 &&
      afterCounts.nativeResults === 0 && afterCounts.writerLeases === 0 &&
      after.aclPresentOwners.complete &&
      after.aclPresentOwners.reason === 'namespace-absent' &&
      after.aclPresentOwners.identities?.count === 0;
  }
  if (value.status === 'passed') {
    if (!cleanCompletion || value.child.status !== 'exited' || value.child.trigger !== null ||
      value.child.termination.requested !== false || value.child.exitCode !== 0 ||
      !(
        (value.diagnostic as unknown as WorkPackageGateDiagnosticV4).status === 'non-actionable' &&
        (value.diagnostic as unknown as WorkPackageGateDiagnosticV4).selectionIndexes.length === 0 &&
        (value.diagnostic as unknown as WorkPackageGateDiagnosticV4).failureMarkerCount === 0 &&
        (value.diagnostic as unknown as WorkPackageGateDiagnosticV4).unmappedMarkerCount === 0 &&
        (value.diagnostic as unknown as WorkPackageGateDiagnosticV4).malformedMarkerCount === 0 &&
        (value.diagnostic as unknown as WorkPackageGateDiagnosticV4).oversizedLineCount === 0 &&
        !(value.diagnostic as unknown as WorkPackageGateDiagnosticV4).utf8Invalid &&
        !(value.diagnostic as unknown as WorkPackageGateDiagnosticV4).ansiInvalid &&
        !(value.diagnostic as unknown as WorkPackageGateDiagnosticV4).observerTruncated &&
        !(value.diagnostic as unknown as WorkPackageGateDiagnosticV4).parserFailure)) {
      throw new Error('Passed Work Package gate evidence is incomplete');
    }
  } else if (value.status === 'failed') {
    if (!cleanCompletion || value.child.status !== 'exited' || value.child.trigger !== null ||
      value.child.termination.requested !== false || value.child.exitCode === null ||
      value.child.exitCode === 0 ||
      (value.diagnostic as unknown as WorkPackageGateDiagnosticV4).status !== 'actionable') {
      throw new Error('Failed Work Package gate evidence is inconsistent');
    }
  } else if (value.status === 'timed-out') {
    if (!cleanCompletion || value.child.status !== 'timed-out' ||
      value.child.trigger !== 'timed-out' || value.child.termination.requested !== true ||
      value.child.exitCode !== null) {
      throw new Error('Timed-out Work Package gate evidence is inconsistent');
    }
  }
  const { evidenceDigest, ...withoutDigest } = value;
  assertDigest(evidenceDigest, 'evidence digest');
  if (evidenceDigest !== digest(withoutDigest)) throw new Error('Work Package gate evidence digest mismatch');
}

export function assertWorkPackageGateEvidenceV1(
  value: unknown
): asserts value is WorkPackageGateEvidenceV1 {
  assertWorkPackageGateEvidenceV1Frozen(value);
}

export function assertWorkPackageGateEvidence(
  value: unknown
): asserts value is WorkPackageGateEvidenceV1 {
  assertWorkPackageGateEvidenceV1Frozen(value);
}

export function assertWorkPackageGateEvidenceV4(
  value: unknown
): asserts value is WorkPackageGateEvidenceV4 {
  assertWorkPackageGateEvidenceV4Internal(value);
}

export function assertWorkPackageGateJournal(
  source: string,
  expected: { readonly lastSequence: number; readonly digest: string }
): void {
  if (Buffer.byteLength(source, 'utf8') > 8 * 1024 * 1024 || !source.endsWith('\n')) {
    throw new Error('Work Package gate journal bytes are invalid');
  }
  const lines = source.slice(0, -1).split('\n');
  if (lines.length < 1 || lines.length > 2048 || lines.some((line) => line.length === 0)) {
    throw new Error('Work Package gate journal record count is invalid');
  }
  let previous: string | null = null;
  const events: WorkPackageGateEventV1[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[index]!) as unknown;
    } catch {
      throw new Error('Work Package gate journal JSON is invalid');
    }
    assertWorkPackageGateEvent(parsed, previous);
    if (parsed.sequence !== index + 1) throw new Error('Work Package gate journal sequence is invalid');
    const prior = events.at(-1);
    if (prior && (parsed.elapsedMs < prior.elapsedMs ||
      parsed.stdoutBytes < prior.stdoutBytes || parsed.stderrBytes < prior.stderrBytes)) {
      throw new Error('Work Package gate journal progress is not monotonic');
    }
    events.push(parsed);
    previous = parsed.eventDigest;
  }
  if (lines.length !== expected.lastSequence || previous !== expected.digest) {
    throw new Error('Work Package gate journal final binding is invalid');
  }
  const kinds = events.map((event) => event.kind);
  const tail = kinds.slice(-3);
  if (kinds[0] !== 'started' || JSON.stringify(tail) !== JSON.stringify([
    'recovery', 'residue', 'completed'
  ]) ||
    kinds.filter((kind) => kind === 'started').length !== 1 ||
    kinds.filter((kind) => kind === 'recovery').length !== 1 ||
    kinds.filter((kind) => kind === 'residue').length !== 1 ||
    kinds.filter((kind) => kind === 'completed').length !== 1 ||
    kinds.filter((kind) => kind === 'deadline').length > 1 ||
    kinds.filter((kind) => kind === 'termination').length > 1 ||
    events.some((event) => ['started', 'heartbeat'].includes(event.kind)
      ? event.subjectDigest !== null
      : event.subjectDigest === null)) {
    throw new Error('Work Package gate journal event protocol is invalid');
  }
}

export function assertWorkPackageGateJournalV4(
  source: string,
  expected: { readonly lastSequence: number; readonly digest: string }
): readonly WorkPackageGateEventV4[] {
  if (Buffer.byteLength(source, 'utf8') > 8 * 1024 * 1024 || !source.endsWith('\n')) {
    throw new Error('Work Package gate V4 journal bytes are invalid');
  }
  const lines = source.slice(0, -1).split('\n');
  if (lines.length < 1 || lines.length > 32 || lines.some((line) => line.length === 0)) {
    throw new Error('Work Package gate V4 journal record count is invalid');
  }
  let previous: string | null = null;
  const events: WorkPackageGateEventV4[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[index]!) as unknown;
    } catch {
      throw new Error('Work Package gate V4 journal JSON is invalid');
    }
    assertWorkPackageGateEventV4(parsed, previous);
    if (parsed.sequence !== index + 1) throw new Error('Work Package gate V4 journal sequence is invalid');
    const prior = events.at(-1);
    if (prior && (parsed.elapsedMs < prior.elapsedMs ||
      parsed.stdoutBytes < prior.stdoutBytes || parsed.stderrBytes < prior.stderrBytes)) {
      throw new Error('Work Package gate V4 journal progress is not monotonic');
    }
    events.push(parsed);
    previous = parsed.eventDigest;
  }
  if (events.length !== expected.lastSequence || previous !== expected.digest) {
    throw new Error('Work Package gate V4 journal final binding is invalid');
  }
  const kinds = events.map((event) => event.kind);
  const allowedProtocols = new Set([
    'started,recovery,residue,completed',
    'started,deadline,recovery,residue,completed',
    'started,termination,recovery,residue,completed',
    'started,deadline,termination,recovery,residue,completed'
  ]);
  if (!allowedProtocols.has(kinds.join(','))) {
    throw new Error('Work Package gate V4 journal event protocol is invalid');
  }
  return Object.freeze(events);
}

function assertWorkPackageGateEvidenceBundleV1Internal(input: {
  readonly evidence: unknown;
  readonly journalSource: string;
}): void {
  assertWorkPackageGateEvidenceV1(input.evidence);
  const evidence = input.evidence;
  assertWorkPackageGateJournal(input.journalSource, evidence.journal);
  const events = input.journalSource.trimEnd().split('\n')
    .map((line) => JSON.parse(line) as WorkPackageGateEventV1);
  const completed = events.at(-1)!;
  assertWorkPackageGateEvent(completed);
  const deadline = events.find((event) => event.kind === 'deadline');
  const termination = events.find((event) => event.kind === 'termination');
  const recovery = events.find((event) => event.kind === 'recovery')!;
  const residue = events.find((event) => event.kind === 'residue')!;
  const expectsDeadline = evidence.child.trigger === 'timed-out';
  const expectsTermination = evidence.child.termination.requested;
  const recoveryPhase = evidence.recovery.complete
    ? 'recovery-complete'
    : 'authority-preserved';
  const residuePhase = evidence.residue.after === null
    ? 'residue-unknown'
    : 'residue-census';
  if (completed.kind !== 'completed' || completed.phase !== evidence.status ||
    Boolean(deadline) !== expectsDeadline || deadline?.phase !== (expectsDeadline ? 'watchdog' : undefined) ||
    Boolean(termination) !== expectsTermination ||
    termination?.phase !== (expectsTermination ? 'tree-close' : undefined) ||
    recovery.phase !== recoveryPhase || residue.phase !== residuePhase ||
    deadline?.subjectDigest !== (expectsDeadline
      ? digest({
        status: evidence.child.status,
        trigger: evidence.child.trigger,
        watchdogMs: evidence.timeouts.watchdogMs
      })
      : undefined) ||
    termination?.subjectDigest !== (expectsTermination
      ? digest(evidence.child.termination)
      : undefined) ||
    recovery.subjectDigest !== digest(evidence.recovery) ||
    residue.subjectDigest !== digest(evidence.residue) ||
    completed.subjectDigest !== digest({
      status: evidence.status,
      child: evidence.child,
      repository: evidence.repository
    }) ||
    recovery.stdoutBytes !== evidence.child.stdout.bytes ||
    recovery.stderrBytes !== evidence.child.stderr.bytes ||
    residue.stdoutBytes !== evidence.child.stdout.bytes ||
    residue.stderrBytes !== evidence.child.stderr.bytes ||
    completed.stdoutBytes !== evidence.child.stdout.bytes ||
    completed.stderrBytes !== evidence.child.stderr.bytes) {
    throw new Error('Work Package gate evidence and journal bundle do not agree');
  }
}

export function assertWorkPackageGateEvidenceBundleV1(input: {
  readonly evidence: unknown;
  readonly journalSource: string;
}): asserts input is {
  readonly evidence: WorkPackageGateEvidenceV1;
  readonly journalSource: string;
} {
  assertWorkPackageGateEvidenceBundleV1Internal(input);
}

export function assertWorkPackageGateEvidenceBundle(input: {
  readonly evidence: unknown;
  readonly journalSource: string;
}): asserts input is {
  readonly evidence: WorkPackageGateEvidenceV1;
  readonly journalSource: string;
} {
  assertWorkPackageGateEvidenceBundleV1Internal(input);
}

export function assertWorkPackageGateEvidenceBundleV4(input: {
  readonly evidence: unknown;
  readonly journalSource: string;
}): asserts input is {
  readonly evidence: WorkPackageGateEvidenceV4;
  readonly journalSource: string;
} {
  assertWorkPackageGateEvidenceV4(input.evidence);
  const evidence = input.evidence;
  const events = assertWorkPackageGateJournalV4(input.journalSource, evidence.journal);
  const expected: WorkPackageGateEventV4[] = [];
  const append = (
    kind: WorkPackageGateEventV4['kind'],
    phase: string,
    elapsedMs: number,
    subject: unknown,
    childBytes: boolean
  ): void => {
    expected.push(finalizeWorkPackageGateEventV4({
      sequence: expected.length + 1,
      kind,
      elapsedMs,
      phase,
      stdoutBytes: childBytes ? evidence.child.stdout.bytes : 0,
      stderrBytes: childBytes ? evidence.child.stderr.bytes : 0,
      subject,
      previousDigest: expected.at(-1)?.eventDigest ?? null
    }));
  };
  const recoveryPhase = evidence.recovery.complete ? 'recovery-complete' : 'authority-preserved';
  const residuePhase = evidence.residue.final === null ? 'residue-unknown' : 'residue-census';
  const startedSubject = {
    runId: evidence.runId,
    selection: evidence.selection,
    authority: evidence.authority,
    repositoryBefore: {
      headSha: evidence.repository.headSha,
      treeSha: evidence.repository.treeSha,
      worktreeBeforeDigest: evidence.repository.worktreeBeforeDigest,
      executionSnapshotDigest: evidence.repository.executionSnapshotDigest
    },
    timeouts: evidence.timeouts
  };
  append('started', 'preflight', 0, startedSubject, false);
  if (evidence.child.trigger === 'timed-out') {
    append('deadline', 'watchdog', evidence.child.durationMs, {
      status: evidence.child.status,
      trigger: evidence.child.trigger,
      watchdogMs: evidence.timeouts.watchdogMs
    }, true);
  }
  if (evidence.child.termination.requested) {
    append('termination', 'tree-close', evidence.child.durationMs, evidence.child.termination, true);
  }
  append('recovery', recoveryPhase, evidence.child.durationMs, evidence.recovery, true);
  append('residue', residuePhase, evidence.child.durationMs, evidence.residue, true);
  append('completed', evidence.status, Math.max(evidence.durationMs, evidence.child.durationMs), {
      status: evidence.status,
      child: evidence.child,
      diagnostic: evidence.diagnostic,
      repository: evidence.repository,
      recovery: evidence.recovery,
      residue: evidence.residue
    }, true);
  if (JSON.stringify(events) !== JSON.stringify(expected)) {
    throw new Error('Work Package gate V4 evidence and journal bundle do not agree');
  }
}

/** Flushes a directory where supported; Windows Bun exposes only best-effort directory fsync. */
export async function syncWorkPackageGateDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

export async function writeWorkPackageGateJsonAtomic(
  filePath: string,
  value: unknown,
  validator?: (readback: unknown) => void
): Promise<void> {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
  const serialized = JSON.stringify(value);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx');
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    validator?.(JSON.parse(serialized) as unknown);
    await rename(temporaryPath, absolutePath);
    await syncWorkPackageGateDirectory(path.dirname(absolutePath));
    const readback = await readFile(absolutePath, 'utf8');
    if (readback !== serialized) throw new Error('Work Package gate atomic write readback mismatch');
    validator?.(JSON.parse(readback) as unknown);
  } catch (error) {
    throw error;
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}
