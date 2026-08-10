import { spawnSync } from 'node:child_process';
import { renameSync, symlinkSync } from 'node:fs';
import { copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { digest, sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  CodexDevelopmentAssertControlPlaneBindingV1,
  CodexDevelopmentAssertInitiallyAbsentEntryTransitionV1,
  CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1,
  CodexDevelopmentCreateFreezeProjectionV1,
  CodexDevelopmentParseActivePointerV2,
  CodexDevelopmentParseCurrentStateSpecV1,
  CodexDevelopmentParseRollingPlanV1,
  CodexDevelopmentResolveActiveWorkPackageV1,
  type CodexDevelopmentActivePointerV2,
  type CodexDevelopmentInitiallyAbsentTupleByteClassV1,
  type CodexDevelopmentInitiallyAbsentTupleEdgeV1,
  type CodexDevelopmentInitiallyAbsentTupleEntryV1,
  type CodexDevelopmentInitiallyAbsentTuplePlatformV1,
  type CodexDevelopmentInitiallyAbsentTupleStateV1,
  type CodexDevelopmentInitiallyAbsentTupleV1
} from '../../scripts/codex/document-control-plane-contract.ts';
import {
  CodexDevelopmentDurabilityBarrierError,
  CodexDevelopmentUnsafeAnchoredPathError,
  freezeDocumentControlPlaneV1,
  resolveLiveControlPlane,
  type CodexDevelopmentDurabilityEventV1,
  type CodexDevelopmentFreezeFaultV1,
  type CodexDevelopmentFreezeResultV1
} from '../../scripts/codex/document-control-plane.ts';
import { CodexDevelopmentWorkPackageManifestDigest } from '../../scripts/codex/work-package-contract.ts';

const CURRENT_STATE_PATH = 'docs/work/current-state.yaml';
const POINTER_PATH = 'docs/work/active-work-package.md';
const FIXTURE_MANIFEST_PATH = 'docs/work-packages/control-plane-lifecycle-fixture-v1.md';
const FREEZE_TARGET_ID = 'freeze-target-v1';
const FREEZE_TARGET_PATH = `docs/work-packages/${FREEZE_TARGET_ID}.md`;

test('initially-absent pure T/N/R contract exhaustively owns classification and its five edges', () => {
  const byteClasses: readonly CodexDevelopmentInitiallyAbsentTupleByteClassV1[] = [
    'absent', 'exact-next', 'unknown'
  ];
  const identities = [null, '', 'A', 'B'] as const;
  const entries = byteClasses.flatMap((byteClass) => identities.map((identity) => Object.freeze({
    byteClass,
    identity
  }) as CodexDevelopmentInitiallyAbsentTupleEntryV1));
  const absent = Object.freeze({ byteClass: 'absent' as const, identity: null });
  const exactA = Object.freeze({ byteClass: 'exact-next' as const, identity: 'A' });
  const exactB = Object.freeze({ byteClass: 'exact-next' as const, identity: 'B' });
  const tuple = (
    target: CodexDevelopmentInitiallyAbsentTupleEntryV1 = absent,
    next: CodexDevelopmentInitiallyAbsentTupleEntryV1 = absent,
    retiredNext: CodexDevelopmentInitiallyAbsentTupleEntryV1 = absent
  ): CodexDevelopmentInitiallyAbsentTupleV1 => Object.freeze({ target, next, retiredNext });
  const expectedClassification = (
    platform: CodexDevelopmentInitiallyAbsentTuplePlatformV1,
    observation: CodexDevelopmentInitiallyAbsentTupleV1
  ) => {
    const values = [observation.target, observation.next, observation.retiredNext];
    if (values.some((entry) => (
      (entry.byteClass === 'absent') !== (entry.identity === null)
      || (entry.byteClass !== 'absent' && entry.identity === '')
    ))) {
      return { status: 'invalid', reason: 'malformed-observation' } as const;
    }
    if (values.some((entry) => entry.byteClass === 'unknown')) {
      return { status: 'invalid', reason: 'unknown-bytes' } as const;
    }
    const topology = values.map((entry) => entry.byteClass).join('/');
    const stateByTopology: Readonly<Record<string, CodexDevelopmentInitiallyAbsentTupleStateV1>> = platform === 'win32'
      ? {
          'absent/absent/absent': 'win32-w0',
          'absent/exact-next/absent': 'win32-w1',
          'exact-next/absent/absent': 'win32-w2'
        }
      : {
          'absent/absent/absent': 'linux-l0',
          'absent/exact-next/absent': 'linux-l1',
          'exact-next/exact-next/absent': 'linux-l2',
          'exact-next/absent/exact-next': 'linux-l3'
        };
    const state = stateByTopology[topology];
    if (state === undefined) return { status: 'invalid', reason: 'illegal-topology' } as const;
    if ((state === 'linux-l2' && observation.target.identity !== observation.next.identity)
        || (state === 'linux-l3' && observation.target.identity !== observation.retiredNext.identity)) {
      return { status: 'invalid', reason: 'identity-mismatch' } as const;
    }
    return { status: 'legal', state } as const;
  };

  for (const platform of ['win32', 'linux'] as const) {
    for (const target of entries) for (const next of entries) for (const retiredNext of entries) {
      const observation = tuple(target, next, retiredNext);
      expect(CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1({ platform, tuple: observation })).toEqual(
        expectedClassification(platform, observation)
      );
    }
  }

  const malformedRows = [
    null,
    [],
    {},
    { target: absent, next: absent },
    { target: absent, next: absent, retiredNext: absent, extra: true },
    { target: { byteClass: 'absent', identity: null, extra: true }, next: absent, retiredNext: absent },
    { target: { byteClass: 'other', identity: 'A' }, next: absent, retiredNext: absent },
    { target: { byteClass: 'exact-next', identity: 1 }, next: absent, retiredNext: absent },
    { target: { byteClass: 'exact-next', identity: '' }, next: absent, retiredNext: absent },
    { target: { byteClass: 'unknown', identity: '' }, next: absent, retiredNext: absent },
    { target: absent, next: { byteClass: 'exact-next', identity: '' }, retiredNext: absent },
    { target: absent, next: { byteClass: 'unknown', identity: '' }, retiredNext: absent },
    { target: absent, next: absent, retiredNext: { byteClass: 'exact-next', identity: '' } },
    { target: absent, next: absent, retiredNext: { byteClass: 'unknown', identity: '' } }
  ];
  for (const malformed of malformedRows) {
    expect(CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1({
      platform: 'linux', tuple: malformed as CodexDevelopmentInitiallyAbsentTupleV1
    })).toEqual({ status: 'invalid', reason: 'malformed-observation' });
  }
  expect(CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1({
    platform: 'darwin' as CodexDevelopmentInitiallyAbsentTuplePlatformV1,
    tuple: null as unknown as CodexDevelopmentInitiallyAbsentTupleV1
  })).toEqual({ status: 'invalid', reason: 'unsupported-platform' });
  expect(CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1({
    platform: 'linux',
    tuple: tuple({ byteClass: 'unknown', identity: null } as CodexDevelopmentInitiallyAbsentTupleEntryV1)
  })).toEqual({ status: 'invalid', reason: 'malformed-observation' });
  expect(CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1({
    platform: 'linux',
    tuple: tuple({ byteClass: 'unknown', identity: 'A' })
  })).toEqual({ status: 'invalid', reason: 'unknown-bytes' });
  expect(CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1({
    platform: 'linux',
    tuple: tuple(exactA, absent, exactB)
  })).toEqual({ status: 'invalid', reason: 'identity-mismatch' });

  const legalTuples = {
    win32: [tuple(), tuple(absent, exactA), tuple(exactA)],
    linux: [tuple(), tuple(absent, exactA), tuple(exactA, exactA), tuple(exactA, absent, exactA)]
  } as const;
  const edges = {
    win32: ['win32-w0->win32-w1', 'win32-w1->win32-w2'],
    linux: ['linux-l0->linux-l1', 'linux-l1->linux-l2', 'linux-l2->linux-l3']
  } as const satisfies Readonly<Record<CodexDevelopmentInitiallyAbsentTuplePlatformV1, readonly CodexDevelopmentInitiallyAbsentTupleEdgeV1[]>>;
  for (const platform of ['win32', 'linux'] as const) {
    const states = legalTuples[platform];
    const platformEdges = edges[platform];
    for (let predecessorIndex = 0; predecessorIndex < states.length; predecessorIndex += 1) {
      for (let successorIndex = 0; successorIndex < states.length; successorIndex += 1) {
        for (const expectedEdge of platformEdges) {
          const result = CodexDevelopmentAssertInitiallyAbsentEntryTransitionV1({
            platform,
            predecessor: states[predecessorIndex]!,
            successor: states[successorIndex]!,
            expectedEdge
          });
          if (successorIndex === predecessorIndex + 1 && expectedEdge === platformEdges[predecessorIndex]) {
            expect(result).toEqual(expectedClassification(platform, states[successorIndex]!));
          } else {
            expect(result).toEqual({ status: 'invalid', reason: 'illegal-topology' });
          }
        }
      }
    }
  }
  for (const discontinuity of [
    { platform: 'win32', predecessor: tuple(absent, exactA), successor: tuple(exactB), expectedEdge: 'win32-w1->win32-w2' },
    { platform: 'linux', predecessor: tuple(absent, exactA), successor: tuple(exactB, exactB), expectedEdge: 'linux-l1->linux-l2' },
    { platform: 'linux', predecessor: tuple(exactA, exactA), successor: tuple(exactB, absent, exactB), expectedEdge: 'linux-l2->linux-l3' }
  ] as const) {
    expect(CodexDevelopmentAssertInitiallyAbsentEntryTransitionV1(discontinuity)).toEqual({
      status: 'invalid', reason: 'identity-mismatch'
    });
  }
}, 30_000);

function readGitBlob(cwd: string, spec: string): Buffer | undefined {
  const result = spawnSync('git', ['show', spec], {
    cwd,
    encoding: 'buffer',
    windowsHide: true
  });
  return result.status === 0 ? result.stdout : undefined;
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true
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
  expect(failure).toBeInstanceOf(CodexDevelopmentUnsafeAnchoredPathError);
  expect(failure).toMatchObject({ code: 'DOCUMENT-CONTROL-UNSAFE-PATH-001' });
  expect((failure as Error).message).toMatch(/reparse point|symbolic link|junction/u);
}

function runFreezeCli(cwd: string): CodexDevelopmentFreezeResultV1 {
  const result = spawnSync(process.execPath, [
    path.resolve('scripts/codex/document-control-plane.ts'),
    'freeze',
    '--manifest',
    FREEZE_TARGET_PATH,
    '--reviewed-on',
    '2026-08-09',
    '--json'
  ], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`document control freeze CLI failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as CodexDevelopmentFreezeResultV1;
}

function pointerFor(blob: Uint8Array): CodexDevelopmentActivePointerV2 {
  return {
    schema: 'sec-active-work-package-pointer-v2',
    selectionMode: 'exact-manifest-not-on-default-branch-v1',
    defaultBranchRef: 'refs/remotes/origin/main',
    defaultRefFreshness: 'live-platform-match-required',
    manifest: FIXTURE_MANIFEST_PATH,
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest(blob) as `sha256:${string}`,
    digestBytes: 'git-blob',
    unavailableDefaultRef: 'unresolved',
    matchingDefaultBlob: 'none'
  };
}

interface FreezeFixture {
  readonly parent: string;
  readonly repositoryRoot: string;
  readonly remoteRoot: string;
  readonly baseSha: string;
  dispose(): Promise<void>;
}

function currentStateSource(remoteName = 'origin'): string {
  return `schema: sec-current-state-live-v1
resolver:
  command: bun scripts/codex/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: ${remoteName}
  defaultBranch: main
  defaultRef: refs/remotes/${remoteName}/main
  requireRemoteMatch: true
stableFacts: {}
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

async function createFreezeFixture(): Promise<FreezeFixture> {
  const parent = await mkdtemp(path.join(tmpdir(), 'sec-control-freeze-'));
  const repositoryRoot = path.join(parent, 'repository');
  const remoteRoot = path.join(parent, 'remote.git');
  await mkdir(repositoryRoot, { recursive: true });
  runGit(parent, ['init', '--quiet', '--bare', remoteRoot]);
  runGit(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
  runGit(repositoryRoot, ['config', 'user.email', 'sec-control-plane@example.invalid']);
  runGit(repositoryRoot, ['config', 'user.name', 'SEC Control Plane Test']);
  const currentManifestPath = 'docs/work-packages/current-active-v1.md';
  const currentManifestBytes = Buffer.from('current active manifest bytes\n', 'utf8');
  const initialFiles: Readonly<Record<string, string | Uint8Array>> = {
    'README.md': '# freeze fixture\n',
    [CURRENT_STATE_PATH]: currentStateSource(),
    [POINTER_PATH]: activePointerSource(currentManifestPath, currentManifestBytes),
    'docs/work/rolling-plan.md': rollingPlanSource(),
    [currentManifestPath]: currentManifestBytes
  };
  for (const [repositoryPath, content] of Object.entries(initialFiles)) {
    const filePath = path.join(repositoryRoot, ...repositoryPath.split('/'));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
  runGit(repositoryRoot, ['add', '.']);
  runGit(repositoryRoot, ['commit', '--quiet', '-m', 'base']);
  runGit(repositoryRoot, ['remote', 'add', 'origin', remoteRoot]);
  runGit(repositoryRoot, ['push', '--quiet', '--set-upstream', 'origin', 'main']);
  const baseSha = runGit(repositoryRoot, ['rev-parse', 'HEAD']);
  const targetManifest = `---
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
  - platform/compiler/
acceptance:
  - "Freeze transaction remains exact."
tests:
  - tests/contract/document-control-plane-lifecycle.test.ts
---

# ${FREEZE_TARGET_ID}
`;
  const targetPath = path.join(repositoryRoot, ...FREEZE_TARGET_PATH.split('/'));
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, targetManifest, 'utf8');
  return {
    parent,
    repositoryRoot,
    remoteRoot,
    baseSha,
    dispose: () => rm(parent, { recursive: true, force: true })
  };
}

test('shared resolver fails closed for stale, unavailable, malformed, and checkout-byte drift', () => {
  const gitBlob = Buffer.from('schema: frozen\n', 'utf8');
  const oldDefaultBlob = Buffer.from('schema: old\n', 'utf8');
  const checkoutCrlfBytes = Buffer.from('schema: frozen\r\n', 'utf8');
  const pointer = pointerFor(gitBlob);

  expect(CodexDevelopmentResolveActiveWorkPackageV1({
    pointer,
    candidateManifestBlob: gitBlob,
    defaultManifestBlob: null,
    defaultRefState: 'stale'
  })).toEqual({ state: 'unresolved', reason: 'default-ref-stale' });
  expect(CodexDevelopmentResolveActiveWorkPackageV1({
    pointer,
    candidateManifestBlob: gitBlob,
    defaultManifestBlob: null,
    defaultRefState: 'unavailable'
  })).toEqual({ state: 'unresolved', reason: 'default-ref-unavailable' });
  expect(CodexDevelopmentResolveActiveWorkPackageV1({
    pointer,
    candidateManifestBlob: checkoutCrlfBytes,
    defaultManifestBlob: oldDefaultBlob,
    defaultRefState: 'fresh'
  })).toEqual({ state: 'invalid', reason: 'candidate-digest-mismatch' });

  const malformedPointer = `---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-07-24
---
\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
manifest: ${FIXTURE_MANIFEST_PATH}
manifestDigest: ${pointer.manifestDigest}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`;
  expect(() => CodexDevelopmentParseActivePointerV2(malformedPointer))
    .toThrow('must contain exactly');

  const competingPointer = `---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-07-24
---
\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: ${FIXTURE_MANIFEST_PATH}
manifestDigest: ${pointer.manifestDigest}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/competing-control-plane-fixture-v1.md
manifestDigest: ${pointer.manifestDigest}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`;
  expect(() => CodexDevelopmentParseActivePointerV2(competingPointer))
    .toThrow('exactly one YAML selector block');

  expect(() => CodexDevelopmentParseCurrentStateSpecV1(`
schema: sec-current-state-live-v1
resolver:
  command: bun scripts/codex/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: false
stableFacts: {}
`)).toThrow('requireRemoteMatch must be true');

  const validSpec = CodexDevelopmentParseCurrentStateSpecV1(`
schema: sec-current-state-live-v1
resolver:
  command: bun scripts/codex/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: true
stableFacts: {}
`);
  for (const invalidSource of [
    'remote: --upload-pack=malicious',
    'defaultBranch: -unsafe',
    'defaultRef: refs/remotes/upstream/main'
  ]) {
    const field = invalidSource.split(':', 1)[0]!;
    const original = field === 'remote'
      ? 'remote: origin'
      : field === 'defaultBranch'
        ? 'defaultBranch: main'
        : 'defaultRef: refs/remotes/origin/main';
    expect(() => CodexDevelopmentParseCurrentStateSpecV1(
      `
schema: sec-current-state-live-v1
resolver:
  command: bun scripts/codex/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: true
stableFacts: {}
`.replace(original, invalidSource)
    )).toThrow();
  }
  expect(() => CodexDevelopmentParseActivePointerV2(`---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-07-23
---
\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: ../../unsafe.md
manifestDigest: ${pointer.manifestDigest}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`)).toThrow('canonical Work Package manifest path');
  expect(() => CodexDevelopmentAssertControlPlaneBindingV1({
    spec: validSpec,
    pointer: { ...pointer, defaultBranchRef: 'refs/remotes/upstream/main' }
  })).toThrow('must match');
});

test('real Git lifecycle resolves missing path to active and published blob to none', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-control-plane-lifecycle-'));
  try {
    runGit(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
    runGit(repositoryRoot, ['config', 'user.email', 'sec-control-plane@example.invalid']);
    runGit(repositoryRoot, ['config', 'user.name', 'SEC Control Plane Test']);
    await writeFile(path.join(repositoryRoot, 'README.md'), '# fixture\n', 'utf8');
    runGit(repositoryRoot, ['add', 'README.md']);
    runGit(repositoryRoot, ['commit', '--quiet', '-m', 'base']);

    runGit(repositoryRoot, ['switch', '--quiet', '-c', 'candidate']);
    const manifestPath = path.join(repositoryRoot, FIXTURE_MANIFEST_PATH);
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, 'schema: frozen\n', 'utf8');
    runGit(repositoryRoot, ['add', FIXTURE_MANIFEST_PATH]);
    runGit(repositoryRoot, ['commit', '--quiet', '-m', 'candidate']);
    const candidateBlob = readGitBlob(repositoryRoot, `HEAD:${FIXTURE_MANIFEST_PATH}`);
    expect(candidateBlob).toBeDefined();
    const pointer = pointerFor(candidateBlob!);

    runGit(repositoryRoot, ['switch', '--quiet', 'main']);
    expect(readGitBlob(repositoryRoot, `main:${FIXTURE_MANIFEST_PATH}`)).toBeUndefined();
    expect(CodexDevelopmentResolveActiveWorkPackageV1({
      pointer,
      candidateManifestBlob: candidateBlob!,
      defaultManifestBlob: null,
      defaultRefState: 'fresh'
    })).toMatchObject({ state: 'active', manifest: FIXTURE_MANIFEST_PATH });

    runGit(repositoryRoot, ['merge', '--quiet', '--ff-only', 'candidate']);
    const publishedBlob = readGitBlob(repositoryRoot, `main:${FIXTURE_MANIFEST_PATH}`);
    expect(publishedBlob).toEqual(candidateBlob!);
    expect(CodexDevelopmentResolveActiveWorkPackageV1({
      pointer,
      candidateManifestBlob: candidateBlob!,
      defaultManifestBlob: publishedBlob!,
      defaultRefState: 'fresh'
    })).toEqual({ state: 'none', reason: 'matching-default-blob' });

    await writeFile(path.join(repositoryRoot, 'external-change.txt'), 'next main\n', 'utf8');
    runGit(repositoryRoot, ['add', 'external-change.txt']);
    runGit(repositoryRoot, ['commit', '--quiet', '-m', 'subsequent external change']);
    expect(CodexDevelopmentResolveActiveWorkPackageV1({
      pointer,
      candidateManifestBlob: candidateBlob!,
      defaultManifestBlob: readGitBlob(repositoryRoot, `main:${FIXTURE_MANIFEST_PATH}`)!,
      defaultRefState: 'fresh'
    })).toEqual({ state: 'none', reason: 'matching-default-blob' });
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}, 30_000);

test('freeze projection promotes one unique candidate without rewriting candidate bodies', async () => {
  const fixture = await createFreezeFixture();
  try {
    const manifestBytes = await readFile(path.join(fixture.repositoryRoot, ...FREEZE_TARGET_PATH.split('/')));
    const projection = CodexDevelopmentCreateFreezeProjectionV1({
      spec: CodexDevelopmentParseCurrentStateSpecV1(currentStateSource()),
      currentPointerSource: await readFile(path.join(fixture.repositoryRoot, POINTER_PATH), 'utf8'),
      currentRollingPlanSource: rollingPlanSource(),
      manifestPath: FREEZE_TARGET_PATH,
      manifestBytes,
      baseSha: fixture.baseSha,
      reviewedOn: '2026-08-09'
    });
    expect(projection.manifest.id).toBe(FREEZE_TARGET_ID);
    expect(projection.manifestDigest).toBe(
      CodexDevelopmentWorkPackageManifestDigest(manifestBytes) as `sha256:${string}`
    );
    expect(CodexDevelopmentParseRollingPlanV1(projection.rollingPlanSource)).toEqual({
      activePackageId: FREEZE_TARGET_ID,
      candidatePackageIds: ['candidate-two-v1', 'candidate-three-v1']
    });
    expect(projection.rollingPlanSource).toContain('- target-body: exact-target-bytes');
    expect(projection.rollingPlanSource).toContain('- second-body: exact-second-bytes');
    expect(projection.rollingPlanSource).toContain('- third-body: exact-third-bytes');
    expect(projection.rollingPlanSource).toContain('- fixture tail remains exact.');
    expect(projection.pointerSource).not.toContain('current-active-v1');
    expect(CodexDevelopmentParseActivePointerV2(projection.pointerSource)).toMatchObject({
      manifest: FREEZE_TARGET_PATH,
      manifestDigest: projection.manifestDigest
    });
  } finally {
    await fixture.dispose();
  }
});

test('freeze publishes one exact index tree, projects worktree bytes, and is idempotent', async () => {
  const fixture = await createFreezeFixture();
  try {
    const result = runFreezeCli(fixture.repositoryRoot);
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
    const pointer = CodexDevelopmentParseActivePointerV2(
      await readFile(path.join(fixture.repositoryRoot, POINTER_PATH), 'utf8')
    );
    const rolling = CodexDevelopmentParseRollingPlanV1(
      await readFile(path.join(fixture.repositoryRoot, 'docs/work/rolling-plan.md'), 'utf8')
    );
    expect(pointer.manifest).toBe(FREEZE_TARGET_PATH);
    expect(rolling.activePackageId).toBe(FREEZE_TARGET_ID);
    expect(rolling.candidatePackageIds).toEqual(['candidate-two-v1', 'candidate-three-v1']);
    const second = await freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(second).toEqual(result);
    expect(runGit(fixture.repositoryRoot, ['diff', '--cached', '--name-only'])).toBe([
      POINTER_PATH,
      'docs/work/rolling-plan.md',
      FREEZE_TARGET_PATH
    ].sort().join('\n'));
  } finally {
    await fixture.dispose();
  }
}, 30_000);

for (const faultAfter of [
  'after-journal-prepare',
  'after-index-lock-write',
  'after-index-publish',
  'after-pointer-temp-write',
  'after-pointer-publish',
  'after-rolling-temp-write',
  'after-rolling-publish'
] as const satisfies readonly CodexDevelopmentFreezeFaultV1[]) {
  test(`nonterminal ${faultAfter} remains unresolved and recovers only by rolling forward`, async () => {
    const fixture = await createFreezeFixture();
    try {
      await expect(freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        faultAfter
      })).rejects.toThrow(`Injected document control freeze fault: ${faultAfter}`);
      const midPhase = await resolveLiveControlPlane(fixture.repositoryRoot);
      expect(midPhase.activeWorkPackage).toEqual({
        state: 'unresolved',
        reason: 'activation-in-progress'
      });
      expect(midPhase.github).toMatchObject({
        status: 'unresolved',
        reason: expect.stringContaining('activation is nonterminal')
      });
      const recovered = await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
      expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(recovered.candidateTreeSha);
      const journal = JSON.parse(await readFile(
        path.join(fixture.repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1/journal.json'),
        'utf8'
      )) as { phase: string };
      expect(journal.phase).toBe('terminal');
    } finally {
      await fixture.dispose();
    }
  }, 30_000);
}

type RecoveryJournalViewV3 = Readonly<{
  schema: 'sec-document-control-plane-freeze-journal-v3';
  operationId: `sha256:${string}`;
  phase: string;
  candidateTreeSha: string;
  files: Readonly<{
    pointer: Readonly<{ pre: string; next: string }>;
    rollingPlan: Readonly<{ pre: string; next: string }>;
  }>;
  index: Readonly<{ pre: string; next: string }>;
  result: CodexDevelopmentFreezeResultV1;
}>;

const JOURNAL_TRANSACTION_RELATIVE = '.tmp/codex/document-control-plane-freeze-v1';
const JOURNAL_ACTIVE_NEXT = /^journal\.json\.([0-9a-f]{64})\.(prepared|index-published|pointer-published|rolling-published|terminal)\.next$/u;
const FreezeEntryRecoveryNameForTestV1 = /^\.entry-[0-9a-f]{64}\.(pre|retired-pre|retired-next)$/u;

function entryRecoveryPathForTest(
  transactionRoot: string,
  targetPath: string,
  operationId: string,
  suffix: 'pre' | 'retired-pre' | 'retired-next'
): string {
  const identity = sha256({
    schema: 'sec-document-control-entry-recovery-path-v1',
    operationId,
    targetPath: path.resolve(targetPath)
  }).slice('sha256:'.length);
  return path.join(transactionRoot, `.entry-${identity}.${suffix}`);
}

function journalRetiredNextPath(
  transactionRoot: string,
  canonicalJournalPath: string,
  nextBytes: Uint8Array
): string {
  return entryRecoveryPathForTest(
    transactionRoot,
    canonicalJournalPath,
    `sha256:${digest(nextBytes)}`,
    'retired-next'
  );
}

async function expectLinuxExactS1(input: {
  artifactRoot: string;
  targetPath: string;
  operationId: string;
  expectedPre: Uint8Array;
}): Promise<Readonly<{
  quarantinePath: string;
  retiredPrePath: string;
  retiredNextPath: string;
}>> {
  expect(process.platform).toBe('linux');
  const quarantinePath = entryRecoveryPathForTest(input.artifactRoot, input.targetPath, input.operationId, 'pre');
  const retiredPrePath = entryRecoveryPathForTest(
    input.artifactRoot,
    input.targetPath,
    input.operationId,
    'retired-pre'
  );
  const retiredNextPath = entryRecoveryPathForTest(
    input.artifactRoot,
    input.targetPath,
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
  journal: RecoveryJournalViewV3;
}>> {
  const transactionRoot = path.join(repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
  const names = (await readdir(transactionRoot)).filter((name) => JOURNAL_ACTIVE_NEXT.test(name));
  expect(names).toHaveLength(1);
  const name = names[0]!;
  const filePath = path.join(transactionRoot, name);
  const bytes = await readFile(filePath);
  const journal = JSON.parse(bytes.toString('utf8')) as RecoveryJournalViewV3;
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
  const names = [...await readdir(transactionRoot)].sort();
  const snapshot: Array<Readonly<{ name: string; bytes: string }>> = [];
  for (const name of names) {
    snapshot.push(Object.freeze({
      name,
      bytes: (await readFile(path.join(transactionRoot, name))).toString('base64')
    }));
  }
  return Object.freeze(snapshot);
}

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
    rollingPlan: (await readFile(path.join(repositoryRoot, 'docs/work/rolling-plan.md'))).toString('base64')
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

interface PublishTupleFixtureV1 {
  readonly fixture: FreezeFixture;
  readonly journal: RecoveryJournalViewV3;
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

async function prepareIndexPublishTupleFixture(): Promise<PublishTupleFixtureV1> {
  const fixture = await createFreezeFixture();
  await expect(freezeDocumentControlPlaneV1({
    cwd: fixture.repositoryRoot,
    manifestPath: FREEZE_TARGET_PATH,
    reviewedOn: '2026-08-09',
    faultAfter: 'after-journal-prepare'
  })).rejects.toThrow('after-journal-prepare');
  const journalPath = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE, 'journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalViewV3;
  const indexPath = repositoryIndexPath(fixture.repositoryRoot);
  const artifactRoot = path.dirname(indexPath);
  const operationId = journal.operationId;
  return Object.freeze({
    fixture,
    journal,
    paths: Object.freeze({
      target: indexPath,
      next: `${indexPath}.lock`,
      quarantine: entryRecoveryPathForTest(artifactRoot, indexPath, operationId, 'pre'),
      retiredPre: entryRecoveryPathForTest(artifactRoot, indexPath, operationId, 'retired-pre'),
      retiredNext: entryRecoveryPathForTest(artifactRoot, indexPath, operationId, 'retired-next'),
      journal: journalPath
    }),
    pre: Buffer.from(journal.index.pre, 'base64'),
    next: Buffer.from(journal.index.next, 'base64')
  });
}

async function writePublishTuple(
  prepared: PublishTupleFixtureV1,
  entries: Readonly<{
    target: Buffer | null;
    next: Buffer | null;
    quarantine: Buffer | null;
    retiredPre: Buffer | null;
    retiredNext: Buffer | null;
  }>
): Promise<void> {
  await Promise.all([
    writeOptionalEntry(prepared.paths.target, entries.target),
    writeOptionalEntry(prepared.paths.next, entries.next),
    writeOptionalEntry(prepared.paths.quarantine, entries.quarantine),
    writeOptionalEntry(prepared.paths.retiredPre, entries.retiredPre),
    writeOptionalEntry(prepared.paths.retiredNext, entries.retiredNext)
  ]);
}

async function readPreEffectTupleSnapshot(prepared: PublishTupleFixtureV1): Promise<Readonly<{
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
    rollingPlan: await readOptionalEntrySnapshot(path.join(prepared.fixture.repositoryRoot, 'docs/work/rolling-plan.md')),
    journal: await readOptionalEntrySnapshot(prepared.paths.journal)
  });
}

async function expectPreEffectTupleRejection(prepared: PublishTupleFixtureV1): Promise<void> {
  const before = await readPreEffectTupleSnapshot(prepared);
  const durability: CodexDevelopmentDurabilityEventV1[] = [];
  const renames: unknown[] = [];
  const creates: unknown[] = [];
  const cleanups: unknown[] = [];
  await expect(freezeDocumentControlPlaneV1({
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
    entries: (prepared: PublishTupleFixtureV1) => ({
      target: prepared.pre,
      next: null,
      quarantine: prepared.pre,
      retiredPre: null,
      retiredNext: null
    })
  },
  {
    name: 'target and NEXT are absent with an orphan quarantine',
    entries: (prepared: PublishTupleFixtureV1) => ({
      target: null,
      next: null,
      quarantine: prepared.pre,
      retiredPre: null,
      retiredNext: null
    })
  }
] as const) {
  test(`pre-effect tuple rejects ${invalidCase.name} without any publisher effect`, async () => {
    const prepared = await prepareIndexPublishTupleFixture();
    try {
      await writePublishTuple(prepared, invalidCase.entries(prepared));
      await expectPreEffectTupleRejection(prepared);
    } finally {
      await prepared.fixture.dispose();
    }
  }, 60_000);
}

if (process.platform === 'win32') {
  for (const stateCase of [
    { name: 'W-pristine', faultAfter: 'after-index-lock-write', expected: ['target', 'next'] },
    { name: 'W0', faultAfter: 'after-index-lock-write', expected: ['target', 'next'] },
    { name: 'W1', faultAfter: 'after-index-pre-quarantine', expected: ['next', 'quarantine'] },
    { name: 'W2', faultAfter: 'after-index-next-install', expected: ['target', 'quarantine'] }
  ] as const satisfies readonly Readonly<{
    name: string;
    faultAfter: CodexDevelopmentFreezeFaultV1;
    expected: readonly ('target' | 'next' | 'quarantine')[];
  }>[]) {
    test(`Windows entry CAS state ${stateCase.name} is recoverable under its retained-entry semantics`, async () => {
      const prepared = await prepareIndexPublishTupleFixture();
      try {
        await expect(freezeDocumentControlPlaneV1({
          cwd: prepared.fixture.repositoryRoot,
          manifestPath: FREEZE_TARGET_PATH,
          reviewedOn: '2026-08-09',
          faultAfter: stateCase.faultAfter
        })).rejects.toThrow(stateCase.faultAfter);
        const tuple = await readPreEffectTupleSnapshot(prepared);
        for (const entry of stateCase.expected) expect(tuple.tuple[entry].present).toBe(true);
        const recovered = await freezeDocumentControlPlaneV1({
          cwd: prepared.fixture.repositoryRoot,
          manifestPath: FREEZE_TARGET_PATH,
          reviewedOn: '2026-08-09'
        });
        expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
      } finally {
        await prepared.fixture.dispose();
      }
    }, 60_000);
  }

  test('Windows entry CAS state W3 is terminally idempotent after non-retained cleanup', async () => {
    const prepared = await prepareIndexPublishTupleFixture();
    try {
      const first = await freezeDocumentControlPlaneV1({
        cwd: prepared.fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      const tuple = await readPreEffectTupleSnapshot(prepared);
      expect(tuple.tuple.target.present).toBe(true);
      expect(tuple.tuple.next.present).toBe(false);
      expect(tuple.tuple.quarantine.present).toBe(false);
      const second = await freezeDocumentControlPlaneV1({
        cwd: prepared.fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(second).toEqual(first);
    } finally {
      await prepared.fixture.dispose();
    }
  }, 60_000);

  test('Windows terminal-Q cleanup rejects a NEXT that appears after tuple classification', async () => {
    const prepared = await prepareIndexPublishTupleFixture();
    let injected = false;
    try {
      await expect(freezeDocumentControlPlaneV1({
        cwd: prepared.fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        faultAfter: 'after-index-next-install'
      })).rejects.toThrow('after-index-next-install');
      const before = await readPreEffectTupleSnapshot(prepared);
      expect(before.tuple.target.bytes).toBe(prepared.next.toString('base64'));
      expect(before.tuple.next.present).toBe(false);
      expect(before.tuple.quarantine.bytes).toBe(prepared.pre.toString('base64'));
      await expect(freezeDocumentControlPlaneV1({
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
    } finally {
      await prepared.fixture.dispose();
    }
  }, 60_000);

  test('Windows W3 preserves a later active NEXT without cleanup or publisher effects', async () => {
    const prepared = await prepareIndexPublishTupleFixture();
    try {
      await freezeDocumentControlPlaneV1({
        cwd: prepared.fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      await writeFile(prepared.paths.next, prepared.next);
      const before = await readPreEffectTupleSnapshot(prepared);
      const durability: CodexDevelopmentDurabilityEventV1[] = [];
      const cleanups: unknown[] = [];
      await expect(freezeDocumentControlPlaneV1({
        cwd: prepared.fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        durabilityObserver: (event) => { durability.push(event); },
        beforeAnchoredCleanup: (event) => { cleanups.push(event); }
      })).rejects.toThrow('Terminal freeze verification found an active Git index lock; preserving it.');
      expect(await readPreEffectTupleSnapshot(prepared)).toEqual(before);
      const journalRecoveryDurability = durability.filter((event) => (
        event.label === 'Freeze journal recovery durability journal.json'
      ));
      expect(journalRecoveryDurability.map((event) => event.stage)).toEqual([]);
      expect(durability.filter((event) => !journalRecoveryDurability.includes(event))).toEqual([]);
      expect(cleanups).toEqual([]);
    } finally {
      await prepared.fixture.dispose();
    }
  }, 60_000);

  test('Windows retained rename flush rejects a post-namespace replacement without a follow-on edge', async () => {
    const fixture = await createFreezeFixture();
    const replacement = Buffer.from('replacement pointer after namespace mutation\n', 'utf8');
    const pointerRenameLabels: string[] = [];
    const pointerStages: CodexDevelopmentDurabilityEventV1['stage'][] = [];
    let replacementPath: string | undefined;
    let heldPublishedPath: string | undefined;
    try {
      await expect(freezeDocumentControlPlaneV1({
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
      })).rejects.toThrow('Active pointer recovery tuple is not a legal pre-effect state; preserving every entry.');
      expect(replacementPath).toBeDefined();
      expect(heldPublishedPath).toBeDefined();
      const journal = JSON.parse(await readFile(
        path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE, 'journal.json'),
        'utf8'
      )) as { files: { pointer: { next: string } } };
      expect(await readFile(replacementPath!)).toEqual(replacement);
      expect(await readFile(heldPublishedPath!)).toEqual(Buffer.from(journal.files.pointer.next, 'base64'));
      expect(pointerStages).toEqual(['renamed', 'file-flushed', 'parent-barrier']);
      expect(pointerRenameLabels).toEqual(['Active pointer PRE quarantine', 'Active pointer NEXT install']);
    } finally {
      await fixture.dispose();
    }
  }, 60_000);
}

if (process.platform === 'linux') {
  const linuxInvalidTupleCases: readonly Readonly<{
    name: string;
    setup(prepared: PublishTupleFixtureV1): Promise<void>;
  }>[] = [
    {
      name: 'T=PRE with conflicting Q and RP',
      async setup(prepared) {
        await writePublishTuple(prepared, {
          target: prepared.pre, next: null, quarantine: prepared.pre,
          retiredPre: prepared.pre, retiredNext: null
        });
      }
    },
    {
      name: 'target and NEXT absent with same-byte different-inode Q and RP',
      async setup(prepared) {
        await writePublishTuple(prepared, {
          target: null, next: null, quarantine: prepared.pre,
          retiredPre: prepared.pre, retiredNext: null
        });
      }
    },
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
      const prepared = await prepareIndexPublishTupleFixture();
      try {
        await invalidCase.setup(prepared);
        await expectPreEffectTupleRejection(prepared);
      } finally {
        await prepared.fixture.dispose();
      }
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
  faultAfter: CodexDevelopmentFreezeFaultV1;
  phase: string;
}>[]) {
  test(`journal recovery census restores exact ${recoveryCase.phase} NEXT after PRE quarantine`, async () => {
    const fixture = await createFreezeFixture();
    try {
      await expect(freezeDocumentControlPlaneV1({
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

      const recovered = await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.operationId).toBe(active.journal.operationId);
      expect(recovered.candidateTreeSha).toBe(active.journal.candidateTreeSha);
      expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(active.journal.candidateTreeSha);
      const terminal = JSON.parse(await readFile(canonicalPath, 'utf8')) as RecoveryJournalViewV3;
      expect(terminal.phase).toBe('terminal');
      expect(terminal.operationId).toBe(active.journal.operationId);
      expect(terminal.candidateTreeSha).toBe(active.journal.candidateTreeSha);
      const remainingActive = (await readdir(active.transactionRoot)).filter((name) => JOURNAL_ACTIVE_NEXT.test(name));
      expect(remainingActive).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  }, 60_000);
}

test('journal recovery census accepts the exact installed NEXT boundary and resumes one operation', async () => {
  const fixture = await createFreezeFixture();
  try {
    await expect(freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-journal-index-published-next-install'
    })).rejects.toThrow('after-journal-index-published-next-install');
    const journalPath = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE, 'journal.json');
    const installedBytes = await readFile(journalPath);
    const installedMetadata = await lstat(journalPath);
    const installed = JSON.parse(installedBytes.toString('utf8')) as RecoveryJournalViewV3;
    expect(installed.phase).toBe('index-published');
    const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
    expect(status.activation).toEqual({
      operationId: installed.operationId,
      phase: 'index-published',
      terminal: false
    });
    const recovered = await freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(recovered.operationId).toBe(installed.operationId);
    expect(recovered.candidateTreeSha).toBe(installed.candidateTreeSha);
    const transactionRoot = path.dirname(journalPath);
    expect((await readdir(transactionRoot)).filter((name) => JOURNAL_ACTIVE_NEXT.test(name))).toEqual([]);
    if (process.platform === 'linux') {
      const retiredNextPath = journalRetiredNextPath(transactionRoot, journalPath, installedBytes);
      expect(await readFile(retiredNextPath)).toEqual(Buffer.from(installedBytes));
      const retiredMetadata = await lstat(retiredNextPath);
      expect({ dev: retiredMetadata.dev, ino: retiredMetadata.ino }).toEqual({
        dev: installedMetadata.dev,
        ino: installedMetadata.ino
      });
    }
    const indexPath = repositoryIndexPath(fixture.repositoryRoot);
    const indexLockPath = `${indexPath}.lock`;
    const terminalJournalBeforeStatus = await readFile(journalPath);
    const terminalJournal = JSON.parse(terminalJournalBeforeStatus.toString('utf8')) as RecoveryJournalViewV3;
    const indexBeforeStatus = await readFile(indexPath);
    expect(indexBeforeStatus).toEqual(Buffer.from(terminalJournal.index.next, 'base64'));
    const treeBeforeStatus = runGit(fixture.repositoryRoot, ['write-tree']);
    const entriesBeforeStatus = [...await readdir(transactionRoot)].sort();
    const terminalStatus = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
    expect(terminalStatus.activation).toEqual({
      operationId: installed.operationId,
      phase: 'terminal',
      terminal: true
    });
    expect(await readFile(indexPath)).toEqual(Buffer.from(indexBeforeStatus));
    expect(await readFile(journalPath)).toEqual(Buffer.from(terminalJournalBeforeStatus));
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(treeBeforeStatus);
    expect([...await readdir(transactionRoot)].sort()).toEqual(entriesBeforeStatus);
    let renameEffects = 0;
    let cleanupEffects = 0;
    const durabilityEffects: CodexDevelopmentDurabilityEventV1[] = [];
    const second = await freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      durabilityObserver: (event) => { durabilityEffects.push(event); },
      beforeAnchoredRename: () => { renameEffects += 1; },
      beforeAnchoredCleanup: () => { cleanupEffects += 1; }
    });
    expect(second).toEqual(recovered);
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(installed.candidateTreeSha);
    expect(await readFile(indexPath)).toEqual(Buffer.from(indexBeforeStatus));
    expect(await readFile(journalPath)).toEqual(Buffer.from(terminalJournalBeforeStatus));
    expect([...await readdir(transactionRoot)].sort()).toEqual(entriesBeforeStatus);
    await expect(readFile(indexLockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(durabilityEffects).toEqual([]);
    expect(renameEffects).toBe(0);
    expect(cleanupEffects).toBe(0);
  } finally {
    await fixture.dispose();
  }
}, 60_000);

if (process.platform === 'linux') {
  test('journal recovery census keeps terminal status in progress until exact active NEXT retirement', async () => {
    const fixture = await createFreezeFixture();
    try {
      await expect(freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        faultAfter: 'after-journal-terminal-next-install'
      })).rejects.toThrow('after-journal-terminal-next-install');
      const journalPath = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE, 'journal.json');
      const terminalBytes = await readFile(journalPath);
      const terminalMetadata = await lstat(journalPath);
      const terminal = JSON.parse(terminalBytes.toString('utf8')) as RecoveryJournalViewV3;
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

      const recovered = await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered).toEqual(terminal.result);
      expect((await readdir(active.transactionRoot)).filter((name) => JOURNAL_ACTIVE_NEXT.test(name))).toEqual([]);
      const retiredNextPath = journalRetiredNextPath(active.transactionRoot, journalPath, terminalBytes);
      expect(await readFile(retiredNextPath)).toEqual(Buffer.from(terminalBytes));
      const retiredMetadata = await lstat(retiredNextPath);
      expect({ dev: retiredMetadata.dev, ino: retiredMetadata.ino }).toEqual({
        dev: terminalMetadata.dev,
        ino: terminalMetadata.ino
      });
      const terminalStatus = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
      expect(terminalStatus.activation).toEqual({
        operationId: terminal.operationId,
        phase: 'terminal',
        terminal: true
      });
      const second = await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(second).toEqual(recovered);
    } finally {
      await fixture.dispose();
    }
  }, 60_000);
}

if (process.platform === 'linux') {
  test('journal later-phase census blocks a same-bytes initial retired NEXT inode replacement', async () => {
    const fixture = await createFreezeFixture();
    try {
      await expect(freezeDocumentControlPlaneV1({
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
    } finally {
      await fixture.dispose();
    }
  }, 60_000);
}

if (process.platform === 'linux') {
  test('Linux S1 journal transition remains activation-in-progress and rolls forward exactly once', async () => {
    const fixture = await createFreezeFixture();
    const fault = new Error('Injected Linux journal S1 fault');
    let selectedHooks = 0;
    try {
      await expect(freezeDocumentControlPlaneV1({
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
      const canonical = JSON.parse(canonicalBytes.toString('utf8')) as RecoveryJournalViewV3;
      expect(canonical.phase).toBe('prepared');
      await expectLinuxExactS1({
        artifactRoot: active.transactionRoot,
        targetPath: journalPath,
        operationId: `sha256:${digest(active.bytes)}`,
        expectedPre: canonicalBytes
      });
      expect(await readFile(path.join(fixture.repositoryRoot, POINTER_PATH)))
        .toEqual(Buffer.from(active.journal.files.pointer.pre, 'base64'));
      expect(await readFile(path.join(fixture.repositoryRoot, 'docs/work/rolling-plan.md')))
        .toEqual(Buffer.from(active.journal.files.rollingPlan.pre, 'base64'));

      const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
      expect(status.activation).toEqual({
        operationId: active.journal.operationId,
        phase: 'index-published',
        terminal: false
      });
      const recovered = await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.operationId).toBe(active.journal.operationId);
      expect(recovered.candidateTreeSha).toBe(active.journal.candidateTreeSha);
      const terminal = JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalViewV3;
      expect(terminal.phase).toBe('terminal');
      expect(await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      })).toEqual(recovered);
    } finally {
      await fixture.dispose();
    }
  }, 60_000);

  test('Linux S1 pointer projection proves target identity and rolls the writeAtomicCas family forward', async () => {
    const fixture = await createFreezeFixture();
    const fault = new Error('Injected Linux pointer S1 fault');
    let selectedHooks = 0;
    try {
      await expect(freezeDocumentControlPlaneV1({
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
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalViewV3;
      expect(journal.phase).toBe('index-published');
      const pointerPath = path.join(fixture.repositoryRoot, POINTER_PATH);
      await expectLinuxExactS1({
        artifactRoot: transactionRoot,
        targetPath: pointerPath,
        operationId: journal.operationId,
        expectedPre: Buffer.from(journal.files.pointer.pre, 'base64')
      });
      expect(await readFile(path.join(fixture.repositoryRoot, 'docs/work/rolling-plan.md')))
        .toEqual(Buffer.from(journal.files.rollingPlan.pre, 'base64'));

      const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
      expect(status.activation).toEqual({
        operationId: journal.operationId,
        phase: 'index-published',
        terminal: false
      });
      const recovered = await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.operationId).toBe(journal.operationId);
      expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(journal.candidateTreeSha);
      expect((JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalViewV3).phase).toBe('terminal');
      expect(await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      })).toEqual(recovered);
    } finally {
      await fixture.dispose();
    }
  }, 60_000);

  test('Linux S1 Git index recovery preserves PRE identity and completes without a competing projection', async () => {
    const fixture = await createFreezeFixture();
    const fault = new Error('Injected Linux Git index S1 fault');
    let selectedHooks = 0;
    try {
      await expect(freezeDocumentControlPlaneV1({
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
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalViewV3;
      expect(journal.phase).toBe('prepared');
      const indexPath = repositoryIndexPath(fixture.repositoryRoot);
      await expectLinuxExactS1({
        artifactRoot: path.dirname(indexPath),
        targetPath: indexPath,
        operationId: journal.operationId,
        expectedPre: Buffer.from(journal.index.pre, 'base64')
      });
      expect(await readFile(`${indexPath}.lock`)).toEqual(Buffer.from(journal.index.next, 'base64'));
      expect(await readFile(path.join(fixture.repositoryRoot, POINTER_PATH)))
        .toEqual(Buffer.from(journal.files.pointer.pre, 'base64'));
      expect(await readFile(path.join(fixture.repositoryRoot, 'docs/work/rolling-plan.md')))
        .toEqual(Buffer.from(journal.files.rollingPlan.pre, 'base64'));

      const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
      expect(status.activation).toEqual({
        operationId: journal.operationId,
        phase: 'prepared',
        terminal: false
      });
      const recovered = await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.operationId).toBe(journal.operationId);
      expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(journal.candidateTreeSha);
      expect((JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalViewV3).phase).toBe('terminal');
      expect(await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      })).toEqual(recovered);
    } finally {
      await fixture.dispose();
    }
  }, 60_000);

  test('Linux S1 terminal journal witness remains in-progress and recovers the same operation idempotently', async () => {
    const fixture = await createFreezeFixture();
    const fault = new Error('Injected Linux terminal journal S1 fault');
    try {
      await expect(freezeDocumentControlPlaneV1({
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
      expect((JSON.parse(canonicalBytes.toString('utf8')) as RecoveryJournalViewV3).phase)
        .toBe('rolling-published');
      await expectLinuxExactS1({
        artifactRoot: active.transactionRoot,
        targetPath: journalPath,
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
      const recovered = await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered).toEqual(active.journal.result);
      expect((JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalViewV3).phase).toBe('terminal');
      expect(await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      })).toEqual(recovered);
    } finally {
      await fixture.dispose();
    }
  }, 60_000);

  test('Linux S1 rolling-plan witness proves exact identity and recovers without a competing effect', async () => {
    const fixture = await createFreezeFixture();
    const fault = new Error('Injected Linux rolling-plan S1 fault');
    try {
      await expect(freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        afterExactPreRecoveryLink: (event) => {
          if (event.label === 'Rolling plan') throw fault;
        }
      })).rejects.toBe(fault);
      const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
      const journalPath = path.join(transactionRoot, 'journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalViewV3;
      expect(journal.phase).toBe('pointer-published');
      const rollingPlanPath = path.join(fixture.repositoryRoot, 'docs/work/rolling-plan.md');
      await expectLinuxExactS1({
        artifactRoot: transactionRoot,
        targetPath: rollingPlanPath,
        operationId: journal.operationId,
        expectedPre: Buffer.from(journal.files.rollingPlan.pre, 'base64')
      });
      const beforeStatus = await readFreezeEffectSnapshot(fixture.repositoryRoot);
      const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
      expect(status.activation).toEqual({
        operationId: journal.operationId,
        phase: 'pointer-published',
        terminal: false
      });
      expect(await readFreezeEffectSnapshot(fixture.repositoryRoot)).toEqual(beforeStatus);
      const recovered = await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.operationId).toBe(journal.operationId);
      expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(journal.candidateTreeSha);
      expect((JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalViewV3).phase).toBe('terminal');
      expect(await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      })).toEqual(recovered);
    } finally {
      await fixture.dispose();
    }
  }, 60_000);
}

if (process.platform === 'linux') {
  const installedNextCases = [
    { kind: 'index', faultAfter: 'after-index-next-install' },
    { kind: 'pointer', faultAfter: 'after-pointer-next-install' },
    { kind: 'rolling', faultAfter: 'after-rolling-next-install' }
  ] as const satisfies readonly Readonly<{
    kind: 'index' | 'pointer' | 'rolling';
    faultAfter: CodexDevelopmentFreezeFaultV1;
  }>[];
  for (const installedCase of installedNextCases) {
    for (const state of ['S3', 'S4'] as const) {
      test(`Linux ${installedCase.kind} ${state} rejects same-byte different-inode NEXT authority without effects`, async () => {
        const fixture = await createFreezeFixture();
        const durability: CodexDevelopmentDurabilityEventV1[] = [];
        const renames: unknown[] = [];
        const creates: unknown[] = [];
        const cleanups: unknown[] = [];
        try {
          await expect(freezeDocumentControlPlaneV1({
            cwd: fixture.repositoryRoot,
            manifestPath: FREEZE_TARGET_PATH,
            reviewedOn: '2026-08-09',
            faultAfter: installedCase.faultAfter
          })).rejects.toThrow(installedCase.faultAfter);
          const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
          const journal = (
            JSON.parse(await readFile(path.join(transactionRoot, 'journal.json'), 'utf8')) as RecoveryJournalViewV3
          );
          const indexPath = repositoryIndexPath(fixture.repositoryRoot);
          const targetPath = installedCase.kind === 'index'
            ? indexPath
            : installedCase.kind === 'pointer'
              ? path.join(fixture.repositoryRoot, POINTER_PATH)
              : path.join(fixture.repositoryRoot, 'docs/work/rolling-plan.md');
          const nextPath = installedCase.kind === 'index'
            ? `${indexPath}.lock`
            : path.join(
                path.dirname(targetPath),
                `.${path.basename(targetPath)}.${journal.operationId.slice('sha256:'.length)}.next`
              );
          const artifactRoot = installedCase.kind === 'index' ? path.dirname(indexPath) : transactionRoot;
          const retiredNextPath = entryRecoveryPathForTest(
            artifactRoot,
            targetPath,
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
          await expect(freezeDocumentControlPlaneV1({
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
        } finally {
          await fixture.dispose();
        }
      }, 60_000);
    }
  }

  test('Linux journal S3 census rejects a same-byte different-inode active NEXT without effects', async () => {
    const fixture = await createFreezeFixture();
    try {
      await expect(freezeDocumentControlPlaneV1({
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
    } finally {
      await fixture.dispose();
    }
  }, 60_000);
}

test('read-only status overrides inherited optional locks and preserves the exact raw index', async () => {
  const fixture = await createFreezeFixture();
  const previousOptionalLocks = process.env.GIT_OPTIONAL_LOCKS;
  try {
    const frozen = await freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    const indexPath = repositoryIndexPath(fixture.repositoryRoot);
    const indexBefore = await readFile(indexPath);
    const treeBefore = runGit(fixture.repositoryRoot, ['write-tree']);
    const journalPath = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE, 'journal.json');
    const journalBefore = await readFile(journalPath);
    const observations: Array<Readonly<{
      args: readonly string[];
      environment: Readonly<Record<string, string>>;
    }>> = [];
    process.env.GIT_OPTIONAL_LOCKS = '1';
    const status = await resolveLiveControlPlane(fixture.repositoryRoot, {
      observeGitHub: false,
      resolverGitCommandObserver: (event) => observations.push(event)
    });
    expect(status.activation).toEqual({
      operationId: frozen.operationId,
      phase: 'terminal',
      terminal: true
    });
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((event) => event.environment.GIT_OPTIONAL_LOCKS === '0')).toBe(true);
    const commands = observations.map((event) => event.args.join(' '));
    expect(commands).toContain('status --short --branch');
    expect(commands.filter((command) => command === 'write-tree')).toHaveLength(2);
    expect(commands.some((command) => command.startsWith('show '))).toBe(true);
    expect(await readFile(indexPath)).toEqual(Buffer.from(indexBefore));
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(treeBefore);
    expect(await readFile(journalPath)).toEqual(Buffer.from(journalBefore));
  } finally {
    if (previousOptionalLocks === undefined) delete process.env.GIT_OPTIONAL_LOCKS;
    else process.env.GIT_OPTIONAL_LOCKS = previousOptionalLocks;
    await fixture.dispose();
  }
}, 60_000);

test('terminal idempotence blocks same-tree raw index stat drift without effects', async () => {
  const fixture = await createFreezeFixture();
  try {
    const frozen = await freezeDocumentControlPlaneV1({
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
    const durabilityEffects: CodexDevelopmentDurabilityEventV1[] = [];
    let renameEffects = 0;
    await expect(freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      durabilityObserver: (event) => { durabilityEffects.push(event); },
      beforeAnchoredRename: () => { renameEffects += 1; }
    })).rejects.toThrow('Terminal freeze Git index bytes do not equal the exact journal NEXT image.');
    expect(await readFile(indexPath)).toEqual(Buffer.from(driftedIndex));
    expect(runGit(fixture.repositoryRoot, ['write-tree'])).toBe(treeBefore);
    expect(durabilityEffects).toEqual([]);
    expect(renameEffects).toBe(0);
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test('journal recovery census blocks and preserves an unknown exact PRE recovery entry', async () => {
  const fixture = await createFreezeFixture();
  const unknown = Buffer.from('unknown journal PRE recovery bytes\n', 'utf8');
  try {
    await expect(freezeDocumentControlPlaneV1({
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
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test('journal recovery census blocks and preserves duplicate active NEXT artifacts', async () => {
  const fixture = await createFreezeFixture();
  try {
    await expect(freezeDocumentControlPlaneV1({
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
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test('journal residue census blocks canonical absence with an exact retired NEXT and preserves every entry', async () => {
  const fixture = await createFreezeFixture();
  try {
    await freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    const journalPath = path.join(transactionRoot, 'journal.json');
    const journalBytes = await readFile(journalPath);
    const retiredNextPath = journalRetiredNextPath(transactionRoot, journalPath, journalBytes);
    if (process.platform === 'win32') await writeFile(retiredNextPath, journalBytes);
    expect(await readFile(retiredNextPath)).toEqual(Buffer.from(journalBytes));
    const residuesBefore = await readEntryRecoveryByteSnapshot(transactionRoot);
    await unlink(journalPath);

    await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
      .rejects.toThrow('Freeze journal is absent while direct transaction residues remain');
    await expect(readFile(journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readEntryRecoveryByteSnapshot(transactionRoot)).toEqual(residuesBefore);
    expect(await readFile(retiredNextPath)).toEqual(Buffer.from(journalBytes));
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test('journal residue census blocks a sole PRE quarantine without canonical authority', async () => {
  const fixture = await createFreezeFixture();
  const residue = Buffer.from('sole PRE quarantine bytes\n', 'utf8');
  try {
    const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    await mkdir(transactionRoot, { recursive: true });
    const residuePath = path.join(transactionRoot, `.entry-${'1'.repeat(64)}.pre`);
    await writeFile(residuePath, residue);

    await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
      .rejects.toThrow('Freeze journal is absent while direct transaction residues remain');
    expect(await readFile(residuePath)).toEqual(residue);
    await expect(readFile(path.join(transactionRoot, 'journal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await fixture.dispose();
  }
}, 30_000);

test('journal residue census blocks an unbound direct entry beside canonical terminal authority', async () => {
  const fixture = await createFreezeFixture();
  const unknown = Buffer.from('unbound entry recovery bytes\n', 'utf8');
  try {
    await freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
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
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test('journal residue census double-read blocks content or exact-object identity replacement', async () => {
  const fixture = await createFreezeFixture();
  const replacement = Buffer.from('raced replacement residue bytes\n', 'utf8');
  try {
    await freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    const residueNames = (await readdir(transactionRoot)).filter((name) => FreezeEntryRecoveryNameForTestV1.test(name));
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
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test('closed-world transaction census blocks an orphan partial temporary index without journal authority', async () => {
  const fixture = await createFreezeFixture();
  const partial = Buffer.from('partial unbound temporary index bytes\n', 'utf8');
  try {
    const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    await mkdir(transactionRoot, { recursive: true });
    const temporaryIndexPath = path.join(transactionRoot, 'index-123-456.next');
    await writeFile(temporaryIndexPath, partial);
    await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
      .rejects.toThrow('Freeze journal is absent while direct transaction residues remain');
    expect(await readFile(temporaryIndexPath)).toEqual(partial);
    await expect(readFile(path.join(transactionRoot, 'journal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await fixture.dispose();
  }
}, 30_000);

test('closed-world transaction census blocks an arbitrary direct sibling beside canonical authority', async () => {
  const fixture = await createFreezeFixture();
  const unknown = Buffer.from('unknown direct transaction sibling\n', 'utf8');
  try {
    await freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    const journalPath = path.join(transactionRoot, 'journal.json');
    const journalBefore = await readFile(journalPath);
    const unknownPath = path.join(transactionRoot, 'arbitrary-unbound-sibling');
    await writeFile(unknownPath, unknown);
    await expect(resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false }))
      .rejects.toThrow('Unknown freeze transaction direct residue is preserved: arbitrary-unbound-sibling');
    expect(await readFile(unknownPath)).toEqual(unknown);
    expect(await readFile(journalPath)).toEqual(Buffer.from(journalBefore));
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test('freeze journal V3 owns exact next-index bytes and conservatively rejects legacy V1/V2 authority', async () => {
  const legacyFixture = await createFreezeFixture();
  try {
    await freezeDocumentControlPlaneV1({
      cwd: legacyFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    const transactionRoot = path.join(legacyFixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    const journalPath = path.join(transactionRoot, 'journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalViewV3;
    expect(journal.schema).toBe('sec-document-control-plane-freeze-journal-v3');
    expect(journal).not.toHaveProperty('retainedTemporaryIndexName');
    expect(Buffer.from(journal.index.next, 'base64').byteLength).toBeGreaterThan(0);
    expect((await resolveLiveControlPlane(legacyFixture.repositoryRoot, { observeGitHub: false })).activation)
      .toMatchObject({ operationId: journal.operationId, phase: 'terminal', terminal: true });

    for (const legacyVersion of ['v1', 'v2'] as const) {
      const legacy: Record<string, unknown> = { ...journal };
      legacy.schema = `sec-document-control-plane-freeze-journal-${legacyVersion}`;
      if (legacyVersion === 'v2') legacy.retainedTemporaryIndexName = 'index-123-456.next';
      await writeFile(journalPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');
      const beforeLegacyRejection = await readFreezeEffectSnapshot(legacyFixture.repositoryRoot);
      await expect(resolveLiveControlPlane(legacyFixture.repositoryRoot, { observeGitHub: false }))
        .rejects.toThrow(`Freeze journal ${legacyVersion.toUpperCase()} is legacy and cannot serve as recovery authority`);
      expect(await readFreezeEffectSnapshot(legacyFixture.repositoryRoot)).toEqual(beforeLegacyRejection);
    }
  } finally {
    await legacyFixture.dispose();
  }

  const digestFixture = await createFreezeFixture();
  try {
    await freezeDocumentControlPlaneV1({
      cwd: digestFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    const transactionRoot = path.join(digestFixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    const journalPath = path.join(transactionRoot, 'journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as RecoveryJournalViewV3;
    const mutatedIndex = Buffer.from(journal.index.next, 'base64');
    mutatedIndex[0] = mutatedIndex[0]! ^ 0xff;
    const mutated = {
      ...journal,
      index: { ...journal.index, next: mutatedIndex.toString('base64') }
    };
    await writeFile(journalPath, `${JSON.stringify(mutated, null, 2)}\n`, 'utf8');
    const beforeDigestRejection = await readFreezeEffectSnapshot(digestFixture.repositoryRoot);
    await expect(resolveLiveControlPlane(digestFixture.repositoryRoot, { observeGitHub: false }))
      .rejects.toThrow('Freeze journal operation digest mismatch');
    expect(await readFreezeEffectSnapshot(digestFixture.repositoryRoot)).toEqual(beforeDigestRejection);
  } finally {
    await digestFixture.dispose();
  }
}, 120_000);

test('candidate index staging stays outside the transaction root before journal publication', async () => {
  const fixture = await createFreezeFixture();
  const stop = new Error('stop after external candidate-index staging');
  const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
  let observedNames: readonly string[] | undefined;
  let observedTransactionRootAbsent = false;
  try {
    await expect(freezeDocumentControlPlaneV1({
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
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test('closed-world transaction census rejects a legacy temporary-index residue beside canonical authority', async () => {
  const fixture = await createFreezeFixture();
  try {
    await freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    const transactionRoot = path.join(fixture.repositoryRoot, JOURNAL_TRANSACTION_RELATIVE);
    const journal = JSON.parse(
      await readFile(path.join(transactionRoot, 'journal.json'), 'utf8')
    ) as RecoveryJournalViewV3;
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
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test('optional journal reads accept an absent parent while required control reads remain strict', async () => {
  const fixture = await createFreezeFixture();
  try {
    await rm(path.join(fixture.repositoryRoot, '.tmp'), { recursive: true, force: true });
    const status = await resolveLiveControlPlane(fixture.repositoryRoot, { observeGitHub: false });
    expect(status.activation).toBeNull();

    await rm(path.join(fixture.repositoryRoot, 'docs/work-packages'), { recursive: true, force: true });
    await expect(freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await fixture.dispose();
  }
}, 30_000);

test('status double-reads the activation journal and blocks a freeze that starts after its index snapshot', async () => {
  const fixture = await createFreezeFixture();
  try {
    const status = await resolveLiveControlPlane(fixture.repositoryRoot, {
      observeGitHub: false,
      afterIndexSnapshot: async () => {
        await expect(freezeDocumentControlPlaneV1({
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
    await freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
  } finally {
    await fixture.dispose();
  }
}, 30_000);

test('status returns a typed race when the captured index tree changes directly', async () => {
  const fixture = await createFreezeFixture();
  try {
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
  } finally {
    await fixture.dispose();
  }
}, 30_000);

for (const raceKind of ['local-default-ref', 'live-default-ref'] as const) {
  test(`status returns a typed race when ${raceKind} changes before readback`, async () => {
    const fixture = await createFreezeFixture();
    try {
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
    } finally {
      await fixture.dispose();
    }
  }, 30_000);
}

test('freeze preserves unrelated unstaged work but rejects unrelated staged and unknown recovery bytes', async () => {
  const unstagedFixture = await createFreezeFixture();
  try {
    await writeFile(path.join(unstagedFixture.repositoryRoot, 'user-notes.txt'), 'preserve me\n', 'utf8');
    await freezeDocumentControlPlaneV1({
      cwd: unstagedFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(await readFile(path.join(unstagedFixture.repositoryRoot, 'user-notes.txt'), 'utf8')).toBe('preserve me\n');
    expect(runGit(unstagedFixture.repositoryRoot, ['diff', '--cached', '--name-only']))
      .not.toContain('user-notes.txt');
  } finally {
    await unstagedFixture.dispose();
  }

  const stagedFixture = await createFreezeFixture();
  try {
    await writeFile(path.join(stagedFixture.repositoryRoot, 'user-staged.txt'), 'preserve staged\n', 'utf8');
    runGit(stagedFixture.repositoryRoot, ['add', 'user-staged.txt']);
    await expect(freezeDocumentControlPlaneV1({
      cwd: stagedFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('rejects unrelated staged paths');
    expect(await readFile(path.join(stagedFixture.repositoryRoot, 'user-staged.txt'), 'utf8'))
      .toBe('preserve staged\n');
    expect(runGit(stagedFixture.repositoryRoot, ['diff', '--cached', '--name-only']))
      .toBe('user-staged.txt');
  } finally {
    await stagedFixture.dispose();
  }

  const unknownFixture = await createFreezeFixture();
  try {
    await expect(freezeDocumentControlPlaneV1({
      cwd: unknownFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-pointer-publish'
    })).rejects.toThrow('after-pointer-publish');
    const rollingPath = path.join(unknownFixture.repositoryRoot, 'docs/work/rolling-plan.md');
    await writeFile(rollingPath, 'unknown user bytes\n', 'utf8');
    await expect(freezeDocumentControlPlaneV1({
      cwd: unknownFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('Rolling plan recovery tuple is not a legal pre-effect state; preserving every entry.');
    expect(await readFile(rollingPath, 'utf8')).toBe('unknown user bytes\n');
  } finally {
    await unknownFixture.dispose();
  }
}, 60_000);

test('freeze fails closed for stale main, symlink-mode targets, and index CAS collisions', async () => {
  const staleFixture = await createFreezeFixture();
  try {
    runGit(staleFixture.repositoryRoot, ['commit', '--quiet', '--allow-empty', '-m', 'remote advance']);
    const advanced = runGit(staleFixture.repositoryRoot, ['rev-parse', 'HEAD']);
    runGit(staleFixture.repositoryRoot, ['push', '--quiet', 'origin', `${advanced}:refs/heads/main`]);
    runGit(staleFixture.repositoryRoot, ['update-ref', 'refs/heads/main', staleFixture.baseSha]);
    runGit(staleFixture.repositoryRoot, ['update-ref', 'refs/remotes/origin/main', staleFixture.baseSha]);
    await expect(freezeDocumentControlPlaneV1({
      cwd: staleFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('Live default ref is stale');
  } finally {
    await staleFixture.dispose();
  }

  const modeFixture = await createFreezeFixture();
  try {
    const blob = runGit(modeFixture.repositoryRoot, ['hash-object', '-w', FREEZE_TARGET_PATH]);
    runGit(modeFixture.repositoryRoot, [
      'update-index', '--add', '--cacheinfo', '120000', blob, FREEZE_TARGET_PATH
    ]);
    await expect(freezeDocumentControlPlaneV1({
      cwd: modeFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('stage-zero regular blob');
  } finally {
    await modeFixture.dispose();
  }

  const collisionFixture = await createFreezeFixture();
  try {
    await expect(freezeDocumentControlPlaneV1({
      cwd: collisionFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-journal-prepare'
    })).rejects.toThrow('after-journal-prepare');
    await writeFile(path.join(collisionFixture.repositoryRoot, 'concurrent.txt'), 'concurrent index\n', 'utf8');
    runGit(collisionFixture.repositoryRoot, ['add', 'concurrent.txt']);
    await expect(freezeDocumentControlPlaneV1({
      cwd: collisionFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('Git index recovery tuple is not a legal pre-effect state; preserving every entry.');
    expect(runGit(collisionFixture.repositoryRoot, ['diff', '--cached', '--name-only']))
      .toBe('concurrent.txt');
  } finally {
    await collisionFixture.dispose();
  }
}, 60_000);

for (const raceKind of ['head', 'local-default', 'live-default', 'index'] as const) {
  test(`freeze rejects ${raceKind} drift at the pre-first-journal four-value fence`, async () => {
    const fixture = await createFreezeFixture();
    try {
      const alternate = runGit(fixture.repositoryRoot, [
        'commit-tree',
        `${fixture.baseSha}^{tree}`,
        '-p',
        fixture.baseSha,
        '-m',
        `${raceKind} pre-journal race`
      ]);
      if (raceKind === 'live-default') {
        runGit(fixture.repositoryRoot, [
          'push', '--quiet', 'origin', `${alternate}:refs/heads/pre-journal-race-source`
        ]);
      }
      await expect(freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        beforeInitialJournalFence: async () => {
          if (raceKind === 'head') {
            runGit(fixture.repositoryRoot, ['update-ref', 'HEAD', alternate]);
          } else if (raceKind === 'local-default') {
            runGit(fixture.repositoryRoot, ['update-ref', 'refs/remotes/origin/main', alternate]);
          } else if (raceKind === 'live-default') {
            runGit(fixture.remoteRoot, ['update-ref', 'refs/heads/main', alternate]);
          } else {
            await writeFile(path.join(fixture.repositoryRoot, 'pre-journal-index-race.txt'), 'race\n', 'utf8');
            runGit(fixture.repositoryRoot, ['add', 'pre-journal-index-race.txt']);
          }
        }
      })).rejects.toThrow('Document control freeze inputs changed before initial journal publication.');
      await expect(readFile(
        path.join(fixture.repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1/journal.json')
      )).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fixture.dispose();
    }
  }, 30_000);
}

test('anchored rename cannot be redirected by a parent-to-junction swap after handles are open', async () => {
  const fixture = await createFreezeFixture();
  const workPath = path.join(fixture.repositoryRoot, 'docs/work');
  const heldWorkPath = path.join(fixture.repositoryRoot, 'docs/work-held-by-anchor');
  const external = path.join(fixture.parent, 'anchored-rename-external');
  const externalPointer = path.join(external, 'active-work-package.md');
  const activePointer = path.join(workPath, 'active-work-package.md');
  let swapAttempted = false;
  let swapped = false;
  let windowsSwapFailure: NodeJS.ErrnoException | undefined;
  try {
    await mkdir(external);
    await writeFile(externalPointer, 'external sentinel\n', 'utf8');
    const activePointerBefore = await readFile(activePointer);
    let freezeFailure: unknown;
    try {
      await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        beforeAnchoredRename: async (event) => {
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
        }
      });
    } catch (error) {
      freezeFailure = error;
    }
    expect(swapAttempted).toBe(true);
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
      expect(freezeFailure).toBeInstanceOf(CodexDevelopmentUnsafeAnchoredPathError);
      expect(freezeFailure).toMatchObject({ code: 'DOCUMENT-CONTROL-UNSAFE-PATH-001' });
      expect(CodexDevelopmentParseActivePointerV2(
        await readFile(path.join(heldWorkPath, 'active-work-package.md'), 'utf8')
      ).manifest).toBe(FREEZE_TARGET_PATH);
    }

    if (swapped) {
      await rm(workPath, { recursive: true, force: true });
      expect(await readFile(externalPointer, 'utf8')).toBe('external sentinel\n');
      await rename(heldWorkPath, workPath);
      swapped = false;
    }
    const recovered = await freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
  } finally {
    if (swapped) {
      await rm(workPath, { recursive: true, force: true }).catch(() => undefined);
      await rename(heldWorkPath, workPath).catch(() => undefined);
    }
    await fixture.dispose();
  }
}, 60_000);

for (const faultAfter of [
  'after-pointer-pre-quarantine',
  'after-pointer-next-install'
] as const satisfies readonly CodexDevelopmentFreezeFaultV1[]) {
  test(`entry CAS rolls forward the exact ${faultAfter} crash state`, async () => {
    const fixture = await createFreezeFixture();
    const entryEvents: Array<Readonly<{ label: string; sourcePath: string; targetPath: string }>> = [];
    try {
      await expect(freezeDocumentControlPlaneV1({
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

      const recovered = await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
      expect(await readFile(pointerPath)).toEqual(next);
      await expect(readFile(nextPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fixture.dispose();
    }
  }, 60_000);
}

test('entry CAS preserves a target materialized after PRE quarantine', async () => {
  const fixture = await createFreezeFixture();
  const unknown = Buffer.from('unknown target collision bytes\n', 'utf8');
  let nextSourcePath: string | undefined;
  const preRecoveryPaths: string[] = [];
  let injected = false;
  try {
    await expect(freezeDocumentControlPlaneV1({
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
  } finally {
    await fixture.dispose();
  }
}, 60_000);

if (process.platform === 'linux') {
  test('Linux entry CAS blocks a swapped NEXT source after opening its exact fd', async () => {
    const fixture = await createFreezeFixture();
    const unknown = Buffer.from('unknown Linux source collision bytes\n', 'utf8');
    let originalNextPath: string | undefined;
    let heldNextPath: string | undefined;
    try {
      await expect(freezeDocumentControlPlaneV1({
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
      })).rejects.toThrow(/retained link source|opened source fd|current source entry/u);
      expect(originalNextPath).toBeDefined();
      expect(heldNextPath).toBeDefined();
      expect(await readFile(originalNextPath!)).toEqual(unknown);
      const journal = JSON.parse(await readFile(
        path.join(fixture.repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1/journal.json'),
        'utf8'
      )) as { files: { pointer: { next: string } } };
      expect(await readFile(heldNextPath!)).toEqual(Buffer.from(journal.files.pointer.next, 'base64'));
    } finally {
      await fixture.dispose();
    }
  }, 60_000);
}

test('journal entry CAS preserves a concurrently materialized unknown canonical target', async () => {
  const fixture = await createFreezeFixture();
  const unknown = Buffer.from('unknown canonical journal collision\n', 'utf8');
  let journalPath: string | undefined;
  let nextPath: string | undefined;
  try {
    await expect(freezeDocumentControlPlaneV1({
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
  } finally {
    await fixture.dispose();
  }
}, 60_000);

test('journal entry CAS blocks a name-swapped temporary NEXT source and preserves both entries', async () => {
  const fixture = await createFreezeFixture();
  const unknown = Buffer.from('unknown journal temporary replacement\n', 'utf8');
  let journalPath: string | undefined;
  let nextPath: string | undefined;
  let heldPath: string | undefined;
  try {
    await expect(freezeDocumentControlPlaneV1({
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
  } finally {
    await fixture.dispose();
  }
}, 60_000);

if (process.platform === 'win32') {
  test('exact cleanup preserves a replacement entry and fails closed after its opened-object byte check', async () => {
    const fixture = await createFreezeFixture();
    const unknown = Buffer.from('unknown cleanup replacement\n', 'utf8');
    let cleanupPath: string | undefined;
    let heldPath: string | undefined;
    try {
      await expect(freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        beforeAnchoredCleanup: async (event) => {
          if (cleanupPath !== undefined || event.label !== 'Git index exact PRE quarantine cleanup') return;
          cleanupPath = event.filePath;
          heldPath = `${event.filePath}.hook-held`;
          await rename(event.filePath, heldPath);
          await writeFile(event.filePath, unknown);
        }
      })).rejects.toThrow('Git index recovery tuple is not a legal pre-effect state; preserving every entry.');
      expect(cleanupPath).toBeDefined();
      expect(heldPath).toBeDefined();
      expect(await readFile(cleanupPath!)).toEqual(unknown);
      await expect(readFile(heldPath!)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fixture.dispose();
    }
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
    let swapFailure: NodeJS.ErrnoException | undefined;
    let targetName: string | undefined;
    try {
      await rm(path.join(fixture.repositoryRoot, '.tmp'), { recursive: true, force: true });
      await mkdir(parentPath, { recursive: true });
      await mkdir(external);
      await writeFile(externalSentinel, 'outside sentinel\n', 'utf8');
      let freezeFailure: unknown;
      try {
        await freezeDocumentControlPlaneV1({
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
      if (process.platform === 'win32') {
        expect(swapped).toBe(false);
        if (swapFailure === undefined || swapFailure.code === undefined) {
          throw new Error('Windows anchored create swap must fail with an explicit error code.');
        }
        expect(['EPERM', 'EBUSY']).toContain(swapFailure.code);
        expect(freezeFailure).toBe(swapFailure);
      } else {
        expect(process.platform).toBe('linux');
        expect(swapped).toBe(true);
        expect(freezeFailure).toBeDefined();
        const heldTargetPath = path.join(heldParentPath, targetName!);
        expect(await lstat(heldTargetPath)).toBeDefined();
        if (createKind === 'file') {
          expect(JSON.parse(await readFile(heldTargetPath, 'utf8'))).toMatchObject({
            schema: 'sec-document-control-plane-freeze-journal-v3',
            phase: 'prepared'
          });
        }
      }

      if (swapped) {
        await unlink(parentPath);
        await rename(heldParentPath, parentPath);
        swapped = false;
      }
      const recovered = await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      });
      expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
    } finally {
      if (swapped) {
        await unlink(parentPath).catch(() => undefined);
        await rename(heldParentPath, parentPath).catch(() => undefined);
      }
      await fixture.dispose();
    }
  }, 90_000);
}

test('fresh transaction directories flush each containing parent before freeze effects and recover', async () => {
  const orderedFixture = await createFreezeFixture();
  try {
    await rm(path.join(orderedFixture.repositoryRoot, '.tmp'), { recursive: true, force: true });
    const events: string[] = [];
    await expect(freezeDocumentControlPlaneV1({
      cwd: orderedFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-journal-prepare',
      createdParentBarrierObserver: ({ createdPath }) => {
        events.push(`directory:${path.relative(orderedFixture.repositoryRoot, createdPath)}`);
      },
      durabilityObserver: (event) => {
        events.push(`effect:${event.label}:${event.stage}`);
      }
    })).rejects.toThrow('after-journal-prepare');
    const firstEffect = events.findIndex((event) => event.startsWith('effect:'));
    expect(firstEffect).toBeGreaterThanOrEqual(3);
    expect(events.slice(0, 3)).toEqual([
      'directory:.tmp',
      `directory:${path.join('.tmp', 'codex')}`,
      `directory:${path.join('.tmp', 'codex', 'document-control-plane-freeze-v1')}`
    ]);
  } finally {
    await orderedFixture.dispose();
  }

  const failedFixture = await createFreezeFixture();
  try {
    await rm(path.join(failedFixture.repositoryRoot, '.tmp'), { recursive: true, force: true });
    const preTree = runGit(failedFixture.repositoryRoot, ['write-tree']);
    await expect(freezeDocumentControlPlaneV1({
      cwd: failedFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      beforeCreatedParentBarrier: ({ createdPath }) => {
        if (createdPath === path.join(failedFixture.repositoryRoot, '.tmp', 'codex')) {
          throw new Error('injected newly-created parent barrier failure');
        }
      }
    })).rejects.toBeInstanceOf(CodexDevelopmentDurabilityBarrierError);
    await expect(readFile(
      path.join(failedFixture.repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1/journal.json')
    )).rejects.toMatchObject({ code: 'ENOENT' });
    expect(runGit(failedFixture.repositoryRoot, ['write-tree'])).toBe(preTree);
    const recovered = await freezeDocumentControlPlaneV1({
      cwd: failedFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
  } finally {
    await failedFixture.dispose();
  }
}, 90_000);

test('platform path effects lock exact Win32 handles and POSIX dirfd operations', async () => {
  const source = await Bun.file(
    new URL('../../scripts/codex/document-control-plane.ts', import.meta.url)
  ).text();
  const windowsHandleOpenStart = source.indexOf('function openWindowsExactHandle(');
  const windowsHandleOpenEnd = source.indexOf('function assertNoWindowsReparsePoint(');
  expect(windowsHandleOpenStart).toBeGreaterThan(-1);
  expect(windowsHandleOpenEnd).toBeGreaterThan(windowsHandleOpenStart);
  const windowsHandleOpen = source.slice(windowsHandleOpenStart, windowsHandleOpenEnd);
  expect(source).toContain('const WindowsInvalidHandleValue = 0xffff_ffff_ffff_ffffn;');
  expect(source).toContain('returns: FFIType.u64');
  expect(source).toContain(
    'SetFilePointerEx: { args: [FFIType.u64, FFIType.i64, FFIType.ptr, FFIType.u32], returns: FFIType.i32 }'
  );
  const windowsHandleReadStart = source.indexOf('function readWindowsHandleBytes(');
  const windowsHandleReadEnd = source.indexOf('function writeWindowsHandleBytes(', windowsHandleReadStart);
  expect(windowsHandleReadStart).toBeGreaterThan(-1);
  expect(windowsHandleReadEnd).toBeGreaterThan(windowsHandleReadStart);
  const windowsHandleRead = source.slice(windowsHandleReadStart, windowsHandleReadEnd);
  expect(windowsHandleRead).toContain('SetFilePointerEx(handle, 0n, null, WindowsFileBegin)');
  expect(windowsHandleRead).toContain('while (offset < bytes.byteLength)');
  expect(windowsHandleRead).toContain('library.symbols.ReadFile(');
  expect(windowsHandleOpen).toContain('const handle = library.symbols.CreateFileW(');
  expect(windowsHandleOpen).toContain('if (handle === WindowsInvalidHandleValue)');
  expect(windowsHandleOpen).not.toContain('handle === null');
  expect(source).toContain('if (library.symbols.CloseHandle(entry.handle) === 0)');
  expect(source).toContain('const errorCode = library.symbols.GetLastError();');
  expect(source).toContain('renameInfo.writeBigUInt64LE(targetParentHandle, 8);');
  expect(source).toContain('const WindowsFileRenameInfo = 3;');
  expect(source).toContain('const WindowsFileRenameInformationEx = 65;');
  expect(source).toContain('if (win32Error !== WindowsErrorInvalidParameter) throw win32Failure;');
  expect(source).toContain('ntdll.symbols.NtSetInformationFile(');
  expect(source).toContain('library.symbols.SetFileInformationByHandle(');
  expect(source).toContain('library.symbols.renameat(');
  expect(source).toContain('requireLinuxRenameat2().symbols.renameat2(');
  expect(source).toContain('LinuxRenameNoReplace');
  expect(source).toContain('linkOpenedPosixFileNoReplace({');
  expect(source).toContain('LinuxAtEmptyPath');
  expect(source).toContain('LinuxAtSymlinkFollow');
  const posixRegularOpenStart = source.indexOf('function openPosixRegularFile(');
  const posixRegularOpenEnd = source.indexOf('function openWindowsDirectoryPath(', posixRegularOpenStart);
  expect(posixRegularOpenStart).toBeGreaterThan(-1);
  expect(posixRegularOpenEnd).toBeGreaterThan(posixRegularOpenStart);
  const posixRegularOpen = source.slice(posixRegularOpenStart, posixRegularOpenEnd);
  expect(posixRegularOpen).toContain('const retainedParentPath = realpathSync(`/proc/self/fd/${parent.fd}`);');
  expect(posixRegularOpen).toContain('const canonicalPath = path.join(retainedParentPath, name);');
  expect(posixRegularOpen).not.toContain('const canonicalPath = path.join(parent.canonicalPath, name);');
  expect(source).toContain('renameInfo.writeUInt8(input.replaceExisting === false ? 0 : 1, 0);');
  expect(source).toContain(
    '(input.replaceExisting === false ? 0 : WindowsFileRenameReplaceIfExists)'
  );
  expect(source).not.toContain('unlinkat:');
  expect(source).not.toContain('library.symbols.unlinkat(');
  expect(source).toContain('const anchorShareMode = input.createMissing || input.retainAgainstRename');
  expect(source).toContain('? WindowsShareReadWrite');
  expect(source).toContain('retainAgainstRename: true');
  expect(source).toContain('publishInitiallyAbsentEntryNoReplace({');
  const entryCasStart = source.indexOf('async function publishEntryNoReplaceCas(');
  const entryCasEnd = source.indexOf('async function writeAtomicCas(', entryCasStart);
  expect(entryCasStart).toBeGreaterThan(-1);
  expect(entryCasEnd).toBeGreaterThan(entryCasStart);
  const entryCas = source.slice(entryCasStart, entryCasEnd);
  const classifierStart = source.indexOf('async function classifyPublishEntryStateV1(');
  const classifierEnd = source.indexOf('function samePublishEntryObservation(', classifierStart);
  expect(classifierStart).toBeGreaterThan(-1);
  expect(classifierEnd).toBeGreaterThan(classifierStart);
  const classifier = source.slice(classifierStart, classifierEnd);
  const tupleReads = [
    'readEntry(input.targetPath, input.label)',
    'readEntry(input.nextPath, `${input.label} NEXT recovery entry`)',
    'readEntry(input.quarantinePath, `${input.label} PRE quarantine`)',
    'readEntry(input.retiredPrePath, `${input.label} retired PRE entry`)',
    'readEntry(input.retiredNextPath, `${input.label} retired NEXT entry`)'
  ].map((needle) => classifier.indexOf(needle));
  expect(tupleReads.every((index) => index > -1)).toBe(true);
  const byteClassChecks = classifier.indexOf('const exact = ');
  const firstStateDecision = classifier.indexOf("if (process.platform === 'linux')", byteClassChecks);
  expect(byteClassChecks).toBeGreaterThan(Math.max(...tupleReads));
  expect(firstStateDecision).toBeGreaterThan(byteClassChecks);
  const classifierSuccess = entryCas.indexOf('let resolution = await classifyPublishEntryStateV1(classifier);');
  expect(classifierSuccess).toBeGreaterThan(-1);
  expect(entryCas).toContain("if (state === 'linux-s0')");
  expect(entryCas).toContain("if (state === 'linux-s1')");
  expect(entryCas).toContain("if (state === 'linux-s4')");
  expect(entryCas).toContain("if (state === 'windows-prepared')");
  expect(entryCas).toContain("if (state === 'windows-quarantined')");
  expect(entryCas).not.toContain('target.equals(input.next)');
  const retainedEdgeStart = entryCas.indexOf('const runSelectedRetainedEdge = async');
  expect(retainedEdgeStart).toBeGreaterThan(classifierSuccess);
  expect(entryCas).toContain('withRetainedPublishEntryTupleV1(classifier');
  const retainedEdgeCalls = [...entryCas.matchAll(/runSelectedRetainedEdge\(/gu)]
    .map((match) => match.index ?? -1);
  expect(retainedEdgeCalls.length).toBeGreaterThan(5);
  expect(retainedEdgeCalls.every((position) => position > retainedEdgeStart)).toBe(true);
  const durableRenameStart = source.indexOf('async function durableRename(');
  const durableLinkStart = source.indexOf('async function durableLinkOpenedPosixFile(');
  const durableLinkEnd = source.indexOf('async function assertPosixEntryIdentity(', durableLinkStart);
  expect(durableRenameStart).toBeGreaterThan(-1);
  expect(durableLinkStart).toBeGreaterThan(durableRenameStart);
  expect(durableLinkEnd).toBeGreaterThan(durableLinkStart);
  const durableRename = source.slice(durableRenameStart, durableLinkStart);
  const durableLink = source.slice(durableLinkStart, durableLinkEnd);
  for (const effectSource of [durableRename, durableLink]) {
    const renamed = effectSource.indexOf("stage: 'renamed'");
    const postNamespaceHook = effectSource.indexOf('afterAnchoredNamespaceMutationBeforeFlush?.(');
    const retainedFlush = effectSource.indexOf('retained: Object.freeze({');
    expect(renamed).toBeGreaterThan(-1);
    expect(postNamespaceHook).toBeGreaterThan(renamed);
    expect(retainedFlush).toBeGreaterThan(postNamespaceHook);
  }
  expect(durableRename).toContain(
    'retained: Object.freeze({ handle: sourceHandle, parentHandle: targetParentHandle })'
  );
  expect(durableRename).toContain('retained: Object.freeze({ fd: source.fd, parentFd: targetParent.fd })');
  expect(durableLink).toContain('retained: Object.freeze({ fd: source.fd, parentFd: targetParent.fd })');
  const windowsInstalledStart = entryCas.indexOf("if (state === 'windows-installed')");
  const windowsInstalledEnd = entryCas.indexOf("if (state === 'linux-s4')", windowsInstalledStart);
  expect(windowsInstalledStart).toBeGreaterThan(-1);
  expect(windowsInstalledEnd).toBeGreaterThan(windowsInstalledStart);
  const windowsInstalled = entryCas.slice(windowsInstalledStart, windowsInstalledEnd);
  expect(windowsInstalled).not.toContain('exact NEXT recovery cleanup');
  const initialClassifierStart = source.indexOf('function initialTupleResolutionAdapter(');
  const initialTupleStart = source.indexOf('async function withRetainedInitiallyAbsentEntryTupleV1<T>(');
  const initialPublisherStart = source.indexOf('async function publishInitiallyAbsentEntryNoReplace(');
  const initialPublisherEnd = source.indexOf('async function resolveFreezeTransactionRoot(', initialPublisherStart);
  expect(initialClassifierStart).toBeGreaterThan(-1);
  expect(initialTupleStart).toBeGreaterThan(initialClassifierStart);
  expect(initialPublisherStart).toBeGreaterThan(initialTupleStart);
  expect(initialPublisherEnd).toBeGreaterThan(initialPublisherStart);
  const initialClassifier = source.slice(initialClassifierStart, initialTupleStart);
  const initialPublisher = source.slice(initialPublisherStart, initialPublisherEnd);
  expect(source).toContain('CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1');
  expect(source).toContain('CodexDevelopmentAssertInitiallyAbsentEntryTransitionV1');
  expect(source).not.toContain('classifyInitiallyAbsentEntryStateV1');
  expect(source).not.toContain('assertInitiallyAbsentTransitionIdentityV1');
  expect(initialClassifier).toContain('CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1({');
  expect(initialPublisher).toContain('withRetainedInitiallyAbsentEntryTupleV1(classifier');
  for (const edge of [
    'win32-w0->win32-w1',
    'win32-w1->win32-w2',
    'linux-l0->linux-l1',
    'linux-l1->linux-l2',
    'linux-l2->linux-l3'
  ]) expect(initialPublisher).toContain(edge);
  expect(initialPublisher).toContain('expectedSourceIdentity: retained.next.identity!');
  expect(initialPublisher).toContain('retained: retained.target.retained');
  expect(initialPublisher).not.toContain('removeOptionalSafeRegularFile({');
  for (const effect of [
    'createSafeRegularFileExclusive({',
    'durableLinkOpenedPosixFile({',
    'durableRename({',
    'flushPublishedFile({',
    'input.faultAfterNextPrepared?.()',
    'input.faultAfterPreQuarantine?.()',
    'input.faultAfterNextInstall?.()',
    'afterExactPreRecoveryLink?.',
    'durability: input.durability'
  ]) {
    const positions = [...entryCas.matchAll(new RegExp(effect.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'))]
      .map((match) => match.index ?? -1);
    expect(positions.length).toBeGreaterThan(0);
    expect(positions.every((position) => position > classifierSuccess)).toBe(true);
  }
  const journalWriterStart = source.indexOf('async function writeFreezeJournal(');
  const journalReaderStart = source.indexOf('async function readFreezeJournalSnapshot(');
  expect(journalWriterStart).toBeGreaterThan(-1);
  expect(journalReaderStart).toBeGreaterThan(journalWriterStart);
  const journalWriter = source.slice(journalWriterStart, journalReaderStart);
  const transitionRecoveryStart = source.indexOf('async function inspectJournalTransitionRecovery(');
  const recoveryCensusStart = source.indexOf('async function assertFreezeEntryRecoveryCensus(');
  const journalReaderEnd = source.indexOf('async function restoreFreezeJournalDurability(', journalReaderStart);
  expect(transitionRecoveryStart).toBeGreaterThan(-1);
  expect(recoveryCensusStart).toBeGreaterThan(transitionRecoveryStart);
  expect(journalReaderEnd).toBeGreaterThan(journalReaderStart);
  const transitionRecovery = source.slice(transitionRecoveryStart, recoveryCensusStart);
  const recoveryCensus = source.slice(recoveryCensusStart, journalReaderStart);
  const journalReader = source.slice(journalReaderStart, journalReaderEnd);
  expect(transitionRecovery).toContain('CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1({');
  expect(recoveryCensus).toContain('CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1({');
  expect(journalReader).toContain('CodexDevelopmentClassifyInitiallyAbsentEntryTupleV1({');
  expect(source).toContain("const FreezeJournalSchemaV3 = 'sec-document-control-plane-freeze-journal-v3' as const;");
  expect(source).toContain('Freeze journal V1 is legacy and cannot serve as recovery authority.');
  expect(source).toContain('Freeze journal V2 is legacy and cannot serve as recovery authority.');
  expect(source).not.toContain('retainedTemporaryIndexName');
  const buildNextIndexStart = source.indexOf('async function buildNextIndex(');
  const buildNextIndexEnd = source.indexOf('function assertCanonicalManifestPath(', buildNextIndexStart);
  expect(buildNextIndexStart).toBeGreaterThan(-1);
  expect(buildNextIndexEnd).toBeGreaterThan(buildNextIndexStart);
  const buildNextIndex = source.slice(buildNextIndexStart, buildNextIndexEnd);
  expect(buildNextIndex).toContain("mkdtemp(path.join(tmpdir(), 'sec-document-control-freeze-index-'))");
  expect(buildNextIndex).toContain('await rm(scratchRoot, { recursive: true, force: true });');
  expect(buildNextIndex).toContain("if (!removed) throw new Error('External freeze scratch Git index root remained after cleanup.');");
  expect(buildNextIndex).not.toContain('resolveFreezeTransactionRoot(');
  const freezeStart = source.indexOf('export async function freezeDocumentControlPlaneV1(');
  const freezeEnd = source.indexOf('function parseJsonArray(', freezeStart);
  expect(freezeStart).toBeGreaterThan(-1);
  expect(freezeEnd).toBeGreaterThan(freezeStart);
  const freezeSource = source.slice(freezeStart, freezeEnd);
  const preflightCalls = [...freezeSource.matchAll(/await preflightFreezeProjectionEntryStates\(/gu)]
    .map((match) => match.index ?? -1);
  const durabilityRestoreCalls = [...freezeSource.matchAll(/await restoreFreezeJournalDurability\(/gu)]
    .map((match) => match.index ?? -1);
  expect(preflightCalls).toHaveLength(2);
  expect(durabilityRestoreCalls).toHaveLength(2);
  expect(preflightCalls[0]!).toBeLessThan(durabilityRestoreCalls[0]!);
  expect(preflightCalls[1]!).toBeLessThan(durabilityRestoreCalls[1]!);
  const linuxCensusIdentityStart = recoveryCensus.indexOf("if (process.platform === 'linux') {");
  const linuxCensusIdentityEnd = recoveryCensus.indexOf('const requirePresent = ', linuxCensusIdentityStart);
  expect(linuxCensusIdentityStart).toBeGreaterThan(-1);
  expect(linuxCensusIdentityEnd).toBeGreaterThan(linuxCensusIdentityStart);
  const linuxCensusIdentityOwner = recoveryCensus.slice(linuxCensusIdentityStart, linuxCensusIdentityEnd);
  expect(linuxCensusIdentityOwner).toContain(
    'if (initialPreparedBytes !== null && entry.name === input.plan.initialRetiredNext) continue;'
  );
  expect(linuxCensusIdentityOwner).not.toContain(
    'if (entry.name === input.plan.initialRetiredNext) continue;'
  );
  expect(linuxCensusIdentityOwner).toContain(
    'bindIdentity(input.plan.expectations.get(entry.name)!.identityGroup, entry.identity, entry.name);'
  );
  for (const obsolete of [
    'Initially-absent freeze journal target is absent with a retired NEXT artifact.',
    'Windows initially-absent freeze journal has an unexpected retired NEXT artifact.',
    'Linux initially-absent freeze journal NEXT recovery identity is unprovable.',
    'Active prepared journal retired NEXT',
    'Canonical prepared journal retired NEXT',
    'Freeze journal initial retired NEXT identity is unprovable.',
    'input.canonicalEntry.identity !== retiredNext.identity',
    'initialRetiredNext.identity !== canonicalEntry!.identity',
    'preparedRecoveryPending'
  ]) expect(source).not.toContain(obsolete);
  expect(journalWriter).toContain('publishEntryNoReplaceCas({');
  expect(journalWriter).toContain('operationId: byteDigest(nextBytes)');
  expect(journalWriter).toContain('retainRecoveryEntries: true');
  expect(journalWriter).not.toContain('durableRename({');
  expect(source).toContain('fsConstants.O_NOFOLLOW');
  expect(source).toContain('const DOCUMENT_CONTROL_LINUX_X64_O_CLOEXEC_V1 = 0o2_000_000;');
  expect(source).toContain(
    "if (process.platform !== 'linux' || process.arch !== 'x64')"
  );
  expect(source).toContain(
    "throw new CodexDevelopmentUnsupportedAnchoredPathEffectError('pinned Linux x64 O_CLOEXEC UAPI');"
  );
  expect(source).toContain('return DOCUMENT_CONTROL_LINUX_X64_O_CLOEXEC_V1;');
  expect(source).not.toContain('.O_CLOEXEC');
  expect(source).not.toContain('readonly fcntl:');
  expect(source).not.toContain('fcntl: { args:');
  expect(source.match(/requireLinuxX64OpenCloseOnExecFlag\(\)/gu)).toHaveLength(5);
  expect(source.match(/const closeOnExec = requireLinuxX64OpenCloseOnExecFlag\(\);/gu)).toHaveLength(2);
});

test('freeze rejects reparse, nonregular, and outside auxiliary transaction paths', async () => {
  const journalFixture = await createFreezeFixture();
  try {
    const external = path.join(journalFixture.parent, 'journal-external');
    const codexRoot = path.join(journalFixture.repositoryRoot, '.tmp/codex');
    await mkdir(external, { recursive: true });
    await mkdir(codexRoot, { recursive: true });
    await symlink(
      external,
      path.join(codexRoot, 'document-control-plane-freeze-v1'),
      'junction'
    );
    await expectUnsafeReparseRejection(freezeDocumentControlPlaneV1({
      cwd: journalFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    }));
  } finally {
    await journalFixture.dispose();
  }

  const documentTempFixture = await createFreezeFixture();
  try {
    await expect(freezeDocumentControlPlaneV1({
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
      'docs/work',
      `.active-work-package.md.${journal.operationId.slice('sha256:'.length)}.next`
    );
    await symlink(external, pointerTemp, 'junction');
    await expectUnsafeReparseRejection(freezeDocumentControlPlaneV1({
      cwd: documentTempFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    }));
  } finally {
    await documentTempFixture.dispose();
  }

  const indexLockFixture = await createFreezeFixture();
  try {
    await expect(freezeDocumentControlPlaneV1({
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
    await expect(freezeDocumentControlPlaneV1({
      cwd: indexLockFixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    })).rejects.toThrow('Git index lock must be a regular file');
  } finally {
    await indexLockFixture.dispose();
  }

  const outsideIndexFixture = await createFreezeFixture();
  try {
    const indexCandidate = runGit(outsideIndexFixture.repositoryRoot, ['rev-parse', '--git-path', 'index']);
    const indexPath = path.isAbsolute(indexCandidate)
      ? indexCandidate
      : path.resolve(outsideIndexFixture.repositoryRoot, indexCandidate);
    const outsideIndex = path.join(outsideIndexFixture.parent, 'outside.index');
    await copyFile(indexPath, outsideIndex);
    const result = spawnSync(process.execPath, [
      path.resolve('scripts/codex/document-control-plane.ts'),
      'freeze',
      '--manifest',
      FREEZE_TARGET_PATH,
      '--reviewed-on',
      '2026-08-09',
      '--json'
    ], {
      cwd: outsideIndexFixture.repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, GIT_INDEX_FILE: outsideIndex }
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}\n${result.stdout}`).toContain('escapes its canonical transaction root');
  } finally {
    await outsideIndexFixture.dispose();
  }
}, 90_000);

if (process.platform === 'win32') {
  test('ordinary Win32 ACL denial is not classified as reparse evidence', async () => {
    const fixture = await createFreezeFixture();
    let pointerTemp: string | undefined;
    let denyApplied = false;
    try {
      await expect(freezeDocumentControlPlaneV1({
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
        'docs/work',
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

      const failure = await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09'
      }).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(failure).not.toBeInstanceOf(CodexDevelopmentUnsafeAnchoredPathError);
      expect(failure).toMatchObject({ code: 'WIN32_5' });
    } finally {
      if (denyApplied && pointerTemp !== undefined) {
        const restore = spawnSync('icacls', [pointerTemp, '/remove:d', '*S-1-1-0'], {
          cwd: fixture.repositoryRoot,
          encoding: 'utf8',
          windowsHide: true
        });
        if (restore.status !== 0) {
          throw new Error(`Failed to restore ordinary ACL fixture: ${restore.stderr || restore.stdout}`);
        }
      }
      await fixture.dispose();
    }
  }, 30_000);
}

test('every rename is followed by file flush and parent barrier before the next step', async () => {
  const fixture = await createFreezeFixture();
  try {
    const events: CodexDevelopmentDurabilityEventV1[] = [];
    const result = await freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      durabilityObserver: (event) => { events.push(event); }
    });
    expect(result.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
    const renameIndexes = events
      .map((event, index) => event.stage === 'renamed' ? index : -1)
      .filter((index) => index >= 0);
    expect(renameIndexes.length).toBeGreaterThanOrEqual(7);
    for (const index of renameIndexes) {
      expect(events.slice(index, index + 3).map((event) => [event.label, event.stage])).toEqual([
        [events[index]!.label, 'renamed'],
        [events[index]!.label, 'file-flushed'],
        [events[index]!.label, 'parent-barrier']
      ]);
    }
  } finally {
    await fixture.dispose();
  }
}, 30_000);

test('unsupported parent barrier fails typed before index advancement and remains recoverable', async () => {
  const fixture = await createFreezeFixture();
  try {
    const preTree = runGit(fixture.repositoryRoot, ['write-tree']);
    let failure: unknown;
    try {
      await freezeDocumentControlPlaneV1({
        cwd: fixture.repositoryRoot,
        manifestPath: FREEZE_TARGET_PATH,
        reviewedOn: '2026-08-09',
        parentDirectoryBarrier: async () => { throw new Error('unsupported fixture barrier'); }
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(CodexDevelopmentDurabilityBarrierError);
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
    expect(prepared.schema).toBe('sec-document-control-plane-freeze-journal-v3');
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

    await expect(freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-index-lock-write'
    })).rejects.toThrow('after-index-lock-write');
    await expect(readFile(preparedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(transactionRoot)).filter((entry) => JOURNAL_ACTIVE_NEXT.test(entry))).toEqual([]);
    expect(await readFile(canonicalJournalPath)).toEqual(Buffer.from(preparedBytes));
    if (process.platform === 'linux') {
      const retiredNextPath = journalRetiredNextPath(transactionRoot, canonicalJournalPath, preparedBytes);
      expect(await readFile(retiredNextPath)).toEqual(Buffer.from(preparedBytes));
      const canonicalMetadata = await lstat(canonicalJournalPath);
      const retiredMetadata = await lstat(retiredNextPath);
      expect({ dev: retiredMetadata.dev, ino: retiredMetadata.ino }).toEqual({
        dev: canonicalMetadata.dev,
        ino: canonicalMetadata.ino
      });
    }

    const recovered = await freezeDocumentControlPlaneV1({
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
    const finalJournal = JSON.parse(await readFile(canonicalJournalPath, 'utf8')) as {
      phase: string;
      operationId: string;
      candidateTreeSha: string;
    };
    expect(finalJournal).toEqual(expect.objectContaining({
      phase: 'terminal',
      operationId: validatedPreparedOperationId,
      candidateTreeSha: finalTree
    }));
  } finally {
    await fixture.dispose();
  }
}, 30_000);

test('after-terminal fault preserves the terminal result and idempotent recovery', async () => {
  const fixture = await createFreezeFixture();
  try {
    await expect(freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09',
      faultAfter: 'after-terminal'
    })).rejects.toThrow('after-terminal');
    const journal = JSON.parse(await readFile(
      path.join(fixture.repositoryRoot, '.tmp/codex/document-control-plane-freeze-v1/journal.json'),
      'utf8'
    )) as { phase: string; result: CodexDevelopmentFreezeResultV1 };
    expect(journal.phase).toBe('terminal');
    const recovered = await freezeDocumentControlPlaneV1({
      cwd: fixture.repositoryRoot,
      manifestPath: FREEZE_TARGET_PATH,
      reviewedOn: '2026-08-09'
    });
    expect(recovered).toEqual(journal.result);
    expect(recovered.candidateHeadSha).toBeNull();
    expect(recovered.status).toBe('ACTIVATED_INDEX_PENDING_COMMIT');
  } finally {
    await fixture.dispose();
  }
}, 30_000);

test('repository controls use the shared live resolver and preserve one bounded rolling window', async () => {
  const [currentStateSource, pointerSource, lifecycleAuthority, rollingPlan] = await Promise.all([
    readFile(CURRENT_STATE_PATH, 'utf8'),
    readFile(POINTER_PATH, 'utf8'),
    readFile('docs/development-governance.md', 'utf8'),
    readFile('docs/work/rolling-plan.md', 'utf8')
  ]);
  const currentState = CodexDevelopmentParseCurrentStateSpecV1(currentStateSource);
  const pointer = CodexDevelopmentParseActivePointerV2(pointerSource);
  const manifestBlob = readGitBlob(process.cwd(), `:${pointer.manifest}`);
  const activePackageId = path.basename(pointer.manifest, '.md');

  expect(currentState.schema).toBe('sec-current-state-live-v1');
  expect(currentState.resolver).toEqual({
    command: 'bun scripts/codex/document-control-plane.ts status --json',
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

  const defaultManifestBlob = readGitBlob(
    process.cwd(),
    `${pointer.defaultBranchRef}:${pointer.manifest}`
  ) ?? null;
  const repositoryResolution = CodexDevelopmentResolveActiveWorkPackageV1({
    pointer,
    candidateManifestBlob: manifestBlob!,
    defaultManifestBlob,
    defaultRefState: 'fresh'
  });
  if (
    defaultManifestBlob
    && CodexDevelopmentWorkPackageManifestDigest(defaultManifestBlob) === pointer.manifestDigest
  ) {
    expect(repositoryResolution).toEqual({ state: 'none', reason: 'matching-default-blob' });
  } else {
    expect(repositoryResolution).toEqual({
      state: 'active',
      manifest: pointer.manifest,
      manifestDigest: pointer.manifestDigest
    });
  }

  expect(lifecycleAuthority).toContain('selected frozen Work Package');
  expect(lifecycleAuthority).toContain('Resolver 无法确定');
  expect(lifecycleAuthority).toContain('fail closed');
  expect(lifecycleAuthority).toContain('VerificationSession（T2 target owner）');
  expect(lifecycleAuthority).toContain('进入new main且ordinary canary通过前');
  expect(lifecycleAuthority).toContain('Pointer、branch、PR或candidate存在都不是执行/合并授权');
  expect(lifecycleAuthority).toContain('Result、Evidence、Review、MainHealth、Work Package或Integration authority');
  const parsedRollingPlan = CodexDevelopmentParseRollingPlanV1(rollingPlan);
  expect(parsedRollingPlan.activePackageId).toBe(activePackageId);
  expect(parsedRollingPlan.candidatePackageIds.length).toBeGreaterThanOrEqual(2);
  expect(parsedRollingPlan.candidatePackageIds.length).toBeLessThanOrEqual(5);
});
