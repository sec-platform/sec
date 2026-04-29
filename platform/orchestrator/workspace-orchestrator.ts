import { CI_ARTIFACT_FILES } from '../shared/ci-artifact-contract.ts';
import { PASS_STATUS_PENDING, SUPPORTED_STACK, DEFAULT_ACCEPTANCE } from '../shared/constants.ts';
import { pathExists, removeDir, writeJson } from '../shared/fs.ts';
import { getWorkspacePaths } from '../shared/paths.ts';
import { ensureProjectBase } from '../shared/project-base.ts';
import { writeYaml } from '../shared/yaml.ts';
import type { PlanFile } from '../shared/plan-manifest-types.ts';

function defaultPlan(): PlanFile {
  return {
    app: {
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
          path: 'platform/registry/official'
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
  options: { reset?: boolean } = {}
): Promise<{ planPath: string; lockPath: string }> {
  const { projectRoot, developerSourceRoot, controlRoot, localStateRoot, planPath, lockPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
  if (options.reset) {
    await Promise.all([projectRoot, developerSourceRoot, controlRoot, localStateRoot].map(async (targetRoot) => {
      if (await pathExists(targetRoot)) {
        await removeDir(targetRoot);
      }
    }));
  }

  await ensureProjectBase(workspaceRoot);
  await writeYaml(planPath, defaultPlan());
  await writeJson(lockPath, {
    formatVersion: '1',
    app: {
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
  });
  await writeJson(verificationReportPath, {
    summary: { status: 'pending' }
  });

  return { planPath, lockPath };
}
