import type { GeneratedStateNativeMutationResource, GeneratedStateRegistrationMutationBackend } from '../../execution/generated-state/registration-port.ts';
import { withGeneratedStateMutationSession, type GeneratedStateMutationSession } from '../../execution/generated-state/registration-session.ts';
import { continueGeneratedStateRegistrationMigration } from './migration.ts';

export async function withMigratedGeneratedStateMutation<Value>(input: Readonly<{
  workspaceRoot: string;
  environment?: NodeJS.ProcessEnv;
  backend: GeneratedStateRegistrationMutationBackend;
  use: (session: GeneratedStateMutationSession, resource: GeneratedStateNativeMutationResource) => Promise<Value>;
}>): Promise<Value> {
  return withGeneratedStateMutationSession({ ...input, use: async (session, resource) => {
    continueGeneratedStateRegistrationMigration(input.backend, session, resource);
    input.backend.acknowledgeRecovery(resource);
    return input.use(session, resource);
  } });
}

export async function ensureGeneratedStateRegistrationLedger(input: Readonly<{
  workspaceRoot: string;
  environment?: NodeJS.ProcessEnv;
  backend: GeneratedStateRegistrationMutationBackend;
}>): Promise<void> {
  await withMigratedGeneratedStateMutation({ ...input, use: async () => undefined });
}
