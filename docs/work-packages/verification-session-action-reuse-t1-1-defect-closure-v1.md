---
schema: codex-development-work-package-v1
id: verification-session-action-reuse-t1-1-defect-closure-v1
tracking: issue-311
base: 74924c51c719cb0cfa0fa85c9ce1680854335db9
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: verification-session-action-reuse-t1-1-defect-closure
    owner: verification-control-plane-maintainer
    ownedPaths:
      - docs/work-packages/verification-session-action-reuse-t1-1-defect-closure-v1.md
      - docs/work-packages/verification-session-action-reuse-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - scripts/codex/verification-action-contract.ts
      - scripts/codex/verification-action-journal.ts
      - scripts/codex/verification-action-runner.ts
      - tests/unit/verification-action-contract.test.ts
      - tests/unit/verification-action-journal.test.ts
      - tests/unit/verification-action-runner.test.ts
      - tests/contract/documentation-authority.test.ts
forbiddenPaths:
  - .agents/
  - .github/workflows/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/authority.json
  - docs/archive/
  - docs/evidence/
  - platform/compiler/
  - platform/dev-runner/
  - platform/shared/ci-trust-root-registry.json
  - platform/shared/tcb-closure-lock.ts
  - platform/shared/tcb-trust-root-contract.ts
  - platform/shared/test-impact-rules/
  - platform/shared/ci-evidence-contract.ts
  - platform/shared/ci-evidence-reuse-contract.ts
  - platform/shared/ci-verification-plan.ts
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/sec-merge-bootstrap.ts
  - scripts/codex/sec-merge-bootstrap-runtime.ts
acceptance:
  - 'This is the ordinary-SUT T1.1 repair of the merged action-reuse kernel; it does not enter the trusted TCB and does not start the T2 trust-root migration.'
  - 'The canonical ActionKey binds a producer-owned logical working directory, execution class and exact required cheap-preflight ActionKey set in addition to the existing semantic operation digest; branch, PR, wall-clock, PID, absolute temporary paths and caller prose remain forbidden.'
  - 'The action plan contains only static topology and execution policy derived from the ActionKey; its cheap-preflight set must exactly equal the ActionKey declaration, its upstream set must exactly equal upstreamActionKeys, one ActionKey cannot appear under multiple dependency kinds, and dependency terminal state is never caller-authored or accepted from a plan payload.'
  - 'Runner runnability resolves every dependency from validated local journal machine facts; missing, queued, running, failed, unsupported, invalidated, cancelled or unknown facts block execution, and a caller cannot flip the same ActionKey from expensive to cheap.'
  - 'External concurrent callers for one execution-domain/ActionKey still join one physical flight, while a same-owner nested cycle (including awaited nested same-key execution) is rejected deterministically without deadlock or duplicate spawn.'
  - 'Journal persistence remains disposable ordinary-SUT resume/reuse optimization; schema/key/digest/transition validation and current-terminal projection remain fail-closed, with no CI Evidence, remote cache, daemon or database introduced.'
  - 'Focused identity, topology/state separation, machine-resolution, reentrancy/cycle, restart, invalidation, reuse and corruption tests pass; strict typecheck, docs doctor, repository audit, affected plan/tests, independent Review, required Gate, merge and new-main readback are required.'
  - 'T2 trusted cutover owns the trust-root migration, Review-Stable Barrier and physical merge authorization; those surfaces are explicitly outside this package.'
tests:
  - tests/unit/verification-action-contract.test.ts
  - tests/unit/verification-action-journal.test.ts
  - tests/unit/verification-action-runner.test.ts
  - tests/contract/documentation-authority.test.ts
---

# verification-session-action-reuse-t1-1-defect-closure-v1

本包从合并后的 `main@74924c51c719cb0cfa0fa85c9ce1680854335db9` 重新计算，
只收束 PR #335 action kernel 留下的 ordinary-SUT 缺陷。action kernel 尚未进入
trusted TCB，因此现在一次完成 identity、计划与 owner-reentrancy 的边界修复，避免
T2 trust-root migration 时重复付同一轮调度语义迁移成本。

## T1.1 invariants

- logical working directory 是 producer-owned、repository-relative 的 canonical identity；
  repo root 使用 `.` sentinel，绝对路径、drive-qualified/UNC 路径、trailing slash、父目录逃逸和反斜杠均拒绝；
- execution class 是 ActionKey 的语义字段，`expensive` 不再是 caller 可翻转的 plan
  boolean；expensive ActionKey 必须声明且 plan 必须精确复现其 required cheap-preflight
  ActionKey 集合，同一 ActionKey 不能通过另一个 plan 省略或替换 cheap preflight；
- plan 只表达依赖 key/kind 拓扑。runnable 判定消费 journal readback 的 machine state，
  journal 缺失或非 terminal-passed 一律 fail closed；
- process-wide live-flight join 只服务外部并发 caller。执行 owner 的 async context 发现
  同 key 或回到自身的 cycle 时返回 typed blocked outcome，不等待自己的 Promise；
- 本包仍不接管 Verification Result、CI Evidence、Test Impact、dev-runner、workflow、
  merge gate 或任何 TCB registry/lock/contract。

## 后继

T2 `verification-action-trusted-cutover-v1` 必须从新的 `main` 再冻结，消费本包的
稳定 ActionKey/plan/journal 事实；它一次性承担 trust-root migration、Review-Stable
Barrier 与 physical merge authorization，不在本包提前改写这些 authority。
