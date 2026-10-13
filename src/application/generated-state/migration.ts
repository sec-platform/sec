import { GeneratedStateProducerBindingBlockedError } from '../../execution/generated-state/errors.ts';
import type {
  GeneratedStateMigrationPlan, GeneratedStateNativeMutationResource,
  GeneratedStateRegistrationMutationBackend
} from '../../execution/generated-state/registration-port.ts';
import {
  issueGeneratedStatePublication,
  type GeneratedStateMutationSession
} from '../../execution/generated-state/registration-session.ts';

/** Application selects the interrupted migration continuation. The backend
 * owns exact native snapshots, codecs and each durable publication boundary. */
export function continueGeneratedStateRegistrationMigration(
  backend: GeneratedStateRegistrationMutationBackend,
  session: GeneratedStateMutationSession,
  resource: GeneratedStateNativeMutationResource
): GeneratedStateMigrationPlan | null {
  const source = backend.readMigrationSource(resource);
  const intents = backend.readMigrationIntents(resource);
  if (source === null) {
    if (intents.length !== 0) throw new GeneratedStateProducerBindingBlockedError(
      'Generated-state registration migration source evidence is absent.');
    backend.readRegistrationCensus(resource);
    return null;
  }
  const completed = intents.find(intent => intent.phase === 'complete');
  const preimage = completed?.physicalPreimageDigest ?? backend.observeMigrationPhysicalPreimage(resource, source);
  const plan = backend.describeMigration(resource, source, preimage);
  for (const intent of intents) {
    const expected = intent.phase === 'prepared' ? plan.prepared : plan.complete;
    if (intent.intentDigest !== expected.intentDigest) throw new GeneratedStateProducerBindingBlockedError(
      'Generated-state registration migration intent does not bind the current legacy inventory.');
  }
  if (completed !== undefined) {
    backend.assertMigrationTarget(resource, plan);
    return plan;
  }
  backend.publishMigrationPrepared(resource, issueGeneratedStatePublication(session,
    { kind: 'migration-prepared', intent: plan.prepared }));
  for (const record of plan.records) {
    backend.publishMigrationEvent(resource, issueGeneratedStatePublication(session,
      { kind: 'migration-event', record }));
  }
  // Re-observe both the original source and physical preimage before the
  // terminal publication; no observation is reused across a mutation.
  backend.assertMigrationSourceUnchanged(resource, plan);
  backend.publishMigrationComplete(resource, issueGeneratedStatePublication(session,
    { kind: 'migration-complete', intent: plan.complete }));
  backend.assertMigrationTarget(resource, plan);
  return plan;
}
