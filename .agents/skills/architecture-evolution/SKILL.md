---
name: architecture-evolution
description: 用于 SEC canonical authority、公共合同、identity/revision、状态所有权、pipeline、错误恢复或跨 owner 架构需要设计、重算或迁移时，先冻结机制与不变量再进入实现；不用于 authority 已冻结后的普通 Worker 纵切片。
---

# architecture-evolution

## 当前归属
从[总体架构](../../../docs/架构/总体设计.md)定位系统责任，再沿[任务路线](../../../docs/任务路线.md)读取本次相交领域；边界必要性与全系统消费者闭包归[约束强制](../../../docs/架构/约束强制与整体一致性.md#system-control-closure)，设计与现实证据的区别归[保证](../../../docs/运行/保证/要求证据与裁决.md#设计判断运行事实与最小证据载荷)。已有同版依据直接复用，不全量预读这些链接。

## 触发
- 用户要求重新设计、全面优化、修复根架构，或现有实现暴露第二 writer/loader/revision/pipeline、状态所有权不清、恢复不可闭合等系统问题。
- 需要修改 active canonical authority、公共类型/Schema、identity/revision算法、跨域接口、状态机、错误协议或迁移边界。
- `repository-audit`、重复 failure或独立 Review证明问题不能在单一 frozen owner seam内解决。

## 不触发
- authority、public contract和migration已经冻结，只需在 Task Envelope 内实现、修复或重构。
- 只做文档生命周期、格式或链接维护。

## 输入
- 本次任务固定的exact base/tree；当前main关系仅在决定依赖它时取得。长期Goal和阶段出口、由`.documentation/documents.json`定位的当前文档及其正文责任、当前代码/types/tests、consumer/impact图、状态与写 owner、失败/恢复证据、兼容和迁移约束。文档身份索引只定位，不签发领域或作用权限。
- 原Task Capsule/Envelope必须能定位本次[完整变化闭包](../../../docs/维护/规格写作与完整性.md#complete-change-closure)：唯一owner与输入输出、全部相交消费者、正常与失败恢复、并发资源、迁移退役和验证方法。稳定合同在canonical正文，变化的具体绑定留在原任务载体；缺项明确交回对应owner，不另建设计registry，也不把局部源码提案称为完整架构。

## 前置门禁
- 固定本次设计对象及可取得的准确基础；涉及当前仓库作用时消费受信 control-plane snapshot。跨 owner 变化先取得相交 producer/consumer/恢复闭包；只有全仓声明才要求全仓 census，不能把全仓审计变成每次设计的前置。
- 当前 canonical owner、消费者、写权限、迁移起点和完成定义明确；未知项必须显式。

## 执行
1. 从用户 Goal 和不可绕过约束重建对象边界、状态、身份、数据所有权、写权限、接口、生命周期、失败/恢复与确定性要求，不从现有易改代码反推降低目标。
2. 建立当前机制链，先比较不新增、删除无独立义务的对象、直接复用现有owner或成熟能力与新增实现，再选最强竞争方案。给出新增部分不能由现有能力承担的差额及被替换路径的退出条件；已接受未来义务、历史消费者和恢复责任仍须保全。主动攻击反向因果、共同原因、兼容破坏、并发/崩溃、极端输入、第二事实源和不可逆迁移风险。
3. 在同一对象、操作、版本与作用域内确定 canonical owner，明确旧 owner/adapter/pipeline 的保留理由、迁移或退役。不同责任可以各有状态机；统一表示、包名或图不能吞掉其独立语义与寿命。
4. authority first：先定位并读取唯一领域owner和稳定合同；确有规范语义变化或原文缺陷时按[文档写入准入](../../../docs/维护/规格写作与完整性.md#documentation-write-admission)修改，否则保留正确正文。再同步实际改变的公共类型/Schema、迁移与rollback/recovery计划。验证方法按当前声明选择：静态检查能成立的源码关系直接检查；行为、性能与物理作用保留其运行证据义务。不能把negative/compatibility/property tests固定成每次架构分析、编辑和交接的开工前置。
5. 将实现拆成依赖明确的最小纵向 Work Package；每片标明本次要改变的产品结果、必要消费者和下一未闭合接口。proof/spike只有在缺口确实影响当前选择且获准运行时才启动，不默认生成临时工作流、依赖副本或恢复归档；成立后提炼为feat/refactor/fix。
   仓库执行中的Hosted CI/Actions预算必须遵守根入口 `AGENTS.md` 的 Hosted evidence budget：架构探索、定位和试错不得靠托管运行循环完成；先静态/本地收敛并冻结tree，再请求不可替代的最终hosted证据。
6. 每个候选方案给出适用边界、失效/反转条件、未知和决定性证据。强保证须定位真正施加它的类型、消费点或宿主能力，并说明环境/干扰前提；源码约束、合作锁和本地样例不得升级成敌对并发或跨平台物理保证。证据推翻根假设时返回上游重算而不是追加例外。
   进入实现前沿同一终局操作比较总成本：收益是否转移成更高的准备、验证频率、资源占有、失败恢复、迁移或退役成本；不同量纲分别保留。复用已有测量与机制依据，只补会改变选择且获准的观察。一个局部热点变快不足以采用新增层；只需下层owner履行已有合同的，交回该owner，不在caller重复编排准入、结算或清理。
7. authority与contract冻结后交给A0/Worker执行；实现结果必须回读，并同步确有变化的代码、测试、规范与迁移消费者；实现符合既有设计不要求额外改文档。A0保留原任务及未闭合前沿，子片完成或回交不终止已授权的实现任务；取下一个前提已满足的相交片，不要求用户再说“继续”。

## 完成证据
- 唯一owner、机制与状态图、public contract/invariants、consumer/impact、替代方案裁决、迁移/退役、适用验证方法和分阶段实现闭包。验证计划、静态检查与已运行的negative/compatibility/recovery tests分别报告。
- 明确区分设计已冻结、实现已进入main、验证已通过和现实能力已闭合；不得互相冒充。

## 停止与恢复
- 仅设计授权在其设计交付成立时结束；已授权实现中的架构冻结是阶段交接，不是总任务终态。相交unknown/blocker按[规则装载与任务恢复](../../../docs/开发/AI协作/规则装载与任务恢复.md)交原owner，独立合法工作继续。
- 新 evidence 改变对象边界、owner或第一性约束时整套受影响模型回退重算。

## 禁止捷径
- 不在已改变稳定合同却未裁决其owner时先改实现；也不为纯实现修复制造文档变化。不用新术语包装旧问题，不创建第二pipeline/loader/writer/revision算法。
- 不把spike、示例通过、PR body或局部测试写成架构完成。治理也接受删除反事实：新增检查须有真实消费者、会改变的决定和退出条件；不能为证明治理自身而递归创建另一套验证项目。
- 不为兼容无限保留旧路径；每条迁移必须有退出和删除条件。
