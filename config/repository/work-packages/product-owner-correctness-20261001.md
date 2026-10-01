---
schema: codex-development-work-package-v1
id: product-owner-correctness-20261001
tracking: none
base: 4b469dbaa7965db76fc3f3dc4978c43457e335d4
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: enforce-existing-product-owner-boundaries
    owner: product-owner-correctness
    ownedPaths:
      - src/adapters/artifacts/provenance.ts
      - src/adapters/compilation/emit/lock-project.ts
      - src/adapters/self-hosting/control/documentation/document-control-plane.ts
      - src/adapters/targets/typescript/semantic-lowering.ts
      - src/adapters/verification/platform/artifact/runtime/authority.ts
      - src/application/lock-workspace.ts
      - src/application/pipeline-stage-lifecycle.ts
      - src/application/repair-workspace.ts
      - src/assurance/verification/project/report.ts
      - src/bootstrap/engineering/emit-orchestrator.ts
      - src/bootstrap/engineering/repair-orchestrator.ts
      - src/compiler/align/align-interfaces.ts
      - src/compiler/resolve/resolve-plan.ts
      - src/semantics/policies/declarations.ts
      - tests/e2e/policy.test.ts
      - tests/helpers/current-verification-fixture.ts
      - tests/helpers/verification-fixtures.ts
      - tests/unit/control-cli-projection.test.ts
      - tests/unit/current-verification-cutover.test.ts
      - tests/unit/policy-yaml-reuse.test.ts
      - tests/unit/repair-state-settlement.test.ts
      - tests/unit/resolve-graph-invocation.test.ts
      - tests/unit/semantic-lowering-admission.test.ts
      - src/compiler/ir/ir-fact-store.ts
      - src/compiler/ir/ir-identity.ts
      - tests/unit/fact-assertion-model.test.ts
      - src/contracts/canonical.ts
      - src/compiler/ir/ir-normalization.ts
      - tests/unit/canonical-keyed-deduplication.test.ts
      - tests/unit/reconciliation-findings.test.ts
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/q4-candidate-analysis-scope-20261001.md
      - config/repository/work-packages/product-owner-correctness-20261001.md
forbiddenPaths:
  - AGENTS.md
  - LICENSE
  - LICENSES/
  - README.md
  - bun.lock
  - package.json
  - .github/
  - docs/
  - .documentation/
acceptance:
  - "This proposal issues no active Work, Gate, health or integration authority"
  - "Lock consumes existing current all-lane Verification artifacts and publishes its owner-captured Lock; the migrated lifecycle edge delegates to that owner"
  - "Repair consumes existing profile-aware current Verification publication, preserving fast diagnostics and strict all-lane completion distinctions"
  - "Equal-byte single-link semantic output keeps bytes and metadata after existing fences; changed, missing and hardlinked targets retain their writer"
  - "Differing same-ID Policy values reject rather than silently override; equal declarations retain source reports"
  - "Automatic provider choice counts supported-stack eligible candidates while preserving explicit incompatibility, genuine ambiguity, pinned versions and install ownership"
  - "Compact GitHub diagnostic status contains fixed reason, typed HTTP status and original-message digest; bounded full diagnostic evidence remains external-untrusted"
  - "IR builder and independent raw validation reject non-finite confidence while finite endpoints and signed-zero revision behavior remain"
  - "Canonical conflicting duplicate keys reject; IR metadata preserves unique legacy wire bytes and refuses ambiguous duplicate preimages"
  - "The adopted scoped-analysis fixture uses its existing explicit candidate element type; runtime imports and all test bodies remain unchanged"
  - "Preserve separately bound focused evidence, failed and corrected outcomes; do not claim whole-issue or full physical-platform closure"
  - "Original workspace generation16 remains UNKNOWN and read-only; this independent root imports reviewed source only and copies no old control, index, journal or lease"
  - "Final publication and integration require current canonical test governance, exact source/type evidence and actual remote readback; root alone merges"
tests:
  - tests/e2e/policy.test.ts
  - tests/unit/control-cli-projection.test.ts
  - tests/unit/current-verification-cutover.test.ts
  - tests/unit/policy-yaml-reuse.test.ts
  - tests/unit/repair-state-settlement.test.ts
  - tests/unit/resolve-graph-invocation.test.ts
  - tests/unit/semantic-lowering-admission.test.ts
  - tests/unit/fact-assertion-model.test.ts
  - tests/unit/canonical-keyed-deduplication.test.ts
  - tests/unit/reconciliation-findings.test.ts
---

# Existing product owner correctness

Bounded current Verification, semantic generation, Policy, provider selection,
diagnostic projection, finite IR-confidence and keyed-collision fixes use their
existing owners. The erased fixture type repair closes an adopted consumer mismatch.
This source-only proposal does not adopt tests, close the broad issues or retire
the previous workspace operation. Rust and unrelated pending packages are excluded.
