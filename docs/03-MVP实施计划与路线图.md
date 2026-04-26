# 工程编译器实施计划与路线图

> 说明：沿用原文件名，但本稿已从“MVP 排期”扩展为连续路线图。它既给开发者看，也给 AI/Agent 看，用于决定从当前到终局的阶段推进顺序。
>
> 权威边界：本文只决定阶段目标、里程碑、优先级和进入/退出条件，不直接定义 schema 或实现协议。

## 路线总原则

- 永远优先证明“规格 -> 装配 -> slot -> 验收 -> 来源追踪”主链，而不是追逐更多功能点。
- 每个阶段都必须同时回答五个问题：
  - 新增了什么上游输入
  - 新增了什么编译能力
  - 新增了什么验证能力
  - 新增了什么团队协作能力
  - 新增了什么 AI 可自主承担的职责
- 每个阶段都有明确退出条件；未达成退出条件前，不跨阶段扩范围。

## 当前进度清单（持续维护）

> 本节是当前开发进度的正式记录区。长期阶段顺序仍以本文后续阶段 A-K 为准；每轮开发完成后，应优先更新这里的状态、下一步和阻塞项，避免进度只散落在聊天、任务列表或 git log 中。

### 状态图例

- `done`：已在代码中实现，并有定向验证或主链路验证覆盖。
- `active`：当前优先推进方向，允许被拆成多个小提交。
- `next`：完成 active 后的默认下一批功能切口。
- `later`：已预留但暂不进入当前开发循环。
- `blocked`：需要外部凭据、破坏性操作授权或明确产品决策。

### 当前阶段判断

| 阶段 | 状态 | 依据 |
| --- | --- | --- |
| 阶段 A：文档与规格冻结 | done | `docs/00-10` 已形成分层规格栈，`00` 定义权威顺序。 |
| 阶段 B：v0.1 首条闭环 | done | `init -> resolve -> compose -> adapt -> verify -> lock -> explain` 已可重复运行，Customer Admin 母例、三块、单槽位和验收链路已落地。 |
| 阶段 C：v0.2 工程可持续化 | active | provenance、explain graph、policy gate、repair、upgrade 已具备基础能力，当前重点是把它们从“可用”推进到“可持续维护”。 |
| 阶段 D：v0.5 团队可用化 | next | 需要在 C 稳定后推进私有 registry、review assist、团队 CI 口径和更完整官方块母库。 |
| 阶段 E：v1 平台化 | later | graph explorer、双视图工作台、policy center 和托管验证仍是后续平台面。 |
| 阶段 F-K：多目标、自维护与长期研究线 | later | 必须等单栈平台、升级周期和 provenance 机制稳定后再进入。 |

### 已完成能力

| 能力面 | 当前状态 | 说明 |
| --- | --- | --- |
| CLI 主链 | done | `init/add/resolve/compose/adapt/verify/repair/upgrade/lock/explain` 已有入口，参数边界已严格化。 |
| 官方块母例 | done | `auth/basic-session`、`tenant/basic-workspace`、`entity/customer-basic` 支撑 Customer Admin 闭环。 |
| 单槽位合成 | done | `customer_normalizer` slot 通过 task envelope 限定写入边界。 |
| fast/runtime verification | done | fast lane、runtime lane、policy report、runtime report 和 summary report 已生成结构化结果。 |
| acceptance coverage | done | 验收覆盖可映射 block/slot，支持依赖满足判断。 |
| provenance | done | 安装产物、slot 产物、generated 产物和 override 可进入 `provenance.json`。 |
| explain graph | done | graph 包含 block/capability/slot/file/acceptance/pin/policy/override/repair 节点、policy violation 边、slot 合同升级影响边，以及 repair task 归因边。 |
| review summary | done | 结构化输出 change sources、runtime entries、vertical slices、install impacts、impacted blocks/slots、failure points、regression risks、conflict hints，并暴露 upgrade impact。 |
| repair 基础 | done | verification 失败时可生成 repair plan，并可对 repairable slot 执行受限写回。 |
| upgrade 基础 | done | 支持至少一个官方块升级，包含 migration、override 冲突检测、阻断诊断、verify、lock/provenance 更新和回滚。 |
| migration 类型 | active | 已支持 `file-replace`、`config-rewrite(set/delete)`、`json-array-append/remove`、`json-object-merge`、`text-append`、`text-replace-regex`、`create-directory` 与 `slot-contract-update` 计划迁移；执行型迁移类型继续扩展。 |
| policy gate | done | 支持 official/project policy merge、递归 YAML 加载、安装目标定位和 violation report。 |
| 本地治理产物 | done | `generated/**`、`provenance.json`、`graph.lock.json` 和带导航的本地 HTML 视图是当前稳定治理产物集合。 |

### 当前 active 工作包

1. **升级迁移引擎增强**
   - 状态：active
   - 总目标：
     - 从单一 `file-replace` 升级到更多可控 migration 类型。
     - 让升级从“能跑”进入“能审查、能预检、能回滚边界明确”。
   - 已完成：
     - `config-rewrite` JSON 配置迁移：
       - `set`
       - `delete`
     - `json-array-append/remove` JSON 数组迁移。
     - `json-object-merge` JSON 对象合并迁移。
     - `text-append` 文本追加迁移：
       - 可追加到已有文件。
       - 可创建缺失目标文件。
       - 缺少 `content` 会在 planning 前被 schema 校验阻断。
     - `text-replace-regex` 文本正则替换迁移：
       - 可替换匹配文本。
       - 正则非法会阻断。
       - 未命中目标文本会阻断。
       - dry-run plan 可展示 impact 和 migration summary。
     - `create-directory` 目录创建迁移：
       - 可创建嵌套目标目录。
       - dry-run plan 可展示 impact 和 migration summary。
       - 执行器单测覆盖目录落盘。
     - 官方升级 manifest 中的多迁移类型覆盖。
     - upgrade plan migration 摘要与类型计数。
     - upgrade dry-run 入口。
     - `slot-contract-update` 计划与影响面记录。
     - 迁移 `requiresVerification` 到 plan/review 的显式传播。
     - 升级迁移 entry schema 校验。
     - slot 合同变化与 explain graph 的连接。
     - upgrade plan 到本地视图的摘要呈现。
     - upgrade plan 执行前检查清单。
     - 升级检查结果在 review/local view 中的聚合。
     - 升级前置检查失败的结构化诊断 artifact。
     - 升级诊断在 review/local view 中的聚合。
     - upgrade diagnostics 进入 lock/provenance 产物清单。
     - CLI `upgrade --dry-run --json` 可输出机器可解析 plan，供团队 CI 直接消费。
   - 当前阶段拆分：
     - 阶段 1：扩 migration 类型。
     - 阶段 2：补 migration 预检与阻断口径。
     - 阶段 3：补 migration 后 explain/review 可见性。
   - 连续功能切口：
     - 切口 A：新增文件系统类 migration：
       - create-directory：
         - 状态：done。
         - 执行：创建嵌套目标目录。
         - plan：dry-run 记录目录 impact。
       - delete-file：
         - 状态：next。
         - 执行：删除目标文件。
         - preflight：目标必须存在且必须是文件。
       - rename-file：
         - 状态：later。
         - 执行：移动或重命名目标文件。
         - preflight：源文件存在且目标路径未占用。
     - 切口 B：新增文本结构类 migration：
       - text-append：
         - 状态：done。
         - 执行：追加文本并创建缺失目标文件。
         - 校验：缺少 `content` 时阻断。
       - text-replace-regex：
         - 状态：done。
         - 执行：正则替换匹配文本。
         - 校验：缺少 `pattern` / `replacement` 时阻断。
         - 运行时安全：正则非法或未命中目标文本时阻断。
       - 多目标 patch bundle：
         - 状态：later。
     - 切口 C：新增 migration preflight：
       - 目标文件存在性检查。
       - schema/JSON 结构检查。
       - slot 合同前后兼容性检查。
     - 切口 D：把每类 migration 的影响面写入：
       - review summary。
       - explain graph。
       - local views。
   - 每个切口的验证口径：
     - 单测覆盖新增 migration 执行器。
     - `upgrade.test.ts` 覆盖成功/阻断/回滚口径。
     - 必要时跑主链 `verify -> lock -> explain`。
   - 完成定义：
     - 新 migration 类型可声明、可执行、可 dry-run。
     - 失败能结构化暴露到 diagnostics/review。
     - explain/view 能看到迁移影响面。

2. **repair 从基础可用到可审查**
   - 状态：active
   - 总目标：
     - 让 repair plan 更准确地区分 failure 类型：
       - slot failure
       - spec failure
       - kernel failure
     - 输出更清楚的可修复边界。
     - 让 repair 的可执行性与不可执行原因都可审查。
   - 已完成：
     - 结构化 failure points。
     - repairable 标记。
     - 失败点到 acceptance/policy/runtime 目标的映射。
     - 本地视图中的 slot 写入边界展示。
     - 无可修 slot 的阻断错误。
     - repair plan provenance/review 暴露。
     - repair plan 到本地视图的摘要呈现。
     - repair task 与 explain graph 的连接。
     - repair 后自动要求重新 verify 的显式状态。
     - repair plan dry-run 模式。
     - repair plan 的执行前差异预览。
   - 当前阶段拆分：
     - 阶段 1：细化 failure point 归因。
     - 阶段 2：细化 repair task 生成边界。
     - 阶段 3：细化 repair 后验证追踪。
   - 连续功能切口：
     - 切口 A：把 failure point 归因到更细粒度目标：
       - generated file。
       - slot target。
       - acceptance case。
       - policy target。
     - 切口 B：把 repair task 拆成明确类别：
       - slot rewrite。
       - config repair。
       - generated artifact refresh。
     - 切口 C：补 repair 阻断解释：
       - 为什么不可修。
       - 哪个边界阻止修复。
       - 需要人工决策的点。
     - 切口 D：补 repair 前后 diff/verify trace：
       - preview。
       - applied result。
       - verify pending state。
   - 每个切口的验证口径：
     - `review-repair-summary.test.ts`。
     - `pipeline.test.ts`。
     - 针对 repair plan/local view 的定向测试。
   - 完成定义：
     - repair plan 不仅能生成，还能说明：
       - 修什么。
       - 为什么修。
       - 为什么不能修。
       - 修后还需验证什么。

3. **计划与进度显式化**
   - 状态：active
   - 总目标：
     - 把未来计划和当前进度固定在 repo 文档中。
     - 避免进度只散落在：
       - 会话上下文
       - 临时任务列表
       - git log
     - 让后续开发不是“找下一步”，而是“沿清单连续推进”。
   - 已完成：
     - 本文新增正式进度清单。
     - 本地 Source View 与 Slot / Rule View 已有互相跳转导航。
     - runtime scaffold 与 project base 的超长单行生成模板已改为多行 template literal。
     - 后续收益：
       - 降低局部编辑成本。
       - 降低 review diff 成本。
       - 降低冲突成本。
   - 当前阶段拆分：
     - 阶段 1：把 active/next 工作包列表化。
     - 阶段 2：把每个工作包继续拆到切口级。
     - 阶段 3：把每轮提交反映回路线图。
   - 连续功能切口：
     - 切口 A：给每个 active 工作包补：
       - 当前阶段。
       - 连续切口。
       - 验证口径。
       - 完成定义。
     - 切口 B：给每个 next 工作包补：
       - 进入条件。
       - 默认顺序。
       - 不做前提。
     - 切口 C：同步 README/入口文档：
       - 当前主链能力。
       - 当前推荐演示块组合。
       - 当前治理产物查看入口。
   - 完成定义：
     - 用户可直接从文档挑下一切口。
     - AI 可不依赖聊天上下文连续推进。
     - 每个大点都有明确的小点序列。

4. **私有 registry 最小通路**
   - 状态：done
   - 总目标：
     - 让 workspace/private registry source 可被用户入口和主链路使用。
     - 与 official registry 共享 manifest/lock/provenance 口径。
   - 已完成：
     - 默认 plan 已包含 workspace private registry source。
     - private block 可通过 CLI/orchestrator 加入：
       - plan。
       - resolve。
       - compose。
       - verify。
       - lock。
       - explain。
     - CLI `add private/...` 会回显：
       - version。
       - registry source。
     - lock/provenance/review/local view 均保留 private registry source 元数据。
   - 当前阶段结论：
     - 基础通路已完成。
     - 当前不把 registry 基础设施继续前置扩张。
   - 退出后默认承接方向：
     - 由 Work Tracking / Ticket SaaS 纵切面继续消费 private registry 能力。
     - 后续在团队阶段再继续扩版本治理与私有块协作规范。

### next 工作包

1. **Work Tracking / Ticket SaaS 纵切面**
   - 状态：active
   - 总目标：
     - 在 Customer Admin 外增加一个 `ticket/basic` 最小纵切面。
     - 让业务块组合不只验证“能装配”，还验证“能协同演进”。
   - 基础业务能力目标：
     - 状态流转。
     - 负责人。
     - 租户隔离。
     - 列表筛选。
     - ticket 附件上传与租户隔离查看。
     - ticket 评论写入与租户隔离查看。
     - ticket 到期日与 SLA 汇总。
     - ticket 工时记录与租户隔离查看。
   - 已完成：
     - 新增 `ticket/basic` 官方块：
       - ticket 服务。
       - Prisma 片段。
       - unit/acceptance 验证。
       - 状态流转。
       - 负责人筛选。
       - 租户隔离。
     - 扩展块组合可安装并通过 verify。
     - Postgres contract 已覆盖 `tickets` 表。
     - runtime scaffold 已生成：
       - `/tickets` 页面。
       - ticket API。
       - 状态流转 API。
       - 表单组件。
       - runtime unit test。
       - Playwright 验收。
     - `audit/basic` 联动：
       - ticket 创建写入 ticket 审计条目。
       - ticket 状态流转写入 ticket 审计条目。
       - `/tickets` 页面展示 ticket 审计条目。
     - `notify/email-basic` 联动：
       - ticket 创建生成 ticket 通知。
       - `/tickets` 页面展示 ticket 通知。
       - 通知模型已从 customer-only 泛化到：
         - `entity`
         - `entityId`
     - `export/csv-basic` 联动：
       - ticket 列表生成 CSV 导出 API。
       - `/tickets` 页面生成 CSV 导出入口。
       - runtime unit/acceptance 已覆盖。
     - 新增 `reporting/ticket-summary` 官方块：
       - 按状态聚合 ticket。
       - 按负责人聚合 ticket。
       - `/tickets` runtime 页面展示 summary。
       - `/api/tickets/summary` 提供 summary JSON API。
       - `/api/tickets/summary/export` 提供 summary CSV 导出。
       - summary JSON / CSV 已支持 assignee + status 联动筛选。
       - 页面 summary 已与当前 assignee + status 筛选结果保持一致。
       - 页面已提供 summary JSON 与 CSV 入口。
     - ticket attachment 已贯通：
       - ticket service 附件写入/读取。
       - `/api/tickets/[ticketId]/attachments`。
       - `/tickets` 页面附件上传表单与列表。
       - runtime unit / acceptance / expanded block / postgres contract 覆盖。
     - ticket comment 已贯通：
       - ticket service 评论写入/读取。
       - `/api/tickets/[ticketId]/comments`。
       - `/tickets` 页面评论表单与列表。
       - runtime unit / acceptance / expanded block / postgres contract 覆盖。
     - ticket SLA/reporting 扩展已贯通：
       - `TicketInput` 支持 `dueDate`。
       - `TicketRecord` 持久化 `dueDate`。
       - `ticket/basic` Prisma 片段包含 `dueDate`。
       - Postgres contract `tickets` 表包含 `due_date`。
       - `reporting/ticket-summary` 输出 SLA 汇总：
         - overdue。
         - dueSoon。
         - unscheduled。
       - `export/csv-basic` ticket CSV 包含 `dueDate`。
       - `export/csv-basic` summary CSV 包含 SLA 行。
       - `/tickets` 页面展示工单到期日。
       - `/tickets` 页面展示 SLA summary。
       - runtime unit / acceptance / expanded block / pipeline 覆盖。
     - `worklog/basic` 已贯通：
       - 新增 `worklog/basic` 官方块。
       - `WorklogInput` 支持：
         - `ticketId`。
         - `minutes`。
         - `note`。
       - `WorklogRecord` 持久化：
         - `tenantId`。
         - `authorId`。
         - `createdAt`。
       - worklog service 支持：
         - 记录工时。
         - 按 ticket 读取工时。
         - 汇总 ticket 工时分钟数。
         - 跨租户 ticket 访问阻断。
       - Prisma 片段新增 `Worklog` 模型。
       - Postgres contract 新增 `worklogs` 表。
       - runtime scaffold 生成：
         - `/api/tickets/[ticketId]/worklogs`。
         - `TicketWorklogForm`。
         - `/tickets` 页面工时表单。
         - `/tickets` 页面工时列表。
         - `/tickets` 页面总工时分钟数。
       - runtime unit / acceptance / expanded block 覆盖。
     - Source View 已显式列出 generated runtime 页面/API 入口：
       - 便于审查 ticket export 等组合产物。
     - review summary 已显式聚合 ticket runtime attribution：
       - runtime entries。
       - vertical slices。
       - change sources 中的 related blocks。
     - explain graph 已显式连接 ticket runtime route 到相关 block：
       - `ticket/basic`。
       - `reporting/ticket-summary`。
       - `export/csv-basic`。
     - local views 已新增团队协作摘要卡片：
       - vertical summary。
       - block combination summary。
       - failure focus。
       - review runtime attribution。
     - ticket/worklog policy gate 覆盖已贯通：
       - `tenant-scope-required` 覆盖 `ticket/basic`。
       - `tenant-scope-required` 覆盖 `worklog/basic`。
       - policy targets 可定位：
         - `src/installed/entity/customer-service.ts`。
         - `src/installed/ticket/ticket-service.ts`。
         - `src/installed/worklog/worklog-service.ts`。
       - 租户检查从 customer 专用扩展为通用 tenantId 比较模式。
       - 移除 ticket service tenant context 时 policy gate 会失败。
    - ticket + override 治理组合已贯通：
      - `app/tickets/page.tsx` manual override 可覆盖 generated runtime 页面。
      - override provenance 记录：
        - `originType: override`。
        - `overrideStatus: manual`。
      - review summary change source 可显示：
        - `runtimeKind: page`。
        - `vertical: ticket`。
        - `relatedBlocks` 包含 `reporting/ticket-summary`、`ticket/basic`、`worklog/basic`。
      - review summary regression risk 可把 runtime override 反推到核心 block。
      - override conflict hints 可显示 ticket/worklog 相关冲突。
      - explain graph 保留 `file:app/tickets/page.tsx -> override:*` 的 `originates_from` 边。
      - reporting-only 组合不再生成依赖 `export/csv-basic` 的 summary CSV route。
    - ticket + upgrade 治理组合已贯通：
      - 新增 `ticket/basic@0.1.1` 官方升级目标。
      - 升级迁移包含：
        - `file-replace` 刷新 ticket service。
        - `json-array-append` 记录升级元数据。
      - ticket service 0.1.1 暴露 `TICKET_BLOCK_VERSION`。
      - upgrade plan 可显示：
        - migration kind counts。
        - preflight checks。
        - impacted files。
      - review summary 可显示：
        - `upgrade-plan-present`。
        - `upgrade-impact`。
      - explain graph 保留 ticket runtime page 到 `ticket/basic` 的 `writes_to` 归因边。
   - 当前阶段拆分：
     - 阶段 1：业务 CRUD 与 runtime host。
     - 阶段 2：横切治理联动。
     - 阶段 3：review/explain 团队协作面。
   - 连续功能切口：
     - 切口 A：补 reporting 继续细化：
       - summary API。
       - summary export。
       - summary explain 归因。
     - 切口 B：补 review/explain 联动：
       - review summary 中显式显示 ticket vertical 相关 generated artifacts。
       - explain graph 中显式连接 reporting/export/runtime route。
       - local view 中显示 ticket vertical 组合摘要。
     - 切口 C：补更强业务块：
       - `worklog/basic`。
       - ticket comment。
       - ticket SLA/reporting 扩展。
     - 切口 D：补更强治理组合验证：
       - ticket + override。
       - ticket + upgrade。
       - ticket + policy gate。
   - 默认执行顺序：
     - 已完成切口 B。
     - 已完成切口 A。
     - 已完成切口 C：
       - ticket attachment。
       - ticket comment。
       - ticket SLA/reporting 扩展。
       - `worklog/basic`。
     - 当前进入切口 D：
       - 已完成 ticket + policy gate。
       - 已完成 ticket + override。
       - 已完成 ticket + upgrade。
       - 后续转向更细 migration 类型和团队 CI 消费口径。
   - 每个切口的验证口径：
     - `expanded-blocks.test.ts`。
     - runtime unit。
     - runtime acceptance。
     - explain/review/local view 定向断言。
   - 完成定义：
     - ticket vertical 不只可运行。
     - ticket vertical 的业务块与治理块组合可被解释、可被审查、可被升级。

3. **review / explain 面向团队协作增强**
   - 状态：next
   - 总目标：
     - 让 review summary 更接近团队 review 入口。
     - 不只输出机器 JSON。
   - 当前阶段拆分：
     - 阶段 1：补结构化 review 信息。
     - 阶段 2：补团队阅读友好的视图摘要。
     - 阶段 3：补 CI/artifact 消费口径。
   - 连续功能切口：
     - 切口 A：review summary 扩展：
       - generated runtime entries 摘要。
       - vertical/block 组合摘要。
       - install plan 影响摘要。
       - 当前已完成：
         - runtime entries。
         - vertical slices。
         - install impacts。
     - 切口 B：explain graph 扩展：
       - runtime route 到 block 的可视连接。
       - generated API/page 到来源 block 的显式归因。
       - reporting/export 等横切能力的组合边。
     - 切口 C：local views 扩展：
       - 增加 vertical summary 卡片。
       - 增加 block combination 卡片。
       - 增加 failure focus 卡片。
     - 切口 D：CI 消费口径：
       - 让 review summary 中的关键字段稳定可解析。
       - 补对应测试夹具与快照。
   - 进入条件：
     - ticket vertical 已有至少一个 reporting/export 联动示例。
     - explain/local view 已能显示 runtime entry points。
   - 退出条件：
     - 以下信息能稳定聚合：
       - 失败点。
       - 覆盖缺口。
       - upgrade 冲突。
       - repair 冲突。
       - override 冲突。
       - vertical 组合产物摘要。
     - 可被 CI artifact 消费。

### 暂不推进

- 第二后端目标栈、Java、Elysia、游戏/LiveOps 扩展。
- marketplace、托管运行时、托管验证平台。
- 无约束自维护或核心 compiler pass 自改写。

## 新增整合：全局决策框架

### 现在必须决定

- `v0.1` 仍以当前 Customer Admin 母例为实现目标，不在首条闭环前切换到 ticket/work-tracking。
- 权威输入必须是 `app.plan.yaml`、`block.manifest.yaml`、`graph.lock.json`、slot、acceptance、policy 和 provenance，而不是聊天记录或生成源码。
- AI 只能作为受控 pass：`Align`、`Synthesize`、`Repair`，不能成为全仓主控制器。
- 真实源码必须落地，不能只保留 UX 映射或虚拟描述；源码是可审查、可部署、可调试的编译产物。
- `v0.1` 必须先证明 `resolve -> compose -> adapt -> verify -> lock` 的重复闭环。

### 现在不用实现但必须预留

- `ticket/basic` 或 work-tracking 行业母例，作为 `v0.2+` 更强 demo。
- `Kernel Block`、冷热路径、性能预算和 benchmark harness，用于未来高性能/底层系统接入。
- `provenance.json`、`explain-graph.json`、`acceptance coverage graph` 和 `policy gate` 的正式字段。
- upgrade / override 冲突分析、rule-backed override、迁移计划和回滚路径。
- 私有 registry、团队 CI、托管验证、双视图工作台和权限审计。
- 自举与自维护路径：先让系统描述和生成外围，再逐步接管 block、spec、验收和平台工具，而不是直接自改核心编译器。

### 现在明确不做

- 不做自由 chat 式整仓生成器。
- 不做全领域通吃承诺。
- 不做社区随意贡献整块代码的开放 marketplace。
- 不做多语言、多后端、多运行时并行扩张。
- 不把 Bun、Java、游戏、实时系统或底层 runtime 提前变成主线。
- 不让 AI 修改 plan、manifest、lock、registry block 源、generated 产物或未授权路径。

### 晚想会导致返工

- 如果不先冻结 compile contract，后续多栈、多块和升级都会退化成模板拼接。
- 如果不先设计 provenance 和 graph，团队 review 会退回“看 diff 猜 AI 做了什么”。
- 如果不先定义 override 与升级优先级，人工修改会在下一次 compose/upgrade 中丢失或冲突不可控。
- 如果不先区分冷/温/热路径，系统会错误承诺生成性能关键内核。
- 如果不先规定 AI 任务信封和写入边界，平台会退化成普通 Agent 自动改仓库。

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

- 把“能跑一次”升级为“可以反复编译、可升级、可解释、可审查”。
- 把主链从单一母例验证，推进到业务块与治理块组合验证。
- 把 AI 从“只会生成”推进到“会解释、会定位、会局部修复”。

### 进入条件

- 阶段 B 闭环已稳定重复运行。
- `resolve -> compose -> adapt -> verify -> lock -> explain` 已具备基础可用版本。
- Customer Admin 母例已能作为回归基线。

### 当前阶段拆分

- C1：补齐 provenance、review、explain 的细粒度归因。
- C2：把 repair、upgrade 从“能出结果”推进到“能审查边界与失败原因”。
- C3：把官方块矩阵扩到业务块与治理块组合。
- C4：补齐 `PostgreSQL` contract 与本地治理产物基线。

### 连续功能切口

- 切口 A：增强 explain/review/local view 归因：
  - policy 节点、pin 节点、override 节点口径统一。
  - generated runtime route 到来源 block 的显式连接。
  - vertical 级组合摘要。
- 切口 B：增强 upgrade：
  - 新 migration 类型。
  - preflight 阻断。
  - diagnostics/review/explain 聚合。
- 切口 C：增强 repair：
  - failure point 到 file/slot/acceptance/policy 的细映射。
  - repair task 分类。
  - repair 前后 diff 与 verify trace。
- 切口 D：增强 Work Tracking / Ticket 母例：
  - `ticket/basic`。
  - `reporting/ticket-summary`。
  - `audit/basic`。
  - `notify/email-basic`。
  - `export/csv-basic`。
  - `rbac/basic`。
  - `table/filter-search`。
  - `file/upload`。
  - `infra/postgres`。
- 切口 E：增强 policy / acceptance / override 联动：
  - policy violation 归因。
  - acceptance coverage 缺口聚合。
  - override 冲突与 upgrade 冲突并列呈现。

### 推荐新增官方块

- P0：当前已进入主线组合的块：
  - `ticket/basic`
  - `reporting/ticket-summary`
  - `audit/basic`
  - `notify/email-basic`
  - `export/csv-basic`
- P1：当前治理与交互增强块：
  - `rbac/basic`
  - `table/filter-search`
  - `file/upload`
  - `infra/postgres`
- P2：下一批业务增强块：
  - `worklog/basic`
  - ticket comment/attachment
  - ticket SLA/reporting 扩展

### 母例演进

- 基线母例：Customer Admin 继续作为最小闭环回归基线。
- 当前扩展母例：Work Tracking / Ticket SaaS 最小纵切面。
- 下一阶段演示母例：
  - ticket + governance 组合 demo。
  - ticket + private registry + override + upgrade demo。

### 默认执行顺序

- 先完成切口 A：把 explain/review/local view 归因补全。
- 再完成切口 B、C：把 upgrade/repair 补到可审查。
- 然后推进切口 D：持续扩 ticket vertical。
- 最后推进切口 E：把 governance 联动收束到统一口径。

### 验证口径

- 主测：
  - `tests/pipeline.test.ts`
  - `tests/explain-graph.test.ts`
  - `tests/review-summary.test.ts`
  - `tests/repair.test.ts`
  - `tests/upgrade.test.ts`
- 组合测：
  - `tests/expanded-blocks.test.ts`
  - `tests/override-manifest.test.ts`
  - `tests/policy.test.ts`
- 主链回归：
  - `verify -> lock -> explain`

### 退出条件

- 产物中每个 slot、每个安装块、每个关键 generated file 都可追溯来源。
- repair 失败时能说明：
  - 为什么不可修。
  - 哪个边界阻断修复。
  - 下一步应由谁决策。
- 至少一类块升级可稳定通过 `upgrade + verify + lock + explain`。
- ticket vertical 与治理块组合后，仍能稳定通过回归与解释产物检查。

### AI 可自主承担

- pin/slot 对齐建议。
- 局部 repair patch。
- override 回写建议。
- 升级风险摘要。
- review/local view 摘要生成。

### 风险

- 如果 provenance、review、graph 口径不统一，团队会失去对 AI 产物的信任。
- 如果 upgrade/repair 仍停留在“脚手架式一次性输出”，平台价值会被腰斩。
- 如果 ticket vertical 只有业务功能、没有治理归因，后续团队演示会缺乏说服力。

## 阶段 D：v0.5 团队可用化

### 目标

- 从单人编译器升级为小团队可协同的平台。
- 让团队能够共享 block、policy、验收与升级资产，而不是复制源码仓库。

### 进入条件

- 阶段 C 的 explain、repair、upgrade、policy 基线稳定。
- 官方块组合已能覆盖至少一个业务纵切面和多个治理横切面。

### 当前阶段拆分

- D1：私有 registry 与命名空间通路。
- D2：块版本策略与升级矩阵。
- D3：团队 CI 模板与 artifact 合同。
- D4：review assist 与治理使用规范。

### 连续功能切口

- 切口 A：私有 registry：
  - workspace source。
  - private block 解析与安装。
  - 来源元数据保留。
- 切口 B：版本治理：
  - block version 约束。
  - upgrade lane 约束。
  - 版本冲突摘要。
- 切口 C：团队 CI：
  - 标准命令序列。
  - artifact 上传清单。
  - 失败时 review/explain 产物暴露。
- 切口 D：团队审查：
  - review summary 稳定字段。
  - policy gate 默认规则。
  - override/repair/upgrade 审批点。

### 默认执行顺序

- 先做切口 A，稳定私有来源。
- 再做切口 B，把版本与升级口径固定。
- 然后做切口 C、D，把团队协作路径跑通。

### 验证口径

- `tests/private-registry.test.ts`
- `tests/cli.test.ts`
- `tests/pipeline.test.ts`
- 团队 CI 样板项目的定向回归。

### 退出条件

- 团队可在不直接改主干块源码的前提下，共享块、策略、验收与规则。
- CI 中可稳定执行 `resolve -> compose -> adapt -> verify -> lock -> explain`。
- 失败构建能给出来源、差异、阻断点和修复建议。
- review/explain 产物可被团队成员在不读全量源码的前提下消费。

### AI 可自主承担

- 变更说明生成。
- 风险摘要。
- 回归影响面说明。
- 初步安全和权限检查。
- 私有块接入建议。

### 风险

- 如果没有团队边界和版本策略，私有 registry 会迅速退化成另一个源码仓库。
- 如果 CI artifact 口径不稳定，团队 review 仍会回到看 diff 的低效模式。

## 阶段 E：v1 平台化

### 目标

- 把系统正式做成团队级工程平台，而不是本地工具集合。
- 让规格、图谱、验证、治理、升级成为统一工作台的一部分。

### 进入条件

- 阶段 D 已跑通团队级私有 registry、CI、review 与 policy 基线。
- 官方块库已覆盖后台母体常见场景。

### 当前阶段拆分

- E1：Strategy Pack / Infra Pack / Governance Pack 正式化。
- E2：graph explorer 与双视图工作台。
- E3：policy center 与托管验证。
- E4：官方块库覆盖与运营口径。

### 连续功能切口

- 切口 A：平台包：
  - Strategy Pack。
  - Infra Pack。
  - Governance Pack。
- 切口 B：图谱工作台：
  - acceptance graph。
  - explain graph explorer。
  - Source / Slot Rule 双视图。
- 切口 C：治理中心：
  - policy center。
  - 托管验证。
  - 审计日志。
- 切口 D：块生态：
  - 官方块覆盖矩阵。
  - 生命周期状态。
  - 使用建议与风险标签。

### 默认执行顺序

- 先做切口 A，稳定平台包边界。
- 再做切口 B，建立统一浏览与审查入口。
- 然后做切口 C、D，补齐治理和生态面。

### 验证口径

- 平台演示仓回归。
- graph/explain/review 产物一致性检查。
- 多项目共享 pack 的组合验证。

### 退出条件

- 一个团队可以只通过规格和少量 slot 维护多个同类项目。
- 大部分样板、策略和治理逻辑由系统确定性装配。
- 人类 review 面积显著低于传统全仓 AI 生成模式。
- 图谱、策略、验证、升级都能在统一平台面被查看和追踪。

### AI 可自主承担

- 多 slot 协同综合。
- 多模块局部修复。
- 验收覆盖缺口提示。
- 升级迁移草案。
- 平台包接入建议。

### 风险

- 如果没有图谱和双视图，平台复杂度会重新退回到“看 diff 猜 AI 做了什么”。
- 如果平台包边界不清，最终会重新退化成源码模板集合。

## 阶段 F：v2 多目标编译器

### 目标

- 从“单栈平台”升级为“多目标编译器”。
- 在不破坏现有 block/slot/verification 合同的前提下，支持第二目标栈。

### 进入条件

- 阶段 E 的单栈平台已证明可持续升级、可多项目复用、可团队协同。
- 升级、repair、provenance、policy 在单栈下已稳定。

### 关键能力

- 第二后端目标栈。
- 更完整的升级/迁移引擎。
- marketplace / 受控生态。
- 托管编译、托管验证、托管观测。
- 运行时集成而非重造 runtime。

### 技术路径

- 保守路径：
  - 先完成 `Next.js + Prisma + PostgreSQL`。
  - 再补 `Bun` 次级运行支持。
  - 再评估 `Nest`。
  - 最后再评估 `Elysia`。
- 不变原则：
  - 新目标栈必须能复用 block interface、slot contract、verification contract。
  - 不能为了适配新栈破坏已有编译合同。
  - 不能用“新模板体系”绕过现有 graph/provenance/repair/upgrade 口径。

### 连续功能切口

- 切口 A：单栈巩固：
  - `PostgreSQL` 主基线。
  - upgrade/repair 跨版本稳定。
- 切口 B：第二目标栈试点：
  - 最小 block install。
  - 最小 slot contract。
  - 最小 verification lane。
- 切口 C：跨栈治理：
  - 跨栈 provenance。
  - 跨栈 explain。
  - 跨栈 acceptance 报告。
- 切口 D：托管能力：
  - 托管编译。
  - 托管验证。
  - 托管观测。

### 默认执行顺序

- 先完成切口 A。
- 再进入切口 B。
- 跨栈验证稳定后再进入切口 C、D。

### 验证口径

- 至少两个目标栈共享同一 plan 结构。
- 同一块契约在不同目标栈下有一致的安装/验证结果。
- upgrade/repair/report 在两个目标栈下都可运行。

### 退出条件

- 至少两个目标栈可以共享上游 plan 结构和大部分块契约。
- 块升级、迁移和验收可以跨目标栈工作。
- 团队不需要维护两套完全割裂的 block 与治理体系。

### AI 可自主承担

- 迁移计划生成。
- 兼容性差异说明。
- 目标栈适配 slot 生成。
- 跨栈风险摘要。

### 风险

- 多栈扩展最容易把系统重新打回“模板拼装器”，所以必须以接口和验证契约为核心。
- 如果先做第二栈、后补 contract，会导致首栈和次栈都难以维护。

## 阶段 G：v3 跨领域扩展

### 目标

- 把后台母体扩展到更广的软件工程域，但仍保持“规格优先、块优先、验收优先”。
- 让平台具备跨领域迁移与增量替换能力，而不是一开始就追求全覆盖。

### 进入条件

- `v1` 平台化稳定。
- 升级和 provenance 机制成熟。
- 块接口和验证体系已被证明可迁移。

### 当前阶段拆分

- G1：内部工具与工作流系统扩展。
- G2：旧系统现代化与增量替换。
- G3：重领域场景试点。

### 可见方向

- Java / 旧系统现代化。
- 内部工具与工作流整合。
- LiveOps / 运营后台。
- 玩法系统 / 内容管线。
- 组织级系统现代化与增量替换。

### 连续功能切口

- 切口 A：内部工具模板化：
  - 表单。
  - 列表。
  - 审批。
  - 通知。
- 切口 B：旧系统映射：
  - schema 映射。
  - API 映射。
  - 验收映射。
- 切口 C：增量替换：
  - 新旧接口桥接。
  - 数据同步策略。
  - 回滚路径。
- 切口 D：重领域试点：
  - 仅在平台基线稳定后评估游戏/LiveOps。

### 默认执行顺序

- 先做切口 A。
- 再做切口 B、C。
- 最后才评估切口 D。

### 验证口径

- 新领域块仍可复用既有 block/verification/provenance 口径。
- 至少一个旧系统替换案例可稳定回归。
- 新领域扩展不破坏后台母体核心路径。

### 退出条件

- 至少两个非当前母例领域可共享平台核心合同。
- 旧系统现代化场景中，平台能给出可执行的迁移顺序与风险解释。
- 跨领域扩展未引入新的“无合同模板体系”。

### AI 可自主承担

- 旧系统映射建议。
- 新旧接口桥接建议。
- 迁移顺序规划。
- 回归风险分析。

### 风险

- 过早切入 Java 或游戏主循环会把平台拖回大量领域特定细节，必须晚于平台核心成熟。
- 如果没有增量替换路径，跨领域扩展会重新变成整仓重写项目。

## 阶段 H：终局平台面

### 目标

- 形成完整的工程编译基础设施层。
- 让上游规格、下游运行和平台治理最终形成统一闭环。

### 进入条件

- 多项目、多团队、多栈、多升级周期已经被证明可稳定运行。
- 图谱、策略、验证、升级、审计都已有可运营基线。

### 当前阶段拆分

- H1：上游 authoring 与治理。
- H2：中游编译与修复编排。
- H3：下游 artifact、deploy、observe 闭环。
- H4：平台运营、市场与审计层。

### 终局能力

- 上游：
  - spec-first authoring。
  - block graph editing。
  - policy and slot authoring。
- 中游：
  - compiler pipeline。
  - alignment / synthesize / repair passes。
  - upgrade and migration engine。
- 下游：
  - repo artifact。
  - provenance。
  - acceptance and policy reports。
  - deploy and observe hooks。
- 平台：
  - official + private registry。
  - marketplace。
  - audit and governance。
  - visual graph。
  - hosted verification。

### 连续功能切口

- 切口 A：上游建模体验。
- 切口 B：中游编译调度与预算控制。
- 切口 C：下游部署与观测接入。
- 切口 D：平台层审计、市场与权限治理。

### 验证口径

- 多团队多项目长期运行数据。
- hosted verification 与本地验证结果一致性。
- 审计链、变更链、升级链可追踪。

### 退出条件

- 平台可以稳定支持多个项目、多个团队、多个栈、多个升级周期。
- AI 的主要职责已经收敛为：对齐、综合、修复、迁移、解释，而不是从零写整仓。
- 人类只需要在关键审批点介入，而不是接管日常编译细节。

## 阶段 I：分层自举

### 目标

- 让工程编译器逐步用自身规格描述和维护自身外围，而不是一次性“自改核心”。
- 保持“外围先自举，核心最后自举”的保守路线。

### 进入条件

- 平台外围工具已足够稳定。
- provenance、graph、verification、权限边界已成熟。

### 当前阶段拆分

- I1：用规格描述 block、slot、acceptance、policy、registry metadata。
- I2：用平台生成与维护外围工具和报告。
- I3：逐步把外围工具 block 化。
- I4：最后才评估核心 pass 的自描述与受控迁移。

### 路线

1. 宿主语言实现内核：parser、resolver、composer、verifier、lock、权限边界继续由 TypeScript/Node 确定性实现。
2. 用工程规格描述官方 block、slot、acceptance、policy、registry metadata 和升级计划。
3. 用平台生成和维护文档视图、explain graph、报告、测试 harness、block scaffolding 和 demo 项目。
4. 将平台外围工具逐步迁移为自身 block：registry admin、upgrade center、policy center、verification dashboard。
5. 最后才评估核心 pass 的自描述、自测试和受控迁移。

### 默认执行顺序

- 先做 I1、I2。
- 再做 I3。
- 最后才触碰 I4。

### 验证口径

- 外围工具迁移后，输出与原实现一致。
- 自举生成的报告、视图、测试 harness 能稳定替代手工维护版本。
- 核心 pass 在未得到批准前始终保持宿主语言权威实现。

### 退出条件

- 平台外围能力可以由平台自身规格持续描述和演进。
- 自举只扩大维护效率，不削弱核心确定性与审计性。

### 不做

- 不允许系统直接无约束改写核心编译器。
- 不把自举作为 `v0.1-v1` 成功条件。
- 不用“自举”作为跳过验证和审批的理由。

## 阶段 J：自维护系统

### 目标

- 在 provenance、observability、权限、回滚和验收成熟后，让系统对项目进行有限自诊断、自修复和自升级。
- 把自维护限制在可审查、可回滚、可预算控制的边界内。

### 进入条件

- 失败诊断已经稳定映射到 spec/composition/slot/kernel 四类问题。
- repair/upgrade/override 已有成熟权限模型。
- 审计链与回滚链已跑通。

### 必备前提

- 可观测：构建、测试、运行、验收、用户行为和错误都能回到 graph/provenance。
- 可诊断：失败能映射到 spec issue、composition issue、slot issue 或 kernel issue。
- 可执行：repair / upgrade / override 都有明确权限、写入范围和预算。
- 可回滚：migration、compose、override 和生成产物都有恢复路径。
- 可审计：每次 AI task、人工 override 和升级决策都能解释。

### 当前阶段拆分

- J1：诊断闭环。
- J2：执行预算与审批模型。
- J3：冷路径与温路径自修复。
- J4：受控自升级。

### 连续功能切口

- 切口 A：诊断：
  - failure focus 视图。
  - root cause 分类。
  - 自动建议下一步。
- 切口 B：权限：
  - 写入预算。
  - 批准门槛。
  - 热路径阻断。
- 切口 C：执行：
  - slot repair。
  - policy 调整建议。
  - 文档/报告自更新。
- 切口 D：升级：
  - 受控 rollout。
  - 自动回滚条件。
  - 审批后执行。

### 默认边界

- 自维护优先处理冷路径和温路径：slot 修复、policy 调整、验收补齐、文档/报告、升级计划。
- 热路径、核心编译器、基础设施权限和数据迁移必须保持人工审批。

### 验证口径

- 自修复必须保留前后 diff、验证结果和回滚点。
- 自升级必须在受限环境先通过 verify/lock/explain。
- 审批边界不可被自动流程绕过。

### 退出条件

- 系统能在无人工逐文件介入的情况下处理一批低风险问题。
- 所有自动执行都能被解释、回放、回滚、审计。
- 人类只在真正高风险决策点介入。

### 风险

- 如果缺少预算、审批和热路径阻断，自维护会重新退化成高风险自动改仓库。
- 如果没有稳定 root cause 分类，自维护只会制造更多噪音任务。

## 阶段 K：产品线、组织与 Reality Compiler 研究线

### 目标

- 把平台从“单项目编译器”推进到“产品线编译器”和更长期的组织编译器研究线。
- 维持研究线与当前工程承诺之间的明确边界。

### 进入条件

- 多项目、多团队、多栈平台已经稳定。
- 自维护能力已有可审计的安全边界。

### 当前阶段拆分

- K1：产品线编译器。
- K2：组织编译器。
- K3：Venture / Reality Compiler 研究线。

### 产品线编译器

- 目标：
  - 编译一族同源产品。
  - 管理行业包、客户包、差异化配置、override、版本矩阵和升级策略。
- 连续切口：
  - 变体模型。
  - 产品线升级矩阵。
  - 共性块与差异块治理。
- 完成定义：
  - 同一产品线中的多个项目可共享大部分规格、块与升级资产。

### 组织编译器

- 目标：
  - 把角色、权限、流程、审批、数据对象、agent 和软件界面编译成组织协作系统。
- 连续切口：
  - 组织角色模型。
  - 审批与流程 DSL。
  - 组织级 policy/agent 编排。
- 完成定义：
  - 组织配置变化可稳定映射到系统行为与界面装配。

### Venture / Reality Compiler

- 目标：
  - 把商业想法或现实目标转化为软件、agent、人类角色、流程、外部服务和反馈回路组成的行动网络。
- 连续切口：
  - 目标建模。
  - 反馈回路建模。
  - 外部系统接入边界。
- 默认边界：
  - 该方向只作为长期研究与产品想象，不进入当前工程承诺。

### 默认执行顺序

- 先做 K1。
- 有稳定产品线资产后再评估 K2。
- K3 只保留研究，不进入当前交付承诺。

### 验证口径

- 产品线编译器需先证明多变体复用收益。
- 组织编译器需先证明流程/权限/界面可由统一规格驱动。
- 研究线只记录模型与原型，不绑定当前主仓里程碑。
## 新增整合：采用与影响路线

### 早期采用

- 目标用户：重复构建后台、管理台、B2B SaaS、小型内部平台的小团队。
- 默认交付物：可运行母例、官方块、CLI、验收、explain 报告和源码下钻。
- 成功标准：用户能在不理解全部长期愿景的情况下完成一次可信编译和一次局部修改。

### 中期采用

- 目标用户：需要维护多个相似项目、多个客户变体、私有组件和团队 CI 的组织。
- 默认交付物：私有 registry、policy gate、upgrade center、provenance、graph explorer 和 review assist。
- 成功标准：团队把块、规则、验收和升级当作资产复用，而不是复制项目源码。

### 长期影响

- 软件项目从一次性手工工程变成可组合、可编译、可验证、可持续演化的产品线资产。
- 新需求会集中在高质量功能块、行业块包、验收套件、规格工程师、项目变体管理、自维护服务、AI 成本压缩和企业软件现代化。

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
