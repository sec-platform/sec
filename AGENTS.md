# SEC Codex 工程治理

本文件只维护长期稳定的仓库级 Agent operating contract。当前阶段与执行顺序以 `docs/03-MVP实施计划与路线图.md` 为准；Engineering IR 设计以 `docs/14-Engineering IR与语义事实规范.md` 为准；测试分层与证据复用以 `docs/test-feedback-and-ci-lanes.md` 为准。

## 工程事实与决策顺序

- `main` 是唯一正式工程事实。Branch、PR、Issue、Completion Report 和历史聊天只作为线索。
- 每轮规划前重新读取 latest `main`、open PR/Issue、相关 head/base/merge-base/diff、review threads、有效验证证据、authority docs 与实际代码。
- Squash merge 后按最终代码与 diff 判断能力是否进入 `main`，不得用原 commit ancestry 误判遗漏。
- 先从 architecture authority、代码和测试重新计算 DAG；不要默认沿用上一轮计划。

## Root A0 Orchestration

- Root 是 A0 Integrator，负责 DAG、task ownership、integration、验证、merge、closeout 与 branch hygiene。
- 对真实独立的探索、架构审查、实现或证据分析动态 spawn subagents；不要为了占满并发而固定启动全部角色。
- 并行前明确 branch、owned files、allowed seam expansion、forbidden paths、prerequisite、acceptance、tests 与 reconciliation points。
- 同一个 canonical type、revision algorithm、builder、pipeline stage order 或 authority 章节默认串行，除非 ownership seam 已明确。
- 保持 delegation depth 为 1。普通 worker 不得继续递归分派。
- 可用角色位于 `.codex/agents/`；按任务选择最小角色集合。

## Worker 协议

正式实现 worker 的 Task Envelope 必须包含：task/Issue、current base、branch、architectural goal、ownership、forbidden paths、dependency、acceptance 和 required tests。

Worker 执行：

```text
inspect → implement → focused local validation → commit → Draft PR/update existing PR → Completion Report → stop
```

Worker 默认 `DO NOT MERGE`，不得添加 `run-quick` / `run-full` label，不得修改其他 worker ownership，不得顺手全仓重构，也不得通过删除测试或弱化合同解决失败。

## 验证与 Actions 经济性

- 验证结论必须绑定 tested head/base、profile、contract revision（已知时）、命令/Gate、scope、result、duration/evidence 与 invalidation rule。
- 优先复用 `docs/test-feedback-and-ci-lanes.md` 中仍有效的昂贵证据。后续只重跑被 intervening diff 失效的 Gate。
- 旧结果不得伪装成新 head 的 exact-head 结果；允许记录“已验证 baseline + diff impact + delta focused validation”的组合证据。
- 本地环境足以证明的 Gate 在本地运行；GitHub Actions 只在 required contract 仍缺证据时触发一次。不得恢复 every-push、daily full 或重复 full/slow rerun。
- 失败后读取具体 failed Gate / failure tail，修根因并运行最小 sentinel。不要在设计期反复跑完整矩阵。

## Merge 与收口

只有在能力仍有效、未被取代、authority 一致、required evidence 满足、head/base 已理解、无 unresolved thread、无 REQUEST_CHANGES、无临时 probe/意外 artifact drift 时，A0 才能 merge。

- 大型 integration 优先 squash 最终验证状态。
- 门禁满足后及时 merge，不为表现仍在开发继续修改正确代码。
- 被 integration 吸收的源 PR 必须准确标为 superseded/absorbed，不得声称独立进入 `main`。
- 完成后关闭对应 Issue/PR，删除完成使命的远端临时 branch，并重新读取新 `main`。

## 文档与重复问题

- 活跃工程文档使用中文；一个主题只有一个 canonical owner，其他文档引用它。
- 不把临时 SHA、一次性 blocker 或当前 task list 写入本文件。
- 代码、测试、CI 与文档冲突时，识别真正 authority 后统一受影响表面。
- 同类问题重复出现时，升级检查 shared abstraction、canonical contract、identity/revision boundary、state ownership、lifecycle、deterministic normalization、test architecture 与 CI Gate；修复共同根因。

## 常用本地门禁

按 diff 风险选择最小集合：

```text
bun run typecheck
bun run docs:doctor
SEC_IMPORTS_CHANGED_ONLY=1 + SEC_CHANGED_BASE=<base> + bun run imports:check
bun test <focused tests> --timeout 180000
bun run reference:check
```

不要把上述列表理解为每次全部运行；以验证复用账本和 invalidation 判断为准。
