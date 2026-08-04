---
schema: codex-development-work-package-v1
id: generated-state-lifecycle-v1
tracking: issue-271
base: c9d03ba7e0143a8551aaf4792eb90cd9537bb075
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: freeze-generated-state-contract
    owner: generated-state-contract-worker
    ownedPaths:
      - platform/shared/generated-state-contract.ts
      - tests/unit/generated-state-contract.test.ts
  - id: implement-generated-state-runtime
    owner: generated-state-runtime-worker
    ownedPaths:
      - platform/dev-runner/generated-state.ts
      - platform/dev-runner/env-manager.ts
      - tests/setup/runtime-deps.setup.ts
      - tests/unit/generated-state.test.ts
  - id: integrate-generated-state-entrypoints
    owner: generated-state-integration-worker
    ownedPaths:
      - platform/dev-runner.ts
      - scripts/codex/environment-settlement.ts
      - package.json
      - platform/shared/test-impact-rules/verification.ts
  - id: advance-generated-state-control-plane
    owner: generated-state-control-plane-worker
    ownedPaths:
      - docs/work-packages/generated-state-lifecycle-v1.md
      - docs/work-packages/branch-ref-lifecycle-v1.md
      - docs/archive/work-packages/branch-ref-lifecycle-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/development-governance.md
forbiddenPaths:
  - bun.lock
  - bunfig.toml
  - tsconfig.json
  - .github/
  - .agents/
  - AGENTS.md
  - README.md
  - docs/authority.json
  - docs/product.md
  - docs/system-architecture.md
  - docs/roadmap.md
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
  - platform/compiler/
  - platform/orchestrator/
  - platform/registry/
  - tests/e2e/
acceptance:
  - "One closed generated-state registry classifies compiler dependency state, affected-test cache, TypeScript incremental state, dependency-install staging, test templates/runs, Playwright transform cache, bounded diagnostics, misplaced recovery, cleanup transactions and unknown paths; unknown, recovery and identity-bound control state fail closed."
  - "Every namespaced test process publishes sec-generated-state-owner-v1 before creating fixtures; active and cross-host owners are protected, provably dead owners are automatically reclaimed regardless of directory count, and legacy unowned directories require the explicit safe profile after the compatibility grace window."
  - "Cleanup uses a physical generated root, strict containment, target-root symlink rejection, no-follow descendant traversal, exact root identity plus descendant physical-snapshot revalidation, same-filesystem quarantine, bounded Windows retry and ENOENT readback; interrupted typed transactions are recovered only when quarantine identity and snapshot still match, without touching an original path that was not quarantined."
  - "sec-generated-state-inventory-v1 and sec-generated-state-cleanup-receipt-v1 bind registry revision, path/class/status/owner facts, before/after inventory digests and blocker sets, selected/protected paths, attempts, failures and completed/residue/blocked/no-op truth; cleanup errors are not swallowed."
  - "platform/dev-runner.ts exposes generated-state inspect/clean before dependency bootstrap; clean:test-workspaces is only a compatibility projection; package scripts expose audit/inspect, safe dry-run plan, safe clean, all-rebuildable clean and combined environment settlement."
  - "Environment settlement combines canonical Git materialization with ignored generated-state blockers; --fix may perform safe generated-state cleanup only after tracked worktree settlement is itself safe, while hot caches and active owned runs do not block."
  - "Focused physical tests prove active/dead/cross-host/legacy/diagnostic/dry-run/exact-namespace/cache/interrupted-recovery/descendant-race/unknown/symlink behavior, and affected-test ownership maps every new source to the exact focused tests."
  - "Canonical development governance states that ignored is neither disposable nor settled, separates cache/workspace/diagnostic/control/recovery/unknown semantics, and makes combined environment settlement the only complete local-state conclusion."
  - "This candidate is rebased directly onto post-#270 main c9d03ba7e0143a8551aaf4792eb90cd9537bb075; branch-ref-lifecycle-v1 is archived byte-identically, its active manifest is retired, and the generated-state package owns only its declared successor surface."
tests:
  - tests/unit/generated-state-contract.test.ts
  - tests/unit/generated-state.test.ts
  - tests/unit/env-manager.test.ts
  - tests/unit/test-runner.test.ts
  - tests/contract/dev-runner-contract.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/repository-audit.test.ts
  - tests/contract/document-control-plane-lifecycle.test.ts
---

# generated-state-lifecycle-v1

Issue #271：将 repository-local ignored/generated state 从“Git看不见的文件夹”收敛为一个
closed registry、owner/liveness resolution、no-follow physical cleanup、typed receipt 与联合
settlement。缓存内容与失效算法仍由各 producer 拥有；本包只拥有生命周期和删除授权。

## 顺序边界

PR #270 已进入 `main@c9d03ba7e0143a8551aaf4792eb90cd9537bb075`。本包以该新主干为 exact base，
byte-identical 归档 `branch-ref-lifecycle-v1` 并原子接管 active pointer。它是前驱的 ordered
successor，不改写前驱 frozen manifest，也不复制 branch/ref recovery owner。

## 生命周期

```text
registry
→ no-follow inventory
→ classify
→ resolve owner/liveness/terminal
→ select automatic | safe | all-rebuildable
→ freeze exact pre-state
→ same-filesystem quarantine
→ no-follow physical cleanup
→ ENOENT readback
→ typed receipt
```

## 删除边界

- `automatic`：只回收 owner 已可证明死亡的 test-run namespace。
- `safe`：再允许过期 legacy workspace 与过期 diagnostic；不删除 hot cache。
- `all-rebuildable`：再允许所有已登记 rebuildable/toolchain cache。
- active、cross-host、malformed-owner、symlink/reparse、changed-after-plan、recovery、control、unknown 永不进入普通删除集。
- `.tmp/recovery` 只能报告 `invalid-location`；durable recovery 仍由 #269/#270 位于全部 repository/worktree root 之外的 owner 负责。

## 退出

focused tests、strict typecheck、imports、docs、repository audit 与 hosted full evidence通过；
独立Review完成；合并后从新 `main` readback generated-state registry、CLI、settlement 与 lifecycle cleanup。
