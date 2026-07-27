---
name: sec-toolchain-and-dependencies
description: 用于变更 Bun、TypeScript、依赖、lockfile、Git Hook、构建发布和根命令面时，保持唯一 Toolchain Profile、最窄安装边界和全表面一致；不用于手工维护漂移版本表。
compatibility: SEC 仓库；按本 Skill 的权威与工具边界执行。
---

# sec-toolchain-and-dependencies

## 触发
- 依赖安装/升级/退役、Bun或TypeScript变化、package scripts、lockfile、Hook、build/release入口变化。
## 不触发
- 普通产品源码修改且toolchain identity未变。
## 输入
- 官方当前版本、lockfile、runtime/OS兼容、license/CVE、CI/Hook/Skill/docs消费者。
## 执行
1. 在最窄workspace安装，使用唯一manifest/lock authority。
2. 核对官方版本、license、CVE、runtime和平台兼容。
3. 同步package、lock、CI setup、Hooks、Skills、docs、release、README/examples和compat tests。
4. 删除无消费者命令和配置；保留CLI不等于保留MCP入口。
5. 使用原生cache/失效语义，禁止第二依赖registry。
## 停止条件
- 所有投影一致，cold/warm与损坏恢复合同通过。
## 禁止捷径
- 不手工维护会漂移的依赖表。
- 不通过ambient install、相邻worktree或全局PATH冒充当前依赖。
## 权威
- `package.json`
- `bun.lock`
- `docs/test-feedback-and-ci-lanes.md`
- `scripts/install-git-hooks.ts`
