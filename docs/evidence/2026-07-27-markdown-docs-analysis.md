# SEC 工程 Markdown 文档分析报告

## 1. 全局概览

当前仓库（`d:\Project\sec`）包含约 80+ 个项目级 Markdown 文档（已排除 `node_modules`, `.git`, `.shared-deps` 等依赖或缓存目录）。
整个文档体系具有**极强的结构化和工程纪律性**，严格遵循“单一事实源（Single Source of Truth）”原则。文档不仅仅是说明，更是系统架构、AI Agent 行为约束、任务状态机制的核心“控制面板”。

整体文档体系由 `docs/00-文档索引与一致性规则.md` 统领，划分为明确的域和唯一职责边界。

## 2. 核心架构剖析

通过对所有 `.md` 文件的归类与语义分析，SEC 工程的文档体系可划分为以下几个核心层级：

### 2.1 核心规范与权威层 (Core Authority Layer)
这一层由 `docs/00` 到 `docs/14` 的文件组成，是整个工程唯一确定的事实源，定义了产品的各个核心模块、协议与规范。

*   **`00-04` 顶层治理与完成定义**：定义文档规范、用户模型、MVP 边界与 AI Agent 参与仓库开发的执行协议（如 `04-AI自主实现执行蓝图.md`）。
*   **`05-09` 核心编译器与架构约束**：涉及 Workspace、Registry、Block 协议、状态机（Compiler Pass）以及验证、来源追踪等（如 `08-Verification与Provenance与Graph规范.md`）。
*   **`10-14` 变更管理与数据流**：定义门禁（Override）、Workbench 交互、发布流程与 Engineering IR 语义规范（如 `14-Engineering IR与语义事实规范.md`）。

**纪律强调**：除此区域外，其他文档不得复制长期目标或规范合集，出现冲突时以代码和该层的文档为最高准则。

### 2.2 架构、目标与治理层 (Architecture, Goals & Governance)
用于扩展和细化核心层无法承载的具体投影。

*   **`docs/architecture/`**：定义特定领域的架构映射，如 TypeScript IR Layer、Brownfield Import 和 Engineering Workspace IR。
*   **`docs/goals/`**：保存长期目标的稳定镜像，如 `SEC-Engineering-Workspace-Compiler.md`。
*   **`docs/governance/`**：管理外部能力与合规性，如 MCP 接入、Nexus 的一致性与退役报告等。

### 2.3 动态工作流与执行层 (Dynamic Workflow Layer)
该层是 AI 协作和人工研发的“控制面（Control Plane）”，呈现出浓厚的 Agent 自动化研发风格。

*   **`docs/work/`**：实时反映工程的当前状态和滚动计划。例如 `active-work-package.md`（当前工作包）、`rolling-plan.md`（后续候选计划）。
*   **`docs/work-packages/`**：包含了大量的具体任务闭包（如 `b0-bootstrap-v1.md`, `hot-import-feedback-v1.md` 等近 60 个文件）。每个文件代表一个不可变的正式执行单元，记录了特定功能或重构的生命周期。

### 2.4 证据、历史与草稿层 (Evidence, Archive & Superpowers)
*   **`docs/evidence/`**：存放验证或诊断证据（如性能审计、CI 反馈历史），作为不可反驳的客观测试结果备份。
*   **`docs/archive/`**：存放迁移记录和旧体系材料，不参与当前实现决策。
*   **`docs/superpowers/`**：历史设计实施记录与规划。

### 2.5 全局根目录规范
*   **`AGENTS.md` / `CLAUDE.md`**：定义了仓库级 AI 助手的全局规则、行为准则与定制技能，是 AI 必须时刻遵循的短投影（Short Projection）。
*   **`README.md`**：项目最基础的引导信息。

## 3. 分析总结与工程建议

1.  **高度自治与防御性设计**：文档体系设计反映出强大的 AI 工程化思维。各种规范（如单写者模式、Reconciliation Delta 机制）都是为了防范大模型或人类开发者在重构时破坏稳定的业务事实。
2.  **强制的状态分离**：静态事实（`00-14`）、动态执行（`work-packages/`）和历史证据（`evidence/`）被严格隔离，极大减少了 AI 的上下文混乱。
3.  **文档即代码 (Docs as Code)**：结合 `docs-doctor.ts` 等工具，文档质量门禁（Quality Gates）和前置信息被纳入了强校验体系。文档不仅是给人看的，更是机器和 Agent 可解析的 IR（中间表示）。

**结论**：当前的 Markdown 文档体系状态极其完备，完全契合了敏捷开发、AI Agent 自主工作与深度工程治理的最佳实践。没有任何多余的“垃圾文件”，每一个文档或目录都有其严格的声明周期与不可替代的职责。
