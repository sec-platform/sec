# Agent Skill System v2 研究依据与采纳裁决

## 一、证据分类

本设计严格区分：

1. **当前仓库事实**：来自 `main@6cc3bf8a3b655bebf85dfca3f065c9842207c086` 的代码、文档、Skill和合同测试。
2. **历史设计 Evidence**：来自已归档Work Package、旧authority和历史PR/Issue；用于解释路径依赖，不覆盖当前main。
3. **外部一手机制**：Open Agent Skills规范、GitHub Agent Skills/custom agents文档、OpenAI Codex Skills/AGENTS与agent loop说明；用于校准互操作和分层，不成为SEC authority。
4. **本Proposal推导**：基于上述证据的架构裁决、迁移与预测；尚未经过运行时实现和历史回放验证。

## 二、当前仓库事实

### 2.1 Universal router

`AGENTS.md` 当前已经正确收窄为启动与行为路由，明确：

- latest main/live facts优先；
- trusted orientation；
- frozen Work Package/owned paths；
- 一个主Skill；
- canonical docs与dynamic control分离；
- Worker不自授权，A0拥有Gate/merge；
- tree/behavior readback优先于ancestry；
-机器规则必须下沉。

这证明V2不需要把通用不变量重新复制进每个Skill。

### 2.2 Development governance

`docs/development-governance.md` 已区分main、Issue、rolling plan、manifest、Task Envelope、PR、Evidence和未来Journal，也明确Skill只拥有启发式闭包、确定性规则必须进入代码。

它同时说明当前仍默认一个formal active Work Package，V3 resolver已实现但Integration Queue/Run Kernel/Journal未完成。V2因此不能把目标并行、resume或automatic selection写成当前能力。

### 2.3 Agent Skill contract

`platform/shared/agent-skill-contract.ts` 与 `tests/contract/agent-skills.test.ts` 已实现：

- exact 17 Skill inventory；
- fixed frontmatter/sections；
- behavior owner registry；
- Markdown/heuristic surface coverage；
-禁止危险操作和历史路径；
- Skill/test-impact/trust-root关联。

决定性缺陷是合同测试进一步断言Skill数量、behavior数量和owner数量一一相等。这能防orphan，但错误假设“一个自然操作只能对应一个细粒度behavior文件”，导致Role、phase、exception mode和领域workflow同时成为Skill拆分轴。

### 2.4 17个Skill全文审查

审查发现的交叉owner：

- orientation、audit、A0、context均拥有snapshot/reload；
- A0、work-package、worker、review、CI、trust-root均描述candidate/frozen；
- worker、impact、failure、CI均描述Gate selection/reuse/retry；
- A0、Worker、Reviewer和delegation混合Role与workflow；
- trust bootstrap与CI/merge形成平行integration模型；
- context resume用prose模拟未来Run Kernel状态。

领域治理Skill（documentation、toolchain、external capability、heuristic governance）具有更自然的独立permission和output闭包，因此应保留但重构。

## 三、历史 Evidence

### 3.1 Agent Skills and V19 alignment

历史Work Package把Skills从4个扩展到14个，后续演进到17个。其正确目标是：

- 把启发式从文档抽取为AgentOperation；
- 全仓/Markdown机器coverage；
- 确定性规则仍由代码拥有；
- 可验证resume目标不等于恢复隐藏思维。

错误不是初始目标，而是后续把coverage invariant固定为一对一数量等式，缺少Role/Operation/Policy/State分层。

### 3.2 Run Kernel历史设计

历史authority已提出runId、sessionId、worktree分离、Git common-dir state、capsule/event generation和resume fingerprint。这些属于未来Run Kernel/Journal，不应由`sec-context-resume`全文维护。V2只让orientation消费外部checkpoint，等Kernel实现后改为消费typed Journal。

### 3.3 近期工程失败

近期PR/Issue揭示的共同模式：

- dispatch、squash、default-base、Verification aggregate等状态/顺序规则若只存在于多个调用者或prose，会产生连续补丁；
- path/mtime cache、skipped→passed、non-owning environment等规则必须由机器合同拒绝；
- closed Spike与unmerged branch必须由lifecycle/main readback裁决，不能靠Skill文字约定。

这些事实支持“Skill解释机器结果，不重建状态机”的V2方向。

## 四、外部一手机制

### 4.1 Open Agent Skills

开放Agent Skills规范定义：

- Skill是带`SKILL.md`的目录；
- frontmatter metadata用于发现；
-正文只在激活时加载；
-可包含`scripts/`、`references/`、`assets/`；
-鼓励渐进披露和相对引用；
-`allowed-tools`属于实验性能力。

采纳：

- 目录化Skill；
-精确description；
-渐进披露；
-详细schema/examples/scripts按需加载；
-兼容metadata使用字符串值。

不直接采纳：

- `allowed-tools`作为SEC权限owner。Host支持和Shell/MCP安全边界不稳定，SEC权限必须由Role/Envelope/repository policy交集决定。

### 4.2 GitHub Agent Skills与custom agents

GitHub一手文档把Skills定位为按需工作流知识，把custom agents定位为角色、prompt和工具限制；并强调：

- Skill按domain组织；
-依赖显式；
-独立测试；
-冲突Skill应重组或禁用；
-子Agent不会自动继承父Agent全部Skill/context，需要显式配置。

采纳：

- Role/custom agent与Skill分离；
-每个Role显式Skill allowlist；
-子Agent显式Role/Skill/Envelope绑定；
-冲突Skill不是靠加载顺序解决，而是消除多个Primary owner。

适配：

- SEC不把GitHub custom agent文件路径当永久理论。正式实现时按实际Host能力选择目录，但Role contract保持平台中立。

### 4.3 OpenAI Codex Skills与agent loop

OpenAI一手说明表明Codex把AGENTS/instructions和Skill metadata作为上下文入口，Skills提供可复用workflow/resources/scripts；Codex shell sandbox不自动覆盖MCP等外部工具，外部工具需自己的权限/guardrail。

采纳：

- AGENTS保留universal policy；
- Skill作为按需operation workflow；
-外部Provider/MCP权限由独立capability/permission治理；
-不因Skill声明工具就认为Host已安全授权。

## 五、采纳矩阵

| 机制 | 裁决 | SEC落点 |
|---|---|---|
| metadata发现 + 按需正文 | adopt | Skill frontmatter + Primary Skill |
| references/scripts渐进披露 | adopt | Skill directory resources |
| custom agent角色 | adapt | Role Profile，不与Skill同一对象 |
| 子Agent显式Skills | adopt | orchestration envelope |
| Skill tool allowlist | reject as authority | permission evaluator仅可读取为需求 |
| 多Skill自由组合 | reject | exactly one Primary Skill；顺序operation transition |
| AGENTS完整工作流 | reject | AGENTS只保留universal invariants |
| Skill保存动态phase | reject | Run Journal/operation state owner |
| Skill决定Gate/Impact | reject | deterministic Change Closure/Impact/Verification services |
| domain-oriented governance Skill | adopt | docs/toolchain/capability/agent-system |
| role-oriented Skill | reject | integrator/worker/reviewer/auditor/maintainer profiles |
| exception-mode Skill | adapt | resume→orient mode；trust bootstrap→integrate mode |

## 六、本Proposal推导

以下不是已证实运行结果：

- 11个Skill是当前最佳分解，不是永久固定数量；
- exactly-one-primary将减少冲突和token重复；
- Role/Envelope permission交集将减少自授权风险；
- historical replay将证明旧17有效责任全部覆盖；
- Run Kernel接入后resume会变得确定性且不需要Skill维护phase。

这些判断必须由`evaluation.yaml`、token测量、negative tests和真实任务回放验证。

## 七、尚缺决定性 Evidence

- 当前Codex/GitHub Host对custom agent目录、Skill metadata和experimental fields的精确支持矩阵；
- 旧17与新11在真实SEC任务上的route accuracy、first-pass yield和context tokens；
- 多Agent下Role/Envelope是否能完全阻止隐式权限继承；
- V2 compatibility projection能否在不建立长期双owner的情况下平滑迁移；
- Run Kernel/Task Capsule/Change Closure实际schemas成熟后的接口调整；
- Skill正文最佳长度和references粒度的实测。

任何上述未知都不要求推翻分层原则，但可能改变Skill数量、文件布局、metadata或WP顺序。
