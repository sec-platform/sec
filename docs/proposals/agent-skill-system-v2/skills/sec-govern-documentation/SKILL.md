---
name: sec-govern-documentation
description: 对 SEC tracked documentation 的创建、语义修改、移动、投影、归档和退役执行唯一authority、lifecycle、consumer和机器一致性治理；不拥有产品机制设计或动态运行事实。
compatibility: SEC Agent Skill System v2 proposal
metadata:
  sec-schema: sec-agent-skill-v2
  sec-version: '2'
  sec-operation: govern-documentation
  sec-risk: branch-write
---

# sec-govern-documentation

## 目标

使每个文档对象具有唯一职责、lifecycle和consumer，并保持`docs/authority.json`、生成导航、docs doctor、Skill coverage和历史归档一致。文档治理不决定产品机制；机制改变时先转`sec-design-change`。

## 触发

- tracked Markdown新增、移动、删除、语义变更或生命周期变化。
- documentation registry、docs doctor、generated navigation、link/frontmatter、active pointer投影变化。
- active docs出现重复owner、动态事实泄漏、历史材料冒充当前事实或无consumer报告。

## 不触发

- 只读研究或历史材料，不改变仓库。
- 产品架构、public contract、state owner本身需要裁决。
- 仅更新Work Package/candidate动态状态；由对应机器control owner处理。

## 必需输入

- operation envelope与granted documentation paths；
- documentation identity、kind、domain、lifecycle、owner keys、projects、consumers和update triggers；
- statement-level migration/retirement plan；
- docs doctor、link、frontmatter和coverage services；
- 若修改documentation trust root，trust class必须明确。

## 权限边界

- 普通文档为`branch-write`；registry/verifier/Skill coverage变化为`trust-root-write`。
- 只写envelope授权的docs、registry、projection和tests。
- 不修改产品实现来适配错误文档，不把proposal/evidence/archive升格为authority。
- 不直接修改active control state以记录普通进度。

## 执行

1. 识别文档对象和真实consumer；无consumer的分析材料默认不进入active corpus。
2. 判定lifecycle：stable authority、active machine state、navigation/projection、proposal、evidence或historical。
3. 每项stable fact只保留一个ownership key；其他表面引用，不复制。
4. 新增/移动/退役active文档时先更新registry identity和依赖，再移动正文；禁止先制造dangling path。
5. 稳定文档只保存对象边界、机制、不变量和authority链接。精确enum/schema/version/path由代码/reference生成，动态SHA/run/failure由control/Evidence拥有。
6. 迁移旧正文时保留statement-level disposition：retain、merge、project、archive、delete；历史原文不得以兼容stub继续占active root。
7. 重新生成navigation/projection，运行docs doctor、links、frontmatter/H1/Unicode、dynamic policy、registry DAG和Skill coverage。
8. 若文本变化暴露新的Agent行为，转`govern-agent-system`；若改变产品机制，返回`design-required`。

## 输出合同

```yaml
schema: sec-documentation-governance-delta-v2
changedDocuments: []
registryChanges: []
ownershipChanges: []
lifecycleChanges: []
migrations: []
retirements: []
generatedProjections: []
validationResults: []
trustRootChanged: true | false
nextOperation: review-change | design-change | integrate-change | no-change
outcome: completed | blocked | design-required | no-change
```

## 失败与转移

- domain/owner不明确 → `design-change`。
- unknown active path、duplicate owner或dangling consumer → blocked。
- docs verifier/registry trust root变化 → Review后`integrate-trust-migration`。
- 普通文档delta完整 → `review-change`。

## 示例

把旧编号文档迁入archive时，registry先切换到自然domain owner；README只生成导航，不能复制全部当前状态。

proposal中的新架构被接受时，不直接把proposal改成authority；先由design operation定位现有canonical owner和最小delta。

## 资源

- `../../registry.yaml`
- `../../README.md`
- `docs/authority.json`、documentation contracts、docs doctor、generated navigation

## 禁止

- 不按文件数量、历史编号或旧测试惯性保留文档。
- 不创建无consumer的当前口吻报告。
- 不复制代码合同、动态状态、绝对本机路径或易漂移计数。
- 不使用宽泛path fallback掩盖unknown active文档。
- 不让文档覆盖main代码和真实Evidence。
