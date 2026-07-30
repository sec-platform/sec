---
title: 运行时与分发
status: stable
domain: runtime-distribution
last-reviewed: 2026-07-29
---

# 运行时与分发

本文拥有 Semantic Core、Host Runtime、Toolchain Provider、Target Runtime Profile、Optional Capability Adapter、package/runtime layout、平台能力和公开分发的稳定边界。精确版本、release schedule、当前支持矩阵、依赖清单、可执行路径、协议字段和 physical Gate 结果由 package metadata、代码合同、release profile 与 Evidence 拥有。

## 正交轴

- **Semantic Core**：runtime-neutral 的 Engineering IR、identity、revision、validation、pure lowering 与 projection。
- **Host Runtime**：执行 SEC CLI、Workbench server 或 adapter 的进程，只进入 Host Evidence。
- **Toolchain Provider**：install、test、typecheck、bundle、format 等工程命令的独立 executable/version authority。
- **Target Runtime Profile**：生成项目的 canonical language/runtime/module/delivery capability 输入。
- **Optional Capability Adapter**：native、FFI、container、browser、OS hardening 或平台专有能力；缺失时返回明确 capability result。

任何一轴都不能推断另一轴。某 Host 成功不证明另一 Host；Target runtime 不决定 package manager；`process.execPath` 不代表 Toolchain；在一个 Toolchain 下生成另一 Target 也不证明该 Target 或 Host 已受支持。

## Runtime-neutral Core

Semantic Core 的公共类型、builder、validator、identity/revision、canonical ordering、pure impact 和 target-independent lowering 不得加载 Node/Bun/Browser/OS adapter。平台 I/O、process、path、watcher、crypto、clock 和 random 必须经明确 Port/Provider 注入或停留在 Host/Toolchain/Verification 层。

“使用标准库”不自动等于 runtime-neutral；静态可达图、初始化副作用、package exports 和 transitive dependencies 都属于公共图验证范围。

## 支持版本策略

公开 Host 至少区分：

- **minimum compatibility baseline**：承诺兼容的最低版本；
- **primary reference baseline**：开发、性能和主要 physical Evidence 的参考版本；
- **canary baseline**：只用于提前发现未来不兼容，不是支持承诺；
- **retired baseline**：不再进入普通 Gate，但有明确退出和迁移说明。

最低版本和主要参考版本可以不同。版本选择必须由实际用户约束、上游安全支持、维护成本、依赖兼容和 physical Evidence共同裁决，并记录在机器可读 release/support profile；稳定正文不固定某个年份的版本号。

支持声明分层：

```text
authority / policy selected
→ implementation entered main
→ exact physical tests passed
→ clean packaged/deployed surface passed
→ support claim enabled
→ usage and incident feedback maintained
```

前一层不能代替后一层。一个 helper、`--help`、类型检查或单平台测试通过都不能被扩大成完整 CLI/Workbench/Target 支持。

## Toolchain 与 Host

Repository 可以使用与公共 Host 不同的 Toolchain Provider。Node Host 可以调用独立 Bun Toolchain；Bun Host 可以生成 Node Target；这些组合必须绑定两个 executable identities、版本、platform、command contract 和 Evidence。

Bun-only、Node-only 或 native library 只能进入明确的 Host/Toolchain/Target/Adapter 包边界。只有进入 common public graph 的依赖才必须同时满足所有被声明 Host 的静态加载和物理运行合同。

## Target Runtime Profile

Target Profile 至少分离 language、runtime family/range、module system、delivery、package manager、persistence、database、UI、verification、deployment 与 capabilities。它是目标编译输入，不从当前 Host、Toolchain、`cwd` 或 ambient executable 推导。

Profile 的每个组合都需要 validator、compatibility rules、canonical revision、Adapter selection 和 unsupported behavior。未知组合 deterministic reject；不能静默回退到仓库默认框架、数据库、package manager 或 runtime。

## Package 与资源布局

一个执行实例必须解析唯一：

- package root；
- executable module；
- runtime asset root；
- development source root（公开包可以不存在）；
- caller workspace root。

Package metadata、dependency resolution 和可重建 Toolchain state 以 package root 为基准；official registry、policy、templates 和随包资源以 runtime asset root 为基准；caller `cwd` 只表示用户 workspace，不参与 compiler package/resource 定位。

Source、bundle、isolated compiler 和 clean installed package 必须投影同一 layout contract。未知 module layout、ancestor search、环境变量猜测、相邻 checkout 或全局注册全部 fail closed。

## Workspace 写 authority

Common workspace write authority 必须只依赖公共 Host baseline 能力，并提供同一个 read-only inspection contract。稳定机制要求：

- 一个 workspace 同一时刻只有一个合法 writer generation；
- acquire、heartbeat、release、recovery 和 commit fence 绑定 exact workspace、owner 与 physical publication identity；
- publication 必须区分未发布、已发布和 durability unknown，不能在不确定时删除可能已成为 authority 的状态；
- recovery 只在 owner liveness、generation 和 topology 可证明时推进，不按时间、内容相似或猜测路径夺取所有权；
- release/recovery 不得移除后继 writer；
- inspector 是 Gate、audit 和 recovery census 的唯一 parser，不允许第二套字段/路径解释；
- crash、TOCTOU、异步 cleanup 和历史压缩均有 fail-closed 条件。

具体 generation ledger、文件名、hard-link topology、marker/terminal shape 和 cleanup algorithm 由代码合同与 fault tests 拥有，不在稳定文档复制。一个平台上的协议 Evidence 不能替代另一个文件系统和 Host 的物理证明；write authority 通过也不能扩大成整个 CLI/Workbench/package 支持。

## Windows、Unix、WSL 与平台能力

Logical repository/artifact identity 使用 canonical repository-relative POSIX 表达；physical path 由声明平台的 path Provider 处理。校验 Windows 路径时使用 Windows 语义，校验 POSIX 路径时使用 POSIX 语义，不能使用当前进程平台代替目标平台。

平台能力至少包括：

- path、drive/UNC/namespace/long path、case 和 Unicode；
- symlink、junction/reparse、hard link、rename/link/fsync 能力；
- process tree、signal、job/process group、stream settlement；
- filesystem permission、ACL/owner、temp root 和 cleanup receipt；
- watcher/invalidation、network/port、browser executable 和 native ABI。

WSL/Linux Evidence 不替代 Windows native，Windows Evidence 也不替代 Linux/macOS。Watcher event 只是 invalidation hint，真实 bytes、Git/object identity 和重新读取结果才是变化事实。Direct child exit 不证明 descendant、port、stream、temp 或 lock 已收口。

通用 path/process/watcher/temp 库可以作为 Provider 实现，但不能替代 SEC 对 owner、capability、lease、cleanup、platform binding 和 Evidence 的合同。

## 依赖作用域

每个依赖必须唯一归属于 Semantic Core、Host、Toolchain、Verification、Generated Target、Workbench、External Tool 或 Release Provider之一。根 manifest 不应长期同时充当 Core、Web target、browser verification、native helper 和外部分析工具的发布 authority。

`package.json` 与 lockfile 保持单一 writer。引入、升级或删除依赖前必须检查：

- 实际 import/load graph 和运行入口；
- Host/Target/Toolchain/platform matrix；
- install/build/postinstall/network/native side effects；
- package exports、bundling、license 和 supply-chain；
- optional/fallback behavior 和缺失时 diagnostic；
- clean package 与 consumer Evidence。

没有 import 不等于没有 build/runtime dependency；有依赖声明也不等于公共 graph 会加载它。

## Browser、container 与 native Provider

Browser Provider 只服务需要真实浏览器行为的 Acceptance；request-only、DOM-free 或 pure semantic test 使用更窄 Provider。非 Web Target 和普通 Core test 不准备 browser。

Container、AppContainer、Job Object、native helper、FFI 和 Testcontainers 等都属于 Optional Capability Adapter。缺失、unsupported、not-run 和 failed 必须区分；是否阻断由相应 support/Verification contract决定。临时目录、进程隔离或 browser context 不自动构成恶意代码 sandbox。

## 公共分发

Release builder 从 canonical resource inventory 构建 clean release workspace，验证至少覆盖：

- public package surface、exports、entry、shebang/launcher、ESM/CJS policy；
- runtime assets 和 resource location；
- dependency、license、native 和 install-script closure；
- 每个声明 Host/platform 的 clean install 与 read/write smoke；
- Target Profile 输出和 target-specific dependencies；
- cross-host canonical determinism；
- privacy/public projection、locale、permission 和 store/package metadata；
- SBOM、checksums、signature/attestation 与 publication receipt（进入相应发布阶段后）；
- rollback/yank/deprecation 和 consumer migration。

公开镜像必须由白名单 projection 从 clean revision生成。私有 docs、会话状态、secret、私有 Registry、ambient cache、测试残留和非公共 Provider 不进入发布面。

## 支持声明的失效

上游 EOL/security policy、dependency dropping support、packaged smoke failure、platform regression、ABI change、incident 或无法重现的 release artifact 都可以使支持声明 invalidated。失效后应立即停止新的支持承诺、保留受影响范围和 Evidence，并通过 fix、compatibility profile、deprecation 或 retirement明确收敛，而不是只修改 README 版本表。
