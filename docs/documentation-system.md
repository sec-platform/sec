---
title: 文档知识系统
status: stable
domain: documentation
---

# 文档知识系统

本文拥有 SEC 文档语料的**authoring、authority、编译与projection根合同**。跨来源工程信息的引用、configuration、applicability、provenance、retention、retrieval与projection接合由 [Engineering Information Model](information-model.md) 拥有；对象 identity、关系语义、产品、实现、运行和Evidence事实仍由各自真实领域 owner 拥有。文档系统只能承载/引用这些事实，不能借整理、摘要、路径或生成改变它们。

详细机制分别由：

- [Source, Scope and Authority](documentation-system/source-and-authority.md)：source role、fragment admission、独立bindings与authoritative ownership；
- [Compilation and Views](documentation-system/compilation-and-views.md)：exact corpus、clause compiler、purpose closure、projection与incremental；
- [Evolution and Conformance](documentation-system/evolution-and-conformance.md)：preservation、consumer、migration、recovery与完成条件。

`docs/authority.json`是当前文档 identity/lifecycle/ownership 的 machine registry，`docs/README.md`是它的生成导航；二者不拥有被导航正文的产品含义。

## 1. 最终原则：一个事实一个权威来源

文档系统遵循：

```text
Single Authoritative Source per Fact
```

不是“所有事实必须写在一个文件/数据库”。Requirement、source implementation、Evidence、runtime observation、external standard分别留在自己的真实owner；文档通过typed reference连接它们。

一个事实可以产生许多视图：Markdown、HTML、SVG、public docs、IDE、AI context、machine index。**视图不得成为第二可写事实源。**

## 2. Source、Graph、View 三层

```text
Owner-authored sources + structured domain sources
        ↓ strict admission
Documentation semantic graph
        ↓ purpose/query/disclosure
Generated views / indexes / navigation / HTML / AI context
```

- **Source**：人或owner machine维护的规范载体；
- **Graph**：从exact source generation编译的Document/Clause/Relation投影；
- **View**：按用途选择、排序、呈现，不增权。

Canonical meaning不等于文件夹树，也不等于graph数据库。Graph是可重建的规范关系投影；被引用的工程事实仍属于其domain owner。

## 3. Authority registry

每个active/stable文档有稳定document identity、role、domain owner和canonical ownership keys。Registry强制：

- ownership key唯一；
- active文档必须登记；
- generated projection不能拥有事实；
- project/generation依赖无环；
- lifecycle/frontmatter一致；
- 无处置draft proposal不混入active corpus。

路径变化不应创造新Document identity；真正split/merge/replacement需要显式的新identity/关系。

## 4. 物理路径只是稳定地址，不是ontology

**最终架构不再要求把文档按所有语义层级搬成一棵“完美目录树”。** 一个工程事实同时可能属于product、Domain、risk、lifecycle、team和release等多个维度；任何单一文件树都只能表达一个父关系。

因此：

> Hierarchy is a projection, not an ontology.

物理路径只承担：稳定定位、局部ownership维护、避免命名冲突和人类基本导航。语义层级、跨域依赖、proof、consumer、lifecycle、applicability等通过typed relations和生成视图表达。

当前owner-oriented地址可以成为长期地址，只在以下情况移动：

- owner/role本身改变；
- 地址产生真实冲突/歧义；
- 独立消费边界变化使文件拆分/合并更合理；
- 明确的placement migration收益超过consumer迁移成本。

**语义重新分类本身不触发物理搬家。** 不为了一次架构调整建立`docs/laws/...`、`docs/sec/domains/...`等强制镜像目录，也不维护旧路径redirect/legacy映射作为稳定系统负担。

## 5. 信息密度与分片

分片依据是**独立变化原因、owner、consumer和可单独理解的合同**，不是固定行数。

根authority文档保存：boundary、核心invariants、主要关系、child refs和完成条件。复杂独立机制进入child authority；通用机制只引用其owner，不在多个consumer复制。

一个片段不应只因为“主题很多”拆开；如果拆分后需要复制大量前提、每次修改总要同时改两边，就说明边界可能不独立。

## 6. 稳定正文只描述当前设计

Stable authority正文保存：

- current requirement/contract/design；
- 机制、算法、不变量；
- 失败/恢复；
- 当前取舍、替代与反转条件；
- 必要反例；
- 真实未实现/未知义务。

不保存：

- 第几轮怎么改；
- 旧路径/旧标题映射；
- 包编号、历史统计；
- 当前PR/SHA/运行状态；
- 已撤销方案的完整旧正文；
- 为“信息不丢”永久留下的重复说明。

旧文档中仍正确的独立信息融合到当前owner；真正同义重复合并；已被否定且对理解当前设计无价值的内容删除。对当前选择有价值的旧方案只以**替代/反例/反转条件**形式保留。

## 7. Dynamic control与stable design分开

当前工作包、滚动计划、provider ledger、runtime/evidence observation是动态/control或外部record，不进入stable design正文。

```text
Stable design: what the system means and must do
Control/runtime: what is being worked on / what happened now
Evidence: what an exact observation supports
```

这些可以互相引用，但不能互相成为owner。

## 8. 文档编译与purpose views

Documentation Compiler从注册的stable authority sources取得exact bytes，按heading/clause建立稳定结构，并生成purpose views。View选择可以基于：

- user question/purpose；
- owner/subject refs；
- allowed disclosure；
- applicability；
- requested detail；
- blocker/unknown。

预算可以截短presentation，不能改变selection meaning：如果不能提供最小完整closure，应明确partial/blocked，而不是省略关键前提仍称完整。

索引、full-text、symbol、graph、vector/semantic retrieval全部是derived retrieval plane；可以删除重建，不作为事实源。

## 9. HTML、图和其他出版物

Markdown正文、structured source、author model等各有唯一source。HTML/SVG/PDF/interactive handbook是projection：

```text
current sources
→ deterministic view builder
→ HTML/SVG/etc.
```

没有独立交互设计价值的HTML不得单独手工维护同义内容。Mermaid/diagram source保留在其owner；rendered SVG是cache/projection。

生成失败时不得静默使用过期图或删掉不支持内容仍宣称完整。旧生成物只有在source digest匹配时可复用。

## 10. Documentation conformance

`docs-doctor`/documentation compiler至少强制：

- registry exact JSON、唯一owner、dependency acyclic；
- active document census与frontmatter；
- H1/link/path完整性；
- stable docs无live SHA/PR/session facts；
- generated README与registry exact projection一致；
- clause compiler可解析；
- dynamic/control/machine ledgers按自己的contract检查。

这些检查证明文档**结构和来源边界**成立，不证明正文所有工程命题已经实现或现实世界正确。

## 11. 新信息的归属

新增事实先回答：

1. 谁是真实owner？
2. 它是stable design、dynamic control、Evidence、runtime record还是projection？
3. 已有owner是否能表达？
4. 是否有独立consumer/lifecycle，值得新authority fragment？
5. 能否由已有事实生成，因而不应人工维护？

只有真实独立owner/consumer存在时增加source fragment。新视图需求优先扩展projection，而不是复制正文。

## 12. SEC自用与长期演进

SEC自身首先遵守同样规则：repo源码、design docs、tests、Evidence、runtime state分别保有自己的authority；documentation graph把它们连起来。

未来registry、compiler或物理地址实现可以替换，但必须保证：

- active ownership不重复；
- current meaning total preservation；
- generated views可重建；
- consumer能切换到新generation；
- old machinery在consumer-zero后删除；
- 不因迁移重新引入历史兼容服务或双写。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

SEC文档采用“一项事实一个权威来源、路径只是稳定地址、typed关系承载多维语义、视图从当前source生成”的最终模型。Stable正文只描述当前设计及其理由/边界/未决，不维护修订历史和旧路径兼容；文档完整性由registry、compiler与docs-doctor结构强制。
