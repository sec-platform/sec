---
name: sec-repository-audit
description: 对 exact revision 的全部 tracked paths 做全仓事实、owner、入口、状态和约束审计；普通局部任务不触发。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-repository-audit

## 触发
- Role=Auditor，operation=`audit`，用户明确要求全仓或重复系统问题需要完整 Census。

## 不触发
- 只需最小 orientation；已证明为局部叶节点的实现。

## 输入
- exact clean tree、全部 tracked paths、authority、代码/测试/CI、PR/Issue、unknown。

## 权限与路径
- 默认全仓只读；写报告/脚本需独立 Envelope，不写产品 owner seam。

## 允许工具与操作
- Git tree/raw blob Census、repository-audit、docs/dependency/static analysis。

## 前置门禁
- exact revision 可完整读取；缺失路径和外部 authority 记录为 unknown。

## 执行
- 对全部 tracked paths 分类，不用搜索抽样冒充覆盖。
- 建立 owner/entry/state/dependency/error/recovery/verification 图。
- 攻击第二 writer/loader/revision、catch-all、孤儿入口和错误成功声明。
- findings 分派给独立 owner，不形成巨型实现包。

## 完成证据
- exact tree、分类计数、finding/unknown ledger、机制与反例。

## 停止与恢复
- unclassified=0，决定性轴已覆盖；revision 变化使旧审计整体失效。

## 禁止捷径
- 不以 rg、README、PR body、单一图或历史报告宣称全仓分析。

## 权威
- `AGENTS.md`
- `docs/authority.json`
- `scripts/codex/repository-audit.ts`
