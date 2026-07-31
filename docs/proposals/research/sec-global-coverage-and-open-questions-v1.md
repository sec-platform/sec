---
title: SEC 全球研究覆盖、冲突学派与真实未知 v1
status: research-evidence
domain: proposal
last-reviewed: 2026-08-01
exact-main: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
tracking: issue-225
source-ledger: docs/proposals/research/sec-global-primary-source-ledger-v1.yaml
decision-matrix: docs/proposals/research/sec-global-design-decision-matrix-v1.yaml
merge-policy: spike-default-no-merge
---

# SEC 全球研究覆盖、冲突学派与真实未知 v1

## 0. 目的

本文回答四个问题：

1. 当前全球技术检索覆盖了哪些工程问题；
2. 哪些成熟机制已经足以改变或冻结 SEC 设计；
3. 哪些技术路线存在真实冲突，SEC 为什么选择其中一边或限制使用范围；
4. 哪些结论无论再阅读多少公开资料，也必须由 SEC 自己的代码、语料、形式模型、benchmark 和物理实验决定。

本文件不声称“穷尽全球知识”。它提供可更新、可反驳、可重复的覆盖基线。新增资料只有在提供新的机制、反例、不变量、适用边界或推翻现有假设时，才应改变设计；单纯增加项目名称或引用数量不构成进展。

## 1. 检索方法与证据等级

### 1.1 优先级

```text
规范性标准
> 项目官方设计/参考手册
> 原始同行评审论文
> 官方实现仓库与测试
> 高质量工程复盘
> 二手总结
> 营销与流行度
```

最终设计主要依赖前三类。实现仓库用于确认协议能否落地和查找已知边界，但代码存在不等于机制正确、完整或适用于 SEC。

### 1.2 每项来源必须记录

- 来源身份和版本/日期；
- 它解决的原问题；
- 核心机制和前提；
- 已知不解决的部分；
- 与 SEC 哪个 owner 关联；
- `adopt | adapt | interoperability-only | reference-only | reject | defer`；
- 是否改变现有设计；
- 仍需什么 Evidence。

### 1.3 不使用“全球最佳实践”作为证明

“最佳实践”通常混合不同规模、风险、组织和运行环境。SEC 只吸收可说明前提和失败边界的机制。一个机制在 Google、Microsoft、LLVM、Linux 或 Kubernetes 中成功，也不能自动证明它适合 SEC 当前阶段。

## 2. 技术家族覆盖矩阵

| 家族 | 一手基线 | 已吸收的核心机制 | SEC 设计影响 | 仍需自身证据 |
|---|---|---|---|---|
| 多层编译器 IR | LLVM、MLIR、GCC、MIR、JVM、CLI、Wasm | 分层 IR、dialect/interface、局部验证、progressive lowering | 拒绝万能 IR；建立模型联邦 | IR 层实际边界与反特化 corpus |
| 全保真源码模型 | Roslyn、Tree-sitter、OpenRewrite、Clang | immutable snapshots、LST、trivia preservation、真实编译参数 | bytes/LST/semantic/SPM 分层 | TS/HTML/CSS round-trip 与内存成本 |
| 静态分析 | CodeQL、Datalog、Abstract Interpretation、IFDS | 关系查询、path witness、lattice、跨过程 dataflow | Impact witness、possible/unknown、Provider index | precision/recall、动态语言边界、图规模 |
| 查询式增量 | Skyframe、DICE、Salsa、Pluto | demand-driven query、动态依赖、red-green、sound rebuild | Query Contract Kernel | SEC pass benchmark、key completeness、memory/GC |
| 可重现构建/CAS | Nix、Bazel REAPI、SOURCE_DATE_EPOCH | 显式输入闭包、不可变物理对象、远程协议 | 物理 CAS 与 domain action key 分离 | Windows/Unix materialization、remote economics |
| 编译正确性 | CompCert、Alive2、Wasm validation | 形式证明、translation validation、sound/complete validator | 分级 correctness strategy | Behavior IR 可验证子集与 solver成本 |
| 等价重写 | egg、egglog | equality saturation、proof/cost extraction | 可选局部 pure rewrite Provider | 规则 soundness、预算和实际收益 |
| 形式化方法 | TLA+、Apalache、Alloy、SCXML | 时序 safety/liveness、结构反例、状态机语义 | 对关键小协议建模 | implementation refinement 与模型维护成本 |
| 授权策略 | Cedar、OPA、Zanzibar、Macaroons | default deny、forbid、关系授权、attenuation | typed semantic authorization | 真实 principal/resource模型和策略性能 |
| Effect/Capability | Koka、WASI、Landlock、seccomp | effect rows、显式 capability、OS attenuation | Effect Algebra + 双层授权 | Node/Bun/Windows/Linux 可实现能力矩阵 |
| 事务与恢复 | SQLite、ARIES、PostgreSQL WAL | WAL、redo/undo、hot journal、durability assumptions | Publication Durability Protocol | NTFS/ext4/APFS/WSL fault traversal |
| Durable workflow | Durable Functions | deterministic replay、activity separation、versioning | Run Kernel 与 domain terminal 分离 | 事件格式、升级策略、长任务体量 |
| 并发一致性 | Linearizability、Raft、CRDT | 原子点、consensus边界、join-semilattice适用条件 | canonical single writer；CRDT限于草稿 | 是否需要远程多节点 authority |
| 测试质量 | QuickCheck、libFuzzer、OSS-Fuzz、TSan、ASan、PIT | property、shrink、fuzz、sanitizer、mutation | Counterexample Registry 和分层验证 | 工具链成本、稳定 seed、native适用性 |
| Web语义 | HTML、DOM、CSSOM、Cascade、WCAG、ARIA、AccName | 多树模型、cascade语义、运行/可访问性算法 | Web domain 必须多模型 | framework动态区域、浏览器矩阵、视觉验证 |
| 跨语言组件 | Wasm Component Model、WIT、WASI | world/import/export/resource、canonical ABI、capability runtime | Provider/Port ABI | 真实多语言 Provider 与 sandbox性能 |
| 配置与收敛 | CUE、Kubernetes Conditions、Terraform、JSON Schema | constraint lattice、desired/observed、observedGeneration、plan/apply | Configuration/Reconcile domain | 配置生态 corpus、drift与secret边界 |
| 架构描述 | ISO 42010、SysML v2、SHACL | concern/viewpoint/view、模型交换、shape validation | 多视图而非一张全局图 | Workbench 信息架构和用户可理解性 |
| Provenance/供应链 | SLSA、in-toto、PROV、TUF、Sigstore、OCI、SPDX、CycloneDX | materials/builder、layout/link、透明日志、安全更新、SBOM | typed provenance + interop export | 发布基础设施、密钥治理、消费者验证 |
| API/消息 | Protobuf、OpenAPI、CloudEvents、AsyncAPI | 字段身份、公共面、event envelope、channel/message描述 | Compatibility/Event contract | 真实 consumer migration 和故障语义 |
| 可观测性/血缘 | OpenTelemetry、OpenLineage | semantic attributes、Job/Run/Dataset facets | revision-bound observed Evidence | sampling/coverage、privacy、数据量 |
| 依赖解析 | PubGrub、Cargo Resolver、Node exports、SemVer | incompatibility derivation、锁定、公共面、版本信号 | 多维 Compatibility + 可解释 resolver | Block/Provider/Target constraint规模 |
| AI治理/协议 | NIST AI RMF、MCP、SSDF | 风险组织、tool transport、secure development | AI proposal-only、transport不拥有语义 | prompt/tool攻击、上下文最小化效果 |

## 3. 真实冲突学派与 SEC 裁决

### 3.1 万能图 vs 正交模型联邦

**万能图主张**：统一 property graph 后查询简单、扩展自由。

**反方证据**：编译器、源码模型、Evidence、事务和运行观察拥有不同 authority、identity、revision 和失效规则；通用属性最终迫使消费者按字符串重建语义。

**SEC 裁决**：采用极小 Model Federation Kernel + 强类型 domain；图只在 domain 内有明确边语义。跨域通过 stable reference，不构建万能 edge store。

### 3.2 Schema-first vs code-first

**Schema-first 优点**：跨语言、生成 parser/docs、兼容管理。

**Code-first 优点**：复杂不变量表达力强、与实现接近。

**SEC 裁决**：单一 canonical contract source 生成结构 parser/schema/docs；无法声明式表达的 semantic/operational invariants 由手写 validator 拥有。禁止 TypeScript、JSON Schema、CLI 和文档四处双写字段。

### 3.3 静态模型 vs 运行 Evidence

**静态优点**：覆盖未执行路径、可提前阻断。

**运行优点**：看到真实动态绑定、资源和平台行为。

**SEC 裁决**：静态分析产生 derived/inferred candidates，runtime 产生 observed Evidence；两者都不能单独覆盖 authoritative Contract。冲突和 coverage 缺口保留，不以多数票升格。

### 3.4 完整形式证明 vs 测试/translation validation

**完整证明**：保证强，但建模与维护成本高，外部环境难覆盖。

**测试/translation validation**：现实可扩展，但只证明被检查输入和性质。

**SEC 裁决**：identity、normalization、状态机、授权等小可信核优先 property/formal；高风险 lowering 使用 per-candidate translation validation；外部运行行为使用物理 Acceptance。任何一层都不扩大自己的证明范围。

### 3.5 声明依赖 vs 动态发现依赖

**完全声明**：可重现、易缓存，但可能漏真实读取。

**动态发现**：贴近实际执行，但首次运行和非法读取处理复杂。

**SEC 裁决**：query/Provider 必须通过受控 context 读取；静态声明提供预期闭包，运行时捕获 discovered dependencies 并验证是否允许。漏依赖 fail closed；动态发现不能成为永久未声明 ambient I/O。

### 3.6 单写者 vs CRDT/自动合并

**CRDT 优点**：离线、多方、无协调协作。

**局限**：只有在状态和操作满足合并代数时才能保持不变量。

**SEC 裁决**：canonical source、semantic facts、policy、migration、release 使用 single writer + CAS；CRDT 仅允许 UI 布局、评论、presence 和未接受 proposal 草稿。

### 3.7 通用工作流引擎 vs 领域状态机

**通用引擎优点**：durable replay、调度和重试成熟。

**风险**：把业务终态、Verification、Mutation 和开发 epoch 压成一套 workflow status。

**SEC 裁决**：Run Kernel 只拥有 orchestration history/transition；各 domain 拥有自己的 typed terminal state。外部工作流可作为 executor/provider，不能成为 truth owner。

### 3.8 自研 vs 复用

**全复用风险**：外部模型反客为主，形成第二 authority。

**全自研风险**：重复数十年成熟机制，速度和正确性都差。

**SEC 裁决**：SEC 自研的是独特 authority、工程语义、责任、Impact、Mutation 和治理合同；解析器、solver、CAS、sandbox、browser、telemetry、签名等尽量通过 Provider 复用。每个 Provider 有采用、替代、失效和退役合同。

## 4. 已由公开证据充分支撑的永久不变量

以下不需要等待 benchmark 才能作为目标设计不变量：

1. Authority、Canonical、Evidence、Projection 必须分离；
2. Source bytes、lossless syntax、language semantics 和 Engineering semantics 不能合并；
3. Compiler Query DAG 与 Verification Evidence DAG 不共享语义；
4. Cache、index、materialization、journal 不自动成为 authority；
5. unknown/unsupported/not-run/stale 不能 PASS；
6. AI/tool transport不能授予工程语义写权限；
7. canonical mutation 需要 single writer、CAS、journal、readback 和 recovery；
8. 支持声明不是一个布尔值；
9. SemVer、签名、SBOM、provenance、一次测试都不能独立证明兼容或支持；
10. HTML source、runtime DOM、CSS cascade、layout 和 accessibility 必须分域；
11. 新语言/框架/Provider 不能通过 Core 名称分支接入；
12. 增量路径必须与 clean path 语义等价；
13. 状态观察必须绑定 observedRevision；
14. 同一 canonical object/state/writer/selector/validator只有一个 owner。

## 5. 必须由 SEC 自身实验裁决的问题

### 5.1 Provider 组合

不能仅凭功能表决定：

- TypeScript Compiler API 是否独立使用，还是与 ts-morph 组合；
- Tree-sitter 在 TypeScript 主线中承担容错/局部更新还是只用于其他语言；
- CodeQL/Soufflé 是否值得成为可选分析 Provider；
- OpenRewrite 风格 LST 是否需要自建 TypeScript 适配层。

需要在相同 corpus 上测：coverage、错误恢复、内存、冷/热时延、source mapping、增量失效和 round-trip。

### 5.2 Responsibility Reconstruction

全球没有一个工具可以自动恢复 SEC 所需的工程 Responsibility。必须建立人工标注 corpus，测：

- candidate precision/recall；
- owner、Effect、state、permission、transaction 边界遗漏率；
- Reconcile 人工时间；
- inline/extract/rename identity稳定性；
- AI Provider 对 token 和错误率的影响。

### 5.3 Query Graph 分区

需要测真实 SEC pass：

- 输入/输出 bytes；
- CPU、wall time、memory peak；
-重复读取；
-全局 invariant；
-可分区节点；
-小变更 invalidation；
-cancellation 和 stale result。

没有 benchmark 前，不决定 worker thread、persistent CAS、daemon 或 remote execution。

### 5.4 文件系统与进程 durability

必须在：

```text
Windows NTFS native
Linux ext4
WSL2 ext4
macOS APFS（进入正式支持前）
```

真实遍历 rename、link、fsync、directory durability、reparse/symlink、process tree、port、stream、crash 和 cleanup。SQLite/PostgreSQL 的机制只能提供设计参考，不能替代平台 Evidence。

### 5.5 Sandbox

Landlock/seccomp/WASI/Windows Job Object/AppContainer 的能力、部署难度和兼容性必须物理验证。普通 temp directory、容器或 loopback 不自动构成不受信代码 sandbox。

### 5.6 Web 动态语义

需要原生 HTML/CSS、React/TSX、另一个 framework 三组 corpus，测：

- template/source identity；
- dynamic class/style/route coverage；
- selector/cascade Impact；
- hydration/SSR/CSR；
- accessibility name/focus；
- browser runtime Evidence；
- source-preserving mutation。

### 5.7 Registry 与生态

只有真实 Block 数量、依赖冲突、版本迁移、远程 source 和供应链需求出现后，才能决定：

- PubGrub solver复杂度；
- TUF/Sigstore基础设施；
- OCI artifact layout；
-社区 trust tiers；
-remote execution/cache。

## 6. 形式模型与实验计划

### 6.1 TLA+ 模型

优先：

1. workspace writer lease generation；
2. publication WAL + crash + rollback；
3. candidate epoch + Evidence invalidation；
4. Integration Epoch + merge/readback；
5. release promotion + revoke/yank。

每个模型必须记录 assumptions、safety、liveness、fairness、状态上限和反例，并生成至少一组实现测试向量。

### 6.2 Alloy 模型

优先：

1. DomainDescriptor 和 cross-domain reference；
2. Responsibility/source/function/Block 多对多；
3. Work Package `requires/ordered/conflicts`；
4. Block/Provider resolution；
5. identity/revision collision；
6. owner/writer唯一性。

Bounded 无反例不等于全局证明，报告必须保留 scope。

### 6.3 Benchmark 统一协议

每个 benchmark：

```yaml
benchmarkId:
exactRevision:
environment:
corpus:
inputDigest:
providerVersions:
warmup:
samples:
metrics:
  wallTime:
  cpuTime:
  memoryPeak:
  ioBytes:
  nodesComputed:
  cacheHits:
  invalidatedNodes:
  outputDigest:
correctnessOracle:
```

性能数据不进入 semantic revision；但选择 Provider/增量策略必须引用可重复 benchmark。

## 7. 研究覆盖更新机制

### 7.1 触发重新检索

- canonical architecture假设被实现反例推翻；
-同类失败第二次发生；
-外部标准发布新 major/revision；
-采用的项目改变核心协议或维护状态；
-新的语言/framework/runtime/平台进入正式路线；
-性能或安全结果证明当前 Provider 不适用；
-公开事故/漏洞揭示新的根因；
-用户目标发生真实改变。

### 7.2 新资料准入

新来源必须给出：

```text
new mechanism | new invariant | new counterexample
| new applicability boundary | superseding revision
```

否则只作为阅读资料，不扩充 architecture ledger。

### 7.3 来源失效

来源被撤回、标准被 supersede、项目停止维护或链接失效时：

- 保留历史 identity；
- 标记 freshness/替代来源；
-重算依赖该来源的 decision；
-不会因来源失效自动推翻已由 SEC 自己 Evidence 证明的机制。

## 8. 完成边界

本轮全球研究完成的含义是：

- 已建立 110 项可审计一手来源基线；
- 已覆盖 SEC 当前目标涉及的主要成熟技术家族；
- 已把来源转换成 40 项可拆分设计裁决；
- 已列出冲突学派和明确 SEC 的选择；
- 已区分永久不变量和必须实验的未知；
- 已给出形式模型、benchmark 和物理验证计划。

它不意味着：

- 所有来源都已做源码级实现审计；
- 所有技术都应被 SEC 引入；
- 所有设计已经进入 canonical authority；
- #226 可以整体合并；
- #215/#223 可以被研究替代；
- SEC 已经实现全球最佳架构。

下一步必须把决策矩阵逐项投影成聚焦 canonical delta 或 Evidence Spike，并由自动 selector 按最新 `main`、真实关键路径和冲突关系选择。