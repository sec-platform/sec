---
name: sec-external-capability-governance
description: 用于引入、升级、调用、替换或退役外部工具、Provider、MCP、Nexus、Graphify及其他能力时，验证必要性、边界、版本、许可证、安全和唯一owner；不用于默认把外部输出当事实。
compatibility: SEC 仓库；按本 Skill 的权威与工具边界执行。
---

# sec-external-capability-governance

## 触发
- 新外部工具/服务、Provider、MCP、CLI、模型、索引器或能力退役。
## 不触发
- 已被当前Capability Ledger批准且identity未失效的普通调用。
## 输入
- 能力用途、版本、license/CVE/runtime、数据边界、写权限、替代品、退出条件。
## 执行
1. 证明真实缺口，优先复用现有canonical owner。
2. 外部输出只作线索，必须被SEC验证器或人工authority重新裁决。
3. 明确read/write/network/credential/path权限和失败模式。
4. 更新Capability Ledger、tests、Skill、docs和toolchain投影。
5. 退役时删除入口、配置、脚本和当前口吻；历史材料保留historical标记。
## 停止条件
- 能力有唯一owner、可验证输入输出、明确授权和可执行退役路径。
## 禁止捷径
- 不保留无消费者的MCP配置。
- 不让外部工具改写AGENTS、Skills或authority docs。
## 权威
- `docs/governance/external-capability-and-provider-policy.md`
- `docs/governance/nexus-absorption-and-conformance.md`
