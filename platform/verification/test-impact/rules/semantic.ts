import type { TestOwnershipDeclaration } from "../index.ts";

const SEMANTIC_IR_FAST_TESTS = [
  "tests/unit/canonical-ir-identity-revision.test.ts",
  "tests/unit/engineering-ir.test.ts",
  "tests/unit/predicate-signatures.test.ts",
  "tests/unit/semantic-contract-ir.test.ts",
  "tests/unit/semantic-contract-responsibility.test.ts",
  "tests/unit/semantic-generator-plan.test.ts",
  "tests/unit/semantic-mutation-source-adapter.test.ts",
  "tests/unit/validated-engineering-ir.test.ts",
  "tests/unit/workspace-semantic-linker.test.ts",
  "tests/integration/semantic-contract.test.ts",
  "tests/integration/p0-2a-ir-invariants.test.ts",
  "tests/integration/semantic-projections.test.ts",
  "tests/integration/workspace-engineering-ir.test.ts",
  "tests/integration/semantic-core-vertical.test.ts",
  "tests/integration/semantic-pipeline-spine.test.ts",
];

const SEMANTIC_PROJECTION_FAST_TESTS = [
  "tests/integration/semantic-projections.test.ts",
  "tests/integration/semantic-core-vertical.test.ts",
];

const SEMANTIC_LOWERING_FAST_TESTS = [
  "tests/unit/semantic-lowering.test.ts",
  "tests/unit/semantic-generator-plan.test.ts",
  "tests/unit/semantic-provenance.test.ts",
  "tests/integration/ticket-pipeline.test.ts",
  "tests/integration/semantic-core-vertical.test.ts",
];

const FACT_DELTA_FAST_TESTS = [
  "tests/unit/fact-delta.test.ts",
  "tests/unit/fact-assertion-model.test.ts",
  "tests/unit/canonical-ir-identity-revision.test.ts",
  "tests/unit/validated-engineering-ir.test.ts",
  "tests/contract/fact-delta-contract.test.ts",
  "tests/contract/test-impact.test.ts",
  "tests/contract/contract-freeze.test.ts",
];

const IMPACT_PROPAGATION_FAST_TESTS = [
  "tests/unit/impact-propagation.test.ts",
  "tests/contract/impact-propagation-contract.test.ts",
  "tests/unit/fact-delta.test.ts",
  "tests/contract/fact-delta-contract.test.ts",
  "tests/unit/validated-engineering-ir.test.ts",
  "tests/contract/test-impact.test.ts",
  "tests/contract/contract-freeze.test.ts",
];

const SEMANTIC_MUTATION_FAST_TESTS = [
  "tests/unit/semantic-mutation.test.ts",
  "tests/unit/semantic-mutation-source-adapter.test.ts",
  "tests/unit/semantic-mutation-apply.test.ts",
  "tests/unit/semantic-mutation-verification-adapter.test.ts",
  "tests/unit/semantic-mutation-isolated-child-fence.test.ts",
  "tests/unit/semantic-mutation-runtime-materialization.test.ts",
  "tests/unit/process-output.test.ts",
  "tests/unit/workspace-write-lease.test.ts",
  "tests/contract/semantic-mutation-contract.test.ts",
  "tests/contract/semantic-mutation-source-adapter-contract.test.ts",
  "tests/contract/semantic-mutation-apply-contract.test.ts",
  "tests/integration/semantic-mutation-apply.test.ts",
  "tests/integration/semantic-mutation-recovery-lifecycle.test.ts",
  "tests/integration/semantic-mutation-windows-rollback.test.ts",
  "tests/integration/pipeline-workspace-write-lease.test.ts",
  "tests/unit/runtime-verification.test.ts",
  "tests/integration/workspace-engineering-ir.test.ts",
  "tests/integration/semantic-core-vertical.test.ts",
  "tests/integration/semantic-pipeline-spine.test.ts",
  "tests/unit/semantic-architecture-boundary.test.ts",
  "tests/unit/fact-delta.test.ts",
  "tests/contract/fact-delta-contract.test.ts",
  "tests/unit/impact-propagation.test.ts",
  "tests/contract/impact-propagation-contract.test.ts",
  "tests/unit/validated-engineering-ir.test.ts",
  "tests/contract/test-impact.test.ts",
  "tests/contract/contract-freeze.test.ts",
];

const SEMANTIC_MUTATION_RUNNER_BUILD_FAST_TESTS = [
  "tests/contract/semantic-mutation-apply-contract.test.ts",
  "tests/contract/test-impact.test.ts",
  "tests/unit/semantic-mutation-isolated-child-fence.test.ts",
];

const PROJECT_RUNTIME_AUTHORITY_FAST_TESTS = [
  "tests/contract/test-impact.test.ts",
  "tests/integration/compiler-dependency-installation.test.ts",
  "tests/unit/dependency-environment.test.ts",
  "tests/unit/runtime-verification.test.ts",
  "tests/unit/semantic-mutation-isolated-child-fence.test.ts",
];

const RUNTIME_DEPENDENCY_SPEC_FAST_TESTS = [
  "tests/contract/test-impact.test.ts",
  "tests/integration/project-base.test.ts",
  "tests/unit/runtime-dependency-spec.test.ts",
  "tests/unit/runtime-verification.test.ts",
  "tests/unit/semantic-mutation-isolated-child-fence.test.ts",
];

const PROJECT_BASE_FAST_TESTS = [
  "tests/contract/test-impact.test.ts",
  "tests/integration/project-base.test.ts",
];

const SHARED_RUNTIME_DEPENDENCY_SLOW_TESTS = [
  "tests/e2e/runtime-host.test.ts",
  "tests/integration/project-dependency-runtime.test.ts",
];

const TASK_ENVELOPE_FAST_TESTS = [
  "tests/contract/test-impact.test.ts",
  "tests/integration/repair.test.ts",
  "tests/unit/task-envelope.test.ts",
];

const WINDOWS_APPCONTAINER_HARDENING_FAST_TESTS = [
  "tests/contract/test-impact.test.ts",
  "tests/unit/ci-pr-risk-selection.test.ts",
  "tests/unit/windows-appcontainer-hardening-static.test.ts",
  "tests/unit/windows-appcontainer-executor.test.ts",
  "tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts",
];
const WINDOWS_APPCONTAINER_HARDENING_SLOW_TESTS = [
  "tests/e2e/windows-appcontainer-executor.test.ts",
];

const OBSERVED_PROCESS_LIFECYCLE_FAST_TESTS = [
  "tests/contract/semantic-mutation-apply-contract.test.ts",
  "tests/contract/test-impact.test.ts",
  "tests/unit/observed-process-lifecycle.test.ts",
  "tests/unit/semantic-mutation-isolated-child-fence.test.ts",
  "tests/unit/work-package-gate-execution.test.ts",
  "tests/unit/work-package-profile-probe-diagnostic.test.ts",
];

export const semanticTestOwnershipDeclarations: TestOwnershipDeclaration[] = [
  {
    owner: "observed-process-lifecycle",
    identity: { kind: "architecture-owner", id: "observed-process-lifecycle" },
    sourceFiles: ["platform/runtime-physical/index.ts"],
    supplementalFast: OBSERVED_PROCESS_LIFECYCLE_FAST_TESTS,
    supplementalSlow: [],
  },
  {
    owner: "windows-appcontainer-hardening",
    identity: { kind: "architecture-owner", id: "windows-appcontainer-hardening" },
    sourceFiles: [
      "platform/runtime-physical/runtime/windows-appcontainer/native-helper-settlement.ts",
      "platform/runtime-physical/runtime/windows-appcontainer/executor.ts",
      "platform/runtime-physical/runtime/windows-appcontainer/native-helper.ts",
    ],
    supplementalFast: WINDOWS_APPCONTAINER_HARDENING_FAST_TESTS,
    supplementalSlow: WINDOWS_APPCONTAINER_HARDENING_SLOW_TESTS,
  },
  {
    owner: "semantic-mutation",
    identity: { kind: "architecture-owner", id: "semantic-mutation" },
    sourceFiles: [
      "platform/compiler/verify/semantic-mutation-runner-build-child.ts",
      "platform/compiler/verify/semantic-mutation-runner-build-protocol.ts",
      "platform/compiler/verify/semantic-mutation-runner-build-settlement.ts",
    ],
    supplementalFast: SEMANTIC_MUTATION_RUNNER_BUILD_FAST_TESTS,
    supplementalSlow: ["tests/e2e/verification.test.ts"],
  },
  {
    owner: "project-runtime-authority",
    identity: { kind: "architecture-owner", id: "project-runtime-authority" },
    sourceFiles: ["platform/toolchain/dependencies/runtime/project-runtime.ts"],
    supplementalFast: PROJECT_RUNTIME_AUTHORITY_FAST_TESTS,
    supplementalSlow: SHARED_RUNTIME_DEPENDENCY_SLOW_TESTS,
  },
  {
    owner: "runtime-dependency-spec",
    identity: { kind: "architecture-owner", id: "runtime-dependency-spec" },
    sourceFiles: ["platform/toolchain/dependencies/contract/runtime-dependency-spec.ts"],
    supplementalFast: RUNTIME_DEPENDENCY_SPEC_FAST_TESTS,
    supplementalSlow: SHARED_RUNTIME_DEPENDENCY_SLOW_TESTS,
  },
  {
    owner: "project-base",
    identity: { kind: "architecture-owner", id: "project-base" },
    sourceFiles: ["platform/workspace/application/project-base.ts"],
    supplementalFast: PROJECT_BASE_FAST_TESTS,
    supplementalSlow: SHARED_RUNTIME_DEPENDENCY_SLOW_TESTS,
  },
  {
    owner: "task-envelope",
    identity: { kind: "contract", id: "task-envelope" },
    sourceFiles: [
      "platform/compiler/synthesize/build-task-envelope.ts",
      "platform/control/task/contract/envelope.ts",
    ],
    supplementalFast: TASK_ENVELOPE_FAST_TESTS,
    supplementalSlow: ["tests/e2e/repair.test.ts"],
  },
  {
    owner: "semantic-mutation",
    identity: { kind: "architecture-owner", id: "semantic-mutation" },
    sourceFiles: [
      "platform/semantic/mutation/index.ts",
      "platform/workspace/contract/local-state.ts",
      "platform/runtime-physical/index.ts",
      "platform/compiler/verify/assert-isolated-staging-tree.ts",
      "platform/compiler/verify/run-semantic-mutation-isolated-child.ts",
      "platform/compiler/verify/semantic-mutation-isolated-runtime-binding.ts",
      "platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts",
      "platform/compiler/verify/semantic-mutation-isolated-verification-evidence.ts",
      "platform/compiler/verify/semantic-mutation-isolation-capability.ts",
      "platform/compiler/verify/semantic-mutation-verification-adapter.ts",
      "platform/orchestrator/index.ts",
      "platform/orchestrator/semantic-mutation-isolated-verification-runner.ts",
      "platform/orchestrator/semantic-mutation-orchestrator.ts"
    ],
    sourcePrefixes: ["platform/compiler/semantic-mutation/", "platform/semantic/mutation/"],
    supplementalFast: SEMANTIC_MUTATION_FAST_TESTS,
    supplementalSlow: [
      "tests/e2e/end-to-end.test.ts",
      "tests/e2e/graph.test.ts",
      "tests/e2e/pipeline.test.ts",
      "tests/e2e/semantic-runtime-contract.test.ts",
      "tests/e2e/verification.test.ts",
    ],
  },
  {
    owner: "impact-propagation",
    identity: { kind: "architecture-owner", id: "impact-propagation" },
    sourceFiles: [
      "platform/semantic/impact/index.ts",
      "platform/compiler/semantic-impact/propagation-rules.ts",
      "platform/compiler/semantic-impact/build-impact-propagation.ts",
    ],
    supplementalFast: IMPACT_PROPAGATION_FAST_TESTS,
    supplementalSlow: [],
  },
  {
    owner: "fact-delta",
    identity: { kind: "architecture-owner", id: "fact-delta" },
    sourceFiles: [
      "platform/compiler/ir/build-fact-delta.ts",
      "platform/semantic/engineering-ir/contract/delta-types.ts",
    ],
    supplementalFast: FACT_DELTA_FAST_TESTS,
    supplementalSlow: [],
  },
  {
    owner: "semantic-ir",
    identity: { kind: "architecture-owner", id: "semantic-ir" },
    sourcePrefixes: ["platform/compiler/ir/"],
    supplementalFast: SEMANTIC_IR_FAST_TESTS,
    supplementalSlow: [],
  },
  {
    owner: "semantic-ir",
    identity: { kind: "pass", id: "build-ir" },
    sourceFiles: [
      "platform/compiler/semantic-linker.ts",
      "platform/compiler/semantic-frontend.ts",
      "platform/compiler/verify/validate-resolved-templates.ts",
      "platform/compiler/ir/load-workspace-engineering-ir-input.ts",
      "platform/compiler/parse/load-authoring-semantic-contracts.ts",
      "platform/compiler/parse/load-semantic-contract.ts",
      "platform/compiler/parse/validate-semantic-manifest.ts",
      "platform/orchestrator/semantic-orchestrator.ts",
      "platform/semantic/engineering-ir/index.ts",
      "platform/semantic/contracts/index.ts"
    ],
    sourcePrefixes: ["platform/semantic/engineering-ir/"],
    supplementalFast: SEMANTIC_IR_FAST_TESTS,
    supplementalSlow: ["tests/e2e/semantic-runtime-contract.test.ts"],
  },
  {
    owner: "policy-declarations",
    identity: { kind: "architecture-owner", id: "policy-declarations" },
    sourceFiles: ["platform/compiler/parse/load-policy-declarations.ts"],
    supplementalFast: SEMANTIC_IR_FAST_TESTS,
    supplementalSlow: ["tests/e2e/policy.test.ts"],
  },
  {
    owner: "semantic-projection",
    identity: { kind: "architecture-owner", id: "semantic-projection" },
    sourceFiles: ["platform/semantic/projection/index.ts"],
    sourcePrefixes: ["platform/compiler/projection/"],
    supplementalFast: SEMANTIC_PROJECTION_FAST_TESTS,
    supplementalSlow: [],
  },
  {
    owner: "semantic-lowering",
    identity: { kind: "pass", id: "compose" },
    sourceFiles: [
      "platform/compiler/semantic-lowering.ts",
      "platform/compiler/semantic-output-paths.ts",
      "platform/compiler/semantic-plan.ts",
      "platform/compiler/state-transition-plan.ts",
      "platform/semantic/generation/index.ts"
    ],
    supplementalFast: SEMANTIC_LOWERING_FAST_TESTS,
    supplementalSlow: ["tests/e2e/semantic-runtime-contract.test.ts"],
  },
  {
    owner: "semantic-contract",
    identity: { kind: "architecture-owner", id: "semantic-contract" },
    sourceKinds: ["semantic-contract"],
    supplementalFast: SEMANTIC_IR_FAST_TESTS,
    supplementalSlow: ["tests/e2e/semantic-runtime-contract.test.ts"]
  },
  {
    owner: "ticket-core",
    identity: { kind: "contract", id: "ticket-core" },
    sourceFiles: ["platform/registry/official/ticket.basic/contracts/ticket.yaml"],
    supplementalFast: [...new Set([
      ...SEMANTIC_IR_FAST_TESTS,
      ...SEMANTIC_PROJECTION_FAST_TESTS,
      ...SEMANTIC_LOWERING_FAST_TESTS
    ])],
    supplementalSlow: ["tests/e2e/semantic-runtime-contract.test.ts"]
  },
  {
    owner: "tenant-core",
    identity: { kind: "contract", id: "tenant-core" },
    sourceFiles: ["platform/registry/official/tenant.basic-workspace/contracts/tenant.yaml"],
    supplementalFast: SEMANTIC_IR_FAST_TESTS,
    supplementalSlow: ["tests/e2e/semantic-runtime-contract.test.ts"]
  },
  {
    owner: "registry-manifest",
    identity: { kind: "architecture-owner", id: "registry-manifest" },
    sourceKinds: ["manifest"],
    supplementalFast: ["tests/unit/path-containment.test.ts"],
    supplementalSlow: ["tests/e2e/registry.test.ts"]
  },
  {
    owner: "source-model",
    identity: { kind: "architecture-owner", id: "source-model" },
    sourceKinds: ["source-model"],
    supplementalFast: SEMANTIC_IR_FAST_TESTS,
    supplementalSlow: ["tests/e2e/semantic-runtime-contract.test.ts"]
  }
];
