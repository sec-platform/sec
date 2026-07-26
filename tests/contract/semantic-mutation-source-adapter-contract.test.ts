import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  assertSemanticMutationRollbackManifestInvariant,
  assertSemanticMutationSourceEditArtifactsInvariant,
  assertSemanticMutationSourceEditPlanInvariant,
  buildTrustedLocalSemanticMutationAuthorization,
  planSemanticMutationSourceEdit,
  type SemanticMutationAuthorizationContextV2,
  type SemanticMutationSourceEditPlanningInputV1,
  type TrustedLocalSemanticMutationAuthorizationInputV1,
  type TrustedLocalSemanticMutationPolicyDraftV1
} from '../../platform/compiler/index.ts';
import type { EngineeringIR } from '../../platform/shared/engineering-ir-types.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import {
  SEMANTIC_CONTRACT_YAML_ADAPTER_ID,
  SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
  SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION,
  SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION,
  SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
  SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION,
  SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION,
  type SemanticMutationLoadedSourceCandidateV1,
  type SemanticMutationRequestV2,
  type SemanticMutationRollbackManifestV2,
  type SemanticMutationSourceEditPlanV1
} from '../../platform/shared/semantic-mutation-types.ts';
import type { SemanticViewSet } from '../../platform/shared/semantic-view-types.ts';

function sha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function vectors(): {
  readonly manifest: SemanticMutationRollbackManifestV2;
  readonly plan: SemanticMutationSourceEditPlanV1;
} {
  const pathEvidenceWithoutRevision = {
    formatRevision: SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION,
    relativePath: 'source/model/item.yaml',
    workspaceIdentityDigest: sha256('workspace'),
    transactionDirectoryIdentityDigest: sha256('transaction'),
    parentIdentityDigest: sha256('parent'),
    targetIdentityDigest: sha256('target')
  } as const;
  const pathEvidence = {
    ...pathEvidenceWithoutRevision,
    pathEvidenceRevision: sha256({
      domain: 'semantic-mutation-source-path-evidence-v1',
      ...pathEvidenceWithoutRevision
    })
  };
  const manifestWithoutRevision = {
    formatRevision: SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION,
    ownerId: 'semantic-contract-owner:item:item-core',
    adapterId: SEMANTIC_CONTRACT_YAML_ADAPTER_ID,
    adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
    relativePath: 'source/model/item.yaml',
    beforeByteDigest: sha256('before-bytes'),
    stagedByteDigest: sha256('staged-bytes'),
    beforeByteLength: 100,
    stagedByteLength: 140,
    fileMode: 0o644,
    windowsFileAttributes: null,
    encoding: 'utf-8' as const,
    utf8Bom: false,
    lineEnding: 'lf' as const,
    finalNewline: true,
    pathEvidenceRevision: pathEvidence.pathEvidenceRevision
  } as const;
  const manifest = {
    ...manifestWithoutRevision,
    rollbackManifestDigest: sha256({
      domain: 'semantic-mutation-rollback-manifest-v2',
      ...manifestWithoutRevision
    })
  };
  const planWithoutRevision = {
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
    relativePath: manifest.relativePath,
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
    editPlanRevision: sha256({ domain: 'semantic-mutation-source-edit-plan-v1', ...planWithoutRevision })
  };
  return { manifest, plan };
}

test('SM-2 constants and independent edit-plan/rollback digest vectors stay frozen', () => {
  expect(SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION).toBe('semantic-mutation-source-adapters-v1');
  expect(SEMANTIC_CONTRACT_YAML_ADAPTER_ID).toBe('semantic-contract-yaml');
  expect(SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION).toBe('semantic-contract-yaml-v1');
  expect(SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION).toBe('semantic-mutation-source-path-evidence-v1');
  expect(SEMANTIC_MUTATION_SOURCE_EDIT_PLAN_REVISION).toBe('semantic-mutation-source-edit-plan-v1');
  expect(SEMANTIC_MUTATION_ROLLBACK_MANIFEST_REVISION).toBe('semantic-mutation-rollback-manifest-v2');
  const { manifest, plan } = vectors();
  expect(() => assertSemanticMutationRollbackManifestInvariant(manifest)).not.toThrow();
  expect(() => assertSemanticMutationSourceEditPlanInvariant(plan)).not.toThrow();
  expect(() => assertSemanticMutationSourceEditArtifactsInvariant(plan, manifest)).not.toThrow();
});

test('unknown fields, stale revisions, digest forgery, and non-canonical operation order fail closed', () => {
  const { manifest, plan } = vectors();
  expect(() => assertSemanticMutationRollbackManifestInvariant({
    ...manifest,
    backupPath: '.sec/backup/item.yaml'
  } as never)).toThrow('schema');
  expect(() => assertSemanticMutationRollbackManifestInvariant({
    ...manifest,
    rollbackManifestDigest: sha256('forged')
  })).toThrow('digest');
  expect(() => assertSemanticMutationSourceEditPlanInvariant({
    ...plan,
    absolutePath: 'C:\\workspace\\source\\model\\item.yaml'
  } as never)).toThrow('schema');
  expect(() => assertSemanticMutationSourceEditPlanInvariant({
    ...plan,
    adapterRevision: 'semantic-contract-yaml-v0'
  } as never)).toThrow('digest');
  expect(() => assertSemanticMutationSourceEditPlanInvariant({
    ...plan,
    operations: [
      { ...plan.operations[0]!, operationId: 'operation:z' },
      { ...plan.operations[0]!, operationId: 'operation:a', from: 'closed', to: 'open' }
    ]
  } as never)).toThrow('digest');
  expect(() => assertSemanticMutationSourceEditPlanInvariant({
    ...plan,
    pathEvidence: { ...plan.pathEvidence, targetIdentityDigest: sha256('forged-target') }
  })).toThrow('digest');
  const mismatchedManifestWithoutRevision = {
    ...manifest,
    stagedByteDigest: sha256('other-staged')
  };
  const { rollbackManifestDigest: _ignored, ...mismatchedWithoutDigest } = mismatchedManifestWithoutRevision;
  const mismatchedManifest = {
    ...mismatchedWithoutDigest,
    rollbackManifestDigest: sha256({
      domain: 'semantic-mutation-rollback-manifest-v2',
      ...mismatchedWithoutDigest
    })
  };
  expect(() => assertSemanticMutationSourceEditArtifactsInvariant(plan, mismatchedManifest)).toThrow('paired');
});

test('proposal, raw IR, Lock, Projection, and arbitrary objects cannot replace trusted SM-2 inputs', () => {
  const proposal = {} as SemanticMutationRequestV2;
  const source = {} as SemanticMutationLoadedSourceCandidateV1;
  const trusted = {} as SemanticMutationSourceEditPlanningInputV1;
  const trustedAuthorizationInput = {} as TrustedLocalSemanticMutationAuthorizationInputV1;
  const trustedLocalPolicy = {} as TrustedLocalSemanticMutationPolicyDraftV1;
  const authorization = {} as SemanticMutationAuthorizationContextV2;
  const rawIR = {} as EngineeringIR;
  const lock = {} as LockFile;
  const views = {} as SemanticViewSet;
  if (false) {
    // @ts-expect-error Proposal is not trusted loaded-source provenance.
    const candidate: SemanticMutationLoadedSourceCandidateV1 = proposal;
    // @ts-expect-error Loaded source provenance is not a mutation proposal.
    const request: SemanticMutationRequestV2 = source;
    // @ts-expect-error Raw IR cannot replace the branded Fact Delta endpoint.
    void planSemanticMutationSourceEdit({ ...trusted, base: rawIR });
    // @ts-expect-error Lock state cannot replace the source edit planning input.
    void planSemanticMutationSourceEdit(lock);
    // @ts-expect-error Projection state cannot replace the source edit planning input.
    void planSemanticMutationSourceEdit(views);
    // @ts-expect-error A complete authorization cannot replace the authority-free trusted-local policy draft.
    buildTrustedLocalSemanticMutationAuthorization({ ...trustedAuthorizationInput, policy: authorization });
    // @ts-expect-error A raw proposal lacks the normalized request revision required by the trusted ingress.
    buildTrustedLocalSemanticMutationAuthorization({ ...trustedAuthorizationInput, request: proposal });
    // @ts-expect-error Raw EngineeringIR cannot replace the branded Fact Delta endpoint.
    buildTrustedLocalSemanticMutationAuthorization({ ...trustedAuthorizationInput, base: rawIR });
    void candidate;
    void request;
    void trustedLocalPolicy;
  }
  expect(typeof buildTrustedLocalSemanticMutationAuthorization).toBe('function');
  expect(true).toBe(true);
});

async function sourceFiles(root: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : [target];
  }));
  return nested.flat().filter((file) => file.endsWith('.ts'));
}

test('only explicit SM-2/SM-3 owners may import filesystem, path, YAML, or authoring loader dependencies', async () => {
  const root = path.resolve(import.meta.dir, '../../platform/compiler/semantic-mutation');
  const moduleSources: Record<string, string> = Object.fromEntries(await Promise.all((await sourceFiles(root)).map(async (file) => [
    path.basename(file),
    await readFile(file, 'utf8')
  ] as const)));
  const fsOwners = Object.entries(moduleSources)
    .filter(([, source]) => source.includes("from 'node:fs"))
    .map(([file]) => file)
    .sort();
  const pathOwners = Object.entries(moduleSources)
    .filter(([, source]) => source.includes("from 'node:path"))
    .map(([file]) => file)
    .sort();
  const yamlOwners = Object.entries(moduleSources)
    .filter(([, source]) => source.includes("from 'yaml'"))
    .map(([file]) => file);
  const loaderOwners = Object.entries(moduleSources)
    .filter(([, source]) => source.includes('/parse/load-authoring-semantic-contracts'))
    .map(([file]) => file);
  const filesystemOwners = [
    'atomic-source-publish.ts',
    'derive-staged-mutation.ts',
    'isolated-verification-child-outcome.ts',
    'isolated-verification-child-progress.ts',
    'isolated-verification-phase-telemetry.ts',
    'mutation-recovery-record.ts',
    'mutation-terminal-record.ts',
    'source-path-boundary.ts',
    'transaction-identity.ts',
    'windows-file-attributes.ts'
  ].sort();
  expect(fsOwners).toEqual(filesystemOwners);
  expect(pathOwners).toEqual(filesystemOwners);
  expect(yamlOwners).toEqual(['semantic-contract-yaml-adapter.ts']);
  expect(loaderOwners).toEqual(['source-adapter-registry.ts']);

  for (const reverseOwner of [
    '../../platform/compiler/ir',
    '../../platform/compiler/semantic-impact',
    '../../platform/compiler/projection'
  ]) {
    for (const file of await sourceFiles(path.resolve(import.meta.dir, reverseOwner))) {
      expect(await readFile(file, 'utf8')).not.toContain('semantic-mutation/');
    }
  }
});

test('only the existing source resolver and trusted ingress consume the shared source-authority core', async () => {
  const root = path.resolve(import.meta.dir, '../../platform/compiler/semantic-mutation');
  const consumers = (await Promise.all((await sourceFiles(root)).map(async (file) => ({
    file: path.basename(file),
    source: await readFile(file, 'utf8')
  }))))
    .filter(({ source }) => source.includes('resolveSemanticMutationSourceAuthority'))
    .map(({ file }) => file)
    .sort();
  expect(consumers).toEqual([
    'source-adapter-registry.ts',
    'trusted-authorization-ingress.ts'
  ]);
});

test('stable read binds the opened handle identity to the inspected target before reading bytes', async () => {
  const source = await readFile(path.resolve(
    import.meta.dir,
    '../../platform/compiler/semantic-mutation/source-path-boundary.ts'
  ), 'utf8');
  const identityBinding = source.indexOf(
    'sameIdentity(beforeBoundary.targetIdentity, identity(beforeRead))'
  );
  const byteRead = source.indexOf('handle.readFile()');
  expect(identityBinding).toBeGreaterThan(-1);
  expect(byteRead).toBeGreaterThan(identityBinding);
  expect(source).toContain(
    "casFailure('Opened source handle does not match the inspected target identity', relativePath)"
  );
});
