---
name: repository-audit
description: 对明确请求的 SEC 全仓或跨 owner 范围做 exact-tree census、约束与消费者审计，定位系统性缺陷和有证据的优化；普通叶节点开发及当前 PR/CI 状态快照不触发。
---

# repository-audit

## 当前归属
系统边界从[总体架构](../../../docs/架构/总体设计.md)进入；同类消费者与新增入口的闭包归[约束强制](../../../docs/架构/约束强制与整体一致性.md#system-control-closure)，审计与作用准入的分工归[工程行为路由](../../../docs/开发/AI协作/规则装载与任务恢复.md#engineering-behavior-routing)。索引和路径分类用于发现，覆盖结论仍由实际读取与方法支撑。

## 触发
- 用户明确要求全仓审计，或对指定跨owner范围作完整分析；“全面优化某一对象”不自动扩大为整个仓库。
- 重大架构/合同演进前，或同类问题重复出现并怀疑共享抽象、状态所有权、验证架构或治理合同失效。
- active authority、实现、测试、CI、控制面、外部能力或仓库结构出现冲突、漂移或无法解释的空洞。

## 不触发
- frozen Task Envelope 内已证明为局部叶节点的普通实现、修复或重构。
- 只需建立 latest main/PR/Issue/CI/Review 最小事实快照；该行为由受信 control-plane resolver 确定性完成。

## 输入
- exact repository/base/head/tree、声明的审计范围及该范围完整path集合；全仓声明需要全部tracked paths。当前default、PR/Issue、CI/Review与active pointer只在相交结论需要时取得；不可用不伪造成当前事实。
- `.documentation/documents.json`、相交文档正文、模块/入口/公共合同、状态与写 owner、依赖/工具链、测试/CI/Gate、外部能力账本和历史边界。身份索引与当前运行控制事实分开核验。

## 前置门禁
- 固定可复核的输入身份。当前操作/发布资格消费受信control-plane snapshot；离线frozen source审计保留缺失live事实，不据此阻断不依赖它的源码判断，也不签发当前操作资格。
- 仓库可完整读取；任何路径、submodule、生成输入或外部 authority 不可访问时必须记录 unknown，禁止假定已覆盖。

## 执行
1. 先固定immutable tree，再从该tree与raw blobs对声明范围做一次census；全仓模式覆盖全部tracked paths，限定范围则同时说明边界与外部消费者。checkout/index内容不得混入exact-tree报告；dirty工作不因审计被清理。分类为产品实现、验证、配置、活动权威、历史/Evidence、Agent投影或启发式运行面；不得以搜索命中、目录抽样或固定文件清单代替全仓覆盖。
2. 建立对象、入口、接口、状态/写 owner、生命周期、依赖、数据流、控制流、错误/恢复和发布链；区分确定性合同与需要 Agent 判断触发/选择/回退/停止的启发式行为。
3. 对齐长期 Goal、阶段 DAG、相交正文的责任、当前代码、测试、CI/Gate、PR/Issue/Review和真实产物；冲突时按当前规范裁决与现实反证追踪 canonical owner，不让身份索引签发权限，也不以代码存在反向覆盖目标设计。
4. 主动寻找第二 writer/loader/revision/pipeline、隐式状态、循环依赖、孤儿入口、重复规则、宽泛 catch-all、无消费者配置、过期当前事实、弱测试、错误成功声明和不可恢复路径。
5. 对每项 finding 绑定 exact path/line/symbol、机制、影响、证据、最强反例、未知和反转条件，并区分事实、机制推导、现实推断和候选优化。
6. 将 Agent 启发式缺口交给 `heuristic-governance`，跨 owner 架构缺口交给 `architecture-evolution`，产品实现交给受信 work selector/Work Package owner；全仓审计本身不扩张为无限修改包。
7. 复用原审计输出的path/line/behavior与deterministic-or-Skill路由，不建立第二套行为账本。unowned与unknown依真实消费者决定阻塞范围；生产blocking/diagnostic出口按原audit合同处理，不能由报告prose抹掉或扩大。
8. 输出按严重度、控制半径、不可逆风险、依赖顺序和修复收益排序的机器可读报告及有限候选闭包。

## 完成证据
- exact输入tree、声明范围与path分类计数、相交authority/heuristic coverage、行为候选与模块/owner/入口覆盖、原报告中的finding/unknown及优化证据链；限定范围结果不得称全仓完成。
- `unclassified=0`、所有未覆盖/冲突均显式列出；“没有发现”必须同时说明检测机制和覆盖边界。

## 停止与恢复
- 声明范围的全部路径已分类且相交authority/owner/入口/状态/验证面有结论，或准确返回不可访问边界和unknown；未再找到反例不证明开放范围已穷尽。
- 报告始终只证明其绑定的exact revision；需要评价新revision时由变化闭包决定哪些观察失效并补齐新census，保留可复用的固定对象证据。无关default前进不销毁旧报告，也不能将旧报告冒称新revision；根假设变化须重算相交模型。

## 禁止捷径
- 不以 `rg`、GitHub Search、单一代码图、README、PR body、历史报告或少量代表文件宣称全仓分析。
- 不把审计报告提升为产品/架构 authority，不把所有发现塞进一个巨型实现包。
- 不把确定性算法、类型字段和产品事实机械复制为 Skill；只抽取真实启发式行为。
- 不把dirty checkout、index或只含候选计数的摘要标记为exact-revision Evidence。
