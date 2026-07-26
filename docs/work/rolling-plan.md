---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-26
---

# SEC 滚动近期计划

本窗口从 `origin/main@a370236e92518abb83c10afbe955010c589e3e2f`、长期 Goal revision `sha256:555a187d…f676`、Issue #132 与一次 live resolver snapshot重新计算。旧 candidate、PR/run与 Review历史不再复制进活动控制面。

```text
Fast Feedback Postmerge Pointer V1
→ publication 后 active pointer = none
→ SM-4A Shared Adapter + CLI/Workbench Thin Transports (next-ready)
→ Nexus Exact-tree Census Refresh
→ P2 Blockless Source Ownership Foundation
```

本计划在候选发布前只有一个 resolver-selected active package；同一 manifest blob 进入 default branch 后 resolver返回 `none`。普通进度只进入 Reconciliation Delta，不重写三个控制面；仅新 Work Package、真实 `reload_if`与最终 reconciliation更新本文件。

## 当前唯一 Work Package

### fast-feedback-postmerge-pointer-v1

- 工程结果：修复 PR #152 发布后 active pointer 仍绑定采样前 manifest digest 导致的 `candidate-digest-mismatch`，不改变已进入 main 的 fast runner、测试分层或 V16 verifier。
- Owner：仅 postmerge manifest、active pointer 与 rolling plan；产品、测试、verifier、workflow、架构和稳定路线图均禁止修改。
- 选择语义：candidate manifest尚未出现在 live default branch时它是唯一 active；相同 blob发布后 resolver返回 `none`。
- 退出：docs doctor与control-plane lifecycle通过，候选解析为唯一 active；相同 manifest blob进入 main 后解析为`matching-default-blob`，任务branch清理。

## 候选 Work Package

### 1. sm4a-shared-adapter-cli-workbench-v1

- 产品结果：闭合一个既有 Semantic Mutation operation 的 shared product adapter，并让 CLI 与 Workbench 成为同一 adapter 的薄 transport；不扩展 operation catalog，不混入 Task Envelope v2。
- 依赖：root hygiene 先闭合；从最新 `main` 复用唯一 trusted authorization ingress、operation registry、revision 与 pipeline authority，不创建第二 source/authorization owner。
- 退出：同一 operation 经 CLI 与 Workbench 产生同一 canonical plan/Delta/Impact 语义并走同一 verification/authorization seam；transport 不拥有业务规则，P1 剩余闭包有实现、测试与 Review 证据。

### 2. nexus-exact-tree-census-refresh

- 产品结果：启动时绑定最新 Nexus commit/tree，重算 path/mode/object、entrypoints、EPR、Skills、mechanism decisions、public/deployed surfaces 与 retirement 前置。
- 依赖：SEC root/branch hygiene 先闭合；ledger authority 保持 A0 单写者。
- 退出：classification/decision 达到 100%，unclassified/undecided 为 0；Parity 与 owner 迁移未完成前不得声称吸收完成。

### 3. p2-blockless-source-ownership-foundation

- 产品结果：从已进入 main 的 SM-4A source-authority seam 建立 App/source-module/import-session 的 canonical Semantic Source Owner，Block 不再是语义存在的前置许可证。
- 依赖：P1 shared adapter + CLI/Workbench 薄 transport 与 Nexus Census 均先闭合；再从最新 main 冻结 owner identity、writable region 与 registry read-only 边界，不得并行启动第二 writer。
- 退出：每个 writable region 唯一 owner，ownership 迁移不伪造 Entity/Fact identity，现有 SM-2/SM-3 transaction 与 CAS/recovery authority 不分叉。

## Gate、单写者与重算

- A0 是本窗口全部 Gate owner；相同 `gate_key + tested head + profile` 的未失效结果复用。
- Fast feedback closure、P1剩余闭包、Nexus Census与P2 owner foundation按依赖串行；任何时刻最多只有一个正式active manifest。
- SEC/Nexus main 变化、PR merge/close/head/base、CI/Review blocker、Goal revision、authority/ownership 反证、实现 supersede 或 Census 新前置均触发 live resolver 与全窗口重算。
