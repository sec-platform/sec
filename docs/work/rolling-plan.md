---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-29
---

# SEC 滚动近期计划

本窗口从 live resolver 已确认的 `main@c289a44609a3502140ede55857d90109d4db744f`、已合并 PR #174、Draft PR #185、开放 Issues #167/#173/#175–#194、Review/CI 与 exact tree 重新计算。

Portable workspace lease 已进入 `main`：common writer authority 使用 Node 标准 `fs.link` 的 append-only generation ledger，shared v2 inspector 是唯一只读协议消费者；Windows native Node 24 与 WSL2/ext4 Node 22 的竞争、crash recovery 和 quiescence Evidence 已在 PR #174 exact head 闭合。该结果只解除 Node mutating host 的 lease 阻塞，不等于公共 Node CLI 已受支持。

```text
Active Documentation Corpus
→ Parallel Work Package Contract V1
→ Verification Truth / Hermetic Runtime / Worktree Hygiene / Dependency Boundary / Incremental Compiler
→ Semantic Test Impact / Failure Epoch / Trusted Bootstrap / Evidence DAG
→ Automatic Feedback / Property-Fault-Flake
→ Runtime Host / Target / Provider / Release Matrix
```

普通进度只进入 Reconciliation Delta；仅新 Work Package、真实 `reload_if` 与最终 reconciliation 更新本文件。

## 当前唯一 Work Package

### active-documentation-corpus-v1

- 工程结果：`docs/authority.json` 机器化拥有 active document identity、lifecycle、domain、ownership、projection、consumer 与 update trigger；历史编号、旧合集和 superseded governance/test prose 按 latest-main bytes 归档。
- 设计完整性：Product、System、Semantic Model、Delta/Impact、Mutation、Compiler/Target IR、Block、Brownfield、Workbench/AI、Runtime、Change、Verification、Development Governance 与 External Provider 各有唯一 owner；长期能力保留 promotion 条件，不以三行名词替代设计。
- 主干协调：吸收 #182–#187 与 #174 的产品/CI事实；不把这些实现复制进 prose，不实现 #176–#194。
- Trust boundary：candidate 修改 docs-doctor、active-documentation、Agent coverage 与 Risk selection，必须由 trusted-base bootstrap、独立 exact-head Review 和 required Full Evidence 验证。
- 退出：single-parent current-main candidate；focused/typecheck/docs/audit/imports/affected、Review 与 Full Evidence 闭合；merge 后从新 `main` readback，关闭 #173，归档本 manifest并返回 `TASK_RESTART_REQUIRED`。

## 候选 Work Package

### 1. parallel-work-package-contract-v1（#191 Phase V1）

- 工程结果：为 manifest 增加 authority read/write、owned/forbidden paths、global exclusive resources、requires/conflicts，并将关系确定性分类为 parallel-safe、ordered、write/resource-conflict 或 unresolved。
- 依赖：active documentation corpus 进入 main并reload authority。
- 退出：默认仍单包；只有机器证明分离的任务可并行，Integration Queue 不建立第二产品计划源。

### 2. verification-result-truth-v1（#176）

- 工程结果：`passed | failed | not-run | unsupported | invalidated` 与 execution ledger 成为唯一结果真值；空/未知 affected closure 不再返回成功。
- 依赖：#185 进入 main；#191 若未完成则保持唯一 active 包。
- 退出：owning platform未执行不能显示 PASS，CLI/artifact/Checks只投影同一 ledger。

### 3. hermetic-test-runtime-phase-a（#190）

- 工程结果：fixture/resource 分类、workspace/port/process/browser/environment allocation、cleanup/readback receipt 与 Windows/Unix physical owner。
- 依赖：#185 进入 main；portable lease 已满足；与其他包并行需 #191 证明。
- 退出：identity-bound/control-state不普通复制，失败/取消后无隐式进程或下一轮残留。

### 4. worktree-hygiene-v1（#186）

- 工程结果：Git registry、物理目录、dirty/untracked/ignored、Windows reparse 与最终 receipt 的唯一 cleanup owner。
- 依赖：#185 后的新 development-governance authority。
- 退出：Git 注销但物理残留不再被误报为完成；无法证明安全删除时 fail closed。

### 5. dependency-boundary-first-cleanup / compiler-incremental-phase-1（#193/#194）

- #193 首包只建立 Core/Host/Toolchain/Provider/Target依赖边界并删除已证明无用的小依赖；`package.json`/`bun.lock`保持唯一 writer。
- #194 Phase 1建立 in-memory Compiler Incremental Graph与clean/incremental byte parity，不引入持久CAS。
- 二者是否与 #176/#190/#186 并行，由 #191 对实际 write/resource set裁决。

## 并行 Spike

#192 Runtime/Library physical matrix、#193 dependency census、#188 Impact census、#194 Phase 0 benchmark与#190/#180设计Census可继续在scratch/Issue Evidence中执行；不得修改产品分支、package/lock、docs/work或冒充正式结果。

## 重算触发

`main`、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership反证、实现 supersede、#191冲突结果或全仓审计的新决定性 finding，都会触发 live resolver 与本窗口整体重算。
