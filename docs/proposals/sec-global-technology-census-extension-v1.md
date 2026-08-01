---
title: SEC 全球技术谱系审计扩展 v1
status: draft
domain: proposal
tracking: issue-225
exact-main: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
merge-policy: spike-default-no-merge
last-reviewed: 2026-08-01
---

# SEC 全球技术谱系审计扩展 v1

> 本文补齐 `sec-global-technology-census-v1.md` 的覆盖前沿：verified compiler / proof assistant、effect/type system、OS sandbox、包管理与 lock、FFI/ABI、在线数据与消息演进、OCI/GitOps/feature flag、隐私与信息流。它仍是 proposal，不是 canonical authority。

## 1. Verified Compiler、证明助手与可信计算基

### CompCert

- 来源：<https://compcert.org/man/manual001.html>、<https://compcert.org/>
- 核心：使用 Coq 证明从 C AST 到汇编的语义保持；将编译正确性表述为源程序行为由目标程序保持。
- 关键边界：源文本到 AST 的前端、Coq kernel、提取/runtime、assembler/linker、系统库和硬件都属于额外可信计算基；“verified compiler”并不等于整个构建、链接和运行环境已被证明。
- SEC 裁决：**adapt proof architecture**。
- 吸收：
  - 对高风险 pure kernel 建立可陈述的 refinement/semantic-preservation theorem；
  - 将证明对象、checker revision、assumption 和未覆盖 TCB 显式记录；
  - verified producer 输出仍经过 independent checker/readback。
- 拒绝：当前把整个 SEC 编译器迁移到 Coq；用“formalized”替代物理平台 Evidence。

### CakeML

- 来源：<https://cakeml.org/>
- 核心：经过机器证明的 ML 实现、编译器和自举链，跨多级 IR 和多架构后端；强调从语言语义到机器码的 end-to-end theorem。
- SEC 裁决：**study/adapt**。
- 价值：
  - 自举不是“SEC 能编译 SEC”一句话，而是每一级输入/输出、bootstrap compiler、runtime、backend 和 target theorem 的链式闭合；
  - 自举 compiler 与 compiler-under-test 需要独立身份；
  - 多阶段 lowering 的 correctness theorem可以组合，但不能省略接口假设。

### Lean 4

- 来源：<https://lean-lang.org/doc/reference/latest>、<https://docs.lean-lang.org/theorem_proving_in_lean4/>
- 核心：小 kernel 只检查 proof terms；tactic、equation compiler 和自动化生成 terms，再由 kernel 独立检查。
- SEC 裁决：**adapt**。
- 设计修正：
  - AI、optimizer、heuristic、external solver 可以生成 proposal/proof object；
  - 一个小而独立的 verifier/checker 决定是否接受；
  - checker 的输入、axiom/assumption、version 和 trust closure 必须进入 Evidence。
- 适用首批对象：identity/revision normalization、aggregate status lattice、path containment、Impact monotonicity、publication state machine。

### Coq / Isabelle / SMT Checker

- 裁决：**provider-only / study**。
- 原则：
  - proof assistant 拥有证明语言和 checker，不拥有 SEC semantic authority；
  - SMT `sat/unsat` 结果需绑定 formula、theory、solver/version、resource limit和可选 proof/certificate；
  - timeout/unknown 绝不能被解释为性质成立；
  - 自动化输出不能把未建模环境假设隐藏掉。

### Wasm SpecTec

- 来源：<https://arxiv.org/abs/2311.07223> 与 WebAssembly 官方规范仓库。
- 核心：从一个 DSL 生成数学规范、prose algorithm、reference interpreter 和 tests，减少多表面漂移。
- SEC 裁决：**adapt strongly**。
- 设计修正：对每个核心协议，优先建立同一规范源到：

```text
TypeScript types/schema
validator/checker
human reference
positive/negative vectors
model/proof projection
```

不能长期手写五份互相漂移的真值。

## 2. Effect、Ownership、Typestate、Session 与 Refinement

### Algebraic Effects 与 Handlers

- 来源：Plotkin/Pretnar、Bauer/Pretnar 原始论文；Koka 官方语言文档 <https://koka-lang.github.io/koka/doc/book.html>。
- 核心：把 exceptions、state、I/O、async、nondeterminism 等 computation effect 显式为 operations，并由 scoped handler 解释；effect row可多态组合。
- SEC 裁决：**adapt concepts，不要求 Core 使用 effect-language runtime**。
- 设计修正：`Effect` 不能只是字符串标签。至少表达：

```text
effect kind / operation
input / output type
capability provider
scope / handler / owner
may-fail / cancellation
idempotency / retry
transaction and compensation relation
resource lifecycle
verification obligation
```

- 关键边界：类型级 effect 表明“可能发生什么”，不证明 operation policy、资源现实存在或运行成功。

### Rust Ownership / Borrowing

- 来源：Rust Reference / Formal Language Specification。
- 核心：所有权转移、借用、别名与可变性、lifetime；很多非法资源使用在编译期拒绝。
- SEC 裁决：**adapt semantics** 到 source region、resource generation和 capability lifetime。
- 不能机械复制：SEC 工作区、文件、进程、DB、browser 并非 Rust 内存对象；需要物理 identity、lease、journal 和 cleanup receipt。
- 设计修正：每个长期资源应表达：

```text
owner generation
shared/exclusive borrow
scope/lifetime
transfer rules
revocation/invalidation
terminal cleanup
```

### Typestate

- 核心：类型代表对象合法状态，方法只在适用状态可用。
- SEC 裁决：**adapt** 到 Operation/Gate/Transaction API。
- 优先使用 discriminated union + constructor/validator，而不是让 `string status + optional fields` 蔓延。
- 编译期 typestate 仍不能替代跨进程、持久化和 crash 后的 runtime readback。

### Session Types

- 来源：Honda、Vasconcelos、Kubo 等 session type 研究谱系；后续 duality/gradual session type工作。
- 核心：描述发送、接收、选择、分支、递归和协议 duality，保证通信步骤按协议发生。
- SEC 裁决：**adapt** 到 Port/Agent/Provider/long-running operation protocol。
- 适用：
  - CLI/Workbench server session；
  - AI tool call / result / approval；
  - Provider handshake；
  - Migration coordinator；
  - release promotion protocol。
- 边界：网络实际交付、超时、重连、重复消息和外部参与者不可信仍需runtime协议和Evidence。

### Refinement Types

- 来源：LiquidHaskell / refinement-type research。
- 核心：`Type + logical predicate`，借助 SMT 检查范围、关系和部分功能性质。
- SEC 裁决：**adapt selectively**。
- 用途：schema cross-field invariant、path proof、revision equality、bounded resource、monotone lattice。
- 边界：
  - solver theory/termination/unknown必须显式；
  - 不把所有业务逻辑塞进SMT；
  - runtime/provider/IO性质需要物理Evidence。

### Information Flow Control / Jif

- 来源：Cornell Jif、decentralized label model。
- 核心：为数据附加 confidentiality/integrity policy，编译器跟踪数据流；principals、acts-for、declassification/endorsement有显式授权语义。
- SEC 裁决：**adapt** 到 Privacy/Data Governance Domain。
- 新模型：

```text
Data Classification
Purpose / permitted use
Confidentiality owner/readers
Integrity owner/writers
flow source → transform → sink
retention / deletion
redaction / declassification decision
Evidence and audit
```

- 边界：普通 RBAC/Cedar permit 不足以证明数据流合规；IFC也不能单独决定业务授权。

## 3. OS Sandbox 与不受信 Provider 执行

### Linux seccomp + no_new_privs

- 来源：Linux kernel userspace API。
- 核心：系统调用过滤；`no_new_privs` 阻止 exec 获得新的特权。
- SEC 裁决：**provider-only**。
- 永久边界：seccomp 过滤 syscall，不是 filesystem/network policy全覆盖；错误规则、架构号、兼容syscall和用户通知都需要测试。

### Linux Landlock

- 来源：<https://www.kernel.org/doc/html/latest/userspace-api/landlock.html>
- 核心：非特权进程可对自身叠加 filesystem/network access restriction；ABI版本和当前能力需要探测。
- SEC 裁决：**provider-only / adopt on supported Linux**。
- 要求：
  - runtime capability detection；
  - unsupported不能假装sandboxed；
  - policy只能收紧ambient rights；
  - path resolution/reparse-like边界仍需SEC canonical proof。

### Linux namespaces / cgroups

- 裁决：**provider-only**。
- namespaces隔离资源视图；cgroups限制/统计CPU、memory、pids、I/O。
- 边界：container并非自动安全；user namespace、mount propagation、device、capability、seccomp、LSM和rootless组合需独立profile。

### Windows AppContainer / LPAC

- 来源：Microsoft AppContainer isolation/launch docs。
- 核心：low-integrity token、Package/Capability SID、DACL交集、文件/registry/network/process/window/credential隔离；LPAC默认更窄。
- SEC 裁决：**provider-only / primary Windows sandbox candidate**。
- 设计要求：
  - capabilities来自Target/Provider policy，不由child request；
  - launch token、capability SID、ACL、network和broker配置进入Environment Evidence；
  - AppContainer成功不能代替Job Object process-tree settlement。

### Windows Job Object

- 核心：进程组、限制、通知、kill-on-close、资源 accounting。
- SEC 裁决：**adopt provider** for process ownership/settlement。
- AppContainer控制“能访问什么”，Job Object控制“哪些进程属于此次执行以及如何收口”，两者不可互替。

### macOS App Sandbox

- 来源：Apple App Sandbox documentation。
- 核心：kernel-enforced entitlement，限制文件、网络、设备等能力；目标是限制被攻陷应用的损害范围。
- SEC 裁决：**provider-only**。
- 需要真实entitlement、code-sign/package、helper inheritance和user-selected file bookmark测试；不能由Linux/Windows结果推断。

### Sandbox统一合同

不能抽象成 `sandbox: true`。统一 profile 至少包含：

```yaml
platform:
mechanisms: []
filesystem:
network:
process:
credentials:
devices:
ipc:
resourceLimits:
inheritance:
unsupported: []
knownEscapeSurfaces: []
providerRevision:
physicalEvidence:
```

## 4. 包管理、依赖 resolution 与 lock 真值

### npm package-lock

- 来源：<https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/>
- 核心：描述 npm 解析和materialize得到的精确tree；普通lock与 `node_modules/.package-lock.json` hidden derived lock生命周期不同。
- 关键教训：hidden lock依赖目录存在和mtime，无法检测所有内容级手工修改；不能作为source authority。
- SEC 裁决：**Provider-specific resolution artifact**。

### pnpm

- 核心：content-addressable store、symlink/hardlink materialization、workspace protocol、peer dependency resolution、版本化lockfile。
- SEC 裁决：**Toolchain Provider**。
- 要求：逻辑package graph、store identity、physical link topology和runtime module resolution分开；pnpm lock不能用npm/Bun解释器猜测。

### Cargo

- 来源：Cargo Book dependency resolver。
- 核心：manifest requirements → resolve graph → `Cargo.lock`；feature unification、platform dependencies、native `links` uniqueness、yank/override有独立规则。
- SEC 裁决：**Provider-specific**。
- 设计修正：依赖节点必须保留 `kind/target/features/source/checksum/links`，不能只保存 name/version。

### Maven / Gradle

- 来源：Gradle Module Metadata与dependency locking官方文档。
- 核心：GAV、variants、attributes、capabilities、artifacts、POM/GMM/Ivy source；lock通常按configuration解析结果。
- SEC 裁决：**Provider-specific**。
- 关键教训：同一module的compile/runtime/platform variant可以不同；通用依赖图不能压成单边 `dependsOn`。

### 通用依赖模型

SEC 只建立跨Provider contract：

```text
Package identity + ecosystem/source
Manifest requirement
Resolver policy/revision
Resolved package instance
Variant/features/target
Artifact digest
Dependency edges + completeness
Install/materialization Evidence
Runtime load Evidence
License/supply-chain
```

lockfile 是一个resolver在特定输入下的**结果**，不是跨工具 authority。每个 lock 只有对应Provider可读写。

## 5. FFI、ABI、Wire 与跨语言边界

### 永久分域

```text
Source API compatibility
Binary ABI compatibility
Wire/serialization compatibility
Behavior compatibility
Resource/ownership compatibility
Deployment compatibility
```

其中任何一项成立都不能推断其他项。

### C ABI

- C function calling convention常作为最低公共ABI，但类型大小、alignment、endianness、struct layout、name mangling、allocator、exception、thread-local和platform ABI仍不同。
- SEC 必须绑定target triple、compiler ABI、calling convention、data layout和symbol set。

### JNI

- 来源：Java Virtual Machine / JNI specification。
- 边界：Java object/reference lifetime、local/global refs、thread attachment、exception pending state、modified UTF-8、native library loading都需要Provider合同。
- JNI调用成功不证明Java/native memory ownership安全。

### .NET P/Invoke

- 来源：Microsoft native interoperability文档。
- 核心：LibraryImport/DllImport、marshalling、native layout/calling convention、error propagation。
- 要求：签名必须与native declaration匹配，字符串/boolean/struct/callback lifetime显式。

### Python Limited API / Stable ABI

- 来源：Python C API Stability documentation。
- 核心：Limited API隐藏implementation detail，Stable ABI跨多个Python minor；但行为仍可能变化，loader也不会自动验证extension真的遵守ABI。
- SEC 设计结论：支持声明必须分别记录：
  - compile target API；
  - ABI tag/min version；
  - runtime load test；
  - behavioral acceptance。

### Wasm Component Canonical ABI

- 来源：WebAssembly Component Model spec repository。
- 核心：WIT types通过Canonical ABI降低到core Wasm；guest/host语言可互操作。
- SEC 裁决：**preferred portable plugin ABI candidate**。
- 边界：component model仍在增量演进；async/thread版本、runtime support、resource handle lifecycle和capabilities需要版本化Evidence。

### FFI Port Contract

```yaml
interfaceIdentity:
languagePair:
targetTriple:
abiRevision:
callingConvention:
typesAndLayouts:
ownershipAndLifetime:
threading:
errorsAndExceptions:
callbacks:
allocator:
serialization:
capabilities:
compatibility:
verification:
```

## 6. 在线数据、事件与部署演进

### revision 分离

在线变化至少具有：

```text
Application semantic revision
Database schema revision
Data migration revision
Message/wire schema revision
Service deployment revision
Feature-flag/config revision
Backfill/checkpoint revision
```

不能由一个Block version或Git commit统一代替。

### Expand → Backfill → Verify → Switch → Contract

- SEC 采用该协调模式，但每一步都是typed state，不是文档checklist。
- Additive schema也可能有lock、rewrite、storage和old-client语义；不能一律标为safe。
- destructive contract只有在全部readers/writers/history/backup/rollback裁决后允许。

### PostgreSQL Logical Replication

- 来源：PostgreSQL current docs。
- 核心：按replica identity复制行变化；schema/DDL不会自动复制，publisher/subscriber schema不兼容会导致replication error。
- 设计结论：CDC/logical replication不拥有schema migration；schema deployment顺序需独立计划和Verification。

### Transactional Outbox / Debezium

- 来源：Debezium Outbox Event Router官方文档。
- 核心：业务写和outbox row在同一DB transaction；CDC异步发布，避免DB状态与事件发送不一致。
- 边界：
  - 消费至少一次/重复仍需要event ID、idempotency和dedupe；
  - event payload schema和consumer migration独立；
  - connector lag/slot/retention和order需要operational Evidence。

### Kafka Transactions / Exactly Once

- 裁决：**Provider-specific**。
- “exactly once”只在定义的producer/transaction/consumer processing边界内成立；外部DB/API side effects不能自动纳入。
- SEC support claim必须列出exact scope和excluded effects。

### Feature Flags / OpenFeature

- 来源：<https://openfeature.dev/specification/>
- 核心：vendor-neutral typed evaluation API、provider、evaluation context、hooks/events/tracking；详细结果携带reason/error/variant。
- SEC 裁决：**interoperate-only + Operations Domain adapter**。
- 关键拒绝：OpenFeature no-op/default value在一般应用里便于可用性，但对于安全、permission、migration switch和destructive operation，SEC必须采用显式fail-closed policy，不能静默默认。
- Flag必须声明owner、purpose、allowed values、target、expiry、cleanup、telemetry、data classification、migration state；不能永久成为隐藏分支。

## 7. OCI、GitOps、Progressive Delivery 与 Release

### OCI Image / Distribution

- 来源：OCI Image和Distribution specs。
- 核心：descriptor、digest、manifest/index、layers/config、generic artifact distribution、referrers。
- SEC 裁决：**interoperate/adapt**。
- 用途：Block/Provider/Release artifact、SBOM/signature/provenance referrer。
- 边界：digest只证明bytes；tag可变；image存在不证明runtime capability、security或deployment成功。

### OpenGitOps

- 来源：CNCF OpenGitOps。
- 核心：声明式、版本化不可变、自动pull/reconcile、持续状态校准。
- SEC 裁决：**adapt to Deployment Domain**。
- 永久边界：Git是Authoring Source之一，不是runtime observed truth；controller status/Evidence不反向修改Contract。

### Progressive Delivery

- canary、blue/green、traffic split和metric analysis是Deployment operation；必须绑定Release、environment、cohort、metric query/revision、abort/rollback和data migration compatibility。
- 成功metric不能替代semantic/functional Verification；统计指标需要window、baseline、multiple testing和minimum sample policy。

### OpenFeature 与 Release

Feature flag可以协调switch，但不等于release artifact或migration state。旗标清理/退休是正式义务；过期flag会形成第二业务状态机。

## 8. 隐私、Purpose 与 Data Governance

### W3C Privacy Principles

- 来源：<https://www.w3.org/TR/privacy-principles/>
- 核心：data minimization、purpose limitation、transparency、consent/withdrawal、de-identification、data rights。
- SEC 裁决：**adopt as product-level invariants**，但不能声称自动满足各司法辖区法律。

### Data Contract

```yaml
dataCategory:
subjectOrGroup:
controller:
processor:
purposes: []
allowedOperations: []
allowedRecipients: []
retention:
location:
confidentiality:
integrity:
deIdentification:
consentOrLegalBasis:
declassificationOrDisclosure:
lineage:
verification:
```

### 最小化 Context Packet / AI Telemetry

- Context Packet只包含完成task所需信息；源代码、secret、PII和absolute paths默认omit/redact。
- prompt/tool result记录默认关闭；只存digest、classification、operation、result和必要audit。
- 观察性数据不能无目的地长期保留；每个telemetry field需要purpose、retention和cardinality边界。

### IFC 与授权的关系

- Authorization回答“当前动作是否允许”；
- IFC/Data Governance回答“数据如何流动、可被何种目的和主体使用”；
- 两者都满足才可发布敏感数据变化。

## 9. 对 SEC 总架构的新增强制修正

1. `Effect` 升级为typed operation/capability/lifecycle模型，不再只用字符串枚举。
2. 新增 `Data Governance / Information Flow` Workspace Domain，不能仅依赖Permission和Privacy文档。
3. `Source Program Model` 内增加rule-backed transformation representation。
4. `Operation Registry` 保存match/precondition/transform/must-preserve，不只保存目标diff。
5. `SandboxProfile` 必须分平台和mechanism，禁止一个boolean支持声明。
6. `DependencyResolutionSnapshot` 分离manifest、resolver policy、lock、materialization和runtime load。
7. `Compatibility` 拆成source/API、ABI、wire、behavior、resource和deployment方向矩阵。
8. `OnlineMigration` 用多revision状态机，不允许一次apply概括schema/data/event/deploy。
9. `FeatureFlag` 纳入生命周期、ownership、expiry和cleanup；安全关键flag默认fail closed。
10. proof/certificate与checker revision进入Evidence；solver unknown不能被PASS。
11. 高风险核心协议采用spec-source → types/validator/docs/vectors/model多投影，减少手写漂移。
12. 所有外部系统的“支持”必须绑定exact version、platform、capability和physical Evidence。

## 10. 新增覆盖前沿

后续仍需继续，但不改变当前 #215/#223 优先级：

- 实时/分布式数据库的online DDL、consistency checker和backfill模型；
- GPU/CUDA/ROCm/Metal、accelerator graph和resource scheduling；
- eBPF、kernel module和driver Provider；
- mobile Android/iOS app、permission、lifecycle、store release；
- embedded/RTOS、hard real-time、safety certification；
- cryptographic protocol verification、key lifecycle和HSM；
- ML model/data/evaluation lineage、model serving和AI-specific supply chain；
- regulatory assurance cases与safety cases；
- human factors、UX research和organizational decision provenance。
