---
title: 运行时与分发
status: stable
domain: runtime-distribution
---

# 运行时与分发

## 1. 所有权

本文是 runtime-distribution 的公共 root，拥有 runtime-neutral core、Host Runtime、Toolchain/Optional Capability adoption、package/runtime layout、workspace physical authority与platform capability。Dependency materialization 和 distribution/support 由本文件列出的规范片段拥有。

~~~mermaid
flowchart TD
  SC[Semantic Core] --> CP[Compiler pure plans]
  HP[Host Runtime Profile] --> OP[Operation execution]
  TP[Toolchain Provider] --> OP
  OC[Optional capabilities] --> OP
  CP --> OP
  IB[Exact Implementation Binding] --> MAT[Dependency and artifact materialization]
  OP --> MAT
  MAT --> RE[Runtime Evidence]
  RE --> PKG[Clean package]
  PKG --> DEP[Deployment]
  DEP --> SUP[Support Claim]
~~~

Target Profile/Resolution 属于 compiler；Delta/Impact 属于 delta owner；Compatibility/Migration 属于 change owner；Verification Result 属于 verification owner。Runtime 只产生 physical capability/materialization/runtime/support Evidence。

## 2. 正交轴

| Axis | Owns | Cannot infer |
|---|---|---|
| Semantic Core | runtime-neutral semantics/pure transforms | Host capability |
| Host Runtime | 执行 SEC 的 runtime/OS/process/fs | Target |
| Toolchain Provider | checker/build/test/package executable | semantic correctness |
| Target Profile ref | 生成目标 requirements | current Host |
| Implementation Binding ref | exact provider/package/config closure | compatibility |
| Runtime Environment | 被测/部署程序环境 | SEC Host support |
| Optional Capability | native/container/browser/OS specialization | core availability |
| Distribution | package/install/deploy Evidence | semantic authority |
| Support | policy + maintained physical evidence | permanent validity |

Host 成功不证明另一个 Host；install success 不证明 candidate eligible；process.execPath 不证明 Toolchain authority。

## 3. Runtime-neutral Core

Core 公共图只含 semantic types/builders/validators/identity/canonicalization/pure Delta/Impact/lowering/projection。Host I/O、process、path、watcher、clock、random、browser、OS adapter 与具体 library implementation 不可静态加载进 Core。

~~~text
RuntimeNeutral(module) =
  no host-specific static dependency
  AND no initialization Effect
  AND no ambient capability
  AND platform-specific behavior injected by typed Port
~~~

平台特有 capability 可在 Optional Adapter 中存在；缺失时 typed unsupported，不降级污染 Core。

## 4. SEC Host Runtime

Host Profile 绑定 runtime family/version、OS/architecture、filesystem/path、process tree/signal/streams、lock/rename/link/fsync/ACL/temp、watcher/network/native adapters、module/assets、sandbox/credential 与 support Evidence。

SEC first-party source、CLI、development operations 与 canonical local Verification 只支持一个 Bun Host Runtime generation。ambient Node executable、Node-only entrypoint、dual-runtime selector 或 Bun 失败 fallback Node 不属于 SEC Host。

Bun 支持 node namespace APIs 或 node_modules layout 不代表 Node Host support。只有 native Bun API 在实测中减少 closure/cost且增强 typed semantics、不创建第二 owner 时才替换标准 API；不按 import 字符串机械改写。外部 Provider 内部需要 Node 时，它是 Provider opaque implementation dependency。

## 5. Provisioning 与 physical adoption

~~~mermaid
flowchart LR
  PV[Explicit provisioning operation] --> IT[Installed tool]
  IT --> LOC[Candidate locator]
  LOC --> PA[Physical adoption]
  PA --> PS[Opaque physical session]
  PS --> SS[Semantic session]
  SS --> OP[Domain operation]
~~~

| Provisioning | Adoption |
|---|---|
| install/upgrade/uninstall/download/extract | 使用已存在 capability |
| system/user/package-manager owner | runtime/provider session owner |
| 单独授权 Effect | 不得反向触发安装 |

PATH/registry/standard location 只是 locator。adoption 认证最小因果 closure：retained launcher/effective executable、loader dependencies、cwd、version/bytes/physical identity、pre/post fence、deadline/budget 与 settlement。不可证明则 unavailable；不复制完整发行树或建立 SEC executable cache。

Registered host control capability 只消费 external-provider owner 签发的 opaque physical session；Runtime 不拥有 EnvironmentSpec、credential、remote semantic 或 route state。

## 6. Toolchain Provider

Toolchain Provider 声明：

| Facet | Contract |
|---|---|
| executable | identity/version/integrity/adoption authority |
| command | schema、cwd、inputs/outputs、environment |
| dependencies | lock/cache/materialization generation |
| Effect | network/postinstall/native/secret boundaries |
| resource | absolute deadline、process/stream/input/output budgets |
| settlement | descendant cleanup、readback、typed receipt |
| lifecycle | platform support、unsupported、retirement |

Repository 可用与 Host 不同的 Toolchain，也可生成另一 Target；三者 identity 独立。

## 7. Language semantics 与 typecheck Effect

~~~mermaid
flowchart TD
  CM[Content Manifest] --> SP[Source Program owner]
  SP --> CL[Exact project/module closure]
  CL --> VR[Verification Action requirement]
  TS[Selected Toolchain capability] --> EX[Typecheck physical execution]
  VR --> EX
  EX --> ST[Settlement + final fences]
  ST --> RES[Verification Result/Evidence]
  CL --> FS[Content-addressed fact shards]
  FS --> EX
~~~

| Owner | Owns |
|---|---|
| Source Program | exact source/symbol/module closure、unknown、fact shards |
| Verification | Action identity/ActionKey/reuse/terminal |
| Dependency | generation/transition/recovery |
| Runtime/Toolchain | selected physical capability、retained exe/cwd、env、budget、settlement |

Selection 返回 opaque selected capability 或 typed unavailable/mismatch/unverified；非-selected 状态零 typecheck Effect，禁止 PATH/global/other checker/caller-runner fallback。

### Incremental 与性能

- Source Program、typecheck、audit、test-impact 复用一个 exact Content Manifest；
- fact/cache/build-info 是可丢弃 acceleration，不拥有 PASS/authority；
- build-info 采用 per-Action private generation，final fence 后短 lease CAS 发布 seed；
- publication competition 只丢 cache update，不改变 result；
- cold/warm/delta 与 cache-disabled clean output 等价；
- Windows Runtime State ACL/ownership proof 由 native retained session 在 operation 内复用，不让每个短命进程启动 presentation shell；
- 不用常驻 daemon 掩盖重复扫描或 capability 边界错误。

一个 typecheck operation 的 source observation、adoption、child、stream、cleanup、final fence、terminal readback 共享 absolute deadline 与 aggregate filesystem/process/input/output/entry/byte ledger。

跨进程加速严格消费System Architecture的`ReusableKnowledge`与Implementation Architecture的`WorkspaceViewContinuity`：Source Program/Merkle是`DerivationShard`，build-info与Language Service内存是`AccelerationSeed`，Windows root owner/DACL、toolchain executable和Provider health是`ObservationCertificate`。Runtime只实现各variant的retained physical binding、attach、resource accounting与失效readback；它不能把seed命中、path相同、daemon存活或零watcher事件提升为fresh observation或type PASS。

```text
TypecheckRuntimeFastPath =
  attach exact SourceObservationGeneration
  -> validate checker/dependency/host ObservationCertificates
  -> lookup exact Verification ActionKey terminal
  -> fresh terminal ? zero child + referenced readback
                    : execute selected checker under one ledger

Continuity gap | ACL/security epoch drift | provider generation drift
  -> invalidate only dependent certificates/shards/results
  -> bounded clean observation or typed unresolved
```

因此“热”不是某个后台进程存在，而是exact generation、continuity、certificate与ActionKey仍可验证；服务退出只损失加速，不能损失知识或改变业务结果。昂贵ACL事实可由native retained provider一次观察并在有效security epoch内复用，但每次attach仍验证root/subject/epoch关系；覆盖不明或系统不提供可靠continuity时回到一次bounded native observation，不启动presentation shell也不无限缓存。

## 8. Target 与 Binding physical interface

Runtime 只消费 Target identity/revision、runtime/build/test/package/deploy requirements、target dependencies/platform support；不复制 Target fields 或从 Host/cwd/layout 推断 Target。

ImplementationBinding physical requirements 包含 provider/package/exact version/integrity、Adapter/config、dependency/native/install/build closure、Host/Toolchain/Runtime、resource/network/fs/process/secret、Verification/conformance/support 与 materialization requirements。

Runtime 可以：

- 判 capability available/unsupported/unknown/invalidated；
- materialize dependency owner 批准的 exact closure；
- 产生 package/install/runtime physical Evidence；
- 返回绑定 old Binding 与 observation identity 的 result。

Runtime 不可以排名 Provider、把 install success 变 eligible、自动换实现、从 manifest/lock/materialized tree 反推 Binding、生成 Binding Delta/Compatibility 或调用 Compiler 重选。

## 9. Support maturity

~~~mermaid
stateDiagram-v2
  [*] --> PolicySelected
  PolicySelected --> Implemented
  Implemented --> PhysicalVerified
  PhysicalVerified --> PackagedVerified
  PackagedVerified --> Supported
  Supported --> Invalidated: EOL incident provider or platform regression
  Invalidated --> PolicySelected: re-resolution or fix
  Invalidated --> Retired
~~~

Support profiles 区分 minimum compatibility、primary reference、canary、retired baseline；具体版本在 machine support profile，不写稳定 prose。Binding、Delta empty、single PASS 或 package success 都不能跳到 supported。

## 10. Package/runtime layout

一个 execution 唯一解析：

| Root | Meaning |
|---|---|
| package root | metadata/dependency resolution |
| executable module | CLI/runtime entry |
| runtime asset root | official resources/templates/policies |
| development source root | public package可不存在 |
| caller workspace root | 用户目标工作区 |

caller cwd 不参与 package/resource 定位。source、bundle、isolated compiler、clean installed package 投影同一 layout contract；ancestor guessing、adjacent checkout、global registration 与 env path fallback fail closed。

## 11. Workspace physical authority

~~~mermaid
stateDiagram-v2
  [*] --> Observed
  Observed --> Acquired: exact generation lease
  Acquired --> Active: heartbeat and identity fences
  Active --> Published: physical publication
  Active --> Unknown: durability unresolved
  Published --> Released: readback and cleanup
  Unknown --> Recovery: owner/topology proof
  Recovery --> Released
  Recovery --> Residue
~~~

一个 workspace 默认一个 writer generation；并行需 domain/resource resolver 证明。acquire/heartbeat/release/recovery/commit fence 绑定 workspace、owner、physical identity。timeout 不证明 owner dead；recovery 不移除后继 writer。唯一 inspector 服务 Gate/audit/recovery。

## 12. Platform capability

| Capability family | Required facts |
|---|---|
| path | drive/UNC/namespace/long path/case/Unicode |
| topology | symlink/junction/reparse/hardlink |
| persistence | rename/link/fsync/durability |
| process | tree/signal/job/group/stream settlement |
| security | permission/ACL/owner/principal |
| lifecycle | temp/cleanup/watcher/network/port/native ABI |

Logical identity 使用 repository-relative canonical Address；physical semantics 使用声明平台 Provider。WSL/POSIX Evidence 不替代 Windows，反之亦然。watcher event 是 invalidation hint；bytes/object/readback 才是事实。direct child exit 不证明 descendants/ports/streams/temp/locks 收口。

### 12.1 Physical path capability

路径长度不是repository常量，也不是单一OS属性。任何会让filesystem、process、Git、archive、compiler或container消费physical path的operation必须绑定由实际Provider签发的能力：

```text
PhysicalPathCapability {
  hostAndProviderGeneration
  pathNamespaceAndEncoding
  rootPhysicalBinding
  consumerApiOrExecutablePhysicalBinding
  processManifestAndProviderConfiguration
  componentRules + topologyRules
  admittedLengthSemantics | typed-unknown
  conformanceObservationRefs
}

PathAdmission(operation, root, capability) =
  candidatePaths := expandWorstCasePhysicalPaths(operation, root)
  every candidate satisfies capability namespace/component/topology/length rules
  ∧ provider configuration is effective before the first Effect
  ∧ root and consumer binding remain exact through settlement
```

`259`、`MAX_PATH`、prefix长度、固定padding或当前temp root长度不能作为跨Provider真值。若某个legacy child确实只能消费特定上限，该限制属于它的Provider conformance fact，并绑定其exact executable/manifest/API route；切换native API、long-path namespace、Git配置或root都会产生新Binding。配置必须在首次相关Effect前生效；“先在深path执行，再在该path内开启longpaths”不构成admission。

测试必须从`PhysicalPathCapability`与operation expansion函数生成`accepted / boundary / rejected`样例，不能用`repeat(n)`猜宿主阈值。pure parser/framing测试只使用in-memory bytes；physical path conformance单独观察真实Provider并在unsupported/unknown时返回typed结果，二者只有共享同一Claim时才允许组合。

Windows protected Runtime State 的 owner/DACL proof 只由 native retained physical session 签发；每次消费重验 root identity、owner、protection、descriptor digest。PowerShell/icacls/shell text 不能成为 production authority 或每进程 admission。


## 规范片段

本文件保留 runtime、host、provider、toolchain、target、layout、workspace 与 platform 合同；依赖物化和分发支持由下列独立规范片段拥有。

| 片段 | 独立职责 |
| --- | --- |
| [依赖解析、物化、共享与回收](runtime-and-distribution/dependency-materialization.md) | 本片段把系统物化代数实例化为 dependency Requirement/Binding/Generation/Projection、GenerationKey、readiness、consumer access、failure、GC 与 migration；通用 store/coordination/resource/process primitives 只引用其系统 owner。 |
| [平台能力、分发与支持](runtime-and-distribution/distribution-and-support.md) | 本片段拥有 browser/container/native 分类、public distribution、support invalidation、逻辑验证与完成条件。 |
