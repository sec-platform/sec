---
title: SEC Engineering Workspace Compiler 长期目标镜像
status: stable
last-reviewed: 2026-07-22
---

# SEC Engineering Workspace Compiler 长期目标镜像

本文是用户在 Codex Goal 中持续提供的长期目标在仓库内的稳定投影，供开发者、Agent 和工程文档引用。对话 Goal 是上游产品意图；本文不保存当前 SHA、PR、CI 或活动任务。用户更新 Goal 后，必须从最新工程事实重算 `docs/work/**`，并同步修正本投影与 canonical owner 文档。

## 上游 Goal revision 绑定

本投影观察并完整读取以下两份上游 Markdown。单文件 digest 是对 raw file bytes 计算的 lowercase SHA-256：

| 上游文件 | SHA-256 |
|---|---|
| *upstream workspace path:* docs/goals/SEC_Codex_Conversation_Goal_No_Omission_V3_2026-07-22.md | `04b81d9f155a3bf6388c7bf0d62bb8a08e2e68d870964f053be3fa7c9fbe5c3d` |
| *upstream workspace path:* docs/goals/SEC_Codex_Persistent_Goal_With_Rolling_Plan.md | `117a438228a9212753ab8ff2266969db1a8c36a13becfe1efcc796ab97a99c4c` |

Combined revision 的算法固定为：按 repository-relative POSIX path 做 ordinal 升序；每项依次串接 `<path>`、一个 U+0009 TAB、`<lowercase-sha256>` 和一个 U+000A LF；对完整 UTF-8/no-BOM payload 再计算 SHA-256。当前 `goalRevision` 为 `sha256:fbe08bd8dd24224b873619fa48746778eeb4357ddb5cd917d6ee45e45134f86d`。任何文件集合、path 或 raw bytes 变化都会改变该 revision，并触发三个控制面重算；本节只绑定上游 Goal，不复制其全文或成为第二产品 authority。

同目录的 Nexus ledger YAML 是机器可读 seed template，不进入两份 Markdown 的 `goalRevision`；其 raw digest 由 canonical `docs/governance/nexus-absorption-ledger.yaml` 单独绑定，template 更新按 Nexus contract 触发 ledger/control-plane 重算。

## 产品目标

SEC 的目标品类是 **Engineering Workspace Compiler**：用户表达产品与工程语义，SEC 内部确定性地治理并生成源码、测试、文档、Gate、Agent、发布投影与 Evidence。

```text
Product Intent / Existing Workspace
→ Canonical Workspace Input Snapshot
→ independently validated Engineering / Repository / Docs / Gate / Agent / Release / Evidence domains
→ Validated Engineering Workspace Snapshot
→ Application IR
→ Behavior IR
→ Target Program IR（SEC-TS v1 为 TypeScript Program IR）
→ Validated target Compilation Snapshot
→ Source / Test / Docs / Gate / Agent / Release Projections
→ Verification / Provenance / Workbench
→ Semantic Mutation / Rollback / Recovery
```

SEC 以 TypeScript 为第一目标，支持受控 AI、真实 Brownfield 导入和以 `QzCrane/nexus` 为首个完整 Conformance Corpus 的工程工作区吸收。

## 永久边界

- Engineering IR、Entity/Fact identity、Fact/Assertion、authority/confidence/provenance/evidence、revision 和 canonical ordering 只有一个 owner。
- Pipeline Kernel、deterministic lowering、Fact Delta、Impact、Verification 与 Semantic Mutation transaction 不得出现第二实现或消费方旁路。
- 所有 live writer 服从 workspace lease、CAS、journal、atomic publish、rollback 与 `recovery-required`。
- Workbench 和 AI 只能提交受限 proposal，不能直接写 IR、generated project、governance artifact 或扩大权限和 Verification。
- 未知、歧义、低置信和 opaque region 必须显式，不得伪装为 authoritative fact。
- Nexus 的 Bun、SPECTRA、HALO、Chrome、WebAudio、locale 与具体路径只能进入 Profile、Policy Pack、Adapter 或 fixture，不进入 SEC Core。

## 执行路线

稳定顺序是：路线校准 → SM-4A Workbench/CLI 最小产品闭环 → Blockless Source Ownership → TS Target Profile / Type Algebra → Application / Behavior / TS Program IR → 通用 TS Lowering → 完整 Workbench → Task Envelope v2 / AI Operator → Workspace Governance IR → Nexus Parity → Brownfield → 生产化。

当前阶段、进入/退出条件和 active next 只由 `docs/03-MVP实施计划与路线图.md` 维护；当前事实由 `docs/work/current-state.yaml` 维护，`docs/work/active-work-package.md` 只选择一个 canonical frozen manifest，由后者持有完整执行闭包。

## Nexus 无遗漏标准

只有以下条件同时满足，才能声称 Nexus 无遗漏吸收完成：

- tracked path 分类 100%；
- mechanism decision 100%；
- EPR-001..029 为 29/29；
- 当前 Project Skills 全部绑定；
- scripts/hooks/workflows/generators/tests/release/deployed surfaces 全覆盖；
- 所有被吸收机制具有 positive、negative、failure、diagnostic、side-effect、migration parity；
- unclassified、undecided、missing parity、unexplained delta 全为 0；
- 旧 owner 仅在新 owner、消费者迁移、回滚和真实 e2e 完成后退役。

在完成前只能准确表述为“Census/Parity 进行中”。详细合同由 `docs/governance/nexus-absorption-and-conformance.md`、ledger 和 report 维护。

## 自主滚动执行

Codex 必须依据最新 `main`、开放 PR/Issue、CI、Review、代码、测试和真实产物自行维护：

- `docs/work/current-state.yaml`：只记录当前事实；
- `docs/work/rolling-plan.md`：当前包与后续 2～5 个候选；
- `docs/work/active-work-package.md`：当前唯一正式执行闭包的 manifest 选择器；不复制 envelope。

控制面的统一重算 taxonomy 由 `docs/04-AI自主实现执行蓝图.md` 维护；本 Goal 更新也是其中一个强制触发。计划、Issue、PR body、分支和聊天都不能证明完成；完成必须由 `main` 中的实现与适用证据支持。
