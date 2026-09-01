import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { generatedStateProducerHooks } from '../../../runtime-state/generated-state/lifecycle.ts';
import { issueRuntimeDependencyTestMaterialization } from '../runtime/materialization-fixture-capability.ts';
import type {
  CompilerDependencyExecutionGenerationAuthority,
  CompilerDepsReadyState
} from '../runtime/project-runtime.ts';
import {
  compilerDependencyLocatorWorktreeRetirementProvider,
  disposeCompilerDependencyEnvironment,
  ensureCompilerDepsReady
} from '../runtime/project-runtime.ts';

export interface CompilerDependencyFixturePackage {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly main?: string;
  readonly name: string;
  readonly packagePath?: string;
  readonly version: string;
}

export interface CompilerDependencyFixtureDescriptor {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly dependencyRootPath: string;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly lockfileBytes: string;
  readonly packages: readonly CompilerDependencyFixturePackage[];
}

export interface CompilerDependencyFixtureOperation {
  readonly kind: 'compiler-dependency-fixture-operation';
}

export interface CompilerDependencyFixtureReadyState {
  readonly executionGenerationAuthority: CompilerDependencyExecutionGenerationAuthority;
  readonly nodeModulesPath: string;
}

interface IssuedCompilerDependencyFixtureOperation {
  readonly descriptor: CompilerDependencyFixtureDescriptor;
  readonly lifecycle: NonNullable<
    NonNullable<Parameters<typeof ensureCompilerDepsReady>[0]>['generatedStateLifecycle']
  >;
  readonly runtimeRoot: Readonly<{ dev: bigint; ino: bigint; path: string }>;
  lockRevision: number;
  ready: CompilerDepsReadyState | null;
  retired: boolean;
}

const issuedCompilerDependencyFixtureOperations = new WeakMap<
  CompilerDependencyFixtureOperation,
  IssuedCompilerDependencyFixtureOperation
>();

function assertCanonicalPackageName(name: string): void {
  const segments = name.split('/');
  const scoped = name.startsWith('@');
  if (name.length === 0 || segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
      (scoped ? segments.length !== 2 : segments.length !== 1)) {
    throw new Error(`Compiler dependency fixture package name is noncanonical: ${name}`);
  }
}

function assertCanonicalPackageMain(main: string | undefined): void {
  if (main === undefined) return;
  const normalized = main.replace(/^\.\//u, '');
  if (path.isAbsolute(normalized) || normalized.length === 0 || normalized.split(/[\\/]/u)
    .some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Compiler dependency fixture package entry is noncanonical: ${main}`);
  }
}

function normalizeDescriptor(
  input: CompilerDependencyFixtureDescriptor
): CompilerDependencyFixtureDescriptor {
  const dependencyRootPath = path.resolve(input.dependencyRootPath);
  if (input.lockfileBytes.length === 0) {
    throw new Error('Compiler dependency fixture lockfile must not be empty.');
  }
  const packagePaths = new Set<string>();
  const packages = input.packages.map((manifest) => {
    assertCanonicalPackageName(manifest.name);
    const packagePath = manifest.packagePath ?? manifest.name;
    assertCanonicalPackageName(packagePath);
    assertCanonicalPackageMain(manifest.main);
    if (manifest.version.length === 0 || packagePaths.has(packagePath)) {
      throw new Error(`Compiler dependency fixture package is duplicate or versionless: ${packagePath}`);
    }
    packagePaths.add(packagePath);
    const dependencies = Object.freeze({ ...(manifest.dependencies ?? {}) });
    for (const [name, version] of Object.entries(dependencies)) {
      assertCanonicalPackageName(name);
      if (version.length === 0) {
        throw new Error(`Compiler dependency fixture package dependency is versionless: ${name}`);
      }
    }
    return Object.freeze({
      ...(Object.keys(dependencies).length === 0 ? {} : { dependencies }),
      ...(manifest.main === undefined ? {} : { main: manifest.main }),
      name: manifest.name,
      ...(manifest.packagePath === undefined ? {} : { packagePath }),
      version: manifest.version
    });
  });
  for (const [name, version] of [
    ...Object.entries(input.dependencies),
    ...Object.entries(input.devDependencies)
  ]) {
    assertCanonicalPackageName(name);
    if (version.length === 0 || !packagePaths.has(name)) {
      throw new Error(`Compiler dependency fixture manifest has no exact package materialization: ${name}`);
    }
  }
  return Object.freeze({
    dependencies: Object.freeze({ ...input.dependencies }),
    dependencyRootPath,
    devDependencies: Object.freeze({ ...input.devDependencies }),
    lockfileBytes: input.lockfileBytes,
    packages: Object.freeze(packages)
  });
}

function operationState(
  operation: CompilerDependencyFixtureOperation
): IssuedCompilerDependencyFixtureOperation {
  const state = issuedCompilerDependencyFixtureOperations.get(operation);
  if (state === undefined) {
    throw new Error('Compiler dependency fixture operation was not issued by the dependency test owner.');
  }
  if (state.retired) {
    throw new Error('Compiler dependency fixture operation is retired.');
  }
  return state;
}

async function writeFixtureInputs(
  descriptor: CompilerDependencyFixtureDescriptor,
  lockfileBytes: string
): Promise<void> {
  await mkdir(descriptor.dependencyRootPath, { recursive: true });
  await Promise.all([
    writeFile(path.join(descriptor.dependencyRootPath, 'package.json'), `${JSON.stringify({
      packageManager: `bun@${process.versions.bun}`,
      dependencies: descriptor.dependencies,
      devDependencies: descriptor.devDependencies
    })}\n`),
    writeFile(path.join(descriptor.dependencyRootPath, 'bun.lock'), lockfileBytes),
    writeFile(path.join(descriptor.dependencyRootPath, '.bun-version'), `${process.versions.bun}\n`)
  ]);
}

async function materializePackages(
  workingDirectory: string,
  packages: readonly CompilerDependencyFixturePackage[]
): Promise<void> {
  for (const manifest of packages) {
    const packageRoot = path.join(
      workingDirectory,
      'node_modules',
      ...(manifest.packagePath ?? manifest.name).split('/')
    );
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify({
      ...(manifest.dependencies === undefined ? {} : { dependencies: manifest.dependencies }),
      ...(manifest.main === undefined ? {} : { main: manifest.main }),
      name: manifest.name,
      version: manifest.version
    })}\n`);
    if (manifest.main === undefined) continue;
    const entryPath = path.join(packageRoot, ...manifest.main.replace(/^\.\//u, '').split('/'));
    await mkdir(path.dirname(entryPath), { recursive: true });
    await writeFile(entryPath, `fixture:${manifest.name}\n`);
  }
}

function readyProjection(ready: CompilerDepsReadyState): CompilerDependencyFixtureReadyState {
  return Object.freeze({
    executionGenerationAuthority: ready.executionGenerationAuthority,
    nodeModulesPath: ready.nodeModulesPath
  });
}

async function ensureFixture(
  state: IssuedCompilerDependencyFixtureOperation,
  rematerialize: boolean
): Promise<CompilerDependencyFixtureReadyState> {
  const ready = await ensureCompilerDepsReady({
    testMaterialization: issueRuntimeDependencyTestMaterialization(async (request) => {
      await materializePackages(request.cwd, state.descriptor.packages);
      return { code: 0, stdout: 'ok', stderr: '' };
    }),
    generatedStateLifecycle: state.lifecycle,
    rematerialize
  }, state.descriptor.dependencyRootPath);
  state.ready = ready;
  return readyProjection(ready);
}

export async function issueCompilerDependencyFixtureOperation(
  input: CompilerDependencyFixtureDescriptor
): Promise<CompilerDependencyFixtureOperation> {
  const descriptor = normalizeDescriptor(input);
  await writeFixtureInputs(descriptor, descriptor.lockfileBytes);
  const runtimeRootPath = await mkdtemp(path.join(tmpdir(), 'sec-compiler-dependency-fixture-runtime-'));
  const runtimeRootStat = await lstat(runtimeRootPath, { bigint: true });
  if (!runtimeRootStat.isDirectory() || runtimeRootStat.isSymbolicLink()) {
    throw new Error('Compiler dependency fixture runtime root is not an ordinary directory.');
  }
  const operation = Object.freeze({
    kind: 'compiler-dependency-fixture-operation' as const
  });
  issuedCompilerDependencyFixtureOperations.set(operation, {
    descriptor,
    lifecycle: generatedStateProducerHooks(
      { repositoryRoot: descriptor.dependencyRootPath },
      {
        environment: {
          ...process.env,
          SEC_CACHE_HOME: path.join(runtimeRootPath, 'cache'),
          SEC_STATE_HOME: path.join(runtimeRootPath, 'state')
        },
        worktreeRetirementProviders: [compilerDependencyLocatorWorktreeRetirementProvider]
      }
    ),
    lockRevision: 0,
    ready: null,
    runtimeRoot: Object.freeze({
      dev: runtimeRootStat.dev,
      ino: runtimeRootStat.ino,
      path: runtimeRootPath
    }),
    retired: false
  });
  return operation;
}

export async function settleCompilerDependencyFixtureOperation(
  operation: CompilerDependencyFixtureOperation
): Promise<CompilerDependencyFixtureReadyState> {
  const state = operationState(operation);
  return state.ready === null ? ensureFixture(state, false) : readyProjection(state.ready);
}

export async function rematerializeCompilerDependencyFixtureOperation(
  operation: CompilerDependencyFixtureOperation,
  lockfileBytes: string
): Promise<CompilerDependencyFixtureReadyState> {
  const state = operationState(operation);
  if (lockfileBytes.length === 0) {
    throw new Error('Compiler dependency fixture replacement lockfile must not be empty.');
  }
  await writeFixtureInputs(state.descriptor, lockfileBytes);
  state.lockRevision += 1;
  return ensureFixture(state, true);
}

export async function retireCompilerDependencyFixtureOperation(
  operation: CompilerDependencyFixtureOperation
): Promise<void> {
  const state = operationState(operation);
  const retiredLockfile = `${state.descriptor.lockfileBytes.trimEnd()}\nfixture-retirement:${state.lockRevision + 1}\n`;
  await rematerializeCompilerDependencyFixtureOperation(operation, retiredLockfile);
  const runtimeRootNow = await lstat(state.runtimeRoot.path, { bigint: true });
  if (!runtimeRootNow.isDirectory() || runtimeRootNow.isSymbolicLink() ||
      runtimeRootNow.dev !== state.runtimeRoot.dev || runtimeRootNow.ino !== state.runtimeRoot.ino) {
    throw new Error('Compiler dependency fixture runtime root physical identity changed; residue is preserved.');
  }
  await disposeCompilerDependencyEnvironment(
    state.descriptor.dependencyRootPath,
    { generatedStateLifecycle: state.lifecycle },
    'compiler-dependency-fixture-retired'
  );
  await rm(state.runtimeRoot.path, { recursive: true });
  state.retired = true;
}
