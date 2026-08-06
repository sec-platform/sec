---
title: Brownfield 导入
status: stable
domain: brownfield
last-reviewed: 2026-08-06
---

# Brownfield 导入

本文拥有既有工程与外部类库进入 SEC 的五阶段模型、Source Program Model、Language/Analysis Provider 边界、typed external invocation、owner 迁移、unknown/opaque 与安全导入条件。TypeScript 是第一目标；Core contract、identity、Evidence 与阶段语义保持语言无关。

```text
Attach → Lift → Reconcile → Adopt → Normalize
```

这不是一次“反编译”。每一步都增加可证明的理解或治理权力；任何阶段都允许工程保留复杂、未理解或不可安全重生成的区域。公开源码、类型正确或AI能够生成调用都不等于平台已经恢复全部业务语义。

## Attach：完整看见物理工程

Attach 对 exact source revision 建立可重复的物理 inventory，只证明“看见了什么”，不证明理解或可以修改。

Inventory 至少覆盖：

- repository、workspace、package、build target、application 与 module 边界；
- tracked/untracked/ignored、mode、encoding、object/content digest；
- symlink、Windows reparse、case folding、Unicode 与跨平台路径表示；
- source、generated、vendor、binary、secret、protected、opaque 与 temporary region；
- public/release surface、入口、配置、依赖、资源和当前 owner；
- package exports、types、peer/transitive dependencies、lock、install/build/native hooks与integrity；
- monorepo/workspace resolution、toolchain 和 build-system evidence；
- unreadable、unsupported、excluded 与 unresolved 区域及其原因。

Attach 默认不执行项目代码、package scripts、build、browser 或网络请求。扫描缺失、权限失败、解析失败或 Provider coverage 不足形成 unknown，不能被解释为“不存在”。

## Lift：构建 Source Program Model

Language/Compiler/Static/Runtime Provider 把物理 inventory 提升为 observed/derived Source Program Model 和候选关系。首版模型至少表达：

- workspace、package、build target、file 与 module；
- exported symbol、declaration、type、reference 与 source span；
- import/export、resolution、call candidate；
- function/constructor/method signatures、generic和overload；
- control/data-flow、state、effect 和 framework binding candidate；
- configuration、resource、generated/vendor/protected/opaque region；
- unresolved、ambiguous 与 provider-conflict region。

Source Program Model 必须独立 version、validate、canonical order、digest 和 freeze。Identity 优先来自 repository/source revision 与 stable logical binding，不使用绝对路径或 Provider 私有 ID 作为跨重建 identity。

Rename/move、declaration merge、overload、generated source、symlink/reparse、case folding、多 package/module resolution、条件导出和版本 skew 都必须有显式策略。

## Generic External Library Binding

无专用Adapter的package不应被迫退化为“用户从零手写全部调用”。在Lift完成精确package/module/export/type绑定后，平台可以建立最低通用调用层：

```text
ExternalPackageIdentity
→ ExportedSymbol
→ TypedInvocation
→ ExternalCallBinding
→ Target Program external call
```

### TypedInvocation

`TypedInvocation`至少绑定：

- exact package/source/version/integrity和module export；
- function、constructor或method symbol identity；
- call/construct mode、generic/overload selection；
- parameter、return、throw/async shape与source/type revisions；
- 当前流程中的input/output bindings；
- Target/module-resolution requirement；
- unknown Effect、Permission、resource和runtime semantics。

用户可在结构化界面选择symbol、连接参数和返回值并生成type-correct源码。平台此时只承诺已观察的调用shape和适用typecheck，不承诺业务合同、Effect、幂等性、retry、timeout、cancellation、安全或运行时行为。

### Declared governed invocation

用户或组织可以为TypedInvocation声明：

- Semantic Contract reference；
- Effect、Permission和resource；
- error classification；
- Target/runtime要求；
- Verification和owner。

该声明使调用成为Governed Extension/Custom Provider candidate，不使声明自动变成事实。错误、恶意或不完整声明必须能被conformance、runtime observation和Policy拒绝。

### 从调用到正式 Provider

平台可以继续分析`.d.ts`、源码、文档、测试、示例、CFG/data-flow、依赖闭包与隔离runtime trace，产生ProviderManifest、Adapter、Effect或Contract-matching candidate。AI可以辅助生成candidate和tests，但不能直接Adopt。

只有通过External Provider治理、Target conformance、security/license review与Reconcile/Adopt后，候选才进入正式catalog，供Compiler Implementation Resolution自动选择。

## 类库认知成熟度

Brownfield五阶段与外部Provider L0-L5成熟度相互引用但不复制authority：

```text
L0 physical dependency
  Attach已冻结package/source/closure

L1 typed external invocation
  Lift已形成ExportedSymbol与TypedInvocation

L2 declared governed invocation
  Reconcile/Adopt已冻结用户声明的Contract/Effect边界

L3 observed/inferred Provider/Adapter candidate
  Lift/Reconcile保留Evidence、coverage和unknown

L4 verified Provider/Adapter
  Adopt + External Provider conformance完成，可进入正式候选catalog

L5 normalized SEC-owned projection
  Normalize完成完整表示、round-trip、迁移和旧writer删除
```

这些等级不是一条自动升级流水。一个package可以长期停在L0/L1或某些模块L5、其余区域opaque；不同capability必须分别评估。

## Provider 标准输出

TypeScript Compiler API、ts-morph、Tree-sitter、ast-grep、GitNexus、Graphify、CodeQL/CPG、runtime trace、IDE、build system 和 AI 都是 Provider。统一输出至少绑定：

```text
provider identity and revision
source / package / observation revision and scope
coverage and unsupported regions
confidence / observation class
diagnostics and failures
unresolved / ambiguous regions
evidence references
resource, network and execution boundary
```

Provider 只能增加 Evidence 与候选。它不能直接创建 authoritative Fact、source owner、writable path、ImplementationBinding或 Normalize decision。多个 Provider 一致不是多数票 authority；冲突必须保留 competing explanations。

Provider stale、partial 或缺失默认不阻止无关 canonical compiler pass，除非某个明确 Verification/Implementation contract 要求该 Provider；这种要求必须由相应owner声明。

## 黑盒、灰盒与白盒区域

- **Black box**：只有接口和运行结果；治理输入输出、Effect、Permission、Target、资源和Verification。
- **Gray box**：有类型、源码、文档、测试或trace，但覆盖与业务含义仍不完整；默认外部类库属于此层。
- **White / normalized**：SEC能够完整重建、验证、迁移并拥有writer的局部范围。

同一个package可以同时存在三类区域。源码可读不自动消除动态import、reflection、native、远程配置、运行时patch、环境或外部服务造成的unknown。

## Reconcile：裁决候选而不写入

Reconcile 将 Source Program Model 与 Semantic Contract、Engineering IR、Repository identity、owner policy、Target/Profile、External Provider evidence和competing explanations对齐，产生：

```text
accepted | rejected | conflicted | ambiguous | unknown | opaque
```

- accepted 只表示该 binding/claim 被显式 policy 或人接受；
- rejected 保留理由和 Evidence，不等于删除源码；
- conflicted 保留互不兼容的权威或候选；
- ambiguous 表示多个解释仍可行；
- unknown 表示覆盖或语义不足；
- opaque 表示有明确边界但内部不受 SEC 理解或重生成。

同名、路径邻近、运行时偶遇、高 confidence、相同 AST 形状、同名API、类型签名或框架惯例都不建立 canonical 关联。Reconcile 不能提前创建 Adopt owner，也不能修改 live source。

对于外部类库，Reconcile必须明确区分：

- observed call/type事实；
- user-declared Effect/Contract；
- inferred Provider/Adapter candidate；
- conformance Evidence；
- 可进入Implementation Resolver的正式candidate eligibility。

## Adopt：建立治理权力

Adopt 是明确决策：把某个 source region、Contract、binding、TypedInvocation或 boundary 纳入 Governed Source/Provider。它必须建立：

- stable identity、revision 和 source mapping；
- 唯一 source owner、writer 与 public surface；
- governed/extension/opaque classification；
- allowed operation、path 和 Effect boundary；
- Contract、Policy、Permission 与 Acceptance；
- minimum Verification 和 Evidence requirements；
- formatting/comment/unowned-region preservation；
- package/Provider/Adapter binding与Target要求（适用时）；
- migration、rollback/recovery 和退役条件。

Adopt 不是复制源码进入 IR，也不是把 inferred confidence 调高。没有 Block 的现有工程仍可拥有 app/source-module owner、Contract 和受控 Mutation；Block 不应成为语义存在的许可证。

Registry source 保持只读。镜像、copy、生成文件或未被 canonical frontend 装载的路径不能获得 writable authority。

Adopt一个Provider candidate只授权它进入正式catalog；最终是否选择、用哪个版本和配置仍由Compiler Implementation Resolution决定。

## Normalize：切换为 SEC-owned projection

只有 SEC 能完整表示、验证、round-trip 并安全迁移的模块，才可从 Governed Source/Provider 转为 SEC-owned deterministic projection。

Normalize 需要同时证明：

1. Entity/Fact、behavior、Effect、Permission 和 error semantics 完整；
2. source mapping、format/comments 和 public surface满足迁移政策；
3. target lowering、Implementation Binding和source bytes deterministic；
4. runtime/Acceptance/compatibility parity；
5. 所有 consumer 已迁移；
6. actual Delta、Impact 和 unexplained delta 为可接受结果；
7. rollback/recovery 可验证；
8. 旧 writer、adapter、dependency和duplicate authority 已删除。

Normalize 按 artifact/module/capability 逐步进行。无法完整映射的区域长期保留 Governed Extension 或 Opaque Boundary，不生成 TODO skeleton、`any` 或空 adapter 伪装完成。

## 与 Implementation Resolution 的接口

Brownfield向Implementation Resolution提供：

- adopted existing implementation candidates；
- verified Provider/Adapter candidates；
- typed invocation和custom governed candidates；
- package/source/behavior Evidence与unknown frontier；
- source owner、Target和migration约束。

Brownfield不拥有：

- hard eligibility总裁决；
- ResolutionPolicy与tie-break；
- 最终ResolutionDecision/ImplementationBinding；
- Target Program或Artifact publication。

Implementation Resolver不得通过选择某个candidate反向把inferred行为升格为authoritative semantics；候选无法满足合同只能被淘汰，不能修改上游合同。

## 写入合同

Attach、Lift、Reconcile 默认只读。Adopt 后的 Brownfield Mutation 必须：

- 通过版本化 operation registry；
- 从 canonical binding 解析 source owner 和 path；
- 使用 source-byte CAS、workspace lease 与 journal；
- 在隔离环境重新 parse/build canonical state；
- 计算 actual Delta/Impact 和 Verification union；
- 保留未拥有区域、格式和 comments；
- 原子 publish，或证明 exact prior state 已恢复；
- 对不完整 source mapping、ambiguous owner 或 unsupported side effect fail closed。

Codemod、LST/AST transform、Adapter candidate 或 AI patch 只产生 proposal。重新 parse/compile 成功不等于语义、安全或运行时 parity；最终必须由 canonical rebuild 与适用 Verification 证明。

## 配置、资源与多语言

框架/工具配置、memory/thread/process/network/storage、environment、deployment 和 native capability 在 Attach/Lift 中先作为 observed inputs。只有建立独立 schema、owner、identity/revision、lifecycle、Mutation、Impact 与 Verification 后，才可升格为 Repository domain、Target Profile、Provider capability或其他 Workspace domain 字段。

新增语言 Provider 至少要分离：

- frontend：syntax、symbol、type、module resolution 与 source mapping；
- source analysis：control/data flow、effect 和 framework binding candidate；
- language service：reference/rename/import organization等交互能力；
- source transformation：AST/LST/codemod与comment preservation；
- target backend：Target Program IR 到目标 bytes；
- build/runtime adapter：物理工具链与运行环境。

某语言 AST、字节码或编译器 IR 不能直接成为通用 Engineering IR。跨语言 FFI、RPC、schema、artifact 与 build boundary 通过稳定 Port/Contract 和 Repository/Target binding 连接。

同一品牌或package不能隐式承担上述所有能力。TypeScript CLI checker、Program/TypeChecker、Language Service、source transform/printer与ts-morph wrapper需要独立Provider capability、version和retirement边界。

## 安全与隐私

默认不上传源码、不读取未授权 secret/environment、不跟随越界 symlink/reparse、不执行不受信 install/build/test 脚本。需要 runtime trace、package manager、browser、native helper 或网络的 Provider 必须有显式 capability、环境隔离、超时、输出上限、secret policy、cleanup 和 Evidence scope。

“不扫描”不是“不存在”，“在 sandbox 中启动”也不自动证明业务安全。第三方或恶意代码执行需要独立 OS/container sandbox authority；普通 compiler validation 和本地临时目录不构成安全边界。

## Brownfield MVP 完成门

- exact revision 的物理 artifact/package inventory 无未解释遗漏；
- supported package/module/symbol 的 coverage 可重复；
- unknown、ambiguous、conflicted 和 opaque 可导航；
- Provider 输出不越权且保留 freshness/coverage；
- 至少一个无专用Adapter的package完成L0→L1 TypedInvocation并生成type-correct external call；
- 至少一个TypedInvocation被声明为Governed Extension并保留unknown behavior；
- 至少一个真实工程完成 Attach → Lift → Reconcile → Adopt；
- 至少一个Provider/Adapter candidate完成conformance并进入正式候选catalog；
- 至少一个完整可表示模块完成 Normalize、round-trip、Mutation 与 rollback；
- source/package move/change产生 deterministic delta census；
- 同输入重复导入与typed surface byte-stable；
- 没有 unexplained owner、consumer、generated-output、dependency 或 release drift。
