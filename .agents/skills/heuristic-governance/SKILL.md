---
name: heuristic-governance
description: 用于新的 Agent 行为选择、重复系统性偏航、维护者纠错或 Skill/Work Package/计划被事实证伪时，从用户终局结果反向重算因果图、删除错误前提并把确定性事实收回唯一 owner；不用于复制产品事实、默认增加机器门禁或把每个反例追加成提示词。
---

# heuristic-governance

## 触发
- 新增或改变 Agent 的选择、回退、停止、委派或恢复行为。
- 同类偏航重复发生，或 maintainer 指出前提、owner、Skill、Work Package、计划或执行路线错误。
- 治理对象阻止修复自身，或局部补丁正在扩大规则、测试、文档和例外。

## 不触发
- 可由类型、Schema、validator、状态机或确定性 compiler 完整裁决的领域事实。
- 不改变行为的排版、链接和历史资料维护。

## 输入
- 用户可观察的终局业务结果、明确不要的结果和全生命周期成本。
- 当前事实、被证伪前提、依赖该前提的 action/plan/code/test/Evidence 闭包。
- canonical owner、现有 behavior/Skill identity、当前权限与 exact revision。
- 能在未来无需再次提醒便阻断同类偏航的可观察条件。
- 性能或资源问题还必须拥有绑定同一revision、workload与environment的fresh端到端阶段账本、重复工作/等待/cleanup归属和删除反事实；已有fresh账本直接复用，缺失或stale时才重新采集。局部热点、单函数耗时或某次优化收益不能单独决定实现路线。

## 前置门禁
- 先对准备保留、新增、修改或验证的对象做彻底删除反事实；无法说明删除后哪个终局结果变差时，不得把对象当作需求。
- 能定位被证伪前提、受影响闭包和 canonical owner；不能定位时保持 typed unknown。
- 先判断规则能否机器化；能机器化就交回领域 owner，Skill 不保留副本。
- 先判断观测到的是叶节点缺陷，还是 canonical owner、依赖方向、identity、admission、state/Effect、failure/recovery 模型已经错误。后者使依赖旧模型的局部计划与实现立即 stale，必须先修能阻断同类错误的最小上游架构闭包；前者不得借机扩大成全仓重构。

## 执行
1. 立即使依赖错误前提的计划、结论、cache、Evidence 和委派工作 stale；禁止在旧路线旁补例外。
2. 从终局结果建立最小因果图，并对 identity/owner、producer/consumer、state/effect、failure/recovery、安全、并发、资源/性能、外部轮子、版本/迁移/退役、测试和可维护性做闭包；这些维度不是等待逐项提醒的清单。
   性能修复先按真实operation切分pure identity、admission、lookup/join、Effect、readback和cleanup，识别支配总成本的因果边；在此之前不得因一个真实但局部的热点直接进入实现。若terminal复用、known failure或plan-only路径仍创建执行资源，优先删除错误的admission顺序，而不是增加cache、daemon、timeout或第二provider。候选优化必须分别证明观察等价性，以及在可复现workload、接受阈值与资源预算下的端到端收益；局部加速不能抵消总时延、内存、I/O、cleanup或失效成本的退化。
3. 从反例抽取最小通用不变量，分为 `deterministic | heuristic | mixed`；产品字段、算法和动态状态不得进入 Skill。
4. 复用现有 work/behavior/owner identity；没有独立闭包不得新建 Skill、Issue、registry、compiler 或计划。
   “先修架构”只授权修复已被证据否定且支配当前终局结果的最小因果闭包。当前consumer不是存在资格：owner-issued的accepted future obligation、替换/迁移责任、外部或历史状态、不可替代能力与明确activation/retirement路线都能证明`future-required | required-unmaterialized`；它们必须进入同一因果图并受保护。只有这些价值证据与unknown都为零时才可判为speculative/orphan；不能因暂未接线就删除，也不能靠未被owner接受的“以后可能用”无限延期业务闭包。
5. 确定性事实进入唯一领域 owner；只有确实需要长期自动拒绝且比类型/派生/删除更小的边界才增加机器拒绝。仅剩判断部分进入唯一 Skill 的触发、停止和恢复路由。
6. 反向重算全部依赖节点，删除被替代路径、假版本、兼容壳、镜像测试和第二 owner；未证明不受影响的节点保持 stale/unknown。
7. 用代表性正向、负向、边界场景验证无需 maintainer 再提醒即可发现并纠正同类偏航。

## 完成证据
- 被证伪前提、反向影响面、canonical owner、机器拒绝点、唯一 Skill 路由、删除路径和 typed residue。
- 错误路径已 consumer-zero 或 fail-closed；不是一句“同意/已记录”。

## 停止与恢复
- 只有错误前提的下游闭包已重算、确定性规则已机器化、重复 prose/Skill/WP 路径已删除后恢复。
- 新反例证明分类错误时重新分界，不在 Skill 末尾追加例外。

## 禁止捷径
- 不把 maintainer 原话、样例、字段表、版本或产品算法复制进 Skill。
- 不用新 Skill、Issue、WP 或 Evidence 文件代替既有 owner 修复。
- 不借治理自纠扩权外部写入、安装、发布、清理或 merge。
