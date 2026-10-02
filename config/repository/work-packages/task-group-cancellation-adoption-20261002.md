---
schema: codex-development-work-package-v1
id: task-group-cancellation-adoption-20261002
tracking: none
base: 122414c1c20d786be37f70cab87abba101f625b1
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: preserve-task-group-parent-cancellation
    owner: structured-task-group
    ownedPaths:
      - "src/execution/task-group.ts"
      - "tests/unit/task-group-native-cancellation.test.ts"
      - "config/repository/active-work-package.md"
      - "config/repository/rolling-plan.md"
      - "config/repository/work-packages/maintenance-association-diagnostic-adoption-20261002.md"
      - "config/repository/work-packages/task-group-cancellation-adoption-20261002.md"
forbiddenPaths:
  - ".github/"
  - "crates/"
  - "package.json"
  - "bun.lock"
acceptance:
  - "Preserve both independently reviewed published postimages from b35356eef130f3ac843eb04e7bacf51c4ec9b665"
  - "Keep native parent cancellation primary when it precedes an independently failing draining callback, while retaining every cleanup failure and arbitrary payload identity"
  - "Stop new queue admission, join all started work and report secondary failures in input order; preserve task-first failure precedence"
  - "Do not duplicate a cancellation payload already echoed by a task; preserve original native signal, public APIs, callbacks, resource owners and successful results"
  - "Adopt only the causal task-group owner and its direct regression; ordinary mutation, lease-monitor and compilation-receiver slices remain separate obligations"
  - "Reuse exact source and focused evidence within original scope; no ordinary Gate, physical cancellation, full inspection or global completion claim"
  - "Use unchanged trusted-main proposal compiler, truthful PRE and exact independent integration review before protected expected-head merge/readback"
tests:
  - "tests/unit/task-group-native-cancellation.test.ts"
---

# Preserve native parent cancellation during task-group settlement

The shared runCapturedGroup owner serves both mapTaskGroup and runTaskGroup. This bounded repair retains the existing parent primary across independent callback cleanup failures while preserving original admission, joining and ordering. Existing canonical failure and task contracts already require the behavior, so the docs write set is empty. Other ordinary architecture fixes are excluded and remain pending.
