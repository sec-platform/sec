---
title: SEC 全球技术谱系与机制采纳审计 v1
status: draft
domain: proposal
tracking: issue-225
exact-main: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
merge-policy: spike-default-no-merge
last-reviewed: 2026-08-01
---

# SEC 全球技术谱系与机制采纳审计 v1

> 本文是 `docs/proposals/sec-complete-architecture-synthesis-v1.md` 的来源审计附件。它不是 canonical authority，也不声称已经穷尽世界全部信息。任何有限研究都无法证明“搜索了所有资料”；本审计采用可复查的覆盖策略：优先规范、官方架构、原始论文和官方实现文档，记录覆盖边界，并把每项外部机制裁决为 `adopt`、`adapt`、`provider-only`、`interoperate-only`、`study`、`defer` 或 `reject`。

## 1. 研究纪律

### 1.1 来源等级

1. **规范性标准**：语言、协议、文件格式、Web 与供应链标准。
2. **官方项目架构/实现文档**：当前真实机制与边界。
3. **原始同行评审论文/技术报告**：算法和不变量的原始论证。
4. **官方测试语料/基准**：可执行反例与兼容性证据。
5. **近期实证研究**：用于发现失败模式，不自动升格为架构 authority。
6. 博客、媒体和二手总结只用于发现线索，不作为关键裁决依据。

### 1.2 四类机制

- **语义机制**：对象、identity、类型、关系、约束、状态和转换的含义。
- **物理机制**：文件、进程、网络、缓存、执行、持久化、隔离与发布。
- **证明机制**：验证、Evidence、反例、模型检查、测试与来源链。
- **互操作协议**：外部工具、语言、IDE、Agent、API、包与生态交换格式。

外部系统只能在自己的机制类别内被吸收。例如 Bazel/Nix 的 CAS 和封闭输入属于物理机制，不能定义 SEC 的 semantic revision；Cedar/Zanzibar 的授权模型不能直接取得 source owner；CodeQL/Joern 的分析图不能成为 Engineering IR。

### 1.3 裁决字段

每项机制都回答：

```text
解决什么问题
隐含哪些前提
SEC 吸收什么
SEC 明确拒绝什么
映射到哪个唯一 owner
需要什么合同、反例、benchmark 或 physical Evidence
```

## 2. 编译器 IR、语言工作台与目标后端

### MLIR

- 来源：<https://mlir.llvm.org/docs/>
- 核心：多层 IR、Dialect、Operation/Type/Attribute、trait/interface、局部 verifier、显式 pass nesting 与并行约束。
- 裁决：**adapt**。
- 吸收：分层 IR、接口驱动扩展、每层 `raw → validated → immutable`、pass 前后验证、禁止按 dialect 名称散布特化。
- 拒绝：MLIR Operation/SSA 不能成为 Engineering IR；目标优化关系不能反向拥有业务责任、权限和 Provenance。
- Owner：Target Compilation / Provider Protocol。
- 证明：多层 differential lowering、缺 dialect/interface fail-closed、同输入 byte-stable。

### LLVM IR

- 来源：<https://llvm.org/docs/LangRef.html>
- 核心：强类型 SSA、CFG、data layout、calling convention、verifier。
- 裁决：**interoperate-only**。
- 用途：native target backend 或外部 Provider。
- 拒绝：LLVM IR 不表达 Semantic Responsibility、Policy、Permission、Fact Assertion、Workspace authority。

### GCC GIMPLE/SSA

- 来源：<https://gcc.gnu.org/onlinedocs/gccint/GIMPLE.html>
- 核心：语言前端与机器后端之间的简化三地址/SSA 表示。
- 裁决：**study**。
- 价值：校准 IR 分层、CFG/SSA 和 pass 边界；不复制 GCC 内部树为跨语言工程模型。

### JVM Class File / Bytecode Verification

- 来源：<https://docs.oracle.com/javase/specs/jvms/se25/html/>
- 核心：classfile、操作数栈类型状态、链接和验证。
- 裁决：**interoperate-only**，归 JVM Target Provider。
- 拒绝：JVM verifier 只证明字节码结构/类型安全，不能证明 SEC Contract、Effect 或业务 Acceptance。

### WebAssembly Component Model / WIT / WASI

- 来源：<https://component-model.bytecodealliance.org/>、<https://github.com/WebAssembly/WASI/blob/main/docs/Capabilities.md>
- 核心：typed interfaces/worlds、imports/exports、component composition、link/runtime capabilities。
- 裁决：**adapt** 为插件/Provider 的可移植 ABI 候选。
- 吸收：typed Port、显式 capability injection、host/guest 分离。
- 拒绝：WIT 只描述接口；不能拥有 Responsibility、Effect policy、Mutation 或 Verification。

### GraalVM Truffle

- 来源：<https://www.graalvm.org/latest/graalvm-as-a-platform/language-implementation-framework/>
- 核心：AST interpreter、partial evaluation、instrumentation、多语言 runtime。
- 裁决：**study**，仅在运行型 Language Provider 有真实消费者时评估。

### Spoofax / SDF3 / Statix / Stratego

- 来源：<https://spoofax.dev/>、<https://spoofax.dev/references/statix/>
- 核心：声明式 syntax、scope graph 名字解析、constraint-based static semantics、term transformation。
- 裁决：**adapt concepts**。
- 吸收：名字解析 path witness、约束求解、语言实现分面。
- 拒绝：language workbench 不能成为 SEC 全系统 runtime；Statix 结论默认仍是 Provider Evidence。

## 3. 全保真源码、名字解析、索引与变换

### TypeScript Compiler API

- 来源：<https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API>
- 裁决：TypeScript 第一 frontend 的主要权威 Provider。
- 用途：真实 module resolution、symbol/type/declaration/reference、incremental Program。
- 边界：Compiler API 输出先进入 versioned Source Program Model，不能直接写 Engineering IR。

### Tree-sitter

- 来源：<https://tree-sitter.github.io/tree-sitter/>
- 核心：增量 concrete syntax tree、错误恢复、跨语言 grammar/query。
- 裁决：**adapt** 为 syntax/embedded-language Provider。
- 证明：full/incremental tree parity、错误语料、coverage/unknown。

### Roslyn

- 来源：<https://github.com/dotnet/roslyn/blob/main/docs/wiki/Roslyn-Overview.md>
- 核心：不可变、线程安全、全保真 syntax trees；Compilation/Symbol/SemanticModel 快照；结构共享。
- 裁决：**adapt architecture**。
- 吸收：node/token/trivia、immutable snapshot、并发读取、refactoring 产生新快照。
- 拒绝：Roslyn 的 .NET 对象模型不是通用 Source Program Model。

### OpenRewrite Lossless Semantic Trees

- 来源：<https://docs.openrewrite.org/concepts-and-explanations/lossless-semantic-trees>
- 核心：类型归因、格式保真、recipe/visitor、大规模源码迁移。
- 裁决：**adapt** 为 Source Transform Provider 参考。
- 关键修正：SEC Mutation 不能只保存目标 diff；还要保存匹配前提、变换规则、must-preserve 和适用 coverage。

### Clang LibTooling / AST Matchers / Refactoring Engine

- 来源：<https://clang.llvm.org/docs/Tooling.html>、<https://clang.llvm.org/docs/RefactoringEngine.html>
- 裁决：**provider-only**，用于 C/C++。
- 吸收：compile database identity、matcher→binding→replacement、refactoring action。
- 拒绝：不稳定 Clang AST API 不进入 Core public contract。

### Coccinelle Semantic Patch Language

- 来源：<https://coccinelle.gitlabpages.inria.fr/website/>、Linux Kernel Coccinelle 文档。
- 核心：跨文件语义模式、控制流匹配、report 与 patch 分离。
- 裁决：**adapt**。
- 用途：API migration、规则支持的 Brownfield operation。
- 约束：semantic patch 报告会误报；必须经过 source owner、Impact、build/behavior verification。

### Scope Graphs / Statix

- 来源：Spoofax/Statix 官方文档与 scope-graph 论文谱系。
- 核心：scope、declaration、reference 与 resolution path 的语言参数化模型。
- 裁决：**adapt** 为统一的 name-resolution Evidence schema。
- 证明：与 TypeScript、Java、Rust compiler 的 differential corpus；visibility/ambiguity negative cases。

### GitHub Stack Graphs

- 来源：<https://github.com/github/stack-graphs>
- 核心：文件增量、无需执行项目构建的跨仓名字解析。
- 裁决：**study**。
- 边界：纯语法 resolution 只能是 candidate；不能覆盖 compiler/type evidence。

### Kythe

- 来源：<https://kythe.io/docs/schema/>
- 核心：anchor 与 semantic node 分离、typed edges、compilation unit、cross-reference。
- 裁决：**interoperate-only**。
- 吸收：source anchor、generated code provenance、跨仓引用导出。
- 拒绝：partial index 必须标记 coverage；无边不能推断无关系。

### SCIP 与 LSP

- 来源：<https://github.com/sourcegraph/scip>、<https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/>
- 裁决：**interoperate-only**。
- SCIP：source symbol/occurrence 导入导出；symbol ID 不直接成为 canonical Entity ID。
- LSP：IDE transport/navigation/diagnostic/code action；workspace edit 不得绕过 Semantic Mutation。

## 4. 静态分析、关系推理与 Explain

### Abstract Interpretation

- 来源：Cousot & Cousot, POPL 1977，<https://doi.org/10.1145/512950.512973>
- 核心：抽象域、格、sound approximation、fixpoint/widening。
- 裁决：**adapt** 为 Behavior/Effect/Impact Provider 的理论约束。
- 要求：每个分析显式声明抽象域、soundness、precision 与 unknown；高 confidence 不得冒充 authority。

### CodeQL

- 来源：<https://codeql.github.com/docs/>
- 核心：关系查询、data/taint flow、path query 与 witness。
- 裁决：**provider-only**。
- 吸收：source→sink witness、query revision、security Evidence。
- 拒绝：CodeQL DB 是可重建索引，不是 Engineering IR 或 Impact authority。

### Soufflé Datalog

- 来源：<https://souffle-lang.github.io/docs.html>、<https://souffle-lang.github.io/provenance>
- 核心：monotone fixed point、组件化规则、proof-tree provenance。
- 裁决：**adapt** 为 Impact/Explain rule-engine 候选。
- 约束：Datalog tuples 只从 exact canonical snapshot 构建；不能形成第二事实库。

### Joern Code Property Graph

- 来源：<https://docs.joern.io/code-property-graph/>
- 核心：AST/CFG/data-flow/property graph、overlays、跨语言查询。
- 裁决：**provider-only**。
- 关键拒绝：CPG 适合代码分析，不适合作为 SEC 万能图；overlay 不能拥有 canonical semantics。

### Facebook Infer / Separation Logic

- 来源：<https://fbinfer.com/docs/separation-logic-and-bi-abduction/>
- 核心：compositional interprocedural analysis、separation logic、bi-abduction、procedure summary。
- 裁决：**study/adapt**。
- 价值：Responsibility/Effect summary 和局部分析可组合性；结论仍是分析 Evidence。

## 5. 查询式增量、构建系统与版本求解

### rustc Query System

- 来源：<https://rustc-dev-guide.rust-lang.org/query.html>
- 核心：demand-driven query DAG、memoization、red-green、stable fingerprint、projection query。
- 裁决：**adapt** 为 Compiler Incremental Graph 的核心范式。
- 永久约束：副作用 publication 不进入纯 query；clean/incremental canonical 等价。

### Salsa

- 来源：<https://salsa-rs.github.io/salsa/>
- 裁决：**study** 为 query-kernel 实现候选。
- 先 prototype/benchmark；库的 revision 与生命周期不得定义 SEC domain key。

### Buck2 DICE

- 来源：<https://buck2.build/docs/developers/architecture/>
- 核心：distributed incremental computation、并行、取消、依赖记录。
- 裁决：**study**。
- 吸收调度经验，不采用 Buck build graph 为 canonical graph。

### Build Systems à la Carte

- 来源：Mokhov、Mitchell、Peyton Jones，<https://www.microsoft.com/en-us/research/publication/build-systems-la-carte/>
- 核心：把 build system 分解为 scheduler 与 rebuilder，比较依赖发现和重建策略。
- 裁决：**adopt concepts**。
- 设计修正：SEC 必须分离依赖发现、任务调度、重建判断和结果投影；但不能把 Mutation、Verification、Release 全部压成同一种 build task。

### Bazel

- 来源：<https://bazel.build/remote/caching>、Hermeticity 官方文档。
- 核心：显式 inputs/outputs/argv/env、action cache、CAS、remote execution。
- 裁决：**adapt physical mechanisms**。
- 拒绝：Bazel action key 不能定义 semantic revision 或 Verification truth。
- 必须测试：ambient executable/env、并发输入变化、cache poisoning、clean parity。

### Nix

- 来源：<https://nix.dev/manual/nix/latest/store/derivation/>
- 核心：derivation、精确定义 builder/inputs/outputs、immutable store closure。
- 裁决：**adapt concepts/provider**。
- 边界：SEC 不依赖 Nix 才能工作；时间、网络、CPU特性等非确定性仍需独立检测。

### PubGrub

- 来源：<https://dart.googlesource.com/pub.git/+/master/doc/solver.md>
- 核心：conflict-driven version solving、incompatibility explanation、backjump。
- 裁决：**adapt** 到 Registry/Block resolution。
- 拒绝：版本 solver 不拥有 semantic compatibility、Migration 或 runtime support。

### Semantic Versioning

- 来源：<https://semver.org/>
- 裁决：**interoperate-only**。
- 版本号只表达生态约定；不能替代 API/wire/behavior/data/rollback compatibility Evidence。

## 6. 事务、发布、恢复与分布式一致性

### ARIES

- 来源：IBM ARIES 原始论文。
- 核心：WAL、analysis/redo/undo、compensation log record、partial rollback。
- 裁决：**adapt** 到 Mutation Journal/Recovery。
- 需要转换：数据库 page/LSN 不能机械复制到文件工作区；吸收 durable phase、重复恢复和 compensation lineage。

### SQLite Atomic Commit / Rollback Journal

- 来源：<https://www.sqlite.org/atomiccommit.html>
- 核心：journal先持久化、hot journal检测、锁后恢复、提交点、fsync。
- 裁决：**adapt** 到 workspace publication。
- 关键不变量：`rename` 返回或文件存在都不足以证明 durable commit；必须区分 not-published、published、publication-unknown。

### Temporal Durable Execution

- 来源：<https://docs.temporal.io/workflows>
- 核心：append-only history、deterministic replay、activity side effects、retry/idempotency。
- 裁决：**adapt concepts**，不作为 Core 强依赖。
- History 不拥有 Engineering semantics；只可服务长操作和开发流程恢复。

### Terraform Plan/Apply

- 来源：<https://developer.hashicorp.com/terraform/cli/commands/plan>
- 核心：读取当前状态、比较配置、生成计划；plan不apply；saved plan绑定输入。
- 裁决：**adapt** 到 Semantic Mutation。
- 约束：apply前在 writer lease 中重新读取并重算；stale plan确定性拒绝。

### Kubernetes Controller / Operator

- 来源：<https://kubernetes.io/docs/concepts/extend-kubernetes/operator/>
- 核心：desired/observed state、幂等 reconcile、condition/status。
- 裁决：**adapt** 到 Operations/Deployment Domain。
- 拒绝：控制循环观察不能反向改写 Authoring Source 或 canonical Facts。

### Kubernetes Server-Side Apply

- 来源：<https://kubernetes.io/docs/reference/using-api/server-side-apply/>
- 核心：field manager ownership、managedFields、冲突、显式 ownership transfer。
- 裁决：**adapt** 到 source region/domain field ownership。
- SEC 不允许默认 force；authority transfer必须经过policy、migration和verification。

### Raft

- 来源：Ongaro & Ousterhout，<https://www.usenix.org/conference/atc14/technical-sessions/presentation/ongaro>
- 裁决：**defer**。
- 只有 SEC 形成真实多节点控制服务时才评估 replicated log；当前本地平台不提前引入共识成本。

### CRDT

- 来源：<https://crdt.tech/papers.html>
- 裁决：**defer/limited**。
- 可能用于协同 annotation/projection；绝不用于 canonical source、Mutation publication 或 merge authority 的自动冲突消除。

### Saga

- 来源：Garcia-Molina & Salem，<https://doi.org/10.1145/38713.38742>
- 裁决：**adapt** 到跨域 Migration/Deployment。
- 补偿不等于 exact rollback；每个外部Effect必须声明可逆、可补偿或 forward-only。

### PostgreSQL Serializable Snapshot Isolation

- 来源：<https://www.postgresql.org/docs/current/transaction-iso.html>
- 价值：并发正确性需要检测不可序列化执行并显式重试。
- 边界：数据库隔离不能替代 workspace writer lease。

## 7. 形式化方法、属性、模糊测试与测试质量

### TLA+

- 来源：<https://lamport.azurewebsites.net/tla/tla.html>
- 裁决：**adapt** 到关键协议模型。
- 优先建模：writer lease、publication/recovery、Integration Epoch、Evidence terminal、resource generation。
- 约束：模型不能替代 implementation mapping 与 physical Evidence。

### Alloy

- 来源：<https://alloytools.org/>
- 核心：关系逻辑、有限scope、SAT反例。
- 用途：identity collision、owner overlap、cycle、missing reference、schema contradiction。
- 约束：有限scope无反例不是一般证明；反例必须转成合同测试。

### QuickCheck

- 来源：Claessen & Hughes，<https://research.chalmers.se/en/publication/237427>
- 核心：property、generator、random cases、shrinking。
- 裁决：**adopt concepts**。
- 要求：seed、最小反例、distribution/coverage、replay入口。

### libFuzzer / AFL++

- 来源：LLVM libFuzzer 与 AFL++ 官方文档。
- 用途：不受信 schema/parser/manifest/CLI/native adapter。
- 约束：稳定窄 target、corpus retention、sanitizers、resource limits；不进入普通 save loop。

### Mutation Testing

- 来源：PIT mutator 文档及 mutation-testing 研究。
- 用途：高价值 pure validator、authorization、selector、fail-closed kernel。
- 拒绝：不以全仓 mutation score衡量产品正确率；必须处理 equivalent mutants和预算。

### Differential / Metamorphic / Model-based Testing

- 采用原则：
  - Provider 与官方 compiler/browser/tool differential；
  - clean/incremental differential；
  - rename/inline/extract 等语义保持 metamorphic relations；
  - state-machine commands 与 model oracle；
  - 任何发现的反例进入永久 corpus。

## 8. 权限、能力、安全边界与策略

### Cedar

- 来源：<https://docs.cedarpolicy.com/>
- 核心：principal/action/resource/context、default deny、forbid优先、schema validation。
- 裁决：**adapt** 到 Authorization Policy。
- 拒绝：Cedar policy不能提交source owner、path、Impact、Verification或terminal。

### Zanzibar

- 来源：Google Zanzibar 原始论文。
- 核心：relationship-based authorization、外部一致性、snapshot token。
- 裁决：**study/defer**；只在真实远程多用户服务出现后考虑。

### OPA / Rego

- 来源：<https://www.openpolicyagent.org/docs>
- 核心：policy decision/enforcement分离、声明式结构化规则。
- 裁决：**provider-only**。
- Rego没有内建allow/deny优先级；SEC必须拥有明确冲突策略，不能把外部engine默认行为当 authority。

### Macaroons

- 来源：<https://research.google/pubs/macaroons-cookies-with-contextual-caveats-for-decentralized-authorization-in-the-cloud/>
- 核心：可衰减 bearer credential、contextual caveats、delegation。
- 裁决：**adapt concepts** 到短期 Task/Tool capability token。
- 约束：server-side revalidation、expiry/audience/replay/leak protection；token不替代policy。

### Capsicum

- 来源：<https://www.usenix.org/conference/usenixsecurity10/capsicum-practical-capabilities-unix>
- 核心：OS capability mode、descriptor capabilities、compartmentalization。
- 裁决：**provider-only**。
- 需按 Windows/Linux/macOS分别建立 owning Evidence；普通临时目录不是sandbox。

### WASI Capabilities

- 来源：WASI capability文档。
- 用途：可移植插件的显式imports/exports和能力注入。
- 边界：不自动使任意不受信native/provider代码安全。

## 9. Schema、配置、API 与消息协议

### JSON Schema 2020-12

- 来源：<https://json-schema.org/draft/2020-12/json-schema-core>
- 核心：dialect/vocabulary、reference、validation、annotations、meta-schema。
- 裁决：**interoperate-only**。
- 约束：JSON Schema不能表达全部semantic invariants；dynamic references需复杂度和资源预算。

### OpenAPI

- 来源：<https://spec.openapis.org/oas/latest.html>
- 用途：HTTP operation/request/response/security contract导入导出。
- 边界：OpenAPI文档不证明runtime实现、业务责任或行为兼容。

### AsyncAPI

- 来源：<https://www.asyncapi.com/docs/reference/specification/latest>
- 用途：channels、messages、send/receive operations、protocol bindings。
- 边界：协议无关描述不证明broker delivery、ordering、transaction或idempotency。

### Protocol Buffers Editions

- 来源：<https://protobuf.dev/>
- 核心：field-number wire identity、unknown fields、reserved fields、wire-safe vs application-safe changes。
- 裁决：**adapt** 到 Type Algebra serialization/compatibility。
- Protobuf类型本身不成为跨语言 Type Algebra。

### CUE

- 来源：<https://cuelang.org/docs/concept/the-logic-of-cue/>
- 核心：constraint/unification、commutative/associative/idempotent merge。
- 裁决：**adapt concepts/provider** 到 Configuration/Policy constraints。
- 边界：unification不能决定source authority和业务owner。

### Dhall

- 来源：<https://docs.dhall-lang.org/tutorials/Language-Tour.html>
- 核心：parse、import resolution、typecheck、normalization、marshalling；强终止与canonical normal form。
- 裁决：**study/provider**。
- 不要求用户采用Dhall；remote/env imports需SEC capability和integrity policy。

### W3C Web of Things Thing Description

- 来源：<https://www.w3.org/TR/wot-thing-description11/>
- 用途：Properties/Actions/Events affordance、data schema、security、protocol binding。
- 裁决：**study/interoperate-only**，适合设备/服务 capability描述。

## 10. Web、HTML、CSS、DOM 与可访问性

### WHATWG HTML / DOM

- 来源：<https://html.spec.whatwg.org/>、<https://dom.spec.whatwg.org/>
- 裁决：原生 Web Provider 的规范基准。
- 必须分开：source template node、rendered DOM candidate、runtime DOM observation、canonical UI contract。
- Runtime DOM snapshot不能成为source authority。

### CSS Cascade

- 来源：<https://www.w3.org/TR/css-cascade-6/>
- 核心：origin、importance、layer、specificity、scope proximity、order、inheritance、custom property。
- 设计结论：CSS不是key-value配置；selector/cascade依赖必须进入独立 Style Program Model。
- SEC不实现layout/paint engine；computed style/layout由browser Evidence拥有。

### WAI-ARIA

- 来源：<https://www.w3.org/TR/wai-aria-1.2/>
- 结论：accessibility是显式Contract/Acceptance，不是附属lint。
- 必须验证 accessible name、role/state、focus、keyboard和browser行为；ARIA属性存在不等于可访问性成立。

### Custom Elements / Shadow DOM

- 来源：HTML Living Standard custom elements与DOM规范。
- 结论：component lifecycle、source template、rendered tree、slotting和style scope分离；shadow boundary不是SEC security boundary。

## 11. 供应链、来源、SBOM、签名与透明日志

### SLSA

- 来源：<https://slsa.dev/spec/v1.2/provenance>
- 核心：BuildDefinition、RunDetails、builder、resolved dependencies、byproducts、subjects。
- 裁决：**adapt** 到 Release/Build Provenance。
- 永久边界：provenance证明来源，不证明correctness或semantic equivalence。

### in-toto

- 来源：in-toto specification。
- 核心：layout、steps/functionaries、link metadata、materials/products、artifact rules。
- 用途：预期供应链步骤和实际执行link的签名验证。
- 边界：in-toto layout不拥有SEC Work Package或merge状态。

### TUF

- 来源：<https://theupdateframework.github.io/specification/latest/>
- 核心：root/targets/snapshot/timestamp、threshold keys、rollback/freeze/mix-and-match防护。
- 用途：Registry/Provider/CLI update trust。
- 边界：TUF不证明包内容语义、兼容性或安全Effect。

### Sigstore

- 来源：<https://docs.sigstore.dev/>
- 核心：Fulcio短期身份签名、Rekor append-only transparency log、Cosign verification。
- 裁决：**provider-only**。
- 透明日志记录不等于trust decision；需要identity policy、inclusion/consistency proof和monitoring。

### SPDX 与 CycloneDX

- 来源：SPDX 3.0 specification、CycloneDX 1.7/ECMA-424。
- 用途：SBOM、license、services、dependencies、VEX、compositions、formulation。
- 关键修正：SBOM必须表达依赖图完整度。组件存在但没有edge时，SEC不得用“无路径”推断不可达；输出unknown/degenerate graph diagnostic。

### W3C PROV

- 来源：<https://www.w3.org/TR/prov-overview/>
- 用途：Entity/Activity/Agent和qualified relations的互操作。
- 边界：SEC内部继续分开 Fact Provenance、Artifact Provenance、Verification Evidence、Runtime Observation、Decision Evidence。

## 12. 可观测性与运行证据

### OpenTelemetry

- 来源：<https://opentelemetry.io/docs/specs/semconv/>
- 核心：trace/metric/log/event/resource semantic conventions、属性稳定度和requirement levels。
- 裁决：**adapt/interoperate**。
- 用途：compiler query、Mutation、Gate、Provider、Release和AI Runtime telemetry。
- 边界：telemetry是Observation/Evidence；不能反向修改canonical truth。必须控制PII、source content、cardinality和schema version。

## 13. AI 工具协议、Agent 互操作与评估

### Model Context Protocol

- 来源：<https://modelcontextprotocol.io/specification/2025-06-18>
- 核心：JSON-RPC、lifecycle/capability negotiation、resources/prompts/tools/sampling、authorization。
- 裁决：**interoperate-only**。
- 每个MCP tool必须映射到SEC versioned typed operation；MCP schema不能扩大path/effect权限，server content不能成为事实。

### Agent2Agent Protocol

- 来源：<https://a2a-protocol.org/>
- 核心：agent discovery、capability card、task、message/artifact、opaque agent interop。
- 裁决：**defer/interoperate-only**。
- A2A task不能成为SEC Work Package/Epoch；远端Agent只作为Provider。

### Structured Outputs / Function Calling

- 来源：各模型Provider的官方schema-constrained输出能力；OpenAI参考：<https://platform.openai.com/docs/guides/structured-outputs>
- 裁决：**adapt** 到 AI Proposal Decoder。
- Schema-valid只证明结构合法，不能证明semantic validity、authorization、Impact或Verification。

### SWE-bench

- 来源：<https://github.com/SWE-bench/SWE-bench>
- 核心：真实Issue、容器化环境、patch evaluation。
- 用途：SEC Agent外部评估语料。
- 边界：resolved率不能衡量authority、安全、cleanup、first-pass correctness和主干治理；需要fresh tasks、contamination control和failure taxonomy。

### SWE-agent ACI

- 来源：<https://swe-agent.com/latest/background/aci/>
- 结论：工具接口设计显著影响Agent质量；SEC应提供窄、typed、即时校验的查看/编辑/执行动作。
- 边界：好用的ACI不能绕过platform authorization。

### OpenTelemetry GenAI Semantic Conventions

- 来源：<https://github.com/open-telemetry/semantic-conventions-genai>
- 用途：模型/provider/tool/agent span、token/budget/error/evaluation telemetry。
- 隐私：prompt、source、tool结果和用户内容默认不记录；按policy redact/omit。

## 14. 不能被外部系统取代的 SEC 独有内核

经过上述谱系对比，以下能力没有任何单一现成系统完整提供，必须由 SEC 自己拥有：

1. Engineering Entity/Fact/Assertion/Responsibility 的 authority 与 stable identity。
2. Source Program Model 到 canonical Responsibility 的 Reconcile。
3. Function/Span/Block 与 Responsibility 多对多、facet级 Impact和Mutation。
4. Engineering Workspace 各domain的独立 validated state与跨域引用。
5. Semantic Delta、Impact witness、unknown frontier 和 Verification recommendation。
6. Caller不能提交derived fields的 Semantic Mutation authorization/plan/apply/recovery。
7. Compiler Query DAG、Verification Evidence DAG、Operational Journal的严格分域。
8. AI proposal-only、typed operation、default deny和minimum Verification交集。
9. 从源到artifact、Gate、Agent、Release的一致 Provenance，而不把Provenance当correctness。
10. 渐进Brownfield治理：Attach→Lift→Reconcile→Adopt→Normalize。

## 15. 当前新增的关键设计修正

### 15.1 Source Program Model 不是一个 AST

必须至少分成：

```text
Full-fidelity syntax tree
Name-resolution graph
Type/symbol model
Control/data/effect analysis
Framework/config/resource bindings
Rule-backed transformation model
Coverage / unknown / provider conflicts
```

### 15.2 Semantic Operation 必须是可审计变换规则

不能只保存最终patch。至少保存：

```text
operation identity/revision
match/precondition
semantic target/facet
source binding/owner
transformation rule
must-preserve
expected delta
unknown frontier
verification/rollback
```

### 15.3 依赖图完整度是第一等事实

Build graph、SBOM、source index、test impact和provider graph都必须声明：

```text
complete | partial | first-party-only | third-party-only | unknown
```

缺边不允许闭世界推断“无影响”。

### 15.4 Ownership 需要层级

```text
canonical object owner
source artifact/region owner
field/facet owner
physical writer generation
external provider authority
```

这些owner不能混成一个字符串字段。

### 15.5 状态机模型与实现测试双向绑定

关键协议采用：

```text
TLA+/Alloy model
→ generated/manual counterexample corpus
→ implementation contract/property/fault tests
→ runtime/physical Evidence
→ model assumption review
```

## 16. 覆盖前沿

本轮尚需继续深入但不应阻塞当前 #215/#223 的领域：

- 证明助手与verified compiler：Coq、Lean、Isabelle、CompCert、CakeML。
- 类型理论与effect systems：algebraic effects、row types、session types、dependent refinement。
- 数据库迁移与在线schema演进：Expand/Contract、logical replication、outbox/CDC。
- OS隔离：Linux namespaces/seccomp/Landlock、Windows AppContainer/Job Object、macOS sandbox。
- package生态：npm/pnpm/Cargo/Maven/Gradle module metadata与lock semantics。
- 多语言FFI/ABI：C ABI、JNI、P/Invoke、Python C API、Wasm component canonical ABI。
- release orchestration：OCI、GitOps、progressive delivery、feature flag、rollback。
- privacy/data governance：information-flow control、data classification、retention、purpose limitation。
- local-first/collaborative editing只作为未来WorkBench需求，不提前影响canonical writer。

这些后续条目必须继续使用同一采纳模板，不能把搜索数量当作架构正确性的证明。
