---
name: architecture-evolution
description: 用于 SEC canonical authority、公共合同、identity/revision、状态所有权、pipeline、错误恢复或跨 owner 架构需要设计、重算或迁移时，先冻结机制与不变量再进入实现；不用于 authority 已冻结后的普通 Worker 纵切片。
---

# architecture-evolution

## 触发
- 用户要求重新设计、全面优化、修复根架构，或现有实现暴露第二 writer/loader/revision/pipeline、状态所有权不清、恢复不可闭合等系统问题。
- 需要修改 active canonical authority、公共类型/Schema、identity/revision算法、跨域接口、状态机、错误协议或迁移边界。
- `repository-audit`、重复 failure或独立 Review证明问题不能在单一 frozen owner seam内解决。

## 不触发
- authority、public contract和migration已经冻结，只需在 Task Envelope 内实现、修复或重构。
- 只做文档生命周期、格式或链接维护。

## 输入
- latest exact main、长期 Goal和阶段出口、由`.documentation/documents.json`定位的当前文档及其正文责任、当前代码/types/tests、consumer/impact图、状态与写 owner、失败/恢复证据、兼容和迁移约束。文档身份索引只定位，不签发领域或作用权限。

## 前置门禁
- 受信 control-plane snapshot 已解析；跨仓/广泛变化先完成 `repository-audit` 或等价的全量影响证据。
- 当前 canonical owner、消费者、写权限、迁移起点和完成定义明确；未知项必须显式。

## 执行
1. 从用户 Goal 和不可绕过约束重建对象边界、状态、身份、数据所有权、写权限、接口、生命周期、失败/恢复与确定性要求，不从现有易改代码反推降低目标。
2. 建立当前机制链和最强竞争方案，主动攻击反向因果、共同原因、兼容破坏、并发/崩溃、极端输入、第二事实源和不可逆迁移风险。
3. 选择唯一 canonical owner，明确哪些旧 owner/adapter/pipeline被吸收、迁移或退役；禁止平行长期双写。
4. authority first：先更新唯一领域owner和稳定合同，再定义公共类型/Schema、迁移与rollback/recovery计划。验证方法按当前声明选择：静态检查能成立的源码关系直接检查；行为、性能与物理作用保留其运行证据义务。不能把negative/compatibility/property tests固定成每次架构分析、编辑和交接的开工前置。
5. 将实现拆成依赖明确的最小纵向 Work Package；每片标明本次要改变的产品结果、必要消费者和下一未闭合接口。proof/spike只有在缺口确实影响当前选择且获准运行时才启动，不默认生成临时工作流、依赖副本或恢复归档；成立后提炼为feat/refactor/fix。
   仓库执行中的Hosted CI/Actions预算必须遵守根入口 `AGENTS.md` 的 Hosted evidence budget：架构探索、定位和试错不得靠托管运行循环完成；先静态/本地收敛并冻结tree，再请求不可替代的最终hosted证据。
6. 每个候选方案给出适用边界、失效/反转条件、未知和决定性证据；证据推翻根假设时返回上游重算而不是追加例外。
7. authority与contract冻结后交给A0/Worker执行；实现结果必须回读并统一修正代码、测试、文档和迁移面。A0保留原任务及未闭合前沿，子片完成或回交不终止已授权的实现任务；取下一个前提已满足的相交片，不要求用户再说“继续”。

## 完成证据
- 唯一owner、机制与状态图、public contract/invariants、consumer/impact、替代方案裁决、迁移/退役、适用验证方法和分阶段实现闭包。验证计划、静态检查与已运行的negative/compatibility/recovery tests分别报告。
- 明确区分设计已冻结、实现已进入main、验证已通过和现实能力已闭合；不得互相冒充。

## 停止与恢复
- 仅设计授权在其设计交付成立时结束；已授权实现中的架构冻结是阶段交接，不是总任务终态。相交unknown/blocker按[规则装载与任务恢复](../../../docs/开发/AI协作/规则装载与任务恢复.md)交原owner，独立合法工作继续。
- 新 evidence 改变对象边界、owner或第一性约束时整套受影响模型回退重算。

## 禁止捷径
- 不先改实现再补文档，不用新术语包装旧问题，不创建第二pipeline/loader/writer/revision算法。
- 不把spike、示例通过、PR body或局部测试写成架构完成。治理也接受删除反事实：新增检查须有真实消费者、会改变的决定和退出条件；不能为证明治理自身而递归创建另一套验证项目。
- 不为兼容无限保留旧路径；每条迁移必须有退出和删除条件。
