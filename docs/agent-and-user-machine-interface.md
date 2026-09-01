---
title: Agent 与用户机器接口
status: stable
domain: agent-user-interface
---

# Agent 与用户机器接口

## 产品边界

SEC 是供 Agent 与用户直接调用的本地优先工程工具，不是 Web 应用。核心发行物只提供 CLI、稳定 machine JSON、内容寻址证据、语义 IR/图以及可组合的 compiler/orchestrator API。终端presentation由CLI formatter/logging owner承担；Agent/CLI interface domain不拥有SEC自身的浏览器页面、HTTP/SSE UI server、HTML view、前端应用runtime，也不拥有browser Verification authority。Target workspace Acceptance仍可按Runtime/Verification capability selection消费外部Browser Provider。

Agent 与用户必须通过同一个公共机器合同读取事实和请求 Operation。交互方式不能创建第二份产品语义、状态 owner、授权、Verification、Evidence 或 terminal result。面向人的文本只解释同一 machine result，不能反向成为 authority。

## 稳定公共面

公共机器面由以下能力组成：

- CLI 的确定性命令与 JSON 输出；
- canonical Engineering Operation 的 plan/apply/query/recover 结果；
- Engineering IR、ExplainGraph、Mermaid/DOT、ReviewSummary 与 Verification/Evidence 文件；
- Agent Context Packet 与 bounded proposal，它们只能引用 canonical identity/revision，不能签发 Effect authority；
- compiler/orchestrator 的named TypeScript API contract，只承载与CLI相同的owner语义；只有真实外部、持久或迁移consumer需要区分多个可观察状态时才建立version域。

公共机器合同要求任何消费者按owner签发的schema identity与适用revision验证输入，并在owner、identity、scope或Evidence不完整时fail closed。未由named owner schema与strict parser覆盖的CLI JSON只能是legacy projection，不能声称stable public contract；具体覆盖率由generated current projection给出，不在本文手写。不得用全局CLI envelope或泛化`formatVersion`掩盖缺口。人类可读格式、shell presentation、Issue/PR prose和聊天均不是公共机器合同；没有真实version consumer时，schema identity不能被无意义的数字字段或`Vn`名称代替。

每一种激活的真实公共payload必须拥有自己的命名schema与strict parser；domain result schema由domain owner拥有，CLI只拥有command-to-owner-schema mapping、stdout/stderr/exit-code transport与compact/full projection。不能让一个全局`formatVersion`同时冒充多个不兼容对象的协议，也不能由writer、formatter和测试分别复制schema identity。默认CLI/Agent输出是同一canonical result的bounded decision projection，只包含下一步所需状态、typed blocker、计数、聚类和绑定完整结果的digest。逐路径记录、完整fact graph与full Evidence只在显式`--full`或有明确artifact consumer时产生；compact projection不得改变退出码、blocking计数、unknown语义、Evidence digest或authority，也不能成为第二状态源。完整结果由原owner保留并可按同一identity重建，不能为了展示重新扫描或重新计算业务事实。

## 可选界面边界

未来若需要图形界面，它必须作为独立 package、plugin 或 repository 提供，并只消费上述稳定公共面。它具有独立依赖闭包、发布周期、测试、缓存和安全边界；不得被 SEC core、TCB、MainHealth、默认安装、生成项目或普通开发 Gate 依赖。

可选界面只能拥有 presentation、local interaction state 与 transport session。它不能写 canonical IR，不能重新计算 WorkDecision、Implementation Resolution、Delta/Impact 或 Verification，也不能绕过 Engineering Operation 的唯一写路径。界面不存在、未安装或不可用时，SEC 的全部核心能力仍必须完整可用。

## 依赖与验证不变量

Dependency Specification owner拥有直接依赖用途、产品边界和生成目标投影；package manifest只拥有实际安装版本与命令入口。已退役的core UI/browser dependency class必须由该唯一owner与真实consumer graph共同拒绝，具体包名和版本只存在于machine specification、package manifest与lock observation，不在本文维护第二份清单。

核心变更只执行受delta影响且MissingOrStale的验证。browser/container不属于所有核心变更的默认闭包，但可以由Target Profile、ImplementationBinding、Target runtime或Verification fixture的真实capability需求选中；只有SEC自身已退役UI/browser dependency class被无条件拒绝。request-only、DOM-free或pure semantic验证继续选择更窄Provider，不因测试目录名启动browser/container。
