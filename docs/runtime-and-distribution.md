---
title: 运行时与分发
status: stable
domain: runtime-distribution
---

# 运行时与分发

本文拥有 Semantic Core 的 runtime-neutral 边界、Host Runtime Profile、Toolchain Provider、Optional Capability Adapter、package/runtime layout、平台能力、物理materialization、公开分发与 Support Claim maturity。生成目标的 canonical Target Profile、Type Algebra、Implementation Resolution 和target capability validation只由 `docs/compiler-target-ir.md` 及其代码合同拥有；本文仅消费Target requirements与冻结ImplementationBinding的typed physical requirements。

Fact/Binding Delta与Impact由`docs/delta-and-impact.md`拥有；Compatibility与Migration由`docs/change-management.md`拥有；Verification Result由`docs/verification-governance.md`拥有。Runtime只产生物理capability、materialization、package/install/runtime和support Evidence，不建立第二Resolver、Comparator或Compatibility evaluator。

除已注册 EnvironmentSpec 明确拥有的静态环境合同值外，精确 release schedule、当前支持矩阵、依赖清单、
可执行路径、协议字段和 physical Gate 结果由 package metadata、代码合同、release/support profile 与 Evidence
拥有。EnvironmentSpec 的静态值不能被 package metadata、ledger projection 或 live Evidence 复制成第二 owner。

## 正交轴

- **Semantic Core**：runtime-neutral 的 Engineering IR、identity、revision、validation、pure Delta/Impact、lowering 与 projection。
- **Host Runtime Profile**：执行 SEC CLI 或 adapter 的进程平台和能力。
- **Toolchain Provider**：install、test、typecheck、bundle、format、package 等工程命令的独立 executable/version authority。
- **Target Profile reference**：由 Compiler authority 提供的生成目标 language/runtime/module/delivery/capability要求；本文不复制其字段或 validator。
- **Implementation Binding reference**：由Compiler authority冻结的具体Provider/package/version/config/Adapter/Target/dependency requirements；本文只验证和materialize物理要求，不重新选择实现。
- **ImplementationBindingDelta reference**：由Delta/Impact authority比较old/new Binding产生；本文只为其physical facets提供Evidence，不修改Delta。
- **Compatibility / Migration reference**：由Change Management基于Delta、Contract和Evidence产生；本文只执行被授权的物理步骤。
- **Runtime Environment**：被测试或部署的目标程序实际运行环境，与 SEC Host 和生成 Target identity分离。
- **Optional Capability Adapter**：native、FFI、container、OS hardening 或平台专有能力；缺失时返回明确 capability result。
- **Distribution / Support**：package/public artifact、安装、发布、部署 Evidence 与支持成熟度。

任何一轴都不能推断另一轴。某 Host 成功不证明另一 Host；Target runtime requirement不决定当前Toolchain；`process.execPath`不代表Toolchain authority；在一个Toolchain下生成另一Target也不证明该Target、Runtime Environment、Binding或Host已受支持。一个Provider可安装也不证明它满足Semantic Contract、会被Implementation Resolver选择、Binding未变化或Compatibility成立。

## Runtime-neutral Core

Semantic Core 的公共类型、builder、validator、identity/revision、canonical ordering、pure Delta/Impact 和 target-independent lowering 不得加载Host-runtime、browser、OS/platform-specific adapter或具体类库实现。平台 I/O、process、path、watcher、crypto、clock 和 random 必须经明确 Port/Provider 注入或停留在 Host/Toolchain/Verification 层。

“使用标准库”不自动等于 runtime-neutral；静态可达图、初始化副作用、package exports 和 transitive dependencies 都属于公共图验证范围。

Runtime-neutral 不代表所有物理能力都抽象成最低公分母。平台特有能力可以存在于明确 Adapter，但必须在缺失时 deterministic unsupported，而不是污染 Core 或静默 fallback。

## Host Runtime Profile

Host Profile 表达 SEC 当前执行进程需要的能力，例如：

- runtime family 和 version range；
- OS、architecture、filesystem 和 path semantics；
- process tree、signal、job/process group、stream settlement；
- file lock、rename/link/fsync、permission/ACL 和 temp能力；
- watcher、network、port、browser/native adapter availability；
- package/module loading 与 runtime asset location；
- security、sandbox、credential 和 local transport边界。

Host Profile 只描述 SEC executor，不决定生成项目的 Target Profile或ImplementationBinding。它具有独立 identity、revision、capability validator、physical Evidence 和 support maturity。

### SEC host runtime 唯一性

SEC first-party source、CLI、development operation与canonical local Verification只支持一个Bun Host Runtime generation。`node`可执行文件、ambient Node installation、Node-only entrypoint、双runtime selector或Bun失败后回退Node均不在SEC host support面；它们不得进入PATH discovery、provider selection、测试分支、package script或support claim。当前exact Bun version、archive、digest与generation由package metadata、EnvironmentSpec与capability ledger/generated projection拥有，稳定文档不复制版本号。

Bun实现的`node:`标准库API、`NodeJS.*`类型名或`node_modules`物理布局只是Bun capability/package contract的一部分，不代表Node Host support。只有当Bun native API在实测中同时给出更小依赖闭包、更强typed semantics、更低resource/settlement成本且不创建第二owner时，才用它替换已由Bun正式支持的标准API；禁止按import字符串机械改写。外部Provider内部需要的Node runtime是该Provider的opaque implementation dependency，必须留在其sandbox、credential、version与settlement合同内，不扩大SEC Host Profile。

### Host tool provisioning 与 adoption

已安装 host tool 的 runtime adoption 不能拥有 provisioning。install、upgrade、uninstall 与 distribution cache
属于系统、用户或显式 package-manager workflow；production command session 只能采用当前机器上已经存在的
capability。session open、health、discovery、cache warmup 和 recovery 均禁止下载 archive、执行 installer、
解压或复制工具发行版。不可采用时返回 typed unavailable，由单独授权的 provisioning operation 处理。

adoption 只认证 invocation 的最小因果闭包：retained launcher/effective executable、真实 app-local/system loader
dependencies、retained cwd、exact version/bytes/physical identity 与 pre/post settlement fence。不得用递归安装树
inventory、完整发行版 copy 或 SEC-owned executable cache代替；admission 成本必须由固定 entries/bytes/deadline
约束并与最小闭包成正比。PATH/registry/standard location 都只是 candidate locator，不是 authority；physical
capability 只能流向 semantic session，再流向 operation，consumer 不能自行 spawn 或反向触发安装。

### Registered host control capability

Runtime/Distribution只消费External Provider owner签发的opaque physical session，并把它作为Host Profile的可选能力；不拥有provisioning、EnvironmentSpec内容、route状态、repository/remote-service语义、credential或Effect。静态profile、artifact、layout、endpoint、version、digest与resource ceiling由machine spec唯一拥有，live availability由ledger/session receipt拥有，稳定runtime文档不复制具体值或当前状态。

session必须绑定本次invocation的retained executable/cwd与最小loader closure、operation deadline/aggregate budget、pre/post identity和terminal settlement。parser、PATH candidate、profile digest或ledger row都不能自签live authority；不可证明、unsupported或provider unavailable时typed fail closed，禁止裸PATH、跨平台替换、安装fallback与consumer-specific wrapper。
## Toolchain Provider

Repository可以使用与Host runtime不同的Toolchain Provider，也可以生成另一Target runtime；这些组合必须分别绑定Host、Toolchain与Target identity、版本、platform、command contract和Evidence。

Toolchain Provider至少声明：

- executable identity、version和安装authority；
- command schema、cwd/input/output和environment closure；
- dependency/lock/cache authority；
- network、postinstall、native、secret和side-effect边界；
- timeout、process cleanup和receipt；
- platform compatibility、unsupported和retirement。

runtime-specific、toolchain-specific或native library只能进入明确Host/Toolchain/Target/Adapter边界。只有进入common public graph的依赖才必须同时满足所有声明Host的静态加载和物理运行合同。

### Language semantics 与 typecheck physical Effect

language-semantic observation与项目typecheck Effect是不同capability。Source Program owner拥有exact source snapshot上的symbol、type、
reference与module projection及其incremental lifecycle；Verification owner拥有Action identity、reuse和terminal result；Dependency owner
拥有generation、transition与recovery。Runtime/Toolchain只拥有selected physical capability、command contract、retained executable/cwd、
canonical environment、aggregate deadline/budget、process/stream settlement和post-execution physical readback。

selection必须返回opaque selected capability或typed terminal unavailable/mismatch/unverified；非selected状态保持零typecheck Effect，
不得fallback到ambient PATH、全局package、另一checker或caller runner。任何materialization完成后产生新的selection epoch，不能把
unknown或mismatch改写为absent。

cache、incremental compiler state与build information只是各自semantic owner签发的derived acceleration；它们必须位于authoring tree之外，
绑定exact inputs，可丢弃且不拥有PASS、Evidence、dependency readiness或provider authority。hot/cold选择不能改变observable result，
旧snapshot/provider epoch必须终止live resources后才可回收。

编辑期与正式检查的Action identity、ActionKey、Result、Evidence与复用只由Verification Governance拥有；Runtime只消费两类owner-issued action requirement，并保证它们不会因共享物理checker或cache而被相互升级、别名或复制。Source Program owner拥有exact source/declaration/module-resolution closure、unknown frontier与content-addressed fact shards；Runtime不重建Program、不扫描第二份source graph，也不把cache hit、shard、index或mtime投影为PASS。

Runtime只在物理层保证：选中的checker capability、retained executable/cwd、canonical environment、dependency/provider generation、absolute deadline与aggregate ledger、process/stream settlement、final physical fence、cache位置与回收。Git对frozen candidate、Review、merge、publish和Evidence所需的exact tree观察仍由Git/Verification owner拥有；普通编辑期检查不得为此重扫全工作树。

增量build information采用per-Action private generation；稳定seed只作可丢弃性能输入，不进入Action identity或Evidence。检查完成、final input
fence通过后，才在短publication lease内CAS发布新seed；publication竞争或失败只丢弃cache更新，不改变检查terminal。不同Action不得并发写
同一build-info，崩溃残留不能触发dependency install、恢复Effect或把partial state提升为PASS。

性能根治以删除重复事实生产和昂贵物理admission为先，不以常驻language daemon掩盖边界错误。Source Program签发唯一exact project
input/module closure，所有消费者复用同一generation；Runtime State将跨进程可复用的fact/cache投影绑定完整producer closure。
runtime/cache root的permission与ownership proof由physical owner通过retained host capability一次完成并在同一operation内复用，不得让每个短命进程
各自启动presentation tool重做证明。若强度等价的host proof不可用，返回typed unavailable/unknown，不回退到较弱证明。

一次language-check operation的source observation、capability adoption、checker child、stream、cleanup、final fence和terminal readback共享一个
absolute deadline与aggregate filesystem/process/input/output/entry/byte ledger。terminal失败必须持久化bounded typed result body及其digest，
CLI只能投影该canonical settlement；只保存`process-settlement-failed`与opaque digest而无法区分setup、execution、cleanup或readback的结果
不是可恢复合同。fresh terminal或fresh failure的复用由Verification owner按其Action identity决定；Runtime只保证相应物理settlement未被第二次执行或弱化。

具体language frontend、runtime/package品牌、Program/API对象、cache布局、Git observation、ActionKey grammar、dependency journal states、
provider selection实现和测试集合只属于对应machine contract与generated current projection，不进入Runtime stable prose。

## Target Profile reference

Compiler authority唯一拥有Target Profile，包括language、runtime family/range、module system、delivery、package manager、persistence、database、UI、verification、deployment和capabilities。

Runtime/Distribution只消费：

- target profile identity/revision；
- target runtime requirements；
- required build/test/package/deployment capabilities；
- target-specific dependency和artifact inventory；
- declared platform/support requirements。

本文不能复制Target字段、另建compatibility switch或从当前Host、Toolchain、`cwd`、package layout和ambient executable推断Target。未知Target组合由Compiler在emit前拒绝；Runtime只报告Host/Toolchain/Distribution是否能物理满足已解析要求。

## Implementation Binding 的物理接口

ImplementationBinding由Compiler在hard eligibility、ResolutionPolicy和deterministic tie-break后冻结。Runtime/Distribution只消费其中的物理要求，例如：

```text
binding identity / revision
Target Profile reference
provider / package / exact version / integrity
Adapter and configuration revision
dependency / peer / native / install / build closure
required Host / Toolchain / Runtime capabilities
resource, network, process, filesystem and secret requirements
required Verification / conformance / support references
artifact and package materialization requirements
```

本文负责：

- 判断所需Host/Toolchain/Runtime capability是否`available | unsupported | unknown | invalidated`；
- materialize由Dependency authority批准的exact closure；
- 对clean package/install/runtime surface产生physical Evidence；
- 输出package、dependency、native、install/build、resource和support observations；
- 发布绑定旧Binding与physical observation identity的typed result，由外层Operation owner决定后续失效、验证或新epoch；

本文不负责：

- 在多个Provider/版本间排名或选择；
- 因某实现安装成功而把它标为eligible；
- 因当前Host缺失能力而静默换Provider、降低Semantic Contract或改变Target；
- 从package manifest、lock、ambient executable或已有materialized dependency tree反向推导Binding；
- 比较old/new Binding或生成`ImplementationBindingDelta`；
- 按物理结果签发Compatibility或Migration；
- 把Runtime fallback写成第二Implementation Resolver。

Binding引用的Target、Host、Toolchain、Provider或Support revision变化时，旧physical结果失效。若需要新实现，外层Operation owner必须获得新的resolution authorization并启动新的Compiler/Resolution epoch；Delta/Impact比较old/new Binding，Change Management再裁决Compatibility/Migration。Runtime不能调用Compiler、请求重选、修改旧Binding或直接替换依赖/发布。

## 支持版本策略

公开Host至少区分：

- **minimum compatibility baseline**：承诺兼容的最低版本；
- **primary reference baseline**：开发、性能和主要physical Evidence的参考版本；
- **canary baseline**：只用于提前发现未来不兼容，不是支持承诺；
- **retired baseline**：不再进入普通Gate，但有明确退出和迁移说明。

版本选择由实际用户约束、上游安全支持、维护成本、依赖兼容和physical Evidence共同裁决，并记录在机器可读support profile；稳定正文不固定某个年份的版本号。

Support Claim成熟度固定为：

```text
policy selected
→ implementation entered main
→ exact physical tests passed
→ clean packaged/deployed surface passed
→ product support claim enabled
→ usage / incident feedback maintained
```

ImplementationBinding存在、Binding Delta为空或不存在、Verification PASS、Compatibility、implementation entered main和package success都不能直接跳到product-supported。

## Package 与资源布局

一个执行实例必须解析唯一：

- package root；
- executable module；
- runtime asset root；
- development source root（公开包可以不存在）；
- caller workspace root。

Package metadata、dependency resolution和可重建Toolchain state以package root为基准；official registry、policy、templates和随包资源以runtime asset root为基准；caller `cwd`只表示用户workspace，不参与compiler package/resource定位。

Source、bundle、isolated compiler和clean installed package必须投影同一layout contract。未知module layout、ancestor search、环境变量猜测、相邻checkout或全局注册全部fail closed。

## Workspace 写 authority

Common workspace write authority必须只依赖公共Host baseline能力，并提供同一个read-only inspection contract。稳定机制要求：

- 一个workspace同一时刻只有一个合法writer generation，除非domain/resource resolver证明并行安全；
- acquire、heartbeat、release、recovery和commit fence绑定exact workspace、owner与physical publication identity；
- publication区分未发布、已发布和durability unknown；
- recovery只在owner liveness、generation和topology可证明时推进，不按时间、内容相似或猜测路径夺取所有权；
- release/recovery不得移除后继writer；
- inspector是Gate、audit和recovery census的唯一parser；
- crash、TOCTOU、异步cleanup和历史压缩有fail-closed条件。

具体generation ledger、marker、terminal shape和cleanup algorithm由代码合同与fault tests拥有。Semantic Mutation拥有单次canonical/source transaction语义；Composition拥有desired artifact tree publication；Runtime只提供Host capability、physical primitive和Evidence。

## Windows、Unix、WSL 与平台能力

Logical repository/artifact identity使用canonical repository-relative POSIX表达；physical path由声明平台的path Provider处理。校验Windows路径时使用Windows语义，校验POSIX路径时使用POSIX语义，不能使用当前进程平台代替目标平台。

平台能力至少包括：

- path、drive/UNC/namespace/long path、case和Unicode；
- symlink、junction/reparse、hard link、rename/link/fsync；
- process tree、signal、job/process group、stream settlement；
- filesystem permission、ACL/owner、temp root和cleanup receipt；
- watcher/invalidation、network/port、browser executable和native ABI。

WSL/Linux Evidence不替代Windows native，Windows Evidence也不替代Linux/macOS。Watcher event只是invalidation hint，真实bytes、Git/object identity和重新读取结果才是变化事实。Direct child exit不证明descendant、port、stream、temp或lock已收口。

通用path/process/watcher/temp库可以作为Provider实现，但不能替代SEC对owner、capability、lease、cleanup、platform binding和Evidence的合同。

Windows Durable Runtime State 的 owner、受保护 DACL 与 writer principal 证明只由 Runtime State physical owner 的 native retained session签发。session在同一进程内复用Win32 security-descriptor读取，但每次消费都重验root physical identity、owner、DACL protection与exact descriptor digest；root或ACL变化、session关闭、provider不可用、取消或deadline耗尽一律fail closed。PowerShell、`icacls`、shell文本和环境路径不能成为production authority或每进程admission路径。

## 依赖作用域

每个依赖必须唯一归属于：Semantic Core、Host、Toolchain、Verification、Generated Target、Agent/CLI Interface、External Provider或Release。根manifest不应长期同时充当Core、生成目标、native helper和外部分析工具的发布authority。

package manifest与lock保持单一writer。ImplementationBinding只能请求一个exact dependency closure；Dependency authority验证并materialize它，不能让Resolver、Backend、Adapter或Agent/CLI interface直接修改package/lock。

派生dependency root只允许保存canonical manifest投影、materialized modules、cache、lease与readiness
stamp；它不是第二个package authority，不能持有lockfile、package-manager config或workspace config。
唯一resolution effect消费Dependency owner签发的canonical root manifest、lock、install configuration与package-manager executable binding，生成compiler dependency generation；shared/project root不得再次调用package manager，只能从该generation复制完整有界closure或建立exact bridge。具体文件名、package-manager品牌、版本与路径只存在于machine contract。Materialization binding必须同时绑定lock、根manifest与install config raw digest、package-manager物理可执行文件与digest、
platform/architecture、每个direct/transitive package manifest和resolution edge。首次publish必须验证source
generation与staged projection，后续cache hit只验证current root/toolchain、strict stamp与目标tree，不重复扫描
已不参与运行的source generation。任何竞争authority残留一律保留并typed-block；只有显式
generation-retirement transaction拥有删除权，readiness不得借自动cleanup、测试cleanup或全局cache断言成立。
Compiler generation本身的binding是唯一可复用identity；不得再用`.tmp` stamp复制并自签package、lock、
toolchain或readiness facts。Shared/project stamp只缓存已验证的完整materialization binding，不能替代source与
target whole-object readback。
允许生成的manifest/stamp也必须以non-reparse physical file与retained-handle identity读写；名称或inode漂移
必须typed-block，不能沿路径重查后写入替换对象。

引入、升级或删除依赖前必须检查：

- actual old/new Binding与适用`ImplementationBindingDelta`；
- 实际import/load graph和运行入口；
- Host/Target/Toolchain/platform matrix；
- install/build/postinstall/network/native side effects；
- package exports、bundling、license和supply-chain；
- optional/fallback behavior和缺失时diagnostic；
- clean package与consumer Evidence；
- Compatibility Decision、Migration、consumer cutover与retirement。

没有import不等于没有build/runtime dependency；有依赖声明也不等于public graph会加载它；已在lock中也不等于它是当前Binding、compatible或正式支持能力。

## Browser、container 与 native Provider

Browser Provider只服务验证Target workspace真实浏览器行为的Acceptance，不构成SEC产品自身的browser/Workbench/UI runtime；request-only、DOM-free或pure semantic test使用更窄Provider。测试文件位于acceptance目录不自动意味着必须启动browser；Gate contract、test fixture需求和实际capability共同决定。

container isolation、OS process containment、native helper、FFI与test-environment providers属于Optional Capability Adapter。具体机制与品牌由machine binding选择。缺失、unsupported、not-run和failed必须区分；是否阻断由相应Implementation/Verification/Compatibility/Support contract决定。临时目录、进程隔离或browser context不自动构成恶意代码sandbox。

## 公共分发

Release builder必须从exact tracked canonical revision、冻结ImplementationBinding和accepted artifact generation构建clean release workspace，不能从live working tree递归复制，也不能通过force-push重写公共主干历史。

发布前必须绑定适用的`ImplementationBindingDelta`、Compatibility Decision与Migration/retirement状态；不存在变化时也需要可信comparator证明，而不是因文件diff为空跳过。

验证至少覆盖：

- public package surface、exports、entry、shebang/launcher、ESM/CJS policy；
- runtime assets和resource location；
- exact Binding与dependency、license、native和install-script closure；
- 每个声明Host/platform的clean install与read/write smoke；
- Target Profile输出和target-specific dependencies；
- cross-host canonical determinism；
- privacy/public projection、locale、permission和store/package metadata；
- SBOM、checksums、signature/attestation与publication receipt；
- rollback/yank/deprecation和consumer migration。

公开镜像由白名单projection从clean revision生成。私有docs、会话状态、secret、私有Registry、ambient cache、测试残留和非公共Provider不进入发布面。

## Support Claim 的失效

上游EOL/security policy、dependency dropping support、Provider/Adapter撤销、Binding invalidation、Binding Delta、Compatibility invalidation、packaged smoke failure、platform regression、ABI change、incident或无法重现的release artifact都可以使Support Claim invalidated。

失效后必须：

- 停止新的支持承诺；
- 保留受影响Binding、Delta、Compatibility、Host/Profile/platform和Evidence；
- 选择fix、重新Resolution、重新比较Delta、Compatibility/Migration、deprecation或retirement；
- 重新完成physical package/deployment验证后再恢复。

README版本表、单次测试、旧Binding仍可安装或已有用户仍在运行都不能覆盖失效状态。
