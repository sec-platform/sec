---
schema: codex-development-work-package-v1
id: product-owner-correctness-20261001
tracking: none
base: 48c24108ac7c1669685790bdb1e5e13bab24783c
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: enforce-existing-product-owner-boundaries
    owner: product-owner-correctness
    ownedPaths:
      - src/adapters/artifacts/provenance.ts
      - src/adapters/compilation/emit/lock-project.ts
      - src/adapters/verification/platform/artifact/runtime/authority.ts
      - src/application/lock-workspace.ts
      - src/application/pipeline-stage-lifecycle.ts
      - src/application/repair-workspace.ts
      - src/assurance/verification/project/report.ts
      - src/bootstrap/engineering/emit-orchestrator.ts
      - src/bootstrap/engineering/repair-orchestrator.ts
      - tests/helpers/current-verification-fixture.ts
      - tests/helpers/verification-fixtures.ts
      - tests/unit/current-verification-cutover.test.ts
      - tests/unit/repair-state-settlement.test.ts
      - src/adapters/self-hosting/control/documentation/document-control-plane.ts
      - tests/unit/control-cli-projection.test.ts
      - src/adapters/targets/typescript/semantic-lowering.ts
      - tests/unit/semantic-lowering-admission.test.ts
      - src/semantics/policies/declarations.ts
      - tests/unit/policy-yaml-reuse.test.ts
      - tests/e2e/policy.test.ts
      - src/compiler/align/align-interfaces.ts
      - src/compiler/resolve/resolve-plan.ts
      - tests/unit/resolve-graph-invocation.test.ts
      - src/compiler/ir/ir-fact-store.ts
      - src/compiler/ir/ir-identity.ts
      - tests/unit/fact-assertion-model.test.ts
      - src/contracts/canonical.ts
      - src/compiler/ir/ir-normalization.ts
      - tests/unit/canonical-keyed-deduplication.test.ts
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/engineering-decision-records-20261001.md
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
  - This bounded source proposal issues no active Work, Gate, health or integration authority
  - "Lock admission consumes existing current all-lane Verification artifacts rather than mutable verify passStatus; returns the actually published owner-captured Lock"
  - "Repair consumes existing profile-aware current Verification publication and preserves fast diagnostic support; stale subjects and inconsistent artifacts cannot drive publication"
  - "Equal-byte single-link semantic output preserves physical bytes/metadata after existing semantic and retained-file fences, while changed/missing/hardlinked targets keep the existing writer"
  - "Differing same-ID policies cannot implicitly override independently accepted values; equal declarations retain all source reports"
  - "Automatic provider selection counts supported-stack eligible candidates, retaining explicit incompatibility, genuine ambiguity, pinned-version and install ownership failures"
  - "Compact GitHub control status contains fixed diagnostic code, typed HTTP status and original-message digest; full evidence remains bounded and explicitly external-untrusted; legitimate titles and locators stay unchanged"
  - "Engineering IR builder and raw validator independently reject non-finite assertion confidence while preserving finite [0,1], signed-zero values and existing revision encoding"
  - "Conflicting canonical duplicate keys reject; legacy IR metadata unique bytes and assertion identities are preserved, and ambiguous duplicate wire preimages refuse"
  - "Reuse exact focused author evidence where actual inputs are equivalent; retain failed/corrected histories and do not imply full product, issue or physical-platform qualification"
  - "Final publication requires independent exact composition review, necessary canonical test responsibility/migration, current source/type evidence, and actual remote/PR readback; root alone merges"
tests:
  - tests/unit/current-verification-cutover.test.ts
  - tests/unit/repair-state-settlement.test.ts
  - tests/unit/control-cli-projection.test.ts
  - tests/unit/semantic-lowering-admission.test.ts
  - tests/unit/policy-yaml-reuse.test.ts
  - tests/e2e/policy.test.ts
  - tests/unit/resolve-graph-invocation.test.ts
  - tests/unit/fact-assertion-model.test.ts
  - tests/unit/canonical-keyed-deduplication.test.ts
---

# Existing product owner correctness

Compose bounded current Verification, semantic generation, Policy declaration,
provider selection, diagnostic projection and finite IR-confidence corrections through their existing
owners. Original focused evidence and failure histories remain separately bound.
This package does not close the full referenced issues or authorize integration
from source review alone. Rust and held performance/freeze proposals are excluded.
