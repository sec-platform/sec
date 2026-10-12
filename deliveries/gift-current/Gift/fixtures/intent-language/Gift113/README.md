# Gift113：多个业务意图的有限联合规划见证（历史研究说明）

这是对 Gift113 **有限联合规划实验的说明**，不是新的持久作者协议，也不是生产通用意图编译器、目标源码生成器或真实世界执行器。使用原封的 `gift.author-module/1` / `gift.intent-body/1` 作者模块、准确的 MeaningLibrary、原模型方法目录和一个共享的有限模型快照，验证多个目标在共同资源和禁令下是否能联合满足。

## 原实验运行条件

原实验在完整源码根运行，环境要求（Python 3.11+，环境需具备 `jsonschema` 与 `referencing`；脚本本身不进行网络访问）：

将最后的模型路径换成 `model-shared-pool-2.json`，由两项请求竞争同一容量 1 份变成容量 2 份：前者返回 `NoPlanInSuppliedFiniteModel`，后者返回 `ModelPlanCandidate`，包含两个模拟步骤。两个新请求分别单独规划时均可行；因此它是“单个方法可行却全局不可行”的直接反例。

使用 `model-independent-pools.json` 并把第二个模块换回 Gift112 的 `intent-gpu-quota.module.json`，则两个**独立资源池**复用完全相同的容量 Meaning 和模拟 Method。单个实例的名字没有触发行业代码分支。

## 数据归属与失效边界

- `intent-gpu-shared-pool.module.json` 是一个**测试用途的不同作者模块**，只有角色绑定的资源 `objectRef=bed-1`。这只是有限模型共享资源的明确实验身份，不暗示医院床位和 GPU 在现实中是同一物体。
- `model-*.json` 是本地模拟的已声明对象集和容量状态，不能当作实际医院/云账户/租户的事实。
- `joint_intent_reference.py` 复用 Gift112 的严格 Reader/Meaning/模型转换能力，在每个候选模拟后检查**所有参与意图**的 `maintain/avoid`，最终要求全部 `achieve` 成立；`oblige/permit/prefer` 保持未解释，不能由这份模型签发。
- 模拟 Method 的 `edits` 被复制到新状态；不修改原模型，不执行外部 Grant/Provider。Gift112 的 `capacityReserveOne` 已增加“原请求未确认”的模拟前置条件，避免对同一请求再次计入占用。它仍不构成数据库真实幂等/隔离/读回。
- `node_budget` 和 `max_depth` 有资源/搜索上限。超出范围时返回 `IncompleteSearch`，而不是“绝对无解”；只有精确该有限模型的穷举能返回 `NoPlanInSuppliedFiniteModel`。
- 多意图分析不处理真实跨事件规范义务、无界时序保证、真实世界观察、源编辑/目标 Lowering 或动态并发一致性。若要发布能力，必须增加对应独立消费者、对照、证据和合格宿主。

## 运行结果如何正确解释

| 情形 | 结论 | 不可据此宣称 |
|---|---|---|
| 两个请求共用一个容量为 1 的资源 | 模型内没有共同成功且始终安全的方案 | 世界绝对无解或真实资源只可用 1 份 |
| 两个请求共用容量 2 的资源 | 模型内找到两次模拟预留后共同成功 | 真实事务或并发 exactly-once 已实现 |
| 同一 Method 作用于两个独立资源池 | 可复用其有限 Meaning/模型算法 | 医疗/云领域所有法定政策已统一 |
| 尚未取得前提事实 | `NeedsFact` | 该事实是 false |
| 达到深度/状态预算 | `IncompleteSearch` | 不存在任何可行实现 |
| 没有真实世界 Provider | 仍是模拟候选 | 已发生现实作用或已取得 Grant |

正式目标、跨层架构与准确完成条件参见[联合组合施工](../../../docs/70-工程系统与演进/工程构造手册/20-多意图联合组合-约束与方法搜索算法.md)与[意图符合性](../../../docs/60-保证与证据/验收/意图覆盖与纵向符合性.md)。
