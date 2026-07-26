import type { TestOwnershipDeclaration } from "../test-ownership-contract.ts";

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
  "tests/unit/workspace-write-lease.test.ts",
  "tests/contract/semantic-mutation-contract.test.ts",
  "tests/contract/semantic-mutation-source-adapter-contract.test.ts",
  "tests/contract/semantic-mutation-apply-contract.test.ts",
  "tests/integration/semantic-mutation-apply.test.ts",
  "tests/integration/semantic-mutation-recovery-lifecycle.test.ts",
  "tests/integration/semantic-mutation-windows-rollback.test.ts",
  "tests/integration/pipeline-workspace-write-lease.test.ts",
  "tests/integration/project-runtime.test.ts",
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
  "tests/integration/project-runtime.test.ts",
  "tests/unit/semantic-mutation-isolated-child-fence.test.ts",
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
    autoReferenceMode: "declared-only",
    sourceFiles: ["platform/shared/observed-process.ts"],
    fast: OBSERVED_PROCESS_LIFECYCLE_FAST_TESTS,
    slow: [],
  },
  {
    owner: "windows-appcontainer-hardening",
    identity: { kind: "architecture-owner", id: "windows-appcontainer-hardening" },
    sourceFiles: [
      "platform/shared/windows-appcontainer-native-helper-settlement.ts",
      "platform/shared/windows-appcontainer-executor.ts",
      "platform/shared/windows-appcontainer-native-helper.ts",
    ],
    fast: WINDOWS_APPCONTAINER_HARDENING_FAST_TESTS,
    slow: WINDOWS_APPCONTAINER_HARDENING_SLOW_TESTS,
  },
  {
    owner: "semantic-mutation",
    identity: { kind: "architecture-owner", id: "semantic-mutation" },
    sourceFiles: [
      "platform/compiler/verify/semantic-mutation-runner-build-child.ts",
      "platform/compiler/verify/semantic-mutation-runner-build-protocol.ts",
      "platform/compiler/verify/semantic-mutation-runner-build-settlement.ts",
    ],
    fast: SEMANTIC_MUTATION_RUNNER_BUILD_FAST_TESTS,
    slow: ["tests/e2e/verification.test.ts"],
  },
  {
    owner: "semantic-mutation",
    identity: { kind: "architecture-owner", id: "semantic-mutation" },
    autoReferenceMode: "declared-only",
    sourceFiles: [
      "platform/shared/semantic-mutation-types.ts",
      "platform/shared/semantic-mutation-transaction-types.ts",
      "platform/shared/semantic-mutation-staging-boundary.ts",
      "platform/shared/workspace-write-lease.ts",
      "platform/shared/process.ts",
      "platform/shared/project-runtime.ts",
      "platform/shared/runtime-dependency-spec.ts",
      "platform/compiler/verify/assert-isolated-staging-tree.ts",
      "platform/compiler/verify/run-semantic-mutation-isolated-child.ts",
      "platform/compiler/verify/semantic-mutation-isolated-runtime-binding.ts",
      "platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts",
      "platform/compiler/verify/semantic-mutation-isolation-capability.ts",
      "platform/compiler/verify/semantic-mutation-staging-boundary.ts",
      "platform/compiler/verify/semantic-mutation-verification-adapter.ts",
      "platform/orchestrator/index.ts",
      "platform/orchestrator/semantic-mutation-isolated-verification-runner.ts",
      "platform/orchestrator/semantic-mutation-orchestrator.ts"
    ],
    sourcePrefixes: ["platform/compiler/semantic-mutation/"],
    fast: SEMANTIC_MUTATION_FAST_TESTS,
    slow: [
      "tests/e2e/end-to-end.test.ts",
      "tests/e2e/graph.test.ts",
      "tests/e2e/local-views.test.ts",
      "tests/e2e/pipeline.test.ts",
      "tests/e2e/semantic-runtime-contract.test.ts",
      "tests/e2e/verification.test.ts",
    ],
  },
  {
    owner: "impact-propagation",
    identity: { kind: "architecture-owner", id: "impact-propagation" },
    sourceFiles: [
      "platform/shared/semantic-impact-types.ts",
      "platform/compiler/semantic-impact/propagation-rules.ts",
      "platform/compiler/semantic-impact/build-impact-propagation.ts",
    ],
    fast: IMPACT_PROPAGATION_FAST_TESTS,
    slow: [],
  },
  {
    owner: "fact-delta",
    identity: { kind: "architecture-owner", id: "fact-delta" },
    sourceFiles: [
      "platform/compiler/ir/build-fact-delta.ts",
      "platform/shared/engineering-ir/delta-types.ts",
    ],
    fast: FACT_DELTA_FAST_TESTS,
    slow: [],
  },
  {
    owner: "semantic-ir",
    identity: { kind: "architecture-owner", id: "semantic-ir" },
    sourcePrefixes: ["platform/compiler/ir/"],
    fast: SEMANTIC_IR_FAST_TESTS,
    slow: [],
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
      "platform/shared/engineering-ir-types.ts",
      "platform/shared/semantic-contract-types.ts"
    ],
    sourcePrefixes: ["platform/shared/engineering-ir/"],
    fast: SEMANTIC_IR_FAST_TESTS,
    slow: ["tests/e2e/semantic-runtime-contract.test.ts"],
  },
  {
    owner: "policy-declarations",
    identity: { kind: "architecture-owner", id: "policy-declarations" },
    sourceFiles: ["platform/compiler/parse/load-policy-declarations.ts"],
    fast: SEMANTIC_IR_FAST_TESTS,
    slow: ["tests/e2e/policy.test.ts"],
  },
  {
    owner: "semantic-projection",
    identity: { kind: "architecture-owner", id: "semantic-projection" },
    sourceFiles: ["platform/shared/semantic-view-types.ts"],
    sourcePrefixes: ["platform/compiler/projection/"],
    fast: SEMANTIC_PROJECTION_FAST_TESTS,
    slow: [],
  },
  {
    owner: "semantic-lowering",
    identity: { kind: "pass", id: "compose" },
    sourceFiles: [
      "platform/compiler/semantic-lowering.ts",
      "platform/compiler/semantic-output-paths.ts",
      "platform/compiler/semantic-plan.ts",
      "platform/compiler/state-transition-plan.ts",
      "platform/shared/semantic-generator-types.ts"
    ],
    fast: SEMANTIC_LOWERING_FAST_TESTS,
    slow: ["tests/e2e/semantic-runtime-contract.test.ts"],
  },
  {
    owner: "semantic-contract",
    identity: { kind: "architecture-owner", id: "semantic-contract" },
    sourceKinds: ["semantic-contract"],
    fast: SEMANTIC_IR_FAST_TESTS,
    slow: ["tests/e2e/semantic-runtime-contract.test.ts"]
  },
  {
    owner: "ticket-core",
    identity: { kind: "contract", id: "ticket-core" },
    sourceFiles: ["platform/registry/official/ticket.basic/contracts/ticket.yaml"],
    fast: [...new Set([
      ...SEMANTIC_IR_FAST_TESTS,
      ...SEMANTIC_PROJECTION_FAST_TESTS,
      ...SEMANTIC_LOWERING_FAST_TESTS
    ])],
    slow: ["tests/e2e/semantic-runtime-contract.test.ts"]
  },
  {
    owner: "tenant-core",
    identity: { kind: "contract", id: "tenant-core" },
    sourceFiles: ["platform/registry/official/tenant.basic-workspace/contracts/tenant.yaml"],
    fast: SEMANTIC_IR_FAST_TESTS,
    slow: ["tests/e2e/semantic-runtime-contract.test.ts"]
  },
  {
    owner: "registry-manifest",
    identity: { kind: "architecture-owner", id: "registry-manifest" },
    sourceKinds: ["manifest"],
    fast: ["tests/unit/path-containment.test.ts", "tests/integration/project-runtime.test.ts"],
    slow: ["tests/e2e/registry.test.ts"]
  },
  {
    owner: "source-model",
    identity: { kind: "architecture-owner", id: "source-model" },
    sourceKinds: ["source-model"],
    fast: SEMANTIC_IR_FAST_TESTS,
    slow: ["tests/e2e/semantic-runtime-contract.test.ts"]
  }
];
