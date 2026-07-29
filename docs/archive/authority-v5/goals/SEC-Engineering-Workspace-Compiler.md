---
title: SEC Engineering Workspace Compiler 长期目标镜像
status: stable
last-reviewed: 2026-07-23
---

# SEC Engineering Workspace Compiler 长期目标镜像

本文是用户长期 Goal 在仓库内的稳定投影。它不保存当前 SHA、PR、CI、活动分支或一次性任务；Goal 变化后必须从最新工程事实重算 `docs/work/**`，并同步受影响的 canonical owner。

## 上游 Goal revision 绑定

本次迁移完整读取了用户提供的 `docs/goals/**` 九份 V4 Markdown。单文件 digest 对 raw bytes 计算 lowercase SHA-256；combined revision 的算法固定为：按 repository-relative POSIX path 做 ordinal 升序，每项依次串接 `<path>`、一个 U+0009 TAB、`<lowercase-sha256>` 和一个 U+000A LF，再对完整 UTF-8/no-BOM payload 计算 SHA-256。

当前上游集合的 combined revision 为：

```text
sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676
```

九份输入的 path、raw length、digest 与归位结果只记录在 `docs/archive/2026-07-23-document-system-v4-migration-note.md`。该 revision 绑定上游产品意图，不证明 V5 payload、安装结果或候选分支已经进入 `main`。

## 产品目标

SEC 的目标品类是 **Engineering Workspace Compiler**：用户表达产品与工程语义，或导入 Existing Workspace；SEC 内部确定性地治理并生成源码、测试、文档、Gate、Agent、Release 与 Evidence。TypeScript 是第一目标；SEC 支持受控 AI、真实 Brownfield 导入，并以 `QzCrane/nexus` 作为首个完整 Conformance Corpus。

本文件只绑定上游长期意图，不拥有产品主链。完整数据流与系统边界只见 `docs/02-工程编译器-MVP-PRD与架构稿.md`；Engineering IR、Workspace domains、Target IR/Lowering 与 Brownfield 只见 `14` 和三个 `docs/architecture/**` owner。

## 永久边界

- Engineering IR、Entity/Fact identity、Fact/Assertion、authority/confidence/provenance/evidence、revision 与 canonical ordering 只有一个 owner。
- Pipeline Kernel、deterministic lowering、Fact Delta、Impact、Verification 与 Semantic Mutation transaction 不得出现第二实现或 consumer 旁路。
- 所有 live writer 服从 workspace lease、CAS、journal、isolated apply、atomic publish、rollback 与 `recovery-required`。
- Workbench 和 AI 只能提交受限 proposal，不能直接写 IR、generated project、governance authority，或扩大权限与 Verification。
- unknown、ambiguous、stale、conflicted 与 opaque 必须显式，不能伪装成 authoritative fact。
- 外部 graph、分析器、MCP 与 LLM 只是可替换 Provider，不能拥有 canonical semantics、actual Delta、publish decision 或 source writer。
- Nexus 特定的 Bun、SPECTRA、HALO、Chrome、WebAudio、locale 与路径只能进入 Profile、Policy Pack、Adapter 或 fixture，不进入 SEC Core。

## 稳定路线

阶段 DAG、进入/退出门与完成定义只由 `docs/03-MVP实施计划与路线图.md` 维护；Workspace-domain 与 Target IR/Lowering 的依赖只由对应 `docs/architecture/**` owner 维护。本 Goal mirror 不再复制路线或 snapshot 迁移算法。

## Nexus 完成门

只有 tracked path classification、mechanism decision、EPR 29/29、当前 Skills、entrypoints、generated/public/deployed surfaces、accepted parity 与 owner/retirement reconciliation 全部完成，且 unclassified、undecided、missing parity 与 unexplained delta 均为 0，才能声称无遗漏吸收完成。在此之前唯一合法状态是 Census/Parity 进行中。

## 自主滚动执行

Codex 必须依据最新 `main`、开放 PR/Issue、CI、Review、代码、测试和真实产物自行维护：

- `docs/work/current-state.yaml`：只记录当前事实；
- `docs/work/rolling-plan.md`：当前包与后续 2～5 个候选；
- `docs/work/active-work-package.md`：只选择一个 canonical frozen manifest，不复制 envelope。

Merge/close、相关 `main` 变化、新 CI/Review blocker、架构假设被反证、任务被新实现吸收、Nexus Census 新前置或长期 Goal 更新后，必须整体重算。计划、Issue、PR body、branch、聊天和安装输出都不能证明完成；只有进入 `main` 的实现与适用测试、CI、Review 和真实产物可以支撑完成结论。
