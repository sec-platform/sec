# 工程编译器 PRD 与架构总稿

> 权威边界：产品定位、架构分层和版本边界以本文为准。实现字段、schema 与协议以 `05-11` 为准。

## 规范栈

## 产品定位

- 产品名建议 `SpecEngineer`，方法论为 `Spec Engineering`；"工程编译器（Engineering Compiler）"是底层品类描述。
- 这不是 IDE、低代码工具、模板市场，也不是自由生成式 AI 结对编程工具。
- 系统的权威输入是工程规格、块接口、连接关系、slot 描述和验收要求；最终源码是可审查、可部署、可修改的编译产物。
- 这套产品不是"让 AI 多写代码"，而是"把 AI 收束为编译链中的受限综合 pass"。
- 当前开发必须以最终形态为目标：v0.x 可以采用文件装载型 block 作为过渡，但所有实现都必须能演进到语义合约型 block、Engineering IR、可解释 Review Workbench。
- **轻量化本地化产品形态**：SpecEngineer 拒绝采用重度云端 SaaS 平台架构，而是通过轻量化的“本地编译器 + 本地 Sidecar”模式运作：
  1. **本地命令行 CLI 编译器 (`@spec-engineer/cli`)**：作为主执行入口，直接运行在开发者本地或 CI Runner 容器中。
  2. **本地 Review 工作台 (Local Workbench)**：运行 `se workbench` 在本地 `127.0.0.1` 启动 Web UI，直接以本地的 `explain-graph.json` 和 `provenance.json` 为数据源，进行双向回写和失败 Trace 审计，不上传代码至云端。
  3. **本地 MCP 服务 (Local MCP Server)**：启动本地 `spec-engineer mcp` 后端，为 Claude Code 或 Cursor 等外部 AI 编程助手提供只读的代码结构感知、任务信封和沙盒指令代理。
- **全平台核心架构与服务划分**：
  平台整体划分为以下 4 个有机联动的核心架构和服务组件：
  1. **Sec Platform CLI (编译器/平台核心工具)**：本地开发套件与核心引擎。执行依赖解析（resolve）、单体拼装（compose）、代码综合（adapt）、验证拦截（verify）、状态锁定（lock）与图谱解释（explain），并提供 `sec workbench mutations apply` 将图形画布变动回写入主规格事实源 `source/app.yaml`。
  2. **Visual Spec Builder & Workbench UI (画布服务与工作台)**：浏览器端多语言交互式 Spec 画布与工作区（通过 Vis.js/React Flow 渲染视图及 EJS 模板提供本地 Web 伺服）。负责直观展示系统各模块的管脚连接、依赖拓扑及策略规则覆盖。用户在画布上进行的 Block 卡片增删或 Slot 连线操作会被实时捕获并生成 Mutations JSON 片段。
  3. **Runtime Web & API Services (运行期微服务群)**：最终发射出的多目标分布式运行时。当编译器将 target 设置为 `microservices` 时，强内聚的单体应用将被自动降级（Lowering）派发为多个正交的 Next.js API 微服务容器（如 Auth、Tenant、Ticket 和协作 Hub），并在内部调用点物理织入带有熔断三态转换（Circuit Breaker）与指数退避重试（Exponential Backoff Retry）的 RPC 客户端韧性桩代理，防止雪崩。
  4. **AI Agent Harness & Executor (治理与执行沙盒)**：分布式治理与自动流转微服务。包含 Event 信封机制、安全沙盒隔离策略与 Mock-LLM 决策链，负责常驻后台监听工单创建事件并运行自动化打标、分类与高情商评论，同时严密拦截越权与数据溢出。
- 终局五层架构：Authoring Layer（规格/图/slot/规则/验收）→ Semantic Contract Layer（block 语义合约、capability、pin、policy、view/entity/operation IR）→ Compilation Layer（解析/对齐/求解/装配/综合/验证/修复/发射）→ Artifact Layer（源码/测试/lock/provenance）→ Review/Platform Layer（Workbench、registry、升级、治理、观测、托管）

### 核心问题

- 隐性专家劳动 → 结构化规格 → 语义合约型标准模块 → 管脚连接 → Engineering IR → AI 填 slot/局部综合 → 验收验证 → 可解释 Review Workbench → 可持续维护

### 与相邻物种的边界

| 相邻系统 | 差异 |
| --- | --- |
| 模板/脚手架 | 模板只管初始生成；本产品覆盖组合、验证、来源追踪、升级、override |
| 低代码 | 锁用户在运行时；本产品输出真实源码 |
| AI 编程助手 | 助手面对整仓；本产品要求 AI 先面对结构化规格 |
| SDK/库 | SDK 复用调用点；本产品复用能力块、接口合同、验收协议 |
| n8n/Temporal | 偏运行时编排；本产品在其上的工程编译层 |

## 项目形态适配

- **优先切入**：标准业务后台、B2B SaaS、管理台、工单系统、CRM/ERP 子域、内部工具
- **中期扩展**：产品型 Web/App、平台控制面、AI Agent 应用层
- **谨慎切入**：高性能内核、数据库、编译器后端、实时渲染 → Outer Shell / Hybrid Kernel Mode

## 技术栈分层

- 编译器本体：TypeScript + Node.js + ESM + CLI-first + 文件系统驱动
- 生成项目目标栈：`nextjs-ts-prisma-sqlite`（Next.js + TS + React + Tailwind + Prisma + SQLite + Bun/Node tests + Playwright）
- Bun 是仓库脚本与测试入口的固定执行器；生成运行时的浏览器验收边界由 Playwright 承担
- 详见 `05` §0、§0.1

## 版本边界

### v0.1（✅ 已完成）
- 证明首条闭环：开发者写 `source/app.yaml`，系统解析并安装官方块，AI 填受控 slot，Playwright 验收通过

### v0.2（当前阶段）
- provenance ✅、upgrade/migrate ✅、16 个官方块 ✅、policy gate ✅、repair ✅、override ✅、explain graph ✅、review summary ✅、架构内聚重构 ✅
- 补齐 review workbench 与 graph visualization 的只读操作面，避免治理产物只停留在 JSON/CLI。

### v0.3
- 在保持 v0.2 文件装载能力的同时，引入语义合约型 block 的最小闭环：entity/operation/policy/view 合约先进入 Engineering IR，再降级生成文件、测试和验证产物。
- 新增 generator 类安装策略必须按工程动作扩展，不允许按业务 block hardcode。

### v1.x
- 私有 registry、策略/治理块体系化、acceptance graph、CI/CD 集成、Workbench review dashboard、语义合约 registry。

### v2.x+
- 多目标编译器、marketplace、托管验证/观测、多栈代码生成、远程 registry、交互式 Workbench。

## 五层世界

### Authoring Layer
`source/app.yaml`、block graph、slot description、acceptance/policy/override spec

### Semantic Contract Layer
block 不只是文件包，而是语义合约入口。v0.x 允许 `installs` 作为低级 escape hatch；最终形态要求 block 能声明 entity、operation、policy、view、event、permission、pin、slot，并被降级为 Engineering IR。

### Compilation Layer
`parse → align → resolve → compose → adapt → verify → repair → lock → emit`（详见 `07`）。pass 操作的目标应逐步从文件清单升级为 Engineering IR，再生成项目文件。

### Artifact Layer
源码、测试、lock files、provenance、explain graph、governance reports（详见 `08`）

### Review/Workbench Layer
以 `explain-graph.json`、`review-summary.json`、`provenance.json` 为数据源，提供 graph view、review view、Mermaid/DOT 导出和后续交互式操作面，详见 `11`。

## 模块分类

| 类型 | 说明 | 例 |
| --- | --- | --- |
| Capability Block | 用户可感知功能 | `auth/basic-session`、`entity/customer-basic` |
| Strategy Pack | 非功能策略 | `rbac/basic`、`audit/basic` |
| Infra Pack | 基础设施接入 | `infra/postgres` |
| Governance Pack | 验证/审计/升级治理 | policy gate、acceptance runner |

详见 `06` §2。

## Compile Contract

1. 输入：`source/app.yaml`、block graph、slot descriptions、acceptance spec；最终形态还包括 entity/operation/policy/view 等语义合约。
2. 可综合部分：adapter、policy rule、局部 UX、repair patch；最终形态扩展到由 Engineering IR 派生的 service/API/DB/view/test 骨架。
3. AI 权限：文件可写范围、符号保留、测试通过要求。
4. 输出：repo、tests、lockfiles、provenance、deployable artifact、review workbench views。
5. 编译成功：依赖解析 + 接口连通 + pin/slot 合同满足 + acceptance 通过 + policy gate + provenance/review 可解释。

详见 `05` §2、`07`、`08`。

## 相关文档

| 层次 | 文档 |
| --- | --- |
| 概念 | [01](01-用户能力模块化开发-主题整理稿.md) |
| 路线图 | [03](03-MVP实施计划与路线图.md) |
| 实现规格 | [05](05-编译器核心实现规格.md) |
| Block 协议 | [06](06-Registry与Block协议规范.md) |
| Pass 状态机 | [07](07-Pass状态机、错误码与恢复机制.md) |
| 验证与图谱 | [08](08-Verification、Provenance与Graph规范.md) |
| AI Runtime | [09](09-AI Runtime、任务信封与治理规范.md) |
| 升级 Override | [10](10-升级迁移与Override规范.md) |
| Workbench 与可视化 | [11](11-Workbench与可视化规范.md) |
