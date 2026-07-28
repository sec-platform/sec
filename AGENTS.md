# SEC 仓库开发入口

本文件只负责启动与路由，不复制 Work Package、Skill、测试矩阵或产品架构。详细事实分别由下列唯一 owner 提供：

- 文档权威图：`docs/00-文档索引与一致性规则.md`
- Agent 稳定协议：`docs/04-AI自主实现执行蓝图.md`
- 当前状态与近期选择：`docs/work/**`
- 具体行为闭包：`.agents/skills/**`
- 产品与架构：对应 canonical owner 文档和 `main` 代码
- 验证与合并：测试/CI 机器合同及 exact-head Evidence

## 启动顺序

1. 以最新 `main`、开放 PR/Issue、CI、Review 和真实 diff 建立事实；branch、PR body、聊天和旧报告不是正式工程事实。
2. 运行一次 `bun scripts/codex/document-control-plane.ts status --json`。结果为 `unresolved`、`invalid` 或与 live default branch 不一致时停止写入。
3. 若 resolver 选择一个 frozen Work Package，只在其 owned/forbidden paths、acceptance 和 tests 内工作。
4. 根据任务选择一个主 Skill；全仓分析使用 `sec-repository-audit`，架构重算使用 `sec-architecture-evolution`，普通纵切片使用 `sec-worker-development`。
5. 只装载当前任务需要的 authority、types、tests 和 source；证据或前提失效时按 Skill 的 reload/recovery 重新解析。

## 约束的生效等级

| 等级 | 唯一载体 | 能证明什么 |
| --- | --- | --- |
| 硬合同 | 类型、Schema、parser、validator、test、Hook、CI | 可被机器观察和拒绝的条件 |
| 授权边界 | frozen Work Package / Task Envelope | 本次允许修改、验收和验证范围 |
| 启发式 | 唯一 Agent Skill | 触发、选择、回退、停止等判断 |
| 事实与设计 | `main`、canonical docs | 当前实现和稳定目标 |
| Evidence | exact revision 的日志、报告、产物 | 某次验证结果，不拥有新规则 |

本文件不再拥有“单一纵向切片默认不创建子 Agent”等具体分派规则；它们只由对应 Skill 裁决。仅写在 prose 中且无机器 owner 的句子不能称为硬门禁。完全重复工具调用 `0`、Agent wait timeout `0`、产品实现占主动工作时间至少 `70%`、正常交付不本地运行Risk后再重复hosted Risk 等只能作为可观测性或专用 Skill 的优化目标，不能单独阻塞正确实现或证明交付失败。

## 不变量

- 同一 canonical authority、state owner、public contract 和 active Work Package 只有一个写者。
- Worker 不自授权扩大 scope、触发 hosted Gate 或 merge；A0 负责 integration、Gate custody、merge、readback 和清理。
- Squash merge 后按新 `main` tree、实际代码和验证判断结果，不按旧 commit ancestry 或分支名判断。
- 失败后先定位根因和失效证据，只重跑被 delta 影响的最小验证；不通过重复运行制造“更可信”的假象。
- 合并后必须回读新 `main`，归档完成使命的 Work Package，关闭被吸收或废弃的 PR/Issue，并重新计算近期计划。
