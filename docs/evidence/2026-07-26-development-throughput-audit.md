# 2026-07-26 开发吞吐审计

## 范围

来源为 Codex任务 `019f8855-70c6-77a1-928b-b75464cff42c` 已完成的全量日志审计。本证据只固化已量化结果和由其推出的工程约束；后续任务不得重复扫描原始日志，除非出现新的数据范围或反证。

## 量化结果

| 观察 | 结果 | 直接浪费 |
| --- | ---: | --- |
| JSONL事件 | 61,426条，162,004,926 bytes | 重扫会再次消耗大量上下文与工具时间 |
| 时间跨度 / 活跃时间 | 100.77小时 / 71.20小时 | 长周期未形成稳定候选 |
| 工具调用 | 10,096次 | 编排成本过高 |
| 完全重复调用 | 1,276次，12.65% | 相同事实与 Gate被重复读取/执行 |
| Agent spawn | 98次；67成功、31次参数或名称冲突 | 31.63% spawn没有产生开发结果 |
| Agent wait | 435次；343次 timeout | 78.85% wait没有返回新事实 |
| Agent编排调用 | 约1,030次 | 编排替代了 owned seam上的实现 |
| Context compaction | 102次 | 反复装载与长叙述加剧上下文损耗 |
| 单次失控复合调用 | 21,774.4秒 | 长命令组合后无法独立监督和及时止损 |
| Patch | 1,097次 | 候选和控制面持续 churn |
| 三个控制面 patch | 43 / 31 / 22次 | 普通进度被错误持久化为控制面更新 |
| Runtime候选 | 1个 frozen failed + 8个 failed successor | 缺少 candidate invalidation上限 |
| Risk preflight | 两个候选在 affected PASS后因 unresolved path以0 Gate失败 | ownership判断发生得过晚 |
| Squash merge | 13次中约8次主要为 docs/control/hygiene | 治理交付占比压过产品吞吐 |

## 根因与已选约束

| 根因 | 唯一治本约束 |
| --- | --- |
| `test:affected`与Risk使用不同的失败时机 | 在现有`test:affected`最前复用canonical Risk selector；不新增selector/planner |
| 重复读取不变事实 | 新 Work Package一次 live snapshot；只由`reload_if`、证据冲突或收口触发刷新 |
| Agent命名冲突与timeout轮询 | 每个owned seam/角色最多一个live agent；本地工作未耗尽前不wait |
| 连续 successor消耗昂贵 Gate | 一个candidate epoch；第二次 invalidation强制`STOP_PROOF_RESET` |
| 复合长调用无法监督 | 长时/approval命令独立调用、唯一supervisor、禁止`Promise.all`与复合shell |
| 控制面和状态输出膨胀 | 普通进度只进Reconciliation Delta；`current-state`只保留可复用稳定事实 |
| 机械全跑验证 | changed paths、owner、contract与release条件选择最小Gate；一个最终candidate只运行一次正式affected与一次selected Risk |

## 后续度量

每个 Reconciliation Delta统一记录：

- `tool_call_count`
- `agent_spawn_count`
- `agent_wait_timeout_count`
- `context_compaction_count`
- `candidate_invalidation_count`
- `context_reload_count`
- `duplicate_gate_count`
- inspect / implement / focused validation / wait / reconcile耗时

目标不是减少必要验证，而是让错误在最便宜且最接近唯一 authority的边界失败。
