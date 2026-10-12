import { withAcquiredResource } from '../resource-settlement.ts';
import { parseGeneratedStateRegistration } from './contract.ts';
import type {
  GeneratedStateNativeMutationResource,
  GeneratedStatePublicationAuthority,
  GeneratedStatePublicationRequest,
  GeneratedStateRegistrationMutationBackend
} from './registration-port.ts';
import { assertGeneratedStateRegistrationResponsibilityAdmission, assertGeneratedStateRegistrationTransitionAdmission } from './registration-transition.ts';

export interface GeneratedStateMutationSession {
  readonly kind: 'generated-state-mutation-session';
}

const sessions = new WeakMap<object, Readonly<{
  resource: GeneratedStateNativeMutationResource;
  backend: GeneratedStateRegistrationMutationBackend;
}>>();
const publications = new WeakMap<object, Readonly<{
  session: GeneratedStateMutationSession;
  resource: GeneratedStateNativeMutationResource;
  request: GeneratedStatePublicationRequest;
}>>();

export async function withGeneratedStateMutationSession<Value>(input: Readonly<{
  workspaceRoot: string;
  environment?: NodeJS.ProcessEnv;
  backend: GeneratedStateRegistrationMutationBackend;
  use: (session: GeneratedStateMutationSession, resource: GeneratedStateNativeMutationResource) => Promise<Value>;
}>): Promise<Value> {
  const backend = input.backend;
  return withAcquiredResource({
    operationLabel: 'generated-state mutation', resourceLabel: 'generated-state native mutation lease',
    acquire: () => backend.acquireMutation({ workspaceRoot: input.workspaceRoot, environment: input.environment }),
    use: async resource => {
      const session = Object.freeze({ kind: 'generated-state-mutation-session' as const });
      sessions.set(session, Object.freeze({ resource, backend }));
      try {
        await backend.assertCurrent(resource);
        const result = await input.use(session, resource);
        await backend.assertCurrent(resource);
        return result;
      } finally { sessions.delete(session); }
    },
    release: resource => backend.settleMutation(resource)
  });
}

/** Issuance is tied to the live execution session. Native publication still
 * validates its original retained resource and exact expected artifact. */
export function issueGeneratedStatePublication(session: GeneratedStateMutationSession,
  request: GeneratedStatePublicationRequest): GeneratedStatePublicationAuthority {
  const state = sessions.get(session);
  if (state === undefined) throw new Error('Generated-state publication requires a live mutation session.');
  if (request.kind === 'registration') {
    const registration = parseGeneratedStateRegistration(request.registration);
    const current = state.backend.readRegistrationCensus(state.resource).observations.get(registration.relativePath);
    assertGeneratedStateRegistrationResponsibilityAdmission(request, current,
      state.backend.readRegistrationResponsibilities(state.resource, registration.relativePath));
    assertGeneratedStateRegistrationTransitionAdmission(request, current,
      state.backend.observeWorkspace(state.resource), state.backend.observeRoot(state.resource, registration.relativePath));
  }
  // Snapshot data at issuance; a caller mutating an intent or registration
  // afterwards cannot change the artifact the capability names.
  const snapshot = JSON.parse(JSON.stringify(request)) as GeneratedStatePublicationRequest;
  const retained = request.kind === 'worktree-complete' && snapshot.kind === 'worktree-complete' ?
    Object.freeze({ ...snapshot, effectEvidence: request.effectEvidence }) : snapshot;
  const authority = Object.freeze({ kind: 'generated-state-publication-authority' as const });
  publications.set(authority, Object.freeze({ session, resource: state.resource, request: retained }));
  return authority;
}

export function consumeGeneratedStatePublication(authority: GeneratedStatePublicationAuthority,
  resource: GeneratedStateNativeMutationResource): GeneratedStatePublicationRequest {
  const publication = publications.get(authority);
  if (publication === undefined || publication.resource !== resource ||
      !sessions.has(publication.session)) {
    throw new Error('Generated-state publication authority is foreign, consumed or no longer live.');
  }
  publications.delete(authority);
  return publication.request;
}
