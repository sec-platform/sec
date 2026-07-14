---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-feedback-repair-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: repair-isolated-verification-feedback
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-feedback-repair-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-feedback-repair.json
      - platform/orchestrator/semantic-mutation-orchestrator.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - tests/contract/semantic-mutation-apply-contract.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - scripts/
  - platform/shared/windows-appcontainer-executor.ts
  - platform/shared/windows-appcontainer-native-helper.ts
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-verification.json
  - docs/evidence/v0-4-semantic-mutation-owned-profile-authority-verification.json
  - docs/work-packages/sm3-add-state-transition-vertical-v1.md
  - docs/work-packages/sm3-owned-profile-authority-repair-v1.md
acceptance:
  - "The consumed terminal vertical evidence remains exact and is never retried in this package: sha256:c8779b1854e2753ce266bd10be38fc9658042416364675e6836e70f8d989aea7."
  - "The predecessor owned-profile evidence and vertical manifest remain exact: sha256:dfbcc99018941c222652af91f5049b4640d49a9cdc4aa592ad36a084c5ab30dc and sha256:509380484fa35f76408d3b160581d821d396d744cdebf79873724f58399c9296."
  - "Contract source text is normalized to LF once at the loader boundary; adjacency, order, exact source tokens and all negative assertions remain unchanged."
  - "Planning proves only the materialized isolated runtime plus native Windows AppContainer platform support. It does not run the complete destructive capability sentinel on every dry plan or lease recomputation."
  - "Actual Verification still launches exactly one production Windows AppContainer child through the existing supervisor; no non-isolated fallback is added."
  - "An unavailable isolated child publishes only an allowlisted stage and existing path-free AppContainer phase/native-code/host-tool classification into the blocked evidence digest and SEMANTIC-MUTATION-010 details."
  - "No absolute path, SID, argv, environment, raw Error message, stdout, stderr or Error object crosses the isolated child boundary. The public AppContainer capability probe remains status-only."
  - "The AppContainer executor, profile cleanup, native helper, lease, journal, publish, rollback and retained R2/R3 authority are unchanged. A profile-query suspicion is not promoted to root cause without new typed evidence."
  - "Exactly one pure focused batch runs after frozen review. It launches no production AppContainer, registry query, recovery, cleanup, product vertical, old Gate or selected slow batch."
  - "A PASS authorizes only a separately frozen real add-state-transition vertical. It does not authorize typecheck, imports, affected, Contract Freeze, Quick/Risk/Full, workspace/reference, Actions, commit, push or merge."
tests:
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts --timeout 180000"
  - "git diff --check -- platform/orchestrator/semantic-mutation-orchestrator.ts platform/compiler/verify/run-semantic-mutation-isolated-child.ts tests/contract/semantic-mutation-apply-contract.test.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts docs/work-packages/sm3-isolated-verification-feedback-repair-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-feedback-repair.json"
---

# SM3 Isolated Verification Feedback Repair V1

前一真实纵切面已经证明 request、source ownership、deterministic edit、staged rebuild、Fact Delta 与 Impact 均成立；失败被压缩为 generic blocked，且两次 dry plan、apply lease 内重算和真实 Verification 重复放大完整 AppContainer lifecycle。当前包只修复这个反馈边界：planning 不再执行完整破坏性 sentinel，execution 仍保持 AppContainer 隔离；任何 execution failure 只传播现有 allowlisted typed classification。

本包不猜测或修复 profile cleanup。focused batch 只证明 EOL 合同、廉价 planning seam 和 typed redaction；成功后必须另冻一次真实纵切面，以新 evidence 决定是否需要 profile cleanup successor。
