import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { createWorkspace } from '../testkit/workspace.ts';

// The generation-owner fixture cases prove individual physical invariants.
// These cases additionally cross the real initializer, template recipe, lease
// settlement and ordinary retry boundary. Only the existing physical fault
// actor is injected; no template, journal, token or recovery result is supplied.
for (const template of ['minimal', 'reference-customer'] as const) {
  test(`init recovers the real ${template} template after partial publication`, async () => {
    const container = await createWorkspace('engineering-compiler-init-template-recovery-');
    const workspaceRoot = path.join(container, 'workspace');
    const physicalModule = new URL('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts', import.meta.url).href;
    const initializerModule = new URL('../../src/bootstrap/engineering/workspace-orchestrator.ts', import.meta.url).href;
    const planModule = new URL('../../src/adapters/workspace/sources/load-plan.ts', import.meta.url).href;
    const artifactsModule = new URL('../../src/assurance/verification/ci-artifacts/contract/manifest.ts', import.meta.url).href;
    // Bun module replacement is confined to a child, so its fault injection
    // cannot leak into another workspace or another integration test.
    const script = `
      import assert from 'node:assert/strict';
      import { createHash } from 'node:crypto';
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import { mock } from 'bun:test';
      const workspaceRoot = ${JSON.stringify(workspaceRoot)};
      const template = ${JSON.stringify(template)};
      const physical = await import(${JSON.stringify(physicalModule)});
      const retain = physical.retainNoFollowFileTransaction;
      const interrupted = new Error('real template publication interrupted before plan publication');
      let armed = true;
      let interruptions = 0;
      const actor = physical.createRetainedNoFollowFileTransactionTestActorForTests({
        beforeRename({ targetPath }) {
          if (armed && targetPath === path.join(workspaceRoot, 'sec.yaml')) {
            armed = false;
            interruptions += 1;
            throw interrupted;
          }
        }
      });
      mock.module(${JSON.stringify(physicalModule)}, () => ({ ...physical,
        retainNoFollowFileTransaction(root, label, suppliedActor) {
          return retain(root, label,
            root === workspaceRoot && label === 'Workspace initial generation' && armed
              ? actor : suppliedActor);
        }
      }));
      const { initWorkspace } = await import(${JSON.stringify(initializerModule)});
      const { loadPlan } = await import(${JSON.stringify(planModule)});
      const { CI_ARTIFACT_FILES } = await import(${JSON.stringify(artifactsModule)});
      await assert.rejects(initWorkspace(workspaceRoot, { template }), error => error === interrupted);
      assert.equal(interruptions, 1, 'the real initial publication must reach the fault');

      const localState = path.join(workspaceRoot, '.sec');
      const journalPath = path.join(localState, 'workspace-create.json');
      const terminalPath = path.join(localState, 'workspace-created.json');
      const journalBytes = await fs.readFile(journalPath);
      const journal = JSON.parse(journalBytes.toString('utf8'));
      assert.equal(journal.template, template);
      const stages = (await fs.readdir(localState)).filter(name => name.startsWith('.workspace-create-'));
      assert.deepEqual(stages, [journal.stageName]);
      const stageRoot = path.join(localState, stages[0]);
      await assert.rejects(fs.lstat(terminalPath), { code: 'ENOENT' });

      // Read the actual split namespace independently of the production
      // blueprint/inventory builder. Recovery must preserve all observed
      // payload bytes, modes and physical identities, including staged trees.
      async function snapshot(root) {
        const entries = new Map();
        async function visit(relative) {
          if (relative === '.sec/workspace-write-lease'
              || relative === '.sec/workspace-create.json'
              || relative === '.sec/workspace-created.json'
              || relative.startsWith('.sec/.workspace-create-')) return;
          const absolute = path.join(root, relative);
          const stat = await fs.lstat(absolute, { bigint: true });
          assert.ok(stat.isFile() || stat.isDirectory(), relative + ': ordinary payload only');
          if (relative !== '' && relative !== '.sec') entries.set(relative, {
            kind: stat.isFile() ? 'file' : 'directory',
            device: stat.dev.toString(), inode: stat.ino.toString(),
            mode: Number(stat.mode),
            bytes: stat.isFile() ? (await fs.readFile(absolute)).toString('hex') : null
          });
          if (stat.isDirectory()) for (const name of (await fs.readdir(absolute)).sort()) {
            await visit(path.posix.join(relative, name));
          }
        }
        await visit('');
        return entries;
      }
      const published = await snapshot(workspaceRoot);
      const staged = await snapshot(stageRoot);
      assert.equal(published.has('sec.yaml'), false, 'the plan publication was interrupted');
      assert.ok(staged.has('sec.yaml'), 'the real plan remains staged');
      assert.ok(published.has('src') && published.has('tests'), 'earlier directory publication is physically visible');
      assert.ok(published.has(CI_ARTIFACT_FILES.graphLock), 'the actual initial lock was already published');
      assert.ok(published.has(CI_ARTIFACT_FILES.verificationReport), 'the actual pending report was already published');
      for (const relative of staged.keys()) assert.equal(published.has(relative), false, relative);
      const expectedPayload = new Map([...published, ...staged]);

      // A fresh ordinary initializer must acquire its own real lease, accept
      // the same trusted recipe and settle the existing generation.
      const result = await initWorkspace(workspaceRoot, { template });
      assert.equal(interruptions, 1);
      assert.equal(result.planPath, path.join(workspaceRoot, 'sec.yaml'));
      assert.equal(result.lockPath, path.join(workspaceRoot, CI_ARTIFACT_FILES.graphLock));
      assert.deepEqual(await snapshot(workspaceRoot), expectedPayload);
      assert.deepEqual(await fs.readFile(journalPath), journalBytes);
      assert.deepEqual((await fs.readdir(localState)).filter(name => name.startsWith('.workspace-create-')), []);
      const terminalBytes = await fs.readFile(terminalPath);
      assert.deepEqual(JSON.parse(terminalBytes.toString('utf8')), {
        schema: 'sec-workspace-created-v1', generation: journal.generation,
        journalDigest: 'sha256:' + createHash('sha256').update(journalBytes).digest('hex')
      });

      const plan = await loadPlan(result.planPath);
      const lock = JSON.parse(await fs.readFile(result.lockPath, 'utf8'));
      assert.equal(plan.app.id, template === 'minimal' ? 'app' : 'customer-admin');
      assert.equal(lock.app.id, plan.app.id);
      assert.deepEqual(plan.blocks.map(block => block.id), template === 'minimal' ? [] : [
        'auth/basic-session', 'tenant/basic-workspace', 'entity/customer-basic'
      ]);
      assert.deepEqual(plan.acceptance.map(item => item.id), template === 'minimal' ? [] : [
        'user_can_login', 'user_can_create_customer', 'user_can_list_customers', 'tenant_only_sees_own_customers'
      ]);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(workspaceRoot, CI_ARTIFACT_FILES.verificationReport), 'utf8')),
        { summary: { status: 'pending' } });
      if (template === 'minimal') {
        await assert.rejects(fs.lstat(path.join(workspaceRoot, 'package.json')), { code: 'ENOENT' });
        assert.deepEqual(await fs.readdir(path.join(workspaceRoot, 'src')), []);
      } else {
        assert.equal(JSON.parse(await fs.readFile(path.join(workspaceRoot, 'package.json'), 'utf8')).name,
          'generated-customer-admin');
        assert.ok((await fs.readdir(path.join(workspaceRoot, 'src'))).includes('runtime'));
      }

      await assert.rejects(initWorkspace(workspaceRoot, { template }), { code: 'WORKSPACE-INIT-001' });
      assert.deepEqual(await snapshot(workspaceRoot), expectedPayload);
      assert.deepEqual(await fs.readFile(journalPath), journalBytes);
      assert.deepEqual(await fs.readFile(terminalPath), terminalBytes);
      console.log(template + ': real initializer resumed the original generation');
    `;
    const child = spawnSync(process.execPath, ['--no-env-file', '-e', script], {
      encoding: 'utf8', timeout: 10_000
    });
    expect({ status: child.status, signal: child.signal, stderr: child.stderr }).toEqual({
      status: 0, signal: null, stderr: ''
    });
    expect(child.stdout.trim()).toBe(`${template}: real initializer resumed the original generation`);
  });
}
