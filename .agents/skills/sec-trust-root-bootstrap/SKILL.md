---
name: sec-trust-root-bootstrap
description: 候选修改 verifier、Skill router、Gate、test-impact 或 merge authority 时，用受信 base 独立验证并切换 trust epoch。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-trust-root-bootstrap

## 触发
- candidate=frozen，operation=`review | validate | integrate`，且 trust-root delta 已识别。

## 不触发
- 普通产品叶节点可由现有 verifier 完整验证。

## 输入
- trusted base implementation、exact candidate、TCB closure、independent Review、bootstrap plan。

## 权限与路径
- 只审查/集成 trust-root candidate；candidate 规则不能授权 candidate 自身。

## 允许工具与操作
- base-side parser/scope/focused tests、TCB Review、manual integration、main readback。

## 前置门禁
- 完整 Envelope、trusted base、single-parent frozen candidate；Skill guidance 也来自 trusted base。

## 执行
- 用 base-side 合同读取 candidate，不执行 candidate-controlled selector。
- 诚实记录 `manual-bootstrap-required`，不反复制造绿色。
- 独立 Review 与 base Evidence 闭合后才允许 admin/manual integration。
- 新 main readback 后返回 `TASK_RESTART_REQUIRED`。

## 完成证据
- base-side results、TCB closure、Review、integration SHA、new trust digest。

## 停止与恢复
- 新 trust epoch 进入 main并由新会话重载；否则保持旧 epoch 和阻塞。

## 禁止捷径
- 不让 candidate Skill/AGENTS/router 指导自己的实现、Review、Gate 或合并。

## 权威
- `docs/verification-governance.md`
- `docs/development-governance.md`
