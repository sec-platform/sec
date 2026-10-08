import { withAcquiredResource } from '../resource-settlement.ts';
import type { GeneratedStateCleanupOperationState } from './cleanup-budget.ts';
import type { GeneratedStateDirectoryObservation } from './registration-contract.ts';

export interface GeneratedStateNativeOperationResource { readonly kind: 'generated-state-native-operation-resource'; }
export interface GeneratedStateOperationSession { readonly kind: 'generated-state-operation-session'; }
export interface GeneratedStateTreeEffectAuthority { readonly kind: 'generated-state-tree-effect-authority'; }
export type GeneratedStateTreeEffectRequest =
  | Readonly<{ kind: 'quarantine-finalize' }>
  | Readonly<{ kind: 'quarantine-relocate' | 'quarantine-delete'; relativePath: string; intentDigest: `sha256:${string}` }>
  | Readonly<{ kind: 'worktree-relocate'; relativePath: string; intentDigest: `sha256:${string}` }>
  | Readonly<{ kind: 'worktree-retention-create'; operationId: `sha256:${string}` }>;
export interface GeneratedStateTreeEffectBackend {
  acquireOperation(workspaceRoot: string): Promise<GeneratedStateNativeOperationResource>;
  assertOperationCurrent(resource: GeneratedStateNativeOperationResource): Promise<void>;
  operationNamespace(resource: GeneratedStateNativeOperationResource): Promise<Readonly<{ workspaceRoot: string; relativePath: '.sec/workspace-write-lease' }>>;
  settleOperation(resource: GeneratedStateNativeOperationResource): Promise<void>;
  relocateQuarantine(resource: GeneratedStateNativeOperationResource, authority: GeneratedStateTreeEffectAuthority): Promise<GeneratedStateDirectoryObservation>;
  deleteQuarantine(resource: GeneratedStateNativeOperationResource, authority: GeneratedStateTreeEffectAuthority,
    budget: GeneratedStateCleanupOperationState | null): Promise<void>;
  finalizeQuarantine(resource: GeneratedStateNativeOperationResource, authority: GeneratedStateTreeEffectAuthority,
    budget: GeneratedStateCleanupOperationState | null): Promise<number>;
  createWorktreeRetention(resource: GeneratedStateNativeOperationResource, authority: GeneratedStateTreeEffectAuthority): Promise<GeneratedStateDirectoryObservation>;
  relocateWorktreePreservation(resource: GeneratedStateNativeOperationResource, authority: GeneratedStateTreeEffectAuthority): Promise<GeneratedStateDirectoryObservation>;
}

const operationSessions = new WeakMap<object, GeneratedStateNativeOperationResource>();
export function generatedStateOperationResource(session: GeneratedStateOperationSession): GeneratedStateNativeOperationResource {
  const resource = operationSessions.get(session);
  if (resource === undefined) throw new Error('Generated-state operation session is foreign or settled.');
  return resource;
}
const treeEffects = new WeakMap<object, Readonly<{ session: GeneratedStateOperationSession;
  resource: GeneratedStateNativeOperationResource; request: GeneratedStateTreeEffectRequest }>>();
export async function withGeneratedStateOperation<Value>(input: Readonly<{
  workspaceRoot: string; backend: GeneratedStateTreeEffectBackend;
  use: (session: GeneratedStateOperationSession, resource: GeneratedStateNativeOperationResource) => Promise<Value>;
}>): Promise<Value> {
  return withAcquiredResource({ operationLabel: 'generated-state physical operation', resourceLabel: 'generated-state workspace operation lease',
    acquire: () => input.backend.acquireOperation(input.workspaceRoot),
    use: async resource => {
      const session = Object.freeze({ kind: 'generated-state-operation-session' as const });
      operationSessions.set(session, resource);
      try { await input.backend.assertOperationCurrent(resource); return await input.use(session, resource); }
      finally { operationSessions.delete(session); }
    }, release: resource => input.backend.settleOperation(resource) });
}
export function issueGeneratedStateTreeEffect(session: GeneratedStateOperationSession,
  request: GeneratedStateTreeEffectRequest): GeneratedStateTreeEffectAuthority {
  const resource = operationSessions.get(session);
  if (resource === undefined) throw new Error('Generated-state tree Effect requires a live operation session.');
  const authority = Object.freeze({ kind: 'generated-state-tree-effect-authority' as const });
  treeEffects.set(authority, Object.freeze({ session, resource, request: Object.freeze({ ...request }) }));
  return authority;
}
export function consumeGeneratedStateTreeEffect(resource: GeneratedStateNativeOperationResource,
  authority: GeneratedStateTreeEffectAuthority): GeneratedStateTreeEffectRequest {
  const state = treeEffects.get(authority);
  if (state === undefined || state.resource !== resource || operationSessions.get(state.session) !== resource) {
    throw new Error('Generated-state tree Effect authority is foreign, consumed or stale.');
  }
  treeEffects.delete(authority); return state.request;
}
