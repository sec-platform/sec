---
schema: codex-development-work-package-v1
id: sm3-r2-bounded-runtime-gate-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: sm3-r2-terminal-carry-forward
    owner: a0
    ownedPaths:
      - platform/compiler/semantic-mutation/mutation-recovery-record.ts
      - platform/compiler/semantic-mutation/mutation-terminal-record.ts
      - tests/unit/semantic-mutation-apply.test.ts
  - id: sm3-r2-lease-carry-forward
    owner: a0
    ownedPaths:
      - platform/orchestrator/workspace-orchestrator.ts
      - platform/shared/workspace-write-lease.ts
      - tests/integration/pipeline-workspace-write-lease.test.ts
      - tests/unit/workspace-write-lease.test.ts
  - id: sm3-r2-runtime-materialization
    owner: a0
    ownedPaths:
      - platform/compiler/compose/template-engine.ts
      - platform/compiler/emit/write-local-views.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/unit/semantic-mutation-runtime-materialization.test.ts
  - id: sm3-r2-appcontainer-lifecycle
    owner: a0
    ownedPaths:
      - platform/shared/observed-process.ts
      - platform/shared/windows-appcontainer-executor.ts
      - platform/shared/windows-appcontainer-native-helper.ts
      - tests/contract/semantic-mutation-apply-contract.test.ts
      - tests/unit/windows-appcontainer-executor.test.ts
      - tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts
  - id: sm3-r2-gate-supervisor
    owner: a0
    ownedPaths:
      - scripts/run-work-package-gate.ts
      - scripts/work-package-gate-contract.ts
      - tests/unit/work-package-gate-contract.test.ts
      - tests/unit/work-package-gate-execution.test.ts
      - docs/test-feedback-and-ci-lanes.md
  - id: sm3-r2-evidence
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-r1-focused-blocker-repair-v1.md
      - docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md
      - docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json
      - docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json
      - docs/evidence/v0-4-semantic-mutation-apply-r2-risk-batch.json
forbiddenPaths:
  - .agents/skills/sec-architecture-change/SKILL.md
  - .agents/skills/sec-ci-triage/SKILL.md
  - .agents/skills/sec-pr-closeout/SKILL.md
  - .agents/skills/sec-repo-audit/SKILL.md
  - .agents/skills/sec-verification-evidence/SKILL.md
  - .agents/skills/sec-work-package-plan/SKILL.md
  - .gitignore
  - AGENTS.md
  - PLANS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/scripts/docs-doctor.ts
  - docs/work-packages/_template.md
  - package.json
  - platform/cli/
  - platform/compiler/ir/
  - platform/compiler/projection/
  - platform/compiler/semantic-impact/
  - platform/compiler/workbench/
  - platform/orchestrator/pipeline-orchestrator.ts
  - platform/orchestrator/semantic-mutation-orchestrator.ts
  - platform/policies/
  - platform/registry/
  - platform/shared/ci-evidence-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/process.ts
  - platform/shared/engineering-ir/
  - platform/shared/semantic-impact-types.ts
  - platform/shared/semantic-mutation-transaction-types.ts
  - platform/shared/semantic-mutation-types.ts
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - scripts/codex/
  - source/
  - tsconfig.json
acceptance:
  - "All SM3-R1 acceptance clauses remain in force; R2 changes no canonical IR, Fact Delta, Impact, Pipeline order, public Semantic Mutation type, Verification requirement union, Registry contract, retention value, lease authority, or PR #108 context asset."
  - "The disposable isolated runtime performs zero per-file data fsync operations; durable fsync remains reserved for lease, owner, journal, backup, publish, and recovery authorities."
  - "Runtime files retain exclusive-create, source identity before/open/after, streamed source size and SHA-256, lease fences, close, no-alias, hard-link/reparse rejection, exact destination structure, and a full byte-hash manifest scan immediately before launch."
  - "The post-materialization proof compares the exact canonical directory/file set, type, size, link count, and reparse state without rereading every byte; it cannot authorize launch and the immediate pre-launch byte-hash proof remains mandatory."
  - "Runtime work uses fixed concurrency eight over canonical ordered batches; each batch waits for all settled results, reports the lowest canonical failing index, and never schedules a later batch after failure or lease loss."
  - "Every AppContainer icacls and registry host-tool call has a 120000 ms monotonic deadline, continuous lease fencing, bounded graceful/forced process-tree termination, and explicit confirmation or typed failure when the tree cannot be proven closed."
  - "AppContainer host-tool stage, timeout, lease-loss, nonzero exit, termination, primary, and cleanup evidence remains exact, path-free, SID-free, argv-free, environment-free, stdout/stderr-free, and raw-Error-free; public capability remains exactly status-only."
  - "The local Work Package gate supervisor derives the original 39-file argv only from sm3-r1-focused-blocker-repair-v1 tests[0], runs exactly one Bun child, uses a 1800000 ms combined watchdog independent of Bun's unchanged 600000 ms per-test timeout, and never splits AppContainer tests into a composable second batch."
  - "Supervisor heartbeat and final evidence bind manifest digest, HEAD/tree, pre/post worktree content digest, exact repo-relative argv digest, timeout contract, stdout/stderr byte counts and digests, primary/cleanup outcome, process-tree closure, recovery, and residue without persisting raw output, absolute paths, PIDs, SIDs, profile names, command lines, or stack traces."
  - "Shell or UI observation timeout is never a Gate result; only a complete digest-valid supervisor final evidence record can prove pass, fail, or timed-out."
  - "On timeout the supervisor proves the child tree closed before residue probing, performs at most one bounded recovery for owned durable owners, removes only owner-free namespace roots, preserves unresolved authority roots, and never starts a second ACL probe while an ACL-tool descendant is alive."
  - "The original 39-file Semantic Mutation owner batch passes with zero failures and no timeout increase; typecheck and every later delta Gate run only after that exact supervised batch passes."
tests:
  - "bun test tests/unit/semantic-mutation-runtime-materialization.test.ts tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts tests/unit/work-package-gate-contract.test.ts tests/unit/work-package-gate-execution.test.ts --timeout 180000"
  - "bun scripts/run-work-package-gate.ts --manifest docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md --selection-manifest docs/work-packages/sm3-r1-focused-blocker-repair-v1.md --selection-index 0 --watchdog-ms 1800000 --cleanup-ms 120000 --run-dir .tmp/sm3-r2-work-package-gate"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=f29ecb73ac64aaae23b7989688c4a3ca79593d43 bun run imports:check"
  - "SEC_AFFECTED_TESTS_BASE=f29ecb73ac64aaae23b7989688c4a3ca79593d43 bun run test:affected"
  - "bun run test:contract-freeze"
  - "bun run docs:doctor"
  - "git diff --check"
---

# SM3-R2 Bounded Runtime Gate V1

本包接续已停止的 `sm3-r1-focused-blocker-repair-v1`，不重写其实现或历史 stop record。R1 的唯一 combined batch 被外层 654040 ms shell timeout 截断；后续 residue 证明该批并非已静止：`sm3-` workspace 从创建到 AppContainer durable owner 发布耗时 606.89 秒，其中 isolated staging 到 owner 为 506.385 秒。该路径复制 13059 个、约 1.294 GB 的 runtime 文件，并对每个临时文件执行 data fsync，随后在 materialize 完成和 launch 前各做一次完整 byte manifest scan。第一个真实 integration test 的冻结预算只有 300 秒，因此简单放大外层 timeout 既不能令测试通过，也不能解决 host-tool 无界生命周期。

## Authority 与根因

`docs/14` 只要求 workspace lease、immutable journal、owner/recovery、backup、live publish 与 rollback authority 使用 durable write/fsync/rename。isolated runtime 是 publish 前可丢弃、可重建的 Verification staging，不是 canonical artifact；其安全证明来自 exclusive create、source identity/digest、lease fence、exact manifest 与 immediate pre-launch reread，而不是逐文件落盘持久性。R2 因此删除 runtime data-file fsync，但不删除任何 canonical durability。

`runFencedWindowsCommand()` 当前对 `icacls /grant`、`/remove:g`、`/findsid` 与 profile registry query 只轮询 lease，没有 deadline；lease 有效时 host tool 可无限等待，lease 丢失后也未证明 Windows process tree 已关闭。R2 将 bounded observed lifecycle 收敛到新的 `platform/shared/observed-process.ts`，由 AppContainer host tool 与本地 supervisor 共用；既有 verifier trust-root `platform/shared/process.ts` 保持不变，AppContainer 不再持有第二套弱化 kill 算法。

## 固定 DAG

```text
R2-0 freeze manifest and carry forward R1 state
  ↓
R2-1 disposable runtime materialization: no data fsync + canonical bounded batches
  ↓
R2-2 shared observed process lifecycle outside the existing verifier trust root
  ↓
R2-3 AppContainer host-tool deadlines and typed primary/cleanup evidence
  ↓
R2-4 persistent local Work Package gate supervisor and residue recovery
  ↓
R2-5 one deterministic fake/synthetic batch
  ↓
R2-6 concentrated static review
  ↓
R2-7 exactly one supervised original 39-file batch
  ├─ fail/timeout/unknown cleanup → final stop evidence and stop
  └─ pass → typecheck → changed-only imports → affected → Contract Freeze → docs → patch → Quick/Risk
```

R2-1 与 R2-2 可独立实现，但 R2-2、R2-3 必须串行，因为 process-tree termination 只能有一个 canonical algorithm。首次 synthetic 前的静态复审发现 `platform/shared/process.ts` 与 `scripts/codex/` 是 verifier trust root，因此 R2-2/R2-4 改用新 `platform/shared/observed-process.ts` 与 `scripts/` 根级入口；既有 trust root 保持零 diff。R2-4 只监督同一个 Bun child，不改变 test selection，不拆分结果，不进入 hosted CI trust root，也不修改 `ci-verification-v5`。

## Runtime materialization contract

计划文件已经按 `destinationRelativePath` canonical 排序。executor 以固定连续八项为 batch；batch 内并行，`Promise.allSettled` 后按原 global index 选择首个错误，只有整批成功才调度下一批。这样完成时序不进入诊断、manifest 或 capability revision。

materialize 结束时只做 exact structural proof：目录/文件集合、canonical path、type、size、link count 和 reparse state必须精确相等。唯一完整 destination byte hash 保留在 supervisor 启动前的 `assertSemanticMutationIsolatedRuntimeLaunchManifest()`；任何 materialize 后 tamper、missing、extra、hard link 或 reparse alias仍在 AppContainer side effect 前 fail closed。

## 三层 deadline

```text
host-tool deadline          120000 ms
Bun per-test timeout        600000 ms（保持不变）
combined batch watchdog    1800000 ms
heartbeat interval           15000 ms
tree termination grace        5000 ms
owned recovery/residue      120000 ms
```

外层 Codex shell 只负责启动或轮询 supervisor。观察连接结束不改变 Gate 状态；supervisor 的 digest-valid final evidence才是唯一结果 authority。timeout 后顺序固定为 child tree close → durable owner census → one bounded owned recovery → owner-free cleanup → final census。任何未证明的 tree、ACL、profile 或 owner状态都使 Gate fail closed。

## Stop rule

新的 fake/synthetic batch只验证 R2 新增 executor 合同，不执行真实 AppContainer或原 owner tests。集中静态审查无 blocker 后，原 39-file argv只能由 supervisor运行一次。若失败、timeout、evidence不完整、process tree未关闭或 recovery/residue未知，写 `v0-4-semantic-mutation-apply-r2-verification.json` 为新 stop record并立即停止；不得单测追跑、提高 timeout、拆分 batch、运行 Full/all-slow/workspace-reference chain或触发 GitHub Actions。
