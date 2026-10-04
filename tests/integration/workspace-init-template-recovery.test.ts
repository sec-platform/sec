import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWorkspace } from '../testkit/workspace.ts';

const initializer = new URL('../../src/bootstrap/engineering/workspace-orchestrator.ts', import.meta.url).href;
const physicalModule = new URL('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts', import.meta.url).href;
const planModule = new URL('../../src/adapters/workspace/sources/load-plan.ts', import.meta.url).href;
const artifactModule = new URL('../../src/assurance/verification/ci-artifacts/contract/manifest.ts', import.meta.url).href;

// Independent filesystem observations, not a production blueprint or journal
// inventory. The journal is used only to locate the owned stage and read phase.
const observations = `
  async function snapshot(root, omit) {
    const entries = new Map();
    async function visit(relative) {
      if (omit.has(relative)) return;
      const absolute = path.join(root, relative);
      const stat = await fs.lstat(absolute, { bigint: true });
      assert.ok(stat.isFile() || stat.isDirectory(), relative + ': ordinary payload');
      if (relative !== '' && relative !== '.sec') entries.set(relative, {
        kind: stat.isFile() ? 'file' : 'directory', device: String(stat.dev), inode: String(stat.ino),
        mode: Number(stat.mode), bytes: stat.isFile() ? (await fs.readFile(absolute)).toString('hex') : null
      });
      if (stat.isDirectory()) for (const name of (await fs.readdir(absolute)).sort()) {
        await visit(path.posix.join(relative, name));
      }
    }
    await visit('');
    return entries;
  }
  async function controlNames() {
    const names = new Set(['.sec/workspace-write-lease']);
    for (const entry of await fs.readdir(path.join(root, '.sec'), { withFileTypes: true })) {
      // Native journal/guard direct files are observed separately from payload.
      if (entry.isFile() || entry.name.startsWith('.workspace-create-')) names.add('.sec/' + entry.name);
    }
    return names;
  }
`;

async function runChild(script: string): Promise<void> {
  // The selected test's canonical budget owns this child, matching the existing
  // workspace-init-safety fixture. No second ten-second runner is introduced.
  const child = Bun.spawn([process.execPath, '--no-env-file', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()
  ]);
  expect({ code, stderr, stdout: stdout.trim() }).toEqual({ code: 0, stderr: '', stdout: 'settled' });
}

for (const template of ['minimal', 'reference-customer'] as const) {
  test(`public ${template} init recovers its original generation and retains completed author work`, async () => {
    const container = await createWorkspace('workspace-real-template-recovery-');
    const root = path.join(container, 'workspace');
    const evidencePath = path.join(container, 'observed-payload.json');
    const common = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs/promises';
      import path from 'node:path';
      const root = ${JSON.stringify(root)};
      const template = ${JSON.stringify(template)};
      const evidencePath = ${JSON.stringify(evidencePath)};
      ${observations}
    `;
    await runChild(`${common}
      import { mock } from 'bun:test';
      const physical = await import(${JSON.stringify(physicalModule)});
      const retain = physical.retainNoFollowFileTransaction;
      const interrupted = new Error('real-template-before-plan-publication');
      let interruptions = 0;
      const actor = physical.createRetainedNoFollowFileTransactionTestActorForTests({
        beforeRename({ targetPath }) {
          if (targetPath === path.join(root, 'sec.yaml')) { interruptions++; throw interrupted; }
        }
      });
      // Replace only the function binding; original retained capabilities and
      // private issuance records are returned unchanged by their actual owner.
      mock.module(${JSON.stringify(physicalModule)}, () => ({ ...physical,
        retainNoFollowFileTransaction(directory, label, suppliedActor) {
          return retain(directory, label, directory === root && label === 'Workspace initial generation' ? actor : suppliedActor);
        }
      }));
      const { initWorkspace } = await import(${JSON.stringify(initializer)});
      const { CI_ARTIFACT_FILES } = await import(${JSON.stringify(artifactModule)});
      await assert.rejects(initWorkspace(root, { template }), error => error === interrupted);
      assert.equal(interruptions, 1);
      const journal = JSON.parse(await fs.readFile(path.join(root, '.sec/workspace-create.json'), 'utf8'));
      assert.equal(journal.phase, 'prepared'); assert.equal(journal.template, template);
      const stages = (await fs.readdir(path.join(root, '.sec'))).filter(name => name.startsWith('.workspace-create-'));
      assert.deepEqual(stages, [journal.stageName]);
      const published = await snapshot(root, await controlNames());
      const staged = await snapshot(path.join(root, '.sec', stages[0]), new Set(['.sec/workspace-write-lease']));
      assert.equal(published.has('sec.yaml'), false); assert.ok(staged.has('sec.yaml'));
      assert.ok(published.has('src') && published.has('tests'));
      assert.ok(published.has(CI_ARTIFACT_FILES.graphLock));
      assert.ok(published.has(CI_ARTIFACT_FILES.verificationReport));
      for (const relative of staged.keys()) assert.equal(published.has(relative), false, relative);
      await fs.writeFile(evidencePath, JSON.stringify([...published, ...staged]), { flag: 'wx' });
      await assert.rejects(fs.lstat(path.join(root, '.sec/workspace-created.json')), { code: 'ENOENT' });
      console.log('settled');
    `);
    // A genuinely fresh process has no predecessor mocks or retained objects.
    await runChild(`${common}
      const { initWorkspace } = await import(${JSON.stringify(initializer)});
      const { loadPlan } = await import(${JSON.stringify(planModule)});
      const { CI_ARTIFACT_FILES } = await import(${JSON.stringify(artifactModule)});
      const expected = new Map(JSON.parse(await fs.readFile(evidencePath, 'utf8')));
      const result = await initWorkspace(root, { template });
      assert.equal(result.planPath, path.join(root, 'sec.yaml'));
      assert.equal(result.lockPath, path.join(root, CI_ARTIFACT_FILES.graphLock));
      assert.deepEqual(await snapshot(root, await controlNames()), expected);
      const journal = JSON.parse(await fs.readFile(path.join(root, '.sec/workspace-create.json'), 'utf8'));
      assert.equal(journal.phase, 'completed'); assert.equal(journal.template, template);
      assert.deepEqual((await fs.readdir(path.join(root, '.sec'))).filter(name => name.startsWith('.workspace-create-')), []);
      await assert.rejects(fs.lstat(path.join(root, '.sec/workspace-created.json')), { code: 'ENOENT' });
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
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, CI_ARTIFACT_FILES.verificationReport), 'utf8')), { summary: { status: 'pending' } });
      if (template === 'minimal') await assert.rejects(fs.lstat(path.join(root, 'package.json')), { code: 'ENOENT' });
      else assert.equal(JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).name, 'generated-customer-admin');
      console.log('settled');
    `);
    // Later author bytes and a new file are outside the initial recipe. Retry
    // must preserve their exact physical observations instead of re-rendering.
    await fs.writeFile(path.join(root, 'sec.yaml'), 'later author plan\n');
    await fs.writeFile(path.join(root, 'author-owned.txt'), 'later author file\n', { flag: 'wx' });
    await runChild(`${common}
      const { initWorkspace } = await import(${JSON.stringify(initializer)});
      const before = await snapshot(root, await controlNames());
      const journalPath = path.join(root, '.sec/workspace-create.json');
      const journalBytes = await fs.readFile(journalPath);
      const first = await initWorkspace(root, { template });
      assert.deepEqual(await initWorkspace(root, { template }), first);
      assert.deepEqual(await snapshot(root, await controlNames()), before);
      assert.deepEqual(await fs.readFile(journalPath), journalBytes);
      await assert.rejects(initWorkspace(root, { template: template === 'minimal' ? 'reference-customer' : 'minimal' }),
        error => error.code === 'WORKSPACE-INIT-003' && error.details?.reason === 'template-request-mismatch');
      assert.deepEqual(await snapshot(root, await controlNames()), before);
      assert.deepEqual(await fs.readFile(journalPath), journalBytes);
      console.log('settled');
    `);
  });
}
