import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  TCB_CLOSURE_LOCK,
  TCB_CLOSURE_LOCK_RECEIPT,
  TCB_CLOSURE_TRUST_REVISION,
  TCB_REVIEWED_PROCESS_DISPATCHERS,
  computeTcbClosureLock,
  generateTcbClosureLockForRevision,
  generateTcbClosureLockV2,
  parseTcbClosureGeneratedRegionV2,
  planTcbClosureLockSourceV2,
  renderTcbClosureGeneratedRegionV2,
  runtimeRelativeImportsFromSource,
  trustedRuntimeClosure,
  verifyTcbClosureLock
} from '../../platform/shared/tcb-closure-lock.ts';
import { SEC_TRUSTED_BOOTSTRAP_REGISTRY_V2 } from '../../platform/shared/tcb-trust-root-contract.ts';

test('TCB closure lock has the correct schema and trust revision', () => {
  expect(TCB_CLOSURE_LOCK.schema).toBe('sec-tcb-closure-lock-v2');
  expect(TCB_CLOSURE_LOCK.trustRevision).toBe(TCB_CLOSURE_TRUST_REVISION);
  expect(TCB_CLOSURE_LOCK.trustRevision).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('preceding trusted-base bootstrap can request the closure through its pure compatibility entrypoint', () => {
  expect(generateTcbClosureLockForRevision('33216029c751fd55a1bace1b5ce63d3937a0064c'))
    .toEqual(generateTcbClosureLockV2());
  for (const invalid of [
    '33216029c751fd55a1bace1b5ce63d3937a0064',
    '33216029c751fd55a1bace1b5ce63d3937a0064cc',
    '33216029C751FD55A1BACE1B5CE63D3937A0064C',
    'sha256:33216029c751fd55a1bace1b5ce63d3937a0064c'
  ]) {
    expect(() => generateTcbClosureLockForRevision(invalid))
      .toThrow('Trusted bootstrap base revision must be one exact Git SHA.');
  }
});

test('TCB closure lock binds the reviewed causal module set', () => {
  expect(TCB_CLOSURE_LOCK.moduleCount).toBe(TCB_CLOSURE_LOCK.modules.length);
  expect(TCB_CLOSURE_LOCK.modules).toContain('platform/shared/canonical-primitives.ts');
  expect(new Set(TCB_CLOSURE_LOCK.modules).size).toBe(TCB_CLOSURE_LOCK.moduleCount);
});

test('TCB closure lock and registry causalRuntimePaths have exact identity parity', () => {
  expect(TCB_CLOSURE_LOCK.modules).toEqual(SEC_TRUSTED_BOOTSTRAP_REGISTRY_V2.causalRuntimePaths);
  expect(TCB_CLOSURE_LOCK.modules).toContain('platform/shared/tcb-trust-root-contract.ts');
  expect(TCB_CLOSURE_LOCK.modules).toContain('platform/shared/verification-action-ci-contract.ts');
  expect(TCB_CLOSURE_LOCK.modules).toContain('platform/shared/verification-session-contract.ts');
  expect(TCB_CLOSURE_LOCK.modules).toContain('scripts/codex/verification-session-runtime.ts');
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY_V2.staticExactPaths)
    .toContain('scripts/codex/branch-lifecycle.ts');
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY_V2.causalRuntimePaths)
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
  const root = mkdtempSync(path.join(tmpdir(), 'sec-tcb-renderer-'));
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
    const first = computeTcbClosureLock(input, root);
    expect(first.trustRevision).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const generatedAt = '2026-08-09T00:00:00.000Z';
    const region = renderTcbClosureGeneratedRegionV2(first, generatedAt);
    const source = `// prefix\n${region}\n// suffix\n`;
    const parsed = parseTcbClosureGeneratedRegionV2(source);
    expect(parsed.lock).toEqual(first);
    expect(parsed.receipt.generatedAt).toBe(generatedAt);

    const noOp = planTcbClosureLockSourceV2({
      source,
      nextLock: first,
      generatedAt: '2026-08-09T01:00:00.000Z'
    });
    expect(noOp.status).toBe('current');
    expect(noOp.nextSource).toBe(source);
    expect(noOp.nextGeneratedAt).toBe(generatedAt);

    writeFileSync(modulePath, 'export const value = 2;\n', 'utf8');
    const second = computeTcbClosureLock(input, root);
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
    expect(() => computeTcbClosureLock({ ...input, closure: new Set(['fixture/missing.ts']) }, root))
      .toThrow('missing or unreadable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Action provider preflight binds the exact nine dispatchers and rejects near-name or ordinal expansion', () => {
  const actionDispatchers = [...TCB_REVIEWED_PROCESS_DISPATCHERS].filter((identity) =>
    identity.startsWith('scripts/ci-verification.ts::') ||
    identity.startsWith('scripts/codex/verification-action-github-provider.ts::')
  ).sort();
  expect(actionDispatchers).toEqual([
    'scripts/ci-verification.ts::function-declaration:CodexDevelopmentInspectHostedActionArchiveV2::spawnSync#1',
    'scripts/ci-verification.ts::function-declaration:defaultGitFiles::spawnSync#1',
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

test('docs-doctor index-tree preflight binds three exact read-only dispatchers and rejects semantic drift', async () => {
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
        'function readCapturedGitTreeBlob(repositoryRoot: string, treeSha: string, repositoryPath: string) {',
        '  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)) throw new Error("noncanonical");',
        "  const result = spawnSync('git', ['show', `${treeSha}:${repositoryPath}`], { cwd: repositoryRoot, encoding: 'buffer', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });",
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
  const captureEnd = docsDoctorSource.indexOf('\nfunction readCapturedGitTreeBlob(', captureStart);
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

  const readerStart = docsDoctorSource.indexOf('function readCapturedGitTreeBlob(');
  const readerEnd = docsDoctorSource.indexOf('\nif (import.meta.main)', readerStart);
  expect(readerStart).toBeGreaterThanOrEqual(0);
  expect(readerEnd).toBeGreaterThan(readerStart);
  const readerSource = docsDoctorSource.slice(readerStart, readerEnd);
  expect(readerSource.match(/spawnSync\(/gu)).toHaveLength(1);
  expect(readerSource).toContain('CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)');
  expect(readerSource).toContain("spawnSync('git', ['show', `${treeSha}:${repositoryPath}`], {");
  expect(readerSource).toContain('cwd: repositoryRoot');
  expect(readerSource).toContain("encoding: 'buffer'");
  expect(readerSource).toContain('windowsHide: true');
  expect(readerSource).toContain('maxBuffer: 8 * 1024 * 1024');
  expect(readerSource).toContain('return result.stdout;');
  expect(readerSource).not.toContain('env:');
  expect(readerSource).not.toContain('shell:');
  expect(readerSource).not.toContain('input:');

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
    readerSource.replace('readCapturedGitTreeBlob', 'readCapturedGitTreeBlobs'),
    readerSource.replace("['show', `${treeSha}:${repositoryPath}`]", "['show', `HEAD:${repositoryPath}`]"),
    readerSource.replace("['show', `${treeSha}:${repositoryPath}`]", "['cat-file', 'blob', `${treeSha}:${repositoryPath}`]"),
    readerSource.replace('cwd: repositoryRoot', "cwd: repositoryRoot + '/.git'"),
    readerSource.replace('cwd: repositoryRoot,', "cwd: repositoryRoot, env: { GIT_INDEX_FILE: 'forged' },"),
    readerSource.replace('windowsHide: true', 'windowsHide: false'),
    readerSource.replace('windowsHide: true,', 'windowsHide: true, shell: true, input: Buffer.alloc(0),'),
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
