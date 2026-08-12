---
schema: codex-development-work-package-v1
id: default-branch-health-repair-3f78965551272d7cbfec70f66927003c55521aea-7d07a88ab40ad024785d4bb5d532ef21cea018bd7d2b35eab1bbe0ac1e6679df
tracking: none
base: 3f78965551272d7cbfec70f66927003c55521aea
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - verification-governance
tasks:
  - id: merge-bootstrap-source-lock-boundary
    owner: verification-session-test-owner
    ownedPaths:
      - tests/unit/sec-merge-bootstrap.test.ts
  - id: verification-session-dynamic-consumer-closure
    owner: verification-test-impact-owner
    ownedPaths:
      - platform/shared/test-impact-rules/verification.ts
      - tests/contract/test-impact.test.ts
  - id: generated-trust-closure
    owner: trusted-verifier-tcb-owner
    ownedPaths:
      - platform/shared/tcb-closure-lock.ts
      - tests/contract/tcb-closure-lock.test.ts
  - id: durable-plan-and-control
    owner: development-governance-owner
    ownedPaths:
      - docs/work-packages/default-branch-health-repair-693000cf64941f3536340a66aa086f45f3898514-358b7c441b6ffc7020bc0b41c9016a320801b777e5519c5ee677cfebf8b128bd.md
      - docs/work-packages/default-branch-health-repair-3f78965551272d7cbfec70f66927003c55521aea-7d07a88ab40ad024785d4bb5d532ef21cea018bd7d2b35eab1bbe0ac1e6679df.md
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
  - platform/compiler/
  - scripts/
  - source/
acceptance:
  - the repair binds exact live main 3f78965551272d7cbfec70f66927003c55521aea tree 464a3bf6bbd1146491eb8ba6bb295ec49cfa5c6f and reuses automatic MainHealth run 31623147614 job 94202730726 failure fingerprint sha256:3c2b0d7c88014b9fa92b06ab94ade54291833d9d1d6bcbc461785c3cc53ebfb7 without rerunning the unchanged complete fast inventory
  - imports typecheck documentation authority and every earlier complete-fast shard passed; the failing shard passed 104 of 105 tests and exposed exactly one stale source-layout assertion in sec-merge-bootstrap
  - the production hosted merge implementation is unchanged; its unique private merge effect request head binding squash mode failure handling closing-keyword guard title rendering and marker rendering remain owned by existing VerificationSession contracts
  - sec-merge-bootstrap retains only its own legacy-entrypoint retirement and unique private merge and leased-closeout effect-boundary assertions; it does not duplicate the commit-title implementation layout already proved by verification-session-runtime
  - the source-lock observes exactly three live VerificationSession source contents and three retired merge-entrypoint path absences dynamically so every exact live or retired path identity selects sec-merge-bootstrap through its existing verification-session-branch-closeout-authority owner
  - unrelated VerificationSession and branch-closeout sources retain their prior focused closure and do not acquire sec-merge-bootstrap; no source gains a second owner and no broad complete-fast fallback is introduced
  - the selector contract proves all six positive direct-consumer edges and at least one unrelated-source non-expansion edge so both content mutation and privileged-entrypoint reintroduction select the canonical source-lock without broad fallback
  - Full and MainHealth remain selector-calibration backstops rather than edit-loop defaults; this missed relation invalidates the old selector evidence and is repaired at the unique owner edge
  - the production repair renderer consumes only the fresh content-addressed MainHealthRepairDecision retires the byte-identical published active projection and preserves all unresolved candidates byte-for-byte and in order without ordinary WorkDecision or manual pointer staging
  - one logical run retains one mutable physical worktree and one active candidate ref; the merged predecessor ref is removed by exact SHA CAS only after clean tree parity and live remote absence and the same physical worktree advances to this exact main
  - this repair tracks no Issue and closes or reopens no Issue; Issue completion remains controlled by post-main acceptance remaining-work and consumer evidence rather than PR text or repair manifests
  - the published predecessor repair manifest is deleted only after the new repair freeze while the byte-exact Issue 346 predecessor required by delayed WorkDecision handoff remains present
  - exact TCB closure is regenerated once after the final selector delta and every generated module blob and raw digest binds the frozen candidate head
  - verification reruns the previously failing sec-merge-bootstrap unit once after the causal delta then only its existing VerificationSession semantic owner test the test-impact contract and final TypeScript documentation imports and TCB mechanical closure required by changed paths; affected full release and nightly are not rerun
  - integration requires exact-head independent Review one exact candidate merge candidate-tree parity remote-main pointer readback successful automatic MainHealth and local-main readiness before branch worktree bootstrap artifact or Issue closeout is reported complete
tests:
  - tests/unit/sec-merge-bootstrap.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/tcb-closure-lock.test.ts
---

# Merge bootstrap source-lock ownership and direct-consumer repair

The automatic MainHealth run for `main@3f78965551272d7cbfec70f66927003c55521aea` proved the
hosted merge implementation and the rest of the complete fast inventory, but `sec-merge-bootstrap.test.ts`
still required an obsolete object-literal spelling for the commit title. The production path now constructs
the title before checking GitHub closing keywords and passing the exact value to the squash request; the
existing VerificationSession runtime contract already owns and proves that behavior.

This repair removes only the duplicate source-layout assertion while preserving the source-lock's unique
physical mutation boundary. Because that source-lock dynamically reads three production files and observes the
absence of three retired privileged entrypoints without static imports, their existing test-impact owner gains
six exact direct-consumer edges. Other VerificationSession sources keep their prior closure, preventing both
late MainHealth discovery and broad edit-loop expansion.
