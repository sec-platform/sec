---
title: 外部 Provider 政策
status: stable
domain: external-provider
last-reviewed: 2026-07-29
---

# 外部 Provider 政策

本文拥有外部工具、MCP、语言/编译器基础设施、程序分析器、构建/测试/发布服务和 Agent 工具的 authority、安全、评估、接入、吸收、替换与退役政策。具体候选、品牌、版本、当前路由、A/B结果和复核状态只存在于 `docs/governance/external-capability-ledger.yaml` 及相应 Evidence。

## 目标

SEC 不应因目标宏大而重造所有轮子，也不能把外部工具的能力、宣传或内部数据模型直接变成 Core truth。

外部能力的目标是：

> 以最小、可替换、可验证的组合补足 SEC 缺失能力；把结果纳入统一 identity、Evidence、authority、transaction、Verification 和 lifecycle 边界；成熟机制被吸收后删除重复实现。

引入一个工具不是成果。只有它解决了明确问题、现实提升经过同条件验证、failure/security/upgrade成本可接受、consumer已迁移且没有第二 authority，才形成工程结果。

## 能力角色

外部能力只能处于以下一种主要角色：

- **Core substrate**：成熟基础库或编译器API，被 SEC 自己的 contract/validator 包裹；不能拥有 SEC semantic authority。
- **Replaceable Provider**：提供 syntax、symbol、graph、runtime、browser、build、security 或其他 Evidence。
- **Adapter**：把 SEC canonical contract转换为外部系统调用，或把结果归一为 SEC DTO/Evidence。
- **Workbench projection**：只读展示或导航。
- **Verification / conformance tool**：执行一个明确 Gate 或交叉验证。
- **Development utility**：仅用于仓库开发，不进入产品运行面。
- **Project-specific utility**：只服务某个 corpus/policy/fixture。
- **Rejected / superseded / watch**：有明确理由、触发条件和复核时间。

外部工具不能拥有 Engineering IR、Entity/Fact identity、source owner、authorization、actual Delta、Impact truth、Verification decision、publish/merge decision、rollback terminal state 或 release authority。

## 能力类别

评估时按最小能力拆分，不按品牌整体判断：

- Language Frontend：parse、type、symbol、definition/reference、module resolution；
- Code Index / Graph：context retrieval、caller/callee、dependency、path trace、reverse/diff impact；
- Deep Program Analysis：CFG/PDG、taint、data flow、security path；
- Source Transformation：AST/LST/codemod、格式和comment preservation；
- Runtime Observation：trace、coverage、profile、network/process/browser observation；
- Build / Package / Test：install、bundle、cache、sandbox、container、browser；
- Policy / Schema / Solver：validation、compatibility、constraint solving；
- Provenance / Supply Chain：SBOM、signature、attestation、vulnerability；
- Workflow Runtime：retry、durability、compensation、scheduling；
- IDE / Visualization / MDE：navigation、projection、structured editing；
- Agent / MCP：向模型暴露query或operation。

一个项目可能同时提供多类能力；每类独立决策、授权和退役。不能因为使用其 parser 就同时接受其graph、cloud、MCP和mutation权限。

## 强制评估流程

```text
Discovery
→ Problem Definition
→ Primary-source Research
→ Capability Decomposition
→ SEC Ownership Mapping
→ Security / License / Data Review
→ Integration Cost and Failure Model
→ SEC + Conformance Corpus A/B
→ Decision
→ Bounded Integration or Design Absorption
→ Consumer Migration
→ Duplicate Removal
→ Version Pinning and Evidence Freeze
→ Revalidation / Replacement / Retirement
```

### Discovery

来源可以来自编译器、语言、IDE/MDE、程序分析、安全、CI/构建/发布、工业系统工程、Agent工具、论文和大型项目基础设施。不能只搜索名称包含 AI、Graph、Compiler 或当前流行品牌的项目。

### Problem Definition

在研究工具前必须写清：

- SEC 当前缺失的具体 capability 和 consumer；
- 当前自研/人工流程的错误率、延迟、token、维护或安全成本；
- 需要的是 authority、Evidence、候选、变换、验证、执行还是可视化；
- 输入、输出、coverage、freshness、failure和完成判据；
- 明确不需要的能力与禁止权限。

禁止先安装工具再寻找用途，也禁止把“可能以后有用”当作长期 standing dependency。

### Primary-source Research

至少核对官方文档、源码/公共API、release notes、license、security policy、issue/limitations、benchmark方法、install/build脚本、网络/telemetry/data boundary、增量/stale/failure behavior和维护状态。

营销页面、搜索摘要、社区转述和作者benchmark只能提供候选线索。多个页面引用同一原始材料只算一个证据来源。

### Capability Decomposition 与 Ownership Mapping

把项目拆到可单独替换和验证的能力，并为每项选择唯一 SEC owner：Core substrate、domain Provider、Adapter、Projection、test/fixture、project utility或reject。

若同一能力已经由 SEC code contract拥有，外部工具只能作为交叉 Evidence、实现 substrate或替代候选，不能建立第二结果源。若决定吸收其设计，必须明确哪些算法/contract进入SEC、哪些品牌/格式不进入、何时删除外部依赖或自研重复。

### Security、License 与 Data Review

必须审查：

- license、专利、copyleft、商用/再分发和生成物权利；
- package provenance、maintainer、release/signature、dependency和install script；
- native/FFI、MCP server、browser、container、credential、filesystem、process和network权限；
- source/code/context是否上传，数据保留、训练、telemetry和区域；
- secret/environment读取、日志/trace泄漏和输出注入；
- untrusted project/tool output对Agent或parser的prompt/code injection；
- update/revocation/incident response和offline/fail-closed行为。

MCP server、native dependency、language server和云服务都视为高权限Provider。版本固定和本地运行不自动消除风险；需要执行不受信代码时必须有独立 sandbox authority。

### A/B 验证

至少在两类差异显著的 corpus 上进行同条件验证：

- SEC 自身：canonical contracts、IR、transaction、CI和工具链密集；
- 一个复杂conformance/brownfield corpus：多package、runtime、browser、release、治理和历史负担密集。

按能力记录：

- task success、precision/recall和漏掉关键consumer的次数；
- false relation、false confidence、unknown/unsupported和stale行为；
- source excerpt/reference可回看性；
- index/build时间、wall-clock、CPU、memory、disk、network；
- Agent工具调用数、输入/输出token和选择干扰；
- incremental update、revision binding和失败恢复；
- language/framework/platform coverage；
- install、upgrade、license、安全和运维成本；
- 与SEC现有实现的重复、迁移和删除成本。

性能宣称必须同机器、版本、输入、warm/cold模式和采样协议比较；不能比较两次孤立运行。作者提供的benchmark不能替代SEC自己的A/B。

## Decision Taxonomy

每个候选只能进入明确状态：

```text
absorb-design
integrate-provider
integrate-adapter
use-as-development-tool
use-as-conformance-tool
retain-project-specific
watch-with-trigger
superseded
reject-with-rationale
retired
```

禁止用 `maybe`、`later`、`looks useful`、`temporarily keep everything` 作为长期状态。

每个 decision 至少绑定：problem/capability、owner、version/license、scope、security/data边界、A/B Evidence、consumer、duplicate to remove、upgrade/revalidation trigger和exit/retirement。

## Provider Contract

所有产品 Provider 输出至少绑定：

```text
providerId / providerRevision
capabilityId / contractRevision
sourceRevision / targetRevision / scope
coverage and unsupported regions
freshness and invalidation rule
authority class / confidence where applicable
diagnostics and failure classification
unresolved / ambiguous / conflicting regions
evidence references and raw artifact digest
resource / network / execution boundary
```

Provider输出首先是不受信输入。SEC adapter必须canonicalize、validate、bound output、strip secrets/absolute host details并保留raw artifact引用；不能因parse成功就把它写入IR。

源码bytes只证明物理内容；AST/symbol/graph通常是derived或inferred；runtime trace只对应具体环境和路径；LLM摘要永不直接升格。Predicted impact、Provider candidate impact、canonical Impact、actual Delta和Verification safety是不同对象。

Provider unavailable、partial或stale时，默认产生明确unsupported/not-run/unknown，而不是返回空结果或旧结果。只有明确Gate/contract要求该Provider时才阻断整体操作。

## Agent 与 MCP 工具面

日常工具面遵循最小充分原则：

- 精确文件/符号/错误已知时使用native file/search/Git/compiler工具；
- 入口未知或跨文件context任务，最多启用一个daily context Provider；
- canonical architecture、IR、transaction、cross-repo和大型diff任务，按需启用一个architecture Provider；
- taint/data-flow/security使用专门security Provider，普通调用图不能替代；
- Brownfield census可由orchestrator运行多个Provider，但不把全部工具常驻暴露给Agent。

功能重叠的standing MCP不得同时开启。原因包括选择成本、token/延迟、stale状态、冲突答案和把工具共识误当事实。

MCP只暴露最小read/query或显式bounded operation。默认禁止任意shell、rename、write、setup、credential和unbounded query；需要写入时仍经SEC Mutation/transaction或仓库正式开发流程。

具体工具路由、版本和当前启用状态属于external capability ledger和`sec-external-capability-governance` Skill，不复制到本文。

## 集成与吸收

### integrate-provider

通过版本化adapter隔离品牌/格式；保持可替换；保存coverage/freshness/failure；consumer只依赖SEC contract。

### integrate-adapter

Adapter只拥有协议转换、认证、调用和结果归一；不拥有上游canonical语义或下游publish decision。

### absorb-design

把经验证的通用算法、状态机或边界提炼到SEC唯一owner；建立自己的types、validator、tests、migration和Evidence；完成consumer迁移后删除重复实现。不得复制许可证不允许的源码，也不得保留品牌数据模型作为隐形Core。

### development / conformance tool

明确不进入产品package、runtime、public API、support claim和用户数据面；锁定依赖与CI/本地入口；退出时删除配置、cache、generated files和Skill路由。

## 版本、升级与 Freshness

Provider版本、contract revision、source revision和index revision必须分离。工具升级不能沿用旧A/B、安全和兼容结论；至少在重大版本、API/schema变化、license/security事件、dependency/runtime变化、stale incident或consumer扩展时重新验证。

Index或缓存必须能证明对应的source revision、coverage和failed regions。无法证明freshness时结果invalidated；不得因查询仍返回内容就视为当前。

自动更新默认禁止用于高权限Provider和merge/release authority。升级先在隔离candidate验证，再切consumer；失败可回到旧validated version或明确unsupported。

## Failure 与降级

Provider failure不能改变canonical semantics或扩大权限。降级策略必须逐能力定义：

- fallback到更窄可信native能力；
- 保留unknown并阻止需要完整coverage的操作；
- 使用旧结果但明确invalidated/stale，仅供历史导航；
- Gate要求该Provider时返回unsupported/failed而不是假PASS。

不得用另一个功能相近Provider的成功静默覆盖第一个Provider失败；若组合Evidence，必须保留独立来源和竞争解释。

## Duplicate Removal

引入外部能力时必须列出：现有重复代码/Skill/MCP/脚本/文档、迁移consumer、parity方法和删除条件。Provider被吸收或替换后，旧entry、config、dependency、generated state、cache、workflow、Skill路由和文档必须退役。

“保留备用”只有在有真实failover contract、独立health/freshness和定期physical proof时成立；否则是长期双authority和维护负担。

## 退役与替换

触发条件包括重大版本或license变化、安全事件、维护停止、重复stale/错误、原生能力达到parity、无真实consumer、成本超过收益、Provider协议被更好实现替代或数据边界不再可接受。

退役流程：

```text
freeze new use
→ identify consumers and evidence
→ choose replacement / native path / unsupported outcome
→ migrate and verify parity
→ remove entry/config/dependency/cache/permissions
→ invalidate old evidence and support claims
→ preserve historical decision and incident record
```

退役不要求删除历史Evidence，但历史结果必须明确source revision和invalidated状态。

## 完成判据

一个Provider接入只有在：能力和owner明确、security/license/data review完成、A/B达到预设判据、adapter fail closed、coverage/freshness可见、consumer迁移、duplicate移除、upgrade/revalidation/retirement闭环并进入clean package/support matrix后，才能被称为产品能力。
