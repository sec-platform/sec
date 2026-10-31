import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import { createMainHealthRepairWorkPackagePath } from '../../../src/adapters/self-hosting/control/main-health/contract.ts';
import type { CurrentWorkLifecycle } from '../../../src/adapters/self-hosting/control/work-selection/contract.ts';
import {
  ROADMAP_WORK_CATALOG_BEGIN,
  ROADMAP_WORK_CATALOG_END,
  assertRoadmapTerminalCompactionCandidate,
  assertRoadmapTerminalCompactionDelta,
  compileRoadmapTerminalCompaction,
  compileWorkRollingSelectionProjection,
  compileWorkRollingTopology,
  compileWorkRollingTransitionProjection,
  compileWorkSelectionTerminalProjection,
  createWorkCurrentSpecObservation,
  createWorkDecisionReceipt,
  createWorkRegistryObservation,
  currentSpecRevisionFromBody,
  parseRoadmapWorkCatalog,
  parseWorkRollingMachineProjection,
  renderWorkRollingSelectionPlan,
  renderWorkRollingTransitionPlan,
  type RoadmapWorkCatalog,
  type WorkCurrentSpecObservation,
  type WorkRegistryObservation
} from '../../../src/adapters/self-hosting/control/work-selection/live-contract.ts';
import {
  isExactWorkSelectionActiveIdentity,
  isWorkSelectionProspectiveTransport,
  observeRoadmapTerminalCompactionCandidate,
  observeWorkSelectionLive,
  observeWorkSelectionWithProvider,
  requireResolvedWorkDecisionReceipt,
  type WorkSelectionProvider
} from '../../../src/adapters/self-hosting/control/work-selection/runtime.ts';
import { rawSha256, sha256 } from '../../../src/contracts/canonical.ts';

const exactMain = 'a'.repeat(40);
const exactMainTree = 'b'.repeat(40);

type CatalogObservation = Readonly<{
  source: string;
  roadmapRevision: ReturnType<typeof rawSha256>;
  catalog: RoadmapWorkCatalog;
}>;

function observeCatalog(source: string): CatalogObservation {
  return Object.freeze({
    source,
    roadmapRevision: rawSha256(source),
    catalog: parseRoadmapWorkCatalog(source)
  });
}

function runFixtureGit(root: string, args: readonly string[]): Buffer {
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'buffer',
    windowsHide: true,
    env: { ...process.env,
      GIT_AUTHOR_NAME: 'SEC Test', GIT_AUTHOR_EMAIL: 'sec-test@example.invalid',
      GIT_COMMITTER_NAME: 'SEC Test', GIT_COMMITTER_EMAIL: 'sec-test@example.invalid'
    }
  });
  if (result.status !== 0) {
    throw new Error(Buffer.from(result.stderr ?? '').toString('utf8'));
  }
  return Buffer.from(result.stdout ?? '');
}

function fixtureGitSha(root: string, ref: string): string {
  return runFixtureGit(root, ['rev-parse', ref]).toString('utf8').trim();
}

function transitionCatalog(): CatalogObservation {
  const item = (packageId: string, issue: number, evidence: string,
    overrides: Partial<RoadmapWorkCatalog['items'][number]> = {}) => ({
    packageId, workId: `issue-${issue}`, tracking: `issue-${issue}`,
    currentSpecRef: `github:issue/${issue}`, ownerRef: `github:issue/${issue}`,
    kind: 'focused', disposition: 'active', priorityClass: 'active-critical-path',
    priorityEvidenceRefs: [evidence], prerequisiteWorkIds: [], orderedAfterWorkIds: [],
    reproductionOrEvidenceFreshness: 'fresh', rootCauseState: 'repeat-root-cause',
    rootCauseRef: `github:issue/${issue}`, scopeClosure: 'closed',
    exitCriteriaRef: `github:issue/${issue}#acceptance`, nearTermConsumerRef: null,
    humanDecisionRef: null, ...overrides
  });
  const items = [
    item('operation-read-plan-authority-canary-v1', 346, 'fixture:read-fast-path'),
    item('controlled-pr-issue-disposition-single-writer-v1', 352, 'fixture:controlled-pr-single-writer', {
      prerequisiteWorkIds: ['issue-346'], exitCriteriaRef: 'github:issue/352#root-design',
      nearTermConsumerRef: 'github:issue/186'
    }),
    item('generated-ignored-state-lifecycle-v1', 271, 'fixture:generated-state-settlement', {
      kind: 'program', orderedAfterWorkIds: ['issue-352'], exitCriteriaRef: 'github:issue/271#completion',
      nearTermConsumerRef: 'github:issue/186'
    }),
    item('git-worktree-physical-closeout-v1', 186, 'fixture:worktree-closeout', {
      kind: 'program', prerequisiteWorkIds: ['issue-352', 'issue-271'],
      exitCriteriaRef: 'github:issue/186#completion'
    }),
    item('delegation-consumer-zero-retirement-v1', 275, 'fixture:guidance-convergence', {
      kind: 'program', prerequisiteWorkIds: ['issue-186'], exitCriteriaRef: 'github:issue/275#completion'
    }),
    item('candidate-control-transaction-v1', 321, 'fixture:candidate-control', {
      prerequisiteWorkIds: ['issue-275'], rootCauseRef: 'github:issue/321#candidate-control-transaction',
      exitCriteriaRef: 'github:issue/321#candidate-control-transaction'
    }),
    item('typescript-7-checker-acceleration-v1', 312, 'fixture:checker-acceleration', {
      disposition: 'deferred', priorityClass: 'near-term-acceleration', prerequisiteWorkIds: ['issue-346'],
      rootCauseState: 'not-repeated', nearTermConsumerRef: 'github:issue/316'
    })
  ];
  return observeCatalog(
    `${ROADMAP_WORK_CATALOG_BEGIN}\n\`\`\`json\n${JSON.stringify({
      schema: 'sec-roadmap-work-catalog-v1',
      stageRef: 'fixture-work-selection-transition',
      items
    }, null, 2)}\n\`\`\`\n${ROADMAP_WORK_CATALOG_END}`
  );
}

function lifecycle(): CurrentWorkLifecycle {
  return {
    activeWorkId: null,
    activeRef: null,
    activeState: 'none',
    activeLegality: 'not-applicable',
    mainHealthState: 'healthy',
    mainHealthRef: sha256({ exactMain, exactMainTree }),
    closeoutState: 'none',
    closeoutRef: sha256({ refs: [] }),
    controlState: 'consistent',
    controlRef: sha256({ pointer: 'bound' })
  };
}

function specs(catalog: RoadmapWorkCatalog): WorkCurrentSpecObservation[] {
  return catalog.items.map((item) => createWorkCurrentSpecObservation({
    workId: item.workId,
    currentSpecRef: item.currentSpecRef,
    providerResourceRef: `github-node:${item.tracking}`,
    providerState: 'open',
    currentSpecRevision: currentSpecRevisionFromBody(`current spec bytes for ${item.workId}`)
  }));
}

function registry(
  catalog: RoadmapWorkCatalog,
  completedWorkIds: readonly string[] = []
): WorkRegistryObservation {
  return createWorkRegistryObservation({
    defaultTreeSha: exactMainTree,
    entries: completedWorkIds.map((workId, index) => {
      const item = catalog.items.find((candidate) => candidate.workId === workId)!;
      return {
        manifestPath: `config/repository/work-packages/${item.packageId}.md`,
        manifestDigest: sha256({ fixture: 'registry-manifest', workId, index }) as `sha256:${string}`,
        source: 'default' as const,
        prNumber: null,
        baseSha: null,
        headSha: null,
        headTreeSha: null
      };
    })
  });
}

function receiptForCatalog(
  observation: CatalogObservation,
  completedWorkIds: readonly string[] = [],
  current: CurrentWorkLifecycle = lifecycle()
) {
  const { catalog, roadmapRevision } = observation;
  return createWorkDecisionReceipt({
    repository: 'sec-platform/sec',
    exactMain,
    exactMainTree,
    roadmapRevision,
    catalog,
    registry: registry(catalog, completedWorkIds),
    current,
    currentSpecs: specs(catalog)
  });
}

describe('work-selection live contract', () => {

  test('MainHealth repair and locked routes stop before roadmap, Issue, PR, registry, or branch census', async () => {
    const currentStateBytes = readFileSync('config/repository/current-state.yaml');
    for (const [state, reasonCode] of [
      ['unhealthy', 'main-health-repair-only'],
      ['unresolved', 'main-health-locked']
    ] as const) {
      const commands: Array<Readonly<{ command: 'gh' | 'git'; args: readonly string[] }>> = [];
      const provider: WorkSelectionProvider = (command, args) => {
        commands.push({ command, args: [...args] });
        if (command === 'gh') {
          return { status: 97, stdout: Buffer.alloc(0), stderr: Buffer.from('selector census forbidden') };
        }
        const key = args.join('\0');
        const stdout = key === 'rev-parse\0--show-toplevel'
          ? Buffer.from(`${process.cwd()}\n`)
          : key === 'for-each-ref\0--format=%(refname)%00%(symref)\0refs/remotes/*/HEAD'
            ? Buffer.from('refs/remotes/origin/HEAD\0refs/remotes/origin/main\n')
            : key === 'show\0refs/remotes/origin/main:config/repository/current-state.yaml'
                || key === `show\0${exactMain}:config/repository/current-state.yaml`
              ? currentStateBytes
              : key === 'rev-parse\0--verify\0refs/remotes/origin/main'
                ? Buffer.from(`${exactMain}\n`)
                : key === `rev-parse\0${exactMain}^{tree}`
                  ? Buffer.from(`${exactMainTree}\n`)
                  : null;
        return stdout === null
          ? { status: 98, stdout: Buffer.alloc(0), stderr: Buffer.from(`unexpected selector command: ${key}`) }
          : { status: 0, stdout, stderr: Buffer.alloc(0) };
      };
      let mainHealthObservations = 0;
      const result = await observeWorkSelectionWithProvider({
        cwd: process.cwd(),
        exactMain,
        exactMainTree
      }, provider, async () => {
        mainHealthObservations += 1;
        return { state, ref: rawSha256(`main-health-${state}`) };
      });

      expect(result).toMatchObject({
        status: 'unresolved',
        reasonCodes: [reasonCode],
        blockerRefs: [rawSha256(`main-health-${state}`)]
      });
      expect(mainHealthObservations).toBe(1);
      expect(commands.every(({ command }) => command === 'git')).toBe(true);
      expect(commands.some(({ args }) => args.some((argument) => argument.includes('config/repository/work-selection.md'))))
        .toBe(false);
    }
  });

  test('production observation fails closed when Git authority is unavailable', async () => {
    const missingCwd = path.join(tmpdir(), 'sec-work-selection-provider-admission-missing');
    const result = await observeWorkSelectionLive({ cwd: missingCwd } as never);
    expect(result).toMatchObject({
      status: 'unresolved',
      reasonCodes: ['git-read-provider-unavailable']
    });
    expect(result.blockerRefs).toEqual([expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)]);
    expect(JSON.stringify(result)).not.toContain(missingCwd);
  });

  test('branch namespace never grants or denies prospective transport identity', () => {
    for (const currentBranch of ['fix/main-health', 'refactor/test-architecture', 'codex/legacy-bootstrap']) {
      expect(isWorkSelectionProspectiveTransport({
        currentBranch,
        currentHead: exactMain,
        defaultBranch: 'main',
        exactMain
      })).toBe(true);
    }
    for (const input of [
      { currentBranch: '', currentHead: exactMain },
      { currentBranch: 'main', currentHead: exactMain },
      { currentBranch: 'codex/legacy-bootstrap', currentHead: 'c'.repeat(40) }
    ]) {
      expect(isWorkSelectionProspectiveTransport({
        ...input,
        defaultBranch: 'main',
        exactMain
      })).toBe(false);
    }
  });

  test('open PR legality depends on exact lifecycle facts and not branch namespace', () => {
    const exact = (branch: string) => ({
      activeState: 'incomplete' as const,
      activeBranch: branch,
      activeHeadSha: 'c'.repeat(40),
      activeLegality: 'legal' as const,
      pullRequestHeadBranch: branch,
      pullRequestHeadSha: 'c'.repeat(40),
      registryHeadSha: 'c'.repeat(40),
      registryBaseSha: exactMain,
      pullRequestBaseSha: exactMain
    });
    expect(isExactWorkSelectionActiveIdentity(exact('fix/main-health'))).toBe(true);
    expect(isExactWorkSelectionActiveIdentity(exact('refactor/test-architecture'))).toBe(true);
    expect(isExactWorkSelectionActiveIdentity({
      ...exact('codex/legacy-bootstrap'),
      registryBaseSha: 'd'.repeat(40)
    })).toBe(false);
    expect(isExactWorkSelectionActiveIdentity({
      ...exact('codex/legacy-bootstrap'),
      activeLegality: 'invalid'
    })).toBe(false);
  });

  test('roadmap parser rejects ambiguous catalog identity and dependency order', () => {
    const { source: roadmapSource, catalog } = transitionCatalog();
    expect(new Set(catalog.items.map(({ packageId }) => packageId)).size)
      .toBe(catalog.items.length);
    expect(() => parseRoadmapWorkCatalog(
      `${roadmapSource}\n${ROADMAP_WORK_CATALOG_BEGIN}`
    )).toThrow(/exactly one ordered catalog marker pair/u);
    const first = catalog.items[0]!;
    const last = catalog.items.at(-1)!;
    expect(() => parseRoadmapWorkCatalog(roadmapSource.replace(
      `"currentSpecRef": "${first.currentSpecRef}"`,
      '"currentSpecRef": "github:issue/999"'
    ))).toThrow(/must bind the same Issue identity/u);
    expect(() => parseRoadmapWorkCatalog(roadmapSource.replace(
      `"workId": "${first.workId}"`,
      `"workId": "${first.workId}-slice"`
    ))).toThrow(/workId must equal its canonical tracking identity/u);
    expect(() => parseRoadmapWorkCatalog(roadmapSource.replace(
      `"ownerRef": "${first.ownerRef}"`,
      `"ownerRef": "${first.ownerRef}#slice"`
    ))).toThrow(/ownerRef must equal its canonical currentSpecRef/u);
    expect(() => parseRoadmapWorkCatalog(roadmapSource.replace(
      '"prerequisiteWorkIds": [],\n      "orderedAfterWorkIds": []',
      `"prerequisiteWorkIds": ["${last.workId}"],\n      "orderedAfterWorkIds": []`
    ))).toThrow(/must precede it in roadmap order/u);
    expect(() => parseRoadmapWorkCatalog(roadmapSource.replace(
      '"schema": "sec-roadmap-work-catalog-v1",',
      '"schema": "sec-roadmap-work-catalog-v1",\n  "schema": "sec-roadmap-work-catalog-v1",'
    ))).toThrow(/duplicate key "schema"/u);
    expect(() => parseRoadmapWorkCatalog(roadmapSource.replace(
      `"tracking": "${first.tracking}",`,
      `"tracking": "${first.tracking}",\n      "tracking": "${first.tracking}",`
    ))).toThrow(/duplicate key "tracking"/u);
  });

  test('terminal selection projection binds closed provider evidence and keeps only live work', () => {
    const prior = transitionCatalog();
    const currentSpecs = specs(prior.catalog).map((entry) => entry.workId === 'issue-271'
      ? createWorkCurrentSpecObservation({
          ...entry,
          providerState: 'closed'
        })
      : entry);
    const projection = compileWorkSelectionTerminalProjection({
      roadmapSource: prior.source,
      currentSpecs
    });

    expect(projection.terminalCompaction?.retiredWorkIds).toEqual(['issue-271']);
    expect(projection.demandGraph.transitionDemands).toEqual(['roadmap-terminal-compaction']);
    expect(projection.demandGraph.capabilityDemands).toEqual([]);
    expect(projection.terminalCompaction?.demandGraphDigest)
      .toBe(projection.demandGraph.graphDigest);
    expect(projection.catalog.items.map(({ workId }) => workId)).not.toContain('issue-271');
    expect(projection.currentSpecs.map(({ workId }) => workId)).not.toContain('issue-271');
    expect(projection.roadmapRevision).not.toBe(rawSha256(prior.source));
    const compaction = projection.terminalCompaction!;
    expect(compaction.catalog.items.find(({ workId }) => workId === 'issue-186'))
      .toMatchObject({ prerequisiteWorkIds: ['issue-352'] });
    expect(compaction.delayedManifestRetirementPaths).toEqual([
      'config/repository/work-packages/generated-ignored-state-lifecycle-v1.md'
    ]);
    expect(compaction.demandGraphDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(parseRoadmapWorkCatalog(compaction.roadmapSource).catalogDigest)
      .toBe(compaction.catalog.catalogDigest);
    expect(() => assertRoadmapTerminalCompactionCandidate({
      compaction: projection.terminalCompaction!,
      roadmapSource: projection.terminalCompaction!.roadmapSource,
      presentDelayedManifestPaths:
        projection.terminalCompaction!.delayedManifestRetirementPaths
    })).not.toThrow();
    expect(() => assertRoadmapTerminalCompactionCandidate({
      compaction: projection.terminalCompaction!,
      roadmapSource: projection.terminalCompaction!.roadmapSource,
      presentDelayedManifestPaths: []
    })).toThrow(/must retain every pointer-bound manifest/u);
  });

  test('terminal compaction preserves the exact manifest subgraph for successor freeze', () => {
    const prior = transitionCatalog();
    const compaction = compileRoadmapTerminalCompaction({
      roadmapSource: prior.source,
      completedWorkIds: ['issue-271']
    });
    const manifestPath = 'config/repository/work-packages/generated-ignored-state-lifecycle-v1.md';
    expect(() => assertRoadmapTerminalCompactionDelta({
      priorRoadmapSource: prior.source,
      roadmapSource: prior.source,
      priorManifestPaths: [manifestPath],
      manifestPaths: [manifestPath, 'config/repository/work-packages/new-selected-v1.md']
    })).not.toThrow();
    expect(() => assertRoadmapTerminalCompactionDelta({
      priorRoadmapSource: prior.source,
      roadmapSource: compaction.roadmapSource,
      priorManifestPaths: [manifestPath],
      manifestPaths: [manifestPath]
    })).not.toThrow();
    expect(() => assertRoadmapTerminalCompactionDelta({
      priorRoadmapSource: prior.source,
      roadmapSource: compaction.roadmapSource,
      priorManifestPaths: [manifestPath, 'config/repository/work-packages/survivor-v1.md'],
      manifestPaths: ['config/repository/work-packages/new-selected-v1.md']
    })).toThrow(/cannot mutate the manifest set/u);
    expect(() => assertRoadmapTerminalCompactionDelta({
      priorRoadmapSource: prior.source,
      roadmapSource: compaction.roadmapSource,
      priorManifestPaths: [manifestPath],
      manifestPaths: []
    })).toThrow(/cannot mutate the manifest set/u);
  });

  test('changing Issue evidence anchors is not misclassified as terminal work', () => {
    const prior = transitionCatalog();
    const migrated = prior.source
      .replaceAll('"github:issue/321#candidate-control-transaction"', '"github:issue/321"');
    expect(migrated).not.toBe(prior.source);
    expect(() => assertRoadmapTerminalCompactionDelta({
      priorRoadmapSource: prior.source,
      roadmapSource: migrated,
      priorManifestPaths: [],
      manifestPaths: []
    })).not.toThrow();
  });

  test.serial('live provider replay binds the exact terminal PR and rejects unavailable or path-drifted heads', async () => {
    const fixtureParent = mkdtempSync(path.join(tmpdir(), 'sec-terminal-provider-replay-'));
    const root = path.join(fixtureParent, 'repository');
    await settleWorkspaceCallback(async () => {
      // The live reader consumes the exact control files and refs built below,
      // not this repository's unrelated source tree or prior commit history.
      mkdirSync(root);
      runFixtureGit(root, ['init', '--quiet', '-b', 'main']);
      expect(() => lstatSync(path.join(root, '.git', 'objects', 'info', 'alternates')))
        .toThrow(expect.objectContaining({ code: 'ENOENT' }));
      runFixtureGit(root, ['commit', '--quiet', '--allow-empty', '-m', 'fixture: seed']);

      const prior = transitionCatalog();
      const seedSha = fixtureGitSha(root, 'HEAD');
      const packageId = 'git-worktree-physical-closeout-v1';
      const manifestPath = `config/repository/work-packages/${packageId}.md`;
      const manifestSource = `---\n`
        + `schema: codex-development-work-package-v1\n`
        + `id: ${packageId}\ntracking: issue-186\nbase: ${seedSha}\n`
        + `manifestState: frozen\nrequiredProfile: quick\nciRevision: ci-verification-v19\n`
        + `authorityRefs:\n  - development-governance\n`
        + `tasks:\n  - id: terminal-fixture\n    owner: development-governance-owner\n`
        + `    ownedPaths:\n      - ${manifestPath}\n`
        + `forbiddenPaths:\n  - package.json\n`
        + `acceptance:\n  - terminal fixture remains self contained\n`
        + `tests:\n  - tests/unit/development/work-selection-live.test.ts\n---\n`;
      const manifestDirectory = path.join(root, 'config', 'repository', 'work-packages');
      mkdirSync(manifestDirectory, { recursive: true });
      writeFileSync(
        path.join(root, 'config', 'repository', 'current-state.yaml'),
        readFileSync(path.join(process.cwd(), 'config', 'repository', 'current-state.yaml'))
      );
      writeFileSync(path.join(root, manifestPath), manifestSource, 'utf8');
      writeFileSync(path.join(root, 'config', 'repository', 'work-selection.md'), prior.source, 'utf8');
      runFixtureGit(root, ['add', '--', 'config/repository']);
      runFixtureGit(root, ['commit', '--quiet', '-m', 'fixture: terminal base']);
      const baseSha = fixtureGitSha(root, 'HEAD');
      const baseTreeSha = fixtureGitSha(root, 'HEAD^{tree}');
      runFixtureGit(root, ['update-ref', 'refs/remotes/origin/main', baseSha]);
      runFixtureGit(root, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);

      const compaction = compileRoadmapTerminalCompaction({
        roadmapSource: prior.source,
        completedWorkIds: ['issue-186']
      });
      runFixtureGit(root, ['checkout', '--quiet', '-b', 'terminal-compaction']);
      writeFileSync(path.join(root, 'config', 'repository', 'work-selection.md'), compaction.roadmapSource, 'utf8');
      runFixtureGit(root, ['add', '--', 'config/repository/work-selection.md']);
      runFixtureGit(root, ['commit', '--quiet', '-m', 'fixture: terminal candidate']);
      const headSha = fixtureGitSha(root, 'HEAD');
      const headTreeSha = fixtureGitSha(root, 'HEAD^{tree}');

      const independentItem = prior.catalog.items.find(({ workId }) => workId !== 'issue-186')!;
      const independentManifestPath = `config/repository/work-packages/${independentItem.packageId}.md`;
      runFixtureGit(root, ['checkout', '--quiet', '-b', 'independent-review', baseSha]);
      writeFileSync(path.join(root, independentManifestPath), `---\n`
        + `schema: codex-development-work-package-v1\n`
        + `id: ${independentItem.packageId}\ntracking: ${independentItem.tracking}\nbase: ${baseSha}\n`
        + `manifestState: frozen\nrequiredProfile: quick\nciRevision: ci-verification-v19\n`
        + `tasks:\n  - id: independent-fixture\n    owner: development-governance-owner\n`
        + `    ownedPaths:\n      - ${independentManifestPath}\n`
        + `forbiddenPaths:\n  - package.json\n`
        + `acceptance:\n  - independent fixture remains exact\n`
        + `tests:\n  - tests/unit/development/work-selection-live.test.ts\n---\n`, 'utf8');
      runFixtureGit(root, ['add', '--', independentManifestPath]);
      runFixtureGit(root, ['commit', '--quiet', '-m', 'fixture: independent candidate']);
      const independentHeadSha = fixtureGitSha(root, 'HEAD');
      const secondaryItem = prior.catalog.items.find(({ workId }) => (
        workId !== 'issue-186' && workId !== independentItem.workId
      ))!;
      const secondaryManifestPath = `config/repository/work-packages/${secondaryItem.packageId}.md`;
      runFixtureGit(root, ['checkout', '--quiet', '-b', 'secondary-review', baseSha]);
      writeFileSync(path.join(root, secondaryManifestPath), `---\n`
        + `schema: codex-development-work-package-v1\n`
        + `id: ${secondaryItem.packageId}\ntracking: ${secondaryItem.tracking}\nbase: ${baseSha}\n`
        + `manifestState: frozen\nrequiredProfile: quick\nciRevision: ci-verification-v19\n`
        + `tasks:\n  - id: secondary-fixture\n    owner: development-governance-owner\n`
        + `    ownedPaths:\n      - ${secondaryManifestPath}\n`
        + `forbiddenPaths:\n  - package.json\n`
        + `acceptance:\n  - secondary fixture remains exact\n`
        + `tests:\n  - tests/unit/development/work-selection-live.test.ts\n---\n`, 'utf8');
      runFixtureGit(root, ['add', '--', secondaryManifestPath]);
      runFixtureGit(root, ['commit', '--quiet', '-m', 'fixture: secondary candidate']);
      const secondaryHeadSha = fixtureGitSha(root, 'HEAD');
      runFixtureGit(root, ['checkout', '--quiet', 'terminal-compaction']);

      const issueRecords = Object.fromEntries(prior.catalog.items.map((item, index) => [
        `i${index}`,
        {
          number: Number(item.currentSpecRef.slice('github:issue/'.length)),
          id: `fixture-node-${item.tracking}`,
          state: item.workId === 'issue-186' ? 'CLOSED' : 'OPEN',
          body: `fixture current spec ${item.tracking}`
        }
      ]));
      const pullRequest = {
        number: 557,
        headRefName: 'terminal-compaction',
        headRefOid: headSha,
        baseRefName: 'main',
        baseRefOid: baseSha,
        body: 'presentation is not operation identity'
      };
      const independentPullRequest = {
        number: 572,
        headRefName: 'independent-review',
        headRefOid: independentHeadSha,
        baseRefName: 'main',
        baseRefOid: baseSha,
        body: `Work-Package: ${independentManifestPath}`
      };
      const secondaryPullRequest = {
        number: 574,
        headRefName: 'secondary-review',
        headRefOid: secondaryHeadSha,
        baseRefName: 'main',
        baseRefOid: baseSha,
        body: `Work-Package: ${secondaryManifestPath}`
      };
      const provider = ((command, args, cwd, environment, input) => {
        if (command === 'gh') {
          const value = args[0] === 'api'
            ? { data: { repository: issueRecords } }
            : [pullRequest, independentPullRequest, secondaryPullRequest];
          return {
            status: 0,
            stdout: Buffer.from(JSON.stringify(value)),
            stderr: Buffer.alloc(0)
          };
        }
        if (args.includes('ls-remote') && args.includes('--heads')) {
          return {
            status: 0,
            stdout: Buffer.from(
              `${baseSha}\trefs/heads/main\n${headSha}\trefs/heads/terminal-compaction\n`
              + `${independentHeadSha}\trefs/heads/independent-review\n`
              + `${secondaryHeadSha}\trefs/heads/secondary-review\n`
            ),
            stderr: Buffer.alloc(0)
          };
        }
        const result = spawnSync('git', [...args], {
          cwd,
          input,
          encoding: 'buffer',
          windowsHide: true,
          env: environment === undefined ? process.env : { ...process.env, ...environment }
        });
        return {
          status: result.status,
          stdout: Buffer.from(result.stdout ?? ''),
          stderr: Buffer.from(result.stderr ?? result.error?.message ?? '')
        };
      }) satisfies WorkSelectionProvider;
      const normalizedPullRequest = [{
        number: pullRequest.number,
        headBranch: pullRequest.headRefName,
        headSha: pullRequest.headRefOid,
        baseBranch: pullRequest.baseRefName,
        baseSha: pullRequest.baseRefOid,
        body: pullRequest.body
      }];

      expect(await observeRoadmapTerminalCompactionCandidate({
        run: () => { throw new Error('wrong-base PR must not enter the provider'); },
        root,
        repository: 'sec-platform/sec',
        defaultBranch: 'main',
        exactMain: baseSha,
        roadmapSource: prior.source,
        terminalCompaction: compaction,
        openPullRequests: [{ ...normalizedPullRequest[0]!, baseSha: 'e'.repeat(40) }]
      })).toEqual({ status: 'not-applicable', candidate: null });

      const terminal = await observeRoadmapTerminalCompactionCandidate({
        run: provider,
        root,
        repository: 'sec-platform/sec',
        defaultBranch: 'main',
        exactMain: baseSha,
        roadmapSource: prior.source,
        terminalCompaction: compaction,
        openPullRequests: normalizedPullRequest
      });
      if (terminal.status !== 'resolved') {
        throw new Error(`expected resolved terminal fixture: ${JSON.stringify(terminal)}`);
      }
      expect(terminal.candidate).toMatchObject({
        schema: 'sec-roadmap-terminal-compaction-candidate-v2',
        baseSha,
        headSha,
        headTreeSha,
        compactionDigest: compaction.compactionDigest,
        retiredWorkIds: ['issue-186']
      });
      expect(terminal.candidate.bindingDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

      const observed = await observeWorkSelectionWithProvider({
        cwd: root,
        exactMain: baseSha,
        exactMainTree: baseTreeSha
      }, provider, async () => ({
        state: 'healthy',
        ref: rawSha256('terminal-provider-replay-main-health')
      }));
      if (observed.status !== 'resolved') {
        throw new Error(`expected resolved live fixture: ${JSON.stringify(observed)}`);
      }
      expect(observed.status).toBe('resolved');
      expect(observed.receipt.input.current).toMatchObject({
        activeWorkId: 'issue-186',
        activeRef: terminal.candidate.bindingDigest,
        activeState: 'incomplete',
        activeLegality: 'legal'
      });
      const terminalPrEntries = observed.receipt.registry.entries.filter(({ source }) => source === 'open-pr');
      expect(terminalPrEntries).toHaveLength(2);
      expect(terminalPrEntries.find(({ prNumber }) => prNumber === independentPullRequest.number))
        .toMatchObject({
          prNumber: independentPullRequest.number,
          baseSha,
          headSha: independentHeadSha,
          manifestPath: independentManifestPath
        });
      expect(terminalPrEntries.find(({ prNumber }) => prNumber === secondaryPullRequest.number))
        .toMatchObject({
          prNumber: secondaryPullRequest.number,
          baseSha,
          headSha: secondaryHeadSha,
          manifestPath: secondaryManifestPath
        });
      expect(observed.reasonCodes).toEqual([]);
      expect(() => requireResolvedWorkDecisionReceipt(observed)).toThrow(
        'Work selection result is not issued by the trusted production live runner'
      );

      runFixtureGit(root, ['checkout', '--quiet', 'independent-review']);
      const ordinary = await observeWorkSelectionWithProvider({
        cwd: root,
        exactMain: baseSha,
        exactMainTree: baseTreeSha
      }, (command, args, cwd, environment, input) => {
        if (command === 'gh') {
          const value = args[0] === 'api'
            ? {
                data: {
                  repository: Object.fromEntries(Object.entries(issueRecords).map(([alias, issue]) => [
                    alias, { ...issue, state: 'OPEN' }
                  ]))
                }
              }
            : [independentPullRequest, secondaryPullRequest];
          return {
            status: 0,
            stdout: Buffer.from(JSON.stringify(value)),
            stderr: Buffer.alloc(0)
          };
        }
        return provider(command, args, cwd, environment, input);
      }, async () => ({
        state: 'healthy',
        ref: rawSha256('multi-pr-current-main-health')
      }));
      if (ordinary.status !== 'resolved') {
        throw new Error(`expected resolved multi-PR fixture: ${JSON.stringify(ordinary)}`);
      }
      expect(ordinary.receipt.input.current).toMatchObject({
        activeWorkId: independentItem.workId,
        activeState: 'incomplete',
        activeLegality: 'legal'
      });
      const ordinaryPrEntries = ordinary.receipt.registry.entries.filter(({ source }) => source === 'open-pr');
      expect(ordinaryPrEntries.map(({ prNumber }) => prNumber).sort((left, right) => left! - right!))
        .toEqual([independentPullRequest.number, secondaryPullRequest.number]);
      expect(ordinaryPrEntries.find(({ prNumber }) => prNumber === independentPullRequest.number))
        .toMatchObject({ headSha: independentHeadSha, manifestPath: independentManifestPath });
      expect(ordinaryPrEntries.find(({ prNumber }) => prNumber === secondaryPullRequest.number))
        .toMatchObject({ headSha: secondaryHeadSha, manifestPath: secondaryManifestPath });
      const malformedUnselected = await observeWorkSelectionWithProvider({
        cwd: root,
        exactMain: baseSha,
        exactMainTree: baseTreeSha
      }, (command, args, cwd, environment, input) => {
        if (command === 'gh' && args[0] !== 'api') {
          return {
            status: 0,
            stdout: Buffer.from(JSON.stringify([
              independentPullRequest,
              { ...secondaryPullRequest, body: 'missing canonical Work Package locator' }
            ])),
            stderr: Buffer.alloc(0)
          };
        }
        if (command === 'gh') {
          return {
            status: 0,
            stdout: Buffer.from(JSON.stringify({
              data: {
                repository: Object.fromEntries(Object.entries(issueRecords).map(([alias, issue]) => [
                  alias, { ...issue, state: 'OPEN' }
                ]))
              }
            })),
            stderr: Buffer.alloc(0)
          };
        }
        return provider(command, args, cwd, environment, input);
      }, async () => ({
        state: 'healthy',
        ref: rawSha256('multi-pr-malformed-main-health')
      }));
      expect(malformedUnselected).toMatchObject({
        status: 'unresolved',
        reasonCodes: ['work-package-registry-unresolved'],
        receipt: null
      });
      runFixtureGit(root, ['checkout', '--quiet', 'terminal-compaction']);

      const missingHead = 'f'.repeat(40);
      const unavailable = await observeWorkSelectionWithProvider({
        cwd: root,
        exactMain: baseSha,
        exactMainTree: baseTreeSha
      }, (command, args, cwd, environment, input) => {
        if (command === 'gh' && args[0] !== 'api') {
          return {
            status: 0,
            stdout: Buffer.from(JSON.stringify([{ ...pullRequest, headRefOid: missingHead }])),
            stderr: Buffer.alloc(0)
          };
        }
        return provider(command, args, cwd, environment, input);
      }, async () => ({
        state: 'healthy',
        ref: rawSha256('terminal-provider-replay-main-health')
      }));
      expect(unavailable).toMatchObject({
        status: 'unresolved',
        reasonCodes: ['current-open-pr-match-unresolved'],
        receipt: null
      });

      const duplicateCurrent = await observeWorkSelectionWithProvider({
        cwd: root,
        exactMain: baseSha,
        exactMainTree: baseTreeSha
      }, (command, args, cwd, environment, input) => {
        if (command === 'gh' && args[0] !== 'api') {
          return {
            status: 0,
            stdout: Buffer.from(JSON.stringify([
              pullRequest,
              { ...pullRequest, number: pullRequest.number + 1 }
            ])),
            stderr: Buffer.alloc(0)
          };
        }
        return provider(command, args, cwd, environment, input);
      }, async () => ({
        state: 'healthy',
        ref: rawSha256('duplicate-current-main-health')
      }));
      expect(duplicateCurrent).toMatchObject({
        status: 'unresolved',
        reasonCodes: ['current-open-pr-match-unresolved'],
        receipt: null
      });

      let currentBranchReads = 0;
      const driftedCheckout = await observeWorkSelectionWithProvider({
        cwd: root,
        exactMain: baseSha,
        exactMainTree: baseTreeSha
      }, (command, args, cwd, environment, input) => {
        if (command === 'git' && args.join('\0') === 'branch\0--show-current') {
          currentBranchReads += 1;
          if (currentBranchReads === 2) {
            return {
              status: 0,
              stdout: Buffer.from('secondary-review\n'),
              stderr: Buffer.alloc(0)
            };
          }
        }
        return provider(command, args, cwd, environment, input);
      }, async () => ({
        state: 'healthy',
        ref: rawSha256('current-checkout-drift-main-health')
      }));
      expect(driftedCheckout).toMatchObject({
        status: 'unresolved',
        reasonCodes: ['current-checkout-drift-unresolved'],
        receipt: null
      });

      writeFileSync(
        path.join(root, 'config', 'repository', 'work-packages', 'provider-replay-drift.md'),
        '# unauthorized manifest path drift\n',
        'utf8'
      );
      runFixtureGit(root, ['add', '--', 'config/repository/work-packages/provider-replay-drift.md']);
      runFixtureGit(root, ['commit', '--quiet', '-m', 'fixture: manifest path drift']);
      const driftedHead = fixtureGitSha(root, 'HEAD');
      const drifted = await observeRoadmapTerminalCompactionCandidate({
        run: provider,
        root,
        repository: 'sec-platform/sec',
        defaultBranch: 'main',
        exactMain: baseSha,
        roadmapSource: prior.source,
        terminalCompaction: compaction,
        openPullRequests: [{
          ...normalizedPullRequest[0]!,
          headSha: driftedHead
        }]
      });
      expect(drifted).toMatchObject({
        status: 'unresolved',
        reasonCode: 'terminal-compaction-candidate-invalid',
        candidate: null
      });
    }, async () => {
      rmSync(fixtureParent, { recursive: true, force: true });
    });
  }, 30_000);

  test('rolling projection parser rejects field, duplicate-key, and digest drift', () => {
    const result = receiptForCatalog(transitionCatalog());
    const rendered = renderWorkRollingSelectionPlan({ receipt: result, reviewedOn: '2026-08-12' });
    const machine = /```json\r?\n([\s\S]*?)\r?\n```/u.exec(rendered)?.[1];
    expect(machine).toBeDefined();
    const projection = compileWorkRollingSelectionProjection(result);
    expect(parseWorkRollingMachineProjection(machine!)).toEqual(projection);
    expect(projection.candidates.length).toBeLessThanOrEqual(5);
    expect(new Set(projection.candidates.map(({ packageId }) => packageId)).size)
      .toBe(projection.candidates.length);
    expect(projection.receiptDigest).toBe(result.receiptDigest);
    expect(rendered).toContain(`### ${projection.active.packageId}`);
    expect(rendered).toContain(`"receiptDigest": "${result.receiptDigest}"`);
    expect(rendered.match(/^### [1-9][0-9]*\. /gmu) ?? [])
      .toHaveLength(projection.candidates.length);
    expect(() => parseWorkRollingMachineProjection(machine!.replace(
      '"decisionStatus": "selected"',
      '"decisionStatus": "eligible"'
    ))).toThrow(/decisionStatus/u);
    expect(() => parseWorkRollingMachineProjection(machine!.replace(
      '"schema": "sec-work-rolling-projection-v1"',
      '"schema": "sec-work-rolling-projection-v1",\n  "schema": "sec-work-rolling-projection-v1"'
    ))).toThrow(/duplicate key "schema"/u);
    expect(() => parseWorkRollingMachineProjection(machine!.replace(
      /"projectionDigest": "sha256:[0-9a-f]{64}"/u,
      `"projectionDigest": "sha256:${'0'.repeat(64)}"`
    ))).toThrow(/does not bind/u);
  });

  test('manual bootstrap projection records the final external observation without forging a repair ledger', () => {
    const failureFingerprint = rawSha256('materialization-failure');
    const manifestPath = createMainHealthRepairWorkPackagePath({
      repository: 'sec-platform/sec',
      defaultBranch: 'main',
      mainSha: exactMain,
      mainTreeSha: exactMainTree,
      owner: 'ci-verification-maintainer',
      failureFingerprints: [failureFingerprint]
    });
    const packageId = manifestPath.slice('config/repository/work-packages/'.length, -'.md'.length);
    const projection = compileWorkRollingTransitionProjection({
      exactMain,
      exactMainTree,
      authority: {
        kind: 'manual-main-health-bootstrap',
        repository: 'sec-platform/sec',
        defaultBranch: 'main',
        owner: 'ci-verification-maintainer',
        healthRevision: rawSha256('provider-missing-health'),
        bootstrapObservationDigest: rawSha256('exact-materialization-observation'),
        failureFingerprints: [failureFingerprint],
        publishedActivePackageId: 'published-active-v1',
        retirementPolicy: 'exact-new-main-readback'
      },
      active: {
        packageId,
        tracking: 'none',
        manifestPath,
        manifestDigest: rawSha256('bootstrap-manifest')
      },
      candidates: ['candidate-two-v1', 'candidate-three-v1']
    });
    const rendered = renderWorkRollingTransitionPlan({ projection, reviewedOn: '2026-08-23' });
    const machine = /```json\r?\n([\s\S]*?)\r?\n```/u.exec(rendered)?.[1];
    expect(machine).toBeDefined();
    expect(parseWorkRollingMachineProjection(machine!)).toEqual(projection);
    expect(rendered).toContain('Final manual MainHealth bootstrap bound to observation');
    expect(rendered).not.toContain('bound to decision');
    expect(() => compileWorkRollingTransitionProjection({
      ...projection,
      authority: {
        kind: 'manual-main-health-bootstrap',
        repository: 'sec-platform/sec',
        defaultBranch: 'main',
        owner: 'ci-verification-maintainer',
        healthRevision: rawSha256('provider-missing-health'),
        bootstrapObservationDigest: rawSha256('exact-materialization-observation'),
        failureFingerprints: [rawSha256('materialization-failure')],
        publishedActivePackageId: 'published-active-v1',
        retirementPolicy: 'never' as never
      }
    })).toThrow('manual MainHealth bootstrap authority identity is invalid');
  });

  test('rolling topology remains canonical when the selected draft PR becomes continue-active', () => {
    const observation = transitionCatalog();
    const selected = receiptForCatalog(observation, ['issue-346']);
    const continued = receiptForCatalog(observation, ['issue-346'], {
      ...lifecycle(),
      activeWorkId: 'issue-352',
      activeRef: 'active:issue-352',
      activeState: 'incomplete',
      activeLegality: 'legal'
    });
    expect(selected.decision.status).toBe('select-next');
    expect(continued.decision.status).toBe('continue-active');
    const expectedTopology = {
      activePackageId: 'controlled-pr-issue-disposition-single-writer-v1',
      candidatePackageIds: [
        'generated-ignored-state-lifecycle-v1',
        'git-worktree-physical-closeout-v1',
        'delegation-consumer-zero-retirement-v1',
        'candidate-control-transaction-v1'
      ]
    };
    const projection = compileWorkRollingSelectionProjection(selected);
    expect({
      activePackageId: projection.active.packageId,
      candidatePackageIds: projection.candidates.map(({ packageId }) => packageId)
    }).toEqual(expectedTopology);
    expect(compileWorkRollingTopology(continued)).toEqual(expectedTopology);
  });

  test('ready-successor count excludes a direct deferred successor', () => {
    const observation = transitionCatalog();
    const result = receiptForCatalog(observation);
    expect(result.input.candidates.find(({ workId }) => workId === 'issue-312'))
      .toMatchObject({ lifecycle: 'deferred', readiness: 'not-ready' });
    expect(result.input.candidates.find(({ workId }) => workId === 'issue-346'))
      .toMatchObject({ blockedReadySuccessorCount: 1 });
  });

  test('closed current spec without exact default completion evidence fails closed', () => {
    const { source: roadmapSource, catalog } = transitionCatalog();
    const currentSpecs = specs(catalog);
    currentSpecs[0] = createWorkCurrentSpecObservation({
      workId: catalog.items[0]!.workId,
      currentSpecRef: catalog.items[0]!.currentSpecRef,
      providerResourceRef: 'github-node:closed',
      providerState: 'closed',
      currentSpecRevision: currentSpecRevisionFromBody('closed spec')
    });
    expect(() => createWorkDecisionReceipt({
      repository: 'sec-platform/sec',
      exactMain,
      exactMainTree,
      roadmapRevision: rawSha256(roadmapSource),
      catalog,
      registry: registry(catalog),
      current: lifecycle(),
      currentSpecs
    })).toThrow(/closed without default-branch completion evidence/u);
  });

});
