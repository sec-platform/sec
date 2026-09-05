import { runWithOptionalSpinner } from './command-progress.ts';
import type { Command } from 'commander';
import type { LockFile } from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import type { CiArtifactKind } from '../../verification/ci-artifacts/contract/types.ts';
import type { VerificationLane } from '../../verification/contract/types.ts';
import { formatJson, printJsonOrText } from './format-utils.ts';
import { addBlock, composeWorkspace, explainWorkspace, initWorkspace, lockWorkspace, observeWorkspaceArtifacts, repairWorkspace, resolveWorkspace, upgradeWorkspace, verifyWorkspace, writeWorkspaceArtifacts } from './lazy-command-domains.ts';
import { jsonOpts, commandPath, usageError, addJsonFlags, optionalModeCommand } from './command-options.ts';

export function registerWorkspaceCommands(program: Command): void {
  program.command('init')
    .description('Initialize project workspace')
    .action(async () => {
      const cwd = process.cwd();
      await initWorkspace(cwd);
      console.log('Initialized project workspace');
    });

  program.command('add <block-id>')
    .description('Add a block to the project')
    .action(async (blockId: string) => {
      const cwd = process.cwd();
      const result = await addBlock(cwd, blockId);
      const selected = result.selectedBlock;
      console.log(`${result.changed ? 'Added' : 'Selected'} block ${selected.id}@${selected.version} from ${selected.registrySourceId} (${selected.registryKind})`);
    });

  program.command('resolve')
    .description('Resolve block dependencies')
    .action(async () => {
      const cwd = process.cwd();
      const { withSpinner } = await import('./runtime/spinner.ts');
      const { lock } = await withSpinner('Resolving block dependencies', () => resolveWorkspace(cwd));
      console.log(`Resolved ${lock.resolvedBlocks.length} blocks`);
    });

  program.command('compose')
    .description('Compose project')
    .option('--lock', 'Lock project files as read-only')
    .action(async (rawOptions: Record<string, unknown>) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { withSpinner } = await import('./runtime/spinner.ts');
      await withSpinner('Composing project', () => composeWorkspace(cwd, { lock: !!opts.lock }));
      console.log('Composed project');
    });

  addJsonFlags(program.command('verify'))
    .description('Run verification')
    .option('--lane <lane>', 'Verification lane', 'fast')
    .action(async (rawOptions: Record<string, unknown>) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const lane = opts.lane as VerificationLane;
      if (lane !== 'fast' && lane !== 'runtime' && lane !== 'all') {
        throw usageError('Lane must be fast, runtime, or all');
      }
      const output = jsonOpts(opts);
      const { report } = await runWithOptionalSpinner('Running verification', output, () => verifyWorkspace(cwd, { lane, emitTiming: !output.json }));
      printJsonOrText(report, output, (v) => `Verification ${v.summary.status} (${v.summary.requestedLane})`);
    });

  addJsonFlags(optionalModeCommand(program.command('repair'), 'mode', ['plan']))
    .description('Run repair')
    .option('--dry-run', 'Dry run repair')
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
      const { pathExists } = await import('../../workspace/files.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
      const { formatRepairSummary } = await import('./formatters.ts');
      const { readRequiredRepairPlan } = await import('./artifact-command-read.ts');
      const output = jsonOpts(opts);
      if (mode === 'plan') {
        const repairPlanPath = resolveWorkspaceArtifactPath(cwd, CI_ARTIFACT_FILES.repairPlan);
        const repairPlan = readRequiredRepairPlan(
          repairPlanPath,
          `Repair plan not found; run ${commandPath(cmd)} --dry-run first`
        );
        printJsonOrText(repairPlan, output, (p) => formatRepairSummary(p, true));
        return;
      }
      try {
        const { repairPlan } = await runWithOptionalSpinner(
          opts.dryRun ? 'Previewing repair' : 'Running repair',
          output,
          () => repairWorkspace(cwd, { dryRun: !!opts.dryRun })
        );
        printJsonOrText(repairPlan, output, (p) => formatRepairSummary(p, !!opts.dryRun));
      } catch (error) {
        const repairPlanPath = resolveWorkspaceArtifactPath(cwd, CI_ARTIFACT_FILES.repairPlan);
        if (await pathExists(repairPlanPath)) {
          const repairPlan = readRequiredRepairPlan(
            repairPlanPath,
            'Repair plan disappeared before it could be read back.'
          );
          printJsonOrText(repairPlan, output, (p) => formatRepairSummary(p, !!opts.dryRun));
        }
        throw error;
      }
    });

  addJsonFlags(program.command('upgrade')
    .argument('[subject]')
    .argument('[target-version]'))
    .description('Run upgrade')
    .option('--dry-run', 'Dry run upgrade')
    .action(async (
      subject: string | undefined,
      targetVersion: string | undefined,
      rawOptions: Record<string, unknown>,
      cmd: Command
    ) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { readUpgradeArtifactSet } = await import('../../change-management/upgrade/runtime/artifact-readback.ts');
      const { formatUpgradeDiagnostics, formatUpgradePlan, formatUpgradePreview } = await import('./formatters.ts');
      const output = jsonOpts(opts);
      if (subject === 'plan' && targetVersion === undefined) {
        const { plan: upgradePlan, executionTerminal: upgradeExecutionTerminal } = readUpgradeArtifactSet(cwd);
        if (upgradePlan === null) {
          throw new CompilerError(
            'UPGRADE-BLOCKED-003',
            `Upgrade plan not found; run ${commandPath(cmd)} <block-id> <target-version>`
          );
        }
        printJsonOrText(
          upgradePlan,
          output,
          (plan) => formatUpgradePlan(plan, upgradeExecutionTerminal)
        );
        return;
      }
      if (subject === 'diagnostics' && targetVersion === undefined) {
        const { diagnostics: upgradeDiagnostics } = readUpgradeArtifactSet(cwd);
        if (upgradeDiagnostics === null) {
          throw new CompilerError(
            'UPGRADE-BLOCKED-003',
            `Upgrade diagnostics not found; run ${commandPath(cmd)} <block-id> <target-version>`
          );
        }
        printJsonOrText(upgradeDiagnostics, output, formatUpgradeDiagnostics);
        return;
      }
      if (subject === undefined || targetVersion === undefined) {
        throw usageError(`Usage: ${commandPath(cmd)} <block-id> <target-version> [--dry-run] [--json [--compact]]`);
      }
      const result = await runWithOptionalSpinner(
        opts.dryRun ? 'Previewing upgrade' : 'Running upgrade',
        output,
        () => upgradeWorkspace(cwd, subject, targetVersion, { dryRun: !!opts.dryRun })
      );
      if (result.resultKind === 'preview') {
        printJsonOrText(result.upgradePlan, output, formatUpgradePreview);
      } else {
        printJsonOrText(
          result.upgradePlan,
          output,
          (plan) => formatUpgradePlan(plan, result.upgradeExecutionTerminal)
        );
      }
    });

  addJsonFlags(optionalModeCommand(program.command('lock'), 'mode', ['inspect']))
    .description('Lock project')
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { resolveWorkspaceLockPath } = await import('../../workspace/runtime/paths.ts');
      const { formatLockInspect } = await import('./formatters.ts');
      const { printRequiredJson } = await import('./artifact-command-read.ts');
      const output = jsonOpts(opts);
      if (mode === 'inspect') {
        const lockPath = await resolveWorkspaceLockPath(cwd);
        await printRequiredJson<LockFile>(lockPath, `Graph lock not found; run ${commandPath(cmd)} first`, output, formatLockInspect);
        return;
      }
      await runWithOptionalSpinner('Locking project', output, () => lockWorkspace(cwd));
      console.log('Locked project');
    });

  addJsonFlags(optionalModeCommand(program.command('explain'), 'mode', ['graph']))
    .description('Explain project')
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
      const { buildE2eMatrix } = await import('../../verification/review/runtime/matrix.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
      const { formatExplainGraphInspect, formatExplainSummary } = await import('./formatters.ts');
      const { printWorkspaceJson } = await import('./artifact-command-read.ts');
      const output = jsonOpts(opts);
      if (mode === 'graph') {
        await printWorkspaceJson<import('../../semantic/projection/contract/explain.ts').ExplainGraph>(
          cwd, (root) => resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.explainGraph), `Explain graph not found; run ${commandPath(cmd)} first`, output, formatExplainGraphInspect
        );
        return;
      }
      const { graph, reviewSummary } = await runWithOptionalSpinner('Explaining project', output, () => explainWorkspace(cwd));
      printJsonOrText({ graph, reviewSummary, e2eMatrix: buildE2eMatrix(reviewSummary) }, output, (s) => formatExplainSummary(s.graph, s.reviewSummary));
    });

  addJsonFlags(optionalModeCommand(program.command('artifacts'), 'mode', ['manifest']))
    .description('Manage CI artifacts')
    .option('--paths', 'List artifact paths')
    .option('--kind <kind>', 'Filter by artifact kind')
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
      const { buildArtifactUploadPathContract, formatCiArtifactManifest } = await import('./formatters.ts');
      const { printWorkspaceJson } = await import('./artifact-command-read.ts');
      const output = jsonOpts(opts);
      if (mode === 'manifest') {
        await printWorkspaceJson<import('../../verification/ci-artifacts/contract/types.ts').CiArtifactManifest>(
          cwd, (root) => resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.artifactManifest), `Artifact manifest not found; run ${commandPath(cmd)} --json first`, output, formatCiArtifactManifest
        );
        return;
      }
      if (opts.paths) {
        const manifest = await observeWorkspaceArtifacts(cwd);
        const kind = opts.kind as CiArtifactKind | undefined;
        const contract = buildArtifactUploadPathContract(manifest, kind);
        printJsonOrText(contract, output, (c) => c.paths.join('\n'));
        return;
      }
      const { manifest } = await writeWorkspaceArtifacts(cwd);
      console.log(formatJson(manifest, output));
    });
}
