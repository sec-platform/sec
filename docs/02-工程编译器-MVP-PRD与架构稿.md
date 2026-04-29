# 工程编译器 PRD 与架构总稿

> 权威边界：产品定位、架构分层和版本边界以本文为准。实现字段、schema 与协议以 `05-10` 为准。

## 规范栈

## 产品定位

- 产品名建议 `SpecEngineer`，方法论为 `Spec Engineering`；"工程编译器（Engineering Compiler）"是底层品类描述。
- 这不是 IDE、低代码工具、模板市场，也不是自由生成式 AI 结对编程工具。
- 系统的权威输入是工程规格、块接口、连接关系、slot 描述和验收要求；最终源码是可审查、可部署、可修改的编译产物。
- 这套产品不是"让 AI 多写代码"，而是"把 AI 收束为编译链中的受限综合 pass"。
- 终局四层架构：Authoring Layer（规格/图/slot/规则/验收）→ Compilation Layer（解析/对齐/求解/装配/综合/验证/修复/发射）→ Artifact Layer（源码/测试/lock/provenance）→ Platform Layer（registry/升级/治理/观测/托管）

### 核心问题

- 隐性专家劳动 → 结构化规格 → 标准模块 → 管脚连接 → AI 填 slot → 验收验证 → 可持续维护

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
- 生成项目目标栈：`nextjs-ts-prisma-sqlite`（Next.js + TS + React + Tailwind + Prisma + SQLite + Vitest + Playwright）
- Bun 是可选本地执行/测试加速路径，非主规范运行时
- 详见 `05` §0、§0.1

## 版本边界

### v0.1（✅ 已完成）
- 证明首条闭环：开发者写 `source/app.yaml`，系统解析并安装官方块，AI 填受控 slot，Playwright 验收通过

### v0.2（当前阶段）
- provenance ✅、upgrade/migrate ✅、13 个官方块 ✅、policy gate ✅、repair ✅、override ✅、explain graph ✅、review summary ✅、架构内聚重构 ✅

### v1.x
- 私有 registry、策略/治理块体系化、acceptance graph、CI/CD 集成

### v2.x+
- 多目标编译器、marketplace、托管验证/观测

## 三层世界

### Authoring Layer
`source/app.yaml`、block graph、slot description、acceptance/policy/override spec

### Compilation Layer
`parse → align → resolve → compose → adapt → verify → repair → lock → emit`（详见 `07`）

### Artifact Layer
源码、测试、lock files、provenance、explain graph、governance reports（详见 `08`）

## 模块分类

| 类型 | 说明 | 例 |
| --- | --- | --- |
| Capability Block | 用户可感知功能 | `auth/basic-session`、`entity/customer-basic` |
| Strategy Pack | 非功能策略 | `rbac/basic`、`audit/basic` |
| Infra Pack | 基础设施接入 | `infra/postgres` |
| Governance Pack | 验证/审计/升级治理 | policy gate、acceptance runner |

详见 `06` §2。

## Compile Contract

1. 输入：`source/app.yaml`、block graph、slot descriptions、acceptance spec
2. 可综合部分：adapter、policy rule、局部 UX、repair patch
3. AI 权限：文件可写范围、符号保留、测试通过要求
4. 输出：repo、tests、lockfiles、provenance、deployable artifact
5. 编译成功：依赖解析 + 接口连通 + slot 填充 + acceptance 通过 + policy gate

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
