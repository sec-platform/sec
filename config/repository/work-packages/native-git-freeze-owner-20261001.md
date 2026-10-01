---
schema: codex-development-work-package-v1
id: native-git-freeze-owner-20261001
tracking: none
base: 02cf10b1978e3505152f9adbb10558251963b261
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: replace-freeze-tree-planning-with-native-index-owner
    owner: host-git-read-observer
    ownedPaths:
      - src/adapters/providers/git-read/runtime/budget.ts
      - src/adapters/providers/git-read/runtime/scratch-index-generation.ts
      - src/adapters/providers/git-read/runtime/scratch-input.ts
      - src/adapters/providers/git-read/runtime/session.ts
      - src/adapters/runtime-state/physical/runtime/physical-no-follow.ts
      - src/adapters/runtime-state/physical/runtime/physical-retained-file.ts
      - src/adapters/self-hosting/control/documentation/document-control-plane.ts
      - tests/contract/document-control-plane-lifecycle.test.ts
      - tests/unit/git-scratch-budget-native.test.ts
      - tests/unit/git-index-planning.test.ts
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/audit-worker-startup-20261001.md
      - config/repository/work-packages/native-git-freeze-owner-20261001.md
forbiddenPaths:
  - AGENTS.md
  - LICENSE
  - LICENSES/
  - README.md
  - bun.lock
  - package.json
  - .github/
  - .agents/
  - docs/
  - .documentation/
  - crates/
acceptance:
  - This bounded external-maintainer proposal issues no active Work, Gate, health or integration authority
  - Replace manual mktree directory planning with native update-index and write-tree through the existing authentic Git scratch effect owner
  - Preserve the real repository PRE and immutable input while owning a disposable writable private index under retained parent custody
  - Consume the adopted retained-descriptor floor rather than copying or replacing that prerequisite implementation
  - Strip untrusted TREE and racy computation cache data and prevent hook, filter, lazy-fetch, fsmonitor, split-index and sparse-index side effects through the fixed native command domain
  - Preserve bounded validated REUC conflict-undo metadata byte-for-byte through native computation and publication rather than discarding protected recovery state
  - Validate native mode and object-type relations, the missing-gitlink exception, exact semantic NEXT and target-store materialization against original retained NEXT identities
  - Publish through the existing codec and CAS while preserving only unchanged non-racy stat caches from genuinely retained original and private timestamps
  - Complete an operation promise only after its active-operation settlement, preserving original rejection identity, non-reentrancy and close joining
  - Reuse immutable control bytes and native index routing only inside the current owner, retaining actual mutable-cut and provider fences
  - Preserve original journal recovery and successful writer-to-terminal ownership transfer under the original deadline without replenishing an unfinished operation
  - Remove superseded manual tree cache and measured quota planning consumers and implementation-only tests rather than retaining a parallel fallback implementation
  - Preserve writer128 and separate required-terminal64 root and native limits and original byte, record, deadline and cleanup constraints
  - Reuse qualified seven codec and seven native primitive obligations and final three lifecycle obligations with exact causal source and failure history
  - Report observed ordinary writer58 and59 process receipts separately from unobserved full-owner totals and any broader latency claim
  - Windows, absent-index and general performance remain unverified unless their actual required owning-platform evidence is obtained
  - No Rust, broad native typecheck reuse, new manager, credential policy, security setting, full-suite discovery or hidden Git debug option is included
  - Exact current-main composition review, required evidence and protected expected-head readback govern publication and root-owned merge
tests:
  - tests/unit/git-index-planning.test.ts
  - tests/unit/git-scratch-budget-native.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
---

# Native Git freeze owner

Use the existing native Git private-index algorithm and retain the repository's
actual publication and recovery boundaries. Keep successful computation and
terminal retirement in their original owners, remove the superseded planner,
and preserve qualified evidence instead of repeating unrelated verification.
