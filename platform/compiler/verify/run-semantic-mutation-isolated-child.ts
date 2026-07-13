import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AcceptanceCoverageReport } from '../../shared/acceptance-types.ts';
import { listFilesRecursive, pathExists, type CommitFence } from '../../shared/fs.ts';
import { readLockFile } from '../../shared/lock-utils.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import {
  compilerRoot,
  getWorkspacePaths,
  officialRegistryRelativePath,
  posixPath,
  resolveWorkspaceLockPath,
  resolveWorkspacePlanPath
} from '../../shared/paths.ts';
import {
  buildIsolatedProcessEnvironment,
  ensureIsolatedProcessDirectories,
  ISOLATED_VERIFICATION_ENV_KEY,
  runCommand,
  type CommandResult
} from '../../shared/process.ts';
import type {
  SemanticMutationVerificationCapabilityPlanV1,
  VerificationReport
} from '../../shared/verification-types.ts';
import { isCanonicalVerificationArtifactSet } from '../../shared/verification-artifact-contract.ts';
import type { WorkspaceWriteLeaseToken } from '../../shared/workspace-write-lease.ts';
import { runWindowsAppContainerChild } from '../../shared/windows-appcontainer-executor.ts';
import {
  buildWorkspaceSemanticBundle,
  type WorkspaceSemanticBundle
} from '../semantic-frontend.ts';
import { loadWorkspacePlan } from '../parse/load-plan.ts';
import { assertIsolatedStagingTree } from './assert-isolated-staging-tree.ts';
import { isolatedPlaywrightBrowsersPath } from './run-runtime-verification.ts';
import { isSemanticMutationStagingWorkspace } from './semantic-mutation-staging-boundary.ts';
import {
  assertSemanticMutationIsolatedRuntimeLaunchManifest,
  issueSemanticMutationIsolatedRuntimeCapability,
  materializeSemanticMutationIsolatedRuntime,
  SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH,
  SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT,
  type SemanticMutationIsolatedCompilerRegistryInput,
  type SemanticMutationIsolatedRuntimeInputSources
} from './semantic-mutation-isolated-runtime-plan.ts';

export type { SemanticMutationIsolatedRuntimeInputSources } from './semantic-mutation-isolated-runtime-plan.ts';

const ISOLATED_RUNNER_PATH = fileURLToPath(
  new URL('../../orchestrator/semantic-mutation-isolated-verification-runner.ts', import.meta.url)
);

function defaultRuntimeInputSources(): SemanticMutationIsolatedRuntimeInputSources {
  return {
    browserCache: isolatedPlaywrightBrowsersPath(),
    compilerModulesRoot: path.join(compilerRoot, '.shared-deps', 'node_modules'),
    compilerPackage: path.join(compilerRoot, 'package.json'),
    composeTemplates: path.join(compilerRoot, 'platform', 'compiler', 'compose', 'templates'),
    dependencyModules: path.join(compilerRoot, '.shared-deps', 'node_modules'),
    officialPolicies: path.join(compilerRoot, 'platform', 'policies', 'official'),
    officialRegistry: path.join(compilerRoot, 'platform', 'registry', 'official')
  };
}

function canonicalCompilerRegistryPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\\')) {
    throw new Error('Compiler registry path is invalid');
  }
  const canonical = path.posix.normalize(value);
  if (canonical !== value || canonical === '.' || canonical === '..' ||
    canonical.startsWith('../') || path.posix.isAbsolute(canonical)) {
    throw new Error('Compiler registry path is not canonical');
  }
  return canonical;
}

async function compilerRegistryInputs(
  stagingWorkspaceRoot: string,
  sources: SemanticMutationIsolatedRuntimeInputSources
): Promise<SemanticMutationIsolatedCompilerRegistryInput[]> {
  const officialPath = posixPath(officialRegistryRelativePath);
  const registryPaths = new Set<string>([officialPath]);
  const planPath = await resolveWorkspacePlanPath(stagingWorkspaceRoot);
  if (await pathExists(planPath)) {
    const plan = await loadWorkspacePlan(stagingWorkspaceRoot);
    if (!Array.isArray(plan.registry.sources)) throw new Error('Staging plan registry sources are invalid');
    for (const registry of plan.registry.sources) {
      if (registry.location === 'compiler') registryPaths.add(canonicalCompilerRegistryPath(registry.path));
    }
  }
  const lockPath = await resolveWorkspaceLockPath(stagingWorkspaceRoot);
  if (await pathExists(lockPath)) {
    const lock = await readLockFile(stagingWorkspaceRoot);
    if (!Array.isArray(lock.resolvedBlocks) || !Array.isArray(lock.installPlan)) {
      throw new Error('Staging lock registry bindings are invalid');
    }
    for (const registry of [...lock.resolvedBlocks, ...lock.installPlan]) {
      if (registry.registryLocation === 'compiler') {
        registryPaths.add(canonicalCompilerRegistryPath(registry.registryPath));
      }
    }
  }
  const sortedPaths = [...registryPaths].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0);
  if (sortedPaths.length !== 1 || sortedPaths[0] !== officialPath) {
    throw new Error('Custom compiler registry closure is unavailable in isolated verification');
  }
  return [{
    destinationRelativePath:
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/${officialPath}`,
    sourceRoot: sources.officialRegistry
  }];
}

function rawByteDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  return actual.length === canonicalExpected.length &&
    actual.every((key, index) => key === canonicalExpected[index]);
}

function exactSemanticBundle(value: unknown): value is WorkspaceSemanticBundle {
  if (!exactKeys(value, ['snapshot', 'generatorPlan', 'semanticViews', 'semanticContractSources']) ||
    !exactKeys(value.snapshot, ['ir']) || !exactKeys(value.generatorPlan, [
      'inputRevision', 'semanticRevision', 'tasks'
    ]) || !exactKeys(value.semanticViews, [
      'formatVersion', 'inputRevision', 'semanticRevision', 'views'
    ]) || !Array.isArray(value.semanticContractSources)) {
    return false;
  }
  const bundle = value as unknown as WorkspaceSemanticBundle;
  return typeof bundle.snapshot.ir.inputRevision === 'string' &&
    typeof bundle.snapshot.ir.semanticRevision === 'string' &&
    bundle.generatorPlan.inputRevision === bundle.snapshot.ir.inputRevision &&
    bundle.generatorPlan.semanticRevision === bundle.snapshot.ir.semanticRevision &&
    bundle.semanticViews.inputRevision === bundle.snapshot.ir.inputRevision &&
    bundle.semanticViews.semanticRevision === bundle.snapshot.ir.semanticRevision &&
    Array.isArray(bundle.generatorPlan.tasks) && Array.isArray(bundle.semanticViews.views) &&
    bundle.semanticContractSources.every((source) => exactKeys(source, [
      'sourceKind', 'loadedContract', 'sourceRevision'
    ]) && (source.sourceKind === 'workspace-authoring' ||
      source.sourceKind === 'workspace-registry' || source.sourceKind === 'compiler-registry') &&
      typeof source.sourceRevision === 'string' && source.loadedContract !== null &&
      typeof source.loadedContract === 'object' && !Array.isArray(source.loadedContract));
}

export interface SemanticMutationIsolatedVerificationArtifactSet {
  readonly childExitCode: number;
  readonly verificationReport: unknown;
  readonly runtimeReport: unknown;
  readonly policyReport: unknown;
  readonly acceptanceCoverage: unknown;
  readonly semanticBundle: unknown;
}

export function classifySemanticMutationIsolatedVerificationArtifactSet(
  input: SemanticMutationIsolatedVerificationArtifactSet
): 'passed' | 'failed' | 'blocked' {
  if (!Number.isSafeInteger(input.childExitCode) || input.childExitCode < 0 ||
    !isCanonicalVerificationArtifactSet(input) ||
    !exactSemanticBundle(input.semanticBundle)) {
    return 'blocked';
  }
  const report = input.verificationReport;
  if (report.summary.status === 'failed') {
    return input.childExitCode === 0 ? 'blocked' : 'failed';
  }
  return input.childExitCode === 0 && report.fast.status === 'passed' &&
    report.runtime.status === 'passed' ? 'passed' : 'blocked';
}

export interface SemanticMutationIsolatedVerificationExecutionRequest {
  readonly commitFence: CommitFence;
  readonly env: NodeJS.ProcessEnv;
  readonly runnerRelativePath: string;
  readonly stagingWorkspaceRoot: string;
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
}

export type SemanticMutationIsolatedVerificationSupervisor = (
  request: SemanticMutationIsolatedVerificationExecutionRequest
) => Promise<CommandResult>;

export type SemanticMutationIsolatedRunnerBundleBuilder = () => Promise<Uint8Array>;

interface SemanticMutationIsolatedVerificationChildCommonOptions {
  readonly commitFence: CommitFence;
  readonly supervisor?: SemanticMutationIsolatedVerificationSupervisor;
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
}

export type SemanticMutationIsolatedVerificationChildOptions =
  SemanticMutationIsolatedVerificationChildCommonOptions & (
    | {
        readonly capabilityPlan: SemanticMutationVerificationCapabilityPlanV1;
        readonly runtimeCapabilityForTest?: never;
      }
    | {
        readonly capabilityPlan?: never;
        /** Internal test seam: an exact result from the real runtime probe. */
        readonly runtimeCapabilityForTest: object;
      }
  );

export function buildSemanticMutationIsolatedVerificationEnvironment(
  stagingWorkspaceRoot: string
): Readonly<Record<string, string>> {
  const writableRoot = path.join(stagingWorkspaceRoot, '.isolated-process', 'child');
  return Object.freeze(Object.fromEntries(Object.entries(buildIsolatedProcessEnvironment(writableRoot, {
    [ISOLATED_VERIFICATION_ENV_KEY]: '1',
    CI: 'true',
    PLAYWRIGHT_BROWSERS_PATH: isolatedPlaywrightBrowsersPath(stagingWorkspaceRoot),
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'
  })).filter((entry): entry is [string, string] => typeof entry[1] === 'string')));
}

export function createSemanticMutationIsolatedVerificationSupervisor(options: {
  /** Internal test seam. */
  readonly appContainerRunner?: typeof runWindowsAppContainerChild;
  /** Internal test seam. Production always uses Windows AppContainer. */
  readonly commandRunner?: typeof runCommand;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
} = {}): SemanticMutationIsolatedVerificationSupervisor {
  if (options.commandRunner === undefined) {
    return async (request) => {
      const execution = await (options.appContainerRunner ?? runWindowsAppContainerChild)({
        stagingRoot: request.stagingWorkspaceRoot,
        runnerRelativePath: request.runnerRelativePath,
        environment: Object.freeze(Object.fromEntries(Object.entries(request.env)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string'))),
        workspaceRoot: request.workspaceRoot,
        workspaceWriteLease: request.workspaceWriteLease,
        timeoutMs: options.timeoutMs ?? 1_200_000
      });
      return { code: execution.exitCode, stdout: '', stderr: '' };
    };
  }
  const commandRunner = options.commandRunner;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  return async (request) => {
    const controller = new AbortController();
    let checkingLease = false;
    let leaseFailure: unknown;
    const checkLease = (): void => {
      if (checkingLease || leaseFailure !== undefined) return;
      checkingLease = true;
      void request.commitFence()
        .catch((error: unknown) => {
          leaseFailure = error;
          controller.abort();
        })
        .finally(() => {
          checkingLease = false;
        });
    };
    const monitor = setInterval(checkLease, pollIntervalMs);
    try {
      await request.commitFence();
      const result = await commandRunner(
        process.execPath,
        [
          '--no-env-file',
          `--config=${path.join(
            request.stagingWorkspaceRoot,
            ...SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH.split('/')
          )}`,
          '--no-install',
          request.runnerRelativePath
        ],
        {
          beforeSpawn: request.commitFence,
          cwd: request.stagingWorkspaceRoot,
          env: request.env,
          envMode: 'replace',
          signal: controller.signal
        }
      );
      await request.commitFence();
      if (leaseFailure !== undefined) throw leaseFailure;
      return result;
    } catch (error) {
      if (leaseFailure !== undefined) throw leaseFailure;
      throw error;
    } finally {
      clearInterval(monitor);
    }
  };
}

async function readJsonArtifact(
  filePath: string,
  commitFence: CommitFence
): Promise<{ bytes: Uint8Array; value: unknown }> {
  await commitFence();
  const bytes = new Uint8Array(await readFile(filePath));
  return { bytes, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
}

async function buildIsolatedRunnerBundle(): Promise<Uint8Array> {
  const result = await Bun.build({
    entrypoints: [ISOLATED_RUNNER_PATH],
    format: 'esm',
    minify: false,
    sourcemap: 'none',
    splitting: false,
    target: 'bun',
    // These packages resolve data files relative to their package directory.
    // Bundling them makes Bun bake host __dirname/__filename values into the
    // output, so they are copied as a small physical module closure instead.
    external: ['ts-morph', 'typescript']
  });
  if (!result.success || result.outputs.length !== 1) {
    throw new Error('Semantic Mutation isolated runner bundle could not be built');
  }
  const bundle = new Uint8Array(await result.outputs[0].arrayBuffer());
  const bundleText = new TextDecoder().decode(bundle);
  const compilerRootVariants = [
    path.resolve(compilerRoot),
    path.resolve(compilerRoot).replaceAll('\\', '/'),
    `file:///${path.resolve(compilerRoot).replaceAll('\\', '/')}`
  ];
  if (/(?:__dirname|__filename)\s*=\s*["'][A-Za-z]:[\\/]/u.test(bundleText) ||
    compilerRootVariants.some((hostPath) => bundleText.includes(hostPath))) {
    throw new Error('Semantic Mutation isolated runner bundle contains a host path');
  }
  return bundle;
}

export interface SemanticMutationIsolatedRuntimeCapabilityProbeOptions {
  readonly browserCacheSource?: string;
  readonly buildRunnerBundle?: SemanticMutationIsolatedRunnerBundleBuilder;
  /** Internal test seam. Product callers cannot supply isolated runtime paths. */
  readonly runtimeInputSources?: SemanticMutationIsolatedRuntimeInputSources;
}

/**
 * Proves that the current staged workspace can execute the bundled compiler
 * without consulting host source, host Git, or a network package registry.
 * The public result is intentionally path-free and is consumed only through
 * process-local opaque capability evidence.
 */
export async function probeSemanticMutationIsolatedRuntimeCapability(
  stagingWorkspaceRoot: string,
  options: SemanticMutationIsolatedRuntimeCapabilityProbeOptions = {}
): Promise<{ readonly status: 'available' | 'unavailable' }> {
  try {
    const defaults = defaultRuntimeInputSources();
    const sources = options.runtimeInputSources ?? defaults;
    const browserCache = options.browserCacheSource ?? sources.browserCache;
    if (!isSemanticMutationStagingWorkspace(stagingWorkspaceRoot)) {
      throw new Error('Isolated verification requires a controlled staging workspace');
    }
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
    if (await pathExists(path.join(stagingWorkspaceRoot, 'source', 'schema', 'db.prisma.template'))) {
      throw new Error('Isolated Prisma execution is unavailable');
    }
    const opaqueModulesRoot = path.join(stagingWorkspaceRoot, 'source', 'code', 'opaque');
    if ((await pathExists(opaqueModulesRoot)) &&
      (await listFilesRecursive(opaqueModulesRoot)).some((file) => path.basename(file) === 'module.yaml')) {
      throw new Error('Isolated opaque module linking is unavailable');
    }
    const bundle = await (options.buildRunnerBundle ?? buildIsolatedRunnerBundle)();
    return await issueSemanticMutationIsolatedRuntimeCapability({
      browserCache,
      compilerRegistries: await compilerRegistryInputs(stagingWorkspaceRoot, sources),
      runnerBundle: bundle,
      sources,
      stagingWorkspaceRoot
    });
  } catch {
    return { status: 'unavailable' };
  }
}

export interface IsolatedVerificationArtifacts {
  readonly status: 'passed' | 'failed';
  readonly acceptanceCoverage: AcceptanceCoverageReport;
  readonly policyReport: PolicyReport;
  readonly rawDigests: {
    readonly acceptanceCoverage: string;
    readonly policyReport: string;
    readonly runtimeReport: string;
    readonly verificationReport: string;
  };
  readonly semanticBundle: Awaited<ReturnType<typeof buildWorkspaceSemanticBundle>>;
  readonly verificationReport: VerificationReport;
}

export async function runSemanticMutationIsolatedVerificationChild(
  stagingWorkspaceRoot: string,
  options: SemanticMutationIsolatedVerificationChildOptions
): Promise<IsolatedVerificationArtifacts> {
  try {
    const commitFence = options.commitFence;
    const supervisor = options.supervisor ?? createSemanticMutationIsolatedVerificationSupervisor();
    await commitFence();
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
    const paths = getWorkspacePaths(stagingWorkspaceRoot);
    for (const reportPath of [
      paths.verificationReportPath,
      paths.runtimeReportPath,
      paths.policyReportPath,
      paths.acceptanceCoveragePath
    ]) {
      await commitFence();
      await rm(reportPath, { force: true });
    }
    const runtimeBinding = options.capabilityPlan ?? options.runtimeCapabilityForTest;
    const { browsersPath, runnerRelativePath } = await materializeSemanticMutationIsolatedRuntime({
      binding: runtimeBinding,
      commitFence,
      stagingWorkspaceRoot
    });
    await commitFence();
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
    const writableRoot = path.join(stagingWorkspaceRoot, '.isolated-process', 'child');
    await ensureIsolatedProcessDirectories(writableRoot, commitFence);
    const env = buildSemanticMutationIsolatedVerificationEnvironment(stagingWorkspaceRoot);
    if (env.PLAYWRIGHT_BROWSERS_PATH !== browsersPath) {
      throw new Error('Isolated browser cache environment binding is invalid');
    }
    await assertSemanticMutationIsolatedRuntimeLaunchManifest({
      binding: runtimeBinding,
      commitFence,
      stagingWorkspaceRoot
    });
    const result = await supervisor({
      commitFence,
      env,
      runnerRelativePath,
      stagingWorkspaceRoot,
      workspaceRoot: options.workspaceRoot,
      workspaceWriteLease: options.workspaceWriteLease
    });

    await commitFence();
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
    const verification = await readJsonArtifact(paths.verificationReportPath, commitFence);
    const runtime = await readJsonArtifact(paths.runtimeReportPath, commitFence);
    const policy = await readJsonArtifact(paths.policyReportPath, commitFence);
    const coverage = await readJsonArtifact(paths.acceptanceCoveragePath, commitFence);
    await commitFence();
    const semanticBundle = await buildWorkspaceSemanticBundle(stagingWorkspaceRoot);
    await commitFence();
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
    await commitFence();
    const status = classifySemanticMutationIsolatedVerificationArtifactSet({
      childExitCode: result.code,
      verificationReport: verification.value,
      runtimeReport: runtime.value,
      policyReport: policy.value,
      acceptanceCoverage: coverage.value,
      semanticBundle
    });
    if (status === 'blocked') throw new Error('Isolated Verification artifact protocol is unavailable');
    return {
      status,
      verificationReport: verification.value as VerificationReport,
      policyReport: policy.value as PolicyReport,
      acceptanceCoverage: coverage.value as AcceptanceCoverageReport,
      semanticBundle,
      rawDigests: {
        verificationReport: rawByteDigest(verification.bytes),
        runtimeReport: rawByteDigest(runtime.bytes),
        policyReport: rawByteDigest(policy.bytes),
        acceptanceCoverage: rawByteDigest(coverage.bytes)
      }
    };
  } catch {
    throw new Error('Semantic Mutation isolated verification is unavailable');
  }
}
