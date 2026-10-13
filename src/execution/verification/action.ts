/** Canonical pure verification action contracts. Native schemas,
 * parsers, retained issuers and physical effects remain with their owners. */


export interface CiVerificationActionPlanClosure {
  readonly schema: "sec-ci-verification-action-plan-closure-v2";
  readonly producerRevision: "sec-ci-verification-action-producer-v2";
  readonly actions: readonly VerificationActionPlan[];
  readonly normalizedOperations: readonly CiVerificationNormalizedOperation[];
  readonly actionPlanDigest: CiVerificationActionDigest;
}

export type CiVerificationNormalizedOperation = Readonly<{
  schema: 'sec-ci-verification-normalized-operation-v2';
  gateId: string;
  phase: CiVerificationGatePhase;
  runtime: 'bun';
  workingDirectory: '.';
  target: CiVerificationNormalizedTarget;
  environmentBindings: readonly Readonly<{ name: string; digest: CiVerificationActionDigest }>[];
  coveredScopeIds: readonly string[];
  candidate: Readonly<{
    baseSha: string;
    baseTreeSha: string;
    headSha: string;
    headTreeSha: string;
    manifestDigest: CiVerificationActionDigest;
    scopeAuthorizationRevision: CiVerificationActionDigest;
    profile: 'quick' | 'full';
    executionEnvironmentRevision: string;
  }>;
  semanticDigest: CiVerificationActionDigest;
}>;

export type CiVerificationGatePhase = 'quick' | 'risk' | 'full' | 'workspace';

export type CiVerificationNormalizedTarget =
  | Readonly<{
      kind: 'bun-package-script';
      identity: string;
      readonly args: readonly string[];
    }>
  | Readonly<{
      kind: 'bun-test';
      identity: 'test';
      readonly args: readonly string[];
    }>
  | Readonly<{
      kind: 'bun-typescript-entrypoint';
      identity: string;
      readonly args: readonly string[];
    }>;

export type CiVerificationActionDigest = `sha256:${string}`;

export type VerificationActionPlan = Readonly<{
  schema: "sec-verification-action-plan-v2";
  action: VerificationActionKey;
  /** Scheduler lane policy; never included in ActionKey identity. */
  executionClass: VerificationActionExecutionClass;
  dependencies: readonly VerificationActionDependency[];
}>;

export type VerificationActionKey = VerificationActionKeyInput & Readonly<{
  schema: "sec-verification-action-key-v2";
  actionKey: VerificationActionKeyDigest;
}>;

export type VerificationActionKeyInput = Readonly<{
  actionKind: string;
  producer: VerificationActionProducer;
  operation: VerificationActionOperation;
  inputClosure: readonly VerificationActionInputRef[];
  environment: VerificationActionEnvironment;
  /** Producer-owned cheap preflight topology required by an expensive plan. */
  requiredCheapPreflightActionKeys: readonly VerificationActionKeyDigest[];
  upstreamActionKeys: readonly VerificationActionKeyDigest[];
  resultSchemaRevision: string;
}>;

export type VerificationActionProducer = Readonly<{
  identity: string;
  revision: string;
}>;

export type VerificationActionOperation = Readonly<{
  /** Stable producer-owned operation identity; no raw command selectors. */
  identity: string;
  /** Version of the producer's semantic operation normalizer. */
  revision: string;
  /** Digest of the canonical operation after selectors and context resolve. */
  semanticDigest: VerificationActionKeyDigest;
  /** Canonical repository-relative logical cwd; `.` is the repository root. */
  workingDirectory: string;
  declaredEnvironment: readonly VerificationActionEnvironmentBinding[];
}>;

export type VerificationActionKeyDigest = `sha256:${string}`;

export type VerificationActionEnvironmentBinding = Readonly<{
  name: string;
  digest: VerificationActionKeyDigest;
}>;

export type VerificationActionInputRef = Readonly<{
  path: string;
  digest: VerificationActionKeyDigest;
}>;

export type VerificationActionEnvironment = Readonly<{
  toolchainRevision: string;
  providerRevision: string;
  contractRevision: string;
}>;

export type VerificationActionExecutionClass = 'cheap-preflight' | 'expensive';

export type VerificationActionDependency = Readonly<{
  actionKey: VerificationActionKeyDigest;
  kind: VerificationActionDependencyKind;
}>;

export type VerificationActionDependencyKind = 'cheap-preflight' | 'upstream';
