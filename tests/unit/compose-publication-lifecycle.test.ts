import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatOutputFiles } from '../../src/adapters/compilation/compose/format-output-files.ts';
import { generateRuntimeLibraryScaffold } from '../../src/adapters/compilation/compose/generate-runtime-library.ts';
import type { LockFile } from '../../src/compiler/contract.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

// Native integration: these tests deliberately retain actual Prettier, retained
// readers and physical publishers. They require the repository Bun/host profile.
test('formatter joins every started publication before reporting a peer failure', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-format-join-'));
  const release = deferred(), second = deferred();
  const failure = new Error('publication fence failed');
  let calls = 0, settled = false;
  writeFileSync(path.join(root, 'a.json'), '{"a":1}');
  writeFileSync(path.join(root, 'b.json'), '{"b":2}');
  const outcome = formatOutputFiles(root, ['a.json', 'b.json'], async () => {
    if (++calls === 1) await release.promise;
    else { second.resolve(); throw failure; }
  }).then(() => ({ succeeded: true as const }), reason => ({ succeeded: false as const, reason }))
    .finally(() => { settled = true; });
  try {
    await second.promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(settled, false);
    release.resolve();
    const result = await outcome;
    assert.equal(result.succeeded, false);
    assert.equal(readFileSync(path.join(root, 'a.json'), 'utf8'), '{"a":1}');
    assert.equal(readFileSync(path.join(root, 'b.json'), 'utf8'), '{"b":2}');
  } finally { release.resolve(); await outcome; rmSync(root, { recursive: true, force: true }); }
}, 30_000);

test('formatter refuses to overwrite a changed preimage at its publication fence', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-format-preimage-'));
  const file = path.join(root, 'a.json');
  writeFileSync(file, '{"a":1}');
  try {
    await assert.rejects(formatOutputFiles(root, ['a.json'], async () => { writeFileSync(file, '{"user":true}'); }), /preimage/);
    assert.equal(readFileSync(file, 'utf8'), '{"user":true}');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

test('real parent cancellation at the formatter fence prevents publication', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-format-abort-'));
  const file = path.join(root, 'a.json'), controller = new AbortController();
  const reason = new Error('cancelled');
  writeFileSync(file, '{"a":1}');
  try {
    await assert.rejects(formatOutputFiles(root, ['a.json'], async () => controller.abort(reason), controller.signal), error => error === reason);
    assert.equal(readFileSync(file, 'utf8'), '{"a":1}');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

test('cancelled scaffold admission performs neither source rendering nor writes', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-scaffold-abort-'));
  const controller = new AbortController(), reason = new Error('cancelled'); controller.abort(reason);
  const lock = { get resolvedBlocks() { assert.fail('features read after cancellation'); throw new Error('unreachable'); } } as unknown as LockFile;
  try { await assert.rejects(generateRuntimeLibraryScaffold(root, lock, undefined, controller.signal), error => error === reason); }
  finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

// Isolate the timing wrapper in a child: each stage still performs its real
// work before native cancellation, and module replacements cannot leak to peers.
for (const stage of ['lower', 'runtime', 'baseline', 'saved'] as const) {
  test(`composition observes cancellation after ${stage} without inventing Lock state`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-compose-stage-'));
    const repo = fileURLToPath(new URL('../../', import.meta.url));
    const source = {
      lower: ['src/adapters/targets/typescript/semantic-lowering.ts', 'lowerSemanticTasks'],
      runtime: ['src/adapters/compilation/compose/generate-runtime-library.ts', 'generateRuntimeLibraryScaffold'],
      baseline: ['src/adapters/workspace/project-baseline.ts', 'writeProjectBaseline'],
      saved: ['src/adapters/workspace/lock.ts', 'saveLock']
    }[stage];
    const script = path.join(root, 'case.ts');
    try {
      writeFileSync(script, `
        import assert from 'node:assert/strict';
        import { existsSync } from 'node:fs';
        import path from 'node:path';
        import { mock } from 'bun:test';
        const repo = ${JSON.stringify(repo)}, stage = ${JSON.stringify(stage)};
        const workspace = ${JSON.stringify(path.join(root, 'workspace'))};
        const controller = new AbortController(), reason = new Error('cancelled after ' + stage);
        const { initWorkspace } = await import(path.join(repo, 'src/bootstrap/engineering/workspace-orchestrator.ts'));
        const { readLockFile, saveLock } = await import(path.join(repo, 'src/adapters/workspace/lock.ts'));
        const { buildWorkspaceSemanticBundle } = await import(path.join(repo, 'src/adapters/workspace/semantic-bundle.ts'));
        const { createPipelineSemanticContext } = await import(path.join(repo, 'src/compiler/pipeline/semantic-context.ts'));
        await initWorkspace(workspace);
        const lock = readLockFile(workspace);
        if (stage === 'saved') {
          Object.assign(lock.passStatus, { parse: 'succeeded', align: 'succeeded', resolve: 'succeeded' });
          await saveLock(workspace, lock);
        }
        const before = structuredClone(lock);
        const { snapshot, generatorPlan, semanticViews } = await buildWorkspaceSemanticBundle(workspace);
        const semantic = createPipelineSemanticContext('composition-cancellation', snapshot, generatorPlan, semanticViews);
        const modulePath = ${JSON.stringify(path.join(repo, source[0]!))};
        const symbol = ${JSON.stringify(source[1])};
        const module = await import(modulePath), actual = module[symbol];
        let completed = 0;
        mock.module(modulePath, () => ({ ...module, [symbol]: async (...args) => {
          const result = await actual(...args);
          if (!controller.signal.aborted && (stage !== 'saved' || args[1].passStatus.compose === 'succeeded')) {
            if (stage === 'saved') assert.equal(readLockFile(workspace).passStatus.compose, 'succeeded');
            completed++;
            controller.abort(reason);
          }
          return result;
        } }));
        const { composeProject } = await import(path.join(repo, 'src/adapters/compilation/compose/compose-project.ts'));
        const options = { signal: controller.signal, opaqueModuleMaterializationMode: 'workspace-link' };
        if (stage === 'saved') {
          const { composeWorkspace } = await import(path.join(repo, 'src/bootstrap/engineering/compose-orchestrator.ts'));
          const result = await composeWorkspace(workspace, options);
          assert.equal(result.lock.passStatus.compose, 'succeeded');
          assert.equal(readLockFile(workspace).passStatus.compose, 'succeeded');
        } else {
          await assert.rejects(composeProject(workspace, lock, semantic, options), error => error === reason);
          assert.equal(readLockFile(workspace).passStatus.compose, before.passStatus.compose);
        }
        assert.equal(completed, 1);
        if (stage === 'lower') assert.deepEqual(lock.semanticLoweringTasks, before.semanticLoweringTasks);
        if (stage === 'runtime') {
          assert.ok(existsSync(path.join(workspace, 'src/runtime/store.ts')));
          assert.deepEqual(lock.generatedPaths, before.generatedPaths);
        }
        if (stage === 'baseline') {
          const { readProjectBaseline } = await import(path.join(repo, 'src/adapters/workspace/project-baseline.ts'));
          assert.ok(readProjectBaseline(workspace));
          assert.equal(lock.passStatus.compose, before.passStatus.compose);
        }
        console.log('joined real stage; observed original cancellation and durable outcome');
      `);
      const child = Bun.spawn([process.execPath, script], {
        env: { ...process.env, SEC_STATE_HOME: path.join(root, 'state'), SEC_CACHE_HOME: path.join(root, 'cache') },
        stdout: 'pipe', stderr: 'pipe', timeout: 15_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()
      ]);
      assert.equal(code, 0, stderr);
      assert.equal(stdout.trim(), 'joined real stage; observed original cancellation and durable outcome');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);
}
