---
name: sec-architecture-evolution
description: 用于 SEC canonical authority、公共合同、identity/revision、状态所有权、pipeline、错误恢复或跨 owner 架构需要设计、重算或迁移时，先冻结机制与不变量再进入实现；不用于 authority 已冻结后的普通 Worker 纵切片。
---

# sec-architecture-evolution

## 触发
- 用户要求重新设计、全面优化、修复根架构，或现有实现暴露第二 writer/loader/revision/pipeline、状态所有权不清、恢复不可闭合等系统问题。
- 需要修改 active canonical authority、公共类型/Schema、identity/revision算法、跨域接口、状态机、错误协议或迁移边界。
- `sec-repository-audit`、重复 failure或独立 Review证明问题不能在单一 frozen owner seam内解决。

## 不触发
- authority、public contract和migration已经冻结，只需在 Task Envelope 内实现、修复或重构。
- 只做文档生命周期、格式或链接维护。

## 输入
- latest exact main、长期 Goal和阶段出口、`docs/authority.json`解析出的领域owner、当前代码/types/tests、consumer/impact图、状态与写 owner、失败/恢复证据、兼容和迁移约束。

## 前置门禁
- 受信 control-plane snapshot 已解析；跨仓/广泛变化先完成 `sec-repository-audit` 或等价的全量影响证据。
- 当前 canonical owner、消费者、写权限、迁移起点和完成定义明确；未知项必须显式。

## 执行
1. 从用户 Goal 和不可绕过约束重建对象边界、状态、身份、数据所有权、写权限、接口、生命周期、失败/恢复与确定性要求，不从现有易改代码反推降低目标。
2. 建立当前机制链和最强竞争方案，主动攻击反向因果、共同原因、兼容破坏、并发/崩溃、极端输入、第二事实源和不可逆迁移风险。
3. 选择唯一 canonical owner，明确哪些旧 owner/adapter/pipeline被吸收、迁移或退役；禁止平行长期双写。
4. authority first：先更新唯一领域owner和稳定合同，再定义公共类型/Schema、negative/compatibility/property tests、迁移与rollback/recovery计划。
5. 将实现拆成依赖明确的最小纵向 Work Package；proof/spike只产生Evidence，成立后提炼为 feat/refactor/fix，不直接合并实验噪声。
6. 每个候选方案给出适用边界、失效/反转条件、未知和决定性证据；证据推翻根假设时返回上游重算而不是追加例外。
7. authority与contract冻结后交给A0/Worker执行；实现结果必须回读并统一修正代码、测试、文档和迁移面。

## 完成证据
- 唯一 owner、机制与状态图、public contract/invariants、consumer/impact、替代方案裁决、迁移/退役、negative/compatibility/recovery tests和分阶段实现闭包。
- 明确区分设计已冻结、实现已进入main、验证已通过和现实能力已闭合；不得互相冒充。

## 停止与恢复
- 架构选择、owner、contract、迁移和验收已冻结，可安全交付独立Work Package；或返回决定性unknown/blocker。
- 新 evidence 改变对象边界、owner或第一性约束时整套受影响模型回退重算。

## 禁止捷径
- 不先改实现再补文档，不用新术语包装旧问题，不创建第二pipeline/loader/writer/revision算法。
- 不把 spike、示例通过、PR body或局部测试写成架构完成。
- 不为兼容无限保留旧路径；每条迁移必须有退出和删除条件。
