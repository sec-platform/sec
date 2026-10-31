import { expect, test } from 'bun:test';
import { prepareWorkspaceCreate } from '../../../src/application/workspace-create.ts';
import { initializePreparedWorkspace, type WorkspaceInitializationOperations } from '../../../src/application/workspace-initialize.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { snapshotWorkspaceCreateRequest, type WorkspaceCreateIntent, type WorkspaceCreateSession, type WorkspaceTemplateBlueprint } from '../../../src/execution/workspace-create.ts';

const prepared = () => prepareWorkspaceCreate(undefined, { officialRegistryRelativePath: 'registry' });
const controls = (): WorkspaceTemplateBlueprint => ({ directories: [], files: [
  { relativePath: 'sec.yaml', bytes: Buffer.from('author plan\n') },
  { relativePath: CI_ARTIFACT_FILES.graphLock, bytes: Buffer.from('initial lock\n'), creationMode: 0o600 },
  { relativePath: CI_ARTIFACT_FILES.verificationReport, bytes: Buffer.from('pending\n') }
] });

function fixture() {
  const events: string[] = [];
  let phase: 'absent' | 'completed' = 'absent';
  let intent!: WorkspaceCreateIntent;
  const session: WorkspaceCreateSession = {
    async observe() { events.push('observe'); return phase === 'absent' ? { phase } : { phase, intent }; },
    async prepare(_value, selected) { events.push('prepare'); intent = selected; },
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
  return { events, operations, setPhase(value: typeof phase) { phase = value; } };
}

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
  expect(() => snapshotWorkspaceCreateRequest('minimal', first.blueprint, { ...first.intent, digest: 'caller-poison' }))
    .toThrow(expect.objectContaining({ code: 'WORKSPACE-INIT-003' }));
  for (const [blueprint, diagnostic] of [
    [{ directories: [], files: [] }, { code: 'WORKSPACE-INIT-003' }],
    ...['../foreign', 'sec.yaml', '.sec/workspace-create.json'].map(relativePath => [
      { ...first.blueprint, files: [...first.blueprint.files, { relativePath, bytes: Buffer.from('x') }] },
      { code: 'WORKSPACE-INIT-003' }
    ] as const),
    [{ ...first.blueprint, directories: ['.sec/workspace-create.json/child'] },
      { code: 'WORKSPACE-INIT-003', details: { reason: 'invalid-template-path' } }],
    [{ ...first.blueprint, files: [...first.blueprint.files,
      { relativePath: '.sec/workspace-write-lease', bytes: Buffer.from('lease file') }] },
      { code: 'WORKSPACE-INIT-003', details: { reason: 'invalid-template-path' } }]
  ] as const) {
    let failure: unknown;
    try { snapshotWorkspaceCreateRequest('minimal', blueprint); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject(diagnostic);
  }
});
