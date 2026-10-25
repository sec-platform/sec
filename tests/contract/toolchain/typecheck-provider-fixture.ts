import { expect } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectNoFollowDirectoryChain, materializeRetainedNoFollowProvenDirectoryGeneration, retainNoFollowDirectoryForChildProcess, retainNoFollowSealedDirectoryGeneration, scanNoFollowDirectoryTreeInventory, type RetainedNoFollowChildProcessDirectory, type RetainedNoFollowProvenDirectoryGeneration, type RetainedNoFollowSealedDirectoryGeneration } from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { assertProcessResourceSessionReceipt, openProcessResourceSession } from '../../../src/adapters/runtime-state/physical/runtime/process-resource-session.ts';
import { sealExistingWindowsReadOnlyTreeAuthority } from '../../../src/adapters/runtime-state/physical/runtime/windows-host-filesystem-authority.ts';
import { compileTypecheckSemanticOperation } from '../../../src/adapters/self-hosting/development/runner/typecheck-runner.ts';
import { TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY, issueTypeScriptCheckerProcessExecutionAdmission, requireSelectedTypeScriptNativeChecker, selectInstalledTypeScriptNativeChecker, type InstalledTypeScriptNativeChecker, type TypeScriptCheckerProcessExecutionAdmission } from '../../../src/adapters/toolchain/typescript/checker.ts';
import { sha256 } from '../../../src/contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../src/execution/operation/requirement-binding-context.ts';
import { settleResourcesAsync, type ResourceSettlementFailure } from '../../../src/execution/resource-settlement.ts';

const FIXTURE_PROVIDER_VERSION = '1.0.0';
function testDigest(value: unknown): `sha256:${string}` {
  return sha256(value) as `sha256:${string}`;
}

export async function withCheckerExecutionBoundary<T>(
  workingRoot: string,
  dependencyRoot: string,
  checker: InstalledTypeScriptNativeChecker,
  expectedProcessCount: 0 | 1,
  callback: (boundary: Readonly<{
    auxiliaryDirectory: RetainedNoFollowChildProcessDirectory;
    buildInfoFileName: 'tsconfig.tsbuildinfo';
    dependencyDirectory: RetainedNoFollowProvenDirectoryGeneration;
    processExecutionAdmission: TypeScriptCheckerProcessExecutionAdmission;
    workingDirectory: RetainedNoFollowSealedDirectoryGeneration;
  }>) => Promise<T>,
  diagnosticArguments: readonly string[] = []
): Promise<T> {
  const root = inspectNoFollowDirectoryChain(workingRoot, 'test immutable checker root').target;
  const inventory = scanNoFollowDirectoryTreeInventory(root, {
    deadlineAtMs: performance.now() + 30_000,
    maximumBytes: 16 * 1024 * 1024,
    maximumEntries: 256
  });
  const cleanup: Array<Parameters<typeof settleResourcesAsync>[0]['cleanup'][number]> = [];
  let primary: ResourceSettlementFailure | undefined;
  try {
    const authority = await sealExistingWindowsReadOnlyTreeAuthority(
      root.path,
      inventory.filter(({ kind }) => kind !== 'link').map(({ relativePath }) => (
        path.join(root.path, ...relativePath.split('/'))
      )),
      {
        deadlineAtMs: Date.now() + 30_000,
        ownerRootPath: path.dirname(root.path),
        repositoryRootPath: process.cwd()
      }
    );
    cleanup.push({ label: 'checker working-directory ACL authority', settle: () => authority.release() });
    const workingDirectory = await retainNoFollowSealedDirectoryGeneration(root, inventory, authority);
    cleanup[cleanup.length - 1] = { label: 'checker working directory', settle: () => workingDirectory.retire() };
    const dependencyIdentity = inspectNoFollowDirectoryChain(
      dependencyRoot,
      'test checker dependency root'
    ).target;
    const dependencyInventory = scanNoFollowDirectoryTreeInventory(dependencyIdentity, {
      deadlineAtMs: performance.now() + 30_000,
      maximumBytes: 256 * 1024 * 1024,
      maximumEntries: 20_000
    });
    const dependencyTreeDigest = testDigest(dependencyInventory);
    const dependencyDirectory = (await materializeRetainedNoFollowProvenDirectoryGeneration({
      binding: {
        generationDigest: testDigest({ dependencyRoot, dependencyTreeDigest }),
        treeDigest: dependencyTreeDigest,
        treeEntryCount: dependencyInventory.length
      },
      deadlineAtUnixMs: Date.now() + 30_000,
      inventory: dependencyInventory,
      proofText: null,
      releaseMode: 'restore-owner-write',
      root: dependencyIdentity
    })).generation;
    cleanup.push({ label: 'checker dependency directory', settle: async () => { await dependencyDirectory.retire(); } });
    const auxiliaryRoot = path.join(path.dirname(workingRoot), 'action-private-auxiliary');
    await fs.mkdir(auxiliaryRoot);
    const auxiliaryDirectory = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(auxiliaryRoot, 'test checker action-private auxiliary root'),
      4,
      'test checker action-private auxiliary root'
    );
    cleanup.push({ label: 'checker auxiliary directory', settle: () => auxiliaryDirectory.dispose() });
    const operation = compileTypecheckSemanticOperation({
      checker,
      deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs,
      diagnosticArguments,
      projectConfigPath: checker.provider.projectConfig
    });
    const processSession = openProcessResourceSession({
      operation,
      requirementBindingContext: issueOperationRequirementBindingContext({
        operation,
        requirementId: 'typescript.project-check',
        resourceCeilings: [
          {
            resource: 'duration-ms',
            maximum: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs
          },
          { resource: 'input-bytes', maximum: 0 },
          {
            resource: 'output-bytes',
            maximum: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStdoutBytes
              + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStderrBytes
          },
          { resource: 'processes', maximum: 1 }
        ]
      })
    });
    cleanup.push({
      label: 'checker process session',
      settle: () => {
        const receipt = processSession.close();
        assertProcessResourceSessionReceipt(receipt, {
          operationIdentityDigest: operation.plan.identity.identityDigest,
          boundAttemptDigest: operation.boundAttemptDigest,
          requirementId: 'typescript.project-check'
        });
        expect(receipt).toMatchObject({
          failedProcessCount: 0,
          processCount: expectedProcessCount,
          settledProcessCount: expectedProcessCount,
          successfulProcessRecordCount: expectedProcessCount
        });
      }
    });
    const processExecutionAdmission = issueTypeScriptCheckerProcessExecutionAdmission({
      checker,
      operation,
      processSession
    });
    return await callback(Object.freeze({
      auxiliaryDirectory,
      buildInfoFileName: 'tsconfig.tsbuildinfo',
      dependencyDirectory,
      processExecutionAdmission,
      workingDirectory
    }));
  } catch (error) {
    primary = { label: 'checker boundary', error };
    throw error;
  } finally {
    await settleResourcesAsync({
      ...(primary === undefined ? {} : { primary }),
      cleanup: [...cleanup].reverse()
    });
  }
}

export function currentNativePackageName(): `@typescript/typescript-${string}` {
  const suffix = `${process.platform}-${process.arch}`;
  if (!/^[a-z0-9]+-[a-z0-9]+$/u.test(suffix)) {
    throw new Error(`Test host has no admitted native TypeScript package: ${suffix}`);
  }
  return `@typescript/typescript-${suffix}`;
}

export async function writeNativeCheckerFixture(
  root: string,
  input: Readonly<{
    version?: string;
    nativeVersion?: string;
    wrapperBytes?: string;
    executableBytes?: string;
  }> = {}
): Promise<string> {
  const version = input.version ?? FIXTURE_PROVIDER_VERSION;
  const nativeVersion = input.nativeVersion ?? version;
  const nativePackageName = currentNativePackageName();
  const nodeModulesPath = path.join(root, 'node_modules');
  const aliasRoot = path.join(nodeModulesPath, '@typescript', 'native');
  const nativeRoot = path.join(nodeModulesPath, ...nativePackageName.split('/'));
  const executable = process.platform === 'win32' ? 'tsc.exe' : 'tsc';
  await fs.mkdir(path.join(aliasRoot, 'bin'), { recursive: true });
  await fs.mkdir(path.join(nativeRoot, 'lib'), { recursive: true });
  await fs.writeFile(path.join(aliasRoot, 'package.json'), JSON.stringify({
    name: 'typescript',
    version,
    bin: { tsc: './bin/tsc' },
    optionalDependencies: { [nativePackageName]: version }
  }));
  await fs.writeFile(path.join(aliasRoot, 'bin', 'tsc'), input.wrapperBytes ?? 'native-wrapper');
  await fs.writeFile(path.join(nativeRoot, 'package.json'), JSON.stringify({
    name: nativePackageName,
    version: nativeVersion
  }));
  await fs.writeFile(path.join(nativeRoot, 'lib', executable), input.executableBytes ?? 'native-executable');
  return nodeModulesPath;
}

export async function copyInstalledNativeCheckerFixture(root: string): Promise<string> {
  const sourceNodeModulesPath = path.join(process.cwd(), 'node_modules');
  const targetNodeModulesPath = path.join(root, 'node_modules');
  const nativePackageName = currentNativePackageName();
  const relativeFiles = [
    path.join('@typescript', 'native', 'package.json'),
    path.join('@typescript', 'native', 'bin', 'tsc'),
    path.join(...nativePackageName.split('/'), 'package.json')
  ];
  for (const relativeFile of relativeFiles) {
    const target = path.join(targetNodeModulesPath, relativeFile);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(sourceNodeModulesPath, relativeFile), target);
  }
  const nativeLibraryRelativePath = path.join(...nativePackageName.split('/'), 'lib');
  await fs.cp(
    path.join(sourceNodeModulesPath, nativeLibraryRelativePath),
    path.join(targetNodeModulesPath, nativeLibraryRelativePath),
    { recursive: true }
  );
  return targetNodeModulesPath;
}

export async function selectNativeChecker(nodeModulesPath: string) {
  return requireSelectedTypeScriptNativeChecker(
    await selectInstalledTypeScriptNativeChecker(nodeModulesPath)
  );
}
