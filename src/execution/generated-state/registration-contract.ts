import type { GeneratedStatePhysicalIdentity, GeneratedStateRegistration } from './contract.ts';

/** Physical observations are values. Only the native issuer can admit the
 * opaque resource which retains the corresponding host capability. */
export interface GeneratedStateDirectoryObservation extends GeneratedStatePhysicalIdentity {
  readonly path: string;
  readonly finalPath: string;
}

export interface GeneratedStateNativeMutationResource {
  readonly kind: 'generated-state-native-mutation-resource';
}
export interface GeneratedStateNativeObservationResource {
  readonly kind: 'generated-state-native-observation-resource';
}
export type GeneratedStateNativeResource = GeneratedStateNativeMutationResource | GeneratedStateNativeObservationResource;

export interface GeneratedStateRegistrationRecord {
  readonly schema: 'sec-generated-state-registration-ledger-v2' | 'sec-generated-state-registration-chain-v3';
  readonly event?: 'registered' | 'disposed';
  readonly recordDigest: `sha256:${string}`;
  readonly previousRecordDigest: `sha256:${string}` | null;
  readonly sequence: number;
  readonly relativePath: string;
  readonly registrationDigest: `sha256:${string}`;
  readonly registrationBytes: string;
}

export interface GeneratedStateRegistrationObservation {
  readonly tip: GeneratedStateRegistrationRecord | null;
  readonly registration: GeneratedStateRegistration | null;
  readonly retiredPredecessor: GeneratedStateRegistration | null;
  readonly previousRegistration: GeneratedStateRegistration | null;
}

/** Not admitted by its JSON shape. Execution retains the exact original
 * resource and request in a private issuer table. Native publication consumes
 * the capability and rechecks its retained resource and physical preimage. */
export interface GeneratedStatePublicationAuthority {
  readonly kind: 'generated-state-publication-authority';
}
