import { expect, test } from 'bun:test';

import {
  CI_ARTIFACT_FILES,
  CI_ARTIFACT_KINDS,
  CI_ARTIFACT_MANIFEST_PATH,
  ciArtifactUploadCommand
} from '../../platform/shared/ci-artifact-contract.ts';
import { buildCiContract, formatCiContract } from '../../platform/shared/ci-contract.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';
import { expectCliVariants } from '../testkit/cli.ts';
import {
  expectCiContractSelfConsistent,
  expectFullLaneCoversCorrectnessBackstop,
  expectPrFastLaneBoundary
} from '../testkit/contracts.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('CLI exposes CI command contract as text and JSON contracts', async () => {
  const contract = buildCiContract();
  const formatted = formatCiContract(contract);
  const artifactUploadCommands = CI_ARTIFACT_KINDS.map(ciArtifactUploadCommand);
  const stepsById = new Map(contract.steps.map((step) => [step.id, step]));
  const defaultGate = stepsById.get(contract.defaultGate);
  const fullRuntimeGate = stepsById.get(contract.fullRuntimeGate);

  if (!defaultGate) throw new Error(`Missing CI default gate ${contract.defaultGate}`);
  if (!fullRuntimeGate) throw new Error(`Missing CI full runtime gate ${contract.fullRuntimeGate}`);

  expect(formatted).toContain('CI contract active');
  expect(formatted).toContain(`Command: ${contract.command}`);
  expect(formatted).toContain(`Default gate: ${contract.defaultGate}`);
  expect(formatted).toContain(`Full runtime gate: ${contract.fullRuntimeGate}`);
  expect(formatted).toContain(
    `Step ${contract.defaultGate}; phase=verify; command=${defaultGate.command}; producesCount=${defaultGate.producesCount}`
  );
  expect(JSON.stringify(contract)).not.toContain('\n');

  expect(contract.formatVersion).toBe('1');
  expect(contract.status).toBe('active');
  expect(contract.command).toBe('bun run sec -- contract ci --json');
  expect(contract.defaultGate).toBe('fast-runtime-verify');
  expect(contract.fullRuntimeGate).toBe('full-runtime-verify');
  expectCiContractSelfConsistent(contract);
  expectPrFastLaneBoundary(contract);
  expectFullLaneCoversCorrectnessBackstop(contract);

  expect(contract.verifyCommands).toEqual(
    contract.steps.filter((step) => step.phase === 'verify').map((step) => step.command)
  );
  expect(contract.qualityCommands).toEqual(
    contract.steps.filter((step) => step.phase === 'quality').map((step) => step.command)
  );
  expect(contract.diagnosticCommands).toEqual(
    contract.steps.filter((step) => step.phase === 'diagnostics').map((step) => step.command)
  );
  expect(contract.artifactUploadCommands).toEqual(artifactUploadCommands);

  expect(defaultGate).toMatchObject({
    phase: 'verify',
    command: 'bun run sec -- verify --json --compact',
    produces: [CI_ARTIFACT_FILES.verificationReport]
  });
  expect(fullRuntimeGate).toMatchObject({
    phase: 'verify',
    command: 'bun run sec -- verify --lane all --json --compact',
    produces: expect.arrayContaining([
      CI_ARTIFACT_FILES.verificationReport,
      CI_ARTIFACT_FILES.runtimeReport,
      CI_ARTIFACT_FILES.acceptanceCoverage
    ])
  });
  for (const kind of CI_ARTIFACT_KINDS) {
    expect(stepsById.get(`${kind}-artifacts`)).toMatchObject({
      phase: 'artifacts',
      command: ciArtifactUploadCommand(kind),
      produces: [CI_ARTIFACT_MANIFEST_PATH]
    });
  }

  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['contract', 'ci'], {
      text: [
        'CI contract active',
        `Command: ${contract.command}`,
        `Default gate: ${contract.defaultGate}`,
        `Full runtime gate: ${contract.fullRuntimeGate}`,
        `Verify command count: ${contract.verifyCommandCount}`,
        `Quality command count: ${contract.qualityCommandCount}`,
        `Diagnostic command count: ${contract.diagnosticCommandCount}`,
        `Artifact upload command count: ${contract.artifactUploadCommandCount}`,
        `Artifact uploads: ${artifactUploadCommands.join(', ')}`,
        `Artifact paths: ${contract.artifactPathCount}`,
        `Artifact path list: ${contract.artifactPaths.join(', ')}`,
        `Steps: ${contract.stepCount}`,
        `Step ${contract.defaultGate}; phase=verify; command=${defaultGate.command}; producesCount=${defaultGate.producesCount}`,
        `Step ${contract.fullRuntimeGate}; phase=verify; command=${fullRuntimeGate.command}; producesCount=${fullRuntimeGate.producesCount}`,
        'Step contract-freeze; phase=quality; command=bun run test:contract-freeze',
        'Step reference-drift; phase=quality; command=bun run sec -- reference check --json --compact',
        'Step diagnostic-review-matrix; phase=diagnostics; command=bun run sec -- review matrix --json --compact',
        'Step contract-artifacts; phase=artifacts; command=bun run sec -- artifacts --paths --json --compact --kind contract'
      ],
      json: {
        status: 'active',
        command: contract.command,
        defaultGate: contract.defaultGate,
        fullRuntimeGate: contract.fullRuntimeGate,
        verifyCommandCount: contract.verifyCommandCount,
        verifyCommands: contract.verifyCommands,
        qualityCommandCount: contract.qualityCommandCount,
        qualityCommands: contract.qualityCommands,
        diagnosticCommandCount: contract.diagnosticCommandCount,
        diagnosticCommands: contract.diagnosticCommands,
        artifactUploadCommandCount: contract.artifactUploadCommandCount,
        artifactUploadCommands,
        artifactPathCount: contract.artifactPathCount,
        artifactPaths: contract.artifactPaths,
        stepCount: contract.stepCount
      }
    });
  });
});

test('GitHub compiler CI workflow covers CI command contract gates', async () => {
  const workflow = await readCompilerFile('.github/workflows/compiler-validation.yml');
  const contract = buildCiContract();
  const slowSuiteCommands = contract.fullLaneCommands.filter((command) => command.startsWith('bun run test:slow -- --suite '));
  const fullLaneCommandsMaterializedInWorkflow = contract.fullLaneCommands.filter(
    (command) => !slowSuiteCommands.includes(command)
  );

  const missingPrQuickLaneCommands = contract.prQuickLaneCommands.filter(
    (command) => !workflow.includes(command)
  );
  const missingPrRiskLaneCommands = contract.prRiskLaneCommands.filter(
    (command) => !workflow.includes(command)
  );
  const missingReleaseLaneCommands = fullLaneCommandsMaterializedInWorkflow.filter(
    (command) => !workflow.includes(command)
  );

  expect(missingPrQuickLaneCommands).toEqual([]);
  expect(missingPrRiskLaneCommands).toEqual([]);
  expect(missingReleaseLaneCommands).toEqual([]);
  expect(slowSuiteCommands.length).toBeGreaterThan(0);
  expect(workflow).toContain('compiler-release-slow-matrix');
  expect(workflow).toContain('slowTestSuiteIds');
  expect(workflow).toContain('suite: ${{ fromJSON(needs.compiler-release-slow-matrix.outputs.suites) }}');
  expect(workflow).toContain('bun run test:slow -- --suite ${{ matrix.suite }}');

  expect(workflow).not.toContain('# bun run sec -- verify --json --compact');
  expect(workflow).not.toContain('# bun run imports:check');
});
