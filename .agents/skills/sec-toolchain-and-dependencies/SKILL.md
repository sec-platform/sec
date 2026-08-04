---
name: sec-toolchain-and-dependencies
description: 变更依赖、Bun/TypeScript、lock、Hook、构建或根命令时维持唯一 toolchain owner，并用替换而非 add-only 控制体量。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-toolchain-and-dependencies

## 触发
- operation=`implement | govern`，且 toolchain/dependency identity 或入口真实变化。

## 不触发
- 普通产品源码变化且 manifest/lock/runtime identity 未变。

## 输入
- consumer、manifest/lock、官方版本、runtime/OS、license/CVE、替代实现。

## 权限与路径
- 只写 Envelope 授权的 package/lock/adapter/CI/Hook/release 表面。

## 允许工具与操作
- 包管理器、官方信息、compat/cold-warm tests、入口删除。

## 前置门禁
- 完整 Envelope、toolchain-write capability、Linux 未测试项保持 unresolved。

## 执行
- 证明真实 consumer，再在最窄 workspace 改唯一 manifest/lock。
- 采用成熟轮子必须删除被替代模块、Schema、人工检查或 CI 路径。
- 同步必要投影但不维护会漂移的手写版本表。
- 验证 Node/Bun/Windows；Linux physical cell 未执行不得宣称支持。

## 完成证据
- manifest-lock、consumer migration、删除项、compat 和 before/after 体量。

## 停止与恢复
- 所有当前 consumer 已迁移，旧入口退役；无 consumer 则删除或不引入。

## 禁止捷径
- 不 ambient install，不 add-only adoption，不建立第二依赖 registry。

## 权威
- `package.json`
- `bun.lock`
- `docs/runtime-and-distribution.md`
