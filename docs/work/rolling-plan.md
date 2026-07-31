---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-07-30
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@ea41e264f5448f2005dd141514bcd6f7e546c1cd`、已合并 PR #196（active documentation corpus）、PR #199（test runtime performance）、PR #200（parallel work package contract）、PR #201（CI speed optimization）、PR #202（dev-loop-speed-v1）、PR #203（dev-loop-speed-v2）、PR #204（verification-result-core-v1）、PR #210（ci-verification-flow-fix-v1）、PR #211（verification-result-claim-migration-v1）、已关闭 Issue #173、开放 Issues #167/#175–#194/#205–#212、Review/CI 与 exact tree 重新计算。

Active documentation corpus、test runtime performance、parallel work package contract、CI speed optimization、dev-loop-speed-v1、dev-loop-speed-v2、verification-result-core-v1、ci-verification-flow-fix-v1 与 verification-result-claim-migration-v1 已进入 `main`：`docs/authority.json` 机器化拥有 active document identity、lifecycle、domain、ownership、projection、consumer 与 update trigger；CI verification contract revision 为 v19；template lock 不再串行化并发 clone；`.shared-deps/` 不再泄漏 `bun.lock`；CI 缓存、merge bootstrap CLI 与 gate API 已优化；check:fast gate 并行化、docs:doctor 增量模式、preload marker 门控、动态并发与 bounded-parallel 队列已落地；冷启动 stamp 短路、测试基础设施硬链接克隆与跨进程 test-impact 缓存、编译器管线共享 ts-morph Project 与并行 I/O、affected-tests reverse-import-map 已落地；sec-merge-bootstrap squash 已修复 single-parent invariant；统一验证结果模型 5 态/3 disposition/4 applicability/17 reasonCode/claim-based aggregate 已建立；CI PR validation 冗余 `git fetch` 已移除；`commandAll` 自动 squash 在 attestation/verification dispatch 之前执行；产品 verification summary 已迁移至 claim-based aggregation，`skipped` 不再静默产生 `passed`。

当前 `exact-default-base-identity-v1`（Issue #212）待激活：修复 shallow CI 中 `refs/remotes/origin/main` 缺失导致 repository audit 报 `default ref unavailable` 阻断所有后续 hosted verification 的根因。建立 Repository Audit Default-Base Identity Contract：hosted 使用 trusted exact base SHA，local 使用 live remote ref，不恢复无凭据 fetch。

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

### canonical-text-bytes-phase-a-v1

- 根治 CRLF/LF 工作树物化漂移 Phase A；base `main@80b7fb9`；建立 Canonical Text Byte Contract 与 Line-Ending Environment settlement：`.gitattributes` 唯一 policy、`.editorconfig` + prettier LF 投影、text-byte-census 工具、worktree-settlement 非破坏性 preflight、一次性 renormalize 迁移。
- 工程目标：闭合 attributes、editor/formatter、census、preflight 整个因果链；Git blob identity 与工作树物化解耦；环境未 settled 时 fail-closed，不靠"先 organize 再 retry"。
- 退出：`.gitattributes` 覆盖所有 SEC 自有文本分类；census 工具检测 CRLF/mixed/BOM/NUL/unknown 并 fail-closed；settlement preflight 输出 receipt 且不破坏 dirty 工作树；迁移语义 diff 为零；`docs:doctor` 0 error；`test:fast` 全绿；hosted verification 真实通过（非 trust-root PR）。

## 已完成 Work Package

### work-readme-conditional-state-clarification-v1 (PR #214)

- 已合并至 `main@80b7fb9`；manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：归档 `exact-default-base-identity-v1` manifest，激活新 pointer，并在 `docs/work/README.md` 中明确 conditional manifest state 与 trusted exact base 语义；首个 hosted verification 真实通过（quick profile SUCCESS），证明 PR #213 trust-root 修复生效。

### exact-default-base-identity-v1 (PR #213)

- 已合并至 `main@28b62b7`；manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：Issue #212 — 为 repository audit 建立显式 `--default-ref <exact-commit-or-ref>` 输入合同；hosted 路径传入 trusted exact base SHA（复用 `SEC_CHANGED_BASE`）；local 路径使用 live `refs/remotes/origin/main`；不恢复无凭据 fetch；`persist-credentials: false` 不变；6 个回归测试覆盖所有关键场景。

### verification-result-claim-migration-v1 (PR #211)

- 已合并至 `main@c38d249`；manifest 保留在 `docs/work-packages/` 直到下一个 Work Package 接管 pointer 后归档。
- 工程结果：Issue #176 Slice 2 — 将产品 verification summary 迁移至 `CodexDevelopmentAggregateVerificationClaimsV1` claim-based aggregation；`summarizeReport` 不再允许 `skipped` 静默产生 `passed`；policy `skipped` 显式 `not-applicable`；service-mode `passed` 映射为 `not-run` + `current-runner-not-owning-environment`；`writeBlockedVerificationSnapshot` 发出 not-run claims；11 个回归测试覆盖所有关键场景。

### ci-verification-flow-fix-v1 (PR #210)

- 已合并至 `main@c13a229`；manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：移除 `compiler-pr-validation.yml` 冗余 `git fetch` 步骤（与 `persist-credentials: false` 冲突导致自 PR #200 起所有 hosted 验证失败）；重排 `sec-merge-bootstrap.ts commandAll` 使 `ensureSingleParent` 在 attestation/verification dispatch 之前执行（消除手动 squash workaround）；`persist-credentials: false` 安全不变量不变；ordering 不变量有测试守护。

### verification-result-core-v1 (PR #204)

- 已合并至 `main@46f92e4`；manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：Issue #176 Slice 1 建立 5 态统一验证结果模型（passed/failed/not-run/unsupported/invalidated）、3 disposition（executed/reused/not-executed）、4 applicability、17 reasonCode、`VerificationGateResultV1` schema、claim-based 6 步 aggregate 算法、legacy mapping helpers（product/CI V2/semantic-mutation/evidence-disposition → 统一模型，lossy 暴露为 unresolved/invalidated）；10 个回归场景覆盖；同时修复 main 分支 documentation-authority 与 testkit-workspace-cleanup 测试 drift。

### dev-loop-speed-v2 (PR #203)

- 已合并至 `main@abc277e`；manifest 保留在 `docs/work-packages/` 直到下一个 Work Package 接管 pointer 后归档。
- 工程结果：5 个 Slice 系统性消除剩余高影响瓶颈——冷启动消除（stamp 短路、移除 reenter、git 调用合并、inline ConfigCache for TCB compliance）；测试基础设施加固（硬链接克隆、指数退避清理、preload 移除扫描、test-impact 跨进程缓存）；编译器管线并行化（共享 ts-morph Project、manifestCache 激活、Promise.all 并行 I/O、prettier config 单次解析）；check:fast 阶段并行化（docs:doctor || typecheck、per-namespace lease）；affected-tests 优化（reverse-import-map、复用 selection）。同时修复 sec-merge-bootstrap squash 的 single-parent invariant bug（`git commit --amend` → `git commit -F`，parent === base）。

### dev-loop-speed-v1 (PR #202)

- 已合并至 `main@7b46604`；manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：动态并发（os.availableParallelism）；resource-class-aware bounded-parallel 队列替代串行 exclusive；check:fast gate 并行化（imports:prepare || docs:doctor → typecheck → test:fast）；docs:doctor 增量模式（--since git-ref）；tsc cache key 改为内容 hash；architecture-tools 改用 ubuntu runner；preload stale cleanup marker-file 门控。

### ci-speed-optimization-v1 (PR #201)

- 已合并至 `main@7589886`；manifest blob 已在 default branch 上，pointer 返回 `none`；manifest 保留在 `docs/work-packages/` 直到下一个 Work Package 接管 pointer 后归档。
- 工程结果：为所有 CI 工作流添加 bun install cache 和 tsc incremental build info cache；为 merge-gate push 触发器添加 paths filter；创建 sec-merge-bootstrap.ts CLI 工具自动化合并流程；优化 merge-gate API 调用去重；同步 ci-contract.ts STEP_ORDER 常量；修复 rolling-plan.md 的 PR #199 replay provenance regression。

### parallel-work-package-contract-v1 (PR #200)

- 已合并至 `main@e2c079c`；manifest 已归档至 `docs/archive/work-packages/`。
- 工程结果：为 Work Package manifest 创建 V3 schema（codex-development-work-package-v3）parser/types/validator，包含 authority reads/writes、owned/permitted/forbidden paths、global exclusive resources、shared read-only resources、requires/orderedAfter/conflictsWith；实现 pairwise conflict resolver（7 步冲突算法）和 global exclusive resource registry（8 类全局单 writer）；V1/V2 输入返回 unresolved；默认仍单包。

### test-runtime-performance-v1 (PR #199)

- 已合并至 `main@e857ca5`；manifest 保留在 `docs/work-packages/` 直到下一个 Work Package 接管 pointer 后归档。
- 工程结果：移除 `cloneWorkspaceTemplate` 中冗余的 template creation lock；`afterAll` 清理从串行改为 bounded-concurrency 并行；修复 `.shared-deps/` 的 `bun install` 创建 `bun.lock` 的合同违反。

### active-documentation-corpus-v1 (PR #196)

- 已合并至 `main@95baca1`；Issue #173 已关闭；manifest 已归档至 `docs/archive/work-packages/`。

## 候选 Work Package

### 1. hermetic-test-runtime-phase-a

- 工程结果：fixture/resource 分类、workspace/port/process/browser/environment allocation、cleanup/readback receipt 与 Windows/Unix physical owner。
- 依赖：active documentation corpus 已进入 main；portable lease 已满足；与其他包并行需 parallel contract 进入 main。
- 退出：identity-bound/control-state不普通复制，失败/取消后无隐式进程或下一轮残留。

### 2. worktree-hygiene-v1

- 工程结果：Git registry、物理目录、dirty/untracked/ignored、Windows reparse 与最终 receipt 的唯一 cleanup owner。
- 依赖：active documentation corpus 后的 development-governance authority。
- 退出：Git注销但物理残留不再被误报为完成；无法证明安全删除时fail closed。

### 3. dependency-boundary-first-cleanup-v1

- 工程结果：建立Core/Host/Toolchain/Provider/Target依赖边界，删除已证明无用的小依赖；`package.json`与`bun.lock`保持唯一writer。
- 依赖：Runtime/Library物理Census与Dependency Census提供证据；与其他正式包并行需 parallel contract 进入 main。
- 退出：根公共加载图和发布面更小，Node-only/Bun-only/Browser/External依赖有明确Provider归属，不把未知依赖猜测删除。

## 并行 Spike

Runtime/Library physical matrix、dependency census、Impact census、Compiler Incremental Phase 0 benchmark与Hermetic/Property设计Census可继续在scratch/Issue Evidence中执行；不得修改产品分支、package/lock、docs/work或冒充正式结果。Compiler Incremental Phase 1在Phase 0 Evidence与parallel contract完成后由下一次rolling-plan重算选入。

## 重算触发

`main`、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现 supersede、parallel conflict结果或全仓审计的新决定性 finding，都会触发 live resolver 与本窗口整体重算。
