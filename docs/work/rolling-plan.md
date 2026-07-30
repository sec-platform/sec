---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-07-30
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@fe80386d2aaad41805bcf9e66936e46259e39fdf`、已合并 PR #196（active documentation corpus）与 PR #199（test runtime performance）、已归档 PR #197（superseded）、已关闭 Issue #173、开放 Issues #167/#175–#194、Review/CI 与 exact tree 重新计算。

Active documentation corpus 与 test runtime performance 已进入 `main`：`docs/authority.json` 机器化拥有 active document identity、lifecycle、domain、ownership、projection、consumer 与 update trigger；CI verification contract revision 为 v19；template lock 不再串行化并发 clone；`.shared-deps/` 不再泄漏 `bun.lock`。

```text
Active Documentation Corpus
→ Parallel Work Package Contract V1
→ Verification Truth / Hermetic Runtime / Worktree Hygiene / Dependency Boundary / Incremental Compiler
→ Semantic Test Impact / (Failure Epoch → Trusted Bootstrap → Evidence DAG)
→ Automatic Feedback / Property-Fault-Flake
→ Runtime Host / Target / Provider / Release Matrix
```

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if` 与最终 reconciliation 更新本文件。

## 当前唯一 Work Package

### parallel-work-package-contract-v1

- 已合并至 `main@e2c079c`；manifest blob 已在 default branch 上，pointer 返回 `none`；manifest 保留在 `docs/work-packages/` 直到下一个 Work Package 接管 pointer 后归档。
- 工程结果：为 Work Package manifest 创建 V3 schema（codex-development-work-package-v3）parser/types/validator，包含 authority reads/writes、owned/permitted/forbidden paths、global exclusive resources、shared read-only resources、requires/orderedAfter/conflictsWith；实现 pairwise conflict resolver（7 步冲突算法）和 global exclusive resource registry（8 类全局单 writer）；V1/V2 输入返回 unresolved；默认仍单包。

## 已完成 Work Package

### test-runtime-performance-v1 (PR #199)

- 已合并至 `main@e857ca5`；manifest 保留在 `docs/work-packages/` 直到下一个 Work Package 接管 pointer 后归档。
- 工程结果：移除 `cloneWorkspaceTemplate` 中冗余的 template creation lock；`afterAll` 清理从串行改为 bounded-concurrency 并行；修复 `.shared-deps/` 的 `bun install` 创建 `bun.lock` 的合同违反。

### active-documentation-corpus-v1 (PR #196)

- 已合并至 `main@95baca1`；Issue #173 已关闭；manifest 已归档至 `docs/archive/work-packages/`。

## 候选 Work Package

### 1. verification-result-truth-v1

- 工程结果：`passed | failed | not-run | unsupported | invalidated` 与 execution ledger 成为唯一结果真值；空/未知 affected closure 不再返回成功。
- 依赖：active documentation corpus 已进入 main；parallel contract 进入 main 后可与其他包并行。
- 退出：owning platform未执行不能显示 PASS，CLI/artifact/Checks只投影同一 ledger。

### 2. hermetic-test-runtime-phase-a

- 工程结果：fixture/resource 分类、workspace/port/process/browser/environment allocation、cleanup/readback receipt 与 Windows/Unix physical owner。
- 依赖：active documentation corpus 已进入 main；portable lease 已满足；与其他包并行需 parallel contract 进入 main。
- 退出：identity-bound/control-state不普通复制，失败/取消后无隐式进程或下一轮残留。

### 3. worktree-hygiene-v1

- 工程结果：Git registry、物理目录、dirty/untracked/ignored、Windows reparse 与最终 receipt 的唯一 cleanup owner。
- 依赖：active documentation corpus 后的 development-governance authority。
- 退出：Git注销但物理残留不再被误报为完成；无法证明安全删除时fail closed。

### 4. dependency-boundary-first-cleanup-v1

- 工程结果：建立Core/Host/Toolchain/Provider/Target依赖边界，删除已证明无用的小依赖；`package.json`与`bun.lock`保持唯一writer。
- 依赖：Runtime/Library物理Census与Dependency Census提供证据；与其他正式包并行需 parallel contract 进入 main。
- 退出：根公共加载图和发布面更小，Node-only/Bun-only/Browser/External依赖有明确Provider归属，不把未知依赖猜测删除。

## 并行 Spike

Runtime/Library physical matrix、dependency census、Impact census、Compiler Incremental Phase 0 benchmark与Hermetic/Property设计Census可继续在scratch/Issue Evidence中执行；不得修改产品分支、package/lock、docs/work或冒充正式结果。Compiler Incremental Phase 1在Phase 0 Evidence与parallel contract完成后由下一次rolling-plan重算选入。

## 重算触发

`main`、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现 supersede、parallel conflict结果或全仓审计的新决定性 finding，都会触发 live resolver 与本窗口整体重算。
