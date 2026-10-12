# Gift141：非计算作者协议历史候选的静态参数与因果入口范本（历史研究说明）

此范本沿用 Gift140 的**同一作者Schema**与组件、实例、端口、产品根及部署身份链，补充此前缺失的两个相互独立的业务区分：

- 两个 `EditorComponent` 实例分别以 `argumentBindings.mode={source:literal,typeRef:foundation:EditorMode,value:...}` 固定 `edit`/`review` 业务参数；实例 `contextBindings.document` 仍分别关联不同文档对象。静态值不是运行时参数，也不让业务作者写 `core:constant`、表达式或Rust函数。
- `EditorComponent.workflowUses[saveWorkflow]` 在组件内获得稳定发生点 `useId`；UI `EditorView` 的 `SaveButton` 在 `uiParticipations[control:saveActionView]` 出现，`activationRoutes[saveClick]` 连接**这个UI使用点和节点**到**这个工作流使用点**。`UiNode.actionRef` 现指向真正的 `domain:meaning`操作 `platform:SaveAction`，而不是底层 `platform:FilePort`；它是语义动作标识，不隐式直接执行Effect。
- `StorageComponent` 声明事件订阅和服务端API但未声明相应的因果处理路由；受限检查应返回 `NEEDS_SUBSCRIPTION_DISPOSITION`、`NEEDS_SERVER_ENDPOINT_DISPOSITION`，而不是强行加入虚假的工作流或报告“闭合”。

原范本保留外部业务对象Issuer、Meaning、领域Norm、权限/Grant、Method、Target、数据持久化、调度/事件动态载荷映射以及运行后独立验收的明确Needs，**不是已经生成或编译的IDE**。

## 原有限结构检查的范围

依赖Python的 `jsonschema` 与 `referencing`，在全包根目录

负例逐个改动精确字段并检查拒绝码，正例核验选定来源与未签资格的共存；任何这些检查均不证明整个业务定义已语义正确或目标工程能正常运行。

历史 Gift140 范本保留在相邻目录，精确反映其原来的模型；新范本不是覆盖旧证据，也不构成第二份Writer。
