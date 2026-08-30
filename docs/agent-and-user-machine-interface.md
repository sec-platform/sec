---
title: Agent 与用户机器接口
status: stable
domain: agent-user-interface
last-reviewed: 2026-08-22
---

# Agent 与用户机器接口

## 产品边界

SEC 是供 Agent 与用户直接调用的本地优先工程工具，不是 Web 应用。核心发行物只提供 CLI、稳定 machine JSON、内容寻址证据、语义 IR/图以及可组合的 compiler/orchestrator API。终端输出由 Pino 与 CLI formatter 承担；核心不拥有浏览器页面、HTTP/SSE UI server、HTML view、React/Next runtime 或 Playwright/Chromium 验证能力。

Agent 与用户必须通过同一个公共机器合同读取事实和请求 Operation。交互方式不能创建第二份产品语义、状态 owner、授权、Verification、Evidence 或 terminal result。面向人的文本只解释同一 machine result，不能反向成为 authority。

## 稳定公共面

公共机器面由以下能力组成：

- CLI 的确定性命令与 JSON 输出；
- canonical Engineering Operation 的 plan/apply/query/recover 结果；
- Engineering IR、ExplainGraph、Mermaid/DOT、ReviewSummary 与 Verification/Evidence 文件；
- Agent Context Packet 与 bounded proposal，它们只能引用 canonical identity/revision，不能签发 Effect authority；
- compiler/orchestrator 的版本化 TypeScript API，只承载与 CLI 相同的 owner 语义。

任何消费者都必须按 schema/revision 验证输入，并在 owner、revision、scope 或 Evidence 不完整时 fail closed。人类可读格式、shell presentation、Issue/PR prose 和聊天均不是公共机器合同。

## 可选界面边界

未来若需要图形界面，它必须作为独立 package、plugin 或 repository 提供，并只消费上述稳定公共面。它具有独立依赖闭包、发布周期、测试、缓存和安全边界；不得被 SEC core、TCB、MainHealth、默认安装、生成项目或普通开发 Gate 依赖。

可选界面只能拥有 presentation、local interaction state 与 transport session。它不能写 canonical IR，不能重新计算 WorkDecision、Implementation Resolution、Delta/Impact 或 Verification，也不能绕过 Engineering Operation 的唯一写路径。界面不存在、未安装或不可用时，SEC 的全部核心能力仍必须完整可用。

## 依赖与验证不变量

`src/toolchain/dependencies/spec.ts` 是直接依赖用途与生成项目投影的公开机器 owner；`package.json` 只拥有实际安装版本和命令入口。React、ReactDOM、Next、EJS、Playwright 及其类型包属于 retired core dependencies，重新进入核心 manifest 必须被合同拒绝。

核心变更只执行受 delta 影响且 MissingOrStale 的验证。浏览器、Docker 或外部 UI 验证不属于核心默认闭包；只有独立可选界面自身发生相关变化时，才由该界面的 owner 选择并产生自己的 Evidence。
