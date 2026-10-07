import { expect, test } from 'bun:test';
import { prepareWorkspaceCreate } from '../../src/application/workspace-create.ts';
import { initializePreparedWorkspace, type WorkspaceInitializationOperations } from '../../src/application/workspace-initialize.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { ResourceCompositeSettlementError } from '../../src/execution/resource-settlement.ts';
import { snapshotWorkspaceCreateRequest, type WorkspaceCreateIntent, type WorkspaceCreateSession, type WorkspaceTemplateBlueprint } from '../../src/execution/workspace-create.ts';

const prepared = () => prepareWorkspaceCreate(undefined, { officialRegistryRelativePath: 'registry' });
const controls = (): WorkspaceTemplateBlueprint => ({ directories: [], files: [
  { relativePath: 'sec.yaml', bytes: Buffer.from('author plan\n') },
  { relativePath: CI_ARTIFACT_FILES.graphLock, bytes: Buffer.from('initial lock\n'), creationMode: 0o600 },
  { relativePath: CI_ARTIFACT_FILES.verificationReport, bytes: Buffer.from('pending\n') }
] });

function fixture() {
  const events: string[] = [];
  let phase: 'absent' | 'prepared' | 'settling' | 'completed' = 'absent';
  let intent!: WorkspaceCreateIntent;
  let blueprint!: WorkspaceTemplateBlueprint;
  const session: WorkspaceCreateSession = {
    async observe() { events.push('observe'); return phase === 'absent' ? { phase } : { phase, intent }; },
    async prepare(value, selected) { events.push('prepare'); blueprint = value; intent = selected; },
    async resume() { events.push('resume'); },
    frontier() { return ['src', 'sec.yaml']; },
    async observePublication(entry) { events.push('observe:' + entry); return entry === 'src' ? 'published' : 'staged'; },
    async publish(entry) { events.push('publish:' + entry); },
    async beginSettlement() { events.push('settling'); },
    async retireStage() { events.push('retire'); },
    async flushPublished() { events.push('flush'); },
    async complete() { events.push('complete'); },
    async readCompleted() { events.push('replay'); },
    dispose() { events.push('dispose'); }
  };
  const operations: WorkspaceInitializationOperations = {
    loadTemplate() { expect(this).toBe(operations); events.push('recipe'); return { directories: ['src', '.sec/workspace-write-lease'], files: [] }; },
    renderControls(_plan, lock) { expect(this).toBe(operations); expect(lock.resolvedBlocks).toEqual([]); events.push('controls'); return controls(); },
    openSession() { expect(this).toBe(operations); events.push('open'); return session; }
  };
  return { events, operations, session, setPhase(value: typeof phase) { phase = value; }, getIntent: () => intent,
    setIntent(value: WorkspaceCreateIntent) { intent = value; }, getBlueprint: () => blueprint };
}

test('application freezes complete blueprint before opening, then owns publication and settlement order', async () => {
  const value = fixture();
  await initializePreparedWorkspace(prepared(), value.operations);
  expect(value.events).toEqual(['recipe', 'controls', 'open', 'observe', 'prepare', 'observe:src', 'observe:sec.yaml', 'publish:sec.yaml', 'settling', 'retire', 'flush', 'complete', 'dispose']);
  expect(value.getBlueprint().directories).toContain('.sec');
});

test('completed same-intent retry only reads historical completion and settles session', async () => {
  const value = fixture();
  await initializePreparedWorkspace(prepared(), value.operations);
  value.events.length = 0; value.setPhase('completed');
  await initializePreparedWorkspace(prepared(), value.operations);
  expect(value.events).toEqual(['recipe', 'controls', 'open', 'observe', 'replay', 'dispose']);
});

test('changed initial bytes or template cannot reuse historical completion', async () => {
  for (const change of ['bytes', 'template'] as const) {
    const value = fixture();
    await initializePreparedWorkspace(prepared(), value.operations);
    value.events.length = 0; value.setPhase('completed');
    if (change === 'bytes') value.operations.renderControls = () => {
      const result = controls(); result.files[0]!.bytes[0] = 42; return result;
    };
    const request = change === 'template' ? prepareWorkspaceCreate('reference-customer', { officialRegistryRelativePath: 'registry' }) : prepared();
    await expect(initializePreparedWorkspace(request, value.operations)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'template-request-mismatch' } });
    expect(value.events).not.toContain('replay'); expect(value.events).not.toContain('publish:sec.yaml'); expect(value.events.at(-1)).toBe('dispose');
  }
});

test('settling recovery skips preparation and publication but finishes retained obligations', async () => {
  const value = fixture();
  await initializePreparedWorkspace(prepared(), value.operations);
  value.events.length = 0; value.setPhase('settling');
  await initializePreparedWorkspace(prepared(), value.operations);
  expect(value.events).toEqual(['recipe', 'controls', 'open', 'observe', 'resume', 'retire', 'flush', 'complete', 'dispose']);
});

test('invalid or colliding blueprints produce no session or filesystem effects', async () => {
  for (const relativePath of ['../foreign', 'sec.yaml', '.sec/workspace-create.json']) {
    const value = fixture();
    value.operations.loadTemplate = () => ({ directories: [], files: [{ relativePath, bytes: Buffer.from('x') }] });
    await expect(initializePreparedWorkspace(prepared(), value.operations)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003' });
    expect(value.events).not.toContain('open');
  }
});

test('body failure retains exact falsy values and cleanup failure never becomes success', async () => {
  for (const failure of [undefined, null, false, 0, NaN, Object.freeze({ failed: 'prepare' })]) {
    const value = fixture(); const cleanup = Object.freeze({ failed: 'dispose' });
    value.session.prepare = async () => { throw failure; };
    value.session.dispose = () => { throw cleanup; };
    try { await initializePreparedWorkspace(prepared(), value.operations); throw new Error('unexpected success'); }
    catch (error) {
      expect(error).toBeInstanceOf(ResourceCompositeSettlementError);
      expect(Object.is((error as ResourceCompositeSettlementError).failures[0]!.error, failure)).toBe(true);
      expect((error as ResourceCompositeSettlementError).failures[1]!.error).toBe(cleanup);
    }
    expect(value.events).not.toContain('complete');
  }
});

test('provider suspension cannot replace captured operations or mutate the selected author plan', async () => {
  const value = fixture(), request = prepared();
  const render = value.operations.renderControls;
  value.operations.loadTemplate = () => {
    request.plan.app.id = 'late-request-replacement';
    value.operations.renderControls = () => { throw new Error('late renderer must not run'); };
    return { directories: ['src', '.sec/workspace-write-lease'], files: [] };
  };
  value.operations.renderControls = function(plan, lock) {
    expect(plan.app.id).toBe('app'); expect(lock.app.id).toBe('app');
    return render.call(value.operations, plan, lock);
  };
  await initializePreparedWorkspace(request, value.operations);
  expect(value.events).toContain('complete');
});

test('execution request contract binds complete bytes, modes and template and owns its snapshot', () => {
  const supplied = controls();
  const first = snapshotWorkspaceCreateRequest('minimal', supplied);
  supplied.files[0]!.bytes.fill(42);
  expect(Buffer.from(first.blueprint.files.find(file => file.relativePath === 'sec.yaml')!.bytes).toString()).toBe('author plan\n');
  expect(snapshotWorkspaceCreateRequest('minimal', first.blueprint).intent).toEqual(first.intent);
  for (const changed of [
    snapshotWorkspaceCreateRequest('reference-customer', first.blueprint),
    snapshotWorkspaceCreateRequest('minimal', { ...first.blueprint, files: first.blueprint.files.map(file => ({ ...file, creationMode: 0o700 })) })
  ]) expect(changed.intent.digest).not.toBe(first.intent.digest);
  expect(() => snapshotWorkspaceCreateRequest('minimal', first.blueprint, { ...first.intent, digest: 'caller-poison' })).toThrow();
  expect(() => snapshotWorkspaceCreateRequest('minimal', { directories: [], files: [] }, first.intent)).toThrow();
  expect(() => snapshotWorkspaceCreateRequest('minimal', { ...first.blueprint, directories: ['.sec/workspace-create.json/child'] })).toThrow();
  expect(() => snapshotWorkspaceCreateRequest('minimal', { ...first.blueprint, files: [...first.blueprint.files,
    { relativePath: '.sec/workspace-write-lease', bytes: Buffer.from('lease file') }] })).toThrow();
});
