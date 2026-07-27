---
name: sec-external-capability-governance
description: 用于引入、升级、调用、替换或退役外部工具、Provider、MCP、Nexus、Graphify及其他能力时，验证必要性、边界、版本、许可证、安全和唯一owner；不用于默认把外部输出当事实。
compatibility: SEC 仓库；按本 Skill 的权威、权限和验证边界执行。
---

# sec-external-capability-governance

## 触发
- 新外部工具/服务、Provider、MCP、CLI、模型、索引器或能力退役。

## 不触发
- 已被当前Capability Ledger批准且identity未失效的普通调用。

## 输入
- 能力用途、版本、license/CVE/runtime、数据边界、写权限、替代品、退出条件。

## 权限与路径
- 只修改Capability Ledger、批准的配置/入口/Skill/docs和退役路径。

## 允许工具与操作
- 官方版本/license/CVE检索、A/B验证、权限/数据流审计、入口删除。

## 前置门禁
- 真实能力缺口、唯一owner、授权与外部事实新鲜度已确认。

## 执行
1. 证明真实缺口，优先复用现有canonical owner。
2. 外部输出只作线索，必须被SEC验证器或人工authority重新裁决。
3. 明确read/write/network/credential/path权限和失败模式。
4. 更新Capability Ledger、tests、Skill、docs和toolchain投影。
5. 退役时删除入口、配置、脚本和当前口吻；历史材料保留historical标记。

## 完成证据
- 能力decision、version/permission identity、tests、retirement readback。

## 停止与恢复
- 能力有唯一owner、可验证输入输出、明确授权和可执行退役路径。
- 不可验证或无消费者则不引入/直接退役；外部输出不升格。

## 禁止捷径
- 不保留无消费者的MCP配置。
- 不让外部工具改写AGENTS、Skills或authority docs。

## 权威
- `docs/governance/external-capability-and-provider-policy.md`
- `docs/governance/nexus-absorption-and-conformance.md`
