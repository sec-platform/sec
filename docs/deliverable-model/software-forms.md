---
title: 软件、服务、插件与交互成品
status: stable
domain: deliverable-model
---

# 软件、服务、插件与交互成品

本文细化常见可执行/可调用软件成品的公共边界。示例 API 仅表达 contract shape；实际语言由 Target Profile 决定。

## 1. Library

必须定义：
- callable symbol/module export；
- value/type/nullability/error；
- sync/async；
- state/effect/thread-safety；
- resource ownership；
- allowed Host Imports；
- package/export members。

纯同步 Library 不被强加 `main`、server、database、logger 或 SEC runtime。只有 type declaration 没有 implementation/allowed bound provider 时，不是可用 Library。

若调用方输入可能是 proxy/getter/foreign object，untrusted decode 在 boundary 完成；内部纯函数只消费已固定值，不能一边宣称 pure 一边触发任意 getter。

## 2. SDK

SDK 可以提供 session/handle：
- `create/open` 固定 config 和 Host Imports；
- operation 返回 typed success/business rejection/runtime fault；
- concurrency limit 有明确 backpressure/BUSY 行为；
- cancellation 只终止真正可取消责任；
- `close` 停止新准入并等待/结算已接受工作；
- concurrent/repeated close 幂等地共享同一关闭意图。

作者已经固定的 policy/limit 不得在 runtime factory 用同名可选参数绕过。

## 3. Protocol client

需要：
- exact endpoint/origin/protocol revision；
- request/response schema；
- timeout/cancel；
- redirect/retry policy；
- credential scope；
- idempotency/replay；
- response validation；
- connection/resource lifetime。

HTTP 200、RPC transport success 或 socket readable 都不是业务 success。Redirect 默认不能把 credential 发往不同 trust boundary；retry 只在 protocol/idempotency 允许时进行。

## 4. CLI

CLI 是 process consumer boundary，不是“Library 加 main”一句话。

定义：
- args/options/stdin selection；
- encoding/size bounds；
- stdout machine result；
- stderr human diagnostics/progress；
- exit-status mapping；
- cancellation/interrupt；
- short write / broken pipe；
- side-effect retry rule。

Machine JSON 若作为稳定接口，必须有独立 schema identity；human text 不被机器消费者解析成状态。

`--help/--version` 等无业务执行命令不能读取完整输入或启动无关能力。

完整输入需要原子结果时，先完成 decode/compute 再输出；允许 streaming 时必须重新定义 partial output、resume 和 failure semantics。

## 5. Batch command

每个 item 有 stable job identity 与独立业务结果；执行可以并发，公开输出 ordering 由合同决定而不是 completion order。

批次必须区分：
- whole-request malformed；
- item business rejection；
- item runtime failure；
- output transport failure；
- cancelled/unstarted items。

“有一项成功”不能让 whole batch 返回完整成功；反之，允许 partial results 的合同也不能因一项业务拒绝抹掉其他已完成项。

## 6. Handler

Handler 是被宿主调用的 request function。它不自动拥有 listener、TLS、accounts、database 或 deployment。

完整边界包括：
- path/method/media/body/size validation order；
- untrusted decode；
- auth/authorization import（若产品要求）；
- request identity/deadline/cancellation；
- response commit point；
- internal fault redaction；
- disconnect semantics。

响应头/bytes 已提交后发生错误，不能假装还能换成另一份完整 5xx。取消一个 request 不关闭共享宿主。

## 7. Service

Service 在 Handler 之外拥有：
- listen/bind outcome；
- advertised endpoint identity；
- readiness；
- bounded admission/queue；
- health/control path；
- graceful drain；
- termination/forced stop；
- shared resource close。

只有实际 bind/listen 成功才进入 ready。Health 路径需要不会被满载业务队列永久饿死的控制资源，但也不能绕过安全边界。

Drain：
1. 停止新业务准入；
2. 让已接受请求完成或准确取消；
3. 等待 response/resource settlement；
4. 关闭 listener/shared resources；
5. 返回 terminal close result。

## 8. Worker

Worker 是消息会话，不等同 Service。

必须有 session identity 与：
- `start/open`；
- `receive/submit`；
- result/event sink；
- protocol rejection；
- close/terminate。

活动 request id 重复：拒绝新的重复请求，**不能结算原请求**。未接受请求的 protocol error 与已接受工作的 business/runtime result 必须可区分。

结果可乱序时消费者按 request identity 绑定。Worker 被宿主强杀，只能从 session termination 推断尚未结算，不得伪造逐请求 cancel receipt。

## 9. Embedded Component

Component 通过宿主显式实例化并获得 imports。公共边界定义：
- interface revision；
- import/export；
- instance isolation；
- state lifetime；
- reentrancy/threading；
- host callbacks；
- dispose/close。

相同类型的两个实例不共享 mutable state，除非明确注入同一资源。

## 10. Plugin

Plugin 除 Component 合同外，还需要：
- host compatibility/interface version；
- explicit registration；
- contribution ownership；
- capability/permission grant；
- unload protocol；
- callbacks/result-resource settlement。

Import module 不自动修改 host global registry。卸载先撤新入口，再结算已接受 call/callback/resource；“命令消失”不等于 native code/allocator 可以卸载。

同进程 Plugin 名称不是安全隔离；不可信代码需要真实 process/Wasm/OS capability boundary。

## 11. Web interaction product

最小完整交互模型包括：
- labeled editable input；
- explicit action；
- running/cancel/reset；
- read-only result；
- business/runtime error region；
- keyboard/focus；
- accessible status independent of color；
- responsive/reflow behavior；
- stale-result protection。

一次 action 捕获 input revision/request generation。用户继续编辑后，旧结果不能覆盖当前输入；可显示为“针对旧输入的结果”或失效。

composition/IME 中间状态不能被普通 Enter 错当提交。Reset/route leave/refresh 对 unsaved data 的处理必须明确。

Web 产品默认不因 UI 存在获得 network、clipboard、file、account 或 persistence capability；需要时单独声明并授权。

## 12. Desktop product

在交互模型上增加 OS/window/file lifecycle：

- `open` 取得真实选中文件/handle 和 initial revision；
- `saveInput` / `saveResult` 各有独立 target identity；
- 保存开始后继续编辑：receipt 只推进被保存 snapshot 的 clean baseline；
- open dialog 返回时若原 draft 已变化，不无条件覆盖；
- `requestClose` 在 dirty state 下明确 save/discard/cancel；
- low-level resource close 不能绕过 user data decision；
- external file modification 触发 conflict/reload/merge，不 last-write-wins。

路径不等于 permission；file chooser/handle/capability 需按实际平台使用。

## 13. Mobile product

在交互模型上增加：
- app-private draft persistence；
- foreground/background；
- suspend/resume；
- process death and reconstruction；
- document/share URI permission expiry；
- memory pressure；
- platform lifecycle cancellation。

恢复只恢复已经 durable 的 draft/selection；旧 `Running` 不能在进程重建后直接恢复成 `Completed`。外部 URI 权限失效返回重新授权/不可用，不用旧 locator 假装仍可读写。

## 14. Product family / common release

Family 保存：
- shared Definitions/behavior；
- distinct product Subjects；
- variant-specific requirements；
- shared immutable members；
- cross-root resource/config constraints；
- common release completion。

一个 shared behavior 可由多个产品 root 使用，但每个 root 仍有独立 consumer interface、state 和 completion。一个 product 成功不能代表 family 完成。

## 15. Developer Workbench

Workbench 是一种完整交互成品，不是普通 Panel 的别名。若产品选择它，必须闭合：
- workspace/file tree；
- multi-view one-document identity；
- editor/selection/history/save；
- search/replace preview/apply；
- language diagnostics/completion/refactor；
- task/terminal/test；
- debugger/session/source mapping；
- VCS working/index/commit separation；
- extension lifecycle；
- settings/source/secret references；
- close/recovery。

搜索/replace preview 绑定 exact input revision；用户修改 pattern/selection/content 后旧 apply token 失效。不同 diagnostics producer 各自维护 generation，某一个 producer 的空结果不能清除其他 producer 的诊断。

Test/Debug 结果绑定实际 source snapshot；磁盘 C1 的绿灯不能贴给未保存 C2。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

Library、SDK、Client、CLI、Handler、Service、Worker、Component、Plugin 与 Web/Desktop/Mobile/Workbench 具有不同的 consumer、lifecycle、failure 与 resource contract；共享行为不允许把这些边界折叠成同一个 mode，已有满足合同的实现也不应被无意义包装。
