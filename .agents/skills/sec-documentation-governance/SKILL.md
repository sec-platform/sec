---
name: sec-documentation-governance
description: 用于创建、修改、归档或审计 SEC 任意 Markdown、文档权威、链接、frontmatter和三控制面；不用于把历史材料重新提升为当前事实。
compatibility: SEC 仓库；按本 Skill 的权威、权限和验证边界执行。
---

# sec-documentation-governance

## 触发
- 任意 tracked Markdown新增、移动、删除或语义变更。
- `docs/authority.json`、docs-doctor、active-documentation projection 或机器 ledger 发生变化。

## 不触发
- 只读历史研究且不改变仓库。

## 输入
- registry record、文档路径、kind、lifecycle、domain、canonical ownership、projection、消费者、更新触发和 active pointer。

## 权限与路径
- 只修改 manifest 声明的文档、registry、生成导航、文档 verifier 与适用投影；archive/evidence 不升格为 authority。

## 允许工具与操作
- authority registry、docs doctor、link/frontmatter/H1检查、Skill coverage、statement-level migration ledger。

## 前置门禁
- 文档的对象边界、消费者、canonical owner、生命周期和退役条件已确定。

## 执行
1. 新增、移动或退役 active 文档先修改 `docs/authority.json`；未知 active path fail closed。
2. 每个 stable fact只由一个 ownership key拥有；navigation、projection、proposal和报告不得竞争 authority。
3. 稳定文档只保存机制；精确 schema/enum/version/path 由代码或生成 reference拥有；动态状态只进入 control或 machine ledger。
4. Agent执行判断归唯一 Skill；文档只保留领域边界和权威链接。
5. 旧正文迁入 archive 时保持历史原文，不以兼容 stub继续占据 active root。
6. 重新生成 `docs/README.md`，校验 registry、frontmatter、H1、Unicode、链接、dynamic policy、pointer/manifest和Skill coverage。
7. 修改 verifier trust root时走独立 bootstrap，不由candidate自证。

## 完成证据
- registry owner graph唯一、active paths exact、生成导航无漂移、docs零error、pointer binding、旧owner归档/退役记录。

## 停止与恢复
- 全部 active 文档均登记且职责自然闭合；unknown、duplicate owner、动态事实泄漏或生成投影漂移均为零。
- 新事实推翻领域边界时返回 authority设计重算，不在旧文档追加例外。

## 禁止捷径
- 不按历史编号、文件数量或旧测试要求保留无自然职责的文档。
- 不创建无消费者“分析报告”，不复制代码合同，不保留机器绝对路径或动态计数。
- 不用宽泛路径 fallback冒充文档已被治理。

## 权威
- `docs/authority.json`
- `platform/shared/documentation-authority-contract.ts`
- `docs/scripts/docs-doctor.ts`
- `docs/development-governance.md`
