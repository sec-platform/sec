---
title: 工程信息模型
status: stable
domain: information-model
---

# 工程信息模型

本文拥有 SEC 对**异构工程信息如何引用、选择、配置、保留、检索和投影**的通用接合合同。它不取代 [Engineering IR](semantic-model.md) 对 canonical Entity/Fact/Assertion/Responsibility 的 authority，也不取代 [Documentation System](documentation-system.md) 对 SEC 文档语料的 authoring/compilation 规则。

核心原则：

> **Single Authoritative Source per Fact.**

不是所有事实都放进同一种数据库。源码事实由源码 owner、Requirement 由 Requirement owner、Evidence 由 Evidence owner、运行状态由运行 owner 持有；Information Model 只规定这些既有对象怎样被稳定引用、组成 configuration、声明 applicability/provenance/retention，并生成无增权 projection。

## 1. 引用既有对象，而不是再造第二对象本体

跨工具或跨生命周期引用一个工程对象时，Information Model **不创建新的 `EngineeringObject` identity**。引用必须指向该对象真实 owner 已签发的 identity / revision domain：

```text
InformationReference = exact {
  ownerRef,
  subjectRef,
  revisionSelection?,
  payloadRef?,
  applicabilityRef?,
  provenanceRefs[]
}
```

其中：

- `subjectRef` 的 identity 由实际 owner 定义，例如 Engineering IR Entity/Fact/Responsibility、Source Program symbol、Artifact、Evidence、Operation 或外部 Provider object；
- `revisionSelection` 只选择该 owner 已定义的 revision/configuration，不发明另一套 revision；
- `payloadRef` 只定位真实载荷，不取得载荷语义 authority；
- applicability/provenance 只增加“何时适用/从何而来”的关系，不改变主体本身。

只有存在真实跨时间/跨消费者需要时才持久化这种 reference/binding。普通局部变量、每个 Markdown 段落、一次临时 UI selection 不因为“模型完整”强制获得全局 identity。

**Identity 与 Revision 分离。** 改名/移动/内容修订是否保持 identity 由对象 owner 的演进合同决定；Information Model 只保存其结果。split/merge/replacement 不能由 locator 或内容 hash 猜测。

**Identity 与 ContentIdentity 分离。** 相同字节可属于不同逻辑对象；同一对象的不同 revision 字节可以不同。Content address 可用于完整性/去重，但不能替代逻辑 identity。

## 2. typed relation federation

Information Model 不拥有一个万能 `dependsOn`，也不重新定义 Engineering IR predicate registry。它只规定**跨 owner 关系如何被引用与联邦**：

```text
InformationRelationReference = exact {
  relationKindRef,
  subjectRef,
  objectRef,
  applicableRevisionRefs,
  applicabilityRef?,
  provenanceRefs[]
}
```

`relationKindRef` 必须指向真实语义 owner 已定义的关系，例如 ownership、implements、uses/imports、verifiedBy、supports/contradicts、mustPrecede、authorizes、retainsFor、supersedes/replaces 等；这些名称在不同 Domain 中不能仅凭字符串相同视为同一种关系。

每种 relation 的 endpoint type、direction、cardinality/order、推导/传递规则、invalidation consumer 和 authority ceiling 由其语义 owner 定义。Information Model 只保存/查询这些 typed refs，不自行扩展它们的推理强度。

导航 link/mention 不自动建立编译 dependency、verification、permission 或 retention。

## 3. Configuration / Baseline

“v1.7”不是一个全局最新版。一个可复现选择是向量：

```text
Configuration {
  semantic revisions,
  source/content revisions,
  implementation bindings,
  target/profile,
  dependency/toolchain,
  artifact revisions,
  applicable environment selections
}
```

各命名域的 revision 可以不同。Configuration 是这些既有 revision/binding 的**选择集合**，不是新的事实 owner。配置成员全部存在也不证明彼此兼容；Compatibility/Verification 另判。

正在运行的旧 Artifact 继续按其绑定配置解释；新默认、新文档页、新 Candidate 不原地改变旧运行。

## 4. Applicability

Requirement/Procedure/Evidence/Artifact 可以只适用于条件集合：

```text
OS
architecture
target/profile
feature set
runtime/provider revision
product variant
region/policy
environment capability
```

Applicability 是显式逻辑条件；unknown 保持 unknown。没有读取权限不等于“不适用”，字符串版本排序不替代对应生态版本语义。

适用条件的事实值仍来自相应 owner/environment observation；Information Model 只规定条件绑定和查询方式。不同读者/产品可以从同一 canonical sources 生成不同适用视图，而不是复制可独立改义的文档。

## 5. Provenance / Authority / Confidence

必须分别回答：
- 谁/什么产生；
- 基于哪些 exact inputs；
- 使用什么 tool/method/revision；
- 它是 authoritative、derived、observed 还是 inferred；
- 覆盖范围；
- 是否有 Evidence/approval；
- 何时/何条件失效。

Provenance reference 指向真实 owner 已签发的 source/receipt/Evidence，不复制其内容语义。confidence 只描述允许不确定的 assertion，不能提升 authority。多个来源一致不是多数票权威。

## 6. Payload 与 metadata

大载荷保持在适合的 owner/store：
- source/archive；
- binary/artifact；
- dataset；
- model；
- image/video；
- logs/telemetry；
- CAD/firmware 等。

Metadata/graph 只引用 exact payload identity。不能把大载荷塞进 graph/Markdown 来获得“统一”；也不能只保留 URL 就宣称已离线保全。

Content addressing 可用于去重/完整性，但 hash 不证明作者、许可、语义、可执行资格或保密。

## 7. Retrieval

检索平面可以组合：
- direct identity lookup；
- structured query；
- symbol/source index；
- relation traversal；
- full-text；
- semantic/vector discovery。

**索引不是事实源。** 它们可以删除重建。Vector/全文命中只提供 discovery；需要做正式判断时回到 exact authoritative source、configuration 和 coverage。

Query 必须表达 coverage：`found`, `absent within complete scope`, `unknown/incomplete`, `unavailable`, `not-disclosable`, `ambiguous` 不能混成同一空集合。

## 8. Projection

以下都是 projection：
- Markdown handbook；
- HTML；
- SVG/diagram；
- IDE tree/graph；
- dashboard；
- API reference；
- AI context；
- release notes；
- role/task-specific views。

一个 projection 只应人工维护其**独有表示逻辑**，不能复制一份可独立修改的工程事实。HTML/SVG 若只是表现同一 Markdown/graph，应由 canonical source 生成。

Hierarchy 是 projection，不是 ontology。物理目录提供稳定 address 与日常维护边界；系统结构、生命周期、风险、团队、release 等多维分类由 typed relations/filter 投影，不为每个视角复制文件。

## 9. Storage / retention

保留是 purpose-driven，不是“全部永久保存”。

区分：
- non-reconstructible authoritative source；
- reconstructible derived view/cache；
- required historical configuration/artifact；
- Evidence/operation recovery material；
- temporary work；
- external-only reference。

`retainsFor` 的语义由 retention owner 定义；Information Model 只保存其 typed reference。实际保留必须有真实 owner、purpose、retention/release condition 和可执行存储保护。逻辑引用本身不阻止物理 GC；删除前需核实际强 roots、legal/security holds、in-flight operation 和外部副本责任。

备份、replica、cache、archive 和 source-of-truth 不是同义词。

## 10. Federation

跨仓库/组织默认采用 federated authoritative sources + typed refs，不建设全局强事务大库。

需要跨系统一致视图时：
1. 固定各 source selection/revision；
2. 取得实际 coverage；
3. 解析 owner 已定义的关系与冲突；
4. 形成不可变 configuration/manifest；
5. 对需要恢复/复验的 payload 取得真实 retention；
6. 发布 view。

没有共同 snapshot capability 时，使用明确弱保证/二次校验或拒绝强一致要求；本地锁不能伪造外部原子快照。

## 11. 安全与披露

Relation/index/query 不能扩大 source Authority。跨租户 dedup/search 不得通过命中、hash 或 size 泄露另一租户内容存在。Secret 只保存受限 reference；普通 AI context、index、HTML projection 不得携带 secret value。

删除/撤权后，派生 index/cache/view 必须按真实依赖失效；无法证明已清除的外部副本保持 residual/unknown，不用本地记录宣称全球删除。

## 12. 与 Engineering IR / Documentation System 的边界

三层必须保持单向：

```text
canonical owner object/fact
        ↓ typed ref / selection
Information Model configuration + federation
        ↓ purpose projection
Documentation / IDE / AI / reports
```

- Engineering IR 继续唯一拥有 Entity/Fact/Assertion/Responsibility 与 semantic predicate；
- Source Program、Artifact、Evidence、Operation、Provider 等继续由各自 owner 拥有自己的 identity/revision；
- Information Model 不创建第二对象 ID、第二 predicate registry、第二 revision ledger 或第二 authority；
- Documentation System 只拥有 SEC 文档 corpus 的 parser/frontmatter/clause/registry/compiler；
- `docs/authority.json` 定位 canonical document owners，path 是稳定 address，不是语义分类；
- docs index/HTML/diagram/AI view 都是 projection；stable docs 只描述当前设计，不维护历轮路径兼容或修订日记。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

SEC 的 Information Model 不建立第二工程对象本体；它只联邦各真实 owner 已定义的 identity、revision、typed relation、configuration、provenance、applicability、payload 与 retention references，并生成可失效、可重建的用途投影。任何检索图、目录、HTML、AI context 或统一索引都不得取得源事实的第二 authority。
