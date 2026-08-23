---
schema: codex-development-work-package-v1
id: git-worktree-physical-closeout-v1
tracking: issue-186
base: 489518c3bd8b28753473e43ecb2e236452dee0b9
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
authorityRefs:
  - architecture
  - development-governance
  - verification-governance
tasks:
  - id: worktree-closeout-semantic-owner
    owner: git-worktree-physical-closeout-owner
    ownedPaths:
      - scripts/codex/worktree-physical-closeout-contract.ts
      - scripts/codex/worktree-physical-closeout.ts
      - platform/shared/physical-no-follow.ts
      - platform/shared/workspace-write-lease.ts
      - platform/shared/worktree-settlement-contract.ts
      - tests/unit/worktree-physical-closeout-contract.test.ts
      - tests/unit/worktree-physical-closeout-crash-fixture.ts
      - tests/unit/worktree-physical-closeout-crash-recovery.test.ts
      - tests/unit/worktree-physical-closeout-temp-repo.test.ts
      - tests/contract/worktree-settlement.test.ts
  - id: branch-closeout-consumer
    owner: branch-lifecycle-consumer-owner
    ownedPaths:
      - scripts/codex/branch-closeout-contract.ts
      - scripts/codex/branch-closeout.ts
      - scripts/codex/branch-lifecycle-types.ts
      - tests/unit/branch-lifecycle-contract.test.ts
      - tests/unit/branch-closeout-receipt.test.ts
  - id: generated-state-retirement-handoff
    owner: generated-state-lifecycle-consumer-owner
    ownedPaths:
      - platform/shared/generated-state-contract.ts
      - platform/shared/generated-state-registry.json
      - tests/unit/generated-state-contract.test.ts
  - id: worktree-closeout-control-projection
    owner: development-governance-owner
    ownedPaths:
      - docs/development-governance.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/generated-ignored-state-lifecycle-v1.md
      - docs/work-packages/git-worktree-physical-closeout-v1.md
      - platform/shared/test-impact-rules/verification.ts
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/tcb-trust-root-contract.ts
      - platform/shared/ci-trust-root-registry.json
forbiddenPaths:
  - .agents/
  - AGENTS.md
  - bun.lock
  - bunfig.toml
  - docs/authority.json
  - docs/product.md
  - docs/roadmap.md
  - docs/system-architecture.md
  - package.json
  - platform/compiler/
  - platform/orchestrator/
  - platform/registry/
  - public-docs/
  - source/
acceptance:
  - one Git worktree physical closeout owner binds exact repository common-dir, registered target physical identity, branch, head, tree and recovery authority before any unregister or cleanup Effect
  - current/default, dirty tracked or index, ordinary untracked, unknown ignored, locked, bare, replaced, reparse, mismatched and unclassified worktrees fail closed; ignored status, path name, age and size never manufacture deletion authority
  - durable authorization is outside the target before registry mutation, and registry absence plus physical presence remains an authorized resumable residue rather than an unknown orphan or false completion
  - registry unregister, bounded no-follow physical settlement and exact registry plus physical readback form one monotonic receipt chain; a command exit code, raw receipt, caller digest or observed absence cannot mint completion authority
  - generated-state retirement is consumed through the issue 271 receipt boundary; issue 186 neither reclassifies ignored children nor creates a second generic cleanup owner
  - branch and ref lifecycle consumes exactly one privately issued completed worktree token for the prepared repository, target, branch, head, tree and recovery authority before remote or local ref CAS; residue and foreign-host observation remain blocked
  - repeated completed execution is idempotent, crash after unregister is resumable from durable authority, replacement and recovery mismatch remain blocked, and bounded cleanup never traverses a descendant reparse target
  - Windows and POSIX physical providers both prove real registered worktree registry absence, physical absence, recovery durability and external reparse-target survival using the same semantic contract
  - only focused contract, failure-injection, physical and consumer tests exist for this slice; unrelated business, browser and full-suite tests are not selected
  - verification executes RequiredClosure intersect MissingOrStale for the frozen exact tree and reuses unchanged exact ActionKey evidence; it never reruns merely because main or the session name changed
  - no second worktree cleanup script, state machine, path heuristic or branch-prefix authority remains, and completion is followed by independent exact-head review, merge, new-main readback and branch/worktree closeout through the same owners
  - the selected projection retires the completed predecessor manifest so stale scope cannot remain as a second active execution authority
tests:
  - tests/unit/worktree-physical-closeout-contract.test.ts
  - tests/unit/worktree-physical-closeout-crash-recovery.test.ts
  - tests/unit/worktree-physical-closeout-temp-repo.test.ts
  - tests/unit/branch-lifecycle-contract.test.ts
  - tests/contract/worktree-settlement.test.ts
---

# Git Worktree Physical Closeout V1

本包完成 Issue #186 已在 `main` 上形成的纵向闭包，不重造 Git、文件系统或通用清理器。唯一语义是把一个已注册 Git worktree 从 exact 物理身份和 durable recovery authority，经过 registry unregister、受界 no-follow settlement 与双重 readback，推进为可由 #313 消费的 completed token。

```text
exact registered worktree + recovery authority
  -> classify and bind physical identity
  -> durable external authorization
  -> registry unregister
  -> bounded no-follow settlement or resumable residue
  -> registry absent + physical absent readback
  -> privately issued completed token
  -> #313 branch/ref CAS
```

内容寻址只用于稳定 identity、authorization、receipt generation 与 Evidence 复用；它不把可变 Git registry 或物理目录伪装成 immutable code artifact。外部可变事实必须按 provider identity/revision 重观测，Effect 必须持有 owner-issued capability，完成必须由真实 readback 而不是自摘要声明。

本包不拥有 branch/ref disposition、generated-state 分类、测试资源、Provider cache 或全局 Engineering Semantic Graph。它只通过稳定 typed boundary 消费 #271 的退休结果并向 #313 发行唯一 worktree terminal；全局对象层和跨域组合仍由 `docs/system-architecture.md` 的 canonical architecture owner 统一。
