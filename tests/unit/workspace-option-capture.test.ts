import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Replace only the final effectful engine in an isolated process. Real request
// binding, lease acquisition, semantic prelude and failure settlement still run.
for (const operation of ['verify', 'compose'] as const) for (const inherited of [false, true]) {
  test(`${operation} captures ${inherited ? 'inherited' : 'own'} request decisions and the original live signal`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-option-capture-'));
    const repo = fileURLToPath(new URL('../../', import.meta.url));
    const script = path.join(root, 'case.ts');
    const module = operation === 'verify'
      ? 'src/application/product-verification.ts'
      : 'src/adapters/compilation/compose/compose-project.ts';
    try {
      await Bun.write(script, `
        import { mock } from 'bun:test';
        const operation = ${JSON.stringify(operation)};
        const primary = Object.freeze({ reason: 'engine stopped' });
        let observed, calls = 0;
        const engine = async (...args) => {
          calls++;
          observed = operation === 'verify'
            ? { laneOrContext: args[1], options: args[2] }
            : { root: args[0], laneOrContext: args[2], options: args[3] };
          throw primary;
        };
        mock.module(${JSON.stringify(path.join(repo, module))}, () => operation === 'verify'
          ? { executeProductVerification: engine }
          : { composeProject: engine });
        const { initWorkspace } = await import(${JSON.stringify(path.join(repo, 'src/bootstrap/engineering/workspace-orchestrator.ts'))});
        const { readLockFile, saveLock } = await import(${JSON.stringify(path.join(repo, 'src/adapters/workspace/lock.ts'))});
        const domain = await import(${JSON.stringify(path.join(repo, `src/bootstrap/engineering/${operation}-orchestrator.ts`))});
        const workspace = ${JSON.stringify(path.join(root, 'workspace'))};
        await initWorkspace(workspace);
        const lock = readLockFile(workspace);
        Object.assign(lock.passStatus, { parse: 'succeeded', align: 'succeeded', resolve: 'succeeded', compose: 'succeeded' });
        await saveLock(workspace, lock);
        const controller = new AbortController();
        const options = operation === 'verify'
          ? { lane: 'fast', emitTiming: true, signal: controller.signal }
          : { lock: false, opaqueModuleMaterializationMode: 'workspace-link', signal: controller.signal };
        const request = ${inherited} ? Object.create(options) : options;
        const pending = domain[operation + 'Workspace'](workspace, request);
        Object.assign(request, operation === 'verify'
          ? { lane: 'runtime', emitTiming: false, signal: AbortSignal.abort(), isolatedVerificationCapability: {} }
          : { lock: true, opaqueModuleMaterializationMode: 'copy', signal: AbortSignal.abort() });
        try { await pending; throw new Error('unexpected success'); }
        catch (error) { if (error !== primary) throw new Error('request mutation changed the selected action: ' + error); }
        if (calls !== 1 || (operation !== 'verify' && observed.root !== workspace))
          throw new Error('engine invocation changed');
        if (observed.options.signal !== controller.signal) throw new Error('signal identity changed');
        if (operation === 'verify' && (observed.laneOrContext !== 'fast' || observed.options.emitTiming !== true || observed.options.isolated !== false))
          throw new Error('verification decisions changed');
        if (operation === 'compose' && observed.options.opaqueModuleMaterializationMode !== 'workspace-link')
          throw new Error('materialization mode changed');
        controller.abort(primary);
        if (!observed.options.signal.aborted || observed.options.signal.reason !== primary)
          throw new Error('live cancellation was detached');
        console.log('captured once, original cancellation remains live');
      `);
      const child = Bun.spawn([process.execPath, script], { stdout: 'pipe', stderr: 'pipe' });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()
      ]);
      expect(code, stderr).toBe(0);
      expect(stdout.trim()).toBe('captured once, original cancellation remains live');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
