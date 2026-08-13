---
schema: codex-development-work-package-v1
id: default-branch-health-repair-fe96557df48f35bd7efadb8f93a6a155618cfd43-0b17edd5b9229e61cba87bb4779e36d25444f22261c7d94fc02ab4a100beaff2
tracking: none
base: fe96557df48f35bd7efadb8f93a6a155618cfd43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - development-governance
  - verification-governance
tasks:
  - id: repository-audit-exact-main-default-ref
    owner: repository-audit
    ownedPaths:
      - tests/contract/repository-audit.test.ts
  - id: durable-plan-and-control
    owner: development-governance-owner
    ownedPaths:
      - docs/work-packages/default-branch-health-repair-72588e5f3a4c6569f71144277c9ef0a9008e14bc-568912367bb193796f59f945a399ed44342a6526862f61d11e71e5d305370377.md
      - docs/work-packages/default-branch-health-repair-fe96557df48f35bd7efadb8f93a6a155618cfd43-0b17edd5b9229e61cba87bb4779e36d25444f22261c7d94fc02ab4a100beaff2.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - .agents/skills/
  - .codex/
  - .githooks/
  - .github/workflows/
  - AGENTS.md
  - bun.lock
  - docs/authority.json
  - docs/development-governance.md
  - docs/verification-governance.md
  - package.json
  - platform/
  - scripts/
  - source/
acceptance:
  - the repair binds exact live main fe96557df48f35bd7efadb8f93a6a155618cfd43 tree 168579e0e37eab1711ebce8235c9e22355eafb14 and reuses automatic MainHealth run 31663066785 job 94331782173 failure fingerprint sha256:6cc430a9bd39c3092037de003111df671751d85e732d8619029c7b4a60cac548 without rerunning the unchanged exact-main failure before a semantic delta
  - the merge and new-main readback for PR 373 are complete with one parent 72588e5f3a4c6569f71144277c9ef0a9008e14bc and candidate-tree parity; imports typecheck and documentation authority passed on exact new main while the complete-fast step produced one product failure annotation in tests/contract/repository-audit.test.ts line 706
  - the exact failure is default ref unavailable refs/remotes/origin/main inside the full repository-audit clean-census test; it is not attributed to the AppContainer behavioral repair and the physical GitHub review P2 about the observed-process direct-consumer edge remains a separately validated current-main finding rather than being silently claimed closed by this package
  - the full repository-audit test accepts SEC_CHANGED_BASE only as an exact commit that peels to itself in the source repository; otherwise it resolves source refs/remotes/origin/main to its exact commit before cloning, and when that ref is genuinely absent it accepts source HEAD only under a generic GitHub Actions exact refs/heads/main checkout tuple whose exact GITHUB_SHA equals that HEAD
  - every selected baseline is an exact Git commit identity already accepted by the repository-audit contract rather than a clone-local symbolic branch guess, synthetic remote ref or weakened unknown assertion; an invalid explicit identity, an available but invalid source default ref, a PR-shaped or ordinary no-tuple local checkout, a non-exact GitHub SHA and a mismatched GitHub main checkout all remain fail closed
  - production repository-audit parsing findings content coverage control-plane and information-lifecycle behavior remain byte-identical; only the real-repository clean-census fixture stops assuming origin/main exists in every exact-SHA checkout
  - focused verification proves the resolver validates explicit commit precedence, preserves an available source default-branch commit so candidate-only lifecycle violations remain observable, rejects symbolic explicit identities and a source ref that does not resolve to a commit, rejects no-tuple local, false GitHub Actions marker, PR-ref, missing-SHA, symbolic-SHA and mismatched-SHA no-ref contexts, and accepts source HEAD only for an exact matching GitHub Actions main checkout tuple; the tuple is baseline-selection input rather than provider authentication or hosted Evidence, the exact-SHA audit fixture proves the selected commit resolves inside the clone, missing-ref and nonexistent-SHA production negatives remain fail closed, and a post-delta real clean-census execution in the hosted no-remote-ref checkout remains unverified
  - after the focused semantic delta one candidate-tree test-fast calibration may discover the fail-fast remainder hidden by the exact hosted failure; every actually observed later blocker is classified by owner and an out-of-scope blocker causes a new authority decision rather than expanding this frozen one-test implementation scope
  - unchanged hosted MainHealth and local complete-fast failures are never rerun without a causal delta; final verification is RequiredClosure intersect MissingOrStale and does not mechanically invoke full release nightly or unrelated slow inventories
  - the production repair renderer consumes only the fresh content-addressed MainHealthRepairDecision retires the byte-identical published active projection and preserves unresolved ordinary candidates byte-for-byte and in order without ordinary WorkDecision or manual pointer staging
  - one logical repair run uses this one short-path mutable worktree and one candidate ref; the previous registered target ref and worktree path are absent while its Windows Directory-not-empty residue is explicitly retained outside the worktree registry at .tmp/closeout-residue/mh72588e5-0663354980b3-directory-not-empty for the canonical physical-closeout owner
  - this repair tracks no Issue closes or reopens no Issue and does not alter WorkDecision ordering; after healthy new-main readback the canonical selector and closeout state decide the next package
  - exact-head independent Review must reconcile the hosted failure tail the physical review P2 exclusion from this scope the manifest and pointer digests the single test delta and every retained negative assertion before integration
  - integration requires exact-head independent Review one exact candidate merge candidate-tree parity remote-main pointer readback successful automatic MainHealth and local-main readiness before the repair is reported complete
tests:
  - tests/contract/repository-audit.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/documentation-authority.test.ts
---

# Repository audit exact-main default-ref repair

The automatic MainHealth run for `main@fe96557df48f35bd7efadb8f93a6a155618cfd43`
completed imports, TypeScript and documentation authority before the fast inventory reached the full
repository-audit clean-census test. That fixture clones the current repository and asks the production
audit to compare the clone with `refs/remotes/origin/main` unless `SEC_CHANGED_BASE` is present. An
exact-SHA GitHub Actions checkout does not promise that remote-tracking ref, so the fixture reported an
unknown even though the exact pushed commit and tree were already available.

This repair keeps production audit semantics unchanged. The real-repository fixture accepts the
trusted PR base supplied by `SEC_CHANGED_BASE` only after exact source-commit validation. Without that
context it resolves the source repository's `refs/remotes/origin/main` to an immutable commit before
cloning, so a clone-local remote ref cannot collapse a candidate audit to `HEAD..HEAD`. If that source
ref is absent, only a GitHub Actions-shaped checkout tuple with `GITHUB_ACTIONS=true`,
`GITHUB_REF=refs/heads/main`, and an exact `GITHUB_SHA` matching source `HEAD` can supply the baseline;
ordinary no-tuple local and PR-ref candidates fail closed. This ambient tuple selects an immutable Git
comparison baseline only: it is not Provider authentication, hosted Evidence or integration authority,
and the resolver intentionally does not copy any repository workflow event, action or job policy.
Existing exact-SHA, missing-ref and nonexistent-SHA audit cases retain their positive and fail-closed
coverage. No workflow, provider, selector, runner, production audit or trust-root implementation is
changed.

The GitHub review finding that `observed-process-lifecycle` omits the new AppContainer direct consumer
is valid but does not cause this MainHealth failure and would require a different test-impact/TCB owner
closure. It is recorded as unresolved rather than folded into this narrow repair. After this repair
restores a healthy main, the canonical control plane must route that finding and the larger performance
work through their existing owners instead of silently expanding this package.
