---
name: sec-impact-and-validation
description: 根据真实变更选择最小充分测试与 Gate；不机械全跑，也不靠少跑掩盖 unknown。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-impact-and-validation

## 触发
- operation=`validate`，共享 contract/runtime/selector 或影响边界需要验证。

## 不触发
- 已证明局部叶节点且现有选择未失效。

## 输入
- base→candidate records、owner、imports/consumer、test inventory、risk registry。

## 权限与路径
- 只执行 selector 允许的验证；不由 Skill 扩大写路径。

## 允许工具与操作
- affected plan、focused tests、typecheck、docs、selected Risk。

## 前置门禁
- changed records 与 owner 完整，verification capabilities 已授予。

## 执行
- 先跑只读 plan；禁止为满足optional impact临时安装、动态解析package或重建索引。
- 开发中只跑 focused sentinel；冻结后运行一次适用 typecheck/docs/affected。
- 同一 Gate identity PASS 复用；确定性 FAIL 输入未变不重跑。

## 完成证据
- owner、selection reasons、结果、deferred Risk 和 unknown。

## 停止与恢复
- 每个 changed path 有 owner 与验证去向；unresolved owner 立即停止。

## 禁止捷径
- 不按固定文件数削减测试，不把 local/hosted 重复结果算两份正确性。

## 权威
- `docs/verification-governance.md`
- `platform/shared/test-impact-contract.ts`
