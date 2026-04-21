# 工程编译器实施计划与路线图

> 说明：沿用原文件名，但本稿已从“MVP 排期”扩展为连续路线图。它既给开发者看，也给 AI/Agent 看，用于决定从当前到终局的阶段推进顺序。

## 路线总原则

- 永远优先证明“规格 -> 装配 -> slot -> 验收 -> 来源追踪”主链，而不是追逐更多功能点。
- 每个阶段都必须同时回答五个问题：
  - 新增了什么上游输入
  - 新增了什么编译能力
  - 新增了什么验证能力
  - 新增了什么团队协作能力
  - 新增了什么 AI 可自主承担的职责
- 每个阶段都有明确退出条件；未达成退出条件前，不跨阶段扩范围。

## 阶段 A：文档与规格冻结

### 目标

- 把口语化讨论压缩成权威规格。
- 冻结 `v0.1` 母例、技术栈、三块、单槽位、三类核心文件。
- 写清终局方向，避免实现时误把系统做成增强版 vibecoding。

### 输出物

- [01-用户能力模块化开发-主题整理稿.md](D:\Project\pjc\docs\01-用户能力模块化开发-主题整理稿.md)
- [02-工程编译器-MVP-PRD与架构稿.md](D:\Project\pjc\docs\02-工程编译器-MVP-PRD与架构稿.md)
- [03-MVP实施计划与路线图.md](D:\Project\pjc\docs\03-MVP实施计划与路线图.md)
- [04-AI自主实现执行蓝图.md](D:\Project\pjc\docs\04-AI自主实现执行蓝图.md)
- [05-编译器核心实现规格.md](D:\Project\pjc\docs\05-编译器核心实现规格.md)
- [06-Registry与Block协议规范.md](D:\Project\pjc\docs\06-Registry与Block协议规范.md)
- [07-Pass状态机、错误码与恢复机制.md](D:\Project\pjc\docs\07-Pass状态机、错误码与恢复机制.md)
- [08-Verification、Provenance与Graph规范.md](D:\Project\pjc\docs\08-Verification、Provenance与Graph规范.md)
- [09-AI Runtime、任务信封与治理规范.md](D:\Project\pjc\docs\09-AI Runtime、任务信封与治理规范.md)
- [10-升级迁移与Override规范.md](D:\Project\pjc\docs\10-升级迁移与Override规范.md)

### 退出条件

- 四份文档对技术栈、母例、阶段目标、块边界、AI 写入边界描述一致。
- `app.plan.yaml`、`block.manifest.yaml`、`graph.lock.json` 已冻结为可编码接口。

### 风险

- 如果文档混合愿景、事实和实现细节，会再次变成对话纪要。

## 阶段 B：v0.1 首条闭环

### 目标

- 在单栈、单母例、三块、单槽位条件下，跑通第一条可信闭环。

### 子阶段

#### B1：规格与编译骨架

- 实现：
  - `app.plan.yaml` parser
  - `block.manifest.yaml` parser
  - `graph.lock.json` 生成
  - resolver 最小规则
  - composer 骨架
  - CLI 壳命令

#### B2：三个官方块

- 实现：
  - `auth/basic-session`
  - `tenant/basic-workspace`
  - `entity/customer-basic`

#### B3：单槽位 AI 与验收

- 实现：
  - `customer_normalizer` 骨架生成
  - 单槽位 AI 写回
  - `Vitest + Playwright` 主链路

### 退出条件

- 从空目录开始，CLI 能产出可运行项目。
- 三个块来自 registry 安装，不靠手工搬运。
- AI 只能修改 `custom/customer_normalizer.ts`。
- 主验收链路通过。

### AI 可自主承担

- 仅可实现已声明 slot。
- 不参与解析、安装和依赖求解。

### 里程碑

- `M1`：规格冻结并可生成 `graph.lock.json`
- `M2`：三块可被确定性安装
- `M3`：AI 只在单一 slot 生效
- `M4`：端到端验收通过并可重复执行

### 风险

- 过早引入通用 IR、图形界面或多目标栈，会直接破坏闭环验证。

## 阶段 C：v0.2 工程可持续化

### 目标

- 把“能跑一次”升级为“可以反复编译、可升级、可解释”。

### 关键能力

- 引入 `provenance.json`
- 引入 `platform explain`
- 引入 `override` 区与回写建议
- 引入 `platform repair`
- 引入 `Interface Alignment Agent`
- 扩展到 6 到 10 个官方块
- 数据库路线从 `SQLite` 扩展到 `PostgreSQL`
- 评估 `Bun` 作为本地开发/测试加速环境，但不替代 `Node.js` 主基线

### 推荐新增官方块

- `rbac/basic`
- `audit/basic`
- `file/upload`
- `notify/email-basic`
- `export/csv-basic`
- `table/filter-search`

### 退出条件

- 产物中每个 slot、每个安装块都可追溯来源。
- 验收失败时可生成局部修复任务，而不是要求 AI 重写项目。
- 至少一类块升级可通过 `upgrade + verify` 通过。

### AI 可自主承担

- pin/slot 对齐建议
- 局部修复
- override 回写建议
- 升级风险摘要

### 风险

- 如果 provenance 不落地，团队很快失去对 AI 产物的信任。
- 如果升级仍是“一次性脚手架模式”，平台价值会被腰斩。

## 阶段 D：v0.5 团队可用化

### 目标

- 从单人编译器升级为小团队可协同的平台。

### 关键能力

- 私有 registry
- 块版本策略
- policy gate
- acceptance coverage 报告
- review / explanation agent
- 团队使用规范和 CI 模板

### 退出条件

- 团队可在不直接改主干块源码的前提下，共享块、策略和规则。
- CI 中可稳定执行 `resolve -> compose -> adapt -> verify -> lock`。
- 失败构建能给出来源、差异和修复建议。

### AI 可自主承担

- 变更说明生成
- 风险摘要
- 回归影响面说明
- 初步安全和权限检查

### 风险

- 如果没有团队边界和版本策略，私有 registry 会迅速变成另一个源码仓库。

## 阶段 E：v1 平台化

### 目标

- 把系统正式做成团队级工程平台，而不是本地工具集合。

### 关键能力

- Strategy Pack / Infra Pack / Governance Pack 正式化
- acceptance graph
- policy center
- graph explorer
- 双视图工作台
  - Slot / Rule 视图
  - Source 视图
- 托管验证和审计日志
- 官方块库达到后台母体的可用覆盖

### 退出条件

- 一个团队可以只通过规格和少量 slot 维护多个同类项目。
- 大部分样板、策略和治理逻辑由系统确定性装配。
- 人类 review 面积显著低于传统全仓 AI 生成模式。

### AI 可自主承担

- 多 slot 协同综合
- 多模块局部修复
- 验收覆盖缺口提示
- 升级迁移草案

### 风险

- 如果没有图谱和双视图，平台复杂度会重新退回到“看 diff 猜 AI 做了什么”。

## 阶段 F：v2 多目标编译器

### 目标

- 从“单栈平台”升级为“多目标编译器”。

### 关键能力

- 第二后端目标栈
- 更完整的升级/迁移引擎
- marketplace / 受控生态
- 托管编译、托管验证、托管观测
- 运行时集成而非重造 runtime

### 技术路径

- 保守路径：
  - 先完成 `Next.js + Prisma + PostgreSQL`
  - 再补 `Bun` 次级运行支持
  - 再评估 `Nest`
  - 最后再评估 `Elysia`
- 原则：
  - 新目标栈必须能复用 block interface、slot contract、verification contract
  - 不能为了适配新栈破坏已有编译合同

### 退出条件

- 至少两个目标栈可以共享上游 plan 结构和大部分块契约。
- 块升级、迁移和验收可以跨目标栈工作。

### AI 可自主承担

- 迁移计划生成
- 兼容性差异说明
- 目标栈适配 slot 生成

### 风险

- 多栈扩展最容易把系统重新打回“模板拼装器”，所以必须以接口和验证契约为核心。

## 阶段 G：v3 跨领域扩展

### 目标

- 把后台母体扩展到更广的软件工程域，但仍保持“规格优先、块优先、验收优先”。

### 可见方向

- Java / 旧系统现代化
- 内部工具与工作流整合
- LiveOps / 运营后台
- 玩法系统 / 内容管线
- 组织级系统现代化与增量替换

### 进入条件

- `v1` 平台化稳定
- 升级和 provenance 机制成熟
- 块接口和验证体系已被证明可迁移

### AI 可自主承担

- 旧系统映射建议
- 新旧接口桥接
- 迁移顺序规划
- 回归风险分析

### 风险

- 过早切入 Java 或游戏主循环会把平台拖回大量领域特定细节，必须晚于平台核心成熟。

## 阶段 H：终局平台面

### 目标

- 形成完整的工程编译基础设施层。

### 终局能力

- 上游：
  - spec-first authoring
  - block graph editing
  - policy and slot authoring
- 中游：
  - compiler pipeline
  - alignment / synthesize / repair passes
  - upgrade and migration engine
- 下游：
  - repo artifact
  - provenance
  - acceptance and policy reports
  - deploy and observe hooks
- 平台：
  - official + private registry
  - marketplace
  - audit and governance
  - visual graph
  - hosted verification

### 退出条件

- 平台可以稳定支持多个项目、多个团队、多个栈、多个升级周期。
- AI 的主要职责已经收敛为：对齐、综合、修复、迁移、解释，而不是从零写整仓。

## 当前优先级矩阵

### 必须先做

- `v0.1` 闭环
- provenance 预留
- upgrade 入口
- graph / explain 基础能力

### 可以晚做

- marketplace
- 托管运行时
- 第二目标栈
- Java 和游戏扩展

### 现在不要做

- 全领域通吃承诺
- 自由 chat 式整仓生成
- 社区整块自由贡献

## 关键决策门槛

### 什么时候能从 B 进 C

- 首条闭环稳定重复运行
- 单槽位边界未被破坏
- 验收可以稳定裁决成功与失败

### 什么时候能从 C 进 D

- provenance 成型
- upgrade 有第一条通路
- 官方块已形成最小母库

### 什么时候能从 D 进 E

- 团队可在 CI 中稳定使用
- review / explain 与 policy gate 可用

### 什么时候能从 E 进 F

- 单栈平台已证明不是一次性脚手架
- 多项目、多版本、多升级周期都可控

## 总体风险

- 方向风险：
  - 把平台做成模板市场或 Skill 壳
- 范围风险：
  - 在 `v0.1` 前引入多栈、多块、多 slot、多治理
- 信任风险：
  - 没有 provenance、双视图和 acceptance graph
- 生态风险：
  - 官方块未稳定就开放社区整块代码
- 架构风险：
  - 没有 compile contract，导致每加一个目标栈都要推倒重来

## 路线摘要

- 短期看，先证明“工程规格 -> 块安装 -> AI 填 slot -> 通过验收”。
- 中期看，要补齐 provenance、upgrade、graph 和私有 registry，证明这不是一次性脚手架。
- 长期看，目标不是做另一个 runtime，而是做 AI 时代的软件工程编译层。
