import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { prepareSemanticMutationStagingWorkspace } from '../../../src/adapters/mutation/staging-workspace.ts';
import { semanticMutationTransactionRoot } from '../../../src/adapters/mutation/transaction-identity.ts';
import { readSemanticMutationWindowsFileAttributes } from '../../../src/adapters/mutation/windows-file-attributes.ts';
import { semanticMutationByteDigest, sha256 } from '../../../src/compiler/semantic-mutation/canonical.ts';
import { semanticMutationRollbackManifestDigest, semanticMutationSourceEditPlanRevision, semanticMutationSourcePathEvidenceRevision } from '../../../src/compiler/semantic-mutation/source-edit-artifact.ts';
import {
  SEMANTIC_CONTRACT_YAML_ADAPTER_ID,
  SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
  SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION,
  SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION,
  SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
  SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION,
  SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION
} from '../../../src/semantics/mutation/types.ts';

async function fixture(mode = 0o640) {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'sec-staging-workspace-'));
  const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, sha256('staging-workspace-request'));
  const relativePath = 'source/model/item.yaml';
  const sourcePath = path.join(workspaceRoot, relativePath);
  const originalBytes = Buffer.from('before\n');
  const stagedBytes = Buffer.from('after\n');
  mkdirSync(path.dirname(sourcePath), { recursive: true });
  mkdirSync(transactionRoot, { recursive: true });
  writeFileSync(sourcePath, originalBytes);
  chmodSync(sourcePath, mode);
  const pathBody = {
    formatRevision: SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION,
    relativePath, workspaceIdentityDigest: sha256('workspace'),
    transactionDirectoryIdentityDigest: sha256('transaction'),
    parentIdentityDigest: sha256('parent'), targetIdentityDigest: sha256('target')
  } as const;
  const pathEvidence = { ...pathBody, pathEvidenceRevision: semanticMutationSourcePathEvidenceRevision(pathBody) };
  const manifestBody = {
    formatRevision: SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION,
    ownerId: 'semantic-contract-owner:item:item-core',
    adapterId: SEMANTIC_CONTRACT_YAML_ADAPTER_ID,
    adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
    relativePath, beforeByteDigest: semanticMutationByteDigest(originalBytes),
    stagedByteDigest: semanticMutationByteDigest(stagedBytes),
    beforeByteLength: originalBytes.length, stagedByteLength: stagedBytes.length,
    fileMode: statSync(sourcePath).mode & 0o7777,
    windowsFileAttributes: await readSemanticMutationWindowsFileAttributes(sourcePath),
    encoding: 'utf-8' as const, utf8Bom: false, lineEnding: 'lf' as const, finalNewline: true,
    pathEvidenceRevision: pathEvidence.pathEvidenceRevision
  } as const;
  const manifest = { ...manifestBody, rollbackManifestDigest: semanticMutationRollbackManifestDigest(manifestBody) };
  const planBody = {
    formatRevision: SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION,
    requestRevision: sha256('request'), authorizationRevision: sha256('authorization'),
    preflightRevision: sha256('preflight'), operationRegistryRevision: SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION,
    sourceAdapterRegistryRevision: SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
    sourceResolutionRevision: sha256('source-resolution'), sourceRevision: sha256('source'),
    sourceKind: 'workspace-authoring' as const, ownerId: manifest.ownerId,
    adapterId: manifest.adapterId, adapterRevision: manifest.adapterRevision,
    namespace: 'item', contractId: 'item-core', relativePath, pathEvidence,
    operations: [{ operationId: 'operation:add-transition', kind: 'add-state-transition' as const,
      contract: { namespace: 'item', contractId: 'item-core' }, stateId: 'status', from: 'open', to: 'closed', by: 'closeItem' }],
    beforeByteDigest: manifest.beforeByteDigest, stagedByteDigest: manifest.stagedByteDigest,
    rollbackManifestDigest: manifest.rollbackManifestDigest
  } as const;
  const plan = { ...planBody, editPlanRevision: semanticMutationSourceEditPlanRevision(planBody) };
  return { workspaceRoot, transactionRoot, plan, manifest, originalBytes, stagedBytes, sourcePath };
}

const prepare = (f: Awaited<ReturnType<typeof fixture>>, commitFence = async (): Promise<void> => {}) =>
  prepareSemanticMutationStagingWorkspace({ ...f, commitFence });
const close = (f: Awaited<ReturnType<typeof fixture>>) => rmSync(f.workspaceRoot, { recursive: true, force: true });

test('staging edits only the isolated copy and preserves source bytes and exact permissions', async () => {
  const f = await fixture(0o444);
  try {
    const sourceBefore = statSync(f.sourcePath, { bigint: true });
    const root = await prepare(f);
    const stagedPath = path.join(root, f.plan.relativePath);
    expect(readFileSync(stagedPath)).toEqual(f.stagedBytes);
    expect(readFileSync(f.sourcePath)).toEqual(f.originalBytes);
    expect(statSync(f.sourcePath, { bigint: true }).ino).toBe(sourceBefore.ino);
    if (process.platform === 'linux') expect(statSync(stagedPath).mode & 0o7777).toBe(f.manifest.fileMode);
    else expect(await readSemanticMutationWindowsFileAttributes(stagedPath)).toEqual(f.manifest.windowsFileAttributes);
  } finally { close(f); }
});

test('staging snapshots caller byte buffers before its first awaited fence', async () => {
  const f = await fixture();
  const expectedOriginal = Buffer.from(f.originalBytes);
  const expectedStaged = Buffer.from(f.stagedBytes);
  try {
    const root = await prepare(f, async () => { f.originalBytes.fill(0); f.stagedBytes.fill(0); });
    expect(readFileSync(path.join(root, f.plan.relativePath))).toEqual(expectedStaged);
    expect(readFileSync(f.sourcePath)).toEqual(expectedOriginal);
  } finally { close(f); }
});

test('staging retires an old snapshot through the bounded metadata route before rebuilding', async () => {
  const f = await fixture();
  try {
    const previous = path.join(f.transactionRoot, 'workspace');
    mkdirSync(path.join(previous, 'old'), { recursive: true });
    const residue = path.join(previous, 'old', 'large-sparse-residue');
    writeFileSync(residue, '');
    truncateSync(residue, 128 * 1024 * 1024);
    const root = await prepare(f);
    expect(existsSync(path.join(root, 'old'))).toBe(false);
    expect(readFileSync(path.join(root, f.plan.relativePath))).toEqual(f.stagedBytes);
  } finally { close(f); }
});

test.skipIf(process.platform !== 'linux')('staging refuses a symlink root rather than deleting or traversing its target', async () => {
  const f = await fixture();
  const outside = mkdtempSync(path.join(tmpdir(), 'sec-staging-outside-'));
  try {
    writeFileSync(path.join(outside, 'sentinel'), 'keep');
    symlinkSync(outside, path.join(f.transactionRoot, 'workspace'), 'dir');
    await expect(prepare(f)).rejects.toBeDefined();
    expect(readFileSync(path.join(outside, 'sentinel'), 'utf8')).toBe('keep');
    expect(readFileSync(f.sourcePath)).toEqual(f.originalBytes);
  } finally { close(f); rmSync(outside, { recursive: true, force: true }); }
});

test('staging never copies excluded Git or package-manager roots', async () => {
  const f = await fixture();
  try {
    for (const directory of ['.git', 'node_modules', '.shared-deps']) {
      mkdirSync(path.join(f.workspaceRoot, directory));
      writeFileSync(path.join(f.workspaceRoot, directory, 'excluded'), 'not a staging input');
    }
    const root = await prepare(f);
    for (const directory of ['.git', 'node_modules', '.shared-deps']) expect(existsSync(path.join(root, directory))).toBe(false);
    expect(existsSync(path.join(root, '.sec', 'semantic-mutation'))).toBe(false);
  } finally { close(f); }
});

test('staging refuses invalid bytes before invoking an authority fence', async () => {
  const f = await fixture();
  let calls = 0;
  try {
    f.stagedBytes.fill(0);
    await expect(prepare(f, async () => { calls += 1; })).rejects.toBeDefined();
    expect(calls).toBe(0);
    expect(readFileSync(f.sourcePath)).toEqual(f.originalBytes);
  } finally { close(f); }
});

test('staging propagates a revoked authority without modifying the live source', async () => {
  const f = await fixture();
  const failure = new Error('revoked');
  try {
    await expect(prepare(f, async () => { throw failure; })).rejects.toBe(failure);
    expect(readFileSync(f.sourcePath)).toEqual(f.originalBytes);
    expect(existsSync(path.join(f.transactionRoot, 'workspace'))).toBe(false);
  } finally { close(f); }
});
