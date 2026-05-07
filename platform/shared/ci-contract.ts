import {
  CI_ARTIFACT_FILES,
  CI_ARTIFACT_KINDS,
  CI_ARTIFACT_MANIFEST_PATH,
  CI_EXPLAIN_GRAPH_ARTIFACT_PATHS,
  ciArtifactUploadCommand
} from './ci-artifact-contract.ts';
import type { CiArtifactKind } from './ci-artifact-types.ts';
import { uniqueSorted } from './collections.ts';
import { CONTRACT_FORMAT_VERSION, CONTRACT_STATUS_ACTIVE } from './constants.ts';
import { platformCommand } from './platform-command.ts';
import { slowTestSuiteIds } from './test-budget-contract.ts';

export type CiContractStep = {
  id: string;
  phase: 'verify' | 'quality' | 'diagnostics' | 'artifacts';
  command: string;
  purpose: string;
  producesCount: number;
  produces: string[];
};

export type CiContract = {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  status: typeof CONTRACT_STATUS_ACTIVE;
  command: string;
  defaultGate: string;
  fullRuntimeGate: string;
  prQuickLaneCommandCount: number;
  prQuickLaneCommands: string[];
  prRiskLaneCommandCount: number;
  prRiskLaneCommands: string[];
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

const prQuickLaneCommands = [
  'bun install --frozen-lockfile',
  'bun run imports:organize',
  'bun scripts/ci-pr-quick.ts'
];

const prRiskLaneCommands = [
  'bun install --frozen-lockfile',
  'bun scripts/ci-pr-risk.ts'
];

const fullSlowSuiteCommands = slowTestSuiteIds().map((suiteId) => `bun run test:slow -- --suite ${suiteId}`);

const fullLaneCommands = [
  'bun install --frozen-lockfile',
  'bun run imports:organize',
  'bun run typecheck',
  platformCommand('test', 'budget', '--json', '--compact'),
  'bun run test:contract-freeze',
  ...fullSlowSuiteCommands,
  platformCommand('benchmark', 'suite', '--json', '--compact'),
  platformCommand('deps', 'warmup'),
  platformCommand('resolve'),
  platformCommand('compose'),
  platformCommand('adapt'),
  platformCommand('verify', '--lane', 'all', '--json', '--compact'),
  platformCommand('lock'),
  platformCommand('explain'),
  platformCommand('reference', 'check', '--json', '--compact')
];

const ciArtifactPurposes: Record<CiArtifactKind, string> = {
  governance: 'Emit upload paths for governance artifacts.',
  view: 'Emit upload paths for generated view artifacts.',
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
    command: 'bun run typecheck',
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
    purpose: 'Run the full runtime gate for release, demo, or scheduled CI.',
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
  {
    id: 'contract-freeze',
    phase: 'quality',
    command: 'bun run test:contract-freeze',
    purpose: 'Run the contract freeze suite declared by platform contract freeze.',
    produces: []
  },
  ...fullSlowSuiteCommands.map((command) => {
    const suiteId = command.split('--suite ')[1];
    return {
      id: `slow-e2e-${suiteId}`,
      phase: 'quality' as const,
      command,
      purpose: 'Run one slow e2e suite in full/manual/scheduled validation.',
      produces: []
    };
  }),
  {
    id: 'benchmark-task-suite',
    phase: 'quality',
    command: platformCommand('benchmark', 'suite', '--json', '--compact'),
    purpose: 'Expose the benchmark task-suite contract and scoring dimensions for scheduled quality jobs.',
    produces: []
  },
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
    formatVersion: CONTRACT_FORMAT_VERSION,
    status: CONTRACT_STATUS_ACTIVE,
    command: platformCommand('contract', 'ci', '--json'),
    defaultGate: 'fast-runtime-verify',
    fullRuntimeGate: 'full-runtime-verify',
    prQuickLaneCommandCount: prQuickLaneCommands.length,
    prQuickLaneCommands: [...prQuickLaneCommands],
    prRiskLaneCommandCount: prRiskLaneCommands.length,
    prRiskLaneCommands: [...prRiskLaneCommands],
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

export function formatCiContract(contract: CiContract): string {
  return [
    `CI contract ${contract.status}`,
    `Command: ${contract.command}`,
    `Default gate: ${contract.defaultGate}`,
    `Full runtime gate: ${contract.fullRuntimeGate}`,
    `PR quick lane command count: ${contract.prQuickLaneCommandCount}`,
    `PR quick lane commands: ${contract.prQuickLaneCommands.join(', ')}`,
    `PR risk lane command count: ${contract.prRiskLaneCommandCount}`,
    `PR risk lane commands: ${contract.prRiskLaneCommands.join(', ')}`,
    `Full lane command count: ${contract.fullLaneCommandCount}`,
    `Full lane commands: ${contract.fullLaneCommands.join(', ')}`,
    `Verify command count: ${contract.verifyCommandCount}`,
    `Verify commands: ${contract.verifyCommands.join(', ')}`,
    `Quality command count: ${contract.qualityCommandCount}`,
    `Quality commands: ${contract.qualityCommands.join(', ')}`,
    `Diagnostic command count: ${contract.diagnosticCommandCount}`,
    `Diagnostic commands: ${contract.diagnosticCommands.join(', ')}`,
    `Artifact upload command count: ${contract.artifactUploadCommandCount}`,
    `Artifact uploads: ${contract.artifactUploadCommands.join(', ')}`,
    `Artifact paths: ${contract.artifactPathCount}`,
    `Artifact path list: ${contract.artifactPaths.join(', ')}`,
    `Steps: ${contract.stepCount}`,
    ...contract.steps.map((step) => [
      `Step ${step.id}`,
      `phase=${step.phase}`,
      `command=${step.command}`,
      `producesCount=${step.producesCount}`,
      `produces=${step.produces.join(', ')}`
    ].join('; '))
  ].join('\n');
}
