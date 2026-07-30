---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-07-30
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@95baca1c622b8c6bd53b033ec004a5834013c88d`、已合并 PR #196（active documentation corpus）、已归档 PR #197（superseded）、已关闭 Issue #173、开放 Issues #167/#175–#194、Review/CI 与 exact tree 重新计算。

Active documentation corpus 已进入 `main`：`docs/authority.json` 机器化拥有 active document identity、lifecycle、domain、ownership、projection、consumer 与 update trigger；CI verification contract revision 为 v19；历史编号、旧合集和 superseded governance/test prose 按 latest-main bytes 归档。

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

### test-runtime-performance-v1

- 工程结果：移除 `cloneWorkspaceTemplate` 中冗余的 template creation lock，使并发 clone 真正并行；`afterAll` 清理从串行改为 bounded-concurrency 并行；修复 `.shared-deps/` 的 `bun install` 创建 `bun.lock` 的合同违反。
- 设计完整性：template lock 只保护创建（`ensureTemplate` 内 double-check + lock），不保护复制（模板创建后不可变）；shared deps install 不需要 lockfile（`package.json` 由 runtime spec 生成，版本已固定）。
- Trust boundary：candidate 修改 `tests/testkit/workspace.ts` 与 `platform/shared/project-runtime.ts`（均为 trust-root），必须由 trusted-base bootstrap、独立 exact-head Review 和 required Full Evidence 验证。
- 退出：single-parent current-main candidate；focused/typecheck/docs/audit/imports/affected、Review 与 Full Evidence 闭合；merge 后从新 `main` readback，归档本 manifest 并返回 `TASK_RESTART_REQUIRED`。

## 已完成 Work Package

### active-documentation-corpus-v1 (PR #196)

- 已合并至 `main@95baca1`；Issue #173 已关闭；manifest 已归档至 `docs/archive/work-packages/`。

## 候选 Work Package

### 1. parallel-work-package-contract-v1

- 工程结果：为 manifest 增加 authority read/write、owned/forbidden paths、global exclusive resources、requires/conflicts，并将关系确定性分类为 parallel-safe、ordered、write/resource-conflict 或 unresolved。
- 依赖：active documentation corpus 进入 main并reload authority。
- 退出：默认仍单包；只有机器证明分离的任务可并行，Integration Queue 不建立第二产品计划源。

### 2. verification-result-truth-v1

- 工程结果：`passed | failed | not-run | unsupported | invalidated` 与 execution ledger 成为唯一结果真值；空/未知 affected closure 不再返回成功。
- 依赖：active documentation corpus进入main；parallel contract未完成时保持唯一active包。
- 退出：owning platform未执行不能显示 PASS，CLI/artifact/Checks只投影同一 ledger。

### 3. hermetic-test-runtime-phase-a

- 工程结果：fixture/resource 分类、workspace/port/process/browser/environment allocation、cleanup/readback receipt 与 Windows/Unix physical owner。
- 依赖：active documentation corpus进入main；portable lease已满足；与其他包并行需parallel contract证明。
- 退出：identity-bound/control-state不普通复制，失败/取消后无隐式进程或下一轮残留。

### 4. worktree-hygiene-v1

- 工程结果：Git registry、物理目录、dirty/untracked/ignored、Windows reparse 与最终 receipt 的唯一 cleanup owner。
- 依赖：active documentation corpus后的development-governance authority。
- 退出：Git注销但物理残留不再被误报为完成；无法证明安全删除时fail closed。

### 5. dependency-boundary-first-cleanup-v1

- 工程结果：建立Core/Host/Toolchain/Provider/Target依赖边界，删除已证明无用的小依赖；`package.json`与`bun.lock`保持唯一writer。
- 依赖：Runtime/Library物理Census与Dependency Census提供证据；与其他正式包并行需parallel contract证明。
- 退出：根公共加载图和发布面更小，Node-only/Bun-only/Browser/External依赖有明确Provider归属，不把未知依赖猜测删除。

## 并行 Spike

Runtime/Library physical matrix、dependency census、Impact census、Compiler Incremental Phase 0 benchmark与Hermetic/Property设计Census可继续在scratch/Issue Evidence中执行；不得修改产品分支、package/lock、docs/work或冒充正式结果。Compiler Incremental Phase 1在Phase 0 Evidence与parallel contract完成后由下一次rolling-plan重算选入。

## 重算触发

`main`、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现 supersede、parallel conflict结果或全仓审计的新决定性 finding，都会触发 live resolver 与本窗口整体重算。
