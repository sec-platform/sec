---
schema: codex-development-work-package-v1
id: default-branch-health-repair-3bb47145c58b19aef2b1981ac3a28d2561949f4b-01a7d6fd95bcca50355668a87c7b0eeebb0aec6a5344a4c08974bca8e82f07ae
tracking: none
base: 3bb47145c58b19aef2b1981ac3a28d2561949f4b
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - documentation-registry
  - verification-governance
tasks:
  - id: work-selection-live-fixture-stability
    owner: development-governance-owner
    ownedPaths:
      - docs/development-governance.md
      - tests/unit/work-selection-live.test.ts
  - id: main-health-repair-control
    owner: development-governance-owner
    ownedPaths:
      - docs/work-packages/default-branch-health-repair-3bb47145c58b19aef2b1981ac3a28d2561949f4b-01a7d6fd95bcca50355668a87c7b0eeebb0aec6a5344a4c08974bca8e82f07ae.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/contract/documentation-authority.test.ts
forbiddenPaths:
  - .agents/
  - .codex/
  - .github/
  - .githooks/
  - AGENTS.md
  - bun.lock
  - docs/authority.json
  - docs/roadmap.md
  - package.json
  - platform/
  - scripts/
  - source/
acceptance:
  - exact degraded main 3bb47145c58b19aef2b1981ac3a28d2561949f4b tree 721e088bfa8ea90a4f9ec4cad9798eb1e9ec4a45 MainHealth run 31845673744 job 94911493748 health revision sha256:015341cb14e6214264069935faf0b1a3827212674f93fa41a0e2f944cefc4306 ledger sha256:32c8c952ac46eb756cb6c4b27deacb87086baddc50e336a0ae09bcc673c88849 and failure fingerprint sha256:ebe771353763e62a5473ac81a02b75407c0f8264c471817e4082378ea8cd3dff are bound
  - the sole failing test no longer hard-codes the transient live WorkDecision selection; exact repository census validates the compiled current result while issue-specific prerequisite transitions use explicit synthetic completion evidence
  - the stable scenario proves issue 346 completion selects issue 352 while issue 186 remains blocked, and issue 352 completion advances selection to issue 186 without requiring a future source edit
  - every issue-specific transition test owns its complete synthetic catalog and completion registry; removing a consumed item from the live bounded roadmap cannot invalidate historical transition coverage
  - a temporary repair projection validates its retained candidates as one unique catalog-ordered subsequence and never assumes that a package already published to main remains catalog index zero
  - human-maintained documents contain semantic rules only; active pointer manifest digest rolling projection and all content identities are produced by the canonical freeze compiler and zero-write validators reject drift
  - only the focused work-selection live and documentation authority tests plus typecheck imports and diff checks run before independent exact-head Review; the unchanged failed MainHealth input is not retried
  - after exact new-main readback the existing local three-role provider produces one content-addressed healthy MainHealth run, WorkDecision advances to issue 352, and this repair worktree branch and refs close with exact physical readback
tests:
  - tests/unit/work-selection-live.test.ts
  - tests/contract/documentation-authority.test.ts
---

# Exact repository work-selection fixture repair

The exact-main health failure was caused by a live repository census test that
encoded one transient selected Issue as a permanent expectation. This repair
separates changing repository state from stable transition scenarios so the
same completion event cannot make the next healthy main fail by construction.
