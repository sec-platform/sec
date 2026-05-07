# 工程编译器实施计划与路线图

> 权威边界：本文只决定阶段目标、里程碑、优先级和进入/退出条件，不直接定义 schema 或实现协议。实现字段以 `05-11` 为准。

## 路线总原则

- 永远优先证明"规格 → 装配 → slot → 验收 → 来源追踪"主链。
- 当前策略：**收敛型高速开发**。优先级从高到低：可演示闭环 → 稳定 CLI 合同 → JSON contract → E2E 矩阵 → 复杂度压缩 → 新功能。
- 每轮新增后检查：是否形成可运行路径、是否进入稳定 contract、是否需要删除重复概念。

## 当前进度

### 状态图例

`done` = 已实现并有定向验证覆盖 | `active` = 当前优先推进 | `next` = 完成 active 后的默认切口 | `later` = 已预留暂不进入

### 阶段判断

| 阶段 | 状态 | 依据 |
| --- | --- | --- |
| A：文档与规格冻结 | done | `docs/00-11` 已形成分层规格栈 |
| B：v0.1 首条闭环 | done | Customer Admin 母例 + 3 块 + 单 slot 链路已落地 |
| C：v0.2 工程可持续化 | active | provenance/explain/policy/repair/upgrade 已具备基础设施 |
| D：v0.5 团队可用化 | next | 私有 registry + CI 口径 + 完整块母库 |
| E-K：平台化 → 长期研究线 | later | 等单栈平台和 provenance 机制稳定 |

### 已完成能力

| 能力面 | 状态 | 要点 |
| --- | --- | --- |
| CLI 主链 | done | `init/add/resolve/compose/adapt/verify/repair/upgrade/lock/explain` |
| 官方块 | done | 13 个块覆盖 auth/tenant/entity/rbac/audit/export/file/notify/table/infra |
| Slot 合成 | done | `customer_normalizer` 通过 task envelope 限定写入边界 |
| Verification | done | fast/runtime/all 三 lane；typecheck + Vitest + Playwright + policy gate |
| Acceptance coverage | done | 块/slot 覆盖映射，依赖满足判断 |
| Provenance | done | `control/provenance/provenance.json`，包含 block/slot/generated/override 追踪 |
| Explain graph | done | 58 节点 / 67 边，多类型节点和归因边 |
| Review summary | done | CI 链摘要、覆盖率、provenance、failure/risk/conflict 结构化输出 |
| Repair | done | verification 失败 → repair plan，可对 repairable slot 受限写回 |
| Upgrade | done | 17 种 migration 类型，dry-run/diagnostics/verify/provenance 更新 |
| Policy gate | done | official/project policy merge + violation report |
| 治理产物 | done | 15 个 stable artifact paths（见 `08` §7） |
| 开发者入口 | done | `doctor` / `deps status|warmup|relink|clean` |
| Workbench 回写 | done | `source/views/mutations/*.json` → `source/app.yaml` |
| **架构内聚重构** | done | Logger / CompilerPass / InstallStrategy / ManifestCache / CommandRegistry / Orchestrator 拆分 / dev-runner 拆分 / Process 增强 / YAML 验证 / Review Types 拆分 / 错误码映射 / 文件 I/O 并行化 |

### 当前 active 工作包

| 工作包 | 目标 |
| --- | --- |
| 产品收敛 | demo/benchmark/reference drift/contract freeze/dogfood 稳定闭环 |
| 升级引擎增强 | migration 类型持续扩展，dry-run/diagnostics 可审查 |
| repair 可审查化 | failure points 结构化归因，blocker 诊断完整 |
| explain graph 归因 | policy/pin/override/repair/upgrade 归因边完善 |
| Ticket SaaS 纵切面 | `ticket/basic` 块 + 状态流转 + 租户隔离 + 评论 + SLA |

### 下一步

1. Work Tracking / Ticket SaaS 完整纵切面（`ticket/basic` + `comment/basic` + `worklog/basic` + `sla/basic`）
2. CI 集成规范（reference drift gate + contract freeze gate + benchmark gate）
3. 第二数据库（PostgreSQL）正式路线
4. review assist（CI 自动评审摘要）

## 开发者入口与依赖环境

核心原则：`source/` 是唯一开发工作面，`project/` 是生成目标层，`control/` 是控制平面。

- CLI 是一等入口，Workbench/IDE 插件补充交互体验。
- 本地推荐布局：根 `node_modules`（编译器自身）、`.shared-deps/node_modules`（生成项目运行时共享）、`project/node_modules`（默认链接）。
- `platform doctor` 检查 workspace 四根、依赖环境、缓存。
- `platform deps status|warmup|relink|clean` 管理依赖环境。
- CI：PR/push → fast lane，schedule/manual → all lane。

## 全局决策框架

**现在必须决定**：slot 描述正式语言、Pin 连通性验证规则、私有 registry 版本治理。

**现在不用实现但必须预留**：Kernel Block 接口、多 registry 联邦解析、AST patch engine。

**现在明确不做**：图形化 IDE、社区 registry、多后端目标栈、通用 AI 编码助手模式。

**晚想会导致返工**：error code 协议全面机器可消费、benchmark 标准、acceptance DSL 嵌套规则、AI 介入的 signature gate。

## 阶段详情

### 阶段 A-B：文档冻结 → v0.1 闭环（done）

完成了 00-11 分层规格栈，Customer Admin 母例闭环可重复运行，AI 单一 slot 填充链路可用。

### 阶段 C：v0.2 工程可持续化（active）

目标：从"闭环能跑"升级到"工程可持续"。13 个官方块 + provenance + explain + repair + upgrade + policy gate 已具备。当前重点：升级引擎 17 种 migration 类型完善、repair 结构化归因、explain graph 多类型归因边、Ticket SaaS 纵切面落地。

退出条件：ticket vertical 主链路闭环通过；升级/repair/explain 三项对非专家可审查；私有 registry 基础通路稳定。

### 阶段 D：v0.5 团队可用化（next）

私有 registry 正式版本治理、review assist CI 集成、CI 团队口径（reference drift + contract freeze + benchmark gate）、Write-back patterns 文档化。退出条件：至少 2 个独立团队可各自维护私有 block 且不互相干扰。

### 阶段 E-J：平台化 → 长期研究线（later）

E（v1）：graph explorer、双视图工作台、托管验证。F（v2）：多目标编译器、marketplace。G（v3）：跨领域扩展。H：终局平台面（企业级托管）。I-J：分层自举和自维护系统。K：产品线/组织/Reality Compiler 研究线。

以上阶段必须在单栈平台、升级周期和 provenance 机制完全稳定后才能进入，所有自维护/自举操作必须通过权限边界、人工审批和可审计 provenance 约束。
