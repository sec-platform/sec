import { expect, test } from 'bun:test';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readSemanticMutationTransactionArtifacts, writeSemanticMutationTransactionArtifacts } from '../../../src/adapters/mutation/atomic-source-publish.ts';
import { semanticMutationTransactionRoot } from '../../../src/adapters/mutation/transaction-identity.ts';
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

function fixture() {
  const workspace = mkdtempSync(path.join(tmpdir(), 'sec-artifact-boundary-'));
  const root = semanticMutationTransactionRoot(workspace, sha256('artifact-boundary-request'));
  const original = new TextEncoder().encode('before\n');
  const staged = new TextEncoder().encode('after\n');
  const relativePath = 'source/model/item.yaml';
  const evidenceBody = {
    formatRevision: SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION,
    relativePath,
    workspaceIdentityDigest: sha256('workspace'),
    transactionDirectoryIdentityDigest: sha256('transaction'),
    parentIdentityDigest: sha256('parent'),
    targetIdentityDigest: sha256('target')
  } as const;
  const pathEvidence = { ...evidenceBody, pathEvidenceRevision: semanticMutationSourcePathEvidenceRevision(evidenceBody) };
  const manifestBody = {
    formatRevision: SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION,
    ownerId: 'semantic-contract-owner:item:item-core',
    adapterId: SEMANTIC_CONTRACT_YAML_ADAPTER_ID,
    adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
    relativePath,
    beforeByteDigest: semanticMutationByteDigest(original),
    stagedByteDigest: semanticMutationByteDigest(staged),
    beforeByteLength: original.byteLength,
    stagedByteLength: staged.byteLength,
    fileMode: 0o444,
    windowsFileAttributes: null,
    encoding: 'utf-8' as const,
    utf8Bom: false,
    lineEnding: 'lf' as const,
    finalNewline: true,
    pathEvidenceRevision: pathEvidence.pathEvidenceRevision
  } as const;
  const manifest = { ...manifestBody, rollbackManifestDigest: semanticMutationRollbackManifestDigest(manifestBody) };
  const planBody = {
    formatRevision: SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION,
    requestRevision: sha256('request'),
    authorizationRevision: sha256('authorization'),
    preflightRevision: sha256('preflight'),
    operationRegistryRevision: SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION,
    sourceAdapterRegistryRevision: SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
    sourceResolutionRevision: sha256('source-resolution'),
    sourceRevision: sha256('source'),
    sourceKind: 'workspace-authoring' as const,
    ownerId: manifest.ownerId,
    adapterId: manifest.adapterId,
    adapterRevision: manifest.adapterRevision,
    namespace: 'item',
    contractId: 'item-core',
    relativePath,
    pathEvidence,
    operations: [{
      operationId: 'operation:add-transition',
      kind: 'add-state-transition' as const,
      contract: { namespace: 'item', contractId: 'item-core' },
      stateId: 'status', from: 'open', to: 'closed', by: 'closeItem'
    }],
    beforeByteDigest: manifest.beforeByteDigest,
    stagedByteDigest: manifest.stagedByteDigest,
    rollbackManifestDigest: manifest.rollbackManifestDigest
  } as const;
  const plan = { ...planBody, editPlanRevision: semanticMutationSourceEditPlanRevision(planBody) };
  return { workspace, root, original, staged, manifest, plan };
}

const publish = (f: ReturnType<typeof fixture>, fence = async (): Promise<void> => {}) =>
  writeSemanticMutationTransactionArtifacts(f.root, f.plan, f.manifest, f.original, f.staged, fence);

const cleanup = (f: ReturnType<typeof fixture>) => rmSync(f.workspace, { recursive: true, force: true });

test('artifact publication is complete, byte-exact, private and reusable without replacement', async () => {
  const f = fixture();
  try {
    const paths = await publish(f);
    const first = statSync(paths.backupPath, { bigint: true });
    const readback = await readSemanticMutationTransactionArtifacts(f.root);
    expect(readback.plan).toEqual(f.plan);
    expect(readback.manifest).toEqual(f.manifest);
    expect(readback.originalBytes).toEqual(f.original);
    expect(readback.stagedBytes).toEqual(f.staged);
    if (process.platform === 'linux') expect(Number(first.mode & 0o777n)).toBe(0o600);
    // An existing readonly backup is a read input, not a request for RW access.
    chmodSync(paths.backupPath, 0o444);
    await publish(f);
    expect(statSync(paths.backupPath, { bigint: true }).ino).toBe(first.ino);
    expect(readdirSync(f.root).sort()).toEqual([
      'original.backup', 'rollback-manifest.json', 'source-edit-plan.json', 'staged-source'
    ]);
  } finally { cleanup(f); }
});

test('artifact inputs are snapshotted before any awaited authority fence', async () => {
  const f = fixture();
  const expected = new Uint8Array(f.original);
  try {
    await publish(f, async () => { f.original.fill(0); });
    expect((await readSemanticMutationTransactionArtifacts(f.root)).originalBytes).toEqual(expected);
  } finally { cleanup(f); }
});

test('a pre-existing conflict is rejected before any missing member is published', async () => {
  const f = fixture();
  try {
    mkdirSync(f.root, { recursive: true });
    writeFileSync(path.join(f.root, 'staged-source'), 'foreign\n');
    await expect(publish(f)).rejects.toThrow();
    expect(readdirSync(f.root)).toEqual(['staged-source']);
    expect(readFileSync(path.join(f.root, 'staged-source'), 'utf8')).toBe('foreign\n');
  } finally { cleanup(f); }
});

test('an interrupted artifact publication keeps valid members for bounded retry', async () => {
  const f = fixture();
  const interrupted = new Error('fixture interruption');
  try {
    await expect(publish(f, async () => {
      if (existsSync(path.join(f.root, 'original.backup'))) throw interrupted;
    })).rejects.toBe(interrupted);
    expect(readFileSync(path.join(f.root, 'original.backup'))).toEqual(Buffer.from(f.original));
    await publish(f);
    expect((await readSemanticMutationTransactionArtifacts(f.root)).stagedBytes).toEqual(f.staged);
  } finally { cleanup(f); }
});

test.skipIf(process.platform !== 'linux')('artifact publication rejects a root replaced across an awaited fence', async () => {
  const f = fixture();
  let replaced = false;
  try {
    await expect(publish(f, async () => {
      if (!replaced && existsSync(f.root)) {
        replaced = true;
        renameSync(f.root, `${f.root}-displaced`);
        mkdirSync(f.root);
        writeFileSync(path.join(f.root, 'foreign-marker'), 'foreign');
      }
    })).rejects.toThrow();
    expect(replaced).toBe(true);
    expect(readdirSync(f.root)).toEqual(['foreign-marker']);
  } finally { cleanup(f); }
});

test.skipIf(process.platform !== 'linux')('artifact read and retry reject a symlink leaf without modifying its target', async () => {
  const f = fixture();
  try {
    await publish(f);
    const outside = path.join(f.workspace, 'outside');
    writeFileSync(outside, f.original);
    const backup = path.join(f.root, 'original.backup');
    rmSync(backup);
    symlinkSync(outside, backup);
    await expect(readSemanticMutationTransactionArtifacts(f.root)).rejects.toThrow();
    await expect(publish(f)).rejects.toThrow();
    expect(readFileSync(outside)).toEqual(Buffer.from(f.original));
  } finally { cleanup(f); }
});

test('artifact read and retry refuse a hard-link alias', async () => {
  const f = fixture();
  try {
    await publish(f);
    linkSync(path.join(f.root, 'original.backup'), path.join(f.workspace, 'alias'));
    await expect(readSemanticMutationTransactionArtifacts(f.root)).rejects.toThrow();
    await expect(publish(f)).rejects.toThrow();
    expect(readFileSync(path.join(f.workspace, 'alias'))).toEqual(Buffer.from(f.original));
  } finally { cleanup(f); }
});

test('artifact reader rejects duplicate JSON keys even when the final parsed value is unchanged', async () => {
  const f = fixture();
  try {
    await publish(f);
    const file = path.join(f.root, 'rollback-manifest.json');
    const json = readFileSync(file, 'utf8');
    writeFileSync(file, json.replace('{\n', `{\n  "fileMode": ${f.manifest.fileMode},\n`));
    await expect(readSemanticMutationTransactionArtifacts(f.root)).rejects.toThrow('canonical');
  } finally { cleanup(f); }
});

test('artifact reader rejects an oversized sparse leaf before reading its content', async () => {
  const f = fixture();
  try {
    await publish(f);
    truncateSync(path.join(f.root, 'original.backup'), 64 * 1024 * 1024 + 1);
    await expect(readSemanticMutationTransactionArtifacts(f.root)).rejects.toThrow();
  } finally { cleanup(f); }
});
