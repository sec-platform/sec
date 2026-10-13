---
schema: codex-development-work-package-v1
id: main-source-health-repair-20261013
tracking: none
base: fa80716ab04ef697116ea9457f1ce0913e23acf5
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: restore-main-source-health-and-repair-observation
    owner: repository-maintainer
    ownedPaths:
      - ".documentation/README.md"
      - ".documentation/requirements.json"
      - ".documentation/source-manifest.json"
      - ".gitignore"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/main-health-hosted-recovery-20261013.md"
      - "config/repository/work-packages/main-source-health-repair-20261013.md"
      - "docs/维护/文档身份与重组协议.md"
      - "src/adapters/release/documentation-source.ts"
      - "src/adapters/repository/source-program-model/typescript-api-closure.ts"
      - "src/adapters/repository/source-program-model/typescript-diagnostics.ts"
      - "src/adapters/repository/source-program-model/typescript-exact-facts.ts"
      - "src/adapters/repository/source-program-model/typescript-fact-shards.ts"
      - "src/adapters/repository/source-program-model/typescript-input.ts"
      - "src/adapters/repository/source-program-model/typescript-model-assembly.ts"
      - "src/adapters/repository/source-program-model/typescript-module-graph.ts"
      - "src/adapters/repository/source-program-model/typescript-module-load-consistency.test.ts"
      - "src/adapters/repository/source-program-model/typescript-return-provenance.ts"
      - "src/adapters/repository/source-program-model/typescript-workspace.ts"
      - "src/adapters/repository/source-program-model/typescript.ts"
      - "src/adapters/repository/source-program-model/workspace-source-content.ts"
      - "src/adapters/repository/source-program-model/workspace-source-snapshot.ts"
      - "src/adapters/self-hosting/control/branch-lifecycle/branch-local-residue-closeout.ts"
      - "src/adapters/self-hosting/control/branch-lifecycle/closed-unmerged-closeout-production.ts"
      - "src/adapters/self-hosting/control/documentation/active.ts"
      - "src/adapters/self-hosting/control/main-health/work-selection-main-health.ts"
      - "src/adapters/verification/platform/ci/verification-coordination.ts"
      - "src/adapters/verification/platform/ci/verification-materialization.ts"
      - "src/adapters/verification/platform/ci/verification-runtime.ts"
      - "src/adapters/verification/platform/ci/verification.ts"
      - "tests/integration/documentation-source-capture.test.ts"
      - "tests/unit/active-documentation-contract.test.ts"
      - "tests/unit/dependency-lifecycle-identity.test.ts"
      - "tests/unit/development-critical-path.test.ts"
      - "tests/unit/local-github-actions-runner.test.ts"
      - "tests/unit/main-health-repair-contract.test.ts"
      - "tests/unit/trusted-runtime-container.test.ts"
      - "tests/unit/verification-evidence-use-contract.test.ts"
      - "tests/unit/work-selection-main-health.test.ts"
      - "tests/unit/work-selection-terminal-cardinality.test.ts"
      - "tools/documentation/build_html.py"
      - "tools/documentation/check_docs.py"
      - "tools/documentation/source_inventory.py"
      - "tools/documentation/tests/test_check_projection_modes.py"
forbiddenPaths:
  - ".github/workflows/"
  - "src/adapters/runtime-state/"
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Normalize the exact default source using its pinned original import organizer; preserve exported bindings and runtime behavior"
  - "Compare MainHealth routing and provider semantics independently of refreshed receipt timestamps, preserving complete effect binding, freshness and provenance"
  - "Prove receipt refresh stability, real provider and outcome changes, exact repair receipt binding, expiry and invalid identity refusal"
  - "Consume documentation source directly for ordinary checks and reading; generate projections at the delivery target and strictly verify sealed artifacts"
  - "Retire tracked derived projections only with their release, active-source, reading and normative consumers reconciled; preserve authored identity and boundary inputs"
  - "Preserve original main failures and local runtime blockers; the proposal conveys no Work, health, Session or automatic integration authority"
  - "Bind independent review and necessary protected checks to the frozen candidate before authorized maintainer adoption; read back exact base parent, tree and new default"
  - "Obtain the adopted main health from its original producer once; do not adopt the broader docs integration or claim native content qualification"
tests:
  - "tests/unit/work-selection-main-health.test.ts"
  - "tests/unit/main-health-contract.test.ts"
  - "tests/unit/main-health-repair-contract.test.ts"
  - "tests/unit/work-selection-terminal-cardinality.test.ts"
  - "tests/unit/active-documentation-contract.test.ts"
  - "tests/unit/documentation-source.test.ts"
  - "tests/integration/documentation-source-capture.test.ts"
---

# Restore main source health and repair observation

The original main health producer stopped at 26 import drifts. Its repair selector also mistakes a refreshed ledger receipt for a change of health or provider. Repair the source with the existing organizer and compare only the stable routing identity, while retaining the exact receipt for effect admission.

Documentation validation must not force authors to update derived snapshots. Ordinary checking and reading capture actual source; the release owner derives snapshots in its staging target and sealed readers continue to reject missing, stale or forged outputs. This adopts only that complete mechanism from the retained docs candidate.

This bounded trust-root proposal preserves the actual old-main failures and the local registration protocol and process-settlement blockers. It grants no ordinary Work or verification qualification and does not integrate the broader retained branch.
