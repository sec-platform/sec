---
name: sec-external-capability-governance
description: 引入、调用、升级或退役外部工具/Provider 时裁决必要性、权限、版本和退出；外部输出不自动成为事实。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-external-capability-governance

## 触发
- operation=`audit | design | govern`，且存在真实外部能力缺口或退役任务。

## 不触发
- 能力已由当前 ledger 批准、identity 未失效且只是普通调用。

## 输入
- 用途、consumer、版本/license/CVE、数据流、权限、替代品和退出条件。

## 权限与路径
- 只修改 Envelope 授权的 ledger、adapter、入口与退役表面。

## 允许工具与操作
- 官方来源检索、A/B 验证、权限/数据流审计、入口删除。

## 前置门禁
- 真实 consumer、唯一 owner、network-read capability 和新鲜外部事实。

## 执行
- 证明缺口并优先复用现有 owner。
- 限制 read/write/network/credential/path 权限。
- 让 SEC validator 或人工 authority 重新裁决外部输出。
- 采用时同步删除被替代实现；退役时删除全部入口。

## 完成证据
- decision、identity、权限、验证、替换/退役 readback。

## 停止与恢复
- 能力可验证且有退出路径；无 consumer 或不可验证则不引入。

## 禁止捷径
- 不做 add-only 轮子采用，不让外部工具改写 AGENTS/Skill/authority。

## 权威
- `docs/external-provider-policy.md`
- `docs/governance/external-capability-ledger.yaml`
