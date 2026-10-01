---
schema: codex-development-work-package-v1
id: windows-executor-observation-boundary-20261001
tracking: none
base: edcdd184af5c61a3da3b851e141efe5588e64ce3
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: separate-helper-observation-values
    owner: windows-appcontainer-executor
    ownedPaths:
      - src/adapters/runtime-state/physical/runtime/windows-appcontainer/executor.ts
      - src/adapters/runtime-state/physical/runtime/windows-appcontainer/native-helper-observation.ts
      - src/adapters/runtime-state/physical/runtime/windows-appcontainer/native-helper.ts
      - config/repository/active-work-package.md
      - config/repository/rolling-plan.md
      - config/repository/work-packages/parallel-checkpoint-guidance-20261001.md
      - config/repository/work-packages/windows-executor-observation-boundary-20261001.md
forbiddenPaths:
  - AGENTS.md
  - docs/
  - .documentation/
  - .agents/
  - .github/
  - tests/
  - package.json
  - bun.lock
  - crates/
acceptance:
  - This bounded source proposal issues no active Work, Session, Gate, health or automatic adoption authority
  - Native helper wire producers, exact helper and receipt decoders, finite execution errors, worker-message interpretation and redacted error sidecar have one value owner shared by physical executor and native helper
  - All moved declaration bodies, wire formats, failure meanings and public executor exports remain unchanged
  - Capability admission, identity fences, resource handles, worker supervision, process-tree settlement, cleanup and durable recovery remain with the original physical executor
  - Observation and protocol results cannot admit execution or claim process-tree closure
  - Reuse exact source-equivalence and focused portable evidence; preserve seven unexecuted Windows-native observations as unknown
  - No new protocol, daemon, registry, Rust changes, performance claim or full-repository Gate claim
  - Preserve exact reviewed source-only checkpoint postimages and the independent terminal-LF correspondence proof
  - Current controls and missing or stale final evidence require actual integration-owner admission and independent exact-head binding
  - Protected exact-head security eligibility, authorized expected-head merge and actual default-ref readback remain separate prerequisites
  - Retain original branch, dependency locator, source artifacts and runtime residues for separately admitted lifecycle closeout
tests:
  - tests/unit/windows-appcontainer-executor.test.ts
  - tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts
  - tests/unit/windows-appcontainer-hardening-static.test.ts
---

# Separate native helper observations from executor effects

The shared value owner preserves existing wire formats and error meaning. Physical
admission, handles, process-tree supervision, settlement and recovery stay under
the original Windows executor; an observation cannot issue execution authority.
