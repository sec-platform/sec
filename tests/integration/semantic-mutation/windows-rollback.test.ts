import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  atomicPublishSemanticMutationSource,
  atomicRestoreSemanticMutationSource,
  createSourceReplacementTestActorForTests,
  readSemanticMutationTransactionArtifacts,
  writeSemanticMutationTransactionArtifacts
} from '../../../src/adapters/mutation/atomic-source-publish.ts';
import { readSemanticMutationSource } from '../../../src/adapters/mutation/source-path-boundary.ts';
import { semanticMutationTransactionRoot } from '../../../src/adapters/mutation/transaction-identity.ts';
import {
  applySemanticMutationWindowsFileAttributes,
  readSemanticMutationWindowsFileAttributes
} from '../../../src/adapters/mutation/windows-file-attributes.ts';
import { semanticMutationByteDigest, SemanticMutationContractError, sha256 } from '../../../src/compiler/semantic-mutation/canonical.ts';
import { assertSemanticMutationRollbackManifestInvariant } from '../../../src/compiler/semantic-mutation/source-edit-artifact.ts';
import { SEMANTIC_CONTRACT_YAML_ADAPTER_ID, SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION, SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION, SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION, SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION, SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION, SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION, type SemanticMutationRollbackManifest, type SemanticMutationSourceEditPlan, type SemanticMutationWindowsFileAttributes } from '../../../src/semantics/mutation/types.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

const ALL_WINDOWS_ATTRIBUTES: SemanticMutationWindowsFileAttributes = Object.freeze({
  readOnly: true,
  hidden: true,
  system: true,
  archive: true
});

const CLEARED_WINDOWS_ATTRIBUTES: SemanticMutationWindowsFileAttributes = Object.freeze({
  readOnly: false,
  hidden: false,
  system: false,
  archive: false
});

const MANIFEST_KEYS = [
  'formatRevision',
  'ownerId',
  'adapterId',
  'adapterRevision',
  'relativePath',
  'beforeByteDigest',
  'stagedByteDigest',
  'beforeByteLength',
  'stagedByteLength',
  'fileMode',
  'windowsFileAttributes',
  'encoding',
  'utf8Bom',
  'lineEnding',
  'finalNewline',
  'pathEvidenceRevision',
  'rollbackManifestDigest'
] as const;

function jsonDigest(value: unknown): string {
  return sha256(value);
}

function buildArtifacts(
  relativePath: string,
  beforeBytes: Uint8Array,
  stagedBytes: Uint8Array,
  fileMode: number,
  windowsFileAttributes: SemanticMutationWindowsFileAttributes | null
): {
  manifest: SemanticMutationRollbackManifest;
  plan: SemanticMutationSourceEditPlan;
} {
  const pathEvidenceWithoutRevision = {
    formatRevision: SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION,
    relativePath,
    workspaceIdentityDigest: jsonDigest('workspace'),
    transactionDirectoryIdentityDigest: jsonDigest('transaction-directory'),
    parentIdentityDigest: jsonDigest('parent'),
    targetIdentityDigest: jsonDigest('target')
  } as const;
  const pathEvidence = {
    ...pathEvidenceWithoutRevision,
    pathEvidenceRevision: jsonDigest({
      domain: 'semantic-mutation-source-path-evidence-v1',
      ...pathEvidenceWithoutRevision
    })
  };
  const manifestWithoutDigest = {
    formatRevision: SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION,
    ownerId: 'semantic-contract-owner:item:item-core',
    adapterId: SEMANTIC_CONTRACT_YAML_ADAPTER_ID,
    adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
    relativePath,
    beforeByteDigest: semanticMutationByteDigest(beforeBytes),
    stagedByteDigest: semanticMutationByteDigest(stagedBytes),
    beforeByteLength: beforeBytes.byteLength,
    stagedByteLength: stagedBytes.byteLength,
    fileMode,
    windowsFileAttributes,
    encoding: 'utf-8' as const,
    utf8Bom: false,
    lineEnding: 'lf' as const,
    finalNewline: true,
    pathEvidenceRevision: pathEvidence.pathEvidenceRevision
  } as const;
  const manifest = {
    ...manifestWithoutDigest,
    rollbackManifestDigest: jsonDigest({
      domain: 'semantic-mutation-rollback-manifest-v2',
      ...manifestWithoutDigest
    })
  };
  const planWithoutRevision = {
    formatRevision: SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION,
    requestRevision: jsonDigest('request'),
    authorizationRevision: jsonDigest('authorization'),
    preflightRevision: jsonDigest('preflight'),
    operationRegistryRevision: SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION,
    sourceAdapterRegistryRevision: SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
    sourceResolutionRevision: jsonDigest('source-resolution'),
    sourceRevision: jsonDigest('source'),
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
      stateId: 'item-status',
      from: 'open',
      to: 'closed',
      by: 'closeItem'
    }],
    beforeByteDigest: manifest.beforeByteDigest,
    stagedByteDigest: manifest.stagedByteDigest,
    rollbackManifestDigest: manifest.rollbackManifestDigest
  } as const;
  const plan = {
    ...planWithoutRevision,
    editPlanRevision: jsonDigest({ domain: 'semantic-mutation-source-edit-plan-v1', ...planWithoutRevision })
  };
  return { manifest, plan };
}

test('rollback manifest v2 has an exact schema and digest while stale v1 fails closed', () => {
  const beforeBytes = new TextEncoder().encode('before\n');
  const stagedBytes = new TextEncoder().encode('staged\n');
  const { manifest } = buildArtifacts(
    'source/model/item.yaml',
    beforeBytes,
    stagedBytes,
    0o644,
    ALL_WINDOWS_ATTRIBUTES
  );
  const { rollbackManifestDigest: _digest, ...withoutDigest } = manifest;

  expect(Object.keys(manifest)).toEqual([...MANIFEST_KEYS]);
  expect(manifest.rollbackManifestDigest).toBe(jsonDigest({
    domain: 'semantic-mutation-rollback-manifest-v2',
    ...withoutDigest
  }));
  expect(() => assertSemanticMutationRollbackManifestInvariant(manifest)).not.toThrow();
  expect(() => assertSemanticMutationRollbackManifestInvariant({
    ...manifest,
    windowsFileAttributes: { ...ALL_WINDOWS_ATTRIBUTES, archive: false }
  })).toThrow('digest');
  expect(() => assertSemanticMutationRollbackManifestInvariant({
    ...manifest,
    backupPath: '.sec/forbidden-backup'
  } as never)).toThrow('schema');

  const staleManifestWithoutDigest = {
    ...withoutDigest,
    formatRevision: 'semantic-mutation-rollback-manifest-v1'
  };
  const staleManifest = {
    ...staleManifestWithoutDigest,
    rollbackManifestDigest: jsonDigest({
      domain: 'semantic-mutation-rollback-manifest-v1',
      ...staleManifestWithoutDigest
    })
  };
  expect(() => assertSemanticMutationRollbackManifestInvariant(staleManifest as never)).toThrow('invalid');
});

test('atomic publish failure diagnostics keep native failure metadata inside details', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const relativePath = 'source/model/item.yaml';
    const targetPath = path.join(workspaceRoot, ...relativePath.split('/'));
    const transactionRoot = semanticMutationTransactionRoot(
      workspaceRoot,
      jsonDigest('publish-diagnostic-schema')
    );
    const allowCommit = async (): Promise<void> => undefined;
    const beforeBytes = new TextEncoder().encode('state: before\n');
    const stagedBytes = new TextEncoder().encode('state: staged\n');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, beforeBytes);
    const fileMode = Number((await fs.stat(targetPath)).mode) & 0o7777;
    const windowsFileAttributes = await readSemanticMutationWindowsFileAttributes(targetPath);
    const { manifest, plan } = buildArtifacts(
      relativePath,
      beforeBytes,
      stagedBytes,
      fileMode,
      windowsFileAttributes
    );
    await writeSemanticMutationTransactionArtifacts(
      transactionRoot,
      plan,
      manifest,
      beforeBytes,
      stagedBytes,
      allowCommit
    );

    let failure: unknown;
    try {
      await atomicPublishSemanticMutationSource(
        workspaceRoot,
        transactionRoot,
        plan,
        manifest,
        allowCommit,
        createSourceReplacementTestActorForTests({
          beforeReplace: async () => {
            throw Object.assign(new Error('native path intentionally redacted'), { code: 'EACCES' });
          }
        })
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SemanticMutationContractError);
    const diagnostic = (failure as SemanticMutationContractError).diagnostic;
    expect(Object.keys(diagnostic).sort()).toEqual([
      'code',
      'details',
      'message',
      'origin',
      'relativePath',
      'stage'
    ]);
    expect(diagnostic).toEqual({
      origin: 'semantic-mutation',
      code: 'SEMANTIC-MUTATION-011',
      stage: 'publish',
      message: 'Atomic source publish failed; phase=atomic-replace; code=EACCES',
      relativePath,
      details: { phase: 'atomic-replace', errorCode: 'EACCES' }
    });
  });
});

test('Windows attributes survive atomic publish and rollback with exact source readback', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const relativePath = 'source/model/item.yaml';
    const targetPath = path.join(workspaceRoot, ...relativePath.split('/'));
    const transactionRoot = semanticMutationTransactionRoot(
      workspaceRoot,
      jsonDigest('windows-attributes')
    );
    const allowCommit = async (): Promise<void> => undefined;
    const beforeBytes = new TextEncoder().encode('state: before\n');
    const stagedBytes = new TextEncoder().encode('state: staged\n');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, beforeBytes);

    if (process.platform !== 'win32') {
      expect(await readSemanticMutationWindowsFileAttributes(targetPath)).toBeNull();
      await expect(applySemanticMutationWindowsFileAttributes(
        targetPath,
        ALL_WINDOWS_ATTRIBUTES
      )).rejects.toThrow('invalid on a non-Windows workspace');
      return;
    }

    try {
      await applySemanticMutationWindowsFileAttributes(targetPath, ALL_WINDOWS_ATTRIBUTES);
      const capturedAttributes = await readSemanticMutationWindowsFileAttributes(targetPath);
      expect(capturedAttributes).toEqual(ALL_WINDOWS_ATTRIBUTES);

      const fileMode = Number((await fs.stat(targetPath)).mode) & 0o7777;
      const { manifest, plan } = buildArtifacts(
        relativePath,
        beforeBytes,
        stagedBytes,
        fileMode,
        capturedAttributes
      );
      await writeSemanticMutationTransactionArtifacts(
        transactionRoot,
        plan,
        manifest,
        beforeBytes,
        stagedBytes,
        allowCommit
      );
      const retained = await readSemanticMutationTransactionArtifacts(transactionRoot);
      expect(retained.manifest).toEqual(manifest);

      await atomicPublishSemanticMutationSource(
        workspaceRoot,
        transactionRoot,
        plan,
        manifest,
        allowCommit
      );
      const committed = await readSemanticMutationSource(workspaceRoot, transactionRoot, relativePath);
      expect(semanticMutationByteDigest(committed.bytes)).toBe(manifest.stagedByteDigest);
      expect(committed.windowsFileAttributes).toEqual(ALL_WINDOWS_ATTRIBUTES);
      expect(await readSemanticMutationWindowsFileAttributes(targetPath)).toEqual(ALL_WINDOWS_ATTRIBUTES);

      let injectedConcurrentWrite = false;
      await expect(atomicRestoreSemanticMutationSource(
        workspaceRoot,
        transactionRoot,
        plan,
        manifest,
        async () => {
          if (injectedConcurrentWrite) return;
          injectedConcurrentWrite = true;
          await applySemanticMutationWindowsFileAttributes(targetPath, CLEARED_WINDOWS_ATTRIBUTES);
          await fs.writeFile(targetPath, 'third-party-write', 'utf8');
        }
      )).rejects.toThrow('Rollback CAS refused to overwrite source bytes not committed by this transaction');
      expect(await fs.readFile(targetPath, 'utf8')).toBe('third-party-write');
      await fs.writeFile(targetPath, stagedBytes);
      await applySemanticMutationWindowsFileAttributes(targetPath, ALL_WINDOWS_ATTRIBUTES);

      await atomicRestoreSemanticMutationSource(
        workspaceRoot,
        transactionRoot,
        plan,
        manifest,
        allowCommit
      );
      const restored = await readSemanticMutationSource(workspaceRoot, transactionRoot, relativePath);
      expect(semanticMutationByteDigest(restored.bytes)).toBe(manifest.beforeByteDigest);
      expect(restored.windowsFileAttributes).toEqual(ALL_WINDOWS_ATTRIBUTES);
      expect(await readSemanticMutationWindowsFileAttributes(targetPath)).toEqual(ALL_WINDOWS_ATTRIBUTES);
    } finally {
      const exists = await fs.access(targetPath).then(() => true).catch(() => false);
      if (exists) {
        await applySemanticMutationWindowsFileAttributes(targetPath, CLEARED_WINDOWS_ATTRIBUTES);
      }
    }
  }, 'engineering-compiler-semantic-mutation-windows-rollback-');
}, 120000);
