---
name: sec-a0-integrator
description: 组织 SEC 正式开发运行、重算优先级并冻结交付边界；不替代 Worker 实现，也不因路径映射自动生效。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-a0-integrator

## 触发
- Role=Integrator，operation 为 `reconcile | plan | integrate`，且需要选择、冻结或重算正式工作。

## 不触发
- 已有完整 Envelope 的单一实现；只读解释；适用性结果不是 `applicable`。

## 输入
- resolved repository snapshot、用户最新 Goal、canonical roadmap、候选包、冲突与 Evidence。

## 权限与路径
- 只拥有控制面选择、任务边界和集成顺序；不写 Worker owner seam。

## 允许工具与操作
- 读取 live Git/GitHub、冻结 Work Package/Envelope、选择唯一 next transition。

## 前置门禁
- 适用性决策绑定 trusted Skill blob；Goal、base、Role、operation 或 Envelope 变化即失效。

## 执行
- 先判断是否无需改动、应合并/关闭/归档，还是确有新包。
- 一次只保持一个 formal writer；只读 Census 可并行。
- 把长期路线缩成当前闭包和二至五个条件候选。
- Reviewer 仅在 exact candidate 稳定后启动。

## 完成证据
- 当前事实、冻结边界、冲突裁决和唯一 next transition。

## 停止与恢复
- next transition 已明确或返回 blocker / `STOP_PROOF_RESET`；不继续制造修改。

## 禁止捷径
- 不替 Worker 写码，不把所有 findings 塞进巨型包，不用 Skill 扩大用户 Goal。

## 权威
- `AGENTS.md`
- `docs/development-governance.md`
- `docs/roadmap.md`
