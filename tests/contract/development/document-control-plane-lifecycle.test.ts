import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { spawnSync } from 'node:child_process';
import { renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { copyFile, cp, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, test as bunTest, expect } from 'bun:test';

import { settleResourcesAsync, type ResourceSettlementFailure } from '../../../src/execution/resource-settlement.ts';

import { canonicalGitChildEnvironment } from '../../../src/adapters/providers/git/environment.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../../src/adapters/providers/github-api/test/operation-session.ts';
import {
  activateMainHealthRepairRollingPlan,
  createFreezeProjection,
  documentControlRecoveryEntryStem,
  parseActivePointer,
  parseCurrentStateSpec,
  parseRollingPlan,
  parseRollingMachineProjection,
  type DocumentControlRecoveryTargetKey,
} from '../../../src/adapters/self-hosting/control/documentation/document-control-plane-contract.ts';
import {
  DurabilityBarrierError,
  UnsafeAnchoredPathError,
  createDocumentControlRoutingTestActorForTests,
  freezeDocumentControlPlane,
  observeActiveWorkPackage,
  projectDocumentControlPlaneStatusCli,
  resolveLiveControlPlane,
  withDocumentControlHostCliTestSession,
  type DurabilityEvent,
  type FreezeFault,
  type FreezeResult
} from '../../../src/adapters/self-hosting/control/documentation/document-control-plane.ts';
import {
  createMainHealthLedger,
  createMainHealthRepairWorkPackagePath
} from '../../../src/adapters/self-hosting/control/main-health/contract.ts';
import { CI_MAIN_HEALTH_POLICY, createCiMainHealthRequestOperationId } from '../../../src/adapters/self-hosting/control/main-health/provider-policy.ts';
import { compileMainHealthRepairDecision } from '../../../src/adapters/self-hosting/control/main-health/repair.ts';
import {
  requireActiveWorkPackageOwnerObservation,
  type ActiveWorkPackageOwnerObservation
} from '../../../src/adapters/self-hosting/control/task/contract/active-work-observation.ts';
import { CodexDevelopmentWorkPackageManifestDigest } from '../../../src/adapters/self-hosting/control/task/contract/work-package.ts';
import {
  ROADMAP_WORK_CATALOG_BEGIN,
  ROADMAP_WORK_CATALOG_END,
  compileRoadmapTerminalCompaction,
  createWorkCurrentSpecObservation,
  createWorkDecisionReceipt,
  createWorkRegistryObservation,
  currentSpecRevisionFromBody,
  parseRoadmapWorkCatalog,
  renderWorkRollingSelectionPlan
} from '../../../src/adapters/self-hosting/control/work-selection/live-contract.ts';
import { digest, rawSha256 } from '../../../src/contracts/canonical.ts';

const fixtureGitHubCapabilities = new Map<string, ReturnType<typeof issueGitHubApiTestCapability>>();

function fixtureMainHealthEnvironment(repositoryRoot: string): NodeJS.ProcessEnv {
  const fixtureRoot = path.dirname(repositoryRoot);
  return {
    SEC_STATE_HOME: path.join(fixtureRoot, 'state'),
    SEC_CACHE_HOME: path.join(fixtureRoot, 'cache')
  };
}

function fixtureGitHubCapability(repositoryRoot: string) {
  const cached = fixtureGitHubCapabilities.get(repositoryRoot);
  if (cached !== undefined) return cached;
  const transport: GitHubApiTransport = async (request) => {
    const url = String(request);
    const mainSha = runGit(repositoryRoot, ['rev-parse', 'refs/remotes/origin/main']);
    const runId = '33109458351';
    if (url.includes(`/commits/${mainSha}/check-runs?`)) {
      return Response.json({
        total_count: 1,
        check_runs: [{
          id: Number(runId),
          name: CI_MAIN_HEALTH_POLICY.context,
          status: 'completed',
          conclusion: 'success',
          head_sha: mainSha,
          details_url: `https://github.com/sec-platform/sec/actions/runs/${runId}`,
          app: {
            id: CI_MAIN_HEALTH_POLICY.app.id,
            node_id: CI_MAIN_HEALTH_POLICY.app.nodeId,
            slug: CI_MAIN_HEALTH_POLICY.app.slug
          }
        }]
      });
    }
    if (url.includes(`/actions/runs/${runId}`)) {
      return Response.json({
        id: Number(runId),
        path: CI_MAIN_HEALTH_POLICY.producer.workflowPath,
        event: CI_MAIN_HEALTH_POLICY.producer.eventNames[0],
        display_title: `SEC main health ${mainSha} operation ${createCiMainHealthRequestOperationId(mainSha)}`,
        head_sha: mainSha
      });
    }
    if (url.includes('/git/ref/heads/main')) return Response.json({ object: { sha: mainSha } });
    if (url.includes(`/commits/${mainSha}/statuses?`)) return Response.json([]);
    return new Response('unexpected document-control MainHealth fixture request', { status: 404 });
  };
  const capability = issueGitHubApiTestCapability({
    repository: 'sec-platform/sec',
    token: 'document-control-test-token-0123456789',
    principal: {
      transport: 'github-rest-token',
      login: 'maintainer',
      nodeId: 'MDQ6VXNlcjE=',
      userId: 900001,
      permission: 'maintain'
    },
    effect: 'read',
    transport
  });
  fixtureGitHubCapabilities.set(repositoryRoot, capability);
  return capability;
}

const documentControlRoutingTestActor = createDocumentControlRoutingTestActorForTests({
  githubCapability: fixtureGitHubCapability,
  withGitHubCapability: async (capability, operation) => await withGitHubApiTestSession({
    capability,
    operation
  }),
  mainHealthEnvironment: fixtureMainHealthEnvironment,
  workSelectionProvider: (command, args, cwd, environment) => {
    if (command === 'gh') {
      const query = args.find((argument) => argument.startsWith('query=')) ?? '';
      const issues = Object.fromEntries([...query.matchAll(/i(\d+): issue\(number: (\d+)\)/gu)].map((match) => {
        const index = Number(match[1]);
        const number = Number(match[2]);
        return [
        `i${index}`,
        {
          number,
          id: `fixture-node-issue-${number}`,
          state: number === 310 ? 'CLOSED' : 'OPEN',
          body: `fixture issue-${number}`
        }
      ];
      }));
      return {
        status: 0,
        stdout: Buffer.from(JSON.stringify(args[0] === 'api' ? { data: { repository: issues } } : [])),
        stderr: Buffer.alloc(0)
      };
    }
    const routedArgs = [...args];
    const lsRemoteIndex = routedArgs.indexOf('ls-remote');
    if (lsRemoteIndex >= 0) {
      const repositoryArgumentIndex = routedArgs.findIndex(
        (argument, index) => index > lsRemoteIndex && !argument.startsWith('-')
      );
      if (repositoryArgumentIndex < 0) {
        return {
          status: 2,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from('fixture ls-remote repository argument is absent')
        };
      }
      routedArgs[repositoryArgumentIndex] = path.join(path.dirname(cwd), 'remote.git');
    }
    const result = spawnSync('git', routedArgs, {
      cwd,
      encoding: 'buffer',
      windowsHide: true,
      env: environment ?? canonicalGitChildEnvironment()
    });
    return {
      status: result.status,
      stdout: Buffer.from(result.stdout ?? ''),
      stderr: Buffer.from(result.stderr ?? result.error?.message ?? '')
    };
  }
});

const test = Object.assign(
  ((name: string, operation: () => void | Promise<unknown>, options?: unknown) => bunTest(
    name,
    () => withDocumentControlHostCliTestSession(operation, documentControlRoutingTestActor),
    options as never
  )) as typeof bunTest,
  {
    skipIf: (condition: boolean) => {
      const register = bunTest.skipIf(condition);
      return ((name: string, operation: () => void | Promise<unknown>, options?: unknown) => register(
        name,
        () => withDocumentControlHostCliTestSession(operation, documentControlRoutingTestActor),
        options as never
      ));
    }
  }
) as typeof bunTest;

const CURRENT_STATE_PATH = 'config/repository/current-state.yaml';
const POINTER_PATH = 'config/repository/active-work-package.md';
const CURRENT_ACTIVE_ID = 'current-active-v1';
const CURRENT_ACTIVE_PATH = `config/repository/work-packages/${CURRENT_ACTIVE_ID}.md`;
const FREEZE_TARGET_ID = 'freeze-target-v1';
const FREEZE_TARGET_PATH = `config/repository/work-packages/${FREEZE_TARGET_ID}.md`;



function readGitBlob(cwd: string, spec: string): Buffer | undefined {
  const result = spawnSync('git', ['show', spec], {
    cwd,
    encoding: 'buffer',
    windowsHide: true,
    env: canonicalGitChildEnvironment()
  });
  return result.status === 0 ? result.stdout : undefined;
}

function runGit(cwd: string, args: string[]): string {
  const disabledHooksPath = path.resolve(cwd, '.git', 'sec-test-hooks-disabled');
  const result = spawnSync('git', [
    '-c',
    `core.hooksPath=${disabledHooksPath}`,
    '-c',
    'core.autocrlf=false',
    ...args
  ], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: canonicalGitChildEnvironment()
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function expectUnsafeReparseRejection(operation: Promise<unknown>): Promise<void> {
  const failure = await operation.then(
    () => undefined,
    (error: unknown) => error
  );
  expect(['win32', 'linux']).toContain(process.platform);
  expect(failure).toBeInstanceOf(UnsafeAnchoredPathError);
  expect(failure).toMatchObject({ code: 'DOCUMENT-CONTROL-UNSAFE-PATH-001' });
  expect((failure as Error).message).toMatch(/reparse point|symbolic link|junction/u);
}

bunTest.skipIf(process.platform !== 'win32')(
  'Windows direct status preserves index bytes and creates no freeze transaction',
  async () => {
    await withFreezeFixture(async (fixture) => {
      const indexBefore = await readFile(repositoryIndexPath(fixture.repositoryRoot));
      const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
      const status = await resolveLiveControlPlane(
        fixture.repositoryRoot,
        { observeGitHub: false }
      );
      expect(status.repository).toMatchObject({ defaultRefState: 'fresh' });
      expect(await readFile(repositoryIndexPath(fixture.repositoryRoot))).toEqual(indexBefore);
      await expect(lstat(transactionRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  },
  30_000
);



interface FreezeFixture {
  readonly parent: string;
  readonly repositoryRoot: string;
  readonly remoteRoot: string;
  readonly baseSha: string;
  dispose(): Promise<void>;
}

function currentStateSource(): string {
  return `schema: sec-current-state-live-v1
resolver:
  command: bun src/adapters/self-hosting/control/documentation/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: true
stableFacts:
  workSelection:
    catalog: config/repository/work-selection.md#sec-work-selection-roadmap-catalog-v1
    projection: sec-work-selection-live-v1-required
`;
}

function activePointerSource(manifestPath: string, manifestBytes: Uint8Array): string {
  return `---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-08-08
---

# Active fixture

\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: ${manifestPath}
manifestDigest: ${CodexDevelopmentWorkPackageManifestDigest(manifestBytes)}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`;
}

function currentActiveManifestSource(
  tracking = 'issue-310',
  base = '0'.repeat(40)
): string {
  return `---
schema: codex-development-work-package-v1
id: ${CURRENT_ACTIVE_ID}
tracking: ${tracking}
base: '${base}'
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: current-active
    owner: development-governance-maintainer
    ownedPaths:
      - ${CURRENT_ACTIVE_PATH}
forbiddenPaths:
  - src/compiler/
acceptance:
  - "Current fixture remains exact."
tests:
  - tests/contract/development/document-control-plane-lifecycle.test.ts
---

# ${CURRENT_ACTIVE_ID}
`;
}

function freezeTargetManifestSource(baseSha: string): string {
  return `---
schema: codex-development-work-package-v1
id: ${FREEZE_TARGET_ID}
tracking: issue-311
base: ${baseSha}
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: freeze-target
    owner: development-governance-maintainer
    ownedPaths:
      - ${FREEZE_TARGET_PATH}
forbiddenPaths:
  - src/compiler/
acceptance:
  - "Freeze transaction remains exact."
tests:
  - tests/contract/development/document-control-plane-lifecycle.test.ts
---

# ${FREEZE_TARGET_ID}
`;
}

function rollingPlanSource(): string {
  return `---
title: Freeze fixture
status: active
domain: current-control
last-reviewed: 2026-08-08
---

# Freeze fixture

## 当前唯一 Work Package

### current-active-v1

- current-body: exact-current-bytes

## 候选 Work Package

### 1. ${FREEZE_TARGET_ID}

- target-body: exact-target-bytes

### 2. candidate-two-v1

- second-body: exact-second-bytes

### 3. candidate-three-v1

- third-body: exact-third-bytes

## Gate、单写者与重算

- fixture tail remains exact.
`;
}

function workSelectionCatalogSourceFixture(input: {
  targetTracking?: string;
  activeCurrentPackage?: boolean;
}): string {
  const targetTracking = input.targetTracking ?? 'issue-311';
  const targetIssue = targetTracking.slice('issue-'.length);
  const item = (value: {
    packageId: string;
    workId: string;
    tracking: string;
    prerequisiteWorkIds: string[];
    orderedAfterWorkIds: string[];
    disposition: 'active' | 'deferred';
    priorityClass: 'active-critical-path' | 'defer';
  }) => ({
    ...value,
    currentSpecRef: `github:issue/${value.tracking.slice('issue-'.length)}`,
    ownerRef: `github:issue/${value.tracking.slice('issue-'.length)}`,
    kind: 'focused',
    priorityEvidenceRefs: value.priorityClass === 'defer' ? [] : ['fixture:priority'],
    reproductionOrEvidenceFreshness: 'fresh',
    rootCauseState: 'not-repeated',
    rootCauseRef: `github:${value.tracking}`,
    scopeClosure: 'closed',
    exitCriteriaRef: `github:${value.tracking}#acceptance`,
    nearTermConsumerRef: null,
    humanDecisionRef: null
  });
  const candidateItems = [
    item({
      packageId: FREEZE_TARGET_ID,
      workId: `issue-${targetIssue}`,
      tracking: targetTracking,
      prerequisiteWorkIds: input.activeCurrentPackage ? ['issue-310'] : [],
      orderedAfterWorkIds: [],
      disposition: 'active',
      priorityClass: 'active-critical-path'
    }),
    item({
      packageId: 'candidate-two-v1',
      workId: 'issue-312',
      tracking: 'issue-312',
      prerequisiteWorkIds: [`issue-${targetIssue}`],
      orderedAfterWorkIds: [],
      disposition: 'active',
      priorityClass: 'active-critical-path'
    }),
    item({
      packageId: 'candidate-three-v1',
      workId: 'issue-313',
      tracking: 'issue-313',
      prerequisiteWorkIds: [],
      orderedAfterWorkIds: ['issue-312'],
      disposition: 'active',
      priorityClass: 'active-critical-path'
    })
  ];
  const catalogItems = input.activeCurrentPackage
    ? [
        item({
          packageId: CURRENT_ACTIVE_ID,
          workId: 'issue-310',
          tracking: 'issue-310',
          prerequisiteWorkIds: [],
          orderedAfterWorkIds: [],
          disposition: 'active',
          priorityClass: 'active-critical-path'
        }),
        ...candidateItems
      ]
    : candidateItems;
  return `${ROADMAP_WORK_CATALOG_BEGIN}
\`\`\`json
${JSON.stringify({
    schema: 'sec-roadmap-work-catalog-v1',
    stageRef: 'fixture-stage',
    items: catalogItems
  }, null, 2)}
\`\`\`
${ROADMAP_WORK_CATALOG_END}`;
}

function workSelectionReceiptFixture(input: {
  exactMain: string;
  exactMainTree: string;
  targetTracking?: string;
  activeCurrentPackage?: boolean;
}) {
  const catalogSource = workSelectionCatalogSourceFixture(input);
  const catalog = parseRoadmapWorkCatalog(catalogSource);
  return createWorkDecisionReceipt({
    repository: 'sec-platform/sec',
    exactMain: input.exactMain,
    exactMainTree: input.exactMainTree,
    roadmapRevision: rawSha256(catalogSource),
    catalog,
    registry: createWorkRegistryObservation({
      defaultTreeSha: input.exactMainTree,
      entries: []
    }),
    current: {
      activeWorkId: null,
      activeRef: null,
      activeState: 'none',
      activeLegality: 'not-applicable',
      mainHealthState: 'healthy',
      mainHealthRef: 'fixture:main-health',
      closeoutState: 'none',
      closeoutRef: 'fixture:closeout',
      controlState: 'consistent',
      controlRef: 'fixture:control'
    },
    currentSpecs: catalog.items.map((catalogItem) => createWorkCurrentSpecObservation({
      workId: catalogItem.workId,
      currentSpecRef: catalogItem.currentSpecRef,
      providerResourceRef: `github-node:${catalogItem.tracking}`,
      providerState: 'open',
      currentSpecRevision: currentSpecRevisionFromBody(`fixture ${catalogItem.workId}`)
    }))
  });
}

async function createFreezeFixture(): Promise<FreezeFixture> {
  const parent = await mkdtemp(path.join(tmpdir(), 'sec-control-freeze-'));
  const repositoryRoot = path.join(parent, 'repository');
  const remoteRoot = path.join(parent, 'remote.git');
  try {
    const seed = await freezeFixtureSeed();
    // Join both physical copies before error settlement: Promise.all would
    // allow one failed copy to race with retirement while its peer still writes.
    const copies = await Promise.allSettled([
      cp(seed.repositoryRoot, repositoryRoot, { recursive: true }),
      cp(seed.remoteRoot, remoteRoot, { recursive: true })
    ]);
    const failures = copies.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Both native freeze fixture copies failed');
    }
    runGit(repositoryRoot, ['remote', 'set-url', 'origin', remoteRoot]);
    return {
      parent,
      repositoryRoot,
      remoteRoot,
      baseSha: seed.baseSha,
      dispose: async () => {
        fixtureGitHubCapabilities.delete(repositoryRoot);
        await rm(parent, { recursive: true, force: true });
      }
    };
  } catch (error) {
    fixtureGitHubCapabilities.delete(repositoryRoot);
    try { await rm(parent, { recursive: true, force: true }); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Freeze fixture preparation and cleanup both failed');
    }
    throw error;
  }
}

async function withFreezeFixture<T>(operation: (fixture: FreezeFixture) => Promise<T>): Promise<T> {
  const fixture = await createFreezeFixture();
  return settleWorkspaceCallback(() => operation(fixture), async () => {
    await fixture.dispose();
  });
}

interface FreezeFixtureSeed {
  readonly parent: string;
  readonly repositoryRoot: string;
  readonly remoteRoot: string;
  readonly baseSha: string;
}

let freezeFixtureSeedPromise: Promise<FreezeFixtureSeed> | undefined;

function freezeFixtureSeed(): Promise<FreezeFixtureSeed> {
  if (freezeFixtureSeedPromise !== undefined) return freezeFixtureSeedPromise;
  const pending = createFreezeFixtureSeed();
  freezeFixtureSeedPromise = pending;
  // The seed builder settles failed physical preparation. Do not make a
  // rejected Promise the permanent source of every later freeze recovery case.
  void pending.catch(() => {
    if (freezeFixtureSeedPromise === pending) freezeFixtureSeedPromise = undefined;
  });
  return pending;
}

async function createFreezeFixtureSeed(): Promise<FreezeFixtureSeed> {
  const parent = await mkdtemp(path.join(tmpdir(), 'sec-control-freeze-seed-'));
  const repositoryRoot = path.join(parent, 'repository');
  const remoteRoot = path.join(parent, 'remote.git');
  try {
  await mkdir(repositoryRoot, { recursive: true });
  runGit(parent, ['init', '--quiet', '--bare', remoteRoot]);
  runGit(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
  runGit(repositoryRoot, ['config', 'user.email', 'sec-control-plane@example.invalid']);
  runGit(repositoryRoot, ['config', 'user.name', 'SEC Control Plane Test']);
  const currentManifestBytes = Buffer.from(currentActiveManifestSource(), 'utf8');
  const initialFiles: Readonly<Record<string, string | Uint8Array>> = {
    'README.md': '# freeze fixture\n',
    [CURRENT_STATE_PATH]: currentStateSource(),
    [POINTER_PATH]: activePointerSource(CURRENT_ACTIVE_PATH, currentManifestBytes),
    'config/repository/work-selection.md': workSelectionCatalogSourceFixture({ activeCurrentPackage: true }),
    'config/repository/rolling-plan.md': rollingPlanSource(),
    [CURRENT_ACTIVE_PATH]: currentManifestBytes
  };
  for (const [repositoryPath, content] of Object.entries(initialFiles)) {
    const filePath = path.join(repositoryRoot, ...repositoryPath.split('/'));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
  runGit(repositoryRoot, ['add', '.']);
  runGit(repositoryRoot, ['commit', '--quiet', '-m', 'base']);
  const projectionBaseSha = runGit(repositoryRoot, ['rev-parse', 'HEAD']);
  const projectionBaseTree = runGit(repositoryRoot, ['rev-parse', `${projectionBaseSha}^{tree}`]);
  await writeFile(
    path.join(repositoryRoot, 'config/repository/rolling-plan.md'),
    renderWorkRollingSelectionPlan({
      receipt: workSelectionReceiptFixture({
        exactMain: projectionBaseSha,
        exactMainTree: projectionBaseTree,
        activeCurrentPackage: true
      }),
      reviewedOn: '2026-08-12'
    }),
    'utf8'
  );
  runGit(repositoryRoot, ['add', 'config/repository/rolling-plan.md']);
  runGit(repositoryRoot, ['commit', '--quiet', '-m', 'publish rolling projection']);
  const terminalCompaction = compileRoadmapTerminalCompaction({
    roadmapSource: workSelectionCatalogSourceFixture({ activeCurrentPackage: true }),
    completedWorkIds: ['issue-310']
  });
  await writeFile(
    path.join(repositoryRoot, 'config/repository/work-selection.md'),
    terminalCompaction.roadmapSource,
    'utf8'
  );
  runGit(repositoryRoot, ['add', 'config/repository/work-selection.md']);
  runGit(repositoryRoot, ['commit', '--quiet', '-m', 'publish terminal roadmap compaction']);
  runGit(repositoryRoot, ['remote', 'add', 'origin', remoteRoot]);
  runGit(repositoryRoot, ['push', '--quiet', '--set-upstream', 'origin', 'main']);
  runGit(repositoryRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  const baseSha = runGit(repositoryRoot, ['rev-parse', 'HEAD']);
  runGit(repositoryRoot, ['switch', '--quiet', '-c', 'fixture-candidate']);
  const targetManifest = freezeTargetManifestSource(baseSha);
  const targetPath = path.join(repositoryRoot, ...FREEZE_TARGET_PATH.split('/'));
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, targetManifest, 'utf8');
  runGit(repositoryRoot, ['rm', '--quiet', CURRENT_ACTIVE_PATH]);
  runGit(repositoryRoot, ['add', FREEZE_TARGET_PATH]);
    return Object.freeze({ parent, repositoryRoot, remoteRoot, baseSha });
  } catch (error) {
    try { await rm(parent, { recursive: true, force: true }); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Freeze source preparation and cleanup both failed');
    }
    throw error;
  }
}

afterAll(async () => {
  if (freezeFixtureSeedPromise === undefined) return;
  // Failed preparation already owns its cleanup and propagates its original
  // error through the requesting test. Only completed seed roots are owned here.
  const settled = await Promise.allSettled([freezeFixtureSeedPromise]);
  if (settled[0]?.status === 'fulfilled') {
    await rm(settled[0].value.parent, { recursive: true, force: true });
  }
});









test('status resolves a published rolling projection as history after its exact manifest reaches default', async () => {
  await withFreezeFixture(async (fixture) => {
    const manifestBytes = await readFile(path.join(
      fixture.repositoryRoot,
      ...FREEZE_TARGET_PATH.split('/')
    ));
    const exactMainTree = runGit(fixture.repositoryRoot, ['rev-parse', `${fixture.baseSha}^{tree}`]);
    const currentPointerSource = await readFile(
      path.join(fixture.repositoryRoot, POINTER_PATH),
      'utf8'
    );
    const projection = createFreezeProjection({
      spec: parseCurrentStateSpec(currentStateSource()),
      currentPointerSource,
      currentRollingPlanSource: rollingPlanSource(),
      currentManifestBytes: Buffer.from(currentActiveManifestSource(), 'utf8'),
      workSelectionProjection: {
        receipt: workSelectionReceiptFixture({ exactMain: fixture.baseSha, exactMainTree })
      },
      manifestPath: FREEZE_TARGET_PATH,
      manifestBytes,
      baseSha: fixture.baseSha,
      baseTreeSha: exactMainTree,
      reviewedOn: '2026-08-21'
    });
    await writeFile(
      path.join(fixture.repositoryRoot, POINTER_PATH),
      projection.pointerSource,
      'utf8'
    );
    await writeFile(
      path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'),
      projection.rollingPlanSource,
      'utf8'
    );
    runGit(fixture.repositoryRoot, ['add', '.']);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'publish exact projection']);
    runGit(fixture.repositoryRoot, ['push', '--quiet', 'origin', 'HEAD:main']);
    const publishedSha = runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD']);
    expect(publishedSha).not.toBe(fixture.baseSha);

    const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
    expect(status.repository).toMatchObject({
      localDefaultSha: publishedSha,
      liveDefaultSha: publishedSha,
      defaultRefState: 'fresh'
    });
    expect(status.activeWorkPackage).toEqual({
      state: 'none',
      reason: 'matching-default-blob'
    });
    const branchObservation = await observeActiveWorkPackage(fixture.repositoryRoot);
    expect(requireActiveWorkPackageOwnerObservation(branchObservation)).toBe(branchObservation);
    expect(branchObservation).toMatchObject({
      repository: 'sec-platform/sec',
      defaultBranch: 'main',
      defaultSha: publishedSha,
      state: 'none',
      branch: null,
      manifest: null,
      reason: 'matching-default-blob'
    });
    expect(() => requireActiveWorkPackageOwnerObservation(
      { ...branchObservation } as ActiveWorkPackageOwnerObservation
    )).toThrow('active-work-owner-observation-not-issued');
  });
}, 30_000);

test('same-package freeze preserves the exact current tracking identity', () => {
  const baseSha = 'a'.repeat(40);
  const currentManifestBytes = Buffer.from(currentActiveManifestSource(), 'utf8');
  const replacementBytes = Buffer.from(
    currentActiveManifestSource('issue-999', baseSha),
    'utf8'
  );
  const currentPointerSource = activePointerSource(
    CURRENT_ACTIVE_PATH,
    currentManifestBytes
  );
  expect(() => createFreezeProjection({
    spec: parseCurrentStateSpec(currentStateSource()),
    currentPointerSource,
    currentRollingPlanSource: rollingPlanSource(),
    currentManifestBytes,
    manifestPath: CURRENT_ACTIVE_PATH,
    manifestBytes: replacementBytes,
    baseSha,
    reviewedOn: '2026-08-09'
  })).toThrow('cannot replace the exact tracking identity');
  const samePackage = createFreezeProjection({
    spec: parseCurrentStateSpec(currentStateSource()),
    currentPointerSource,
    currentRollingPlanSource: rollingPlanSource(),
    currentManifestBytes,
    manifestPath: CURRENT_ACTIVE_PATH,
    manifestBytes: currentManifestBytes,
    baseSha: '0'.repeat(40),
    reviewedOn: '2026-08-09'
  });
  expect(samePackage.retiredManifestPath).toBeNull();
});

test('freeze projection replaces topology only with an exact WorkDecision binding', () => {
  const baseSha = 'a'.repeat(40);
  const manifestBytes = Buffer.from(freezeTargetManifestSource(baseSha), 'utf8');
  const exactMainTree = '2'.repeat(40);
  const currentPointerSource = activePointerSource(
    CURRENT_ACTIVE_PATH,
    Buffer.from(currentActiveManifestSource(), 'utf8')
  );
  const receipt = workSelectionReceiptFixture({ exactMain: baseSha, exactMainTree });
  const selection = { receipt };
  const selectedRollingPlanSource = renderWorkRollingSelectionPlan({
    receipt,
    reviewedOn: '2026-08-12'
  });
  const requiredSpec = parseCurrentStateSpec(currentStateSource());
  const projectionInput = () => ({
    spec: requiredSpec,
    currentPointerSource,
    currentRollingPlanSource: rollingPlanSource(),
    currentManifestBytes: Buffer.from(currentActiveManifestSource(), 'utf8'),
    manifestPath: FREEZE_TARGET_PATH,
    manifestBytes,
    baseSha,
    reviewedOn: '2026-08-12'
  });
  const projection = createFreezeProjection({
    ...projectionInput(),
    workSelectionProjection: selection,
    baseTreeSha: exactMainTree
  });
  expect(projection.rollingPlanSource).toBe(selectedRollingPlanSource);
  expect(parseRollingPlan(projection.rollingPlanSource)).toEqual({
    activePackageId: FREEZE_TARGET_ID,
    candidatePackageIds: ['candidate-two-v1', 'candidate-three-v1']
  });
  expect(() => createFreezeProjection({
    ...projectionInput(),
    requestedRollingPlanSource: `${selectedRollingPlanSource}\nmanual drift\n`,
    workSelectionProjection: selection,
    baseTreeSha: exactMainTree
  })).toThrow('must equal the trusted WorkDecision renderer exactly');
  expect(() => createFreezeProjection({
    ...projectionInput(),
    workSelectionProjection: { receipt: workSelectionReceiptFixture({
      exactMain: baseSha,
      exactMainTree,
      targetTracking: 'issue-999'
    }) },
    baseTreeSha: exactMainTree
  })).toThrow('must equal the target manifest package and tracking identity');
  expect(() => createFreezeProjection({
    ...projectionInput(),
    baseTreeSha: exactMainTree
  })).toThrow('requires exactly one live WorkDecision or MainHealth repair projection');
  expect(() => createFreezeProjection({
    ...projectionInput(),
    spec: parseCurrentStateSpec(currentStateSource()),
    workSelectionProjection: selection
  })).toThrow('WorkDecision projection must bind the exact freeze base and tree');
});

test('freeze projection admits only the exact degraded-main repair and preserves prior topology', () => {
  const baseSha = 'a'.repeat(40);
  const exactMainTree = '2'.repeat(40);
  const observedAt = '2026-08-12T00:00:00.000Z';
  const repairFailure = rawSha256('fixture-main-health-failure');
  const repairPath = createMainHealthRepairWorkPackagePath({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    mainSha: baseSha,
    mainTreeSha: exactMainTree,
    owner: 'ci-verification-maintainer',
    failureFingerprints: [repairFailure]
  });
  const repairId = repairPath.slice('config/repository/work-packages/'.length, -'.md'.length);
  const ledger = createMainHealthLedger({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    mainSha: baseSha,
    mainTreeSha: exactMainTree,
    status: 'degraded',
    failureFingerprints: [repairFailure],
    owner: 'ci-verification-maintainer',
    repairWorkPackage: repairPath,
    expiresAt: '2026-08-12T00:05:00.000Z',
    allowedLanes: ['repair'],
    trustRevision: baseSha,
    observedAt,
    producer: {
      identity: 'fixture-main-health-producer',
      trustRevision: baseSha,
      sourceTransport: 'github-api',
      sourceRunId: 'fixture-run',
      sourceRef: 'fixture:main-health',
      sourceDigest: rawSha256('fixture-main-health-source')
    }
  });
  const decision = compileMainHealthRepairDecision({
    observation: { kind: 'available', ledger },
    now: observedAt,
    expectedRepository: 'sec-platform/sec',
    expectedDefaultBranch: 'main',
    expectedMainSha: baseSha,
    expectedMainTreeSha: exactMainTree,
    expectedTrustRevision: baseSha
  });
  const manifestBytes = Buffer.from(`---
schema: codex-development-work-package-v1
id: ${repairId}
tracking: none
base: '${baseSha}'
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: repair
    owner: ci-verification-maintainer
    ownedPaths:
      - config/repository/work-packages/${repairId}.md
forbiddenPaths:
  - src/compiler/
acceptance:
  - exact degraded-main repair remains bounded
tests:
  - tests/contract/development/document-control-plane-lifecycle.test.ts
---
`, 'utf8');
  const directRepairInput = {
    packageId: repairId,
    manifestPath: repairPath,
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest(manifestBytes) as `sha256:${string}`,
    mainSha: baseSha,
    mainTreeSha: exactMainTree,
    healthRevision: decision.binding!.healthRevision,
    ledgerDigest: decision.binding!.ledgerDigest,
    decisionDigest: decision.decisionDigest,
    failureFingerprints: decision.binding!.failureFingerprints,
    reviewedOn: '2026-08-12'
  } as const;
  const currentPointerSource = activePointerSource(
    CURRENT_ACTIVE_PATH,
    Buffer.from(currentActiveManifestSource(), 'utf8')
  );
  const currentManifestBytes = Buffer.from(currentActiveManifestSource(), 'utf8');
  const currentPointer = parseActivePointer(currentPointerSource);
  const publishedActivePackage = Object.freeze({
    manifestPath: currentPointer.manifest,
    manifestDigest: currentPointer.manifestDigest,
    defaultManifestBytes: currentManifestBytes
  });
  const projectionInput = () => ({
    spec: parseCurrentStateSpec(currentStateSource()),
    currentPointerSource,
    currentRollingPlanSource: rollingPlanSource(),
    currentManifestBytes,
    mainHealthRepairProjection: { decision, publishedActivePackage },
    manifestPath: repairPath,
    manifestBytes,
    baseSha,
    baseTreeSha: exactMainTree,
    reviewedOn: '2026-08-12'
  });
  const projection = createFreezeProjection(projectionInput());
  expect(parseRollingPlan(projection.rollingPlanSource)).toEqual({
    activePackageId: repairId,
    candidatePackageIds: [
      FREEZE_TARGET_ID,
      'candidate-two-v1',
      'candidate-three-v1'
    ]
  });
  expect(parseRollingMachineProjection(projection.rollingPlanSource)).toMatchObject({
    authority: { kind: 'main-health-repair' },
    active: { tracking: 'none' }
  });
  expect(projection.rollingPlanSource).not.toContain('- current-body: exact-current-bytes');
  expect(projection.rollingPlanSource).not.toContain('- target-body: exact-target-bytes');
  expect(projection.rollingPlanSource).toContain('sec-work-rolling-transition-projection-v1');
  expect(projection.rollingPlanSource).toContain(`"exactMain": "${baseSha}"`);
  expect(projection.rollingPlanSource).toContain(`"exactMainTree": "${exactMainTree}"`);
  expect(projection.rollingPlanSource).toContain(decision.binding!.healthRevision);
  expect(projection.rollingPlanSource).toContain(repairFailure);
  expect(projection.rollingPlanSource).not.toContain('last-reviewed: 2026-08-08\n---\n\n# Freeze fixture\n\n## 当前唯一');
  const normalizedProjection = activateMainHealthRepairRollingPlan({
    source: rollingPlanSource().replace('### 2. candidate-two-v1\n', '### 2. candidate-two-v1  \n'),
    ...directRepairInput,
    publishedActivePackageId: CURRENT_ACTIVE_ID
  });
  expect(normalizedProjection).not.toContain('candidate-two-v1  ');
  const maximalPriorTopology = rollingPlanSource().replace(
    '## Gate、单写者与重算',
    `### 4. candidate-four-v1

- fourth-body: exact-fourth-bytes

### 5. candidate-five-v1

- fifth-body: exact-fifth-bytes

## Gate、单写者与重算`
  );
  const maximalProjection = createFreezeProjection({
    ...projectionInput(),
    currentRollingPlanSource: maximalPriorTopology,
  });
  expect(parseRollingPlan(maximalProjection.rollingPlanSource).candidatePackageIds)
    .toEqual([
      FREEZE_TARGET_ID,
      'candidate-two-v1',
      'candidate-three-v1',
      'candidate-four-v1',
      'candidate-five-v1'
    ]);
  expect(() => activateMainHealthRepairRollingPlan({
    source: maximalPriorTopology,
    ...directRepairInput,
    publishedActivePackageId: null
  })).toThrow('cannot preserve all prior identities within the five-candidate bound');
  const unpublishedProjection = activateMainHealthRepairRollingPlan({
    source: rollingPlanSource(),
    ...directRepairInput,
    publishedActivePackageId: null
  });
  expect(parseRollingPlan(unpublishedProjection).candidatePackageIds[0])
    .toBe(CURRENT_ACTIVE_ID);
  const wrongManifestBytes = Buffer.from(freezeTargetManifestSource(baseSha), 'utf8');
  expect(() => createFreezeProjection({
    ...projectionInput(),
    manifestPath: FREEZE_TARGET_PATH,
    manifestBytes: wrongManifestBytes
  })).toThrow('differs from the exact manifest or repository identity');
  expect(() => createFreezeProjection({
    ...projectionInput(),
    mainHealthRepairProjection: {
      decision,
      publishedActivePackage: {
        ...publishedActivePackage,
        defaultManifestBytes: Buffer.from(`${currentActiveManifestSource()}\n`, 'utf8')
      }
    }
  })).toThrow('does not prove the current active package is byte-identical on exact default');
});

test('freeze rejects a manually staged pointer and rolling-plan selection baseline', async () => {
  await withFreezeFixture(async (fixture) => {
    const manifestBytes = await readFile(path.join(fixture.repositoryRoot, ...FREEZE_TARGET_PATH.split('/')));
    const exactMainTree = runGit(fixture.repositoryRoot, ['rev-parse', `${fixture.baseSha}^{tree}`]);
    const canonical = createFreezeProjection({
      spec: parseCurrentStateSpec(currentStateSource()),
      currentPointerSource: await readFile(path.join(fixture.repositoryRoot, POINTER_PATH), 'utf8'),
      currentRollingPlanSource: rollingPlanSource(),
      currentManifestBytes: Buffer.from(currentActiveManifestSource(), 'utf8'),
      workSelectionProjection: {
        receipt: workSelectionReceiptFixture({ exactMain: fixture.baseSha, exactMainTree })
      },
      manifestPath: FREEZE_TARGET_PATH,
      manifestBytes,
      baseSha: fixture.baseSha,
      baseTreeSha: exactMainTree,
      reviewedOn: '2026-08-09'
    });
    const reorderedRolling = canonical.rollingPlanSource
      .replace('### 1. candidate-two-v1', '### 1. candidate-swap-v1')
      .replace('### 2. candidate-three-v1', '### 2. candidate-two-v1')
      .replace('### 1. candidate-swap-v1', '### 1. candidate-three-v1');
    await writeFile(path.join(fixture.repositoryRoot, POINTER_PATH), canonical.pointerSource);
    await writeFile(path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'), reorderedRolling);
    runGit(fixture.repositoryRoot, ['add', FREEZE_TARGET_PATH, POINTER_PATH, 'config/repository/rolling-plan.md']);
    const objectCensusBefore = runGit(fixture.repositoryRoot, ['count-objects', '-v']);
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('Rolling plan headings do not equal the digest-bound machine projection');
    expect(runGit(fixture.repositoryRoot, ['count-objects', '-v'])).toBe(objectCensusBefore);
  });
}, 30_000);

test('freeze publishes one exact index tree, projects worktree bytes, and is idempotent', async () => {
  await withFreezeFixture(async (fixture) => {
    expect(runGit(fixture.repositoryRoot, ['ls-tree', '-r', '--name-only', 'HEAD', '--', CURRENT_ACTIVE_PATH]))
      .toBe(CURRENT_ACTIVE_PATH);
    expect(runGit(fixture.repositoryRoot, ['diff', '--cached', '--no-renames', '--name-only'])).toBe([
      CURRENT_ACTIVE_PATH,
      FREEZE_TARGET_PATH
    ].sort().join('\n'));
    const result = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(result).toMatchObject({
      schema: 'sec-document-control-plane-freeze-result-v1',
      status: 'ACTIVATED_INDEX_PENDING_COMMIT',
      baseSha: fixture.baseSha,
      candidateHeadSha: null,
      manifestPath: FREEZE_TARGET_PATH,
      indexPublished: true,
      worktreeProjected: true
    });
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(result.candidateTreeSha);
    const pointer = parseActivePointer(
      await readFile(path.join(fixture.repositoryRoot, POINTER_PATH), 'utf8')
    );
    const rolling = parseRollingPlan(
      await readFile(path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'), 'utf8')
    );
    expect(pointer.manifest).toBe(FREEZE_TARGET_PATH);
    expect(rolling.activePackageId).toBe(FREEZE_TARGET_ID);
    expect(rolling.candidatePackageIds).toEqual(['candidate-two-v1', 'candidate-three-v1']);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
    if (process.platform === 'win32') {
      await expect(lstat(`${repositoryIndexPath(fixture.repositoryRoot)}.lock`))
        .rejects.toMatchObject({ code: 'ENOENT' });
    }
    const indexBeforeNoop = await readFile(repositoryIndexPath(fixture.repositoryRoot));
    const pointerBeforeNoop = await readFile(path.join(fixture.repositoryRoot, POINTER_PATH));
    const rollingBeforeNoop = await readFile(path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'));
    const second = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(second).toMatchObject({
      baseSha: result.baseSha,
      baseTreeSha: result.baseTreeSha,
      candidateTreeSha: result.candidateTreeSha,
      manifestPath: result.manifestPath,
      manifestDigest: result.manifestDigest
    });
    expect(await readFile(repositoryIndexPath(fixture.repositoryRoot))).toEqual(indexBeforeNoop);
    expect(await readFile(path.join(fixture.repositoryRoot, POINTER_PATH))).toEqual(pointerBeforeNoop);
    expect(await readFile(path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'))).toEqual(rollingBeforeNoop);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
    expect(runGit(fixture.repositoryRoot, ['diff', '--cached', '--no-renames', '--name-only'])).toBe([
      CURRENT_ACTIVE_PATH,
      POINTER_PATH,
      'config/repository/rolling-plan.md',
      FREEZE_TARGET_PATH
    ].sort().join('\n'));
  });
}, 30_000);

interface ProposalFreezeFixture {
  readonly fixture: FreezeFixture;
  readonly proposalBytes: Buffer;
  readonly proposalFile: string;
  readonly proposalId: string;
  readonly proposalJournalPath: string;
  readonly proposalPath: string;
}

async function createProposalFreezeFixture(): Promise<ProposalFreezeFixture> {
  const fixture = await createFreezeFixture();
  try {
    const proposalId = 'private-sandbox-python-runtime-transition';
    const proposalPath = `config/repository/work-packages/${proposalId}.md`;
    const manifestPath = path.join(fixture.repositoryRoot, ...FREEZE_TARGET_PATH.split('/'));
    const proposalBytes = Buffer.from(
      (await readFile(manifestPath, 'utf8'))
        .replaceAll(FREEZE_TARGET_ID, proposalId)
        .replace('tracking: issue-311', 'tracking: none'),
      'utf8'
    );
    runGit(fixture.repositoryRoot, ['rm', '--quiet', '--cached', FREEZE_TARGET_PATH]);
    await unlink(manifestPath);
    const proposalFile = path.join(fixture.repositoryRoot, ...proposalPath.split('/'));
    await writeFile(proposalFile, proposalBytes);
    runGit(fixture.repositoryRoot, ['add', proposalPath]);
    return Object.freeze({
      fixture,
      proposalBytes,
      proposalFile,
      proposalId,
      proposalJournalPath: path.join(
        fixture.repositoryRoot,
        '.tmp/codex/document-control-plane-freeze-v1/journal.json'
      ),
      proposalPath
    });
  } catch (error) {
    try { await fixture.dispose(); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Proposal preparation and cleanup both failed');
    }
    throw error;
  }
}

async function withProposalFreezeFixture<T>(
  operation: (prepared: ProposalFreezeFixture) => Promise<T>
): Promise<T> {
  const prepared = await createProposalFreezeFixture();
  return settleWorkspaceCallback(() => operation(prepared), async () => {
    await prepared.fixture.dispose();
  });
}

test('proposal-only recovery preserves its PROPOSED identity, rejects the activation lane and completes', async () => {
  await withProposalFreezeFixture(async (prepared) => {
    const { fixture, proposalId, proposalJournalPath, proposalPath } = prepared;
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: proposalPath,
      reviewedOn: '2026-08-09',
      proposalOnly: true,
      faultAfter: 'after-pointer-publish'
    })).rejects.toThrow('Injected document control freeze fault: after-pointer-publish.');
    const proposalJournalBytes = await readFile(proposalJournalPath);
    const terminalJournal = JSON.parse(proposalJournalBytes.toString('utf8')) as {
      schema: string;
      authoringDisposition: string;
      result: { schema: string; status: string };
    };
    expect(terminalJournal).toMatchObject({
      schema: 'sec-document-control-plane-freeze-journal-v5',
      authoringDisposition: 'proposal-only',
      result: {
        schema: 'sec-document-control-plane-freeze-result-v2',
        status: 'PROPOSED'
      }
    });
    expect((await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
      .activeWorkPackage).toEqual({
        state: 'unresolved',
        reason: 'document-control-authoring-in-progress'
      });
    for (const invalidResult of [
      { schema: 'sec-document-control-plane-freeze-result-v2', status: 'ACTIVATED_INDEX_PENDING_COMMIT' },
      { schema: 'sec-document-control-plane-freeze-result-v1', status: 'PROPOSED' }
    ]) {
      await writeFile(proposalJournalPath, `${JSON.stringify({
        ...terminalJournal,
        result: { ...terminalJournal.result, ...invalidResult }
      }, null, 2)}\n`, 'utf8');
      await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
        .rejects.toThrow('Freeze journal result identity is invalid');
      await writeFile(proposalJournalPath, proposalJournalBytes);
    }
    const journalBeforeWrongLane = await readFile(proposalJournalPath);
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: proposalPath,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('belongs to another authoring disposition');
    expect(await readFile(proposalJournalPath)).toEqual(journalBeforeWrongLane);

    const recovered = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: proposalPath,
      reviewedOn: '2026-08-09',
      proposalOnly: true
    });
    expect(recovered).toMatchObject({
      schema: 'sec-document-control-plane-freeze-result-v2',
      status: 'PROPOSED',
      baseSha: fixture.baseSha,
      candidateHeadSha: null,
      manifestPath: proposalPath,
      indexPublished: true,
      worktreeProjected: true
    });
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(recovered.candidateTreeSha);
    expect(parseRollingPlan(
      await readFile(path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'), 'utf8')
    ).activePackageId).toBe(proposalId);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
  });
}, 30_000);

test('proposal-only live readback rejects pointer and manifest identity drift', async () => {
  await withProposalFreezeFixture(async (prepared) => {
    const { fixture, proposalBytes, proposalFile, proposalPath } = prepared;
    await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: proposalPath,
      reviewedOn: '2026-08-09',
      proposalOnly: true
    });
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
    const pointerFile = path.join(fixture.repositoryRoot, POINTER_PATH);
    const pointerBytes = await readFile(pointerFile);
    await writeFile(pointerFile, pointerBytes.toString('utf8').replace(
      `manifestDigest: ${CodexDevelopmentWorkPackageManifestDigest(proposalBytes)}`,
      `manifestDigest: ${rawSha256('proposal-pointer-digest-drift')}`
    ));
    runGit(fixture.repositoryRoot, ['add', POINTER_PATH]);
    await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
      .rejects.toThrow('does not bind the exact active pointer manifest');
    await writeFile(pointerFile, pointerBytes);
    runGit(fixture.repositoryRoot, ['add', POINTER_PATH]);
    await writeFile(proposalFile, proposalBytes.toString('utf8').replace('tracking: none', 'tracking: issue-999'));
    runGit(fixture.repositoryRoot, ['add', proposalPath]);
    // A well-formed observation of invalid input is data, not service failure.
    await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
      .resolves.toMatchObject({
        activeWorkPackage: { state: 'invalid', reason: 'candidate-digest-mismatch' }
      });
    await writeFile(proposalFile, proposalBytes);
    runGit(fixture.repositoryRoot, ['add', proposalPath]);
  });
}, 30_000);

test('a completed proposal is idempotent only through the proposal-only lane', async () => {
  await withProposalFreezeFixture(async (prepared) => {
    const { fixture, proposalPath } = prepared;
    const proposed = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: proposalPath,
      reviewedOn: '2026-08-09',
      proposalOnly: true
    });
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: proposalPath,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow();
    const repeated = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: proposalPath,
      reviewedOn: '2026-08-09',
      proposalOnly: true
    });
    expect(repeated).toMatchObject({
      status: 'PROPOSED',
      candidateTreeSha: proposed.candidateTreeSha,
      manifestDigest: proposed.manifestDigest
    });
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
  });
}, 30_000);

test('pre-evidence replan replaces one staged manifest generation in the same worktree', async () => {
  await withFreezeFixture(async (fixture) => {
    const manifestPath = path.join(fixture.repositoryRoot, ...FREEZE_TARGET_PATH.split('/'));
    const first = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
    const firstRolling = await readFile(
      path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'),
      'utf8'
    );
    const nextManifest = Buffer.concat([
      await readFile(manifestPath),
      Buffer.from('\nReplanned in the same candidate transport.\n', 'utf8')
    ]);
    await writeFile(manifestPath, nextManifest);
    const replanned = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-10'
    });
    expect(replanned.candidateTreeSha).not.toBe(first.candidateTreeSha);
    const pointer = parseActivePointer(
      await readFile(path.join(fixture.repositoryRoot, POINTER_PATH), 'utf8')
    );
    expect<string>(pointer.manifestDigest)
      .toBe(CodexDevelopmentWorkPackageManifestDigest(nextManifest));
    expect(await readFile(path.join(fixture.repositoryRoot, POINTER_PATH), 'utf8'))
      .toContain('last-reviewed: 2026-08-10');
    expect(await readFile(path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'), 'utf8'))
      .not.toBe(firstRolling);
    expect(readGitBlob(fixture.repositoryRoot, `:${FREEZE_TARGET_PATH}`)).toEqual(nextManifest);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
  });
}, 30_000);

test('pre-evidence replan replaces one committed candidate generation pending amend', async () => {
  await withFreezeFixture(async (fixture) => {
    const first = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'candidate generation']);
    const committedHead = runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD']);
    expect(runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD^'])).toBe(fixture.baseSha);
    const manifestPath = path.join(fixture.repositoryRoot, ...FREEZE_TARGET_PATH.split('/'));
    const nextManifest = Buffer.concat([
      await readFile(manifestPath),
      Buffer.from('\nReplanned after exact-head review in the same candidate transport.\n', 'utf8')
    ]);
    await writeFile(manifestPath, nextManifest);
    const replanned = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD'])).toBe(committedHead);
    expect(replanned).toMatchObject({
      status: 'ACTIVATED_INDEX_PENDING_COMMIT',
      baseSha: fixture.baseSha,
      candidateHeadSha: null,
      manifestDigest: CodexDevelopmentWorkPackageManifestDigest(nextManifest)
    });
    expect(replanned.candidateTreeSha).not.toBe(first.candidateTreeSha);
    expect(readGitBlob(fixture.repositoryRoot, `:${FREEZE_TARGET_PATH}`)).toEqual(nextManifest);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
  });
}, 30_000);

test('committed candidate replan rebinds after main advances without changing its control generation', async () => {
  await withFreezeFixture(async (fixture) => {
    const manifestFile = path.join(fixture.repositoryRoot, ...FREEZE_TARGET_PATH.split('/'));
    await writeFile(path.join(fixture.repositoryRoot, CURRENT_STATE_PATH), currentStateSource());
    runGit(fixture.repositoryRoot, [
      'reset', '--quiet', 'HEAD', '--', FREEZE_TARGET_PATH, CURRENT_ACTIVE_PATH
    ]);
    const oldMainSha = runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD']);
    const oldMainTree = runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD^{tree}']);
    const firstManifest = Buffer.from(
      (await readFile(manifestFile, 'utf8')).replace(`base: ${fixture.baseSha}`, `base: ${oldMainSha}`),
      'utf8'
    );
    await writeFile(manifestFile, firstManifest);
    const firstProjection = createFreezeProjection({
      spec: parseCurrentStateSpec(currentStateSource()),
      currentPointerSource: await readFile(path.join(fixture.repositoryRoot, POINTER_PATH), 'utf8'),
      currentRollingPlanSource: rollingPlanSource(),
      currentManifestBytes: Buffer.from(currentActiveManifestSource(), 'utf8'),
      workSelectionProjection: {
        receipt: workSelectionReceiptFixture({ exactMain: oldMainSha, exactMainTree: oldMainTree })
      },
      manifestPath: FREEZE_TARGET_PATH,
      manifestBytes: firstManifest,
      baseSha: oldMainSha,
      baseTreeSha: oldMainTree,
      reviewedOn: '2026-08-21'
    });
    await writeFile(path.join(fixture.repositoryRoot, POINTER_PATH), firstProjection.pointerSource);
    await writeFile(path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'),
      firstProjection.rollingPlanSource);
    runGit(fixture.repositoryRoot, ['switch', '--quiet', '-c', 'candidate-old-main']);
    runGit(fixture.repositoryRoot, ['add', '.']);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'candidate source generation']);
    await writeFile(manifestFile, Buffer.concat([firstManifest, Buffer.from('\nCandidate refresh.\n')]));
    await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-21'
    });
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '--amend', '--no-edit']);
    const oldCandidateManifest = await readFile(manifestFile, 'utf8');
    const oldCandidatePointer = await readFile(path.join(fixture.repositoryRoot, POINTER_PATH), 'utf8');
    const oldCandidateRolling = await readFile(
      path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'), 'utf8'
    );

    runGit(fixture.repositoryRoot, ['switch', '--quiet', 'main']);
    await writeFile(path.join(fixture.repositoryRoot, 'unrelated-main.txt'), 'independent main work\n');
    runGit(fixture.repositoryRoot, ['add', 'unrelated-main.txt']);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'unrelated main work']);
    runGit(fixture.repositoryRoot, ['push', '--quiet', 'origin', 'main']);
    const newMainSha = runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD']);
    const newMainTree = runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD^{tree}']);

    runGit(fixture.repositoryRoot, ['switch', '--quiet', '-c', 'candidate-new-main']);
    await writeFile(manifestFile,
      oldCandidateManifest.replace(`base: ${oldMainSha}`, `base: ${newMainSha}`));
    await writeFile(path.join(fixture.repositoryRoot, POINTER_PATH), oldCandidatePointer);
    await writeFile(path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'),
      oldCandidateRolling);
    runGit(fixture.repositoryRoot, ['rm', '--quiet', CURRENT_ACTIVE_PATH]);
    runGit(fixture.repositoryRoot, ['add', '.']);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'rebase candidate control generation']);

    const rebound = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-22'
    });
    expect(rebound).toMatchObject({
      status: 'ACTIVATED_INDEX_PENDING_COMMIT',
      baseSha: newMainSha,
      baseTreeSha: newMainTree,
      candidateHeadSha: null
    });
    expect(await readFile(path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'), 'utf8'))
      .toContain(`"exactMain": "${newMainSha}"`);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '--amend', '--no-edit']);

    runGit(fixture.repositoryRoot, ['switch', '--quiet', 'main']);
    const selectionPath = path.join(fixture.repositoryRoot, 'config/repository/work-selection.md');
    const selectionBytes = await readFile(selectionPath);
    await writeFile(selectionPath, Buffer.concat([selectionBytes, Buffer.from('\nTransient control change.\n')]));
    runGit(fixture.repositoryRoot, ['add', 'config/repository/work-selection.md']);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'change work selection']);
    await writeFile(selectionPath, selectionBytes);
    runGit(fixture.repositoryRoot, ['add', 'config/repository/work-selection.md']);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'restore work selection bytes']);
    runGit(fixture.repositoryRoot, ['push', '--quiet', 'origin', 'main']);
    const abaMainSha = runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD']);
    runGit(fixture.repositoryRoot, ['switch', '--quiet', '-c', 'candidate-aba']);
    await writeFile(manifestFile,
      oldCandidateManifest.replace(`base: ${oldMainSha}`, `base: ${abaMainSha}`));
    await writeFile(path.join(fixture.repositoryRoot, POINTER_PATH), oldCandidatePointer);
    await writeFile(path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'),
      oldCandidateRolling);
    runGit(fixture.repositoryRoot, ['rm', '--quiet', CURRENT_ACTIVE_PATH]);
    runGit(fixture.repositoryRoot, ['add', '.']);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'candidate after control ABA']);
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-23'
    })).rejects.toThrow('do not equal the exact published live-default projection');
  });
}, 90_000);

test('committed candidate replan repairs one ancestry-proven published control projection drift', async () => {
  await withFreezeFixture(async (fixture) => {
    const manifestFile = path.join(fixture.repositoryRoot, ...FREEZE_TARGET_PATH.split('/'));
    await writeFile(
      path.join(fixture.repositoryRoot, CURRENT_STATE_PATH),
      currentStateSource(),
      'utf8'
    );
    // The published-selection base must not inherit createFreezeFixture's
    // staged successor topology. The transition is introduced only by the
    // candidate generation below; otherwise this is an unbound published path,
    // not an ancestry-proven repair fixture.
    runGit(fixture.repositoryRoot, [
      'reset',
      '--quiet',
      'HEAD',
      '--',
      FREEZE_TARGET_PATH,
      CURRENT_ACTIVE_PATH
    ]);
    const selectionBaseSha = runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD']);
    const exactMainTree = runGit(fixture.repositoryRoot, ['rev-parse', `${selectionBaseSha}^{tree}`]);
    const firstManifest = Buffer.from(
      (await readFile(manifestFile, 'utf8')).replace(`base: ${fixture.baseSha}`, `base: ${selectionBaseSha}`),
      'utf8'
    );
    await writeFile(manifestFile, firstManifest);
    const firstProjection = createFreezeProjection({
      spec: parseCurrentStateSpec(currentStateSource()),
      currentPointerSource: await readFile(path.join(fixture.repositoryRoot, POINTER_PATH), 'utf8'),
      currentRollingPlanSource: rollingPlanSource(),
      currentManifestBytes: Buffer.from(currentActiveManifestSource(), 'utf8'),
      workSelectionProjection: {
        receipt: workSelectionReceiptFixture({ exactMain: selectionBaseSha, exactMainTree })
      },
      manifestPath: FREEZE_TARGET_PATH,
      manifestBytes: firstManifest,
      baseSha: selectionBaseSha,
      baseTreeSha: exactMainTree,
      reviewedOn: '2026-08-21'
    });
    await writeFile(path.join(fixture.repositoryRoot, POINTER_PATH), firstProjection.pointerSource, 'utf8');
    await writeFile(
      path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'),
      firstProjection.rollingPlanSource,
      'utf8'
    );
    runGit(fixture.repositoryRoot, ['switch', '--quiet', '-c', 'candidate-transition']);
    runGit(fixture.repositoryRoot, ['add', '.']);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'candidate source generation']);
    const sourceHead = runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD']);

    await writeFile(manifestFile, Buffer.concat([
      firstManifest,
      Buffer.from('\nExact candidate generation refresh.\n', 'utf8')
    ]));
    await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-21'
    });
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '--amend', '--no-edit']);
    expect(runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD^'])).toBe(selectionBaseSha);
    expect(await readFile(
      path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'),
      'utf8'
    )).toContain(`"sourceHead": "${sourceHead}"`);

    runGit(fixture.repositoryRoot, ['switch', '--quiet', 'main']);
    runGit(fixture.repositoryRoot, ['merge', '--quiet', '--squash', 'candidate-transition']);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'publish transition projection']);
    const driftedDefaultManifest = Buffer.concat([
      await readFile(manifestFile),
      Buffer.from('\nIndependent main manifest drift.\n', 'utf8')
    ]);
    await writeFile(manifestFile, driftedDefaultManifest);
    await writeFile(
      path.join(fixture.repositoryRoot, POINTER_PATH),
      activePointerSource(FREEZE_TARGET_PATH, driftedDefaultManifest),
      'utf8'
    );
    runGit(fixture.repositoryRoot, ['add', FREEZE_TARGET_PATH, POINTER_PATH]);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'drift published manifest and pointer']);
    runGit(fixture.repositoryRoot, ['push', '--quiet', 'origin', 'main']);
    const liveDefaultSha = runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD']);
    const liveDefaultTree = runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD^{tree}']);

    runGit(fixture.repositoryRoot, ['switch', '--quiet', '-c', 'candidate-repair']);
    const driftedManifest = await readFile(manifestFile, 'utf8');
    await writeFile(
      manifestFile,
      `${driftedManifest.replace(`base: ${selectionBaseSha}`, `base: ${liveDefaultSha}`)}\nRepair generation.\n`,
      'utf8'
    );
    runGit(fixture.repositoryRoot, ['add', FREEZE_TARGET_PATH]);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'repair projection generation']);

    const publishedRolling = readGitBlob(
      fixture.repositoryRoot,
      `${liveDefaultSha}:config/repository/rolling-plan.md`
    )!;
    await writeFile(
      path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'),
      Buffer.concat([publishedRolling, Buffer.from('\nCandidate-only alternate publication claim.\n', 'utf8')])
    );
    runGit(fixture.repositoryRoot, ['add', 'config/repository/rolling-plan.md']);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '--amend', '--no-edit']);
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-22'
    })).rejects.toThrow('do not equal the exact published live-default projection');
    await writeFile(
      path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'),
      publishedRolling
    );
    runGit(fixture.repositoryRoot, ['add', 'config/repository/rolling-plan.md']);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '--amend', '--no-edit']);

    const repaired = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-22'
    });
    expect(repaired).toMatchObject({
      status: 'ACTIVATED_INDEX_PENDING_COMMIT',
      baseSha: liveDefaultSha,
      baseTreeSha: liveDefaultTree,
      candidateHeadSha: null
    });
    const repairedManifest = readGitBlob(fixture.repositoryRoot, `:${FREEZE_TARGET_PATH}`)!;
    const repairedPointer = parseActivePointer(
      await readFile(path.join(fixture.repositoryRoot, POINTER_PATH), 'utf8')
    );
    expect<string>(repairedPointer.manifestDigest)
      .toBe(CodexDevelopmentWorkPackageManifestDigest(repairedManifest));
    const repairedRolling = await readFile(
      path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'),
      'utf8'
    );
    expect(repairedRolling).toContain(`"exactMain": "${liveDefaultSha}"`);
    expect(repairedRolling).toContain(`"exactMainTree": "${liveDefaultTree}"`);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
  });
}, 60_000);

test('committed candidate replan rejects a stacked generation', async () => {
  await withFreezeFixture(async (fixture) => {
    await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '-m', 'candidate generation']);
    runGit(fixture.repositoryRoot, ['commit', '--quiet', '--allow-empty', '-m', 'stacked generation']);
    const manifestPath = path.join(fixture.repositoryRoot, ...FREEZE_TARGET_PATH.split('/'));
    await writeFile(manifestPath, Buffer.concat([
      await readFile(manifestPath),
      Buffer.from('\nUntrusted stacked replan.\n', 'utf8')
    ]));
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('sole parent is the live default');
  });
}, 30_000);

for (const faultAfter of [
  'after-journal-prepare',
  'after-index-lock-write',
  'after-index-publish',
  'after-pointer-temp-write',
  'after-pointer-publish',
  'after-rolling-temp-write',
  'after-rolling-publish'
] as const satisfies readonly FreezeFault[]) {
  test(`nonterminal ${faultAfter} remains unresolved and recovers only by rolling forward`, async () => {
    await withFreezeFixture(async (fixture) => {
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        faultAfter
      })).rejects.toThrow(`Injected document control freeze fault: ${faultAfter}`);
      const originalJournal = JSON.parse(await readFile(
        path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE, 'journal.json'),
        'utf8'
      )) as RecoveryJournalView;
      if (process.platform === 'win32' && faultAfter === 'after-index-lock-write') {
        const indexPath = repositoryIndexPath(fixture.repositoryRoot);
        const artifactRoot = path.dirname(indexPath);
        expect(await readOptionalEntrySnapshot(indexPath)).toMatchObject({
          present: true, bytes: originalJournal.index.pre
        });
        expect(await readOptionalEntrySnapshot(`${indexPath}.lock`)).toMatchObject({
          present: true, bytes: originalJournal.index.next
        });
        for (const suffix of ['pre', 'retired-pre', 'retired-next'] as const) {
          expect(await readOptionalEntrySnapshot(entryRecoveryPathForTest(
            artifactRoot, 'git-index', originalJournal.operationId, suffix
          ))).toMatchObject({ present: false, bytes: null });
        }
      }
      const midPhase = await resolveLiveControlPlane(fixture.repositoryRoot);
      expect(midPhase.activeWorkPackage).toEqual({
        state: 'unresolved',
        reason: 'activation-in-progress'
      });
      expect(midPhase.github).toMatchObject({
        status: 'unresolved',
        reason: expect.stringContaining('activation is nonterminal')
      });
      if (faultAfter === 'after-pointer-publish') {
        const beforeWrongLane = await readFreezeEffectSnapshot(fixture.repositoryRoot);
        await expect(freezeDocumentControlPlane({
          cwd: fixture.repositoryRoot,
          manifestPath: FREEZE_TARGET_PATH,
          reviewedOn: '2026-08-09',
          proposalOnly: true
        })).rejects.toThrow('belongs to another authoring disposition');
        expect(await readFreezeEffectSnapshot(fixture.repositoryRoot)).toEqual(beforeWrongLane);
      }
      const recovered = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
      expect(recovered.operationId).toBe(originalJournal.operationId);
      expect(recovered.candidateTreeSha).toBe(originalJournal.candidateTreeSha);
      expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(originalJournal.candidateTreeSha);
      await expectFreezeTransactionRetired(fixture.repositoryRoot);
    });
  }, 30_000);
}

type RecoveryJournalView = Readonly<{
  schema: 'sec-document-control-plane-freeze-journal-v4';
  operationId: `sha256:${string}`;
  phase: string;
  candidateTreeSha: string;
  files: Readonly<{
    pointer: Readonly<{ pre: string; next: string }>;
    rollingPlan: Readonly<{ pre: string; next: string }>;
  }>;
  index: Readonly<{ pre: string; next: string }>;
  indexTransportDigest: `sha256:${string}`;
  result: FreezeResult;
}>;

const JOURNAL_TRANSACTION_RELATIVE = '.tmp/codex/document-control-plane-freeze-v1';
const JOURNAL_ACTIVE_NEXT = /^journal\.json\.([0-9a-f]{64})\.(prepared|index-published|pointer-published|rolling-published|terminal)\.next$/u;
const FREEZE_ENTRY_RECOVERY_NAME_FOR_TEST = /^\.entry-[0-9a-f]{64}\.(pre|retired-pre|retired-next)$/u;

function entryRecoveryPathForTest(
  transactionRoot: string,
  targetKey: DocumentControlRecoveryTargetKey,
  operationId: string,
  suffix: 'pre' | 'retired-pre' | 'retired-next'
): string {
  const stem = documentControlRecoveryEntryStem({ operationId, targetKey });
  return path.join(transactionRoot, `${stem}.${suffix}`);
}

function journalRetiredNextPath(
  transactionRoot: string,
  nextBytes: Uint8Array
): string {
  return entryRecoveryPathForTest(
    transactionRoot,
    'freeze-journal',
    `sha256:${digest(nextBytes)}`,
    'retired-next'
  );
}

async function expectLinuxExactS1(input: {
  artifactRoot: string;
  targetPath: string;
  targetKey: DocumentControlRecoveryTargetKey;
  operationId: string;
  expectedPre: Uint8Array;
}): Promise<Readonly<{
  quarantinePath: string;
  retiredPrePath: string;
  retiredNextPath: string;
}>> {
  expect(process.platform).toBe('linux');
  const quarantinePath = entryRecoveryPathForTest(input.artifactRoot, input.targetKey, input.operationId, 'pre');
  const retiredPrePath = entryRecoveryPathForTest(
    input.artifactRoot,
    input.targetKey,
    input.operationId,
    'retired-pre'
  );
  const retiredNextPath = entryRecoveryPathForTest(
    input.artifactRoot,
    input.targetKey,
    input.operationId,
    'retired-next'
  );
  expect(await readFile(input.targetPath)).toEqual(Buffer.from(input.expectedPre));
  expect(await readFile(quarantinePath)).toEqual(Buffer.from(input.expectedPre));
  const targetMetadata = await lstat(input.targetPath);
  const quarantineMetadata = await lstat(quarantinePath);
  expect({ dev: quarantineMetadata.dev, ino: quarantineMetadata.ino }).toEqual({
    dev: targetMetadata.dev,
    ino: targetMetadata.ino
  });
  await expect(readFile(retiredPrePath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(retiredNextPath)).rejects.toMatchObject({ code: 'ENOENT' });
  return Object.freeze({ quarantinePath, retiredPrePath, retiredNextPath });
}

function repositoryIndexPath(repositoryRoot: string): string {
  const candidate = runGit(repositoryRoot, ['rev-parse', '--git-path', 'index']);
  return path.isAbsolute(candidate) ? candidate : path.resolve(repositoryRoot, candidate);
}

async function readSingleActiveJournalRecovery(repositoryRoot: string): Promise<Readonly<{
  transactionRoot: string;
  name: string;
  filePath: string;
  bytes: Buffer;
  journal: RecoveryJournalView;
}>> {
  const transactionRoot = path.join(repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
  const names = (await readdir(transactionRoot)).filter((name) => JOURNAL_ACTIVE_NEXT.test(name));
  expect(names).toHaveLength(1);
  const name = names[0]!;
  const filePath = path.join(transactionRoot, name);
  const bytes = await readFile(filePath);
  const journal = JSON.parse(bytes.toString('utf8')) as RecoveryJournalView;
  expect(bytes).toEqual(Buffer.from(`${JSON.stringify(journal, null, 2)}\n`, 'utf8'));
  expect(JOURNAL_ACTIVE_NEXT.exec(name)![1]).toBe(journal.operationId.slice('sha256:'.length));
  expect(JOURNAL_ACTIVE_NEXT.exec(name)![2]).toBe(journal.phase);
  return Object.freeze({ transactionRoot, name, filePath, bytes, journal });
}

async function readEntryRecoveryByteSnapshot(transactionRoot: string): Promise<readonly Readonly<{
  name: string;
  bytes: string;
}>[]> {
  const names = (await readdir(transactionRoot)).filter((name) => name.startsWith('.entry-')).sort();
  const snapshot: Array<Readonly<{ name: string; bytes: string }>> = [];
  for (const name of names) {
    snapshot.push(Object.freeze({
      name,
      bytes: (await readFile(path.join(transactionRoot, name))).toString('base64')
    }));
  }
  return Object.freeze(snapshot);
}

async function readDirectTransactionByteSnapshot(transactionRoot: string): Promise<readonly Readonly<{
  name: string;
  bytes: string;
}>[]> {
  const names = [...await readdir(transactionRoot).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[];
    throw error;
  })].sort();
  const snapshot: Array<Readonly<{ name: string; bytes: string }>> = [];
  for (const name of names) {
    snapshot.push(Object.freeze({
      name,
      bytes: (await readFile(path.join(transactionRoot, name))).toString('base64')
    }));
  }
  return Object.freeze(snapshot);
}

async function expectFreezeTransactionRetired(repositoryRoot: string): Promise<void> {
  const transactionRoot = path.join(repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
  await expect(lstat(transactionRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  const gitDirectory = path.dirname(repositoryIndexPath(repositoryRoot));
  expect((await readdir(gitDirectory)).filter((name) => name.startsWith('.entry-'))).toEqual([]);
}




bunTest.skipIf(process.platform !== 'linux')('production recovery preserves observed source and freeze state on refusal then resumes its exact journal operation', async () => {
  await withProposalFreezeFixture(async ({ fixture, proposalPath, proposalFile, proposalJournalPath }) => {
    await expect(freezeDocumentControlPlane({ cwd: fixture.repositoryRoot, manifestPath: proposalPath,
      reviewedOn: '2026-08-09', proposalOnly: true, faultAfter: 'after-pointer-publish' }))
      .rejects.toThrow('Injected document control freeze fault: after-pointer-publish.');
    const journal = JSON.parse(await readFile(proposalJournalPath, 'utf8')) as { operationId: `sha256:${string}`; candidateTreeSha: string };
    const originalManifest = await readFile(proposalFile);
    await writeFile(proposalFile, Buffer.concat([originalManifest, Buffer.from('\nCompeting request source.\n')]));
    const before = await readFreezeEffectSnapshot(fixture.repositoryRoot);
    const objectCensus = runGit(fixture.repositoryRoot, ['count-objects', '-v']);
    const changedManifest = await readFile(proposalFile);
    await expect(freezeDocumentControlPlane({ cwd: fixture.repositoryRoot, manifestPath: proposalPath,
      reviewedOn: '2026-08-09', proposalOnly: true })).rejects.toThrow('competing nonterminal');
    expect(await readFreezeEffectSnapshot(fixture.repositoryRoot)).toEqual(before);
    expect(runGit(fixture.repositoryRoot, ['count-objects', '-v'])).toBe(objectCensus);
    expect(await readFile(proposalFile)).toEqual(changedManifest);
    // This is explicit fixture restoration after proved refusal, never cleanup
    // that masks an unknown writer effect or replaces the interrupted journal.
    await writeFile(proposalFile, originalManifest);
    const recovered = await freezeDocumentControlPlane({ cwd: fixture.repositoryRoot, manifestPath: proposalPath,
      reviewedOn: '2026-08-09', proposalOnly: true });
    expect(recovered.operationId).toBe(journal.operationId);
    expect(recovered.candidateTreeSha).toBe(journal.candidateTreeSha);
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(journal.candidateTreeSha);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
  });
}, 90_000);

bunTest('production first and revised proposals publish exact state and retire their terminal transactions', async () => {
  await withProposalFreezeFixture(async ({ fixture, proposalPath, proposalFile }) => {
    const first = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: proposalPath,
      reviewedOn: '2026-08-09',
      proposalOnly: true
    });
    expect(first.status).toBe('PROPOSED');
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(first.candidateTreeSha);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);

    const revisedBytes = Buffer.concat([
      await readFile(proposalFile), Buffer.from('\nRevised production proposal.\n')
    ]);
    await writeFile(proposalFile, revisedBytes);
    const revised = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: proposalPath,
      reviewedOn: '2026-08-09',
      proposalOnly: true
    });
    expect(revised.status).toBe('PROPOSED');
    expect(revised.operationId).not.toBe(first.operationId);
    expect(revised.manifestPath).toBe(proposalPath);
    expect(revised.manifestDigest).not.toBe(first.manifestDigest);
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(revised.candidateTreeSha);
    expect(readGitBlob(fixture.repositoryRoot, `:${proposalPath}`)).toEqual(revisedBytes);
    expect(parseActivePointer(
      await readFile(path.join(fixture.repositoryRoot, POINTER_PATH), 'utf8')
    )).toMatchObject({ manifest: proposalPath, manifestDigest: revised.manifestDigest });
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
  });
}, 90_000);

bunTest('terminal retirement preserves its journal when the manifest changes between sessions', async () => {
  await withProposalFreezeFixture(async ({ fixture, proposalFile, proposalJournalPath, proposalPath }) => {
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: proposalPath,
      reviewedOn: '2026-08-09',
      proposalOnly: true,
      beforeTerminalRetirement: async () => {
        await writeFile(proposalFile, Buffer.concat([
          await readFile(proposalFile), Buffer.from('\nConcurrent manifest change.\n')
        ]));
      }
    })).rejects.toThrow('Terminal freeze continuation no longer matches the manifest or review date.');
    const journal = JSON.parse(await readFile(proposalJournalPath, 'utf8')) as { phase: string };
    expect(journal.phase).toBe('terminal');
  });
}, 90_000);

async function readFreezeEffectSnapshot(repositoryRoot: string): Promise<Readonly<{
  transaction: readonly Readonly<{ name: string; bytes: string }>[];
  index: string;
  pointer: string;
  rollingPlan: string;
}>> {
  return Object.freeze({
    transaction: await readDirectTransactionByteSnapshot(path.join(repositoryRoot, JOURNAL_TRANSACTION_RELATIVE)),
    index: (await readFile(repositoryIndexPath(repositoryRoot))).toString('base64'),
    pointer: (await readFile(path.join(repositoryRoot, POINTER_PATH))).toString('base64'),
    rollingPlan: (await readFile(path.join(repositoryRoot, 'config/repository/rolling-plan.md'))).toString('base64')
  });
}

async function readOptionalEntrySnapshot(filePath: string): Promise<Readonly<{
  present: boolean;
  bytes: string | null;
  dev: number | null;
  ino: number | null;
}>> {
  try {
    const [bytes, metadata] = await Promise.all([readFile(filePath), lstat(filePath)]);
    return Object.freeze({
      present: true,
      bytes: bytes.toString('base64'),
      dev: metadata.dev,
      ino: metadata.ino
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return Object.freeze({ present: false, bytes: null, dev: null, ino: null });
  }
}

async function writeOptionalEntry(filePath: string, bytes: Buffer | null): Promise<void> {
  if (bytes === null) {
    await unlink(filePath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
}

interface PublishTupleFixture {
  readonly fixture: FreezeFixture;
  readonly journal: RecoveryJournalView;
  readonly paths: Readonly<{
    target: string;
    next: string;
    quarantine: string;
    retiredPre: string;
    retiredNext: string;
    journal: string;
  }>;
  readonly pre: Buffer;
  readonly next: Buffer;
}

async function prepareIndexPublishTupleFixture(): Promise<PublishTupleFixture> {
  const fixture = await createFreezeFixture();
  try {
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-journal-prepare'
    })).rejects.toThrow('after-journal-prepare');
    const journalPath = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE, 'journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalView;
    const indexPath = repositoryIndexPath(fixture.repositoryRoot);
    const artifactRoot = path.dirname(indexPath);
    const operationId = journal.operationId;
    return Object.freeze({
      fixture,
      journal,
      paths: Object.freeze({
        target: indexPath,
        next: `${indexPath}.lock`,
        quarantine: entryRecoveryPathForTest(artifactRoot, 'git-index', operationId, 'pre'),
        retiredPre: entryRecoveryPathForTest(artifactRoot, 'git-index', operationId, 'retired-pre'),
        retiredNext: entryRecoveryPathForTest(artifactRoot, 'git-index', operationId, 'retired-next'),
        journal: journalPath
      }),
      pre: Buffer.from(journal.index.pre, 'base64'),
      next: Buffer.from(journal.index.next, 'base64')
    });
  } catch (error) {
    try { await fixture.dispose(); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Index tuple preparation and cleanup both failed');
    }
    throw error;
  }
}

async function withIndexPublishTupleFixture<T>(
  operation: (prepared: PublishTupleFixture) => Promise<T>
): Promise<T> {
  const prepared = await prepareIndexPublishTupleFixture();
  return settleWorkspaceCallback(() => operation(prepared), async () => {
    await prepared.fixture.dispose();
  });
}

async function writePublishTuple(
  prepared: PublishTupleFixture,
  entries: Readonly<{
    target: Buffer | null;
    next: Buffer | null;
    quarantine: Buffer | null;
    retiredPre: Buffer | null;
    retiredNext: Buffer | null;
  }>
): Promise<void> {
  // Partial tuple setup must not leave another writer active when a rejecting
  // test begins inspecting failure residue or disposes its native repository.
  const settled = await Promise.allSettled([
    writeOptionalEntry(prepared.paths.target, entries.target),
    writeOptionalEntry(prepared.paths.next, entries.next),
    writeOptionalEntry(prepared.paths.quarantine, entries.quarantine),
    writeOptionalEntry(prepared.paths.retiredPre, entries.retiredPre),
    writeOptionalEntry(prepared.paths.retiredNext, entries.retiredNext)
  ]);
  const failures = settled.flatMap(result =>
    result.status === 'rejected' ? [result.reason] : []);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Document control tuple writers failed');
  }
}

async function readPreEffectTupleSnapshot(prepared: PublishTupleFixture): Promise<Readonly<{
  tuple: Readonly<Record<'target' | 'next' | 'quarantine' | 'retiredPre' | 'retiredNext', Awaited<ReturnType<typeof readOptionalEntrySnapshot>>>>;
  index: Awaited<ReturnType<typeof readOptionalEntrySnapshot>>;
  pointer: Awaited<ReturnType<typeof readOptionalEntrySnapshot>>;
  rollingPlan: Awaited<ReturnType<typeof readOptionalEntrySnapshot>>;
  journal: Awaited<ReturnType<typeof readOptionalEntrySnapshot>>;
}>> {
  const indexPath = repositoryIndexPath(prepared.fixture.repositoryRoot);
  return Object.freeze({
    tuple: Object.freeze({
      target: await readOptionalEntrySnapshot(prepared.paths.target),
      next: await readOptionalEntrySnapshot(prepared.paths.next),
      quarantine: await readOptionalEntrySnapshot(prepared.paths.quarantine),
      retiredPre: await readOptionalEntrySnapshot(prepared.paths.retiredPre),
      retiredNext: await readOptionalEntrySnapshot(prepared.paths.retiredNext)
    }),
    index: await readOptionalEntrySnapshot(indexPath),
    pointer: await readOptionalEntrySnapshot(path.join(prepared.fixture.repositoryRoot, POINTER_PATH)),
    rollingPlan: await readOptionalEntrySnapshot(path.join(prepared.fixture.repositoryRoot, 'config/repository/rolling-plan.md')),
    journal: await readOptionalEntrySnapshot(prepared.paths.journal)
  });
}

async function expectPreEffectTupleRejection(prepared: PublishTupleFixture): Promise<void> {
  const before = await readPreEffectTupleSnapshot(prepared);
  const durability: DurabilityEvent[] = [];
  const renames: unknown[] = [];
  const creates: unknown[] = [];
  const cleanups: unknown[] = [];
  await expect(freezeDocumentControlPlane({
    cwd: prepared.fixture.repositoryRoot,
    manifestPath: FREEZE_TARGET_PATH,
    reviewedOn: '2026-08-09',
    durabilityObserver: (event) => { durability.push(event); },
    beforeAnchoredRename: (event) => { renames.push(event); },
    beforeAnchoredCreate: (event) => { creates.push(event); },
    beforeAnchoredCleanup: (event) => { cleanups.push(event); }
  })).rejects.toThrow(/recovery tuple is not a legal pre-effect state/u);
  expect(await readPreEffectTupleSnapshot(prepared)).toEqual(before);
  expect(durability).toEqual([]);
  expect(renames).toEqual([]);
  expect(creates).toEqual([]);
  expect(cleanups).toEqual([]);
}

for (const invalidCase of [
  {
    name: 'PRE target coexists with quarantine while NEXT is absent',
    entries: (prepared: PublishTupleFixture) => ({
      target: prepared.pre,
      next: null,
      quarantine: prepared.pre,
      retiredPre: null,
      retiredNext: null
    })
  },
  {
    name: 'target and NEXT are absent with an orphan quarantine',
    entries: (prepared: PublishTupleFixture) => ({
      target: null,
      next: null,
      quarantine: prepared.pre,
      retiredPre: null,
      retiredNext: null
    })
  }
] as const) {
  test(`pre-effect tuple rejects ${invalidCase.name} without any publisher effect`, async () => {
    await withIndexPublishTupleFixture(async (prepared) => {
      await writePublishTuple(prepared, invalidCase.entries(prepared));
      await expectPreEffectTupleRejection(prepared);
    });
  }, 60_000);
}

if (process.platform === 'win32') {
  for (const stateCase of [
    { name: 'W1', faultAfter: 'after-index-pre-quarantine' },
    { name: 'W2', faultAfter: 'after-index-next-install' }
  ] as const satisfies readonly Readonly<{
    name: string;
    faultAfter: FreezeFault;
  }>[]) {
    test(`Windows entry CAS state ${stateCase.name} is recoverable under its retained-entry semantics`, async () => {
      await withIndexPublishTupleFixture(async (prepared) => {
        expect(await readFile(prepared.paths.target)).toEqual(prepared.pre);
        await expect(freezeDocumentControlPlane({
          cwd: prepared.fixture.repositoryRoot,
          manifestPath: FREEZE_TARGET_PATH,
          reviewedOn: '2026-08-09',
          faultAfter: stateCase.faultAfter
        })).rejects.toThrow(stateCase.faultAfter);
        const tuple = await readPreEffectTupleSnapshot(prepared);
        expect(tuple.tuple).toMatchObject({
          target: stateCase.name === 'W1'
            ? { present: false, bytes: null }
            : { present: true, bytes: prepared.next.toString('base64') },
          next: stateCase.name === 'W1'
            ? { present: true, bytes: prepared.next.toString('base64') }
            : { present: false, bytes: null },
          quarantine: { present: true, bytes: prepared.pre.toString('base64') },
          retiredPre: { present: false, bytes: null },
          retiredNext: { present: false, bytes: null }
        });
        const recovered = await freezeDocumentControlPlane({
          cwd: prepared.fixture.repositoryRoot,
          manifestPath: FREEZE_TARGET_PATH,
          reviewedOn: '2026-08-09'
        });
        expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
        expect(recovered.operationId).toBe(prepared.journal.operationId);
        expect(recovered.candidateTreeSha).toBe(prepared.journal.candidateTreeSha);
        expect(runGit(prepared.fixture.repositoryRoot, ['write-tree']))
          .toBe(prepared.journal.candidateTreeSha);
        await expectFreezeTransactionRetired(prepared.fixture.repositoryRoot);
      });
    }, 60_000);
  }

  test('Windows terminal-Q cleanup rejects a NEXT that appears after tuple classification', async () => {
    await withIndexPublishTupleFixture(async (prepared) => {
      let injected = false;
      await expect(freezeDocumentControlPlane({
        cwd: prepared.fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        faultAfter: 'after-index-next-install'
      })).rejects.toThrow('after-index-next-install');
      const before = await readPreEffectTupleSnapshot(prepared);
      expect(before.tuple.target.bytes).toBe(prepared.next.toString('base64'));
      expect(before.tuple.next.present).toBe(false);
      expect(before.tuple.quarantine.bytes).toBe(prepared.pre.toString('base64'));
      await expect(freezeDocumentControlPlane({
        cwd: prepared.fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        beforeAnchoredCleanup: async (event) => {
          if (injected || event.label !== 'Git index exact PRE quarantine cleanup') return;
          injected = true;
          await writeFile(prepared.paths.next, prepared.next);
        }
      })).rejects.toThrow('Git index recovery tuple is not a legal pre-effect state; preserving every entry.');
      expect(injected).toBe(true);
      const after = await readPreEffectTupleSnapshot(prepared);
      expect(after.tuple.target).toEqual(before.tuple.target);
      expect(after.tuple.next.bytes).toBe(prepared.next.toString('base64'));
      expect(after.tuple.quarantine.present).toBe(false);
    });
  }, 60_000);

  test('Windows W3 preserves a later active NEXT without cleanup or publisher effects', async () => {
    await withIndexPublishTupleFixture(async (prepared) => {
      await freezeDocumentControlPlane({
        cwd: prepared.fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      await writeFile(prepared.paths.next, prepared.next);
      const before = await readPreEffectTupleSnapshot(prepared);
      const durability: DurabilityEvent[] = [];
      const cleanups: unknown[] = [];
      await expect(freezeDocumentControlPlane({
        cwd: prepared.fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        durabilityObserver: (event) => { durability.push(event); },
        beforeAnchoredCleanup: (event) => { cleanups.push(event); }
      })).rejects.toThrow('Document control freeze found an active Git index lock; preserving it.');
      expect(await readPreEffectTupleSnapshot(prepared)).toEqual(before);
      const journalRecoveryDurability = durability.filter((event) => (
        event.label === 'Freeze journal recovery durability journal.json'
      ));
      expect(journalRecoveryDurability.map((event) => event.stage)).toEqual([]);
      expect(durability.filter((event) => !journalRecoveryDurability.includes(event))).toEqual([]);
      expect(cleanups).toEqual([]);
    });
  }, 60_000);

  test('Windows retained rename flush rejects a post-namespace replacement without a follow-on edge', async () => {
    await withFreezeFixture(async (fixture) => {
      const replacement = Buffer.from('replacement pointer after namespace mutation\n', 'utf8');
      const pointerRenameLabels: string[] = [];
      const pointerStages: DurabilityEvent['stage'][] = [];
      let replacementPath: string | undefined;
      let heldPublishedPath: string | undefined;
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        durabilityObserver: (event) => {
          if (event.label === 'Active pointer NEXT install') pointerStages.push(event.stage);
        },
        beforeAnchoredRename: (event) => {
          if (event.label.startsWith('Active pointer ')) pointerRenameLabels.push(event.label);
        },
        afterAnchoredNamespaceMutationBeforeFlush: async (event) => {
          if (replacementPath !== undefined || event.label !== 'Active pointer NEXT install') return;
          replacementPath = event.targetPath;
          heldPublishedPath = `${event.targetPath}.retained-flush-held`;
          await rename(event.targetPath, heldPublishedPath);
          await writeFile(event.targetPath, replacement);
        }
      })).rejects.toBeInstanceOf(UnsafeAnchoredPathError);
      expect(replacementPath).toBeDefined();
      expect(heldPublishedPath).toBeDefined();
      const journal = JSON.parse(await readFile(
        path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE, 'journal.json'),
        'utf8'
      )) as { files: { pointer: { next: string } } };
      expect(await readFile(replacementPath!)).toEqual(replacement);
      expect(await readFile(heldPublishedPath!)).toEqual(Buffer.from(journal.files.pointer.next, 'base64'));
      expect(pointerStages).toEqual(['renamed']);
      expect(pointerRenameLabels).toEqual(['Active pointer PRE quarantine', 'Active pointer NEXT install']);
    });
  }, 60_000);
}

if (process.platform === 'linux') {
  const linuxInvalidTupleCases: readonly Readonly<{
    name: string;
    setup(prepared: PublishTupleFixture): Promise<void>;
  }>[] = [
    {
      name: 'T=PRE with active NEXT and RN',
      async setup(prepared) {
        await writePublishTuple(prepared, {
          target: prepared.pre, next: prepared.next, quarantine: null,
          retiredPre: null, retiredNext: prepared.next
        });
      }
    },
    {
      name: 'T=PRE with RN but no NEXT',
      async setup(prepared) {
        await writePublishTuple(prepared, {
          target: prepared.pre, next: null, quarantine: null,
          retiredPre: null, retiredNext: prepared.next
        });
      }
    },
    {
      name: 'target absent with N and RN while Q is linked to RP',
      async setup(prepared) {
        await writePublishTuple(prepared, {
          target: null, next: prepared.next, quarantine: prepared.pre,
          retiredPre: null, retiredNext: prepared.next
        });
        await link(prepared.paths.quarantine, prepared.paths.retiredPre);
      }
    },
    {
      name: 'S1 with same-byte target and quarantine from different objects',
      async setup(prepared) {
        await writePublishTuple(prepared, {
          target: prepared.pre, next: prepared.next, quarantine: prepared.pre,
          retiredPre: null, retiredNext: null
        });
      }
    },
    {
      name: 'S2 with same-byte Q and RP from different objects',
      async setup(prepared) {
        await writePublishTuple(prepared, {
          target: null, next: prepared.next, quarantine: prepared.pre,
          retiredPre: prepared.pre, retiredNext: null
        });
      }
    },
    {
      name: 'S3 with same-byte Q and RP from different objects',
      async setup(prepared) {
        await writePublishTuple(prepared, {
          target: prepared.next, next: prepared.next, quarantine: prepared.pre,
          retiredPre: prepared.pre, retiredNext: null
        });
        await unlink(prepared.paths.next);
        await link(prepared.paths.target, prepared.paths.next);
      }
    },
    {
      name: 'S4 with same-byte Q and RP from different objects',
      async setup(prepared) {
        await writePublishTuple(prepared, {
          target: prepared.next, next: null, quarantine: prepared.pre,
          retiredPre: prepared.pre, retiredNext: null
        });
        await link(prepared.paths.target, prepared.paths.retiredNext);
      }
    }
  ];
  for (const invalidCase of linuxInvalidTupleCases) {
    test(`pre-effect tuple Linux rejects ${invalidCase.name} without any publisher effect`, async () => {
      await withIndexPublishTupleFixture(async (prepared) => {
        await invalidCase.setup(prepared);
        await expectPreEffectTupleRejection(prepared);
      });
    }, 60_000);
  }
}

for (const recoveryCase of [
  {
    faultAfter: 'after-journal-index-published-pre-quarantine',
    phase: 'index-published'
  },
  {
    faultAfter: 'after-journal-pointer-published-pre-quarantine',
    phase: 'pointer-published'
  },
  {
    faultAfter: 'after-journal-rolling-published-pre-quarantine',
    phase: 'rolling-published'
  },
  {
    faultAfter: 'after-journal-terminal-pre-quarantine',
    phase: 'terminal'
  }
] as const satisfies readonly Readonly<{
  faultAfter: FreezeFault;
  phase: string;
}>[]) {
  test(`journal recovery census restores exact ${recoveryCase.phase} NEXT after PRE quarantine`, async () => {
    await withFreezeFixture(async (fixture) => {
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        faultAfter: recoveryCase.faultAfter
      })).rejects.toThrow(recoveryCase.faultAfter);
      const canonicalPath = path.join(
        fixture.repositoryRoot,
        JOURNAL_TRANSACTION_RELATIVE,
        'journal.json'
      );
      await expect(readFile(canonicalPath)).rejects.toMatchObject({ code: 'ENOENT' });
      const active = await readSingleActiveJournalRecovery(fixture.repositoryRoot);
      expect(active.journal.phase).toBe(recoveryCase.phase);

      const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
      expect(status.activeWorkPackage).toEqual({
        state: 'unresolved',
        reason: 'activation-in-progress'
      });
      expect(status.activation).toEqual({
        operationId: active.journal.operationId,
        phase: recoveryCase.phase,
        terminal: false
      });
      await expect(readFile(canonicalPath)).rejects.toMatchObject({ code: 'ENOENT' });

      const recovered = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.operationId).toBe(active.journal.operationId);
      expect(recovered.candidateTreeSha).toBe(active.journal.candidateTreeSha);
      expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(active.journal.candidateTreeSha);
      await expectFreezeTransactionRetired(fixture.repositoryRoot);
    });
  }, 60_000);
}

test('journal recovery census accepts the exact installed NEXT boundary and resumes one operation', async () => {
  await withFreezeFixture(async (fixture) => {
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-journal-index-published-next-install'
    })).rejects.toThrow('after-journal-index-published-next-install');
    const journalPath = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE, 'journal.json');
    const installedBytes = await readFile(journalPath);
    const installed = JSON.parse(installedBytes.toString('utf8')) as RecoveryJournalView;
    expect(installed.phase).toBe('index-published');
    const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
    expect(status.activation).toEqual({
      operationId: installed.operationId,
      phase: 'index-published',
      terminal: false
    });
    expect(status.continuation).toMatchObject({
      authority: 'observation-only',
      subject: { repositoryRoot: fixture.repositoryRoot, candidateTreeSha: null },
      changes: { state: 'unobserved', records: null },
      next: {
        owner: 'document-control', action: 'resume-freeze', operationId: installed.operationId,
        arguments: [
          'freeze', '--workspace', fixture.repositoryRoot, '--manifest', FREEZE_TARGET_PATH,
          '--reviewed-on', '2026-08-09', '--json'
        ]
      }
    });
    expect(projectDocumentControlPlaneStatusCli(status).continuation).toEqual(status.continuation);
    expect(await readFile(journalPath)).toEqual(installedBytes);
    const recovered = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(recovered.operationId).toBe(installed.operationId);
    expect(recovered.candidateTreeSha).toBe(installed.candidateTreeSha);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
    const indexPath = repositoryIndexPath(fixture.repositoryRoot);
    const indexLockPath = `${indexPath}.lock`;
    const installedIndexBytes = await readFile(indexPath);
    expect(installedIndexBytes).toEqual(Buffer.from(installed.index.next, 'base64'));
    const treeBeforeStatus = runGit(fixture.repositoryRoot, ['write-tree']);
    const indexBeforeStatus = await readFile(indexPath);
    const terminalStatus = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
    expect(terminalStatus.activation).toBeNull();
    expect(terminalStatus.continuation).toMatchObject({
      unobservedOwners: expect.arrayContaining(['development-commit-journal-census'])
    });
    expect(terminalStatus.continuation).not.toHaveProperty('next.arguments');
    expect(await readFile(indexPath)).toEqual(indexBeforeStatus);
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(treeBeforeStatus);
    const indexBeforeSecondFreeze = await readFile(indexPath);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
    let renameEffects = 0;
    let cleanupEffects = 0;
    const durabilityEffects: DurabilityEvent[] = [];
    const second = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      durabilityObserver: (event) => { durabilityEffects.push(event); },
      beforeAnchoredRename: () => { renameEffects += 1; },
      beforeAnchoredCleanup: () => { cleanupEffects += 1; }
    });
    expect(second).toMatchObject({
      baseSha: recovered.baseSha,
      baseTreeSha: recovered.baseTreeSha,
      candidateTreeSha: recovered.candidateTreeSha,
      manifestPath: recovered.manifestPath,
      manifestDigest: recovered.manifestDigest
    });
    expect(await readFile(indexPath)).toEqual(indexBeforeSecondFreeze);
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(installed.candidateTreeSha);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
    await expect(readFile(indexLockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(durabilityEffects).toEqual([]);
    expect(renameEffects).toBe(0);
    expect(cleanupEffects).toBe(0);
  });
}, 60_000);

if (process.platform === 'linux') {
  test('journal recovery census keeps terminal status in progress until exact active NEXT retirement', async () => {
    await withFreezeFixture(async (fixture) => {
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        faultAfter: 'after-journal-terminal-next-install'
      })).rejects.toThrow('after-journal-terminal-next-install');
      const journalPath = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE, 'journal.json');
      const terminalBytes = await readFile(journalPath);
      const terminalMetadata = await lstat(journalPath);
      const terminal = JSON.parse(terminalBytes.toString('utf8')) as RecoveryJournalView;
      expect(terminal.phase).toBe('terminal');
      const active = await readSingleActiveJournalRecovery(fixture.repositoryRoot);
      expect(active.bytes).toEqual(Buffer.from(terminalBytes));
      const activeMetadata = await lstat(active.filePath);
      expect({ dev: activeMetadata.dev, ino: activeMetadata.ino }).toEqual({
        dev: terminalMetadata.dev,
        ino: terminalMetadata.ino
      });
      const inProgress = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
      expect(inProgress.activeWorkPackage).toEqual({ state: 'unresolved', reason: 'activation-in-progress' });
      expect(inProgress.activation).toEqual({
        operationId: terminal.operationId,
        phase: 'terminal',
        terminal: false
      });

      const recovered = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered).toEqual(terminal.result);
      await expectFreezeTransactionRetired(fixture.repositoryRoot);
      const terminalStatus = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
      expect(terminalStatus.activation).toBeNull();
      const second = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(second).toMatchObject({
        candidateTreeSha: recovered.candidateTreeSha,
        manifestDigest: recovered.manifestDigest,
        manifestPath: recovered.manifestPath
      });
    });
  }, 60_000);
}

if (process.platform === 'linux') {
  test('journal later-phase census blocks a same-bytes initial retired NEXT inode replacement', async () => {
    await withFreezeFixture(async (fixture) => {
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        faultAfter: 'after-journal-index-published-next-install'
      })).rejects.toThrow('after-journal-index-published-next-install');
      const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
      const retiredNextNames = (await readdir(transactionRoot)).filter((name) => (
        /^\.entry-[0-9a-f]{64}\.retired-next$/u.test(name)
      ));
      const preparedRetiredNext: Readonly<{ filePath: string; bytes: Buffer }>[] = [];
      for (const name of retiredNextNames) {
        const filePath = path.join(transactionRoot, name);
        const bytes = await readFile(filePath);
        const journal = JSON.parse(bytes.toString('utf8')) as { phase?: unknown };
        if (journal.phase === 'prepared') preparedRetiredNext.push(Object.freeze({ filePath, bytes }));
      }
      expect(preparedRetiredNext).toHaveLength(1);
      const initialRetiredNext = preparedRetiredNext[0]!;
      const originalMetadata = await lstat(initialRetiredNext.filePath);
      await unlink(initialRetiredNext.filePath);
      await writeFile(initialRetiredNext.filePath, initialRetiredNext.bytes);
      const replacementMetadata = await lstat(initialRetiredNext.filePath);
      expect({ dev: replacementMetadata.dev, ino: replacementMetadata.ino }).not.toEqual({
        dev: originalMetadata.dev,
        ino: originalMetadata.ino
      });
      const residuesBefore = await readEntryRecoveryByteSnapshot(transactionRoot);

      await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
        .rejects.toThrow(/Linux freeze entry recovery identity is unprovable/u);
      expect(await readFile(initialRetiredNext.filePath)).toEqual(Buffer.from(initialRetiredNext.bytes));
      const preservedMetadata = await lstat(initialRetiredNext.filePath);
      expect({ dev: preservedMetadata.dev, ino: preservedMetadata.ino }).toEqual({
        dev: replacementMetadata.dev,
        ino: replacementMetadata.ino
      });
      expect(await readEntryRecoveryByteSnapshot(transactionRoot)).toEqual(residuesBefore);
    });
  }, 60_000);
}

if (process.platform === 'linux') {
  test('Linux S1 journal transition remains activation-in-progress and recovers the same candidate', async () => {
    await withFreezeFixture(async (fixture) => {
      const fault = new Error('Injected Linux journal S1 fault');
      let selectedHooks = 0;
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        afterExactPreRecoveryLink: (event) => {
          if (event.label !== 'Freeze journal index-published') return;
          selectedHooks += 1;
          throw fault;
        }
      })).rejects.toBe(fault);
      expect(selectedHooks).toBe(1);
      const active = await readSingleActiveJournalRecovery(fixture.repositoryRoot);
      expect(active.journal.phase).toBe('index-published');
      const journalPath = path.join(active.transactionRoot, 'journal.json');
      const canonicalBytes = await readFile(journalPath);
      const canonical = JSON.parse(canonicalBytes.toString('utf8')) as RecoveryJournalView;
      expect(canonical.phase).toBe('prepared');
      await expectLinuxExactS1({
        artifactRoot: active.transactionRoot,
        targetPath: journalPath,
        targetKey: 'freeze-journal',
        operationId: `sha256:${digest(active.bytes)}`,
        expectedPre: canonicalBytes
      });
      expect(await readFile(path.join(fixture.repositoryRoot, POINTER_PATH)))
        .toEqual(Buffer.from(active.journal.files.pointer.pre, 'base64'));
      expect(await readFile(path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md')))
        .toEqual(Buffer.from(active.journal.files.rollingPlan.pre, 'base64'));

      const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
      expect(status.activation).toEqual({
        operationId: active.journal.operationId,
        phase: 'index-published',
        terminal: false
      });
      const recovered = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.operationId).toBe(active.journal.operationId);
      expect(recovered.candidateTreeSha).toBe(active.journal.candidateTreeSha);
      await expectFreezeTransactionRetired(fixture.repositoryRoot);
      const repeated = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(repeated.candidateTreeSha).toBe(recovered.candidateTreeSha);
    });
  }, 60_000);

  test('Linux S1 pointer projection proves target identity and rolls the writeAtomicCas family forward', async () => {
    await withFreezeFixture(async (fixture) => {
      const fault = new Error('Injected Linux pointer S1 fault');
      let selectedHooks = 0;
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        afterExactPreRecoveryLink: (event) => {
          if (event.label !== 'Active pointer') return;
          selectedHooks += 1;
          throw fault;
        }
      })).rejects.toBe(fault);
      expect(selectedHooks).toBe(1);
      const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
      const journalPath = path.join(transactionRoot, 'journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalView;
      expect(journal.phase).toBe('index-published');
      const pointerPath = path.join(fixture.repositoryRoot, POINTER_PATH);
      await expectLinuxExactS1({
        artifactRoot: transactionRoot,
        targetPath: pointerPath,
        targetKey: 'active-pointer',
        operationId: journal.operationId,
        expectedPre: Buffer.from(journal.files.pointer.pre, 'base64')
      });
      expect(await readFile(path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md')))
        .toEqual(Buffer.from(journal.files.rollingPlan.pre, 'base64'));

      const beforeStatus = await readFreezeEffectSnapshot(fixture.repositoryRoot);
      const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
      expect(status.activation).toEqual({
        operationId: journal.operationId,
        phase: 'index-published',
        terminal: false
      });
      expect(await readFreezeEffectSnapshot(fixture.repositoryRoot)).toEqual(beforeStatus);
      const recovered = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.operationId).toBe(journal.operationId);
      expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(journal.candidateTreeSha);
      await expectFreezeTransactionRetired(fixture.repositoryRoot);
      const repeated = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(repeated.candidateTreeSha).toBe(recovered.candidateTreeSha);
    });
  }, 60_000);

  test('Linux S1 Git index recovery preserves PRE identity and completes without a competing projection', async () => {
    await withFreezeFixture(async (fixture) => {
      const fault = new Error('Injected Linux Git index S1 fault');
      let selectedHooks = 0;
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        afterExactPreRecoveryLink: (event) => {
          if (event.label !== 'Git index') return;
          selectedHooks += 1;
          throw fault;
        }
      })).rejects.toBe(fault);
      expect(selectedHooks).toBe(1);
      const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
      const journalPath = path.join(transactionRoot, 'journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalView;
      expect(journal.phase).toBe('prepared');
      const indexPath = repositoryIndexPath(fixture.repositoryRoot);
      await expectLinuxExactS1({
        artifactRoot: path.dirname(indexPath),
        targetPath: indexPath,
        targetKey: 'git-index',
        operationId: journal.operationId,
        expectedPre: Buffer.from(journal.index.pre, 'base64')
      });
      expect(await readFile(`${indexPath}.lock`)).toEqual(Buffer.from(journal.index.next, 'base64'));
      expect(await readFile(path.join(fixture.repositoryRoot, POINTER_PATH)))
        .toEqual(Buffer.from(journal.files.pointer.pre, 'base64'));
      expect(await readFile(path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md')))
        .toEqual(Buffer.from(journal.files.rollingPlan.pre, 'base64'));

      const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
      expect(status.activation).toEqual({
        operationId: journal.operationId,
        phase: 'prepared',
        terminal: false
      });
      const recovered = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.operationId).toBe(journal.operationId);
      expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(journal.candidateTreeSha);
      await expectFreezeTransactionRetired(fixture.repositoryRoot);
      const repeated = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(repeated.candidateTreeSha).toBe(recovered.candidateTreeSha);
    });
  }, 60_000);

  test('Linux S1 terminal journal witness remains in-progress and recovers the same operation idempotently', async () => {
    await withFreezeFixture(async (fixture) => {
      const fault = new Error('Injected Linux terminal journal S1 fault');
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        afterExactPreRecoveryLink: (event) => {
          if (event.label === 'Freeze journal terminal') throw fault;
        }
      })).rejects.toBe(fault);
      const active = await readSingleActiveJournalRecovery(fixture.repositoryRoot);
      expect(active.journal.phase).toBe('terminal');
      const journalPath = path.join(active.transactionRoot, 'journal.json');
      const canonicalBytes = await readFile(journalPath);
      expect((JSON.parse(canonicalBytes.toString('utf8')) as RecoveryJournalView).phase)
        .toBe('rolling-published');
      await expectLinuxExactS1({
        artifactRoot: active.transactionRoot,
        targetPath: journalPath,
        targetKey: 'freeze-journal',
        operationId: `sha256:${digest(active.bytes)}`,
        expectedPre: canonicalBytes
      });
      const beforeStatus = await readFreezeEffectSnapshot(fixture.repositoryRoot);
      const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
      expect(status.activation).toEqual({
        operationId: active.journal.operationId,
        phase: 'terminal',
        terminal: false
      });
      expect(await readFreezeEffectSnapshot(fixture.repositoryRoot)).toEqual(beforeStatus);
      const recovered = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered).toEqual(active.journal.result);
      await expectFreezeTransactionRetired(fixture.repositoryRoot);
      const repeated = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(repeated.candidateTreeSha).toBe(recovered.candidateTreeSha);
    });
  }, 60_000);
}

if (process.platform === 'linux') {
  // Pointer represents the ordinary writeAtomicCas projection family; rolling
  // phase/path wiring remains in the nonterminal recovery matrix above.
  const installedNextCases = [
    { kind: 'index', faultAfter: 'after-index-next-install' },
    { kind: 'pointer', faultAfter: 'after-pointer-next-install' }
  ] as const satisfies readonly Readonly<{
    kind: 'index' | 'pointer';
    faultAfter: FreezeFault;
  }>[];
  for (const installedCase of installedNextCases) {
    for (const state of ['S3', 'S4'] as const) {
      test(`Linux ${installedCase.kind} ${state} rejects same-byte different-inode NEXT authority without effects`, async () => {
        await withFreezeFixture(async (fixture) => {
          const durability: DurabilityEvent[] = [];
          const renames: unknown[] = [];
          const creates: unknown[] = [];
          const cleanups: unknown[] = [];
          await expect(freezeDocumentControlPlane({
            cwd: fixture.repositoryRoot,
            manifestPath: FREEZE_TARGET_PATH,
            reviewedOn: '2026-08-09',
            faultAfter: installedCase.faultAfter
          })).rejects.toThrow(installedCase.faultAfter);
          const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
          const journal = (
            JSON.parse(await readFile(path.join(transactionRoot, 'journal.json'), 'utf8')) as RecoveryJournalView
          );
          const indexPath = repositoryIndexPath(fixture.repositoryRoot);
          const targetPath = installedCase.kind === 'index'
            ? indexPath
            : path.join(fixture.repositoryRoot, POINTER_PATH);
          const nextPath = installedCase.kind === 'index'
            ? `${indexPath}.lock`
            : path.join(
                path.dirname(targetPath),
                `.${path.basename(targetPath)}.${journal.operationId.slice('sha256:'.length)}.next`
              );
          const artifactRoot = installedCase.kind === 'index' ? path.dirname(indexPath) : transactionRoot;
          const retiredNextPath = entryRecoveryPathForTest(
            artifactRoot,
            installedCase.kind === 'index'
              ? 'git-index'
              : 'active-pointer',
            journal.operationId,
            'retired-next'
          );
          const exactNext = await readFile(nextPath);
          expect(await readFile(targetPath)).toEqual(Buffer.from(exactNext));
          const targetMetadata = await lstat(targetPath);
          const exactNextMetadata = await lstat(nextPath);
          expect({ dev: exactNextMetadata.dev, ino: exactNextMetadata.ino }).toEqual({
            dev: targetMetadata.dev,
            ino: targetMetadata.ino
          });

          const heldPath = path.join(fixture.parent, `${installedCase.kind}-${state}-exact-next-held`);
          if (state === 'S3') {
            await rename(nextPath, heldPath);
            await writeFile(nextPath, exactNext);
          } else {
            await rename(nextPath, retiredNextPath);
            await rename(retiredNextPath, heldPath);
            await writeFile(retiredNextPath, exactNext);
          }
          const competingPath = state === 'S3' ? nextPath : retiredNextPath;
          const competingMetadata = await lstat(competingPath);
          expect({ dev: competingMetadata.dev, ino: competingMetadata.ino }).not.toEqual({
            dev: targetMetadata.dev,
            ino: targetMetadata.ino
          });
          const beforeRejection = await readFreezeEffectSnapshot(fixture.repositoryRoot);
          await expect(freezeDocumentControlPlane({
            cwd: fixture.repositoryRoot,
            manifestPath: FREEZE_TARGET_PATH,
            reviewedOn: '2026-08-09',
            durabilityObserver: (event) => { durability.push(event); },
            beforeAnchoredRename: (event) => { renames.push(event); },
            beforeAnchoredCreate: (event) => { creates.push(event); },
            beforeAnchoredCleanup: (event) => { cleanups.push(event); }
          })).rejects.toThrow(/recovery tuple is not a legal pre-effect state/u);
          expect(durability).toEqual([]);
          expect(renames).toEqual([]);
          expect(creates).toEqual([]);
          expect(cleanups).toEqual([]);
          expect(await readFreezeEffectSnapshot(fixture.repositoryRoot)).toEqual(beforeRejection);
          expect(await readFile(targetPath)).toEqual(Buffer.from(exactNext));
          expect(await readFile(competingPath)).toEqual(Buffer.from(exactNext));
          expect(await readFile(heldPath)).toEqual(Buffer.from(exactNext));
        });
      }, 60_000);
    }
  }

  test('Linux journal S3 census rejects a same-byte different-inode active NEXT without effects', async () => {
    await withFreezeFixture(async (fixture) => {
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        faultAfter: 'after-journal-index-published-next-install'
      })).rejects.toThrow('after-journal-index-published-next-install');
      const active = await readSingleActiveJournalRecovery(fixture.repositoryRoot);
      const heldPath = path.join(fixture.parent, 'journal-S3-exact-next-held');
      await rename(active.filePath, heldPath);
      await writeFile(active.filePath, active.bytes);
      const journalPath = path.join(active.transactionRoot, 'journal.json');
      const journalMetadata = await lstat(journalPath);
      const replacementMetadata = await lstat(active.filePath);
      expect({ dev: replacementMetadata.dev, ino: replacementMetadata.ino }).not.toEqual({
        dev: journalMetadata.dev,
        ino: journalMetadata.ino
      });
      const beforeRejection = await readFreezeEffectSnapshot(fixture.repositoryRoot);
      await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
        .rejects.toThrow(/Linux freeze entry recovery identity is unprovable/u);
      expect(await readFreezeEffectSnapshot(fixture.repositoryRoot)).toEqual(beforeRejection);
      expect(await readFile(journalPath)).toEqual(Buffer.from(active.bytes));
      expect(await readFile(active.filePath)).toEqual(Buffer.from(active.bytes));
      expect(await readFile(heldPath)).toEqual(Buffer.from(active.bytes));
    });
  }, 60_000);
}

test('read-only status isolates hostile ambient Git state and preserves the exact raw index', async () => {
  await withFreezeFixture(async (fixture) => {
    await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    const indexPath = repositoryIndexPath(fixture.repositoryRoot);
    const indexBefore = await readFile(indexPath);
    const treeBefore = runGit(fixture.repositoryRoot, ['write-tree']);
    const objectCensusBefore = runGit(fixture.repositoryRoot, ['count-objects', '-v']);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
    const observations: Array<Readonly<{
      args: readonly string[];
      environment: Readonly<Record<string, string>>;
    }>> = [];
    const hostileGitEnvironment = Object.freeze({
      GIT_DIR: path.join(fixture.parent, 'ambient-decoy-git-dir'),
      GIT_WORK_TREE: path.join(fixture.parent, 'ambient-decoy-worktree'),
      GIT_INDEX_FILE: path.join(fixture.parent, 'ambient-decoy-index'),
      GIT_OBJECT_DIRECTORY: path.join(fixture.parent, 'ambient-decoy-objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(fixture.parent, 'ambient-decoy-alternates'),
      GIT_REPLACE_REF_BASE: 'refs/ambient-replacements/',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.repositoryFormatVersion',
      GIT_CONFIG_VALUE_0: '1',
      GIT_ASKPASS: path.join(fixture.parent, 'ambient-askpass'),
      GIT_ASKPASS_REQUIRE: 'force',
      GIT_SSH_COMMAND: 'ambient-ssh-command',
      GIT_OPTIONAL_LOCKS: '1'
    });
    const previousGitEnvironment = new Map(
      Object.keys(hostileGitEnvironment).map((name) => [name, process.env[name]] as const)
    );
    let status: Awaited<ReturnType<typeof resolveLiveControlPlane>>;
    try {
      Object.assign(process.env, hostileGitEnvironment);
      status = await resolveLiveControlPlane(fixture.repositoryRoot, {
        observeGitHub: false,
        resolverGitCommandObserver: (event) => observations.push(event)
      });
    } finally {
      for (const [name, value] of previousGitEnvironment) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    expect(status.activation).toBeNull();
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((event) => event.environment.GIT_OPTIONAL_LOCKS === '0')).toBe(true);
    expect(observations.every((event) => (
      event.environment.GIT_DIR === undefined
      && event.environment.GIT_WORK_TREE === undefined
      && event.environment.GIT_CONFIG_COUNT === undefined
      && event.environment.GIT_CONFIG_KEY_0 === undefined
      && event.environment.GIT_CONFIG_VALUE_0 === undefined
      && event.environment.GIT_ASKPASS === undefined
      && event.environment.GIT_ASKPASS_REQUIRE === undefined
      && event.environment.GIT_SSH_COMMAND === undefined
      && event.environment.GIT_NO_REPLACE_OBJECTS === '1'
      && event.environment.GIT_CONFIG_NOSYSTEM === '1'
      && event.environment.GIT_OBJECT_DIRECTORY !== hostileGitEnvironment.GIT_OBJECT_DIRECTORY
      && event.environment.GIT_ALTERNATE_OBJECT_DIRECTORIES !== hostileGitEnvironment.GIT_ALTERNATE_OBJECT_DIRECTORIES
      && event.environment.GIT_INDEX_FILE !== hostileGitEnvironment.GIT_INDEX_FILE
    ))).toBe(true);
    const commands = observations.map((event) => event.args.join(' '));
    expect(commands).toContain('status --short --branch');
    const indexInterpretingObservations = observations.filter((event) => (
      event.args[0] === 'write-tree'
      || event.args[0] === 'status'
      || event.args[0] === 'ls-files'
      || (event.args[0] === 'diff' && event.args.includes('--cached'))
      || (event.args[0] === 'show' && event.args[1]?.startsWith(':') === true)
    ));
    expect(indexInterpretingObservations.length).toBeGreaterThan(0);
    const repositoryObjectsCandidate = runGit(fixture.repositoryRoot, ['rev-parse', '--git-path', 'objects']);
    const repositoryObjects = await realpath(path.isAbsolute(repositoryObjectsCandidate)
      ? repositoryObjectsCandidate
      : path.resolve(fixture.repositoryRoot, repositoryObjectsCandidate));
    const usesExactExternalScratch = (event: Readonly<{
      args: readonly string[];
      environment: Readonly<Record<string, string>>;
    }>): boolean => {
      const scratchIndex = event.environment.GIT_INDEX_FILE;
      const scratchObjects = event.environment.GIT_OBJECT_DIRECTORY;
      const alternates = event.environment.GIT_ALTERNATE_OBJECT_DIRECTORIES;
      if (scratchIndex === undefined || scratchObjects === undefined || alternates === undefined) return false;
      const scratchRoot = path.dirname(scratchIndex);
      const relativeToRepository = path.relative(fixture.repositoryRoot, scratchRoot);
      const outsideRepository = path.isAbsolute(relativeToRepository)
        || relativeToRepository === '..'
        || relativeToRepository.startsWith(`..${path.sep}`);
      return outsideRepository
        && path.dirname(scratchObjects) === scratchRoot
        && alternates === repositoryObjects;
    };
    expect(indexInterpretingObservations.every(usesExactExternalScratch)).toBe(true);
    const indexBeforeFailedStatus = await readFile(indexPath);
    const identityBeforeFailedStatus = await lstat(indexPath);
    let failedStatusObservation: Readonly<{
      args: readonly string[];
      environment: Readonly<Record<string, string>>;
    }> | undefined;
    await expect(resolveLiveControlPlane(fixture.repositoryRoot, {
      observeGitHub: false,
      resolverGitCommandObserver: (event) => {
        if (event.args.join(' ') !== 'status --short --branch') return;
        failedStatusObservation = event;
        writeFileSync(event.environment.GIT_INDEX_FILE!, Buffer.from('invalid scratch index', 'utf8'));
      }
    })).rejects.toThrow('Worktree status through external index snapshot failed');
    expect(failedStatusObservation).toBeDefined();
    expect(usesExactExternalScratch(failedStatusObservation!)).toBe(true);
    expect(await readFile(indexPath)).toEqual(indexBeforeFailedStatus);
    const identityAfterFailedStatus = await lstat(indexPath);
    expect({ dev: identityAfterFailedStatus.dev, ino: identityAfterFailedStatus.ino }).toEqual({
      dev: identityBeforeFailedStatus.dev,
      ino: identityBeforeFailedStatus.ino
    });
    expect(commands.some((command) => command.startsWith('show '))).toBe(true);
    expect(await readFile(indexPath)).toEqual(Buffer.from(indexBefore));
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(treeBefore);
    expect(runGit(fixture.repositoryRoot, ['count-objects', '-v'])).toBe(objectCensusBefore);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
  });
}, 60_000);

test('same-tree raw index stat drift is a semantic NOOP without effects', async () => {
  await withFreezeFixture(async (fixture) => {
    const frozen = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    const indexPath = repositoryIndexPath(fixture.repositoryRoot);
    const exactIndex = await readFile(indexPath);
    const treeBefore = runGit(fixture.repositoryRoot, ['write-tree']);
    expect(treeBefore).toBe(frozen.candidateTreeSha);
    const pointerPath = path.join(fixture.repositoryRoot, POINTER_PATH);
    const future = new Date(Date.now() + 60_000);
    await utimes(pointerPath, future, future);
    runGit(fixture.repositoryRoot, ['update-index', '--refresh']);
    const driftedIndex = await readFile(indexPath);
    expect(driftedIndex.equals(exactIndex)).toBe(false);
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(treeBefore);
    const objectCensusBefore = runGit(fixture.repositoryRoot, ['count-objects', '-v']);
    const durabilityEffects: DurabilityEvent[] = [];
    let renameEffects = 0;
    let cleanupEffects = 0;
    let fenceIndex: Buffer | undefined;
    const repeated = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      durabilityObserver: (event) => { durabilityEffects.push(event); },
      beforeAnchoredRename: () => { renameEffects += 1; },
      beforeAnchoredCleanup: () => { cleanupEffects += 1; },
      beforeInitialJournalFence: async () => {
        const later = new Date(future.getTime() + 60_000);
        await utimes(pointerPath, later, later);
        runGit(fixture.repositoryRoot, ['update-index', '--refresh']);
        fenceIndex = await readFile(indexPath);
      }
    });
    expect(repeated.candidateTreeSha).toBe(frozen.candidateTreeSha);
    expect(fenceIndex).toBeDefined();
    expect((await readFile(indexPath)).equals(fenceIndex!)).toBe(true);
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(treeBefore);
    expect(runGit(fixture.repositoryRoot, ['count-objects', '-v'])).toBe(objectCensusBefore);
    expect(durabilityEffects).toEqual([]);
    expect(renameEffects).toBe(0);
    expect(cleanupEffects).toBe(0);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
  });
}, 60_000);

test('published freeze index survives Git metadata refresh without replaying index CAS', async () => {
  await withFreezeFixture(async (fixture) => {
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-rolling-publish'
    })).rejects.toThrow('after-rolling-publish');
    const indexPath = repositoryIndexPath(fixture.repositoryRoot);
    const before = await readFile(indexPath);
    const expectedTree = runGit(fixture.repositoryRoot, ['write-tree']);
    const pointerPath = path.join(fixture.repositoryRoot, POINTER_PATH);
    const future = new Date(Date.now() + 60_000);
    await utimes(pointerPath, future, future);
    runGit(fixture.repositoryRoot, ['update-index', '--refresh']);
    const driftedIndex = await readFile(indexPath);
    expect(driftedIndex.equals(before)).toBe(false);
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(expectedTree);

    const canonicalIndexPath = await realpath(indexPath);
    const indexPublications: DurabilityEvent[] = [];
    const recovered = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      durabilityObserver: (event) => {
        if (event.stage === 'renamed'
            && path.relative(canonicalIndexPath, path.resolve(event.targetPath)) === '') {
          indexPublications.push(event);
        }
      }
    });
    expect(recovered.candidateTreeSha).toBe(expectedTree);
    expect(await readFile(indexPath)).toEqual(driftedIndex);
    expect(indexPublications).toEqual([]);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
  });
}, 60_000);

test('journal recovery census blocks and preserves an unknown exact PRE recovery entry', async () => {
  await withFreezeFixture(async (fixture) => {
    const unknown = Buffer.from('unknown journal PRE recovery bytes\n', 'utf8');
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-journal-index-published-pre-quarantine'
    })).rejects.toThrow('after-journal-index-published-pre-quarantine');
    const active = await readSingleActiveJournalRecovery(fixture.repositoryRoot);
    const preNames = (await readdir(active.transactionRoot)).filter((name) => /^\.entry-[0-9a-f]{64}\.pre$/u.test(name));
    expect(preNames).toHaveLength(1);
    const prePath = path.join(active.transactionRoot, preNames[0]!);
    await writeFile(prePath, unknown);
    await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
      .rejects.toThrow(/PRE quarantine|unknown bytes/u);
    expect(await readFile(prePath)).toEqual(unknown);
    expect(await readFile(active.filePath)).toEqual(Buffer.from(active.bytes));
  });
}, 60_000);

test('journal recovery census blocks and preserves duplicate active NEXT artifacts', async () => {
  await withFreezeFixture(async (fixture) => {
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-journal-index-published-pre-quarantine'
    })).rejects.toThrow('after-journal-index-published-pre-quarantine');
    const active = await readSingleActiveJournalRecovery(fixture.repositoryRoot);
    const duplicateName = `journal.json.${'f'.repeat(64)}.${active.journal.phase}.next`;
    const duplicatePath = path.join(active.transactionRoot, duplicateName);
    await copyFile(active.filePath, duplicatePath);
    await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
      .rejects.toThrow('Duplicate freeze journal active NEXT recovery entries are preserved.');
    expect(await readFile(active.filePath)).toEqual(Buffer.from(active.bytes));
    expect(await readFile(duplicatePath)).toEqual(Buffer.from(active.bytes));
  });
}, 60_000);

test('journal residue census blocks canonical absence with an exact retired NEXT and preserves every entry', async () => {
  await withFreezeFixture(async (fixture) => {
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-terminal'
    })).rejects.toThrow('after-terminal');
    const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    const journalPath = path.join(transactionRoot, 'journal.json');
    const journalBytes = await readFile(journalPath);
    const retiredNextPath = journalRetiredNextPath(transactionRoot, journalBytes);
    if (process.platform === 'win32') await writeFile(retiredNextPath, journalBytes);
    expect(await readFile(retiredNextPath)).toEqual(Buffer.from(journalBytes));
    const residuesBefore = await readEntryRecoveryByteSnapshot(transactionRoot);
    await unlink(journalPath);

    await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
      .rejects.toThrow('Freeze journal is absent while direct transaction residues remain');
    await expect(readFile(journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readEntryRecoveryByteSnapshot(transactionRoot)).toEqual(residuesBefore);
    expect(await readFile(retiredNextPath)).toEqual(Buffer.from(journalBytes));
  });
}, 60_000);

test('journal residue census blocks an unbound direct entry beside canonical terminal authority', async () => {
  await withFreezeFixture(async (fixture) => {
    const unknown = Buffer.from('unbound entry recovery bytes\n', 'utf8');
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-terminal'
    })).rejects.toThrow('after-terminal');
    const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    const journalPath = path.join(transactionRoot, 'journal.json');
    const journalBefore = await readFile(journalPath);
    const unboundPath = path.join(transactionRoot, `.entry-${'0'.repeat(64)}.retired-pre`);
    expect((await readdir(transactionRoot)).includes(path.basename(unboundPath))).toBe(false);
    await writeFile(unboundPath, unknown);

    await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
      .rejects.toThrow(`Unbound freeze entry recovery residue is preserved: ${path.basename(unboundPath)}`);
    expect(await readFile(unboundPath)).toEqual(unknown);
    expect(await readFile(journalPath)).toEqual(Buffer.from(journalBefore));
  });
}, 60_000);

test('journal residue census double-read blocks a raced residue replacement and preserves its bytes', async () => {
  await withFreezeFixture(async (fixture) => {
    const replacement = Buffer.from('raced replacement residue bytes\n', 'utf8');
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-terminal'
    })).rejects.toThrow('after-terminal');
    const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    const residueNames = (await readdir(transactionRoot)).filter((name) => FREEZE_ENTRY_RECOVERY_NAME_FOR_TEST.test(name));
    expect(residueNames.length).toBeGreaterThan(0);
    const residuePath = path.join(transactionRoot, residueNames[0]!);
    const original = await readFile(residuePath);
    const companionPath = path.join(fixture.parent, 'residue-census-race-companion');
    let raced = false;
    if (process.platform === 'linux') await writeFile(companionPath, replacement);

    await expect(resolveLiveControlPlane(fixture.repositoryRoot, {
      observeGitHub: false,
      beforeJournalRecoveryCensusReadback: async () => {
        if (raced) return;
        raced = true;
        if (process.platform === 'linux') {
          const swapPath = `${companionPath}.swap`;
          await rename(companionPath, swapPath);
          await rename(residuePath, companionPath);
          await rename(swapPath, residuePath);
        } else {
          await writeFile(residuePath, replacement);
        }
      }
    })).rejects.toThrow('Freeze journal recovery entry changed during readback');
    expect(raced).toBe(true);
    expect(await readFile(residuePath)).toEqual(replacement);
    if (process.platform === 'linux') expect(await readFile(companionPath)).toEqual(Buffer.from(original));
  });
}, 60_000);

test('closed-world transaction census blocks an orphan partial temporary index without journal authority', async () => {
  await withFreezeFixture(async (fixture) => {
    const partial = Buffer.from('partial unbound temporary index bytes\n', 'utf8');
    const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    await mkdir(transactionRoot, { recursive: true });
    const temporaryIndexPath = path.join(transactionRoot, 'index-123-456.next');
    await writeFile(temporaryIndexPath, partial);
    await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
      .rejects.toThrow('Freeze journal is absent while direct transaction residues remain');
    expect(await readFile(temporaryIndexPath)).toEqual(partial);
    await expect(readFile(path.join(transactionRoot, 'journal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
}, 30_000);

test('freeze journal rejects V1–V3 authorities and detects index transport corruption', async () => {
  await withFreezeFixture(async (legacyFixture) => {
    await expect(freezeDocumentControlPlane({
      cwd: legacyFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-terminal'
    })).rejects.toThrow('after-terminal');
    const transactionRoot = path.join(legacyFixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    const journalPath = path.join(transactionRoot, 'journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalView;
    expect(journal).not.toHaveProperty('retainedTemporaryIndexName');
    expect(Buffer.from(journal.index.next, 'base64').byteLength).toBeGreaterThan(0);
    expect((await resolveLiveControlPlane(legacyFixture.repositoryRoot, { observeGitHub: false })).activation)
      .toMatchObject({ operationId: journal.operationId, phase: 'terminal', terminal: true });

    for (const legacyVersion of ['v1', 'v2', 'v3'] as const) {
      const legacy: Record<string, unknown> = { ...journal };
      legacy.schema = `sec-document-control-plane-freeze-journal-${legacyVersion}`;
      if (legacyVersion === 'v2') legacy.retainedTemporaryIndexName = 'index-123-456.next';
      await writeFile(journalPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');
      const beforeLegacyRejection = await readFreezeEffectSnapshot(legacyFixture.repositoryRoot);
      await expect(resolveLiveControlPlane(legacyFixture.repositoryRoot, { observeGitHub: false }))
        .rejects.toThrow('Only freeze journal V4 or V5 can serve as recovery authority');
      expect(await readFreezeEffectSnapshot(legacyFixture.repositoryRoot)).toEqual(beforeLegacyRejection);
    }
  });

  await withFreezeFixture(async (digestFixture) => {
    await expect(freezeDocumentControlPlane({
      cwd: digestFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-terminal'
    })).rejects.toThrow('after-terminal');
    const transactionRoot = path.join(digestFixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    const journalPath = path.join(transactionRoot, 'journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalView;
    const mutatedIndex = Buffer.from(journal.index.next, 'base64');
    mutatedIndex[0] = mutatedIndex[0]! ^ 0xff;
    const mutated = {
      ...journal,
      index: { ...journal.index, next: mutatedIndex.toString('base64') }
    };
    await writeFile(journalPath, `${JSON.stringify(mutated, null, 2)}\n`, 'utf8');
    const beforeDigestRejection = await readFreezeEffectSnapshot(digestFixture.repositoryRoot);
    await expect(resolveLiveControlPlane(digestFixture.repositoryRoot, { observeGitHub: false }))
      .rejects.toThrow('Freeze journal index transport digest mismatch');
    expect(await readFreezeEffectSnapshot(digestFixture.repositoryRoot)).toEqual(beforeDigestRejection);
  });
}, 120_000);

test('candidate index staging stays outside the transaction root before journal publication', async () => {
  await withFreezeFixture(async (fixture) => {
    const stop = new Error('stop after external candidate-index staging');
    const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    let observedNames: readonly string[] | undefined;
    let observedTransactionRootAbsent = false;
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      beforeInitialJournalFence: async () => {
        try {
          observedNames = await readdir(transactionRoot);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          observedNames = Object.freeze([]);
          observedTransactionRootAbsent = true;
        }
        throw stop;
      }
    })).rejects.toBe(stop);
    expect(observedNames).toEqual([]);
    expect(observedTransactionRootAbsent).toBe(true);
    await expect(readdir(transactionRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(transactionRoot, 'journal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
}, 60_000);

test('closed-world transaction census rejects a legacy temporary-index residue beside canonical authority', async () => {
  await withFreezeFixture(async (fixture) => {
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-terminal'
    })).rejects.toThrow('after-terminal');
    const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    const journal = JSON.parse(
      await readFile(path.join(transactionRoot, 'journal.json'), 'utf8')
    ) as RecoveryJournalView;
    expect((await readdir(transactionRoot)).filter((name) => /^index-.*\.next$/u.test(name))).toEqual([]);
    const residueName = 'index-123-456.next';
    const residuePath = path.join(transactionRoot, residueName);
    const residueBytes = Buffer.from(journal.index.next, 'base64');
    await writeFile(residuePath, residueBytes);
    const beforeRejection = await readFreezeEffectSnapshot(fixture.repositoryRoot);
    await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
      .rejects.toThrow(`Unknown freeze transaction direct residue is preserved: ${residueName}`);
    expect(await readFreezeEffectSnapshot(fixture.repositoryRoot)).toEqual(beforeRejection);
    expect(await readFile(residuePath)).toEqual(residueBytes);
  });
}, 60_000);

test('optional journal reads accept an absent parent while required control reads remain strict', async () => {
  await withFreezeFixture(async (fixture) => {
    await rm(path.join(fixture.repositoryRoot, '.tmp'), { recursive: true, force: true });
    const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
    expect(status.activation).toBeNull();

    await rm(path.join(fixture.repositoryRoot, 'config/repository/work-packages'), { recursive: true, force: true });
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toMatchObject({ code: 'ENOENT' });
  });
}, 30_000);

test('freeze retires the sole journal-last empty-directory suffix before starting a new operation', async () => {
  await withFreezeFixture(async (fixture) => {
    const emptyTransactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    await mkdir(emptyTransactionRoot, { recursive: true });
    expect(await readdir(emptyTransactionRoot)).toEqual([]);
    const result = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(result.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
  });
}, 30_000);

test('status double-reads the activation journal and blocks a freeze that starts after its index snapshot', async () => {
  await withFreezeFixture(async (fixture) => {
    const status = await resolveLiveControlPlane(fixture.repositoryRoot, {
      observeGitHub: false,
      afterIndexSnapshot: async () => {
        await expect(freezeDocumentControlPlane({
          cwd: fixture.repositoryRoot,
          manifestPath: FREEZE_TARGET_PATH,
          reviewedOn: '2026-08-09',
          faultAfter: 'after-journal-prepare'
        })).rejects.toThrow('after-journal-prepare');
      }
    });
    expect(status.activeWorkPackage).toEqual({
      state: 'unresolved',
      reason: 'activation-in-progress'
    });
    expect(status.activation).toMatchObject({ phase: 'prepared', terminal: false });
    await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
  });
}, 30_000);

test('status returns a typed race when the captured index tree changes directly', async () => {
  await withFreezeFixture(async (fixture) => {
    const status = await resolveLiveControlPlane(fixture.repositoryRoot, {
      observeGitHub: false,
      afterIndexSnapshot: async () => {
        await writeFile(path.join(fixture.repositoryRoot, 'direct-index-race.txt'), 'race\n', 'utf8');
        runGit(fixture.repositoryRoot, ['add', 'direct-index-race.txt']);
      }
    });
    expect(status.activeWorkPackage).toEqual({
      state: 'unresolved',
      reason: 'activation-observation-raced'
    });
    expect(status.github).toMatchObject({
      status: 'unresolved',
      reason: expect.stringContaining('activation changed during status resolution')
    });
  });
}, 30_000);

test('status observes a deep staged tree and unstaged changes without changing the raw index', async () => {
  await withFreezeFixture(async (fixture) => {
    const relativePath = `${Array.from({ length: 13 }, (_, index) => `depth-${index}`).join('/')}/leaf.txt`;
    const absolutePath = path.join(fixture.repositoryRoot, ...relativePath.split('/'));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, 'deep index observation\n', 'utf8');
    runGit(fixture.repositoryRoot, ['add', '--', relativePath]);
    await writeFile(absolutePath, 'unstaged successor bytes\n', 'utf8');
    await writeFile(path.join(fixture.repositoryRoot, 'untracked with spaces.txt'), 'untracked\n', 'utf8');
    const indexBefore = await readFile(repositoryIndexPath(fixture.repositoryRoot));

    const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
    expect(status.schema).toBe('sec-resolved-current-state-v1');
    expect(status.continuation).toMatchObject({
      authority: 'observation-only',
      subject: { repositoryRoot: fixture.repositoryRoot },
      changes: { state: 'observed', records: expect.arrayContaining([
        { index: 'A', worktree: 'M', path: relativePath, originalPath: null },
        { index: '?', worktree: '?', path: 'untracked with spaces.txt', originalPath: null }
      ]) }
    });
    expect(projectDocumentControlPlaneStatusCli(status).continuation).toEqual(status.continuation);
    expect(await readFile(repositoryIndexPath(fixture.repositoryRoot))).toEqual(indexBefore);
    expect(status.workspace).toMatchObject({
      status: expect.stringContaining('leaf.txt')
    });
  });
}, 60_000);

for (const raceKind of ['local-default-ref', 'live-default-ref'] as const) {
  test(`status returns a typed race when ${raceKind} changes before readback`, async () => {
    await withFreezeFixture(async (fixture) => {
      const alternate = runGit(fixture.repositoryRoot, [
        'commit-tree',
        `${fixture.baseSha}^{tree}`,
        '-p',
        fixture.baseSha,
        '-m',
        `${raceKind} observation race`
      ]);
      if (raceKind === 'live-default-ref') {
        runGit(fixture.repositoryRoot, ['push', '--quiet', 'origin', `${alternate}:refs/heads/race-source`]);
      }
      const status = await resolveLiveControlPlane(fixture.repositoryRoot, {
        observeGitHub: false,
        beforeObservationReadback: () => {
          if (raceKind === 'local-default-ref') {
            runGit(fixture.repositoryRoot, ['update-ref', 'refs/remotes/origin/main', alternate]);
          } else {
            runGit(fixture.remoteRoot, ['update-ref', 'refs/heads/main', alternate]);
          }
        }
      });
      expect(status.activeWorkPackage).toEqual({
        state: 'unresolved',
        reason: 'activation-observation-raced'
      });
    });
  }, 30_000);
}

test('freeze rejects unrelated staged and unknown recovery bytes without changing them', async () => {
  await withFreezeFixture(async (stagedFixture) => {
    await writeFile(path.join(stagedFixture.repositoryRoot, 'user-staged.txt'), 'preserve staged\n', 'utf8');
    runGit(stagedFixture.repositoryRoot, ['add', 'user-staged.txt']);
    const treeBefore = runGit(stagedFixture.repositoryRoot, ['write-tree']);
    const stagedBefore = runGit(stagedFixture.repositoryRoot, ['diff', '--cached', '--name-only']);
    const indexBefore = await readFile(repositoryIndexPath(stagedFixture.repositoryRoot));
    await expect(freezeDocumentControlPlane({
      cwd: stagedFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('rejects unrelated staged paths');
    expect(await readFile(path.join(stagedFixture.repositoryRoot, 'user-staged.txt'), 'utf8'))
      .toBe('preserve staged\n');
    expect(await readFile(repositoryIndexPath(stagedFixture.repositoryRoot))).toEqual(indexBefore);
    expect(runGit(stagedFixture.repositoryRoot, ['write-tree'])).toBe(treeBefore);
    expect(runGit(stagedFixture.repositoryRoot, ['diff', '--cached', '--name-only']))
      .toBe(stagedBefore);
  });

  await withFreezeFixture(async (unknownFixture) => {
    await expect(freezeDocumentControlPlane({
      cwd: unknownFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-pointer-publish'
    })).rejects.toThrow('after-pointer-publish');
    const rollingPath = path.join(unknownFixture.repositoryRoot, 'config/repository/rolling-plan.md');
    await writeFile(rollingPath, 'unknown user bytes\n', 'utf8');
    await expect(freezeDocumentControlPlane({
      cwd: unknownFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('Rolling plan recovery tuple is not a legal pre-effect state; preserving every entry.');
    expect(await readFile(rollingPath, 'utf8')).toBe('unknown user bytes\n');
  });
}, 60_000);

test('freeze fails closed for stale main, symlink-mode targets, and index CAS collisions', async () => {
  await withFreezeFixture(async (staleFixture) => {
    const advanced = runGit(staleFixture.repositoryRoot, [
      'commit-tree', `${staleFixture.baseSha}^{tree}`, '-p', staleFixture.baseSha, '-m', 'remote advance'
    ]);
    runGit(staleFixture.repositoryRoot, ['push', '--quiet', 'origin', `${advanced}:refs/heads/main`]);
    runGit(staleFixture.repositoryRoot, ['update-ref', 'refs/heads/main', staleFixture.baseSha]);
    runGit(staleFixture.repositoryRoot, ['update-ref', 'refs/remotes/origin/main', staleFixture.baseSha]);
    const objectCensusBefore = runGit(staleFixture.repositoryRoot, ['count-objects', '-v']);
    await expect(freezeDocumentControlPlane({
      cwd: staleFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('Live default ref is stale');
    expect(runGit(staleFixture.repositoryRoot, ['count-objects', '-v'])).toBe(objectCensusBefore);
  });

  await withFreezeFixture(async (modeFixture) => {
    const blob = runGit(modeFixture.repositoryRoot, ['hash-object', '-w', FREEZE_TARGET_PATH]);
    runGit(modeFixture.repositoryRoot, [
      'update-index', '--add', '--cacheinfo', '120000', blob, FREEZE_TARGET_PATH
    ]);
    await expect(freezeDocumentControlPlane({
      cwd: modeFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('stage-zero regular blob');
  });

  await withFreezeFixture(async (collisionFixture) => {
    await expect(freezeDocumentControlPlane({
      cwd: collisionFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-journal-prepare'
    })).rejects.toThrow('after-journal-prepare');
    await writeFile(path.join(collisionFixture.repositoryRoot, 'concurrent.txt'), 'concurrent index\n', 'utf8');
    runGit(collisionFixture.repositoryRoot, ['add', 'concurrent.txt']);
    const treeBefore = runGit(collisionFixture.repositoryRoot, ['write-tree']);
    const stagedBefore = runGit(collisionFixture.repositoryRoot, ['diff', '--cached', '--name-only']);
    const indexBefore = await readFile(repositoryIndexPath(collisionFixture.repositoryRoot));
    await expect(freezeDocumentControlPlane({
      cwd: collisionFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('Git index recovery tuple is not a legal pre-effect state; preserving every entry.');
    expect(await readFile(repositoryIndexPath(collisionFixture.repositoryRoot))).toEqual(indexBefore);
    expect(runGit(collisionFixture.repositoryRoot, ['write-tree'])).toBe(treeBefore);
    expect(runGit(collisionFixture.repositoryRoot, ['diff', '--cached', '--name-only']))
      .toBe(stagedBefore);
  });
}, 60_000);

for (const raceKind of ['head', 'local-default', 'index', 'retired-manifest'] as const) {
  test(`freeze rejects ${raceKind} drift at the post-admission local fence`, async () => {
    await withFreezeFixture(async (fixture) => {
      const alternate = runGit(fixture.repositoryRoot, [
        'commit-tree',
        `${fixture.baseSha}^{tree}`,
        '-p',
        fixture.baseSha,
        '-m',
        `${raceKind} pre-journal race`
      ]);
      const objectCensusBefore = runGit(fixture.repositoryRoot, ['count-objects', '-v']);
      let objectCensusAtFence: string | undefined;
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        beforeInitialJournalFence: async () => {
          if (raceKind === 'head') {
            runGit(fixture.repositoryRoot, ['update-ref', 'HEAD', alternate]);
          } else if (raceKind === 'local-default') {
            runGit(fixture.repositoryRoot, ['update-ref', 'refs/remotes/origin/main', alternate]);
          } else if (raceKind === 'index') {
            const existingBlob = runGit(fixture.repositoryRoot, [
              'rev-parse',
              `HEAD:${CURRENT_STATE_PATH}`
            ]);
            runGit(fixture.repositoryRoot, [
              'update-index',
              '--add',
              '--cacheinfo',
              '100644',
              existingBlob,
              'pre-journal-index-race.txt'
            ]);
          } else {
            await writeFile(
              path.join(fixture.repositoryRoot, ...CURRENT_ACTIVE_PATH.split('/')),
              currentActiveManifestSource()
            );
          }
          objectCensusAtFence = runGit(fixture.repositoryRoot, ['count-objects', '-v']);
        }
      })).rejects.toThrow('Document control freeze inputs changed before initial journal publication:');
      expect(objectCensusAtFence).toBe(objectCensusBefore);
      expect(runGit(fixture.repositoryRoot, ['count-objects', '-v'])).toBe(objectCensusBefore);
      await expect(readFile(
        path.join(fixture.repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1/journal.json')
      )).rejects.toMatchObject({ code: 'ENOENT' });
    });
  }, 30_000);
}

test('anchored rename cannot be redirected by a parent-to-junction swap after handles are open', async () => {
  const fixture = await createFreezeFixture();
  const workPath = path.join(fixture.repositoryRoot, 'config/repository');
  const heldWorkPath = path.join(fixture.repositoryRoot, 'config/repository-held-by-anchor');
  const external = path.join(fixture.parent, 'anchored-rename-external');
  const externalPointer = path.join(external, 'active-work-package.md');
  const activePointer = path.join(workPath, 'active-work-package.md');
  const preRecoveryPaths: string[] = [];
  let nextSourcePath: string | undefined;
  let swapAttempted = false;
  let swapped = false;
  let replacementInstalled = false;
  let windowsSwapFailure: NodeJS.ErrnoException | undefined;
  await settleWorkspaceCallback(async () => {
    await mkdir(external);
    await writeFile(externalPointer, 'external sentinel\n', 'utf8');
    const activePointerBefore = await readFile(activePointer);
    let freezeFailure: unknown;
    try {
      await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        beforeAnchoredRename: async (event) => {
          if (event.label.startsWith('Active pointer ') && event.label.includes('PRE')) {
            preRecoveryPaths.push(event.targetPath);
          }
          if (event.label === 'Active pointer exact NEXT install') nextSourcePath = event.sourcePath;
          const exactSwapSeam = process.platform === 'win32'
            ? 'Active pointer PRE quarantine'
            : 'Active pointer exact NEXT install';
          if (swapAttempted || event.label !== exactSwapSeam) return;
          swapAttempted = true;
          try {
            await rename(workPath, heldWorkPath);
            swapped = true;
          } catch (error) {
            if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
              windowsSwapFailure = error as NodeJS.ErrnoException;
            }
            throw error;
          }
          await symlink(external, workPath, 'junction');
          replacementInstalled = true;
        }
      });
    } catch (error) {
      freezeFailure = error;
    }
    if (!swapAttempted) {
      throw new Error('freeze failed before the anchored rename fault seam', {
        cause: freezeFailure
      });
    }
    expect(await readFile(externalPointer, 'utf8')).toBe('external sentinel\n');
    if (process.platform === 'win32') {
      expect(swapped).toBe(false);
      expect(windowsSwapFailure).toMatchObject({ code: 'EPERM' });
      expect(freezeFailure).toBe(windowsSwapFailure);
      expect(await readFile(activePointer)).toEqual(activePointerBefore);
      await expect(readFile(path.join(heldWorkPath, 'active-work-package.md')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } else {
      expect(process.platform).toBe('linux');
      expect(swapped).toBe(true);
      expect(freezeFailure).toBeInstanceOf(UnsafeAnchoredPathError);
      expect(freezeFailure).toMatchObject({ code: 'DOCUMENT-CONTROL-UNSAFE-PATH-001' });
      // Admission rejected the changed parent before installing NEXT. The
      // canonical target can be absent here; exact PRE and NEXT must survive.
      const heldPath = (original: string): string => {
        const withinRepository = path.relative(fixture.repositoryRoot, original);
        expect(path.isAbsolute(withinRepository)).toBe(false);
        expect(withinRepository === '..' || withinRepository.startsWith('../')).toBe(false);
        const relative = path.relative(workPath, original);
        // Journal-owned recovery entries outside the moved directory retain
        // their original locations; only descendants travel with the parent.
        return relative === '..' || relative.startsWith('../')
          ? original
          : path.join(heldWorkPath, relative);
      };
      await expect(readFile(path.join(heldWorkPath, 'active-work-package.md')))
        .rejects.toMatchObject({ code: 'ENOENT' });
      expect(preRecoveryPaths.length).toBeGreaterThan(0);
      for (const original of preRecoveryPaths) {
        expect(await readFile(heldPath(original))).toEqual(activePointerBefore);
      }
      expect(nextSourcePath).toBeDefined();
      const journal = JSON.parse(await readFile(path.join(
        fixture.repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1/journal.json'
      ), 'utf8')) as { files: { pointer: { next: string } } };
      expect(await readFile(heldPath(nextSourcePath!)))
        .toEqual(Buffer.from(journal.files.pointer.next, 'base64'));
    }

    if (swapped) {
      if (replacementInstalled) {
        await rm(workPath, { recursive: true, force: true });
        replacementInstalled = false;
      }
      expect(await readFile(externalPointer, 'utf8')).toBe('external sentinel\n');
      await rename(heldWorkPath, workPath);
      swapped = false;
    }
    const recovered = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
    expect(parseActivePointer(await readFile(activePointer, 'utf8')).manifest)
      .toBe(FREEZE_TARGET_PATH);
    expect(await readFile(externalPointer, 'utf8')).toBe('external sentinel\n');
  }, async () => {
    // Restoration is a dependency chain, not independent best-effort cleanup.
    if (swapped) {
      if (replacementInstalled) {
        await rm(workPath, { recursive: true, force: true });
        replacementInstalled = false;
      }
      await rename(heldWorkPath, workPath);
      swapped = false;
    }
    await fixture.dispose();
  });
}, 60_000);

for (const faultAfter of [
  'after-pointer-pre-quarantine',
  'after-pointer-next-install'
] as const satisfies readonly FreezeFault[]) {
  test(`entry CAS rolls forward the exact ${faultAfter} crash state`, async () => {
    await withFreezeFixture(async (fixture) => {
      const entryEvents: Array<Readonly<{ label: string; sourcePath: string; targetPath: string }>> = [];
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        faultAfter,
        beforeAnchoredRename: (event) => {
          if (event.label.startsWith('Active pointer ')) entryEvents.push(event);
        }
      })).rejects.toThrow(faultAfter);
      const journal = JSON.parse(await readFile(
        path.join(fixture.repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1/journal.json'),
        'utf8'
      )) as {
        operationId: string;
        files: { pointer: { pre: string; next: string } };
      };
      const pointerPath = path.join(fixture.repositoryRoot, POINTER_PATH);
      const nextPath = path.join(
        path.dirname(pointerPath),
        `.${path.basename(pointerPath)}.${journal.operationId.slice('sha256:'.length)}.next`
      );
      const pre = Buffer.from(journal.files.pointer.pre, 'base64');
      const next = Buffer.from(journal.files.pointer.next, 'base64');
      const preRecoveryPaths = entryEvents
        .filter((event) => event.label.includes('PRE'))
        .map((event) => event.targetPath);
      expect(preRecoveryPaths.length).toBeGreaterThan(0);
      for (const recoveryPath of preRecoveryPaths) {
        expect(await readFile(recoveryPath)).toEqual(pre);
      }
      if (faultAfter === 'after-pointer-pre-quarantine') {
        await expect(readFile(pointerPath)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readFile(nextPath)).toEqual(next);
      } else {
        expect(await readFile(pointerPath)).toEqual(next);
      }

      const recovered = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
      expect(await readFile(pointerPath)).toEqual(next);
      await expect(readFile(nextPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  }, 60_000);
}

test('entry CAS preserves a target materialized after PRE quarantine', async () => {
  await withFreezeFixture(async (fixture) => {
    const unknown = Buffer.from('unknown target collision bytes\n', 'utf8');
    let nextSourcePath: string | undefined;
    const preRecoveryPaths: string[] = [];
    let injected = false;
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      beforeAnchoredRename: async (event) => {
        if (!event.label.startsWith('Active pointer ')) return;
        if (event.label.includes('PRE')) preRecoveryPaths.push(event.targetPath);
        if (!injected && event.label.includes('NEXT install')) {
          injected = true;
          nextSourcePath = event.sourcePath;
          await writeFile(event.targetPath, unknown);
        }
      }
    })).rejects.toThrow();
    expect(injected).toBe(true);
    const journal = JSON.parse(await readFile(
      path.join(fixture.repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1/journal.json'),
      'utf8'
    )) as { files: { pointer: { pre: string; next: string } } };
    const pre = Buffer.from(journal.files.pointer.pre, 'base64');
    const next = Buffer.from(journal.files.pointer.next, 'base64');
    expect(await readFile(path.join(fixture.repositoryRoot, POINTER_PATH))).toEqual(unknown);
    expect(nextSourcePath).toBeDefined();
    expect(await readFile(nextSourcePath!)).toEqual(next);
    expect(preRecoveryPaths.length).toBeGreaterThan(0);
    for (const recoveryPath of preRecoveryPaths) {
      expect(await readFile(recoveryPath)).toEqual(pre);
    }
  });
}, 60_000);

if (process.platform === 'linux') {
  test('Linux entry CAS blocks a swapped NEXT source after opening its exact fd', async () => {
    await withFreezeFixture(async (fixture) => {
      const unknown = Buffer.from('unknown Linux source collision bytes\n', 'utf8');
      let originalNextPath: string | undefined;
      let heldNextPath: string | undefined;
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        beforeAnchoredRename: async (event) => {
          if (originalNextPath !== undefined || event.label !== 'Active pointer exact NEXT install') return;
          originalNextPath = event.sourcePath;
          heldNextPath = `${event.sourcePath}.hook-held`;
          await rename(event.sourcePath, heldNextPath);
          await writeFile(event.sourcePath, unknown);
        }
      })).rejects.toMatchObject({ code: 'DOCUMENT-CONTROL-UNSAFE-PATH-001' });
      expect(originalNextPath).toBeDefined();
      expect(heldNextPath).toBeDefined();
      expect(await readFile(originalNextPath!)).toEqual(unknown);
      const journal = JSON.parse(await readFile(
        path.join(fixture.repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1/journal.json'),
        'utf8'
      )) as { files: { pointer: { next: string } } };
      expect(await readFile(heldNextPath!)).toEqual(Buffer.from(journal.files.pointer.next, 'base64'));
    });
  }, 60_000);
}

test('journal entry CAS preserves a concurrently materialized unknown canonical target', async () => {
  await withFreezeFixture(async (fixture) => {
    const unknown = Buffer.from('unknown canonical journal collision\n', 'utf8');
    let journalPath: string | undefined;
    let nextPath: string | undefined;
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      beforeAnchoredRename: async (event) => {
        if (journalPath !== undefined || !event.label.includes('Freeze journal prepared')
            || !event.label.includes('initial NEXT install')) return;
        journalPath = event.targetPath;
        nextPath = event.sourcePath;
        await writeFile(event.targetPath, unknown);
      }
    })).rejects.toThrow();
    expect(journalPath).toBeDefined();
    expect(nextPath).toBeDefined();
    expect(await readFile(journalPath!)).toEqual(unknown);
    expect(JSON.parse(await readFile(nextPath!, 'utf8'))).toMatchObject({ phase: 'prepared' });
  });
}, 60_000);

test('journal entry CAS blocks a name-swapped temporary NEXT source and preserves both entries', async () => {
  await withFreezeFixture(async (fixture) => {
    const unknown = Buffer.from('unknown journal temporary replacement\n', 'utf8');
    let journalPath: string | undefined;
    let nextPath: string | undefined;
    let heldPath: string | undefined;
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      beforeAnchoredRename: async (event) => {
        if (nextPath !== undefined || !event.label.includes('Freeze journal prepared')
            || !event.label.includes('initial NEXT install')) return;
        journalPath = event.targetPath;
        nextPath = event.sourcePath;
        heldPath = `${event.sourcePath}.hook-held`;
        await rename(event.sourcePath, heldPath);
        await writeFile(event.sourcePath, unknown);
      }
    })).rejects.toThrow();
    expect(journalPath).toBeDefined();
    expect(nextPath).toBeDefined();
    expect(heldPath).toBeDefined();
    await expect(readFile(journalPath!)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(nextPath!)).toEqual(unknown);
    expect(JSON.parse(await readFile(heldPath!, 'utf8'))).toMatchObject({ phase: 'prepared' });
  });
}, 60_000);

if (process.platform === 'win32') {
  test('exact cleanup preserves a replacement entry and fails closed after its opened-object byte check', async () => {
    await withFreezeFixture(async (fixture) => {
      const unknown = Buffer.from('unknown cleanup replacement\n', 'utf8');
      let cleanupPath: string | undefined;
      let heldPath: string | undefined;
      let heldBytes: Buffer | undefined;
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        beforeAnchoredCleanup: async (event) => {
          if (cleanupPath !== undefined || event.label !== 'Git index exact PRE quarantine cleanup') return;
          cleanupPath = event.filePath;
          heldPath = `${event.filePath}.hook-held`;
          heldBytes = await readFile(event.filePath);
          await rename(event.filePath, heldPath);
          await writeFile(event.filePath, unknown);
        }
      })).rejects.toBeInstanceOf(UnsafeAnchoredPathError);
      expect(cleanupPath).toBeDefined();
      expect(heldPath).toBeDefined();
      expect(await readFile(cleanupPath!)).toEqual(unknown);
      expect((await readFile(heldPath!)).equals(heldBytes!)).toBe(true);
    });
  }, 60_000);
}

for (const createKind of ['directory', 'file'] as const) {
  test(`anchored ${createKind} creation cannot be redirected by a pre-create parent junction swap`, async () => {
    const fixture = await createFreezeFixture();
    const transactionRoot = path.join(
      fixture.repositoryRoot,
      '.tmp/codex/document-control-plane-freeze-v1'
    );
    const parentPath = createKind === 'directory'
      ? path.join(fixture.repositoryRoot, '.tmp')
      : transactionRoot;
    const heldParentPath = `${parentPath}.hook-held`;
    const external = path.join(fixture.parent, `anchored-${createKind}-create-external`);
    const externalSentinel = path.join(external, 'sentinel.txt');
    let attempted = false;
    let swapped = false;
    let replacementInstalled = false;
    let swapFailure: NodeJS.ErrnoException | undefined;
    let targetName: string | undefined;
    await settleWorkspaceCallback(async () => {
      await rm(path.join(fixture.repositoryRoot, '.tmp'), { recursive: true, force: true });
      await mkdir(parentPath, { recursive: true });
      await mkdir(external);
      await writeFile(externalSentinel, 'outside sentinel\n', 'utf8');
      let freezeFailure: unknown;
      try {
        await freezeDocumentControlPlane({
          cwd: fixture.repositoryRoot,
          manifestPath: FREEZE_TARGET_PATH,
          reviewedOn: '2026-08-09',
          beforeAnchoredCreate: (event) => {
            const selected = createKind === 'directory'
              ? event.kind === 'directory'
                && event.parentPath === parentPath
                && event.targetPath === path.join(parentPath, 'codex')
              : event.kind === 'file' && event.label === 'Freeze journal prepared NEXT recovery entry';
            if (attempted || !selected) return;
            attempted = true;
            targetName = path.basename(event.targetPath);
            try {
              renameSync(parentPath, heldParentPath);
              swapped = true;
              symlinkSync(external, parentPath, 'junction');
              replacementInstalled = true;
            } catch (error) {
              swapFailure = error as NodeJS.ErrnoException;
              throw error;
            }
          }
        });
      } catch (error) {
        freezeFailure = error;
      }
      expect(attempted).toBe(true);
      expect(targetName).toBeDefined();
      expect(await readFile(externalSentinel, 'utf8')).toBe('outside sentinel\n');
      await expect(lstat(path.join(external, targetName!))).rejects.toMatchObject({ code: 'ENOENT' });
      if (!swapped) {
        expect(process.platform).toBe('win32');
        if (swapFailure === undefined || swapFailure.code === undefined) {
          throw new Error('Windows anchored create swap must fail with an explicit error code.');
        }
        expect(['EPERM', 'EBUSY']).toContain(swapFailure.code);
        expect(freezeFailure).toBe(swapFailure);
      } else {
        expect(['win32', 'linux']).toContain(process.platform);
        expect(freezeFailure).toBeInstanceOf(UnsafeAnchoredPathError);
        expect(freezeFailure).toMatchObject({ code: 'DOCUMENT-CONTROL-UNSAFE-PATH-001' });
      }

      if (swapped) {
        if (replacementInstalled) {
          await unlink(parentPath);
          replacementInstalled = false;
        }
        await rename(heldParentPath, parentPath);
        swapped = false;
      }
      const recovered = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
    }, async () => {
      // Failed restoration preserves the displaced tree instead of deleting the fixture.
      if (swapped) {
        if (replacementInstalled) {
          await unlink(parentPath);
          replacementInstalled = false;
        }
        await rename(heldParentPath, parentPath);
        swapped = false;
      }
      await fixture.dispose();
    });
  }, 90_000);
}

test('failed fresh-directory parent barriers precede freeze effects and remain recoverable', async () => {
  await withFreezeFixture(async (failedFixture) => {
    await rm(path.join(failedFixture.repositoryRoot, '.tmp'), { recursive: true, force: true });
    const preTree = runGit(failedFixture.repositoryRoot, ['write-tree']);
    await expect(freezeDocumentControlPlane({
      cwd: failedFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      beforeCreatedParentBarrier: ({ createdPath }) => {
        if (createdPath === path.join(failedFixture.repositoryRoot, '.tmp', 'codex')) {
          throw new Error('injected newly-created parent barrier failure');
        }
      }
    })).rejects.toBeInstanceOf(DurabilityBarrierError);
    await expect(readFile(
      path.join(failedFixture.repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1/journal.json')
    )).rejects.toMatchObject({ code: 'ENOENT' });
    expect(runGit(failedFixture.repositoryRoot, ['write-tree'])).toBe(preTree);
    const recovered = await freezeDocumentControlPlane({
      cwd: failedFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
  });

}, 60_000);

test('freeze rejects reparse and nonregular paths while ignoring an ambient outside index', async () => {
  await withFreezeFixture(async (journalFixture) => {
    const external = path.join(journalFixture.parent, 'journal-external');
    const codexRoot = path.join(journalFixture.repositoryRoot, '.tmp/codex');
    await mkdir(external, { recursive: true });
    await mkdir(codexRoot, { recursive: true });
    await symlink(
      external,
      path.join(codexRoot, 'document-control-plane-freeze-v1'),
      'junction'
    );
    await expectUnsafeReparseRejection(freezeDocumentControlPlane({
      cwd: journalFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    }));
  });

  await withFreezeFixture(async (documentTempFixture) => {
    await expect(freezeDocumentControlPlane({
      cwd: documentTempFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-journal-prepare'
    })).rejects.toThrow('after-journal-prepare');
    const journal = JSON.parse(await readFile(
      path.join(documentTempFixture.repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1/journal.json'),
      'utf8'
    )) as { operationId: string };
    const external = path.join(documentTempFixture.parent, 'document-temp-external');
    await mkdir(external);
    const pointerTemp = path.join(
      documentTempFixture.repositoryRoot,
      'config/repository',
      `.active-work-package.md.${journal.operationId.slice('sha256:'.length)}.next`
    );
    await symlink(external, pointerTemp, 'junction');
    await expectUnsafeReparseRejection(freezeDocumentControlPlane({
      cwd: documentTempFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    }));
  });

  await withFreezeFixture(async (indexLockFixture) => {
    await expect(freezeDocumentControlPlane({
      cwd: indexLockFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-journal-prepare'
    })).rejects.toThrow('after-journal-prepare');
    const indexCandidate = runGit(indexLockFixture.repositoryRoot, ['rev-parse', '--git-path', 'index']);
    const indexPath = path.isAbsolute(indexCandidate)
      ? indexCandidate
      : path.resolve(indexLockFixture.repositoryRoot, indexCandidate);
    await mkdir(`${indexPath}.lock`);
    await expect(freezeDocumentControlPlane({
      cwd: indexLockFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toBeInstanceOf(UnsafeAnchoredPathError);
  });

  await withFreezeFixture(async (outsideIndexFixture) => {
    const indexCandidate = runGit(outsideIndexFixture.repositoryRoot, ['rev-parse', '--git-path', 'index']);
    const indexPath = path.isAbsolute(indexCandidate)
      ? indexCandidate
      : path.resolve(outsideIndexFixture.repositoryRoot, indexCandidate);
    const outsideIndex = path.join(outsideIndexFixture.parent, 'outside.index');
    await copyFile(indexPath, outsideIndex);
    const outsideIndexBytes = await readFile(outsideIndex);
    const previousIndex = process.env.GIT_INDEX_FILE;
    let result: FreezeResult;
    try {
      process.env.GIT_INDEX_FILE = outsideIndex;
      result = await freezeDocumentControlPlane({
        cwd: outsideIndexFixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
    } finally {
      if (previousIndex === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = previousIndex;
    }
    expect(result.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
    expect(runGit(outsideIndexFixture.repositoryRoot, ['write-tree'])).toBe(result.candidateTreeSha);
    expect(await readFile(outsideIndex)).toEqual(outsideIndexBytes);
    await expectFreezeTransactionRetired(outsideIndexFixture.repositoryRoot);
  });

}, 90_000);

if (process.platform === 'win32') {
  test('ordinary Win32 ACL denial is not classified as reparse evidence', async () => {
    const fixture = await createFreezeFixture();
    let pointerTemp: string | undefined;
    let denyApplied = false;
    let primary: ResourceSettlementFailure | undefined;
    try {
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        faultAfter: 'after-journal-prepare'
      })).rejects.toThrow('after-journal-prepare');
      const journal = JSON.parse(await readFile(
        path.join(fixture.repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1/journal.json'),
        'utf8'
      )) as { operationId: string };
      pointerTemp = path.join(
        fixture.repositoryRoot,
        'config/repository',
        `.active-work-package.md.${journal.operationId.slice('sha256:'.length)}.next`
      );
      await writeFile(pointerTemp, 'ordinary ACL denial fixture\n', 'utf8');
      const deny = spawnSync('icacls', [pointerTemp, '/deny', '*S-1-1-0:(R)'], {
        cwd: fixture.repositoryRoot,
        encoding: 'utf8',
        windowsHide: true
      });
      expect(deny.status).toBe(0);
      denyApplied = true;

      const failure = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      }).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(failure).not.toBeInstanceOf(UnsafeAnchoredPathError);
      expect(failure).toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED' });
    } catch (error) {
      primary = { label: 'ordinary Win32 ACL denial test', error };
    } finally {
      await settleResourcesAsync({
        ...(primary === undefined ? {} : { primary }),
        cleanup: [
          {
            label: 'restore ordinary ACL fixture',
            settle: () => {
              if (!denyApplied || pointerTemp === undefined) return;
              const restore = spawnSync('icacls', [pointerTemp, '/remove:d', '*S-1-1-0'], {
                cwd: fixture.repositoryRoot,
                encoding: 'utf8',
                windowsHide: true
              });
              if (restore.status !== 0) {
                throw new Error(`Failed to restore ordinary ACL fixture: ${restore.stderr || restore.stdout}`);
              }
            }
          },
          { label: 'dispose ordinary ACL fixture', settle: () => fixture.dispose() }
        ]
      });
    }
  }, 30_000);
}

test('freeze preserves untracked work and joins directory, publication and parent barriers', async () => {
  await withFreezeFixture(async (fixture) => {
    await rm(path.join(fixture.repositoryRoot, '.tmp'), { recursive: true, force: true });
    await writeFile(path.join(fixture.repositoryRoot, 'user-notes.txt'), 'preserve me\n', 'utf8');
    const orderedEvents: string[] = [];
    const events: DurabilityEvent[] = [];
    const publications = new Set<string>();
    const canonicalTargets = [
      { path: repositoryIndexPath(fixture.repositoryRoot), key: 'git-index' },
      { path: path.join(fixture.repositoryRoot, POINTER_PATH), key: 'active-pointer' },
      { path: path.join(fixture.repositoryRoot, 'config/repository/rolling-plan.md'), key: 'rolling-plan' },
      { path: path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE, 'journal.json'), key: 'journal' }
    ];
    const result = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      createdParentBarrierObserver: ({ createdPath }) => {
        orderedEvents.push(`directory:${path.relative(fixture.repositoryRoot, createdPath)}`);
      },
      durabilityObserver: async (event) => {
        orderedEvents.push(`effect:${event.label}:${event.stage}`);
        events.push(event);
        if (event.stage !== 'renamed') return;
        const target = canonicalTargets.find((candidate) => path.relative(candidate.path, event.targetPath) === '');
        if (target === undefined) return;
        if (target.key === 'journal') {
          // Read the installed phase, not the physical edge's diagnostic label.
          // Retained Windows publication handles allow shared reads.
          const journal = JSON.parse(await readFile(event.targetPath, 'utf8')) as { phase: string };
          publications.add(`journal:${journal.phase}`);
        } else {
          publications.add(target.key);
        }
      }
    });
    expect(result.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
    expect(await readFile(path.join(fixture.repositoryRoot, 'user-notes.txt'), 'utf8')).toBe('preserve me\n');
    expect(runGit(fixture.repositoryRoot, ['diff', '--cached', '--name-only']))
      .not.toContain('user-notes.txt');
    const firstEffect = orderedEvents.findIndex((event) => event.startsWith('effect:'));
    expect(firstEffect).toBeGreaterThanOrEqual(3);
    expect(orderedEvents.slice(0, 3)).toEqual([
      'directory:.tmp',
      `directory:${path.join('.tmp', 'codex')}`,
      `directory:${path.join('.tmp', 'codex', 'document-control-plane-freeze-v1')}`
    ]);
    expect([...publications].sort()).toEqual([
      'journal:prepared',
      'git-index',
      'journal:index-published',
      'active-pointer',
      'journal:pointer-published',
      'rolling-plan',
      'journal:rolling-published',
      'journal:terminal'
    ].sort());
    // These are observed physical edges, including exact links on Linux;
    // this is not a census of every filesystem rename or recovery artifact.
    const renameIndexes = events
      .map((event, index) => event.stage === 'renamed' ? index : -1)
      .filter((index) => index >= 0);
    for (const index of renameIndexes) {
      const renamed = events[index]!;
      const transition = events.slice(index, index + 3);
      expect(transition.map((event) => [event.label, event.stage])).toEqual([
        [renamed.label, 'renamed'],
        [renamed.label, 'file-flushed'],
        [renamed.label, 'parent-barrier']
      ]);
      for (const event of transition) {
        expect(path.relative(renamed.targetPath, event.targetPath)).toBe('');
      }
    }
  });
}, 30_000);

test('unsupported parent barrier fails typed before index advancement and remains recoverable', async () => {
  await withFreezeFixture(async (fixture) => {
    const preTree = runGit(fixture.repositoryRoot, ['write-tree']);
    let failure: unknown;
    try {
      await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        parentDirectoryBarrier: async () => { throw new Error('unsupported fixture barrier'); }
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DurabilityBarrierError);
    expect(failure).toMatchObject({
      code: 'DOCUMENT-CONTROL-DURABILITY-001',
      operation: 'parent-directory-barrier'
    });
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(preTree);
    const transactionRoot = path.join(
      fixture.repositoryRoot,
      '.tmp/codex/document-control-plane-freeze-v1'
    );
    const canonicalJournalPath = path.join(transactionRoot, 'journal.json');
    await expect(readFile(canonicalJournalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const preparedEntries = (await readdir(transactionRoot)).filter((entry) => (
      /^journal\.json\.[0-9a-f]{64}\.prepared\.next$/u.test(entry)
    ));
    expect(preparedEntries).toHaveLength(1);
    const preparedMatch = /^journal\.json\.([0-9a-f]{64})\.prepared\.next$/u.exec(preparedEntries[0]!);
    expect(preparedMatch).not.toBeNull();
    const preparedPath = path.join(transactionRoot, preparedEntries[0]!);
    const preparedBytes = await readFile(preparedPath);
    const prepared = JSON.parse(preparedBytes.toString('utf8')) as {
      schema: string;
      phase: string;
      operationId: string;
      manifestDigest: string;
      candidateTreeSha: string;
      result: {
        operationId: string;
        manifestDigest: string;
        candidateTreeSha: string;
      };
    };
    expect(preparedBytes).toEqual(Buffer.from(`${JSON.stringify(prepared, null, 2)}\n`, 'utf8'));
    const preparedOperationId = prepared.operationId;
    const preparedManifestDigest = prepared.manifestDigest;
    expect(prepared.phase).toBe('prepared');
    expect(prepared).not.toHaveProperty('retainedTemporaryIndexName');
    expect(preparedOperationId).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(preparedManifestDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const validatedPreparedOperationId = preparedOperationId as `sha256:${string}`;
    expect(preparedMatch![1]).toBe(validatedPreparedOperationId.slice('sha256:'.length));
    expect(prepared.result).toMatchObject({
      operationId: validatedPreparedOperationId,
      manifestDigest: preparedManifestDigest,
      candidateTreeSha: prepared.candidateTreeSha
    });

    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-index-lock-write'
    })).rejects.toThrow('after-index-lock-write');
    await expect(readFile(preparedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(transactionRoot)).filter((entry) => JOURNAL_ACTIVE_NEXT.test(entry))).toEqual([]);
    expect(await readFile(canonicalJournalPath)).toEqual(Buffer.from(preparedBytes));
    if (process.platform === 'linux') {
      const retiredNextPath = journalRetiredNextPath(transactionRoot, preparedBytes);
      expect(await readFile(retiredNextPath)).toEqual(Buffer.from(preparedBytes));
      const canonicalMetadata = await lstat(canonicalJournalPath);
      const retiredMetadata = await lstat(retiredNextPath);
      expect({ dev: retiredMetadata.dev, ino: retiredMetadata.ino }).toEqual({
        dev: canonicalMetadata.dev,
        ino: canonicalMetadata.ino
      });
    }

    const recovered = await freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
    expect(recovered.operationId).toBe(validatedPreparedOperationId);
    const finalTree = runGit(fixture.repositoryRoot, ['write-tree']);
    expect(finalTree).toBe(recovered.candidateTreeSha);
    expect(finalTree).toBe(prepared.candidateTreeSha);
    expect(finalTree).not.toBe(preTree);
    await expectFreezeTransactionRetired(fixture.repositoryRoot);
  });
}, 30_000);

test('a complete terminal transaction recovers after the whole worktree moves', async () => {
  await withFreezeFixture(async (fixture) => {
    const movedRoot = path.join(fixture.parent, 'repository-moved');
    await expect(freezeDocumentControlPlane({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-terminal'
    })).rejects.toThrow('after-terminal');
    const terminal = JSON.parse(await readFile(
      path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE, 'journal.json'),
      'utf8'
    )) as RecoveryJournalView;
    expect(terminal.phase).toBe('terminal');
    await rename(fixture.repositoryRoot, movedRoot);
    const recovered = await freezeDocumentControlPlane({
      cwd: movedRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(recovered).toEqual(terminal.result);
    expect(recovered.candidateHeadSha).toBeNull();
    expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
    await expectFreezeTransactionRetired(movedRoot);
  });
}, 60_000);

if (process.platform === 'linux') {
  test('terminal retirement resumes from one exact already-deleted recovery prefix', async () => {
    await withFreezeFixture(async (fixture) => {
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        faultAfter: 'after-terminal'
      })).rejects.toThrow('after-terminal');
      const gitDirectory = path.dirname(repositoryIndexPath(fixture.repositoryRoot));
      const firstCanonicalDeletion = (await readdir(gitDirectory))
        .find((name) => name.startsWith('.entry-') && name.endsWith('.retired-next'));
      expect(firstCanonicalDeletion).toBeDefined();
      await unlink(path.join(gitDirectory, firstCanonicalDeletion!));
      const recovered = await freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
      await expectFreezeTransactionRetired(fixture.repositoryRoot);
    });
  }, 60_000);

  test('terminal retirement preserves and blocks one non-prefix Git-index hole', async () => {
    await withFreezeFixture(async (fixture) => {
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        faultAfter: 'after-terminal'
      })).rejects.toThrow('after-terminal');
      const gitDirectory = path.dirname(repositoryIndexPath(fixture.repositoryRoot));
      const lastIndexDeletion = (await readdir(gitDirectory))
        .find((name) => name.startsWith('.entry-') && name.endsWith('.pre'));
      expect(lastIndexDeletion).toBeDefined();
      await unlink(path.join(gitDirectory, lastIndexDeletion!));
      const recoveryBefore = await readEntryRecoveryByteSnapshot(gitDirectory);
      const effectsBefore = await readFreezeEffectSnapshot(fixture.repositoryRoot);
      await expect(freezeDocumentControlPlane({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      })).rejects.toThrow('not one exact canonical deletion prefix');
      expect(await readEntryRecoveryByteSnapshot(gitDirectory)).toEqual(recoveryBefore);
      expect(await readFreezeEffectSnapshot(fixture.repositoryRoot)).toEqual(effectsBefore);
    });
  }, 60_000);
}

test('repository control artifacts bind the indexed manifest and one bounded rolling window', async () => {
  const [currentStateSource, pointerSource, rollingPlan] = await Promise.all([
    readFile(CURRENT_STATE_PATH, 'utf8'),
    readFile(POINTER_PATH, 'utf8'),
    readFile('config/repository/rolling-plan.md', 'utf8')
  ]);
  const currentState = parseCurrentStateSpec(currentStateSource);
  const pointer = parseActivePointer(pointerSource);
  const manifestBlob = readGitBlob(process.cwd(), `:${pointer.manifest}`);
  const activePackageId = path.basename(pointer.manifest, '.md');

  expect(currentState.resolver).toEqual({
    command: 'bun src/adapters/self-hosting/control/documentation/document-control-plane.ts status --json',
    repository: 'sec-platform/sec',
    remote: 'origin',
    defaultBranch: 'main',
    defaultRef: 'refs/remotes/origin/main',
    requireRemoteMatch: true
  });
  expect(currentStateSource).not.toContain('basisMainSha');
  expect(currentStateSource).not.toContain('openPullRequests');
  expect(currentStateSource).not.toContain('nextReconciliationPoint');
  expect(manifestBlob).toBeDefined();
  expect(pointer.manifestDigest).toBe(
    CodexDevelopmentWorkPackageManifestDigest(manifestBlob!) as `sha256:${string}`
  );

  const parsedRollingPlan = parseRollingPlan(rollingPlan);
  expect(parsedRollingPlan.activePackageId).toBe(activePackageId);
  expect(parsedRollingPlan.candidatePackageIds.length).toBeLessThanOrEqual(5);
});

for (const faultAfter of ['after-journal-index-published-next-install'] as const) {
  test(`V3 reader resumes the existing freeze tuple after ${faultAfter} and retires its journal`, async () => {
    await withFreezeFixture(async (fixture) => {
      const manifestFile = path.join(fixture.repositoryRoot, FREEZE_TARGET_PATH);
      const source = (await readFile(manifestFile, 'utf8'))
        .replace('codex-development-work-package-v1', 'codex-development-work-package-v3')
        .replace(`base: ${fixture.baseSha}\n`, '');
      await writeFile(manifestFile, source, 'utf8');
      runGit(fixture.repositoryRoot, ['add', FREEZE_TARGET_PATH]);
      await expect(freezeDocumentControlPlane({ cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH, reviewedOn: '2026-08-09', faultAfter })).rejects.toThrow(faultAfter);
      const journalPath = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE, 'journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalView;
      expect(journal.phase).toBe('index-published');
      const recovered = await freezeDocumentControlPlane({ cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH, reviewedOn: '2026-08-09' });
      expect(recovered.operationId).toBe(journal.operationId);
      expect(recovered.candidateTreeSha).toBe(journal.candidateTreeSha);
      expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(journal.candidateTreeSha);
      expect(await readFile(manifestFile, 'utf8')).toBe(source);
      expect(runGit(fixture.repositoryRoot, ['ls-files', '--', CURRENT_ACTIVE_PATH])).toBe('');
      await expectFreezeTransactionRetired(fixture.repositoryRoot);
    });
  }, 60_000);
}
