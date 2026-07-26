import {
  lstat,
  rename,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import { runRuntimeVerification } from '../../platform/compiler/verify/run-runtime-verification.ts';
import { semanticMutationIsolatedBrowserPath } from '../../platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts';
import { registerWindowsBrowserLaunchProofFromArguments } from '../../platform/compiler/verify/windows-browser-launch-path.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';

const stagingWorkspaceRoot = path.dirname(compilerRoot);
const workspaceRoot = path.resolve(stagingWorkspaceRoot, '..', '..', '..', '..', '..', '..');
const projectRoot = path.join(stagingWorkspaceRoot, 'project');
const browserRoot = semanticMutationIsolatedBrowserPath(stagingWorkspaceRoot);
const displacedBrowserRoot = path.join(workspaceRoot, 'displaced-staged-browser');
const outsideBrowserRoot = path.join(workspaceRoot, 'outside-browser');
const observationPath = path.join(workspaceRoot, 'runtime-target-swap-observation.json');
const spawnMarkerPath = path.join(workspaceRoot, 'playwright-spawned.marker');

registerWindowsBrowserLaunchProofFromArguments(process.argv);

let nextPreSpawnPassed = false;
let targetSwapped = false;
let browserRootDisplaced = false;
let browserRootAliased = false;
let playwrightInvocation: { command: string; args: string[] } | undefined;
let playwrightPreSpawnRejected = false;
let playwrightSpawned = false;
let failureMessage: string | undefined;

try {
  await runRuntimeVerification(projectRoot, 'full', {
    acceptanceServerForTests: async (request, execute) => {
      await request.beforeSpawn?.();
      nextPreSpawnPassed = true;
      await rename(browserRoot, displacedBrowserRoot);
      browserRootDisplaced = true;
      await symlink(
        outsideBrowserRoot,
        browserRoot,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      browserRootAliased = true;
      targetSwapped = true;
      try {
        return await execute();
      } finally {
        await unlink(browserRoot);
        browserRootAliased = false;
        await rename(displacedBrowserRoot, browserRoot);
        browserRootDisplaced = false;
      }
    },
    commandRunnerForTests: async (command, args, options) => {
      const isPlaywright = args.some((argument) =>
        argument.replaceAll('\\', '/').endsWith('@playwright/test/cli.js'));
      if (!isPlaywright) {
        await options.beforeSpawn?.();
        return { code: 0, stdout: '', stderr: '' };
      }
      playwrightInvocation = { command, args: [...args] };
      try {
        await options.beforeSpawn?.();
      } catch (error) {
        playwrightPreSpawnRejected = true;
        throw error;
      }
      await writeFile(spawnMarkerPath, 'spawned', 'utf8');
      playwrightSpawned = true;
      return { code: 0, stdout: '', stderr: '' };
    },
    emitTiming: false,
    isolated: true,
    sourceEnvironmentForTests: process.env,
    stagingWorkspaceRoot
  });
} catch (error) {
  failureMessage = error instanceof Error ? error.message : String(error);
} finally {
  if (browserRootAliased) {
    await unlink(browserRoot);
    browserRootAliased = false;
  }
  if (browserRootDisplaced) {
    await rename(displacedBrowserRoot, browserRoot);
    browserRootDisplaced = false;
  }
  await writeFile(observationPath, JSON.stringify({
    mode: 'full',
    nextPreSpawnPassed,
    targetSwapped,
    playwrightInvocation,
    playwrightPreSpawnRejected,
    playwrightSpawned,
    failureMessage,
    browserRootRestored: (await lstat(browserRoot)).isDirectory()
  }), 'utf8');
}

if (failureMessage !== 'Staged browser cache must be a physical directory') {
  throw new Error(`Unexpected staged Playwright target-swap result: ${failureMessage ?? 'passed'}`);
}
