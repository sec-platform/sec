---
schema: codex-development-work-package-v1
id: sec086-current-main-convergence-v1
tracking: none
base: 69b321e4eeac478a5400d456a5fff92ceb37ace8
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: converge-sec086-current-main
    owner: sec086-convergence-owner
    ownedPaths:
      - .agents/
      - .documentation/
      - .github/
      - .gitignore
      - AGENTS.md
      - PROJECT_STATUS.md
      - bun.lock
      - config/
      - docs/
      - examples/
      - knip.json
      - package.json
      - src/
      - tests/
      - tools/
forbiddenPaths:
  - LICENSE
  - LICENSES/
  - README.md
acceptance:
  - the candidate is a direct child of current main and preserves the intended SEC-086 converged repository tree
  - every candidate path changed from the exact base is owned by exactly one task and no forbidden path changes
  - active Work Package and rolling proposal bind the current main generation and this manifest bytes
  - stale pre-public-main work-package identity no longer participates in current activation or rolling projection
  - documentation authority remains one-way from authored sources to projections and caches
  - source, portable runtime, documentation artifact and release-set identities remain separated and revision-bound
  - the SEC content identity profile is unkeyed BLAKE3-256 with fixed 32-byte output domain-and-schema framing and canonical-json-v1 payload encoding
  - the pinned content provider uses the explicit @awasm/noble wasm entry while ordinary synchronous identity rejects caller-bounded and provider-unbounded parallelism
  - Git SHA-1 or SHA-256 object IDs legacy SHA-256 persisted protocols and external provider digests remain distinct from SEC content identity
  - legacy identity migration requires the original preimage and rejects digest-to-digest or mixed-generation relabeling
  - no merge release workflow dispatch or default-branch mutation is claimed before exact-candidate verification and readback
tests:
  - src/adapters/repository/source-program-model/workspace-source-snapshot.test.ts
  - src/adapters/runtime-state/physical/runtime/sealed-execution-tree-generation.test.ts
  - src/adapters/self-hosting/development/import-normalization/contract.test.ts
  - src/compiler/upgrade/migration-rules.test.ts
  - src/contracts/content-digest.test.ts
  - src/contracts/content-hash-provider.test.ts
  - src/contracts/digest.test.ts
  - src/contracts/git-object-id.test.ts
  - src/contracts/identity-profile.test.ts
  - src/contracts/structured-identity.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/integration/documentation-source-capture.test.ts
  - tests/integration/migration-json.test.ts
  - tests/integration/release-set-portable.test.ts
  - tests/integration/semantic-mutation-windows-rollback.test.ts
  - tests/unit/author-candidate.test.ts
  - tests/unit/codex-work-package-contract.test.ts
  - tests/unit/content-hash-provider-boundary.test.ts
  - tests/unit/document-control-entrypoint-stability.test.ts
  - tests/unit/documentation-source.test.ts
  - tests/unit/git-object-id-boundary.test.ts
  - tests/unit/physical-no-follow-resource-boundary.test.ts
  - tests/unit/physical-no-follow.test.ts
  - tests/unit/retained-file-permissions.test.ts
  - tests/unit/retained-source-replacement.test.ts
  - tests/unit/runtime-layout.test.ts
  - tests/unit/runtime-query-scope.test.ts
  - tests/unit/semantic-artifact-identity.test.ts
  - tests/unit/semantic-mutation-artifact-boundary.test.ts
  - tests/unit/semantic-mutation-isolated-child-fence.test.ts
  - tests/unit/semantic-mutation-source-read.test.ts
  - tests/unit/semantic-mutation-staging-budget.test.ts
  - tests/unit/semantic-mutation-staging-directory.test.ts
  - tests/unit/semantic-mutation-staging-workspace.test.ts
  - tests/unit/semantic-query-input-boundary.test.ts
  - tests/unit/verification-suite-harness.test.ts
  - tests/unit/verification-suite-lifecycle.test.ts
  - tests/unit/verification-suite-loading.test.ts
  - tests/unit/verification-suite-location-snapshot.test.ts
  - tests/unit/verification-suite-process.test.ts
  - tests/unit/work-selection-live.test.ts
---

# SEC-086 current-main convergence

This package converges the already-developed SEC-086 architecture and implementation tree onto the current public main generation. It replaces stale pre-public-main control projections; it does not create a second product authority or reinterpret Git transport history as product progress.

## Reconciliation and remaining settlement

- Integration base: `69b321e4eeac478a5400d456a5fff92ceb37ace8`. The single mutable convergence workspace preserves the earlier candidate `ddf549011a5a37cf084beabe8980e12bb5a1b7ea` and adds the live architecture delta through `d1ba038fbc61c8c4cf7a81caaf19f59693ae3393`, three-way reconciled from `3f33357`; only the generated source manifest required regeneration. Cached remote-tracking refs are not a complete live-work inventory.
- Retained omitted semantics: semantic-mutation report and execution digest admission now use the existing strict digest owner without string coercion; branch-supersession review retains its four real Git/provider boundary cases; documentation capture retains duplicate-key, undeclared-namespace and stale-byte rejection; portable release retains exact-input retry identity and staging retirement.
- Old runtime bootstrap/launcher tests are superseded by the bundled runtime contract. REUSE bytes remain preserved source members, not a new license-validation claim. Historical file names alone do not justify duplicating retired tests or owners.
- Verification is selected by changed contract, not repeated full runs. Native typecheck is edit feedback; verified compiler evidence remains a distinct final check. Hosted old-layout checker failure does not become a candidate PASS. Trust-root migration, if used, follows the current-main bounded migration contract with exact-head independent review, an immutable merge disposition and parent/tree readback; it does not require an invented second human or an unrelated release.
- Pending: final exact candidate freeze, independent delta review, remote checks required by actual protection, squash-merge/readback, new-main authority rebind, and classified branch/worktree/runtime settlement. This record does not claim these effects are complete.
