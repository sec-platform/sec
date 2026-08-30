---
title: 运行时与分发
status: stable
domain: runtime-distribution
last-reviewed: 2026-08-06
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

Semantic Core 的公共类型、builder、validator、identity/revision、canonical ordering、pure Delta/Impact 和 target-independent lowering 不得加载 Node/Bun/Browser/OS adapter或具体类库实现。平台 I/O、process、path、watcher、crypto、clock 和 random 必须经明确 Port/Provider 注入或停留在 Host/Toolchain/Verification 层。

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

### Windows native control CLI EnvironmentSpec

Windows native control 的 Git/GitHub CLI candidate layout、exact executable/loader binding 与 command/resource contract 只由
`src/external-capabilities/windows-control-cli/profile/sec-windows-control-cli-v1.json` 拥有，并由
`src/external-capabilities/windows-control-cli/contract/environment.ts` 以 strict parser、关系 validator、deep-freeze
和 canonical digest 暴露；这个 JSON 是既有 external-provider 合同的 machine projection，不建立新的
semantic、credential 或 effect owner；TS 不复制 JSON 的具体版本、digest 或日期。ledger 是 route projection owner，
只允许一个 `host-command-execution` / `sec-windows-control-cli-v1` entry，并且只记录profile、surface、lifecycle与
unresolved reason；不得复制`observedVersion`、spec path/digest/revision、artifact、executable、layout或endpoint。
当前唯一 CLI surface 是将由运行时 owner 提供的 `windows-control-cli-session`；parser module 不是 live surface。
docs-doctor从唯一EnvironmentSpec registry按route profile解析descriptor，再从传入repository root对canonical spec做
bounded no-follow raw readback和digest核对。当前 root
production positive 只能由当前已安装 capability 的 retained executable/cwd、minimal loader closure 与最终
settlement readback产生；archive download/extraction、installer 与完整安装树 census 不属于这个 surface。这里的
EnvironmentSpec不维护独立`specRevision`：schema标识grammar，canonical digest标识exact content；两者都不是live
availability epoch、executable runtime version、credential epoch或effect grant。EnvironmentSpec parser 不执行命令、不解析 credential、
不判断本机 availability，且不保存绝对机器路径。全局 capability ledger 的状态是各 Provider 的 routing
projection；其中无关 Provider 的 `revalidation-required` 不会改变该 exact profile 的结论。

四层边界为：(1) JSON EnvironmentSpec 的静态布局、artifact、version/digest、endpoint 和 resource/command
contract；(2) capability ledger 的 route/profile 与 routing projection；(3) live retained
no-follow physical session 的真实 availability、lease、identity 和 readback；(4) Git repository semantics 与
GitHub credential/principal/API/effect semantics。live execution 必须消费第 (3) 层，不能由第 (1) 或第 (2) 层
自签 live authority。

PATH 解析仅是不可信 hint；session 要在 effect 前后绑定 launcher/effective executable 的 raw bytes digest、
native identity、父目录链和版本输出。EnvironmentSpec 的 `observedSizeBytes` / `observedSha256` 是 adoption
contract 的一个物理 facet；缺少 authenticated retained root/loader/session readback 时必须保持 typed
unavailable/unknown。Git 的 `bin/git.exe` / `cmd/git.exe` 只是有限 launcher candidates，
effective executable 由 validated official layout 决定；不存在可验证 Windows provider 时上层返回 typed
`unsupported | unavailable | unknown`，禁止裸 PATH、跨平台替换或按 consumer 复制 wrapper。

## Toolchain Provider

Repository可以使用与公共Host不同的Toolchain Provider。Node Host可以调用独立Bun Toolchain；Bun Host可以生成Node Target；这些组合必须绑定两个 executable identities、版本、platform、command contract和Evidence。

Toolchain Provider至少声明：

- executable identity、version和安装authority；
- command schema、cwd/input/output和environment closure；
- dependency/lock/cache authority；
- network、postinstall、native、secret和side-effect边界；
- timeout、process cleanup和receipt；
- platform compatibility、unsupported和retirement。

Bun-only、Node-only或native library只能进入明确Host/Toolchain/Target/Adapter包边界。只有进入common public graph的依赖才必须同时满足所有声明Host的静态加载和物理运行合同。

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
- 把不满足项返回Compiler、Delta/Impact、Verification和Change Management的typed consumers。

本文不负责：

- 在多个Provider/版本间排名或选择；
- 因某实现安装成功而把它标为eligible；
- 因当前Host缺失能力而静默换Provider、降低Semantic Contract或改变Target；
- 从package.json、lock、ambient executable或已有node_modules反向推导Binding；
- 比较old/new Binding或生成`ImplementationBindingDelta`；
- 按物理结果签发Compatibility或Migration；
- 把Runtime fallback写成第二Implementation Resolver。

Binding引用的Target、Host、Toolchain、Provider或Support revision变化时，旧physical结果失效。若需要新实现，由Compiler重新Resolution产生new Binding；Delta/Impact比较old/new Binding；Change Management再裁决Compatibility/Migration。Runtime不能跳过这条链直接替换依赖或发布。

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

## 依赖作用域

每个依赖必须唯一归属于：Semantic Core、Host、Toolchain、Verification、Generated Target、Agent/CLI Interface、External Provider或Release。根manifest不应长期同时充当Core、生成目标、native helper和外部分析工具的发布authority。

`package.json`与lockfile保持单一writer。ImplementationBinding只能请求一个exact dependency closure；Dependency authority验证并materialize它，不能让Resolver、Backend、Adapter或Agent/CLI interface直接修改package/lock。

派生dependency root只允许保存canonical manifest投影、materialized modules、cache、lease与readiness
stamp；它不是第二个package authority，不能持有lockfile、package-manager config或workspace config。
唯一resolution effect由根`package.json + bun.lock + bunfig.toml + canonical Bun executable/version`生成compiler dependency
generation；shared/project root不得再次调用package manager，只能从该generation复制完整有界closure或建立
exact bridge。Materialization binding必须同时绑定lock、根manifest与install config raw digest、Bun物理可执行文件与digest、
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

Browser Provider只服务需要真实浏览器行为的Acceptance；request-only、DOM-free或pure semantic test使用更窄Provider。测试文件位于acceptance目录不自动意味着必须启动browser；Gate contract、test fixture需求和实际capability共同决定。

Container、AppContainer、Job Object、native helper、FFI和Testcontainers等属于Optional Capability Adapter。缺失、unsupported、not-run和failed必须区分；是否阻断由相应Implementation/Verification/Compatibility/Support contract决定。临时目录、进程隔离或browser context不自动构成恶意代码sandbox。

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
