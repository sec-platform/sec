# SEC Work Package 计划合同

本文件定义非平凡工程变化的执行计划格式和维护协议。它是计划方法的稳定元合同，不是产品路线图，也不承载任何当前阶段事实。

权威边界：

- 当前阶段、先后顺序和进入/退出条件只由 `docs/03-MVP实施计划与路线图.md` 持有。
- 产品和实现协议只由 `docs/02`、`docs/05–14` 与测试权威文档持有。
- 当前非平凡 Work Package 的执行编排只写入唯一 `docs/work-packages/<id>.md`。
- Issue、PR body、Completion Report 和聊天只记录状态、exact refs、讨论、证据链接与 remaining gaps，不得成为唯一计划。

## 1. 何时必须建立 Work Package 计划

满足任一条件时，在实现开始前创建或更新计划；若调查本身才能确定范围，最迟在第一个可审查提交前完成：

- 修改 canonical Engineering IR、Entity/Fact identity、revision 或公开协议；
- 修改状态机、事务、journal、recovery、rollback、并发或权限边界；
- 跨越三个及以上模块，或存在多个必须按依赖顺序完成的里程碑；
- 需要迁移、兼容策略、数据重建或可验证回滚；
- 需要 slow/full evidence、多个 reviewer 或独立 reconciliation point；
- 预计超过一个 focused implementation cycle；
- 当前架构存在必须先裁决的重大未知。

以下变化通常不建立独立 Work Package：单文件文档修正、边界明确的小型缺陷、无 authority 变化且可由一个 focused test 证明的局部维护。它们仍必须使用完整 Task Envelope。

## 2. 唯一计划与状态

每个 active Work Package 只有一个计划文件：

```text
docs/work-packages/<id>.md
```

新计划从 `docs/work-packages/_template.md` 开始，删除无关占位内容后再进入 review；不得让模板本身承载当前 Work Package 事实。

推荐状态流：

```text
draft
→ ready
→ executing
→ verifying
→ merge-ready
→ completed | abandoned
```

文档 frontmatter 的 `status` 使用仓库文档状态词；执行阶段在正文“当前状态”中维护。计划完成后，长期事实必须归位到对应 authority；计划文件随后标记为 `historical` 并归档，或在无独立追溯价值时删除。

## 3. 计划必须包含的内容

### 3.1 Header 与权威边界

- Work Package ID、tracking Issue、branch、PR；
- 当前 phase、last reviewed time；
- 路线图 authority、架构 authority、测试 authority；
- 明确声明计划不能覆盖上述 authority。

### 3.2 当前证据

- exact `main` SHA、计划 base、相关 head；
- open PR/Issue、merge-base、真实 diff、review/CI 状态；
- 当前代码、测试和 authority 的已确认事实；
- 未确认项与工具边界；
- 已失效证据及失效原因。

### 3.3 目标、范围与不变量

- 单一可验证工程结果；
- 范围与非目标；
- canonical owner、写权限和数据所有权；
- identity、revision、determinism、idempotency；
- 生命周期、状态机、错误协议、恢复路径；
- concurrency、compatibility、provenance、permission boundary；
- 明确禁止建立的第二事实源或旁路。

### 3.4 实现 DAG

每个里程碑必须写明：

- prerequisite；
- owned files/symbols 与 forbidden scope；
- 实现动作；
- focused acceptance；
- required evidence；
- reconciliation point；
- 失败时的回退或重新规划条件。

里程碑按依赖解锁能力排序，不按“要修改的文件列表”排序。

### 3.5 验证矩阵

每条关键不变量都映射到具体 Gate：

| 不变量 | Gate/命令 | 运行位置 | exact head/base | 预期 | 失效条件 |
| --- | --- | --- | --- | --- | --- |

未运行的 Gate 只能标记为“未运行”。复用旧证据时必须记录原 tested head/base、适用 scope 和 intervening diff 为什么没有使其失效。

### 3.6 风险、恢复与收口

- 风险和触发条件；
- migration/rollback/recovery；
- merge method 建议；
- PR/Issue/branch/workflow 的收口动作；
- 工具不支持的物理操作；
- 完成后文档事实归位与计划归档方式。

## 4. 更新协议

Root A0 在以下时点更新计划：

1. 审计发现原假设错误；
2. authority、base/head 或 dependency 变化；
3. 里程碑进入或退出；
4. reviewer 发现 blocker；
5. 验证证据新增、失败或失效；
6. 设计裁决具有持续工程价值；
7. merge/abandon/closeout。

更新只保留当前有效的执行事实。聊天记录、探索过程、临时计数和已被推翻的猜测不得原样堆入计划；有追溯价值的裁决进入精炼的 Decision Log。

## 5. Codex Task Envelope

从计划派生给实现 worker 的任务必须包含：

```text
task / Issue
current base and expected head
architectural goal
owned files and symbols
forbidden paths
prerequisites
acceptance
required tests
reconciliation point
stop condition
```

Worker 只执行一个有边界的里程碑，完成 focused validation、提交、Draft PR 更新和 Completion Report 后停止。Root A0 负责跨里程碑重算 DAG、证据失效、integration、merge 与 closeout。

## 6. 计划质量门槛

计划可进入 `ready` 只有在以下条件同时满足时：

- 当前事实绑定 exact refs；
- authority 与 ownership 无竞争定义；
- scope/non-goals 足以阻止旁路扩张；
- DAG 没有未解释的循环或隐式 prerequisite；
- 每个关键不变量都有验证方式；
- failure/recovery/rollback 不依赖聊天解释；
- 完成与收口条件可由第三方独立判断。
