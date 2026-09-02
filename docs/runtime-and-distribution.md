---
title: 运行时与分发
status: stable
domain: runtime-distribution
---

# 运行时与分发

## 1. 所有权

本文拥有 runtime-neutral core 边界、SEC Host Runtime、Toolchain/Optional Capability physical adoption、package/runtime layout、dependency materialization、workspace physical primitives、distribution 与 Support maturity。

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

Windows protected Runtime State 的 owner/DACL proof 只由 native retained physical session 签发；每次消费重验 root identity、owner、protection、descriptor digest。PowerShell/icacls/shell text 不能成为 production authority 或每进程 admission。

## 13. Dependency materialization

~~~mermaid
flowchart TD
  RM[Root manifest] --> DG[Compiler dependency generation]
  LK[Lock and install config] --> DG
  PM[Retained package-manager capability] --> DG
  DG --> SR[Shared/project projections]
  SR --> RD[Strict readiness stamp and whole-object readback]
  RD --> C[Consumers]
  DG --> RT[Explicit generation retirement]
~~~

每个 dependency 唯一归属 Core/Host/Toolchain/Verification/Generated Target/Interface/External Provider/Release。package manifest 与 lock 单 writer；Resolver/Backend/Adapter/interface 不修改。

Dependency binding 同时绑定 manifest/lock/install config raw digests、package-manager physical identity、platform/architecture、direct/transitive manifests 与 resolution edges。

Compiler generation 是唯一 reusable identity。shared/project roots 只能复制 bounded closure 或 exact bridge，不再次调用 package manager；stamp 缓存完整 binding，不能自签 readiness。cache hit 验证 current root/toolchain/stamp/target tree；竞争 residue typed block，只有 retirement transaction 删除。

Journal/stamp/manifest 使用 retained non-reparse identity、shared operation budget、prepared-before-effect、typed unknown/recovery。readiness error 不能 catch 为 absent 后 install。

## 14. Browser、container、native

Browser Provider 只服务 Target workspace 的真实 browser Acceptance，不构成 SEC core UI/Workbench runtime。request-only/DOM-free/pure semantic tests 选择更窄 Provider；文件名不决定 capability。

Container、process containment、native helper、FFI、test environment 是 Optional Capabilities。缺失、unsupported、not-run、failed 分离；是否 block 由 Requirement/Compatibility/Support owner 决定。temp/process/browser context 本身不是 malicious-code sandbox。

## 15. Public distribution

~~~mermaid
sequenceDiagram
  participant R as Exact release revision
  participant B as Release builder
  participant V as Verification
  participant P as Publisher
  R->>B: clean tree + exact Binding + accepted generation
  B->>V: package exports assets dependencies SBOM
  V-->>B: host/target install runtime Evidence
  B->>P: signed artifact + checksum + attestation
  P-->>B: publication receipt
  B->>B: remote/local readback
~~~

不得从 live working tree 递归复制或 force-push 重写 public main。公开 projection allowlist 排除 private docs/session/secret/Registry/cache/test residue/nonpublic Provider。

验证覆盖 exports/entry/launcher/module policy、assets、dependencies/license/native/install scripts、declared Hosts、Target deps、cross-host determinism、privacy/permissions/metadata、SBOM/signature、rollback/yank/deprecation/migration。

## 16. Support invalidation

EOL/security policy、dependency support drop、Provider withdrawal、Binding invalidation/Delta、Compatibility invalidation、package smoke failure、platform/ABI regression、incident 或 artifact不可重现都使 Support invalidated。

失效后停止新承诺，保留 affected Binding/Delta/Compatibility/environment/Evidence，选择 fix/re-resolution/migration/deprecation/retirement，重新完成 physical package/deploy proof 后才能恢复。README table、旧 PASS 或仍可安装不能覆盖。

## 17. 无代码逻辑验证

| 场景 | 必须结果 | 禁止 |
|---|---|---|
| Bun缺失但Node存在 | Host unavailable | Node fallback |
| tool未安装 | adoption unavailable | session下载工具 |
| checker mismatch | zero typecheck Effect | ambient PATH checker |
| warm cache与clean输出不同 | cache invalid | warm结果 authority |
| child exit 0但descendant活着 | settlement failed/unknown | completed |
| target为Node、SEC host为Bun | 两轴同时合法 | 推断同一 runtime |
| dependency scan EACCES | unresolved | cache miss/install |
| lock/journal schema drift | migration/recovery-required | 默认字段兼容 |
| browser已从SEC core退役 | core正常；Target browser仍可选 | 删除Target capability |
| release build来自dirty tree | reject | copy后hash |

## 18. 完成条件

~~~text
RuntimeClosed =
  runtime-neutral core
  AND one Bun Host generation
  AND provisioning separated from adoption
  AND retained capability plus shared budget and settlement
  AND Source Program and Verification truth not duplicated
  AND dependency generation has one owner and recovery
  AND Host Toolchain Target Runtime axes remain orthogonal
  AND release is clean reproducible and read back
  AND Support can be invalidated and recovered
~~~
