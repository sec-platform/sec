import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { CI_ARTIFACT_FILES } from '../shared/ci-artifact-contract.ts';
import { defaultLimit } from '../shared/concurrency.ts';
import { DEFAULT_ACCEPTANCE, PASS_STATUS_PENDING, SUPPORTED_STACK } from '../shared/constants.ts';
import { pathExists, removeDir, writeJson } from '../shared/fs.ts';
import {
  getWorkspacePaths,
  officialRegistryRelativePath,
  posixPath
} from '../shared/paths.ts';
import type { PlanFile } from '../shared/plan-manifest-types.ts';
import { ensureProjectBase } from '../shared/project-base.ts';
import {
  assertWorkspaceWriteLease,
  withWorkspaceWriteLease,
  WorkspaceWriteLeaseError,
  type WorkspaceWriteLeaseToken
} from '../shared/workspace-write-lease.ts';
import { writeYaml } from '../shared/yaml.ts';

async function resetLocalStatePreservingWriterLease(
  localStateRoot: string,
  commitFence: () => Promise<void>
): Promise<void> {
  if (!(await pathExists(localStateRoot))) return;
  const entries = await readdir(localStateRoot);
  await Promise.all(entries
    .filter((entry) => entry !== 'workspace-write-lease')
    .map((entry) => defaultLimit(async () => {
      await removeDir(path.join(localStateRoot, entry), commitFence);
    })));
}

function nativeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code.toUpperCase() : undefined;
}

async function bootstrapWorkspaceRoot(workspaceRoot: string): Promise<void> {
  try {
    // The parent must already exist. initWorkspace creates one requested root,
    // never an implicit ancestor chain.
    await mkdir(path.resolve(workspaceRoot));
  } catch (error) {
    const code = nativeErrorCode(error);
    if (code === 'EEXIST') return;
    const reason = code === 'ENOENT'
      ? 'missing-parent'
      : code === 'ENOTDIR'
        ? 'not-directory'
        : code === 'EACCES' || code === 'EPERM'
          ? 'inaccessible'
          : 'unknown';
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace root could not be initialized',
      { operation: 'initialize', phase: 'workspace-root-bootstrap', reason }
    );
  }
}

function defaultPlan(): PlanFile {
  return {
    app: {
      id: 'customer-admin',
      name: 'customer-admin',
      stack: SUPPORTED_STACK,
      packageManager: 'pnpm',
      mode: 'single-tenant'
    },
    registry: {
      sources: [
        {
          id: 'official',
          kind: 'official',
          location: 'compiler',
          path: posixPath(officialRegistryRelativePath)
        },
        {
          id: 'source-private',
          kind: 'private',
          location: 'workspace',
          path: 'source/blocks/private'
        },
        {
          id: 'private',
          kind: 'private',
          location: 'workspace',
          path: 'platform/registry/private'
        }
      ]
    },
    blocks: [
      { id: 'auth/basic-session', version: '0.1.0' },
      { id: 'tenant/basic-workspace', version: '0.1.0' },
      { id: 'entity/customer-basic', version: '0.1.0' }
    ],
    slots: [
      {
        id: 'customer_normalizer',
        block: 'entity/customer-basic',
        kind: 'adapter',
        target: 'custom/customer_normalizer.ts',
        sourcePath: 'source/code/slots/customer_normalizer.ts',
        symbol: 'normalizeCustomerInput',
        description: 'Name required; email lowercased; phone digits only; company defaults to Unknown.'
      }
    ],
    acceptance: [...DEFAULT_ACCEPTANCE]
  };
}

export async function initWorkspace(
  workspaceRoot = process.cwd(),
  options: { reset?: boolean } = {},
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<{ planPath: string; lockPath: string }> {
  // A supplied token must be validated before any side effect. Only an
  // independent initializer is allowed to create the one requested root.
  if (workspaceWriteLease === undefined) await bootstrapWorkspaceRoot(workspaceRoot);
  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async (token) => {
    const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, token);
    const { projectRoot, developerSourceRoot, controlRoot, localStateRoot, planPath, lockPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
    if (options.reset) {
      await commitFence();
      await Promise.all([projectRoot, developerSourceRoot, controlRoot].map(async (targetRoot) => defaultLimit(async () => {
        if (await pathExists(targetRoot)) {
          await removeDir(targetRoot, commitFence);
        }
      })));
      await commitFence();
      await resetLocalStatePreservingWriterLease(localStateRoot, commitFence);
    }

    await ensureProjectBase(workspaceRoot, commitFence);
    await writeYaml(planPath, defaultPlan(), commitFence);
    await writeJson(lockPath, {
      formatVersion: '1',
      app: {
        id: 'customer-admin',
        name: 'customer-admin',
        stack: SUPPORTED_STACK,
        mode: 'single-tenant'
      },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [],
      slotTasks: [],
      generatedPaths: [
        'generated/routes.ts',
        CI_ARTIFACT_FILES.blockUsageMap,
        CI_ARTIFACT_FILES.installManifest,
        CI_ARTIFACT_FILES.verificationReport
      ],
      acceptancePlan: DEFAULT_ACCEPTANCE.map((entry) => entry.id),
      passStatus: { ...PASS_STATUS_PENDING }
    }, commitFence);
    await writeJson(verificationReportPath, {
      summary: { status: 'pending' }
    }, commitFence);

    return { planPath, lockPath };
  });
}
