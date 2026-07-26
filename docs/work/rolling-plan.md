---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-26
---

# SEC 滚动近期计划

本窗口从 `origin/main@470f2172dca8ff443efb854bdbc78cd888d53c87`、长期 Goal revision `sha256:555a187d…f676`、PR #143 已合并、PR #137 已按 absorbed/superseded 关闭、Issue #132、最新代码/测试/Review 与本地 ref 事实重新计算。Windows runtime、browser launch-path 与 V11 authority 已进入 `main`；旧失败 head 仍只作为历史证据，不能替代 `main` 完成事实。

```text
SM-4A Trusted Authorization Ingress Reconciliation V10 (active)
→ Dirty Root / Branch / Worktree Reconciliation
→ Nexus Exact-tree Census Refresh
```

本计划只有一个 active package 与两个候选。候选不是授权、完成声明或永久 Backlog；任一 reload 事件发生后必须从新事实整体重算。

## 当前唯一 Work Package

### sm4a-trusted-authorization-ingress-reconciliation-v10

- 产品结果：把 retained `bca9102` 中仍未进入 `main` 的五路径产品/测试 delta 重放到 V11 runtime authority 后；trusted local policy 只能声明 operation、target、condition 与 minimum verification，source owner、writable prefix 与 authorization revision 由 canonical source registry 和 normalizer 唯一生成。
- Owner：compiler facade、source-adapter registry 的内部 authority seam、新 trusted ingress、两份 source-adapter 合同/单元测试与本包四个控制文档。
- 禁止：旧 V9 路线图/Work Package/控制面、operation catalog 扩张、Task Envelope v2、第二 authorization/source writer、runtime/CI trust root 变更。
- 退出：五路径重放与新 main 无冲突；existing resolver 输出/revision 不变；caller authority 字段与 unresolved/read-only/forged source fail closed；focused tests、typecheck、docs doctor、imports、control-plane lifecycle、scope 与 Review 通过；ready PR 进入 `main` 后删除旧 V9 branch。

## 候选 Work Package

### 1. dirty-root-and-branch-reconciliation-v1

- 工程结果：把根 worktree 安全快进到最新 `main`；验证 Goal/V5 replacement 输入已由 tracked canonical mirror、migration audit 与 governance provenance 吸收后，只删除未跟踪输入；恢复 canonical `AGENTS.md`，提交 `.claude/settings.json` 删除，清理所有已完成 local branch/worktree。
- 约束：不覆盖用户 bytes，不使用 hard reset，不以 branch 名或 0/0 单独证明可删。
- 退出：root clean，`main...origin/main = 0/0`，本地与远端仅 `main`，worktree 仅仓库根。

### 2. nexus-exact-tree-census-refresh

- 产品结果：启动时绑定最新 Nexus commit/tree，重算 path/mode/object、entrypoints、EPR、Skills、mechanism decisions、public/deployed surfaces 与 retirement 前置。
- 依赖：SEC root/branch hygiene 先闭合；ledger authority 保持 A0 单写者。
- 退出：classification/decision 达到 100%，unclassified/undecided 为 0；Parity 与 owner 迁移未完成前不得声称吸收完成。

## Gate、单写者与重算

- A0 是本窗口全部 Gate owner；相同 `gate_key + tested head + profile` 的未失效结果复用。
- SM-4A、dirty root 与 Nexus Census 按依赖串行；任何时刻只有一个正式 active manifest。
- SEC/Nexus main 变化、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership 反证、实现 supersede 或 Census 新前置均触发 live resolver 与全窗口重算。
