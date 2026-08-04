---
name: sec-failure-recovery
description: 在测试、Gate、Review、candidate 或环境失败后分类根因、最小重跑和 proof reset；不重复碰运气。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-failure-recovery

## 触发
- operation=`recover`，且存在 exact failure identity 或 invalidated Evidence。

## 不触发
- 结果尚未完成；只有单次性能离群；没有可绑定 failure input。

## 输入
- failure tail、exact identity、root-cause cluster、cleanup state、输入 delta。

## 权限与路径
- 只处理失败证据和最小修复边界；不扩大产品 scope。

## 允许工具与操作
- failure 分类、最小 sentinel、Evidence invalidation、proof reset。

## 前置门禁
- failure identity、owner、cleanup 与因果输入已知。

## 执行
- 分类产品/合同/authority/Review/用户变更/环境/基础设施/stale/unknown。
- 输入与failure tail未变时复用失败证据并停止；只有因果输入变化才受限重试。
- 第二次同根因 frozen invalidation 返回 `STOP_PROOF_RESET`。
- proof reset 后再犯进入 `BLOCKED_REDESIGN_REQUIRED`。

## 完成证据
- failure class、owner/invariant、失效 Evidence 和唯一 next action。

## 停止与恢复
- 根因与下一动作闭合；unknown 或无合法恢复 generation 时 fail closed。

## 禁止捷径
- 不扩大 timeout、删断言、清缓存碰运气或创建无输入变化的新 candidate。

## 权威
- `docs/development-governance.md`
- `docs/verification-governance.md`
