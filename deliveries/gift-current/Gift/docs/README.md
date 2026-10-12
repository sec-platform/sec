# Gift 当前设计规范导航

## 开发者如何写完整程序与业务系统

[完整的开发者通用定义Profile提案](20-语义与组合/作者语义/开发者通用定义Profile-类型计算业务与系统构造.md#developer-foundation-gift133)逐Kind规定源码Body、类型/effect、相交语义和拒绝路径；[当前作者示例](../examples/current/README.md)展示JSON、跨模块导入及未决资格；[旧IDE研究说明](../fixtures/developer-foundation/Gift133/README.md)只保留原版本案例背景。设计候选不等于已发布的生产格式。


<a id="gift122-core-profile-entry"></a>

同一个完整ZIP中，**`docs/`分工维护当前规范**，其它领域研究、来源、反例、样例按角色保留独立价值，不通过目录位置获得规范修改权。九组60个有限公共语义职责是当前设计接口；六种意图模态、八种RequirementTerm、五种Pattern基数和施工S0–S8由各自唯一owner定义。并非每种构造都已具生产解释器。[当前实施与资格边界](90-治理与参考/状态/实施闭包.md)。

[各种V/L/K/G/CAP/COMP/S/D/R体系及同号S的限定关系](00-系统与原则/统一多层工程模型.md#gift-unified-system-axes-and-relations)；[含子目录的物理角色与保留门槛](90-治理与参考/维护/文档架构.md#gift-source-package-role-contract)。两页只是现有设计的统一解释/资料维护规则，不是要求再存一份作者IR。表格、清单与标签统计只能成为按原文修订可重算的视图，除非它们本身是对应Owner的唯一规范。


规范文字的维护与等义合并以[唯一文档责任](90-治理与参考/维护/规格写作与完整性.md#semantic-claim-editing-contract)为准；各业务语义仍由对应规范定义。

**统一裁决的现行入口**：[规范—交接—证据关系](00-系统与原则/统一多层工程模型.md#unified-responsibility-and-verdict)；[严格有型关系及版本失效](70-工程系统与演进/信息与生命周期/对象关系与配置基线.md#typed-system-relations-operational-contract)；[Contract Unit/编号/表格/材料处理](90-治理与参考/维护/文档架构.md)；[未取得真实产品资格的R01–R12](90-治理与参考/状态/实施闭包.md#unification-design-closure-vs-product-evidence)。这些入口共享原Owner，不能成为第二规范。

## 唯一责任入口

| 职责 | 入口 |
|---|---|
| 系统原则、能力、分层和合法边界 | [系统与原则](00-系统与原则/README.md)、[总架构](00-系统与原则/总体架构.md) |
| 结构JSON、原生源码、作者编辑/保存 | [作者与输入](10-作者与输入/README.md)、[严格作者源](10-作者与输入/作者源/结构化源码.md) |
| 开放Meaning、类型、Pattern、意图与联合约束 | [语义与组合](20-语义与组合/README.md)、[公共基底](20-语义与组合/共同语义/工程通用语义全域与闭合合同.md#stable-finite-general-semantic-core)、[联合解释](20-语义与组合/组合/跨软件需求合同.md#stable-joint-requirement-contract) |
| 实现供应、精化与选择 | [实现解析](30-实现解析/README.md)、[Method资格](30-实现解析/实现选择/实现解析与候选资格.md#stable-method-refinement-contract) |
| Target源码、全部成员、映射及发布产物 | [目标与制品](40-目标与制品/README.md)、[完整装配](40-目标与制品/目标/具体降低与目标输出.md#stable-target-full-assembly-contract) |
| 实际授权、Operation、真实读回和恢复 | [执行与观测](50-执行运行与观测/README.md) |
| Claim、独立证据与资格 | [保证与证据](60-保证与证据/README.md)、[纵向符合性](60-保证与证据/验收/意图覆盖与纵向符合性.md) |
| 模块/文件/状态/算法/迁移施工设计 | [工程系统与演进](70-工程系统与演进/README.md)、[S0–S8接口](70-工程系统与演进/工程构造手册/28-抽象到业务系统-统一实施闭包.md#gift121-stable-end-to-end-compiler-contract) |
| 用户、AI、CLI与Workbench | [开发者与接口](80-开发者与接口/README.md)、[主链](80-开发者与接口/需求到交付主链.md) |
| 当前未闭合、文档权威和历史决定 | [治理与参考](90-治理与参考/README.md)、[R01–R12](90-治理与参考/状态/实施闭包.md#gift121-closure-status) |

## 规范读取与修改

从[主题导航](00-系统与原则/导航/主题导航.md)或[任务路线](00-系统与原则/导航/任务路线.md)定位实际所有者，再沿真实引用、版本与消费者扩大阅读。阅读列表、KnowledgeIR/Index/缓存是可重建投影，不是第二写源。字段、失败、迁移及独立反例归相交的准确owner；同一条件只在其它位置引用，不复制一份可独立漂移的定义。[文档权威与写入准入](90-治理与参考/维护/文档架构.md)。

研究/领域知识在[research](../research/README.md)，例证在[fixtures](../fixtures/compositions/README.md)，反例在[witnesses](../witnesses/counterexamples/README.md)，机器形状在[schema](../schema/README.md)；本包不提供旧离线工具作为必需入口；这些都不自行签发生产产品资格。

<a id="文档责任分区"></a>

当前没有把历史设计成果裁剪成第二套精简规范。真正已实现与尚未实施的差额按[状态表](90-治理与参考/状态/实施闭包.md)核对，不凭文档页数、结构校验或演示成功断定任意业务已编译合格。
