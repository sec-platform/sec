import type { DependencyFreshnessLockObservation } from '../contract/dependency-freshness.ts';
import type { RuntimeDependencyMaterializationBinding } from '../contract/runtime-dependency-spec.ts';
import type { GeneratedStatePhysicalIdentity } from '../../../runtime-state/generated-state/contract.ts';
import type {
  PhysicalGenerationRetirementReceipt,
  RetainedNoFollowProvenDirectoryGeneration
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import type { RuntimeDependencySourceGeneration } from './dependency-transition/contract.ts';

export interface RuntimeDepsStamp {
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  formatVersion: 'runtime-deps-stamp-v4';
  manifestHash: string;
  packageManager: 'bun';
  installedAt: string;
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  target: Readonly<RuntimeDependencyTargetIdentity>;
}

export interface RuntimeDependencyTargetIdentity {
  readonly schema: 'sec-runtime-dependency-target-identity-v1';
  readonly kind: 'directory' | 'link';
  readonly physical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly linkTarget: string | null;
}

export interface SharedDepsReadyState {
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  packageManager: 'bun';
  root: string;
  nodeModulesPath: string;
  manifestHash: string;
  readonly sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
}

export interface CompilerDepsReadyState {
  manifestHash: string;
  nodeModulesPath: string;
  packageManager: 'bun';
  readonly requiresFreshProcess: boolean;
  root: string;
  readonly runtimeMaterialization?: Readonly<RuntimeDependencyMaterializationBinding> | null;
  readonly sourceGeneration?: Readonly<RuntimeDependencySourceGeneration>;
  source: 'existing' | 'installed';
  readonly transitionDigest: `sha256:${string}`;
  readonly executionGenerationAuthority: CompilerDependencyExecutionGenerationAuthority;
}

export interface CompilerDependencyExecutionGenerationAuthority {
  readonly generationDigest: `sha256:${string}`;
}

export interface CompilerDependencyExecutionRetirementReceipt {
  readonly schema: 'sec-compiler-dependency-execution-retirement-v1';
  readonly generationDigest: `sha256:${string}`;
  readonly generationPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly leaseId: `sha256:${string}`;
  readonly releaseRecordDigest: `sha256:${string}`;
  readonly terminal: 'released';
}

export interface RetainedCompilerDependencyReadGeneration {
  readonly assertAuthorityCurrent: () => Promise<void>;
  readonly generationDigest: `sha256:${string}`;
  readonly physicalGeneration: RetainedNoFollowProvenDirectoryGeneration;
  readonly retire: () => Promise<CompilerDependencyReadGenerationRetirementReceipt>;
}

export interface CompilerDependencyReadGenerationRetirementReceipt {
  readonly generationDigest: `sha256:${string}`;
  readonly physicalRoot: PhysicalGenerationRetirementReceipt['root'];
  readonly terminal: 'released';
}

export interface CompilerDependencyEnvironmentRetirementReceipt {
  readonly owner: 'compiler-dependency-runtime';
  readonly root: string;
  readonly rootIdentity:
    | Readonly<{ readonly state: 'present'; readonly physical: GeneratedStatePhysicalIdentity }>
    | Readonly<{ readonly state: 'absent'; readonly absenceDigest: `sha256:${string}` }>;
  readonly operationId: string;
  readonly outcome: string;
  readonly locatorPreimage:
    | Readonly<{ readonly state: 'absent' }>
    | Readonly<{
        readonly state: 'present';
        readonly physical: GeneratedStatePhysicalIdentity;
        readonly linkTarget: string;
      }>;
  readonly locatorRetirement: 'not-required' | 'retired';
  readonly nodeModulesReadback: 'absent';
  readonly generationCollection: 'complete' | 'root-absent';
  readonly terminal: 'retired';
  readonly receiptDigest: `sha256:${string}`;
}

export interface RetainedCompilerDependencyExecutionGeneration {
  readonly directRootResolution: DependencyFreshnessLockObservation;
  readonly generationDigest: `sha256:${string}`;
  readonly physicalGeneration: RetainedNoFollowProvenDirectoryGeneration;
  retire(): Promise<CompilerDependencyExecutionRetirementReceipt>;
}

export interface DependencyAuthorityPaths {
  readonly compilerModulesRoot: string;
  readonly dependencyModules: string;
  readonly sharedDepsRoot: string;
}
