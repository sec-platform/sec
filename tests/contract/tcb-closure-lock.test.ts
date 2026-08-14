import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  TCB_CLOSURE_LOCK,
  TCB_CLOSURE_LOCK_RECEIPT,
  TCB_CLOSURE_TRUST_REVISION,
  TCB_REVIEWED_PROCESS_DISPATCHERS,
  TCB_TRUST_ROOT_V3,
  assertTcbClosureLockDataMatchesV2,
  computeTcbClosureLock,
  createTcbClosureCandidateSnapshotV1,
  finalizeTcbClosureCandidateSnapshotV1,
  generateTcbClosureLockV2,
  parseTcbClosureGeneratedRegionV2,
  planTcbClosureLockSourceV2,
  readTcbClosureCandidateFileV1,
  renderTcbClosureGeneratedRegionV2,
  runtimeRelativeImportsFromSource,
  trustedRuntimeClosure,
  verifyTcbClosureLock
} from '../../platform/shared/tcb-closure-lock.ts';
import { SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3 } from '../../platform/shared/tcb-trust-root-contract.ts';

test('TCB candidate root exclusively drives closure discovery and hashing', () => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-root-')));
  try {
    writeFileSync(path.join(root, 'entry.ts'), "import './leaf.ts';\n", 'utf8');
    writeFileSync(path.join(root, 'leaf.ts'), 'export const leaf = 1;\n', 'utf8');
    const snapshot = createTcbClosureCandidateSnapshotV1({ candidateRoot: root });
    const options = { candidateSnapshot: snapshot };
    const closure = trustedRuntimeClosure(['entry.ts'], options);
    expect([...closure.closure].sort()).toEqual(['entry.ts', 'leaf.ts']);
    const lock = computeTcbClosureLock(closure, options);
    expect(lock.modules).toEqual(['entry.ts', 'leaf.ts']);
    expect(lock.trustRevision).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(lock.moduleBlobs['entry.ts']).toMatch(/^[0-9a-f]{40}$/u);
    expect(lock.moduleContentDigests['leaf.ts']).toMatch(/^sha256:[0-9a-f]{64}$/u);
    finalizeTcbClosureCandidateSnapshotV1(snapshot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('one explicit candidate snapshot rejects discovery-to-hash mutation and missing-path appearance', () => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-snapshot-')));
  try {
    writeFileSync(path.join(root, 'entry.ts'), "import './leaf.ts';\n", 'utf8');
    writeFileSync(path.join(root, 'leaf.ts'), 'export const leaf = 1;\n', 'utf8');
    const snapshot = createTcbClosureCandidateSnapshotV1({ candidateRoot: root });
    const options = { candidateSnapshot: snapshot };
    const closure = trustedRuntimeClosure(['entry.ts'], options);
    writeFileSync(path.join(root, 'leaf.ts'), 'export const leaf = 2;\n', 'utf8');
    expect(() => computeTcbClosureLock(closure, options)).toThrow('snapshot changed');

    const missingSnapshot = createTcbClosureCandidateSnapshotV1({ candidateRoot: root });
    expect(() => readTcbClosureCandidateFileV1('appeared.ts', {
      candidateSnapshot: missingSnapshot
    })).toThrow('module is missing');
    writeFileSync(path.join(root, 'appeared.ts'), 'export const appeared = true;\n', 'utf8');
    expect(() => finalizeTcbClosureCandidateSnapshotV1(missingSnapshot))
      .toThrow('after observing a missing module');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TCB candidate root rejects aliases, traversal, and non-regular candidate leaves', () => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-negative-')));
  const outside = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-outside-')));
  try {
    writeFileSync(path.join(root, 'entry.ts'), 'export const entry = 1;\n', 'utf8');
    writeFileSync(path.join(root, 'root-file'), 'not a directory\n', 'utf8');
    mkdirSync(path.join(root, 'directory.ts'));
    const outsideFile = path.join(outside, 'leaf.ts');
    const hardLinkSource = path.join(outside, 'hard-link-source.ts');
    writeFileSync(outsideFile, 'export const outside = true;\n', 'utf8');
    writeFileSync(hardLinkSource, 'export const hardLinkSource = true;\n', 'utf8');
    linkSync(hardLinkSource, path.join(root, 'leaf.ts'));
    symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => trustedRuntimeClosure(['entry.ts'], {
      candidateRoot: `${root}${path.sep}`
    })).toThrow('absolute canonical path');
    expect(() => trustedRuntimeClosure(['entry.ts'], {
      candidateRoot: path.join(root, 'root-file')
    })).toThrow('physical non-symlink canonical directory');
    expect(() => trustedRuntimeClosure(['../entry.ts'], { candidateRoot: root }))
      .toThrow('module path is not canonical');
    expect(() => trustedRuntimeClosure(['directory.ts'], { candidateRoot: root }))
      .toThrow('physical single-link regular file');
    expect(() => trustedRuntimeClosure(['leaf.ts'], { candidateRoot: root }))
      .toThrow('physical single-link regular file');
    expect(() => trustedRuntimeClosure(['linked/leaf.ts'], { candidateRoot: root }))
      .toThrow('module path is not canonical');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('TCB closure lock has the correct schema and trust revision', () => {
  expect(TCB_CLOSURE_LOCK.schema).toBe('sec-tcb-closure-lock-v2');
  expect(TCB_CLOSURE_LOCK.trustRevision).toBe(TCB_CLOSURE_TRUST_REVISION);
  expect(TCB_CLOSURE_LOCK.trustRevision).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('V2 closure generation has no base-revision compatibility export or pseudo-binding', () => {
  const source = readFileSync(
    path.resolve(import.meta.dir, '../../platform/shared/tcb-closure-lock.ts'),
    'utf8'
  );
  expect(source).not.toContain('generateTcbClosureLockForRevision');
  expect(source).not.toContain('trustedBaseRevision');
  expect(generateTcbClosureLockV2().trustRevision).toBe(TCB_CLOSURE_TRUST_REVISION);
});

test('TCB closure lock binds the reviewed causal module set', () => {
  expect(TCB_CLOSURE_LOCK.moduleCount).toBe(TCB_CLOSURE_LOCK.modules.length);
  expect(TCB_CLOSURE_LOCK.modules).toContain('platform/shared/canonical-primitives.ts');
  expect(new Set(TCB_CLOSURE_LOCK.modules).size).toBe(TCB_CLOSURE_LOCK.moduleCount);
});

test('TCB closure lock is the sole causal-runtime identity consumed by the trust-root view', () => {
  expect(TCB_TRUST_ROOT_V3.causalRuntimePaths).toEqual(TCB_CLOSURE_LOCK.modules);
  expect(TCB_CLOSURE_LOCK.modules).toContain('platform/shared/tcb-trust-root-contract.ts');
  expect(TCB_CLOSURE_LOCK.modules).toContain('platform/shared/verification-action-ci-contract.ts');
  expect(TCB_CLOSURE_LOCK.modules).toContain('platform/shared/verification-session-contract.ts');
  expect(TCB_CLOSURE_LOCK.modules).toContain('scripts/codex/verification-session-runtime.ts');
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3.staticExactPaths)
    .toContain('scripts/codex/branch-lifecycle.ts');
  expect(TCB_TRUST_ROOT_V3.causalRuntimePaths)
    .not.toContain('scripts/codex/branch-lifecycle.ts');
  expect(TCB_CLOSURE_LOCK.modules).not.toContain('scripts/codex/branch-lifecycle.ts');
  expect(TCB_CLOSURE_LOCK.modules.some((entry) => entry.includes('sec-merge-bootstrap'))).toBe(false);
  expect(TCB_CLOSURE_LOCK.modules).not.toContain('scripts/codex/repository-audit.ts');
  expect(TCB_CLOSURE_LOCK.reviewedBoundaryEdges).toEqual([
    'scripts/ci-verification.ts -> platform/shared/tcb-closure-lock.ts',
    'scripts/codex/verification-session.ts -> platform/shared/tcb-closure-lock.ts'
  ]);
});

test('TCB closure lock binds Git blobs and content digests for every module', () => {
  for (const module of TCB_CLOSURE_LOCK.modules) {
    expect(TCB_CLOSURE_LOCK.moduleBlobs[module]).toMatch(/^[0-9a-f]{40}$/);
    expect(TCB_CLOSURE_LOCK.moduleContentDigests[module]).toMatch(/^sha256:[0-9a-f]{64}$/);
  }
  expect(Object.keys(TCB_CLOSURE_LOCK.moduleBlobs)).toHaveLength(TCB_CLOSURE_LOCK.moduleCount);
  expect(Object.keys(TCB_CLOSURE_LOCK.moduleContentDigests)).toHaveLength(TCB_CLOSURE_LOCK.moduleCount);
});

test('TCB closure lock receipt records the generation metadata', () => {
  expect(TCB_CLOSURE_LOCK_RECEIPT.schema).toBe('sec-tcb-closure-lock-receipt-v2');
  expect(TCB_CLOSURE_LOCK_RECEIPT.trustRevision).toBe(TCB_CLOSURE_TRUST_REVISION);
  expect(TCB_CLOSURE_LOCK_RECEIPT.moduleCount).toBe(TCB_CLOSURE_LOCK.moduleCount);
  expect(TCB_CLOSURE_LOCK_RECEIPT.reviewedBoundaryEdgeCount).toBe(TCB_CLOSURE_LOCK.reviewedBoundaryEdges.length);
  expect(TCB_CLOSURE_LOCK_RECEIPT.closureDigest).toBe(TCB_CLOSURE_LOCK.closureDigest);
  expect(TCB_CLOSURE_LOCK_RECEIPT.generatedBy).toBe('tcb-closure-maintainer');
});

test('TCB generated region renderer, parser and planner are canonical and preserve no-op time', () => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-tcb-renderer-')));
  try {
    mkdirSync(path.join(root, 'fixture'), { recursive: true });
    const modulePath = path.join(root, 'fixture', 'entry.ts');
    writeFileSync(modulePath, 'export const value = 1;\n', 'utf8');
    const input = {
      closure: new Set(['fixture/entry.ts']),
      reviewedEdges: new Set<string>(),
      reviewedBoundaryEdges: new Set<string>(),
      reviewedExternalImports: new Set<string>(),
      reviewedProcessDispatchers: new Set<string>()
    };
    const first = computeTcbClosureLock(input, { candidateRoot: root });
    expect(first.trustRevision).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const generatedAt = '2026-08-09T00:00:00.000Z';
    const region = renderTcbClosureGeneratedRegionV2(first, generatedAt);
    const source = `// prefix\n${region}\n// suffix\n`;
    const parsed = parseTcbClosureGeneratedRegionV2(source);
    expect(parsed.lock).toEqual(first);
    expect(parsed.receipt.generatedAt).toBe(generatedAt);
    expect(() => assertTcbClosureLockDataMatchesV2(parsed.lock, first)).not.toThrow();
    expect(() => parseTcbClosureGeneratedRegionV2(source.replace(
      '"schema": "sec-tcb-closure-lock-v2"',
      '"schema": "sec-tcb-closure-lock-v1"'
    ))).toThrow('schema mismatch');
    expect(() => parseTcbClosureGeneratedRegionV2(
      source.replaceAll(first.trustRevision, '1'.repeat(40))
    )).toThrow('trustRevision is not derived');

    const noOp = planTcbClosureLockSourceV2({
      source,
      nextLock: first,
      generatedAt: '2026-08-09T01:00:00.000Z'
    });
    expect(noOp.status).toBe('current');
    expect(noOp.nextSource).toBe(source);
    expect(noOp.nextGeneratedAt).toBe(generatedAt);

    writeFileSync(modulePath, 'export const value = 2;\n', 'utf8');
    const second = computeTcbClosureLock(input, { candidateRoot: root });
    expect(() => assertTcbClosureLockDataMatchesV2(parsed.lock, second))
      .toThrow('trustRevision');
    expect(() => assertTcbClosureLockDataMatchesV2(parsed.lock, {
      ...parsed.lock,
      closureDigest: `sha256:${'0'.repeat(64)}`
    })).toThrow('closureDigest');
    const update = planTcbClosureLockSourceV2({
      source,
      nextLock: second,
      generatedAt: '2026-08-09T02:00:00.000Z'
    });
    expect(update.status).toBe('update-required');
    expect(parseTcbClosureGeneratedRegionV2(update.nextSource).lock).toEqual(second);
    expect(update.nextRawSourceDigest).not.toBe(update.oldRawSourceDigest);

    expect(() => parseTcbClosureGeneratedRegionV2(
      source.replace('// <sec-tcb-closure-lock-generated-v2>', '// missing-generated-region')
    )).toThrow('exactly one complete generated-region sentinel pair');
    expect(() => parseTcbClosureGeneratedRegionV2(`${source}${region}\n`))
      .toThrow('exactly one complete generated-region sentinel pair');
    expect(() => planTcbClosureLockSourceV2({
      source,
      nextLock: second,
      generatedAt: '2026-08-09T02:00:00Z'
    })).toThrow('canonical ISO-8601 UTC');
    expect(() => computeTcbClosureLock(
      { ...input, closure: new Set(['fixture/missing.ts']) },
      { candidateRoot: root }
    ))
      .toThrow('missing or unreadable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Action provider preflight binds the exact eight dispatchers and rejects near-name or ordinal expansion', () => {
  const actionDispatchers = [...TCB_REVIEWED_PROCESS_DISPATCHERS].filter((identity) =>
    identity.startsWith('scripts/ci-verification.ts::') ||
    identity.startsWith('scripts/codex/verification-action-github-provider.ts::')
  ).sort();
  expect(actionDispatchers).toEqual([
    'scripts/ci-verification.ts::function-declaration:inspectHostedActionArchiveMetadataV2::spawnSync#1',
    'scripts/ci-verification.ts::function-declaration:defaultHostedSutSandboxProcessV1::spawn#1',
    'scripts/ci-verification.ts::function-declaration:gitCandidateBytesV2::spawnSync#1',
    'scripts/ci-verification.ts::function-declaration:hostedActionGhReadJsonV2::spawnSync#1',
    'scripts/ci-verification.ts::function-declaration:runHostedMaterializerCommandV2::spawnSync#1',
    'scripts/codex/verification-action-github-provider.ts::function-declaration:dispatchVerificationActionRepositoryWakeupV2::spawnSync#1',
    'scripts/codex/verification-action-github-provider.ts::function-declaration:ghBytes::spawnSync#1',
    'scripts/codex/verification-action-github-provider.ts::function-declaration:runProcessText::spawnSync#1'
  ].sort());

  const repositoryPath = 'platform/dev-runner.ts';
  const canonicalSource = 'export function executeVerifiedCiActionPlanV1(){ Bun.spawn({cmd:["bun"],cwd:"."}); }';
  const observed = new Set<string>();
  expect(() => runtimeRelativeImportsFromSource(
    repositoryPath, canonicalSource, observed, new Set(), new Set()
  )).not.toThrow();
  expect([...observed]).toEqual([
    'platform/dev-runner.ts::function-declaration:executeVerifiedCiActionPlanV1::Bun.spawn#1'
  ]);
  for (const hostileSource of [
    canonicalSource.replace('executeVerifiedCiActionPlanV1', 'executeVerifiedCiActionPlanVl'),
    canonicalSource.replace(' }', ' Bun.spawn({cmd:["bun","--forged"],cwd:"../"}); }')
  ]) {
    expect(() => runtimeRelativeImportsFromSource(
      repositoryPath, hostileSource, new Set(), new Set(), new Set()
    )).toThrow('unreviewed process dispatcher');
  }
  const digest = (source: string) => createHash('sha256').update(source).digest('hex');
  expect(digest(canonicalSource.replace('["bun"]', '["bun","--forged"]'))).not.toBe(digest(canonicalSource));
  expect(digest(canonicalSource.replace('cwd:"."', 'cwd:"../"'))).not.toBe(digest(canonicalSource));
});

test('Hosted archive inventory has one fixed bounded dispatcher shared by every trusted materializer', async () => {
  const repositoryPath = 'scripts/ci-verification.ts';
  const identity =
    'scripts/ci-verification.ts::function-declaration:inspectHostedActionArchiveMetadataV2::spawnSync#1';
  expect(TCB_REVIEWED_PROCESS_DISPATCHERS.has(identity)).toBe(true);
  const source = (await Bun.file(
    new URL('../../scripts/ci-verification.ts', import.meta.url)
  ).text()).replace(/\r\n/gu, '\n');
  const start = source.indexOf('function inspectHostedActionArchiveMetadataV2(');
  const end = source.indexOf('\nfunction canonicalHostedArchivePathV2(', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const dispatcher = source.slice(start, end);
  const assertDispatcher = (candidate: string): void => {
    expect(candidate).toContain(
      'function inspectHostedActionArchiveMetadataV2(archive: string, label: string): unknown {'
    );
    expect(candidate.match(/spawnSync\(/gu)).toHaveLength(1);
    expect(candidate).toContain("    '/usr/bin/python3',");
    expect(candidate).toContain("    ['-c', HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT_V2, archive],");
    expect(candidate).toContain("      encoding: 'utf8',");
    expect(candidate).toContain('      windowsHide: true,');
    expect(candidate).toContain('      maxBuffer: 128 * 1024 * 1024,');
    expect(candidate).toContain("      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }");
    expect(candidate).not.toContain('cwd:');
    expect(candidate).not.toContain('shell:');
    expect(candidate).not.toContain('execSync');
    expect(candidate).not.toContain('process.env');
  };
  assertDispatcher(dispatcher);
  for (const [label, hostile] of [
    ['name', dispatcher.replace('inspectHostedActionArchiveMetadataV2', 'inspectHostedActionArchiveMetadataNearNameV2')],
    ['command', dispatcher.replace("'/usr/bin/python3'", "'/usr/local/bin/python3'")],
    ['script', dispatcher.replace('HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT_V2', 'HOSTED_ACTION_ARCHIVE_INVENTORY_SCRIPT_NEAR_V2')],
    ['archive', dispatcher.replace(', archive],', ", `${archive}.candidate`],")],
    ['cwd', dispatcher.replace("encoding: 'utf8',", "cwd: archive, encoding: 'utf8',")],
    ['environment', dispatcher.replace("{ PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }", 'process.env')],
    ['output-bound', dispatcher.replace('128 * 1024 * 1024', '256 * 1024 * 1024')],
    ['ordinal', dispatcher.replace(
      '  const inventory = spawnSync(',
      "  spawnSync('/usr/bin/python3', ['--version']);\n  const inventory = spawnSync("
    )]
  ] as const) {
    expect(hostile).not.toBe(dispatcher);
    let rejected = false;
    try { assertDispatcher(hostile); } catch { rejected = true; }
    if (!rejected) throw new Error(`Hosted archive dispatcher mutation was not rejected: ${label}`);
  }
  const observed = new Set<string>();
  runtimeRelativeImportsFromSource(repositoryPath, source, observed, new Set(), new Set());
  expect(observed.has(identity)).toBe(true);
  expect([...observed].filter((value) => value.includes('inspectHostedActionArchiveMetadataV2')))
    .toEqual([identity]);
});

test('verification-action runner dispatcher binds exact local Git observations and rejects semantic drift', async () => {
  const repositoryPath = 'scripts/codex/verification-action-runner.ts';
  const dispatcherIdentity =
    'scripts/codex/verification-action-runner.ts::function-declaration:inspectLocalRepository>const-arrow:git::spawnSync#1';
  expect(TCB_REVIEWED_PROCESS_DISPATCHERS.has(dispatcherIdentity)).toBe(true);

  const canonicalSource = [
    "import { spawnSync } from 'node:child_process';",
    'function inspectLocalRepository(repositoryRoot: string) {',
    '  const git = (...args: string[]): string => {',
    "    const result = spawnSync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8', windowsHide: true, env: createBranchLifecycleGitChildEnvironmentV1(process.env) });",
    '    return result.stdout.trim();',
    '  };',
    '  return {',
    "    headSha: git('rev-parse', 'HEAD'),",
    "    headTreeSha: git('rev-parse', 'HEAD^{tree}'),",
    "    trackedClean: git('status', '--porcelain=v1', '--untracked-files=all') === '',",
    "    gitCommonDirectory: git('rev-parse', '--path-format=absolute', '--git-common-dir')",
    '  };',
    '}'
  ].join('\n');
  const observed = new Set<string>();
  expect(() => runtimeRelativeImportsFromSource(
    repositoryPath, canonicalSource, observed, new Set(), new Set()
  )).not.toThrow();
  expect([...observed]).toEqual([dispatcherIdentity]);

  const astHostileSources = [
    canonicalSource.replace('function inspectLocalRepository(', 'function inspectLocalRepositories('),
    canonicalSource.replace('const git =', 'const gitNearName ='),
    canonicalSource.replace(
      '    return result.stdout.trim();',
      "    spawnSync('git', ['status']);\n    return result.stdout.trim();"
    ),
    canonicalSource.replace(
      "    const result = spawnSync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8', windowsHide: true, env: createBranchLifecycleGitChildEnvironmentV1(process.env) });",
      [
        '    const nestedGit = () =>',
        "      spawnSync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8', windowsHide: true, env: createBranchLifecycleGitChildEnvironmentV1(process.env) });",
        '    const result = nestedGit();'
      ].join('\n')
    )
  ];
  for (const hostileSource of astHostileSources) {
    expect(hostileSource).not.toBe(canonicalSource);
    expect(() => runtimeRelativeImportsFromSource(
      repositoryPath, hostileSource, new Set(), new Set(), new Set()
    )).toThrow('unreviewed process dispatcher');
  }

  const runnerSource = (await Bun.file(
    new URL('../../scripts/codex/verification-action-runner.ts', import.meta.url)
  ).text()).replace(/\r\n/gu, '\n');
  const inspectStart = runnerSource.indexOf('function inspectLocalRepository(');
  const inspectEnd = runnerSource.indexOf('\nfunction resolveDependency(', inspectStart);
  expect(inspectStart).toBeGreaterThanOrEqual(0);
  expect(inspectEnd).toBeGreaterThan(inspectStart);
  const inspectSource = runnerSource.slice(inspectStart, inspectEnd);
  expect(inspectSource.match(/spawnSync\(/gu)).toHaveLength(1);
  expect(inspectSource).toContain("spawnSync('git', ['-C', repositoryRoot, ...args], {");
  expect(inspectSource).toContain("encoding: 'utf8'");
  expect(inspectSource).toContain('windowsHide: true');
  expect(inspectSource).toContain('env: createBranchLifecycleGitChildEnvironmentV1(process.env)');
  expect(inspectSource).not.toContain('cwd:');
  expect(inspectSource).not.toContain('shell:');
  expect(inspectSource).not.toContain('input:');
  for (const observation of [
    "git('rev-parse', 'HEAD')",
    "git('rev-parse', 'HEAD^{tree}')",
    "git('status', '--porcelain=v1', '--untracked-files=all')",
    "git('rev-parse', '--path-format=absolute', '--git-common-dir')"
  ]) {
    expect(inspectSource).toContain(observation);
  }

  const digest = (source: string) => createHash('sha256').update(source).digest('hex');
  for (const hostileSource of [
    inspectSource.replace('inspectLocalRepository', 'inspectLocalRepositories'),
    inspectSource.replace('const git =', 'const gitNearName ='),
    inspectSource.replace("spawnSync('git'", "spawnSync('git-near-name'"),
    inspectSource.replace("['-C', repositoryRoot, ...args]", '[repositoryRoot, ...args]'),
    inspectSource.replace("['-C', repositoryRoot, ...args]", "['-C', repositoryRoot + '/nested', ...args]"),
    inspectSource.replace("git('rev-parse', 'HEAD')", "git('rev-parse', 'HEAD~1')"),
    inspectSource.replace("git('rev-parse', 'HEAD^{tree}')", "git('rev-parse', 'HEAD')"),
    inspectSource.replace(
      "git('status', '--porcelain=v1', '--untracked-files=all')",
      "git('status', '--porcelain=v2', '--untracked-files=no')"
    ),
    inspectSource.replace(
      "git('rev-parse', '--path-format=absolute', '--git-common-dir')",
      "git('rev-parse', '--git-dir')"
    ),
    inspectSource.replace("encoding: 'utf8',", "cwd: repositoryRoot, encoding: 'utf8',"),
    inspectSource.replace(
      'createBranchLifecycleGitChildEnvironmentV1(process.env)',
      'process.env'
    ),
    inspectSource.replace('windowsHide: true', 'windowsHide: true, shell: true'),
    inspectSource.replace('windowsHide: true', "windowsHide: true, input: ''"),
    inspectSource.replace("encoding: 'utf8'", "encoding: 'buffer'"),
    inspectSource.replace('windowsHide: true', 'windowsHide: false')
  ]) {
    expect(hostileSource).not.toBe(inspectSource);
    expect(digest(hostileSource)).not.toBe(digest(inspectSource));
  }
});

test('worktree physical closeout introduces no dispatcher and constrains the canonical shared process owner', async () => {
  const identity = 'scripts/codex/worktree-physical-closeout.ts::function-declaration:runRepositoryGit::spawnSync#1';
  expect(TCB_REVIEWED_PROCESS_DISPATCHERS.has(identity)).toBe(false);
  const source = (await Bun.file(
    new URL('../../scripts/codex/worktree-physical-closeout.ts', import.meta.url)
  ).text()).replace(/\r\n/gu, '\n');
  const start = source.indexOf('async function runRepositoryGit(');
  const end = source.indexOf('\nasync function requireRepositoryGit(', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const dispatcher = source.slice(start, end);
  const assertDispatcher = (candidate: string): void => {
    expect(candidate).toContain('async function runRepositoryGit(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {');
    expect(candidate.match(/runCommandBytes\(/gu)).toHaveLength(1);
    expect(candidate).toContain("await runCommandBytes('git', ['-C', repositoryRoot, ...args], {");
    expect(candidate).toContain('    cwd: repositoryRoot,');
    expect(candidate).toContain('env: createBranchLifecycleGitChildEnvironmentV1(process.env)');
    expect(candidate).toContain("envMode: 'replace'");
    expect(candidate).toContain('    maxStderrBytes: MAX_BUFFER,\n');
    expect(candidate).toContain('    maxStdoutBytes: MAX_BUFFER\n');
    expect(candidate).not.toContain('spawnSync');
    expect(candidate).not.toContain('shell:');
    expect(candidate).not.toContain('execSync');
  };
  assertDispatcher(dispatcher);
  for (const [label, hostile] of [
    ['name', dispatcher.replace('runRepositoryGit', 'runRepositoryGitNearName')],
    ['command', dispatcher.replace("runCommandBytes('git'", "runCommandBytes('git-near-name'")],
    ['arguments', dispatcher.replace("['-C', repositoryRoot, ...args]", '[repositoryRoot, ...args]')],
    ['repository-argument', dispatcher.replace('repositoryRoot, ...args', "repositoryRoot + '/nested', ...args")],
    ['cwd', dispatcher.replace('cwd: repositoryRoot', "cwd: repositoryRoot + '/nested'")],
    ['environment', dispatcher.replace('createBranchLifecycleGitChildEnvironmentV1(process.env)', 'process.env')],
    ['environment-mode', dispatcher.replace("envMode: 'replace'", "envMode: 'inherit'")],
    ['stderr-boundary', dispatcher.replace('maxStderrBytes: MAX_BUFFER', 'maxStderrBytes: MAX_BUFFER * 2')],
    ['stdout-boundary', dispatcher.replace('maxStdoutBytes: MAX_BUFFER', 'maxStdoutBytes: MAX_BUFFER * 2')],
    ['ordinal', dispatcher.replace('  return {', "  runCommandBytes('git', ['status'], { cwd: repositoryRoot });\n  return {")]
  ] as const) {
    expect(hostile).not.toBe(dispatcher);
    let rejected = false;
    try { assertDispatcher(hostile); } catch { rejected = true; }
    if (!rejected) throw new Error(`worktree process-boundary mutation was not rejected: ${label}`);
  }
  expect(source).toContain('observeWorkingState(repository.root, input.targetPath, ownedNamespace.relativePath)');
  expect(source).not.toContain('runRepositoryGit(targetPath,');
});

test('local Actions runner dispatcher binds executable domain, cwd, environment, bounds, and ordinal', async () => {
  const repositoryPath = 'scripts/codex/local-github-actions-runner.ts';
  const identity =
    'scripts/codex/local-github-actions-runner.ts::function-declaration:runCommand::spawn#1';
  expect(TCB_REVIEWED_PROCESS_DISPATCHERS.has(identity)).toBe(true);
  const source = (await Bun.file(
    new URL('../../scripts/codex/local-github-actions-runner.ts', import.meta.url)
  ).text()).replace(/\r\n/gu, '\n');
  const start = source.indexOf('async function runCommand(');
  const end = source.indexOf('\nasync function resolveRepositoryContext(', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const dispatcher = source.slice(start, end);
  const assertDispatcher = (candidate: string): void => {
    expect(candidate).toContain('async function runCommand(\n');
    expect(candidate).toContain("  command: 'docker' | 'gh' | 'git',\n");
    expect(candidate.match(/spawn\(/gu)).toHaveLength(1);
    expect(candidate).toContain('const child = spawn(command, [...args], {');
    expect(candidate).toContain('cwd: options.cwd,\n');
    expect(candidate).toContain('const childEnvironment = commandEnvironment(command);');
    expect(candidate).toContain("if (command !== 'gh'");
    expect(candidate).toContain('childEnvironment.GH_TOKEN = options.githubToken;');
    expect(candidate).toContain('env: childEnvironment,');
    expect(candidate).not.toContain('environment?: Readonly<Record<string, string>>');
    expect(candidate).toContain('shell: false,');
    expect(candidate).toContain('windowsHide: true,');
    expect(candidate).toContain("stdio: ['pipe', 'pipe', 'pipe']");
    expect(candidate).toContain('const timeoutMs = options.timeoutMs ?? 120_000;');
    expect(candidate).toContain('if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {');
    expect(candidate).not.toContain('env: process.env');
    expect(candidate).not.toContain('shell: true');
    expect(candidate).not.toContain('execSync');
    expect(candidate).not.toContain('spawnSync');
  };
  assertDispatcher(dispatcher);
  for (const [label, hostile] of [
    ['name', dispatcher.replace('runCommand(', 'runCommandNearName(')],
    ['command', dispatcher.replace("'docker' | 'gh' | 'git'", "'docker' | 'gh' | 'git' | 'powershell'")],
    ['spawn-command', dispatcher.replace('spawn(command, [...args]', "spawn('powershell', [...args]")],
    ['cwd', dispatcher.replace('cwd: options.cwd', "cwd: options.cwd + '/nested'")],
    ['environment', dispatcher.replace('env: childEnvironment', 'env: process.env')],
    ['credential-domain', dispatcher.replace("command !== 'gh'", "command !== 'docker'")],
    ['shell', dispatcher.replace('shell: false', 'shell: true')],
    ['timeout', dispatcher.replace('options.timeoutMs ?? 120_000', 'options.timeoutMs ?? 0')],
    ['output-bound', dispatcher.replace(
      'outputBytes > MAX_COMMAND_OUTPUT_BYTES',
      'outputBytes > MAX_COMMAND_OUTPUT_BYTES * 2'
    )],
    ['ordinal', dispatcher.replace(
      'const child = spawn(command, [...args], {',
      "spawn('git', ['status']);\n    const child = spawn(command, [...args], {"
    )]
  ] as const) {
    expect(hostile).not.toBe(dispatcher);
    let rejected = false;
    try { assertDispatcher(hostile); } catch { rejected = true; }
    if (!rejected) throw new Error(`local runner dispatcher mutation was not rejected: ${label}`);
  }
  const observed = new Set<string>();
  runtimeRelativeImportsFromSource(repositoryPath, source, observed, new Set(), new Set());
  expect(observed).toEqual(new Set([identity]));
});

test('docs-doctor index-tree preflight binds every exact read-only dispatcher and rejects semantic drift', async () => {
  const repositoryPath = 'docs/scripts/docs-doctor.ts';
  const lexicalFixtures = [
    {
      name: 'resolveChangedDocumentPathsSince',
      identity: 'docs/scripts/docs-doctor.ts::function-declaration:resolveChangedDocumentPathsSince::spawnSync#1',
      body: [
        'function resolveChangedDocumentPathsSince(repositoryRoot: string, sinceRef: string) {',
        "  const result = spawnSync('git', ['diff', '--name-only', `${sinceRef}..HEAD`], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });",
        '  return result;',
        '}'
      ]
    },
    {
      name: 'captureDocsDoctorIndexTree',
      identity: 'docs/scripts/docs-doctor.ts::function-declaration:captureDocsDoctorIndexTree::spawnSync#1',
      body: [
        'function captureDocsDoctorIndexTree(repositoryRoot: string) {',
        "  const result = spawnSync('git', ['write-tree'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });",
        '  return result;',
        '}'
      ]
    },
    {
      name: 'readCapturedGitTreeBlob',
      identity: 'docs/scripts/docs-doctor.ts::function-declaration:readCapturedGitTreeBlob::spawnSync#1',
      body: [
        "function readCapturedGitTreeBlob(repositoryRoot: string, treeSha: string, repositoryPath: string, observationKind: 'blob-bytes' | 'direct-entry-names' = 'blob-bytes') {",
        '  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)) throw new Error("noncanonical");',
        '  const objectExpression = `${treeSha}:${repositoryPath}`;',
        "  const args = observationKind === 'blob-bytes' ? ['cat-file', '--batch'] : ['ls-tree', '--name-only', objectExpression];",
        "  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'buffer', input: observationKind === 'blob-bytes' ? Buffer.from(`${objectExpression}\\n`, 'utf8') : undefined, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });",
        '  return result.stdout;',
        '}'
      ]
    }
  ] as const;
  expect([...TCB_REVIEWED_PROCESS_DISPATCHERS].filter((identity) =>
    identity.startsWith('docs/scripts/docs-doctor.ts::')
  ).sort()).toEqual(lexicalFixtures.map(({ identity }) => identity).sort());
  for (const fixture of lexicalFixtures) {
    expect(TCB_REVIEWED_PROCESS_DISPATCHERS.has(fixture.identity)).toBe(true);
    const canonicalSource = [
      "import { spawnSync } from 'node:child_process';",
      ...fixture.body
    ].join('\n');
    const observed = new Set<string>();
    expect(() => runtimeRelativeImportsFromSource(
      repositoryPath, canonicalSource, observed, new Set(), new Set()
    )).not.toThrow();
    expect([...observed]).toEqual([fixture.identity]);
    const nearName = canonicalSource.replace(
      `function ${fixture.name}(`,
      `function ${fixture.name}NearName(`
    );
    const secondDispatcher = canonicalSource.replace(
      '\n}', "\n  spawnSync('git', ['status'], { cwd: repositoryRoot });\n}"
    );
    for (const hostileSource of [nearName, secondDispatcher]) {
      expect(() => runtimeRelativeImportsFromSource(
        repositoryPath, hostileSource, new Set(), new Set(), new Set()
      )).toThrow('unreviewed process dispatcher');
    }
  }

  const docsDoctorSource = (await Bun.file(
    new URL('../../docs/scripts/docs-doctor.ts', import.meta.url)
  ).text()).replace(/\r\n/gu, '\n');
  const captureStart = docsDoctorSource.indexOf('function captureDocsDoctorIndexTree(');
  const captureEnd = docsDoctorSource.indexOf('\nexport function readCapturedGitTreeBlob(', captureStart);
  expect(captureStart).toBeGreaterThanOrEqual(0);
  expect(captureEnd).toBeGreaterThan(captureStart);
  const captureSource = docsDoctorSource.slice(captureStart, captureEnd);
  expect(captureSource.match(/spawnSync\(/gu)).toHaveLength(1);
  expect(captureSource).toContain("spawnSync('git', ['write-tree'], {");
  expect(captureSource).toContain('cwd: repositoryRoot');
  expect(captureSource).not.toContain('env:');

  const resolveStart = docsDoctorSource.indexOf('function resolveChangedDocumentPathsSince(');
  const resolveEnd = docsDoctorSource.indexOf('\nfunction captureDocsDoctorIndexTree(', resolveStart);
  expect(resolveStart).toBeGreaterThanOrEqual(0);
  expect(resolveEnd).toBeGreaterThan(resolveStart);
  const resolveSource = docsDoctorSource.slice(resolveStart, resolveEnd);
  expect(resolveSource.match(/spawnSync\(/gu)).toHaveLength(1);
  expect(resolveSource).toContain("spawnSync(\n    'git',\n    ['diff', '--name-only', `${sinceRef}..HEAD`]");
  expect(resolveSource).toContain('cwd: repositoryRoot');
  expect(resolveSource).toContain("encoding: 'utf8'");
  expect(resolveSource).toContain('windowsHide: true');
  expect(resolveSource).not.toContain('env:');

  const parserStart = docsDoctorSource.indexOf('export function parseCapturedGitTreeBlobFrameV1(');
  const parserEnd = docsDoctorSource.indexOf('\nexport function readCapturedGitTreeBlob(', parserStart);
  expect(parserStart).toBeGreaterThanOrEqual(0);
  expect(parserEnd).toBeGreaterThan(parserStart);
  const parserSource = docsDoctorSource.slice(parserStart, parserEnd);
  expect(parserSource).toContain('/^([0-9a-f]{40}) blob ([1-9][0-9]*|0)$/u.exec(header)');
  expect(parserSource).toContain('bodyEnd + 1 !== frame.length');
  expect(parserSource).toContain('frame[bodyEnd] !== 0x0a');
  expect(parserSource).toContain('return frame.subarray(bodyStart, bodyEnd);');
  expect(parserSource).not.toContain('spawnSync(');

  const readerStart = docsDoctorSource.indexOf('export function readCapturedGitTreeBlob(');
  const readerEnd = docsDoctorSource.indexOf('\nfunction listCapturedWorkPackagePaths(', readerStart);
  expect(readerStart).toBeGreaterThanOrEqual(0);
  expect(readerEnd).toBeGreaterThan(readerStart);
  const readerSource = docsDoctorSource.slice(readerStart, readerEnd);
  expect(readerSource.match(/spawnSync\(/gu)).toHaveLength(1);
  expect(readerSource).toContain("refs\\/remotes\\/[A-Za-z0-9._-]+\\/[A-Za-z0-9._\\/-]+");
  expect(readerSource).toContain('CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)');
  expect(readerSource).toContain("observationKind: 'blob-bytes' | 'direct-entry-names' = 'blob-bytes'");
  expect(readerSource).toContain('const objectExpression = `${treeSha}:${repositoryPath}`;');
  expect(readerSource).toContain("? ['cat-file', '--batch']");
  expect(readerSource).toContain(": ['ls-tree', '--name-only', objectExpression]");
  expect(readerSource).toContain("spawnSync(\n    'git',\n    args,");
  expect(readerSource).toContain('cwd: repositoryRoot');
  expect(readerSource).toContain("encoding: 'buffer'");
  expect(readerSource).toContain("input: observationKind === 'blob-bytes'");
  expect(readerSource).toContain("Buffer.from(`${objectExpression}\\n`, 'utf8')");
  expect(readerSource).toContain('windowsHide: true');
  expect(readerSource).toContain('maxBuffer: 8 * 1024 * 1024');
  expect(readerSource).toContain('return parseCapturedGitTreeBlobFrameV1(result.stdout, repositoryPath);');
  expect(readerSource).not.toContain('env:');
  expect(readerSource).not.toContain('shell:');
  expect(readerSource).not.toContain("['show'");

  const censusStart = readerEnd;
  const censusEnd = docsDoctorSource.indexOf('\nif (import.meta.main)', censusStart);
  expect(censusEnd).toBeGreaterThan(censusStart);
  const censusSource = docsDoctorSource.slice(censusStart, censusEnd);
  expect(censusSource).not.toContain('spawnSync(');
  expect(censusSource).toContain(
    "readCapturedGitTreeBlob(repositoryRoot, treeSha, packageRoot, 'direct-entry-names')"
  );
  expect(censusSource).toContain('source.includes(\'\\r\')');
  expect(censusSource).toContain("name.includes('/')");
  expect(censusSource).toContain('new Set(paths).size !== paths.length');

  const digest = (source: string) => createHash('sha256').update(source).digest('hex');
  for (const hostileSource of [
    captureSource.replace("['write-tree']", "['read-tree', 'HEAD']"),
    captureSource.replace('cwd: repositoryRoot', "cwd: repositoryRoot + '/.git'"),
    captureSource.replace("encoding: 'utf8'", "env: { GIT_INDEX_FILE: 'forged' }, encoding: 'utf8'")
  ]) {
    expect(hostileSource).not.toBe(captureSource);
    expect(digest(hostileSource)).not.toBe(digest(captureSource));
  }
  for (const hostileSource of [
    parserSource.replace('parseCapturedGitTreeBlobFrameV1', 'parseCapturedGitTreeBlobFrameNearNameV1'),
    parserSource.replace('bodyEnd + 1 !== frame.length', 'bodyEnd > frame.length'),
    parserSource.replace('frame[bodyEnd] !== 0x0a', 'false'),
    parserSource.replace('return frame.subarray(bodyStart, bodyEnd);', 'return frame;')
  ]) {
    expect(hostileSource).not.toBe(parserSource);
    expect(digest(hostileSource)).not.toBe(digest(parserSource));
  }
  for (const hostileSource of [
    readerSource.replace('readCapturedGitTreeBlob', 'readCapturedGitTreeBlobs'),
    readerSource.replace("`${treeSha}:${repositoryPath}`", "`HEAD:${repositoryPath}`"),
    readerSource.replace("? ['cat-file', '--batch']", "? ['show', objectExpression]"),
    readerSource.replace("['ls-tree', '--name-only'", "['status', '--short'"),
    readerSource.replace("'blob-bytes' | 'direct-entry-names'", "string"),
    readerSource.replace("Buffer.from(`${objectExpression}\\n`, 'utf8')", 'Buffer.alloc(0)'),
    readerSource.replace('cwd: repositoryRoot', "cwd: repositoryRoot + '/.git'"),
    readerSource.replace('cwd: repositoryRoot,', "cwd: repositoryRoot, env: { GIT_INDEX_FILE: 'forged' },"),
    readerSource.replace('windowsHide: true', 'windowsHide: false'),
    readerSource.replace('windowsHide: true,', 'windowsHide: true, shell: true,'),
    readerSource.replace("encoding: 'buffer'", "encoding: 'utf8'"),
    readerSource.replace('maxBuffer: 8 * 1024 * 1024', 'maxBuffer: 16 * 1024 * 1024'),
    readerSource.replace(
      'CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)',
      "repositoryPath.startsWith('docs/')"
    )
  ]) {
    expect(hostileSource).not.toBe(readerSource);
    expect(digest(hostileSource)).not.toBe(digest(readerSource));
  }
});

test('live TCB closure passes lock verification', () => {
  const closure = trustedRuntimeClosure();
  const verification = verifyTcbClosureLock(closure);
  expect(verification.status).toBe('passed');
  expect(verification.failures).toEqual([]);
});

test('live process dispatcher allowlist exactly matches the frozen lock', () => {
  expect([...TCB_REVIEWED_PROCESS_DISPATCHERS].sort()).toEqual(
    [...TCB_CLOSURE_LOCK.reviewedProcessDispatchers].sort()
  );
});

test('Read Plan manifest reuse retires both duplicate Git process dispatchers', () => {
  const retired = [
    'scripts/codex/operation-read-plan.ts::function-declaration:gitBytesOutput::spawnSync#1',
    'scripts/codex/operation-read-plan.ts::function-declaration:gitOutput::spawnSync#1'
  ];
  for (const identity of retired) {
    expect(TCB_REVIEWED_PROCESS_DISPATCHERS.has(identity)).toBe(false);
    expect(TCB_CLOSURE_LOCK.reviewedProcessDispatchers).not.toContain(identity);
  }
  const source = readFileSync(
    path.resolve(import.meta.dir, '../../scripts/codex/operation-read-plan.ts'),
    'utf8'
  );
  expect(source).not.toContain("from 'node:child_process'");
  expect(source).not.toContain('spawnSync(');
});

test.serial('TCB generation rejects a stale reviewed dispatcher authorization', () => {
  const stale =
    'scripts/ci-verification.ts::function-declaration:retiredDispatcher::spawnSync#1';
  expect(TCB_REVIEWED_PROCESS_DISPATCHERS.has(stale)).toBe(false);
  TCB_REVIEWED_PROCESS_DISPATCHERS.add(stale);
  try {
    expect(() => generateTcbClosureLockV2()).toThrow(
      'TCB reviewed process dispatcher allowlist must exactly equal the live causal dispatcher census.'
    );
  } finally {
    TCB_REVIEWED_PROCESS_DISPATCHERS.delete(stale);
  }
  expect(TCB_REVIEWED_PROCESS_DISPATCHERS.has(stale)).toBe(false);
});

test('computeTcbClosureLock produces a closure digest that matches the frozen lock', () => {
  const closure = trustedRuntimeClosure();
  const live = computeTcbClosureLock(closure);
  expect(live.closureDigest).toBe(TCB_CLOSURE_LOCK.closureDigest);
});

// ---------------------------------------------------------------------------
// Negative tests — each proves that a specific tampering breaks the lock
// ---------------------------------------------------------------------------

test('adding an untrusted module causes the lock to break (expansion)', () => {
  const closure = trustedRuntimeClosure();
  const tampered = {
    closure: new Set(closure.closure).add('platform/shared/untrusted-intruder.ts'),
    reviewedEdges: new Set(closure.reviewedEdges),
    reviewedBoundaryEdges: new Set(closure.reviewedBoundaryEdges),
    reviewedExternalImports: new Set(closure.reviewedExternalImports),
    reviewedProcessDispatchers: new Set(closure.reviewedProcessDispatchers)
  };
  const verification = verifyTcbClosureLock(tampered);
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('expansion: unexpected module platform/shared/untrusted-intruder.ts')
  ]));
});

test('removing a reviewed module causes the lock to break (contraction)', () => {
  const closure = trustedRuntimeClosure();
  const tampered = new Set(closure.closure);
  tampered.delete('platform/shared/canonical-primitives.ts');
  const verification = verifyTcbClosureLock({
    closure: tampered,
    reviewedEdges: closure.reviewedEdges,
    reviewedBoundaryEdges: closure.reviewedBoundaryEdges,
    reviewedExternalImports: closure.reviewedExternalImports,
    reviewedProcessDispatchers: closure.reviewedProcessDispatchers
  });
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('contraction: missing module platform/shared/canonical-primitives.ts')
  ]));
});

test('substituting a module path causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const tampered = new Set(closure.closure);
  tampered.delete('platform/shared/canonical-primitives.ts');
  tampered.add('platform/shared/canonical-primitives-fake.ts');
  const verification = verifyTcbClosureLock({
    closure: tampered,
    reviewedEdges: closure.reviewedEdges,
    reviewedBoundaryEdges: closure.reviewedBoundaryEdges,
    reviewedExternalImports: closure.reviewedExternalImports,
    reviewedProcessDispatchers: closure.reviewedProcessDispatchers
  });
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('contraction: missing module platform/shared/canonical-primitives.ts'),
    expect.stringContaining('expansion: unexpected module platform/shared/canonical-primitives-fake.ts')
  ]));
});

test('introducing an unauthorized edge causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const tampered = {
    closure: closure.closure,
    reviewedEdges: new Set(closure.reviewedEdges).add(
      'scripts/ci-workspace-fast.ts -> platform/unauthorized-target.ts'
    ),
    reviewedBoundaryEdges: closure.reviewedBoundaryEdges,
    reviewedExternalImports: closure.reviewedExternalImports,
    reviewedProcessDispatchers: closure.reviewedProcessDispatchers
  };
  const verification = verifyTcbClosureLock(tampered);
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('edge addition: unexpected edge')
  ]));
});

test('removing a reviewed edge causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const tampered = {
    closure: closure.closure,
    reviewedEdges: new Set<string>(),
    reviewedBoundaryEdges: closure.reviewedBoundaryEdges,
    reviewedExternalImports: closure.reviewedExternalImports,
    reviewedProcessDispatchers: closure.reviewedProcessDispatchers
  };
  const verification = verifyTcbClosureLock(tampered);
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('edge removal: missing edge')
  ]));
});

test('removing the privileged static-exact boundary causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const verification = verifyTcbClosureLock({
    ...closure,
    reviewedBoundaryEdges: new Set<string>()
  });
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('boundary edge removal: missing edge')
  ]));
});

test('adding an unauthorized boundary causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const verification = verifyTcbClosureLock({
    ...closure,
    reviewedBoundaryEdges: new Set(closure.reviewedBoundaryEdges).add(
      'scripts/codex/verification-session.ts -> platform/shared/ci-contract.ts'
    )
  });
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('boundary edge addition: unexpected edge')
  ]));
});

test('adding an unauthorized external import causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const tampered = {
    closure: closure.closure,
    reviewedEdges: closure.reviewedEdges,
    reviewedBoundaryEdges: closure.reviewedBoundaryEdges,
    reviewedExternalImports: new Set(closure.reviewedExternalImports).add(
      'platform/shared/untrusted-module.ts -> node:worker_threads'
    ),
    reviewedProcessDispatchers: closure.reviewedProcessDispatchers
  };
  const verification = verifyTcbClosureLock(tampered);
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('external import addition: unexpected')
  ]));
});

test('adding an unauthorized process dispatcher causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const tampered = {
    closure: closure.closure,
    reviewedEdges: closure.reviewedEdges,
    reviewedBoundaryEdges: closure.reviewedBoundaryEdges,
    reviewedExternalImports: closure.reviewedExternalImports,
    reviewedProcessDispatchers: new Set(closure.reviewedProcessDispatchers).add(
      'platform/shared/untrusted.ts::function-declaration:untrustedSpawn::spawn#1'
    )
  };
  const verification = verifyTcbClosureLock(tampered);
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('process dispatcher addition: unexpected')
  ]));
});
