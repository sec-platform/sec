---
title: Registry、Block 与能力协议
status: stable
domain: capability-block
last-reviewed: 2026-08-06
---

# Registry、Block 与能力协议

本文拥有 Registry、Block、Block Capability、Port、Slot、Semantic Contract、Block Provider Binding 与 Generator 的稳定职责、生命周期和组合关系。精确 manifest/schema、当前 kind、overlay 算法、版本范围和已实现状态由 loader、types、代码 registry 与 tests 拥有。产品级 Implementation Resolution 由 Compiler authority 拥有，本文只提供其可消费的 Block 候选与冻结绑定。

## Registry

Registry 分发可验证的 Block revision。Registry source 可以是 official、private、remote 或 community，但 source 类型只表达分发与信任策略，不自动证明内容安全、语义正确或与当前 workspace 兼容。

一次解析必须绑定 registry identity、content digest、Block identity/version、trust policy、兼容规则和所选 source revision。相同 ID 来自多个 source 时不得按搜索顺序或最新时间隐式覆盖；选择、优先级、镜像与 fallback 必须由显式 policy 决定并进入 resolution Evidence。

Registry 是只读分发 authority。安装到 workspace 的 copy、缓存、镜像或 Brownfield source 不会因路径相似而获得 Registry 写 authority。

## Block

Block 是：

- 分发与版本单位；
- Registry trust 和签名/摘要校验单位；
- Upgrade、Migration 与退役单位；
- Contract、Generator、Tests 和资产封装单位；
- Artifact Provenance 的来源单位之一。

Block 不是默认架构理解单位。架构理解由 Responsibility、Operation、State、Contract、Effect、Policy 与 Fact 表达。一个 Block 可以声明多个 Responsibility；一个 Responsibility 只有通过显式 Contract import 和 qualified reference 才能跨 Block。

长期 Block 由 Manifest、Contracts、Generator declarations、Files、Tests 与 Migrations 组成。文件安装是兼容面和 escape hatch，不是语义母模型；仅复制文件不能证明 Contract 已被执行、Effect 已受控或 Acceptance 已覆盖。

## Block 生命周期

```text
author → validate → publish → resolve → install/materialize
→ compose/lower → verify → operate → upgrade/migrate
→ deprecate → retire
```

每个阶段必须保留 stable identity 和 revision binding。退役不是从 Registry 隐藏版本；必须裁决现有 workspace、依赖 Block、generated artifacts、Migration、Provenance 和 rollback boundary。

Block version、Semantic Contract format、Generator protocol、Registry protocol、Block Capability revision、Adapter protocol和target compatibility是不同版本域。业务 Block major 不能偷偷表达 Contract schema 或 compiler protocol 升级。

## Block Capability Resolution

Block 级组合使用版本化的 `requires`、`provides`、`conflicts` 与 compatibility constraints。自由字符串同名不证明两个Provider等价；Capability必须拥有稳定identity、revision/range、contract/type/effect profile和consumer scope。

Block Resolver 必须：

- 对输入集合、Registry/source revision、trust与policy进行 canonical normalization；
- 枚举Registry中的Block candidates，但不执行install、Generator或任意代码；
- 检查self-conflict、missing provider、version/contract/Target incompatibility和cycle；
- 对untrusted、unknown、ambiguous或unsupported fail closed；
- 由显式selector或版本化approved policy选择，而不是因“只找到一个”自动授权；
- 确定性产生唯一 BlockProviderBinding 和 installation/lowering order；
- 锁定manifest/resource/source/capability/trust/compatibility/effect summaries与content digests；
- 将结果作为resolution state，而不是重新定义业务语义。

最小协议分为：

```text
BlockCapabilityRequirement
→ Registry Block candidates
→ trust / version / contract / effect eligibility
→ BlockResolutionDecision
→ frozen BlockProviderBinding
```

`BlockProviderBinding`进入Lock、Provenance和下游composition输入。后续consumer不得重新扫描live Registry、依赖filesystem顺序或因Provider消失自动换成另一个同名Capability。

Capability 只表达 Block 级可组合能力，不承担完整数据流、状态、Effect、Permission 或 lifecycle semantics。Capability ID 应稳定且与显示名分离。

## 与 Implementation Resolution 的边界

Block Resolver与Compiler拥有的Implementation Resolver是两个不同层级，不得共享一个含糊的`ProviderBinding`或互相复制选择算法。

```text
Implementation Resolution
→ 在 native / reference / existing / custom / block-delivered 等实现族中选择

若候选需要 block-delivered capability
→ 构造受约束的 BlockCapabilityResolutionRequest
→ Block Resolver返回冻结 BlockProviderBinding 或 typed failure
→ Implementation Candidate只引用该Binding
```

固定边界：

- Block Resolver只拥有Registry/Block候选、trust、Block版本/contract/effect兼容、资源闭包和安装顺序；
- Implementation Resolver拥有产品语义实现候选、hard eligibility、用户/组织constraints、ResolutionPolicy、最终ResolutionDecision与ImplementationBinding；
- Block Resolver不得比较SEC原生、Reference、repository existing、Custom或非Block实现；
- Implementation Resolver不得读取manifest目录、Registry source、resource tree或重算Block trust；
- 两类Requirement、Decision与Binding必须使用不同type、identity、revision、failure和consumer；
- 一个上层ImplementationBinding可以引用零个或多个冻结BlockProviderBinding，但不能复制其内容形成第二truth。

## Provider、Adapter 与 Reference/Custom 实现

Registry可以分发Provider/Adapter/Reference声明，但分发不等于采信或最终选择：

- **Provider declaration**：声明某Block或包提供哪些Capability及其Target、Effect、resource和限制；
- **Adapter declaration**：声明如何把一个稳定Contract映射到具体Provider API；Adapter不拥有业务Responsibility；
- **Reference Provider**：SEC提供的最小、可解释、可conformance基准实现，不自动代表全局最优；
- **Custom Provider / Private Block**：用户或组织提供的受治理实现，需要owner、Contract、Effect、Permission、Verification与Migration；
- **Provider/Adapter candidate**：由源码、AI或外部分析产生，未通过Adopt/conformance前不进入正式候选catalog。

Registry只分发这些revision及其签名/摘要/metadata。External Provider policy拥有安全、许可证、freshness和conformance Evidence；Compiler Implementation Resolution拥有最终是否选择它们。

## Port

Typed Semantic Port 表达显式连接面，例如 event、data、command、query、policy、view 或 lifecycle。Port 至少需要 direction、payload/type、scope、owner、policy/permission、compatibility 和 Verification binding。

UI 连线、同名端点或 Provider 推断都只是 proposal/Evidence。只有通过 Contract、resolver/linker 和 validated IR 后，连接才成为 canonical Fact。

Port schema 演进必须说明兼容方向、consumer migration、serialization 和 failure behavior；不能用 `any`、未声明 coercion 或字符串同名吞掉不兼容。

## Typed Extension、Governed Extension 与 Private Block

用户可替换的一小段实现是 Typed Extension，不是一个同时代表契约、源码、开发任务和验证结果的万能 `Slot`。canonical model 必须把下列对象分开：

- **ExtensionContract**：由 Block owner 声明的单一局部语义孔，只拥有输入输出、确定性要求、允许的 capability ports、禁止的 Effect 和 acceptance binding；不拥有源码路径、生成状态或一次验证结果；
- **ExtensionImplementationBinding**：resolver 对一个 ExtensionContract 选择的不可变实现，绑定 source/provider identity、exact content/contract/grant digest、Target 和 transitive Effect closure；
- **ExtensionWorkItem**：为产生或修复实现而建立的可变任务，只拥有 write bounds、required symbols、budget 和当前状态；不得进入 Lock 充当实现 authority；
- **ExtensionVerification**：对 exact implementation binding 的行为、Effect、Target 和 acceptance Evidence；不得把所有通过测试无差别复制给所有扩展点。

只有无独立 owner、无独立版本、无持久状态、无外部资源、无环境依赖、无升级/迁移且 Effect 被显式禁止的局部确定性变换，才适合成为 Typed Extension。源码可以使用运行时语言原语，但不得直接取得 ambient host capability；允许的能力只能通过 ExtensionContract 中的 typed capability port 注入，并由 binding 与 runtime boundary 执行。静态 import/global 扫描只是廉价 authoring sentinel，不能证明 transitive dependency、动态行为、Effect 或物理隔离。

事件回调、数据库读写、网络、时钟/随机源、进程、文件系统、credential、多个业务操作、独立复用、状态或迁移中的任一项出现时，必须提升为 Governed Extension、Custom Provider 或 Private Block，并声明 owner、Contract、Effect、Permission、lifecycle、failure、Verification 与 Migration。不得通过普通参数传入 `Database`/`Session` 等高权限对象后仍声称“零 capability”，也不得用 `forbiddenOperations` prose 或一个 lint PASS 代替 runtime enforcement。

当前 `ManifestSlot`/`PlanSlot`/`SlotTask` 把上述四层混为一体，属于待退役的历史模型，不是后续设计模板。迁移必须从真实消费者图原子切换到上述对象并删除旧字段、旧任务状态和旧命名，不建立 `SlotV2`、双写、fallback 或长期 compatibility dispatcher。

没有专用Adapter的外部调用可以先作为typed external invocation或Governed Extension存在；不能因它尚未成为Block/Provider就禁止使用，也不能因类型检查通过就虚构Effect、安全或support保证。

## Semantic Contract

Contract 声明 Entity、Field、Responsibility、Operation、State、Transition、Event、Policy、Permission、Effect、Scenario 与 Acceptance。Contract 的职责是声明语义和边界，不拥有目标源码布局、具体库选择、一次运行结果或 UI 展示。

Cross-contract 引用必须显式 import，并同时绑定 alias、namespace、contract identity 和 expected kind：

- unqualified reference 只解析当前 Contract；
- qualified reference 只能通过已声明 alias；
- duplicate alias、missing target、kind mismatch、同 namespace 不同 Contract 或隐式同名链接全部拒绝；
- linked Contract 直接进入 canonical semantic build，不持久化第二份 authority graph。

声明 Contract 不等于运行时已经执行 Contract。Policy、State transition、Permission 或 Effect 必须通过Implementation Resolution、Generator/Lowering、runtime consumer 和 Verification 形成闭环。Provider不能以自身默认行为修改Contract；无法满足时只能成为不合格候选或触发显式Semantic Migration。

## Generator

Generator 按工程动作注册，只消费 validated semantic selector、Target/Profile binding、冻结的Implementation/Block bindings和generator declaration，输出结构化 plan 与 Artifact。Lowerer 不重新读取 raw Contract、Manifest、Registry或package catalog形成第二解释器/Resolver。

每种 generator kind 必须有：

- deterministic identity 与版本化 schema；
- required semantic predicates / selector；
- consumes、produces 与 target constraints；
- required ImplementationBinding/BlockProviderBinding references；
- source owner、Artifact identity 与 collision policy；
- deterministic ordering、naming 和 bytes；
- Verification requirements、diagnostics 与 Provenance；
- migration/retirement policy。

专用字段只能存在于相应 discriminated variant，不能被提升为所有 Generator 的全局必填。缺少producer、Binding或不支持语义时必须在emit前拒绝，不生成TODO、空实现、隐式默认库或按业务名称分支。

## 单写者与迁移

同一 Artifact path/identity 在一个 candidate 中只有一个 writer。同一Capability/Implementation scope也只有一个有效Resolver和Binding。新 Generator、resolver或target IR接管旧file/install producer时固定执行：

```text
read-only shadow
→ Decision/Binding/bytes/diagnostics/effect parity
→ switch consumer and writer
→ invalidate old plan/binding
→ remove legacy resolver/producer/compatibility path
```

新模型存在、测试通过或生成结果看起来相同都不足以证明旧owner已被吸收。必须检查失败语义、ordering、Provenance、runtime consumers、upgrade behavior和旧选择路径是否物理删除。

## Upgrade 与 Migration

升级必须回答 identity、compatibility、semantic/implementation delta、source/artifact/data migration、Verification 与 rollback。Versioned overlay、manifest merge 和 Migration kinds 是代码合同；稳定文档只保留以下不变量：

- 相同 ID 的不兼容 major 不能同时进入一个 Block resolution；
- Contract/Generator/Adapter/Block Capability protocol升级与Block version分域；
- Provider/Block升级不能静默替换另一个同名Capability或改变timeout/retry/error/effect语义；
- Migration 必须有 dry-run、apply、diagnostic、idempotency 和 rollback/forward-only 分类；
- 手工 generated-file override 默认阻止覆盖，直到用户明确保留、转为 rule-backed patch 或丢弃；
- 升级重编译必须经过统一 pipeline、Implementation re-resolution和canonical rebuild，不能绕过 Semantic Frontend。

## Trust 与发布

发布至少绑定 registry identity、content digest、signer/trust policy、declared Effect/Permission、compatibility、tests、Verification status 和 Provenance。AI confidence、下载量、来源名称和多个 Provider 一致都不能代替 trust decision或Implementation选择。

引入 remote/community Block 前还必须明确网络、secret、native code、install/build script 和 supply-chain boundary。不受信代码执行需要独立 sandbox authority，不能由普通 compiler validation 冒充。

## 完成判据

一个 Block 能力只有在 Contract、Block resolution、冻结Binding、Generator/installation、runtime consumer、positive/negative Acceptance、Upgrade/Migration 与 Provenance 全部对齐后，才能被声明为可用。一个Provider只有在External Provider治理和conformance闭合后才可成为正式Implementation candidate；是否被最终选择仍由Compiler Implementation Resolution决定。缺少任一环节时，文档和 UI 必须显示 declaration、prototype、verified 或 supported 的真实层级，而不是统一写“已支持”。
