---
title: 运行时与分发
status: stable
domain: runtime-distribution
last-reviewed: 2026-07-29
---

# 运行时与分发

本文拥有 Semantic Core、Host Runtime、Toolchain Provider、Target Runtime Profile、Optional Capability Adapter、package/runtime layout 与公开分发的边界。精确版本、release schedule、当前支持矩阵和physical Gate结果由package metadata、代码合同与Evidence拥有，不在稳定正文复制。

## 正交轴

- **Semantic Core**：runtime-neutral 的 IR、identity、revision、validation、lowering和projection。
- **Host Runtime**：执行SEC CLI/Workbench/adapter的进程，只进入Host Evidence。
- **Toolchain Provider**：install、test、typecheck、bundle等工程命令的独立executable/version authority。
- **Target Runtime Profile**：生成项目的canonical runtime capability输入。
- **Optional Capability Adapter**：native/FFI/platform hardening；缺失时返回明确capability error。

任何一轴都不能推断另一轴。某Host成功不证明另一Host；Target runtime不决定package manager；`process.execPath`不代表Toolchain；Bun下`target: node`不证明Node Host支持。

## Public Host基准策略

公开CLI在没有既有用户兼容负担时，以启动正式支持包时的**当前Active LTS**作为最低和参考Host，避免同时维护无消费者的旧LTS矩阵。2026年路线候选为Node 24；Node 22只有出现真实用户/企业约束并通过独立Compatibility Profile时才恢复为支持面，Node 26仅在进入LTS后作为canary评估。

该策略不构成支持声明。只有common static graph、clean install/package、resource location、read/write smoke、platform invocation、dependency/license closure和cross-host determinism全部通过后，才能启用对应support claim。

Bun 1.3.14继续作为当前repository Toolchain Provider和显式Bun Host/Target候选。Node-only优秀库可进入Node Provider/subprocess；Bun-only库只能进入Bun Toolchain/Target/Adapter。只有进入双Host common graph的依赖才必须在Node和Bun物理通过。

## Package与资源布局

一个执行实例必须解析唯一：

- package root；
- executable module；
- runtime asset root；
- development source root（公开包可为null）；
- caller workspace root。

Package metadata/dependencies以package root为基准；official registry/policy/templates以runtime asset root为基准；caller `cwd`不参与compiler resource定位。Source、bundle、isolated compiler都必须投影同一layout contract；未知布局fail closed。

## Portable Workspace Lease

`platform/shared/workspace-write-lease.ts`是common write implementation与read-only inspection的唯一owner。当前主干协议使用同一workspace内的append-only generation ledger：

- immutable owner通过Node标准`fs.link` no-replace发布；
-最高未terminalized generation是唯一active owner；
- token/commit fence绑定workspace、generation、owner physical identity、process nonce和lease id；
- release/recovery只追加exact-owner terminal，不删除或复用active/successor generation；
- publication结果区分not-published、published和durability-unknown；目标可能已发布时保留完整holder，由重启收敛；
- marker alias只在canonical名称、单一alias、same bigint dev+ino、exact link count及重复TOCTOU复核下清理；其他拓扑fail closed；
- shared v2 inspector是Gate/recovery census唯一消费者，禁止第二手写parser。

Windows本地文件系统与Linux ext4/WSL2的Evidence互不替代。Portable lease只移除了Node可变Host的一个阻塞，不证明CLI、Workbench、package或Target已支持Node。

## Windows与Unix能力

路径、进程、watcher、权限、原子文件操作和资源清理按能力Provider分离：

- logical repository/artifact identity固定POSIX；physical path使用平台API；
- Windows处理drive、UNC、namespace path、case-fold、junction/reparse、Job Object和长路径；
- Unix/WSL处理process group、signal/reaping、symlink和filesystem capability；
- WSL不能替代Windows native；
- watcher事件只是invalidation hint，真实bytes/Git identity才是变化事实；
- direct-child exit不证明process tree settlement。

通用库（如process/watcher/path/temp）只能作为Provider实现，不能替代SEC的physical capability、owner、lease或cleanup receipt。

## 依赖作用域

依赖必须唯一归属：

```text
Semantic Core
Node Host
Bun Toolchain
Verification Provider
Generated Target
Workbench
External Tool
Release Provider
```

根manifest不能长期同时充当Core、Web Target、Browser Verification和External Tool的发布authority。`package.json`与lockfile保持单一Writer；类库引入先通过Runtime/Platform矩阵，再由Dependency Boundary包迁移。

## Browser与Native Provider

Playwright只负责Browser Acceptance；request-only验证使用普通network client。非Web Target和普通Core测试不应安装/准备browser。AppContainer、native helper、Testcontainers等能力是可选Provider；缺失产生actionable unsupported/not-run，由support contract决定是否阻断。

## 公共分发

Release builder从canonical resource inventory构建clean package。验证至少覆盖：

- package surface与entry/shebang/ESM；
- runtime assets；
- dependency与license closure；
- Node/Bun Host smoke；
- Windows launcher与Unix executable；
- Target Profile输出；
- cross-host canonical determinism；
- SBOM、signature/attestation与publication receipt（进入Release阶段后）。

公开镜像由白名单projection生成；私有docs、会话状态、私有Registry、ambient cache和非公共Provider不进入发布面。
