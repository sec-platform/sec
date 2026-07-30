---
title: Engineering Workspace Domains 提案
status: draft
domain: proposal
last-reviewed: 2026-07-29
---

# Engineering Workspace Domains 提案

本文定义未来 Repository、Documentation、Workflow/Gate、Agent Operations、Release、Product Decision 与 Evidence Ledger domains 的 promotion 条件。它是非权威提案；这些 domains 不因本文存在而实现。

## 通用 Domain 合同

一个 domain 只有同时具备以下表面才能升格：

1. 明确 raw inputs 与 authority；
2. 稳定 entity/record identity；
3. 独立 revision payload 与 canonical ordering；
4. raw→validated validator、diagnostic和deep-freeze；
5.唯一 producer/writer；
6. query/projection接口；
7. mutation authorization、transaction和rollback/recovery；
8. migration/compatibility；
9. Delta/Impact边；
10.正面、负面、fault与round-trip验收。

缺少任一项时，只能是 Evidence、proposal或projection，不能挂进一个巨型 optional Workspace object冒充domain。

## Repository Domain

表达 package/module/source/artifact/config/toolchain边界、依赖、入口、owner和physical workspace identity。

不拥有语言语义或Engineering IR。Git tree、filesystem inventory、package manager和分析工具输出是输入/Evidence；validated Repository Snapshot统一物理路径、logical identity、dependency与generated/owned边界。

Mutation必须服从path containment、workspace lease、dirty/CAS、toolchain capability和rollback。

## Documentation Domain

表达document identity、lifecycle、domain、ownership、projection、consumer、update trigger与links。机器registry是authority；Markdown prose是内容，不以文件名或catch-all推断active status。

Mutation必须维护唯一owner、archive bytes、link/reference与dynamic-fact边界。Documentation Delta可影响Skill、Gate、README和用户契约，但不自动改写产品代码。

## Workflow / Gate Domain

表达Gate identity、owner、applicability、required environment、input closure、execution plan、result schema和Evidence requirements。

Workflow YAML只是Provider projection。未执行、unsupported、invalidated和stale不能成为passed。Gate定义、selector、runner与Check不能分别维护结果语义。

## Agent Operations Domain

表达AgentOperation、Skill、Task Envelope、permission、context requirements、budget、stop/recovery、session/worktree/branch绑定与delegation。

AI或Agent状态不进入Engineering IR。Prompt和聊天不是事实源；执行状态由Development Run Journal/Integration control提供。Agent只能提出proposal或在授权的source owner内执行Mutation。

## Release Domain

表达release candidate、artifact set、build profile、dependency closure、SBOM、signature/attestation、Verification binding、promotion state、publication authorization和receipt。

Release revision绑定canonical source/IR/artifact digests和provider revisions，不绑定PR文字。Build成功不等于可发布；promotion与publication是独立状态转换。

## Product Decision Domain

表达problem、goal、non-goal、assumption、option、decision、metric、risk、owner、review trigger和supersede关系。

Issue/Discussion可作为authoring transport，但validated Decision record不能由投票数量或AI confidence自动生成。决策改变必须产生对Contract、Roadmap和Verification的Impact。

## Evidence Ledger Domain

表达claim、method、scope、subject revision、environment、producer、freshness、result、artifact、coverage、limitations和invalidation rule。

Fact Provenance、Artifact Provenance、CI Evidence、runtime observation和AI inference是不同类型；Evidence永不自动升格为authoritative Fact。相同输入复用必须由coverage和invalidation机器证明。

## 跨域引用

Domain之间只通过stable identity和revision引用：

```text
Repository source/artifact
↔ Documentation owner/consumer
↔ Workflow Gate input/result
↔ Agent operation/task
↔ Release artifact/promotion
↔ Product decision/rationale
↔ Evidence claim
```

禁止复制整份对象或通过路径字符串猜关联。跨域validator检查引用存在、revision兼容、owner唯一与循环依赖。

## Aggregated Workspace Snapshot

最终 Engineering Workspace Snapshot 只组合：

- 每个独立 validated domain revision；
- cross-domain reference index；
- aggregation revision；
- unresolved/unknown frontier。

聚合器不重新解释domain语义，不填充尚未实现的domain，也不让任一projection反向成为authority。

## 分阶段升格

1. 先选择有真实consumer且已存在机器owner的domain；
2. 建立最小raw/validated boundary；
3. 迁移一个真实consumer；
4.完成Delta/Impact与Mutation；
5.删除旧重复owner；
6.再接入聚合Snapshot。

每个domain使用独立聚焦Work Package；大型未知探索使用Spike，不能直接合并。
