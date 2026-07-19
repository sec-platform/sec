import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ensureDevDependencies } from './dev-runner/dependency-bootstrap.ts';
import { cleanTestWorkspaces } from './dev-runner/env-manager.ts';

function devRunnerModuleUrl(moduleName: string): string {
  return new URL(`./dev-runner/${moduleName}.ts`, import.meta.url).href;
}

function reenterWithResolvedDependencies(): never {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

function usage(): never {
  console.error('Usage: bun ./platform/dev-runner.ts <deps:ensure|typecheck|test|test:affected|test:fast|test:slow|test:full|contract-freeze|imports:prepare|imports:check|imports:organize|imports:freeze|imports:staged [--candidate-base <sha>]|clean-test-workspaces> [args...]');
  process.exit(1);
}

async function main(): Promise<void> {
  const [target, ...args] = process.argv.slice(2);
  if (!target) {
    usage();
  }

  if (target === 'clean-test-workspaces') {
    await cleanTestWorkspaces();
    return;
  }

  const dependencies = await ensureDevDependencies();
  if (target === 'deps:ensure') {
    console.log(`Compiler dependencies ready (${dependencies.source}, ${dependencies.manifestHash}).`);
    return;
  }
  if (dependencies.source === 'installed') {
    reenterWithResolvedDependencies();
  }

  if (
    target === 'imports:prepare' || target === 'imports:check' || target === 'imports:organize' ||
    target === 'imports:freeze' || target === 'imports:staged'
  ) {
    const {
      runCandidateImportOrganizer,
      runImportOrganizer,
      runImportPreparation,
      runStagedImportOrganizer
    } = await import(devRunnerModuleUrl('import-organizer'));
    if (target === 'imports:prepare') {
      if (args.length !== 0) usage();
      process.exitCode = await runImportPreparation();
      return;
    }
    if (target === 'imports:check' || target === 'imports:organize') {
      process.exitCode = await runImportOrganizer({ check: target === 'imports:check' });
      return;
    }
    if (target === 'imports:freeze') {
      if (args.length !== 0) usage();
      process.exitCode = await runCandidateImportOrganizer();
      return;
    }
    if (args.length !== 0 && (
      args.length !== 2 || args[0] !== '--candidate-base' || !/^[0-9a-f]{40,64}$/u.test(args[1] ?? '')
    )) usage();
    process.exitCode = await runStagedImportOrganizer(
      undefined,
      undefined,
      args.length === 0 ? {} : { candidateBase: args[1] }
    );
    return;
  }

  if (target === 'typecheck') {
    const { runTypecheck } = await import(devRunnerModuleUrl('typecheck-runner'));
    process.exitCode = await runTypecheck(args);
    return;
  }

  const {
    runAffectedTests,
    runContractFreeze,
    runFastTests,
    runSlowTests,
    runTests
  } = await import(devRunnerModuleUrl('test-runner'));
  process.exitCode = target === 'contract-freeze'
    ? await runContractFreeze()
    : target === 'test'
      ? await runTests(args)
      : target === 'test:affected'
        ? await runAffectedTests(args)
        : target === 'test:fast'
          ? await runFastTests(args)
          : target === 'test:slow'
            ? await runSlowTests(args)
            : usage();
}

await main();
