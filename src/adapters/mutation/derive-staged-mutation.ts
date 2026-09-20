import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FactDeltaEndpointContext } from '../../semantics/engineering-ir/delta-types.ts';
import type { SemanticMutationTransactionInput } from '../../semantics/mutation/transaction.ts';
import type { SemanticMutationPlan, SemanticMutationRollbackManifest, SemanticMutationSourceEditPlan, VerificationRequirement } from '../../semantics/mutation/types.ts';
import { SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION, SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION } from '../../semantics/mutation/types.ts';
import type { SemanticMutationVerificationCapabilityPlan } from '../../assurance/verification/contract/types.ts';
import { buildWorkspaceSemanticBundle } from '../workspace/semantic-bundle.ts';
import { compareCodeUnits, mutationDiagnostic } from '../../compiler/semantic-mutation/canonical.ts';
import { normalizeSemanticMutationRequest } from '../../compiler/semantic-mutation/normalize-request.ts';
import {
  planSemanticMutation,
  planSemanticMutationWithVerificationPlanningProducer
} from '../../compiler/semantic-mutation/plan-semantic-mutation.ts';
import {
  planSemanticMutationSourceEdit,
  renderSemanticMutationSourceEdit
} from './plan-source-edit.ts';
import { preflightSemanticMutation } from '../../compiler/semantic-mutation/preflight-semantic-mutation.ts';
import { semanticMutationByteDigest } from '../../compiler/semantic-mutation/canonical.ts';
import {
  assertSemanticMutationTransactionRoot,
  semanticMutationTransactionRoot,
  type SemanticMutationCommitFence
} from './transaction-identity.ts';
import { semanticMutationRequestIdentityDigest, semanticMutationStagedTransactionId } from '../../compiler/semantic-mutation/identity.ts';
import { buildSemanticMutationVerificationPlanningContext } from '../../compiler/semantic-mutation/verification-policy.ts';
import { isSemanticMutationWindowsReparsePoint } from './windows-file-attributes.ts';

export interface SemanticMutationPlanningCapabilityAdapter {
  readonly adapterId: string;
  readonly adapterRevision: string;
  capabilityPlan(
    staged: FactDeltaEndpointContext,
    requirements: readonly VerificationRequirement[],
    stagingWorkspaceRoot: string
  ): Promise<SemanticMutationVerificationCapabilityPlan>;
}

export interface DerivedSemanticMutationTransaction {
  readonly plan: SemanticMutationPlan;
  readonly transactionRoot?: string;
  readonly stagingWorkspaceRoot?: string;
  readonly editPlan?: SemanticMutationSourceEditPlan;
  readonly rollbackManifest?: SemanticMutationRollbackManifest;
  readonly originalBytes?: Uint8Array;
  readonly stagedBytes?: Uint8Array;
  readonly staged?: FactDeltaEndpointContext;
  readonly verificationCapabilityPlan?: SemanticMutationVerificationCapabilityPlan;
}

function endpointFromBundle(
  transactionId: string,
  snapshot: Awaited<ReturnType<typeof buildWorkspaceSemanticBundle>>['snapshot']
): FactDeltaEndpointContext {
  return {
    transactionId,
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    snapshot
  };
}

async function copyWorkspaceTree(
  source: string,
  target: string,
  commitFence: SemanticMutationCommitFence,
  relative = '',
  sourceBoundaryRoot = path.resolve(source)
): Promise<void> {
  const canonicalSource = await realpath(source);
  const expectedSource = relative === ''
    ? sourceBoundaryRoot
    : path.join(sourceBoundaryRoot, ...relative.split('/'));
  const comparable = (value: string) => process.platform === 'win32'
    ? path.resolve(value).toLocaleLowerCase('en-US')
    : path.resolve(value);
  if (comparable(canonicalSource) !== comparable(expectedSource)) {
    throw new Error('Isolated Semantic Mutation staging source aliases another workspace');
  }
  await commitFence();
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => compareCodeUnits(left.name, right.name))) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (childRelative === '.git' || childRelative === 'node_modules' ||
      childRelative === '.shared-deps' ||
      childRelative === '.sec/semantic-mutation' ||
      childRelative === '.sec/workspace-write-lease') continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    const metadata = await lstat(sourcePath);
    if (metadata.isSymbolicLink() || await isSemanticMutationWindowsReparsePoint(sourcePath)) {
      throw new Error(`Isolated Semantic Mutation staging rejects reparse entry "${childRelative}"`);
    }
    if (metadata.isDirectory()) {
      await copyWorkspaceTree(sourcePath, targetPath, commitFence, childRelative, sourceBoundaryRoot);
    } else if (metadata.isFile()) {
      if (Number(metadata.nlink) !== 1) {
        throw new Error(`Isolated Semantic Mutation staging rejects hard-linked entry "${childRelative}"`);
      }
      await commitFence();
      await copyFile(sourcePath, targetPath);
      await commitFence();
      await chmod(targetPath, Number(metadata.mode) & 0o7777);
    } else {
      throw new Error(`Isolated Semantic Mutation staging rejects special entry "${childRelative}"`);
    }
    const after = await lstat(sourcePath);
    if (String(after.dev) !== String(metadata.dev) || String(after.ino) !== String(metadata.ino) ||
      Number(after.mode) !== Number(metadata.mode) || Number(after.nlink) !== Number(metadata.nlink) ||
      after.isSymbolicLink() || await isSemanticMutationWindowsReparsePoint(sourcePath)) {
      throw new Error(`Isolated Semantic Mutation staging source changed identity "${childRelative}"`);
    }
  }
}

function safeStagedRebuildErrorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(code)
    ? code
    : 'UNKNOWN';
}

/**
 * Public mutation diagnostics must never copy native error messages: Node and
 * Bun routinely include absolute workspace and transaction paths in them.
 */
export function semanticMutationStagedRebuildDiagnostic(
  error: unknown
): ReturnType<typeof mutationDiagnostic> {
  return mutationDiagnostic(
    'SEMANTIC-MUTATION-008',
    'staged-rebuild',
    'Isolated staged semantic rebuild failed',
    { details: { errorCode: safeStagedRebuildErrorCode(error) } }
  );
}

export async function deriveStagedSemanticMutation(
  workspaceRoot: string,
  input: SemanticMutationTransactionInput,
  verificationAdapter: SemanticMutationPlanningCapabilityAdapter,
  commitFence: SemanticMutationCommitFence
): Promise<DerivedSemanticMutationTransaction> {
  const currentBundle = await buildWorkspaceSemanticBundle(workspaceRoot);
  const currentBase = endpointFromBundle(input.base.transactionId, currentBundle.snapshot);
  const preflight = preflightSemanticMutation({
    request: input.request,
    base: currentBase,
    authorization: input.authorization
  });
  if (preflight.rejectedAt === 'request') return { plan: preflight };
  if (preflight.status === 'rejected') {
    return {
      plan: planSemanticMutation({
        request: input.request,
        base: currentBase,
        authorization: input.authorization,
        preparation: {
          status: 'rejected',
          preflightRevision: preflight.preflightRevision,
          rejectedAt: preflight.rejectedAt as 'source-resolution',
          diagnostics: preflight.diagnostics
        }
      })
    };
  }

  const normalized = normalizeSemanticMutationRequest(input.request);
  const requestIdentityDigest = semanticMutationRequestIdentityDigest({
    graphId: normalized.graphId,
    appId: normalized.appId,
    requestId: normalized.requestId
  });
  const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, requestIdentityDigest);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
  await commitFence();
  await mkdir(transactionRoot, { recursive: true });
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
  const pathProofDirectory = path.join(transactionRoot, 'path-proof');
  await commitFence();
  await mkdir(pathProofDirectory, { recursive: true });
  const sourcePlanning = await planSemanticMutationSourceEdit({
    request: input.request,
    base: currentBase,
    authorization: input.authorization,
    preflight,
    sourceAdapterRegistryRevision: SEMANTIC_MUTATION_SOURCE_ADAPTER_REGISTRY_REVISION,
    adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION,
    sourceCandidates: currentBundle.semanticContractSources,
    workspaceRoot,
    transactionDirectory: pathProofDirectory
  });
  if (sourcePlanning.status === 'rejected') {
    return {
      transactionRoot,
      plan: planSemanticMutation({
        request: input.request,
        base: currentBase,
        authorization: input.authorization,
        preparation: sourcePlanning
      })
    };
  }

  const editPlan = sourcePlanning.plan;
  const rollbackManifest = sourcePlanning.rollbackManifest;
  const originalPath = path.join(workspaceRoot, ...editPlan.relativePath.split('/'));
  const originalBytes = new Uint8Array(await readFile(originalPath));
  if (semanticMutationByteDigest(originalBytes) !== editPlan.beforeByteDigest) {
    const preparation = {
      status: 'rejected' as const,
      preflightRevision: preflight.preflightRevision,
      rejectedAt: 'cas' as const,
      diagnostics: [mutationDiagnostic(
        'SEMANTIC-MUTATION-007',
        'cas',
        'Source bytes changed after deterministic edit planning',
        { relativePath: editPlan.relativePath }
      )]
    };
    return {
      transactionRoot,
      editPlan,
      rollbackManifest,
      plan: planSemanticMutation({
        request: input.request,
        base: currentBase,
        authorization: input.authorization,
        preparation
      })
    };
  }
  const stagedBytes = renderSemanticMutationSourceEdit(editPlan, originalBytes);
  const stagingWorkspaceRoot = path.join(transactionRoot, 'workspace');
  await commitFence();
  await rm(stagingWorkspaceRoot, { recursive: true, force: true });
  try {
    await copyWorkspaceTree(workspaceRoot, stagingWorkspaceRoot, commitFence);
    const stagedSourcePath = path.join(stagingWorkspaceRoot, ...editPlan.relativePath.split('/'));
    await commitFence();
    await writeFile(stagedSourcePath, stagedBytes);
    await commitFence();
    await chmod(stagedSourcePath, rollbackManifest.fileMode);
    const stagedBundle = await buildWorkspaceSemanticBundle(stagingWorkspaceRoot);
    const stagedTransactionId = semanticMutationStagedTransactionId({
      requestRevision: normalized.requestRevision,
      authorizationRevision: preflight.authorizationRevision,
      base: preflight.base,
      sourceEditPlanRevision: editPlan.editPlanRevision
    });
    const staged = endpointFromBundle(stagedTransactionId, stagedBundle.snapshot);
    let verificationCapabilityPlan: SemanticMutationVerificationCapabilityPlan | undefined;
    const plan = await planSemanticMutationWithVerificationPlanningProducer({
      request: input.request,
      base: currentBase,
      authorization: input.authorization,
      preparation: {
        status: 'prepared',
        preflightRevision: preflight.preflightRevision,
        sourceChanges: [{
          ownerId: editPlan.ownerId,
          adapterId: editPlan.adapterId,
          adapterRevision: editPlan.adapterRevision,
          relativePath: editPlan.relativePath,
          beforeByteDigest: editPlan.beforeByteDigest,
          stagedByteDigest: editPlan.stagedByteDigest,
          invalidationFromStage: 'resolve'
        }],
        staged,
        rollbackManifestDigest: rollbackManifest.rollbackManifestDigest
      }
    }, {
      async produce({ impact, requirements }) {
        verificationCapabilityPlan = await verificationAdapter.capabilityPlan(
          staged,
          requirements,
          stagingWorkspaceRoot
        );
        const capabilities = verificationCapabilityPlan.capabilities;
        return buildSemanticMutationVerificationPlanningContext({
          adapterId: verificationAdapter.adapterId,
          adapterRevision: verificationAdapter.adapterRevision,
          impactRevision: impact.impactRevision,
          uncertaintyStatus: capabilities.every((entry) => entry.status === 'runnable' && entry.isolated)
            ? 'covered'
            : 'blocked',
          capabilities
        }, requirements);
      }
    });
    return {
      plan,
      transactionRoot,
      stagingWorkspaceRoot,
      editPlan,
      rollbackManifest,
      originalBytes,
      stagedBytes,
      staged,
      ...(verificationCapabilityPlan ? { verificationCapabilityPlan } : {})
    };
  } catch (error) {
    const preparation = {
      status: 'rejected' as const,
      preflightRevision: preflight.preflightRevision,
      rejectedAt: 'staged-rebuild' as const,
      diagnostics: [semanticMutationStagedRebuildDiagnostic(error)]
    };
    return {
      transactionRoot,
      stagingWorkspaceRoot,
      editPlan,
      rollbackManifest,
      originalBytes,
      stagedBytes,
      plan: planSemanticMutation({
        request: input.request,
        base: currentBase,
        authorization: input.authorization,
        preparation
      })
    };
  }
}
