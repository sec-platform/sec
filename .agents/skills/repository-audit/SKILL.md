---
name: repository-audit
description: 用于用户要求全面分析 SEC 仓库、重大架构变更前、重复系统性缺陷或 authority/code/test/CI 漂移时，对 exact revision 执行全量 tracked-path census、行为与约束审计并给出证据化优化；不用于普通叶节点开发或用抽样搜索冒充全仓覆盖。
---

# repository-audit

## 触发
- 用户明确要求全面、极致或全仓库分析、审计和优化。
- 重大架构/合同演进前，或同类问题重复出现并怀疑共享抽象、状态所有权、验证架构或治理合同失效。
- active authority、实现、测试、CI、控制面、外部能力或仓库结构出现冲突、漂移或无法解释的空洞。

## 不触发
- frozen Task Envelope 内已证明为局部叶节点的普通实现、修复或重构。
- 只需建立 latest main/PR/Issue/CI/Review 最小事实快照；该行为由受信 control-plane resolver 确定性完成。

## 输入
- exact repository/default/head/tree identity、clean index/worktree、全部 tracked paths、open PR/Issue、CI/Review、active pointer与manifest。
- `.documentation/documents.json`、相交文档正文、模块/入口/公共合同、状态与写 owner、依赖/工具链、测试/CI/Gate、外部能力账本和历史边界。身份索引与当前运行控制事实分开核验。

## 前置门禁
- 受信 document-control-plane snapshot 已解析 latest default branch、exact revision、GitHub facts和active control plane。
- 仓库可完整读取；任何路径、submodule、生成输入或外部 authority 不可访问时必须记录 unknown，禁止假定已覆盖。

## 执行
1. 先冻结 clean HEAD/tree，再从该 exact tree 与 raw blobs 对全部 tracked paths 做一次 census；checkout/index 内容不得混入报告。分类为产品实现、验证、配置、活动权威、历史/Evidence、Agent投影或启发式运行面；不得以搜索命中、目录抽样或固定文件清单代替全仓覆盖。
2. 建立对象、入口、接口、状态/写 owner、生命周期、依赖、数据流、控制流、错误/恢复和发布链；区分确定性合同与需要 Agent 判断触发/选择/回退/停止的启发式行为。
3. 对齐长期 Goal、阶段 DAG、相交正文的责任、当前代码、测试、CI/Gate、PR/Issue/Review和真实产物；冲突时按当前规范裁决与现实反证追踪 canonical owner，不让身份索引签发权限，也不以代码存在反向覆盖目标设计。
4. 主动寻找第二 writer/loader/revision/pipeline、隐式状态、循环依赖、孤儿入口、重复规则、宽泛 catch-all、无消费者配置、过期当前事实、弱测试、错误成功声明和不可恢复路径。
5. 对每项 finding 绑定 exact path/line/symbol、机制、影响、证据、最强反例、未知和反转条件，并区分事实、机制推导、现实推断和候选优化。
6. 将 Agent 启发式缺口交给 `heuristic-governance`，跨 owner 架构缺口交给 `architecture-evolution`，产品实现交给受信 work selector/Work Package owner；全仓审计本身不扩张为无限修改包。
7. 保留每个行为候选的 path/line/text/deterministic-or-Skill route ledger；unowned候选与unknown在默认执行中fail closed。只有显式diagnostic模式可以保留unknown而不作为Evidence退出失败。
8. 输出按严重度、控制半径、不可逆风险、依赖顺序和修复收益排序的机器可读报告及有限候选闭包。

## 完成证据
- exact clean head/tree、tracked-path总数与分类计数、活动 authority/heuristic coverage、完整行为候选、模块/owner/入口覆盖、finding与unknown ledger、优化候选及其证据链。
- `unclassified=0`、所有未覆盖/冲突均显式列出；“没有发现”必须同时说明检测机制和覆盖边界。

## 停止与恢复
- 全部 tracked paths已分类，决定性 authority/owner/入口/状态/验证面已覆盖，攻击轮不再产生新的决定性轴；或准确返回不可访问边界和unknown。
- repository/default/authority发生变化时旧报告立即失效，从新 exact revision重跑；不得在旧审计末尾追加例外维持旧模型。

## 禁止捷径
- 不以 `rg`、GitHub Search、单一代码图、README、PR body、历史报告或少量代表文件宣称全仓分析。
- 不把审计报告提升为产品/架构 authority，不把所有发现塞进一个巨型实现包。
- 不把确定性算法、类型字段和产品事实机械复制为 Skill；只抽取真实启发式行为。
- 不把dirty checkout、index或只含候选计数的摘要标记为exact-revision Evidence。
