---
title: Registry、Block 与能力协议
status: stable
domain: capability-block
last-reviewed: 2026-07-29
---

# Registry、Block 与能力协议

本文拥有 Registry、Block、Capability、Port、Slot、Semantic Contract 与 Generator 的稳定职责、生命周期和组合关系。精确 manifest/schema、当前 kind、overlay 算法、版本范围和已实现状态由 loader、types、代码 registry 与 tests 拥有。

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

Block version、Semantic Contract format、Generator protocol、Registry protocol 和 target compatibility 是不同版本域。业务 Block major 不能偷偷表达 Contract schema 或 compiler protocol 升级。

## 组合与 Resolution

Block 级组合使用 `requires`、`provides`、`conflicts` 与 compatibility constraints。Resolver 必须：

- 对输入集合、source revision 和 policy 进行 canonical normalization；
- 检查 self-conflict、missing provider、version incompatibility 和 cycle；
- 确定性选择候选并产生唯一 installation/lowering order；
- 对 ambiguity 和 unresolved dependency fail closed；
- 将结果锁定为 resolution state，而不是重新定义业务语义。

Capability 只表达 Block 级可组合能力，不承担完整数据流、状态、Effect、Permission 或 lifecycle semantics。Capability ID 应稳定且与显示名分离。

## Port

Typed Semantic Port 表达显式连接面，例如 event、data、command、query、policy、view 或 lifecycle。Port 至少需要 direction、payload/type、scope、owner、policy/permission、compatibility 和 Verification binding。

UI 连线、同名端点或 Provider 推断都只是 proposal/Evidence。只有通过 Contract、resolver/linker 和 validated IR 后，连接才成为 canonical Fact。

Port schema 演进必须说明兼容方向、consumer migration、serialization 和 failure behavior；不能用 `any`、未声明 coercion 或字符串同名吞掉不兼容。

## Slot、Governed Extension 与 Private Block

Slot 是有限、局部、可验证的扩展点。它需要 target/source binding、输入输出、writable zone、required symbols、forbidden effects、Verification 和 Provenance。

Slot 不是所有自定义代码的容器。当逻辑出现独立 owner、版本、复用、状态、Effect、升级或迁移时，应提升为 Governed Source Responsibility 或 Private Block。复杂算法也可以长期保留为 Governed Extension；不应为了“全部结构化”无限扩张 Slot 或 Behavior IR。

## Semantic Contract

Contract 声明 Entity、Field、Responsibility、Operation、State、Transition、Event、Policy、Permission、Effect、Scenario 与 Acceptance。Contract 的职责是声明语义和边界，不拥有目标源码布局、一次运行结果或 UI 展示。

Cross-contract 引用必须显式 import，并同时绑定 alias、namespace、contract identity 和 expected kind：

- unqualified reference 只解析当前 Contract；
- qualified reference 只能通过已声明 alias；
- duplicate alias、missing target、kind mismatch、同 namespace 不同 Contract 或隐式同名链接全部拒绝；
- linked Contract 直接进入 canonical semantic build，不持久化第二份 authority graph。

声明 Contract 不等于运行时已经执行 Contract。Policy、State transition、Permission 或 Effect 必须通过 Generator/Lowering、runtime consumer 和 Verification 形成闭环。

## Generator

Generator 按工程动作注册，只消费 validated semantic selector、Target/Profile binding 和 generator declaration，输出结构化 plan 与 Artifact。Lowerer 不重新读取 raw Contract 或 Manifest 形成第二解释器。

每种 generator kind 必须有：

- deterministic identity 与版本化 schema；
- required semantic predicates / selector；
- consumes、produces 与 target constraints；
- source owner、Artifact identity 与 collision policy；
- deterministic ordering、naming 和 bytes；
- Verification requirements、diagnostics 与 Provenance；
- migration/retirement policy。

专用字段只能存在于相应 discriminated variant，不能被提升为所有 Generator 的全局必填。缺少 producer 或不支持语义时必须在 emit 前拒绝，不生成 TODO、空实现或按业务名称分支。

## 单写者与迁移

同一 Artifact path/identity 在一个 candidate 中只有一个 writer。新 Generator 或 target IR 接管旧 file/install producer 时固定执行：

```text
read-only shadow → bytes/diagnostics/effect parity
→ switch consumer and writer → invalidate old plan
→ remove legacy producer and compatibility path
```

新模型存在、测试通过或生成结果看起来相同都不足以证明旧 writer 已被吸收。必须检查失败语义、ordering、Provenance、runtime consumers 和 upgrade behavior。

## Upgrade 与 Migration

升级必须回答 identity、compatibility、semantic delta、source/artifact/data migration、Verification 与 rollback。Versioned overlay、manifest merge 和 Migration kinds 是代码合同；稳定文档只保留以下不变量：

- 相同 ID 的不兼容 major 不能同时进入一个 resolution；
- Contract/Generator protocol 升级与 Block version 分域；
- Migration 必须有 dry-run、apply、diagnostic、idempotency 和 rollback/forward-only 分类；
- 手工 generated-file override 默认阻止覆盖，直到用户明确保留、转为 rule-backed patch 或丢弃；
- 升级重编译必须经过统一 pipeline 和 canonical rebuild，不能绕过 Semantic Frontend。

## Trust 与发布

发布至少绑定 registry identity、content digest、signer/trust policy、declared Effect/Permission、compatibility、tests、Verification status 和 Provenance。AI confidence、下载量、来源名称和多个 Provider 一致都不能代替 trust decision。

引入 remote/community Block 前还必须明确网络、secret、native code、install/build script 和 supply-chain boundary。不受信代码执行需要独立 sandbox authority，不能由普通 compiler validation 冒充。

## 完成判据

一个 Block 能力只有在 Contract、resolution、Generator/installation、runtime consumer、positive/negative Acceptance、Upgrade/Migration 与 Provenance 全部对齐后，才能被声明为可用。缺少任一环节时，文档和 UI 必须显示 declaration、prototype、verified 或 supported 的真实层级，而不是统一写“已支持”。
