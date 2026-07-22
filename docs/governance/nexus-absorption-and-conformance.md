---
title: Nexus 吸收与 Conformance 合同
status: active
last-reviewed: 2026-07-22
---

# Nexus 吸收与 Conformance 合同

本文是 `QzCrane/nexus` 全仓 Census、机制决策、Parity、迁移与 retirement 的唯一合同 owner。机器可读状态由 `docs/governance/nexus-absorption-ledger.yaml` 持有；人类可读覆盖与缺口由 `docs/governance/nexus-absorption-report.md` 投影。路线顺序由 `docs/03-MVP实施计划与路线图.md` 持有。

Nexus 是 SEC 的第一个完整 Engineering Workspace Conformance Corpus，不是 SEC Core 模板。当前 ledger/report 为 **incomplete bootstrap**；记录 exact baseline 不等于完成 Census。

## 1. 无遗漏定义

只有以下四层同时 100% 闭合，才允许使用“无遗漏吸收完成”：

```text
tracked-path classification
+ mechanism decision coverage
+ accepted-mechanism parity evidence
+ post-migration owner/retirement reconciliation
```

- 每个 tracked path 都必须分类，`unclassified = 0`。
- 每个机制必须有唯一明确决策，`undecided = 0`。
- 每个 accepted mechanism 必须有 positive、negative、failure、diagnostic、side-effect 与 migration 六维 parity，`missingParity = 0`。
- 新 SEC owner、旧 Nexus owner、消费者、生成物、文档和回滚必须 reconcile；`unexplainedDelta = 0`，`unauthorizedRetirement = 0`。

抽样、重要文件清单、Goal 内已知机制、典型 Demo、相似类型或复制脚本都不能证明无遗漏。

## 2. Exact baseline

当前 bootstrap baseline revision 2 固定为：

- repository：`QzCrane/nexus`；
- local repository root：`D:/Project/Nexus`；
- commit：`e75caa28dcbc1ffa6e893b5539f85c8177346cd3`；
- Git tree：`3a8ad6bedd56fd92db141c45ec687b75263364c2`；
- tracked paths：1,439；
- 其中 `nexus/` 下 1,405，repository root/remote-site 等其他位置 34。
- exact tree 中 EPR 定义覆盖 EPR-001..029，Project Skill entrypoints 为 11 个；它们目前都尚未在 ledger 建立 SEC binding。

这些值来自 committed tree，只是 Census 输入。该 revision 相对前一观察值 `1b82ace…` 变化 31 paths，并删除一个 tracked path；EPR 与 Skill exact count 均未变化。live Nexus worktree/index 可变化且不能作为永久 baseline；采集器必须从 exact commit/tree 或 clean isolated view 读取 mode、object identity 与 bytes。最终 manifest digest 尚未物化，在 ledger 中保持 `null`，不得用 Git tree ID 冒充另一种 digest algorithm。

根 Goal 目录的 `SEC_Nexus_Absorption_Ledger_Template_V1.yaml` 是上游 seed/template，不是第二状态 owner。Canonical ledger 必须保留其中仍有效的 allowed vocabularies 与三个已知 candidate mechanism，并将 source path 绑定到当前 exact-tree blob；template 的空 parity/path 数组不能被解释成完成。后续 schema 细化只在本合同与 canonical ledger 中进行，report 只投影。

## 3. Census 范围

物理 inventory 至少覆盖：

- 所有 tracked path、mode、blob/submodule identity 与 classification；
- root、nested workspace、packages/apps、remote/public/deployed surfaces；
- package scripts、CLI/daemon/server entrypoints、generators；
- Git hooks、AI hooks、Lefthook、GitHub Actions 与 release workflows；
- authority/lifecycle docs、redirect/mirror、archive 与 research evidence；
- architecture/toolchain/docs/privacy/release verifiers；
- tests、fixtures、goldens、failure corpora 与 generated outputs；
- public sync、store/locale/permission/privacy/signing/SBOM surfaces；
- EPR-001..029 全部 29 项；
- Census baseline 时实际存在的全部 Project Skills；目标 Goal 要求的首版核对门是 11/11，但实际 count 必须由 exact tree 重新计算。

普通产品代码也必须先分类，不能因“不像治理机制”而跳过。每个 executable entrypoint 必须追到 owner、inputs、outputs、consumers、failure semantics 与 side effects。

## 4. Path 与机制分类

Path kind 至少支持：

```text
authority | implementation | projection | generated | test | evidence
| migration-alias | archive | vendor | fixture | toolchain | workflow
| release-surface | public-surface | ordinary-product-code | config
```

每个识别出的 mechanism 只能选择一个决策：

```text
absorb-core
absorb-domain-ir
absorb-policy-pack
absorb-adapter
retain-project-specific
superseded
reject-with-rationale
```

`mentioned`、`later`、`probably-covered` 或空值不是决策。一般机制和 Nexus-specific data 必须分离：Bun 版本、SPECTRA/HALO ID、Chrome permission、WebAudio、locale、public exclude list、路径与 EPR 编号只进入 Profile、Policy Pack、Adapter 或 fixture。

## 5. Mechanism record

每个 mechanism 记录：

- stable ID、title、source paths/symbols/entrypoints；
- project-independent essence 与 Nexus-specific data；
- current physical owner、consumers、generated/public surfaces；
- SEC decision、target domain、canonical owner/types/adapters；
- invariants 与六维 parity evidence/status；
- status、evidence 与 old implementation retirement condition。

相同机制跨多个 path 时只建一个 canonical mechanism record，以 source bindings 关联；不得按文件重复计数后假装覆盖率更高。

## 6. Parity

Parity 比较合同、状态、diagnostic identity、失败边界、副作用与生成物，不只比较日志文字。对 accepted mechanism，至少证明：

- positive：合法输入得到等价或更严格、可解释的结果；
- negative：非法/越权/漂移输入 fail closed；
- failure：timeout、partial state、tool absence、stale evidence 等保持可恢复语义；
- diagnostic：stable identity、classification、scope、redaction 与 actionable details 等价或更严格；
- side-effect：filesystem、process、network、generated/public surface 与 mutation boundary 没有未声明差异；
- migration：现有 Nexus corpus/consumer 在新 owner 下保持或显式改善；

Shadow comparison 不是第七个 parity 维度，而是六维通过后的独立 reconciliation gate：旧/new owner 对 exact corpus 的差异必须全部映射到已解释 decision/evidence，最终 `unexplainedDelta = 0`。Ledger 中每个 accepted mechanism 必须为六个固定 key 分别保存 `status` 与 evidence IDs；缺任一 key 或非 `proven` 都使 `acceptedParity100Percent = false`。

Evidence 必须绑定 Nexus commit/tree、SEC tested head/profile、Gate/command、result、duration、artifact 和 invalidation rule。旧 baseline 不能证明新 Nexus main。

## 7. Retirement

旧机制只有同时满足以下条件才允许删除或降级：

- 新 canonical owner 与 revision 已实现；
- 所有 consumers/projections 已迁移；
- positive/negative/failure/diagnostic/side-effect/migration parity 全部通过；
- rollback/restore 已验证；
- 真实 Nexus end-to-end 通过；
- docs、workflow、public/release surfaces 已 reconcile；
- 没有第二 writer、第二 authority 或 unexplained delta。

保留旧 owner 时必须证明仍有独立职责并标注 lifecycle。被新实现吸收的 PR/机制准确标为 superseded/absorbed，不能声称独立进入目标主链。

## 8. 持续 delta census

Nexus baseline 变化后必须：

```text
old exact baseline
→ exact git diff --name-status + mode/object changes
→ classify added/modified/deleted paths
→ update affected mechanism bindings/decisions
→ invalidate and rerun affected parity only
→ issue new census revision and report
```

删除路径也必须 reconcile owner、consumer、generated/public surface 与 retirement。旧 Census 可以作为 baseline evidence，不能直接携带 100% completion 到新 commit。

## 9. 阶段 DAG

1. **Phase 0A Census**：exact-tree inventory、path classification、entrypoints、authority/public surfaces、EPR/Skills、mechanism decisions与 initial gaps；只读，不改 SEC Core。
2. **Phase 0B Architecture Freeze**：将无 undecided 的 accepted mechanisms 映射到 Repository/Documentation/Workflow/Agent/Release/Evidence/Product Decision domains、Policy Packs 与 Adapters。
3. **Phase 0C Corpus/Parity Harness**：immutable corpus、positive/negative fixtures、golden decisions、shadow runner、difference classifier 与 coverage report。
4. **Implementation/Migration**：按产品 DAG逐个实现 target owner，迁移 consumers。
5. **Retirement/Conformance**：真实 Nexus e2e、public/release parity 与旧 owner 收口。

Census 可作为只读辅助 lane 与 SEC-TS 产品主线并行，但不是第二正式 active Work Package；不得修改共享 canonical types，也不得无限延迟 SM-4A。

## 10. 完成门与当前结论

最终报告必须同时满足：

```text
Path coverage             100%
Mechanism decisions       100%
EPR bindings              29/29
Current Skill bindings    exact/exact
Executable entrypoints    100%
Generated-output owners   100%
Public claim projections  100%
Accepted parity           100%
Unexplained deltas        0
Unclassified              0
Unauthorized retirements  0
```

当前只建立了 exact baseline 与 canonical ledger/report owner，尚未物化全量 path inventory、机制决策、EPR/Skill binding、Parity 或 retirement proof。因此唯一合法结论是：**Census/Parity 未完成**。
