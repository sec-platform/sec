---
title: SEC 外部能力吸收与 Provider/MCP 政策
status: active
last-reviewed: 2026-07-23
---

# SEC 外部能力吸收与 Provider/MCP 政策

本文是SEC对开源项目、商业工具、编译器基础设施、程序分析器、MCP、Agent工具和工程方案进行持续调研、A/B、复用、吸收、替换和退役的唯一政策。机器状态由`external-capability-ledger.yaml`拥有。

目标不是“把所有工具都安装”，而是：

> 持续发现成熟能力，明确它们解决的真实问题，在SEC/Nexus真实Corpus上验证，选择最小组合，并把外部结果纳入SEC统一的authority、evidence、transaction和verification边界。

## 1. 基本原则

1. 不因SEC目标宏大而重新发明所有轮子。
2. 不因某项目流行、宣传强或工具数量多就直接引入。
3. 不同时把大量功能重叠的MCP暴露给Codex。
4. 外部Provider可错、可漏、可陈旧，不能进入可信核心。
5. 每引入一项能力，必须删除或阻止一项自研重复。
6. 版本、许可证、运行环境和数据边界必须明确。
7. 工具只负责其可证明的层级，不允许能力越级宣传。
8. 研究结论必须绑定版本和日期；升级后重新验证。
9. 当前最优工具可以替换，接口和Evidence合同保持稳定。
10. SEC最终向用户暴露统一高层接口，而不是外部工具品牌集合。

## 2. 外部能力分类

| 类别 | 解决的问题 | SEC中的位置 |
|---|---|---|
| Language Frontend | AST、类型、定义、引用、module resolution | Source Program Provider / Target Backend substrate |
| Code Index / Graph | 调用、依赖、符号、上下文和影响候选 | Source Evidence Provider |
| Deep Program Analysis | CFG、PDG、taint、data flow、安全路径 | Verification / Security Provider |
| Source Transformation | 无损AST/LST、codemod、格式保持 | Source Mutation Adapter |
| Language Workbench / MDE | DSL、结构模型、投影编辑、生成 | Authoring和Workbench设计参考 |
| Specification Workflow | Spec、Plan、Task和Agent流程 | Authoring/Agent workflow参考 |
| Workflow Runtime | 长任务、重试、恢复、补偿 | Mutation orchestration参考或基础设施 |
| Reproducible Build | 确定性构建、原子切换、回滚 | Build/Release参考 |
| Provenance / Supply Chain | 材料、步骤、签名、attestation | Evidence/Release Provider |
| Policy / Constraint | schema、配置和约束验证 | Policy Pack或Validator substrate |
| Component Contract | imports/exports、ports、跨语言接口 | Block/Port参考 |
| IDE / Visualization | 图、导航、编辑和人机操作 | Workbench Projection |
| Agent Tool / MCP | 向模型暴露查询和操作 | 受控Tool Adapter，不是authority |

## 3. 通用吸收流程

每个候选必须经过：

```text
Discovery
→ Problem Definition
→ Primary-source Research
→ Capability Decomposition
→ SEC Ownership Mapping
→ Security/License Review
→ SEC + Nexus A/B
→ Decision
→ Integration/Absorption
→ Conformance Tests
→ Duplicate Removal
→ Version Pinning
→ Revalidation/Retirement
```

### 3.1 Discovery

来源包括：

- 编译器和语言社区；
- IDE和MDE；
- 程序分析和安全；
- Agent/Coding工具；
- CI、构建、发布和供应链；
- 工业系统工程；
- 学术论文；
- 真实大型项目的自建基础设施。

不能只搜索名称中包含“AI”“Graph”“Compiler”的项目。

### 3.2 Problem Definition

先写清：

- SEC当前具体缺什么；
- Codex或用户在哪类任务反复浪费时间；
- 当前自研实现的错误、性能或维护成本；
- 需要事实、候选、编辑、验证还是可视化；
- 完成标准和不需要的能力。

禁止先选工具再寻找使用理由。

### 3.3 Research

必须优先查：

- 官方README和文档；
- source code；
- release notes；
- license；
- issue/limitations；
- benchmark方法；
- 数据和网络边界；
- 增量、staleness和失败行为。

第三方宣传只能作为候选线索。

### 3.4 Capability Decomposition

将工具拆成最小能力，不按品牌整体判断。例如代码图拆成：

- task context retrieval；
- definition/reference；
- caller/callee；
- path trace；
- reverse impact；
- diff impact；
- process/cluster；
- data flow；
- cross-repo contract；
- freshness；
- source excerpt；
- mutation/refactor；
- visualization。

### 3.5 Ownership Mapping

每项能力只能是：

- SEC Core owner；
- SEC domain IR owner；
- replaceable Provider；
- Adapter；
- Workbench Projection；
- test/fixture tool；
- project-specific utility；
- rejected/superseded。

外部工具不能成为Engineering IR、identity、authority、Mutation、actual Delta或Verification Decision的owner。

### 3.6 A/B验证

至少在两类Corpus上验证：

- `sec-platform/sec`：canonical、transaction、IR和工具链密集；
- `QzCrane/nexus`：多package、浏览器扩展、协议、运行时、发布和治理密集。

记录：

- 任务成功率；
- 找到正确文件和符号的precision/recall；
- 漏掉关键消费者的次数；
- 错误关系和错误自信；
- 工具调用数；
- 输入/输出token；
- wall-clock；
- 索引时间和资源；
- stale行为；
- 语言/框架覆盖；
- 安装和升级成本；
- 对Codex工具选择的干扰；
- 安全和许可证风险。

不接受只由工具作者提供的benchmark作为SEC选型证据。

### 3.7 Decision Taxonomy

```text
absorb-design
integrate-provider
integrate-adapter
use-as-development-tool
use-as-conformance-tool
retain-project-specific
superseded
reject-with-rationale
watch
```

不得使用`maybe`、`later`、`looks useful`作为长期状态。

## 4. Codex最小图能力

Codex已经拥有文件读取、文本搜索、Git、编辑、终端、编译和测试。图工具只应补足原生工具成本最高的四项：

```text
1. Task Context
   按任务/符号返回最相关的真实源码、路径和行号

2. Trace
   入口到目标、caller/callee和跨文件跳转

3. Reverse Impact
   修改符号、类型、模块或Diff可能影响的消费者

4. Freshness
   索引对应什么source revision、覆盖什么、哪里失败或未同步
```

最小统一接口：

```text
explore(question | symbol | file | diff)
→ source excerpts
→ relation/path
→ reverse impact candidates
→ coverage/freshness/diagnostics
```

不需要日常向Codex暴露十几个相似查询工具。

## 5. 极限优化的工具模式

### 5.1 Direct Mode

使用条件：

- 文件和错误位置已知；
- 单模块小改；
- 精确字符串、配置或测试失败；
- 调用关系不复杂。

工具：

```text
Codex原生搜索、文件、Git、TypeScript和tests
```

不开代码图MCP。

### 5.2 Daily Context Mode

使用条件：

- 入口未知；
- 普通跨文件任务；
- 需要相关源码、调用路径和局部影响；
- 希望减少重复grep/read。

约束：

- 只启用一个Daily Context Provider；
- 工具面尽量只有一个综合查询入口；
- 返回真实源码，而不仅是摘要；
- 结果用于找路，不用于最终证明。

当前评估候选：

```text
CodeGraph：若进入正式 A/B，只评估一个综合探索入口
```

在SEC/Nexus A/B、版本/license/data-boundary和decision evidence完成前，它不是默认路由，也不应被描述为 active Provider。

### 5.3 Architecture Mode

触发条件：

- canonical shared types；
- Engineering/Application/Behavior/Program IR；
- identity、revision、Fact/Assertion；
- Pipeline、Lowering、Source Owner、Operation Registry；
- Delta、Impact、Verification；
- lease、CAS、journal、publish、rollback、recovery；
- 公共API和跨package合同；
- 大型Diff或预计影响多个模块；
- 完整执行流程；
- 跨仓协议。

约束：

- 关闭功能重叠的Daily Context Provider；
- 临时启用一个Architecture Provider；
- 只读认知优先；
- 修改仍通过源码编辑或SEC Mutation；
- 完成后关闭，避免长期工具面膨胀。

当前已观察的开发工具：

```text
GitNexus：query/context/impact/detect_changes；
跨仓时才使用group能力。
```

这只记录当前 Agent operating environment 的可用工具，不构成 repository-specific benchmark或默认选型。默认禁用任意rename、任意Cypher和自动setup，除非Work Package明确授权。

### 5.4 Security Mode

普通代码图不能证明数据流和安全属性。

按需使用：

- CodeQL；
- Joern/CPG；
- Semgrep；
- language/compiler security checks；
- fuzzing和runtime trace。

结果进入独立Security Assertions，不与普通调用图混为一类。

### 5.5 Brownfield Census Mode

可以并行运行多个Provider，但：

- 不把它们全部暴露为Codex常驻MCP；
- 由SEC importer/orchestrator统一执行；
- 每个结果保留provider identity、coverage和冲突；
- 不按多数票合并；
- 输出进入Source Program Model和Evidence Ledger。

## 6. CodeGraph与GitNexus共存政策

### 6.1 日常是否同时开启

**不同时常驻。**

原因：

- 功能重叠；
- 增加Codex选择成本；
- 相同问题可能得到不一致的图答案；
- 增加token、延迟和stale状态；
- 容易让模型把工具共识误当事实。

### 6.2 GitNexus MCP何时开启

只在Architecture Mode触发时开启。普通日常开发保留其CLI和固定依赖即可，不需要常驻MCP。

### 6.3 GitNexus自动生成内容

禁止外部工具：

- 生成或改写canonical AGENTS；
- 生成第二套Skills；
- 改写Host Projection authority；
- 把工具描述注入长期产品目标。

GitNexus分析命令应使用不生成Agent文档的模式。工具版本固定，升级单独评估。

### 6.4 最终验证

无论使用哪种图工具，最终依据仍然是：

```text
current source bytes
+ exact Git diff
+ TypeScript Compiler/typecheck
+ focused/affected/contract tests
+ required CI/runtime evidence
```

## 7. Provider输出的证据等级

| 输出 | 默认类型 | 可否直接权威化 |
|---|---|---:|
| 真实源码bytes和位置 | Source Evidence | 只证明该revision的物理内容 |
| AST、定义、类型、引用 | Derived Source Assertion | 否 |
| import/export | Derived Source Assertion | 否 |
| caller/callee | Derived或Inferred Assertion | 否 |
| dynamic dispatch候选 | Inferred Assertion | 否 |
| process/cluster/community | Architecture Candidate | 否 |
| blast radius/diff impact | Predicted Impact Evidence | 否 |
| LLM业务摘要 | Explanation | 永不直接升格 |
| runtime trace | Observed Assertion | 仅对应环境、时间和输入 |
| static security finding | Security Assertion | 需验证source-to-sink和可达性 |
| test结果 | Verification Evidence | 只证明测试性质 |
| CI结果 | Execution Evidence | 不是语义或设计authority |

## 8. 升格状态机

```text
transient
→ recorded-evidence
→ corroborated
→ authority-review-required
→ adopted-derived-fact
或
→ adopted-authoritative-fact
或
→ rejected
或
→ unresolved
或
→ expired
```

### 8.1 transient

- 临时找路；
- 用后即丢；
- 不污染Evidence Ledger。

### 8.2 recorded-evidence

只有当结果改变以下任一项时持久化：

- Work Package范围；
- 风险和Verification；
- 架构Decision；
- Brownfield Adopt/Normalize；
- Provider覆盖缺口；
- competing explanation；
- 退役判断。

### 8.3 corroborated

通过一种或多种独立证据复核：

- current source；
- compiler/LSP；
- second independent Provider；
- runtime trace；
- test or reproduction；
- human inspection。

独立Provider一致只是corroboration，不是authority。

### 8.4 Authority Decision

必须记录：

- decision identity；
- decision maker或policy；
- scope；
- accepted/rejected assertions；
- rationale和evidence；
- assumptions；
- validity和expiry。

## 9. Evidence最小合同

```yaml
schema: sec-provider-evidence-v1
id: <evidence-id>
provider:
  id: <provider-id>
  version: <exact-version>
  configurationDigest: <digest>
source:
  repository: <owner/repo>
  revision: <exact-sha>
  treeDigest: <digest|null>
observedAt: <timestamp>
query:
  normalized: <query>
  scope: <repo/package/file/symbol/diff>
result:
  digest: <digest>
  assertionKinds: []
coverage:
  declared: <description>
  measured: <metric|null>
confidence:
  provider: <value|null>
  secAssessment: <value|null>
diagnostics: []
unresolvedRegions: []
limitations: []
authority: <derived|observed|inferred|explanation>
promotionState: <transient|recorded-evidence|corroborated|review-required|adopted|rejected|unresolved|expired>
invalidation:
  onSourceRevisionChange: true
  onProviderUpgrade: true
  expiresAt: null
```

不得把整段MCP聊天输出直接存入账本。

## 10. Predicted Impact与Actual Delta

严格区分：

```text
Provider predicted impact
≠ SEC planned Impact
≠ isolated apply后的actual Delta
≠ Verification证明的安全范围
```

- Provider用于发现候选消费者和选择测试。
- Mutation planner依据canonical snapshot产生planned Delta/Impact。
- isolated apply后由SEC重建snapshot并计算actual Delta。
- actual Delta超出允许范围立即阻断。
- Verification Receipt记录实际执行和证据。

AI和Provider都不能提交actual Delta作为事实。

## 11. 研究和吸收账本

每个工具至少记录：

- 名称、仓库、版本、license；
- 解决的具体问题；
- 输入、输出和数据边界；
- parser基础：regex、AST、compiler、LSP、runtime或LLM；
- 语言和框架覆盖；
- 增量和freshness；
- CLI/MCP/API工具面；
- 网络、telemetry和secret风险；
- SEC/Nexus benchmark；
- 与现有工具重叠；
- 决策；
- 删除的自研重复；
- integration owner；
- revalidation和retirement条件。

使用`SEC-External-Capability-Ledger-Template-V1.yaml`。

## 12. 重点参考域

以下是持续扫描的能力域，不代表必须引入具体项目：

- Language workbench：MPS、EMF、Xtext、Langium、Sirius；
- structured/source transformation：OpenRewrite、ast-grep、compiler transforms；
- source facts/index：TypeScript Compiler、SCIP、Glean、Kythe；
- graph/context：CodeGraph、GitNexus及同类；
- deep analysis：Joern、CodeQL、Semgrep；
- specification workflow：Spec Kit及同类；
- component contract：WIT、Smithy、TypeSpec；
- constraint/config：CUE及同类；
- workflow/recovery：Temporal类机制；
- deterministic build/rollback：Nix类机制；
- provenance：in-toto、SLSA类机制；
- platform catalog：Backstage类机制；
- content identity：Unison类机制；
- system engineering：Capella/Arcadia类机制。

吸收的是机制、协议和已验证实现，不是品牌堆叠。

## 13. 依赖引入门

引入前必须回答：

1. 当前main的真实问题是什么？
2. 现有能力为何不足？
3. 候选解决哪一个最小能力？
4. 是否有更小的标准或库？
5. 会删除什么自研重复？
6. 是否建立第二authority或writer？
7. license是否允许目标使用方式？
8. 是否访问网络、上传源码或运行native binary？
9. Windows/Linux/macOS和Bun/Node兼容如何？
10. 索引和缓存如何失效？
11. 工具失败时SEC如何降级？
12. 升级和退役如何完成？

没有明确删除或长期收益时，不引入。

## 14. 安全边界

- MCP server和native dependency视为高权限代码；
- 固定版本和校验来源；
- 默认本地运行，不上传私有源码；
- 明确网络、telemetry、模型provider和credential使用；
- 工具不能写canonical控制文件；
- 工具写工作区必须由Work Package显式授权；
- hostile或malformed Provider output不能破坏parser、Evidence Ledger或IR；
- 大型索引进程遵守Zero Neutral Work：非激活状态不持续耗费资源。

## 15. 周期复核

触发重新评估：

- Provider重大版本；
- license变化；
- 安全事件；
- SEC/Nexus规模或语言变化；
- Codex原生能力显著提升；
- 新工具在同类任务上明显更优；
- 当前工具连续出现错误、stale或资源问题；
- SEC已经原生吸收对应能力。

复核后可以：

- 保持；
- 更换Provider；
- 降为CLI按需工具；
- 只保留Conformance用途；
- 退役并迁移Evidence和配置。

## 16. 未完成 A/B 时的最小运行边界

在完成正式A/B前，不设置 evidence-backed Daily/Architecture默认 Provider，只采用以下临时运行边界：

```text
Direct Mode:
  Codex原生工具

Daily Context Mode:
  默认不启用
  CodeGraph仅为待研究候选

Architecture Mode:
  仅在AGENTS/Work Package要求时启用一个只读Provider
  当前环境已观察GitNexus，但尚未完成本政策的A/B选型门

Security Mode:
  专项静态/数据流/模糊测试工具

Final Authority:
  SEC canonical sources + compiler + tests + CI/runtime evidence
```

该边界是可替换工程策略，不是Provider录用、Benchmark PASS或SEC永久产品定义。实际可用版本、freshness、decision和缺口只由ledger记录。
