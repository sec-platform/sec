import { CI_ARTIFACT_FILES, CI_ARTIFACT_MANIFEST_PATH, CI_EXPLAIN_GRAPH_ARTIFACT_PATHS } from '../../../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { CiArtifactKind } from '../../../../../assurance/verification/ci-artifacts/contract/types.ts';
import { CI_ARTIFACT_KINDS } from '../../../../../assurance/verification/ci-artifacts/contract/types.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../../../../assurance/verification/contract/revision.ts';
import { uniqueSorted } from '../../../../../contracts/canonical.ts';
import { CI_MAIN_HEALTH_POLICY, CI_MAIN_HEALTH_POLICY_DIGEST } from '../../../../self-hosting/control/main-health/provider-policy.ts';
import { platformCommand } from '../../command.ts';
import { slowTestSuiteIds } from '../../test-impact/contract/budget.ts';
import {
  CI_VERIFICATION_EXECUTION_MODEL
} from './plan.ts';
import { CI_VERIFICATION_SESSION_DISPATCH_TYPE } from './revision.ts';

const CI_CONTRACT_STATUS_ACTIVE = 'active' as const;

export const CI_VERIFICATION_PR_EVENT = 'repository_dispatch' as const;
const CI_VERIFICATION_PR_DISPATCH_TYPE = CI_VERIFICATION_SESSION_DISPATCH_TYPE;
export const CI_VERIFICATION_PR_STEP_ORDER = [
  'Resolve proposal against live default, PR, candidate, and actor',
  'Publish or join Review request and wait for exact Review clearance',
  'Dispatch or join canonical ActionKey producers until terminal',
  'Create immutable Action start marker from fresh provider census',
  'Publish durable start tombstone and issue execution ticket',
  'Execute one normalized candidate operation without credentials',
  'Assemble canonical five-state terminal artifact',
  'Create exact post-upload terminal anchor',
  'Publish neutral terminal provider tombstone',
  'Compose V4 Evidence only from canonical Action terminals',
  'Finalize provenance-bound Verification Session artifact'
] as const;
const CI_VERIFICATION_RELEASE_STEP_ORDER = [
  'Resolve trusted release request, exact head, and verifier boundary',
  'Checkout exact release head',
  'Fetch release base for exact tree comparison',
  'Setup Bun',
  'Cache bun install',
  'Cache tsc incremental build info',
  'Install dependencies once',
  'Run exact-head full verification',
  'Upload compact full verification evidence'
] as const;
export const CI_MAIN_HEALTH_JOB_NAME = CI_MAIN_HEALTH_POLICY.context;
export const CI_MAIN_HEALTH_STEP_ORDER = [
  'Bind canonical MainHealth request to live main',
  'Checkout exact pushed main revision',
  'Setup trusted Bun',
  'Cache Bun install',
  'Install dependencies from the frozen lock',
  'Reject import organization drift',
  'Run exact-main TypeScript checks',
  'Reject static architecture contradictions',
  'Validate active documentation authority',
  'Run the complete fast test inventory'
] as const;
export const CI_MAIN_HEALTH_COMMANDS = [
  'bun install --frozen-lockfile',
  'bun run imports:check',
  'bun run typecheck:verified',
  'bun run audit -- --scope source-program --enforce',
  'bun run docs:doctor',
  'bun run test -- --scope fast'
] as const;

function ciArtifactUploadCommand(kind: CiArtifactKind): string {
  return platformCommand('artifacts', '--paths', '--json', '--compact', '--kind', kind);
}

type CiContractStep = {
  id: string;
  phase: 'verify' | 'quality' | 'diagnostics' | 'artifacts';
  command: string;
  purpose: string;
  producesCount: number;
  produces: string[];
};

export type CiContract = {
  status: typeof CI_CONTRACT_STATUS_ACTIVE;
  command: string;
  defaultGate: string;
  fullRuntimeGate: string;
  verificationContractRevision: typeof CI_VERIFICATION_CONTRACT_REVISION;
  executionModel: typeof CI_VERIFICATION_EXECUTION_MODEL;
  prWorkflowEvent: typeof CI_VERIFICATION_PR_EVENT;
  prDispatchType: typeof CI_VERIFICATION_PR_DISPATCH_TYPE;
  prWorkflowStepCount: number;
  prWorkflowStepOrder: string[];
  releaseWorkflowStepCount: number;
  releaseWorkflowStepOrder: string[];
  prWorkflowCommandCount: number;
  prWorkflowCommands: string[];
  releaseWorkflowCommandCount: number;
  releaseWorkflowCommands: string[];
  mainHealthContext: typeof CI_MAIN_HEALTH_JOB_NAME;
  mainHealthPolicyDigest: typeof CI_MAIN_HEALTH_POLICY_DIGEST;
  mainHealthStepCount: number;
  mainHealthStepOrder: string[];
  mainHealthCommandCount: number;
  mainHealthCommands: string[];
  prQuickLaneCommandCount: number;
  prQuickLaneCommands: string[];
  fullLaneCommandCount: number;
  fullLaneCommands: string[];
  verifyCommandCount: number;
  verifyCommands: string[];
  qualityCommandCount: number;
  qualityCommands: string[];
  diagnosticCommandCount: number;
  diagnosticCommands: string[];
  artifactUploadCommandCount: number;
  artifactUploadCommands: string[];
  artifactPathCount: number;
  artifactPaths: string[];
  stepCount: number;
  steps: CiContractStep[];
};

const prWorkflowCommands = [
  'bun src/adapters/verification/platform/ci/runtime/verification-session.ts observe-hosted',
  'bun src/adapters/verification/platform/ci/runtime/verification-session.ts prepare-hosted',
  'bun src/adapters/verification/platform/ci/verification.ts ensure-hosted-action-provider',
  'bun src/adapters/verification/platform/ci/verification.ts resolve-hosted-action',
  'install --frozen-lockfile --ignore-scripts',
  'bun src/adapters/verification/platform/ci/verification.ts prepare-hosted-action-inputs',
  'bun src/adapters/verification/platform/ci/verification.ts self-test-hosted-action-sandbox',
  'bun src/adapters/verification/platform/ci/verification.ts execute-hosted-action-sut',
  'bun src/adapters/verification/platform/ci/verification.ts assemble-hosted-action-terminal',
  'bun src/adapters/verification/platform/ci/verification.ts compose-hosted-evidence',
  'bun src/adapters/verification/platform/ci/runtime/verification-session.ts finalize-hosted'
];

const releaseWorkflowCommands = [
  'bun install --frozen-lockfile',
  'bun src/adapters/verification/platform/ci/verification.ts --profile full --expected-head "$SEC_EXPECTED_HEAD_SHA"',
  'bun run release:build'
];

const prQuickLaneCommands = [
  'bun run imports:check',
  'bun run typecheck:verified',
  'bun run test -- --affected'
];

const fullSlowSuiteCommands = slowTestSuiteIds().map((suiteId) => `bun run test -- --scope slow --suite ${suiteId}`);

const fullLaneCommands = [
  'bun run imports:check',
  'bun run typecheck:verified',
  'bun run docs:doctor',
  'bun run test -- --scope fast',
  platformCommand('test', 'budget', '--json', '--compact'),
  ...fullSlowSuiteCommands,
  platformCommand('deps', 'warmup'),
  platformCommand('resolve'),
  platformCommand('compose'),
  platformCommand('verify', '--lane', 'all', '--json', '--compact'),
  platformCommand('lock'),
  platformCommand('explain'),
  platformCommand('reference', 'check', '--json', '--compact')
];

const ciArtifactPurposes: Record<CiArtifactKind, string> = {
  governance: 'Emit upload paths for governance artifacts.',
  test: 'Emit upload paths for runtime test artifacts.',
  contract: 'Emit upload paths for contract artifacts.'
};

const ciArtifactSteps = CI_ARTIFACT_KINDS.map((kind): Omit<CiContractStep, 'producesCount'> => ({
  id: `${kind}-artifacts`,
  phase: 'artifacts',
  command: ciArtifactUploadCommand(kind),
  purpose: ciArtifactPurposes[kind],
  produces: [CI_ARTIFACT_MANIFEST_PATH]
}));

const ciSteps: Array<Omit<CiContractStep, 'producesCount'>> = [
  {
    id: 'typecheck',
    phase: 'quality',
    command: 'bun run typecheck:verified',
    purpose: 'Run TypeScript static checks before CI gates that execute generated workspaces.',
    produces: []
  },
  {
    id: 'organized-imports',
    phase: 'quality',
    command: 'bun run imports:check',
    purpose: 'Ensure TypeScript import declarations are normalized by the shared organizer.',
    produces: []
  },
  {
    id: 'docs-doctor',
    phase: 'quality',
    command: 'bun run docs:doctor',
    purpose: 'Validate active engineering documentation before release validation.',
    produces: []
  },
  {
    id: 'full-fast-tests',
    phase: 'quality',
    command: 'bun run test -- --scope fast',
    purpose: 'Run the complete fast test inventory as the release correctness backstop.',
    produces: []
  },
  {
    id: 'fast-runtime-verify',
    phase: 'verify',
    command: platformCommand('verify', '--json', '--compact'),
    purpose: 'Run the default fast runtime verification lane.',
    produces: [CI_ARTIFACT_FILES.verificationReport]
  },
  {
    id: 'full-runtime-verify',
    phase: 'verify',
    command: platformCommand('verify', '--lane', 'all', '--json', '--compact'),
    purpose: 'Run the full runtime gate for release or explicit full verification.',
    produces: [
      CI_ARTIFACT_FILES.verificationReport,
      CI_ARTIFACT_FILES.runtimeReport,
      CI_ARTIFACT_FILES.acceptanceCoverage
    ]
  },
  {
    id: 'slow-test-budget',
    phase: 'quality',
    command: platformCommand('test', 'budget', '--json', '--compact'),
    purpose: 'Expose the slow-suite budget before selecting CI gates.',
    produces: []
  },
  ...fullSlowSuiteCommands.map((command) => {
    const suiteId = command.split('--suite ')[1];
    return {
      id: `slow-e2e-${suiteId}`,
      phase: 'quality' as const,
      command,
      purpose: 'Run one slow e2e suite in explicit full verification.',
      produces: []
    };
  }),
  {
    id: 'reference-drift',
    phase: 'quality',
    command: platformCommand('reference', 'check', '--json', '--compact'),
    purpose: 'Refresh the checked-in reference workspace and fail on drift.',
    produces: []
  },
  {
    id: 'diagnostic-review',
    phase: 'diagnostics',
    command: platformCommand('review', 'summary', '--json', '--compact'),
    purpose: 'Expose policy, provenance, repair, upgrade, and artifact review evidence.',
    produces: [CI_ARTIFACT_FILES.reviewSummary]
  },
  {
    id: 'diagnostic-review-matrix',
    phase: 'diagnostics',
    command: platformCommand('review', 'matrix', '--json', '--compact'),
    purpose: 'Expose the E2E matrix derived from the latest review summary.',
    produces: []
  },
  {
    id: 'diagnostic-review-diagnostics',
    phase: 'diagnostics',
    command: platformCommand('review', 'diagnostics', '--json', '--compact'),
    purpose: 'Expose failure, regression risk, and conflict diagnostics from the latest review summary.',
    produces: []
  },
  {
    id: 'diagnostic-explain',
    phase: 'diagnostics',
    command: platformCommand('explain', '--json', '--compact'),
    purpose: 'Expose the explain graph and review summary for failed CI triage.',
    produces: [
      ...CI_EXPLAIN_GRAPH_ARTIFACT_PATHS,
      CI_ARTIFACT_FILES.reviewSummary
    ]
  },
  {
    id: 'diagnostic-demo-checklist',
    phase: 'diagnostics',
    command: platformCommand('demo', 'checklist', '--json', '--compact'),
    purpose: 'Expose whether existing governance artifacts satisfy local demo readiness.',
    produces: []
  },
  ...ciArtifactSteps
];

export function buildCiContract(): CiContract {
  const verifyCommands = ciSteps
    .filter((step) => step.phase === 'verify')
    .map((step) => step.command);
  const qualityCommands = ciSteps
    .filter((step) => step.phase === 'quality')
    .map((step) => step.command);
  const diagnosticCommands = ciSteps
    .filter((step) => step.phase === 'diagnostics')
    .map((step) => step.command);
  const artifactUploadCommands = ciSteps
    .filter((step) => step.phase === 'artifacts')
    .map((step) => step.command);
  const artifactPaths = uniqueSorted(ciSteps.flatMap((step) => step.produces));

  return {
    status: CI_CONTRACT_STATUS_ACTIVE,
    command: platformCommand('contract', 'ci', '--json'),
    defaultGate: 'fast-runtime-verify',
    fullRuntimeGate: 'full-runtime-verify',
    verificationContractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    executionModel: CI_VERIFICATION_EXECUTION_MODEL,
    prWorkflowEvent: CI_VERIFICATION_PR_EVENT,
    prDispatchType: CI_VERIFICATION_PR_DISPATCH_TYPE,
    prWorkflowStepCount: CI_VERIFICATION_PR_STEP_ORDER.length,
    prWorkflowStepOrder: [...CI_VERIFICATION_PR_STEP_ORDER],
    releaseWorkflowStepCount: CI_VERIFICATION_RELEASE_STEP_ORDER.length,
    releaseWorkflowStepOrder: [...CI_VERIFICATION_RELEASE_STEP_ORDER],
    prWorkflowCommandCount: prWorkflowCommands.length,
    prWorkflowCommands: [...prWorkflowCommands],
    releaseWorkflowCommandCount: releaseWorkflowCommands.length,
    releaseWorkflowCommands: [...releaseWorkflowCommands],
    mainHealthContext: CI_MAIN_HEALTH_JOB_NAME,
    mainHealthPolicyDigest: CI_MAIN_HEALTH_POLICY_DIGEST,
    mainHealthStepCount: CI_MAIN_HEALTH_STEP_ORDER.length,
    mainHealthStepOrder: [...CI_MAIN_HEALTH_STEP_ORDER],
    mainHealthCommandCount: CI_MAIN_HEALTH_COMMANDS.length,
    mainHealthCommands: [...CI_MAIN_HEALTH_COMMANDS],
    prQuickLaneCommandCount: prQuickLaneCommands.length,
    prQuickLaneCommands: [...prQuickLaneCommands],
    fullLaneCommandCount: fullLaneCommands.length,
    fullLaneCommands: [...fullLaneCommands],
    verifyCommandCount: verifyCommands.length,
    verifyCommands,
    qualityCommandCount: qualityCommands.length,
    qualityCommands,
    diagnosticCommandCount: diagnosticCommands.length,
    diagnosticCommands,
    artifactUploadCommandCount: artifactUploadCommands.length,
    artifactUploadCommands,
    artifactPathCount: artifactPaths.length,
    artifactPaths,
    stepCount: ciSteps.length,
    steps: ciSteps.map((step) => ({
      ...step,
      producesCount: step.produces.length,
      produces: [...step.produces]
    }))
  };
}
