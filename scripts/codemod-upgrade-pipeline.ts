import fs from 'node:fs/promises';

const filePath = 'platform/upgrade/upgrade-workspace.ts';
let source = await fs.readFile(filePath, 'utf8');

if (source.includes("import { compileWorkspace } from '../orchestrator/pipeline-orchestrator.ts';")) {
  console.log('Upgrade pipeline codemod already applied.');
  process.exit(0);
}

function replaceOnce(before: string, after: string, label: string): void {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Missing codemod target: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Codemod target is ambiguous: ${label}`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
`import {
    adaptProject,
    composeProject,
    loadManifestById,
    loadOverrideManifest,
    loadWorkspacePlan,
    lockProject,
    resolveGraph,
    validateResolvedTemplates,
    verifyProject,
    writeProvenance
} from '../compiler/index.ts';`,
`import {
    loadManifestById,
    loadOverrideManifest,
    loadWorkspacePlan,
    writeProvenance
} from '../compiler/index.ts';
import { compileWorkspace } from '../orchestrator/pipeline-orchestrator.ts';`,
'compiler imports'
);

replaceOnce(
"import { addGeneratedPaths, readLockFile, saveLock } from '../shared/lock-utils.ts';",
"import { addGeneratedPaths, readLockFile } from '../shared/lock-utils.ts';",
'lock utils import'
);

replaceOnce(
`type UpgradeApplyStep = (context: UpgradeApplyContext, lock: LockFile) => Promise<void>;

const upgradeApplySteps: UpgradeApplyStep[] = [
  async ({ workspaceRoot }, lock) => {
    await composeProject(workspaceRoot, lock);
    await writeProvenance(workspaceRoot, lock);
  },
  async ({ plan, workspaceRoot }, lock) => {
    await adaptProject(workspaceRoot, plan, lock);
  },
  async ({ workspaceRoot }, lock) => {
    await verifyProject(workspaceRoot, lock);
  },
  async ({ workspaceRoot }, lock) => {
    await lockProject(workspaceRoot, lock);
  }
];

async function readWorkspaceLock(workspaceRoot: string): Promise<LockFile> {
  return readLockFile(workspaceRoot);
}

async function runUpgradeApplySteps(context: UpgradeApplyContext, lock: LockFile): Promise<LockFile> {
  let currentLock = lock;
  for (const step of upgradeApplySteps) {
    await step(context, currentLock);
    currentLock = await readWorkspaceLock(context.workspaceRoot);
  }
  return currentLock;
}

`,
'',
'legacy upgrade apply pipeline'
);

replaceOnce(
`  let lock = await resolveGraph(workspaceRoot, plan);
  await validateResolvedTemplates(workspaceRoot, lock);
  await saveLock(workspaceRoot, lock);

  lock = await runUpgradeApplySteps(context, lock);
  await recordUpgradeGeneratedArtifact(workspaceRoot, lock, CI_ARTIFACT_FILES.upgradePlan);`,
`  const { lock } = await compileWorkspace(workspaceRoot, {
    source: 'upgrade',
    through: 'lock',
    verificationLane: 'all'
  });
  await recordUpgradeGeneratedArtifact(workspaceRoot, lock, CI_ARTIFACT_FILES.upgradePlan);`,
'upgrade compile chain'
);

await fs.writeFile(filePath, source, 'utf8');
console.log('Upgrade pipeline codemod applied.');
