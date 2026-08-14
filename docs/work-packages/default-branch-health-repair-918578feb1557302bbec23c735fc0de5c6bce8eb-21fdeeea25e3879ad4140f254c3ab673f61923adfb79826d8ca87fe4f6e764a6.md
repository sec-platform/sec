---
schema: codex-development-work-package-v1
id: default-branch-health-repair-918578feb1557302bbec23c735fc0de5c6bce8eb-21fdeeea25e3879ad4140f254c3ab673f61923adfb79826d8ca87fe4f6e764a6
tracking: none
base: 918578feb1557302bbec23c735fc0de5c6bce8eb
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - verification-governance
tasks:
  - id: exact-worktree-closeout-host-repair
    owner: development-integration-closeout-owner
    ownedPaths:
      - scripts/codex/worktree-physical-closeout.ts
      - tests/unit/worktree-physical-closeout-temp-repo.test.ts
  - id: lease-contract-and-impact-repair
    owner: verification-test-impact-owner
    ownedPaths:
      - platform/shared/test-impact-rules/verification.ts
      - tests/contract/repository-runtime.test.ts
      - tests/contract/test-impact.test.ts
  - id: generated-trust-closure
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/shared/tcb-closure-lock.ts
      - tests/contract/tcb-closure-lock.test.ts
  - id: durable-repair-control
    owner: development-governance-owner
    ownedPaths:
      - docs/work-packages/git-worktree-physical-closeout-v1.md
      - docs/work-packages/default-branch-health-repair-918578feb1557302bbec23c735fc0de5c6bce8eb-21fdeeea25e3879ad4140f254c3ab673f61923adfb79826d8ca87fe4f6e764a6.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .agents/
  - .codex/
  - .githooks/
  - .github/workflows/
  - AGENTS.md
  - bun.lock
  - docs/authority.json
  - docs/development-governance.md
  - docs/roadmap.md
  - package.json
  - platform/compiler/
  - platform/dev-runner/
  - platform/orchestrator/
  - scripts/codex/document-control-plane.ts
  - scripts/run-work-package-gate.ts
  - source/
acceptance:
  - the repair binds exact degraded main 918578feb1557302bbec23c735fc0de5c6bce8eb tree c5a3e6c366d9795e29be3e52b31871d3b3484a84 MainHealth run 31766642556 job 94663818866 ledger sha256:6fcc19c08bef7d073fe873ba78c576bc4834746ff888e46e7647ef4d42bb822f and failure fingerprint sha256:108b94e78a55084fa14ba8fda7d2cf38b308f02c5dec42735b3f8280a4d6cd1b
  - MainHealth has exactly one deterministic stale contract failure requiring workspace-write-lease V2 and no Bun-backed retained physical authority; it is not an environment transient and the unchanged failed input is not rerun before the repair delta
  - a real repository that ignores the whole .sec directory accepts Git's collapsed ignored ancestor only when a retained no-follow census proves that ancestor contains exactly the currently held workspace-write-lease namespace and no sibling
  - a foreign ignored sibling reparse unsupported entry oversized leaf absent owned namespace or changed lease-held status remains working-state-not-clean and is never admitted into physical authorization
  - lease-held cleanliness is read back after the physical authorization inventory and any digest or blocker change prevents authorization publication
  - the repository-runtime contract freezes V3 retained-identity retirement and no longer requires the superseded V2 link-ledger implementation while continuing to reject direct Bun APIs in the workspace lease owner
  - workspace-write-lease source changes select repository-runtime together with its physical retirement and isolated-writer consumers so the complete-fast contract cannot first fail only after merge again
  - the prior git-worktree-physical-closeout-v1 manifest is retired from the live source corpus and this content-addressed repair is the only active package
  - TCB closure is regenerated once after the final source delta and exact lock bytes remain current before commit and after hosted candidate execution
  - repair verification runs only the delta-selected focused closure plus typecheck imports docs TCB and exact diff; the already successful old-trusted candidate SUT is not relabeled as proof for this successor
  - independent exact-head Review and hosted old-trusted repair evidence are required before an expected-head squash merge; exact new-main MainHealth must become healthy before Issue 186 or its worktree branch can close
  - after healthy new-main readback the maintainer explicitly proves the quiescent local V2 lease ledger before retained same-parent preservation, then the V3 closeout owner must produce a trusted completed physical receipt before local branch CAS and Issue disposition
tests:
  - tests/unit/worktree-physical-closeout-temp-repo.test.ts
  - tests/unit/workspace-write-lease.test.ts
  - tests/contract/repository-runtime.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/documentation-authority.test.ts
---

# Exact worktree closeout host repair

The first real closeout attempt after `git-worktree-physical-closeout-v1`
entered main exposed two facts that the isolated fixtures did not compose.  A
repository may ignore the entire `.sec/` control directory, causing Git to
project the held lease as one collapsed `!! .sec/` record, and the complete
fast inventory still contained a source-layout contract for the retired V2
lease implementation.

This repair accepts no path string as proof.  It resolves a collapsed ignored
ancestor through the canonical retained no-follow owner and admits it only
when every physical descendant belongs to the exact held lease namespace.  It
also adds the missing complete-fast consumer to the lease test-impact owner so
the V3 contract cannot drift behind a future lease transition.

The package tracks no new Issue and does not reinterpret degraded main as
healthy.  Issue 186 remains open until this repair reaches main, MainHealth is
healthy, the real local worktree produces a trusted completed receipt, and the
branch/ref and Issue readbacks are terminal.
