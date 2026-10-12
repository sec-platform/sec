# 作者源码示例：两个编辑器实例与一个存储组件（设计，不可运行）

本例包含 `gift.project.json` 和 `design/` 下5份`.module.json`，演示已有业务定义如何实例化到产品：

- `foundation`定义文档类型、请求/结果、状态、数据和资源；`platform`声明业务动作、外部效果端口及安全/并发/观察合同。
- `interaction`的EditorView有可编辑数据绑定，Save按钮标识业务Meaning；`SaveWorkflow`有显式输入/输出/错误类型、独立操作名、参数来源和后继，成功terminal返回persist的完整SaveResult；succeeded只证明本次调用按签名返回，不能把Conflict/Failed业务变体或未知外部结算当作Saved。
- `system`将Editor模板复用为EditorA/EditorB两个实例，其Document上下文由不同`objectRef`绑定，不能因共享模板而串线；同一View发生点可同时承担render/control；实例化后的保存按钮以 `activationRoutes` 把当前编辑值、上下文对象和修订送入具体Workflow。
- `goals`声明应当达到的业务目标；其保存完成、避免覆盖、请求和通知Meaning通过`platform`模块显式导入，实际领域解释/观察仍留给外部供应。Project只确定输出根与目标，没有重复存一份完整Goal。

**这不是临时编写的编译器实现，也不是能够运行的IDE。** 例中`ext:*`的外部Issuer、Provider、评审交互等故意仍为未供应引用；不能将其当成真实授权或自动代码生成资格。原来的Gift141范本中`name`重复、无关`dialects`、`UiNode.bindRef`、`WorkflowStep.portRef`、同一View重复Use等表面写法已不作为当前作者范例。这些文件只作为设计源；JSON Schema形状核对与真实编译、调度及业务执行资格分别判断。

## 必须能读懂的当前源形状

```
Module:{ schema, moduleId, definitions, namespace?, imports?, exports?, dialects?, annotations? }
DefinitionId -> Definition:{ kind, body, qualifiers? }
UI edit node -> dataBinding: {source: {source:"context", role:"document", path:"/text"}, mode:"edit", editActionRef:...}
Component UI use -> { use:{useId:"saveActionView",ref:... ,bindings:{}}, roles:["render","control"] }
Component activation -> {cause:{kind:"ui-action",uiUseId:"saveActionView",nodeId:"SaveButton"},workflowUseId:"saveWorkflow",inputBindings:{...}}
Workflow effect -> {kind:"effect",operationUse:{portRef:...,operation:"write",inputs:{uri:...,expectedRevision:...,newText:...}},onSuccessStep:...,onErrorStep:...}
```

这里用 `...` 展示的结构是帮助定位的片段，实际JSON文件才是完整范例。外部 Meaning/Method/Target 尚无实际实现；不能从源码存在直接得到业务运行效果。

仅要求查看作者**最少手写字段**时，优先读[最小作者输入与表示边界](../../docs/10-作者与输入/作者源/结构化源码.md#作者成果和最小交互)。本复杂范本保留独立的领域/上下文/外部供给关系，不能强迫每个小程序照抄这些外部引用或空模块字段。

## 按需层级状态定义（设计示例）

[`hierarchical-state.module.json`](hierarchical-state.module.json) 在唯一 `/2` 作者模块内演示平行区域、局部初态、深历史、显式多目标转换与无多余 `dialects` 的写法。它只定义状态机，不自动创建持久运行实例、恢复真实资源或授予宿主权限；状态/事件消费者与目标生成仍需另行取得实际资格。

`recursive-int.module.json` 是同一 /2 作者格式下使用冻结纯 `std:IntEq`、`std:IntSub` 与 `std:IntAdd` 的递归计算设计样例；其 `termination=partial` 明确不冒称任意输入必终止。本例只说明 JSON 可表达的词法引用、递归与基底调用，不是已生成运行程序或算法正确性证明。

## 有限工作流组合与错误值（设计示例）

[`workflow-composition.module.json`](workflow-composition.module.json)演示Definition/export/Ref中的连字符保持原样、两个独立子流程的显式角色绑定、有限all-join记录结果和step-outcome失败原值转发。局部变量、StepId、角色仍用原Identifier文法；std/local不可作为可重绑import。parallel的调度、错误聚合、取消与未结算资源规则见[工作流Owner](../../docs/20-语义与组合/交付语义/工作流执行关系与激活.md)，本例没有启动或实现运行器。
