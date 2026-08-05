---
schema: codex-development-work-package-v1
id: branch-ref-lifecycle-v1
tracking: issue-269
base: 44f4012502bcf836d4de808afae5de873cbc18fc
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: deterministic-branch-ref-closeout
    owner: branch-lifecycle-maintainer
    ownedPaths:
      - scripts/codex/branch-lifecycle-types.ts
      - scripts/codex/branch-lifecycle-audit.ts
      - scripts/codex/branch-closeout-contract.ts
      - scripts/codex/branch-lifecycle-contract.ts
      - scripts/codex/branch-lifecycle-command.ts
      - scripts/codex/branch-lifecycle-config.ts
      - scripts/codex/branch-lifecycle-parsers.ts
      - scripts/codex/branch-lifecycle-inventory.ts
      - scripts/codex/branch-recovery.ts
      - scripts/codex/branch-closeout.ts
      - scripts/codex/branch-lifecycle.ts
      - scripts/codex/sec-merge-bootstrap.ts
      - scripts/codex/sec-merge-bootstrap-contract.ts
      - scripts/codex/sec-merge-bootstrap-runtime.ts
      - tests/unit/branch-lifecycle-contract.test.ts
      - tests/unit/branch-lifecycle-temp-repo.test.ts
      - tests/unit/sec-merge-bootstrap.test.ts
      - docs/work-packages/branch-ref-lifecycle-v1.md
      - docs/work-packages/canonical-architecture-convergence-v1.md
      - docs/archive/work-packages/canonical-architecture-convergence-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
forbiddenPaths:
  - platform/
  - .github/
  - .agents/
  - package.json
  - bun.lock
  - bunfig.toml
  - tsconfig.json
  - AGENTS.md
  - README.md
  - docs/authority.json
  - docs/product.md
  - docs/system-architecture.md
  - docs/roadmap.md
  - docs/development-governance.md
acceptance:
  - "One typed owner inventories exact local/remote refs, every worktree binding and dirty/untracked/locked state, all PR states with same-repository identity, active Work Package resolution, GitHub delete_branch_on_merge and clone-local prune configuration; unknown facts fail closed, while configure-clone establishes and reads back the three local settings."
  - "Every non-main branch is classified as active-candidate, open-pr-candidate, merged-closeout, closed-superseded, completed-spike, protected-pending or orphan-unknown; cross-repository PRs never authorize origin refs; idle remote heads are exactly main and active mode admits only main plus the exact selected candidate."
  - "Destructive closeout is two-phase: a clean global lifecycle audit, exact pre-state and verified recovery bundle outside repository/common-dir/worktree roots are frozen before disposition; finalize re-reads bundle bytes, SHA-256 sidecar and git bundle verification; remote deletion uses expected-SHA force-with-lease CAS; local deletion uses update-ref old-SHA CAS and protects every worktree-bound, newly appeared, changed or divergent local branch."
  - "A sec-branch-closeout-receipt-v1 binds before/after inventory, recovery digest, authorization, attempts and completed/protected-pending/residue/blocked outcome; full after-inventory audit, closed local ref residue, deletion failure, SHA race, recovery tamper, unresolved API or readback cannot be reported as complete."
  - "sec-merge-bootstrap prepares recovery before exact-head merge, re-reads exact PR base/head/branch/manifest immediately before merge, removes the obsolete post-merge pointer patch and best-effort cleanup, verifies new remote main and its exact first parent, then delegates closeout to the lifecycle owner."
  - "Focused unit tests and a real temporary Git repository prove idle/active drift, same-repository PR authorization, SHA and local-ref race blocking, durable path exclusion, recovery tamper detection, exact remote deletion and preservation of a dirty user-owned worktree."
tests:
  - tests/unit/branch-lifecycle-contract.test.ts
  - tests/unit/branch-lifecycle-temp-repo.test.ts
  - tests/unit/sec-merge-bootstrap.test.ts
---

# branch-ref-lifecycle-v1

Issue #269：把 branch、ref、PR、worktree binding、恢复 authority、删除授权与最终
readback 收敛为一个 fail-closed closeout transaction。代码只拥有 Git/GitHub 生命周期；
Work Package 选择、PR merge authority 与 worktree 物理目录删除仍由原 owner 负责。

## 状态机

```text
inventory
→ classify
→ prepare exact pre-state
→ create and verify durable recovery
→ observe disposition
→ authorize
→ remote exact-SHA CAS delete
→ local exact-SHA delete | protected-pending
→ prune
→ full readback
→ typed receipt
```

## Trust-root bootstrap

本包修改 `scripts/codex/`，属于现有 frozen verifier 明确定义的 trust-root delta。
候选不得用自身新增规则授权自身；旧 epoch 的 hosted frozen verification 返回
`manual-bootstrap-required` 是预期结果，不得伪造绿色。合并前必须保留 base-side
parser/scope/TCB/focused evidence 与独立 Review；admin/manual integration 后读取新
`main`，并在新任务中重新加载新 trust epoch。

## 边界

- 不根据 ancestry、ahead/behind 或 `git branch --merged` 判断 squash merge 是否已吸收。
- 不 reset、stash、clean、覆盖或删除 dirty/untracked/locked/unknown worktree。
- GitHub auto-delete 只是外部尝试；最终状态只由 live ref readback 决定。
- recovery bundle 位于目标 repository、common-dir 或任一 worktree 下时，不得称为 durable。
- 本包不实现 Issue #186 的 worktree 目录回收，也不实现 Issue #191 的 Integration Queue。
