# 08 TS/Bun控制层、Rust Worker 与六工具：真正可实现的跨进程调用

## 1. 三种接口不能相互代替

**开发者工具**是用户可见、适配 CLI/IDE/AI 的六个逻辑工具：现有 `query/propose/check/preview/apply/operation` （具体子动作按已采用 schema），不是把前端每个按钮都暴露成第七工具。**Rust worker 协议**是控制进程和纯kernel的内部计算信封。**Effect Provider**是有真实权限的外部执行边界。它们的请求身份、预算、取消、授权、效果结算都不同，不能为了通用而只设计一种`rpc.call`。

控制层可使用 TypeScript/Bun 负责工作区、工具路由和目标工具链；Code-OSS Extension可在Node/Web运行，需通过同一公开工具接口适配，不得假设Extension宿主就是Bun。Rust内核可嵌入调用，也可使用warm worker；这两种布局消费同一纯计算方法，不能在TS side重新实现一套类型/效果/Method权威。

## 2. 控制层请求算法

```text
entry.receive(wire)
  → negotiate exact tool schema version and capability subset
  → authenticate caller and identify authorized SourceScope
  → application.handle(toolName, request, session)
  → workspace captures ProjectView/Candidate + lock or returns Needs
  → if required: kernel invocation with frozen input via worker
  → if check/build: execution applies tool-adapter authorization and input VFS
  → if apply/run: execution independently rechecks current authority/preimage
  → serialize bounded progress/results; final frame means transport finished only
```

对未请求的动作不得偷偷执行：`preview`不写文件、`check`只执行明确获准的工具范围、`apply`才进行用户有权的保存/安装，`operation`负责真实作用的观察/撤销/恢复状态。AI是可授权的创作者，不能直接调用内核作为Grant发行者。受限请求应保留具体Need，包括获取哪份库、选择哪个目标或是否必须确认业务意义。

## 3. Rust worker首发线协议

沿已有`gift.kernel-worker/1`：stdin/stdout上，每帧为 **4字节无符号大端payload长度+严格UTF-8 JSON对象**。在读取首帧之前设置硬上限，不能先分配攻击者给出的超大帧再协商。hello握手固定协议修订、workerEpoch、可用method、输入内容与预算上限；普通请求封闭信封含 `protocolRevision/workerEpoch/requestId/method/body`，必要时带`sessionRef/snapshotRef/budgetRef`。编码字段的实际类型、错误及扩展只从固定机器schema和严格codec取得；下面的字段表是实现消费责任，不是另造公开信封。

worker进程维护：唯一的epoch、被授予的内容片段缓存、snapshot-local handles、requestId去重窗口、会话账本、预算和在执行任务。内容大于帧预算时通过明确的`content.put`块传输，块包括ContentRef、偏移、长度、base64字节与总摘要；解码先核budget、合法base64词法与长度、整体摘要，完成前不能把半截内容发布为可解析blob。

协议阶段：`hello`→`content.put`(必要时)→`snapshot.open`→`semantic.analyze/requirements.instantiate/realization.resolve/target.lower`等已协商methods→`snapshot.close`。同requestId在同epoch内相同payload可挂载已有纯计算结果，不同payload拒绝。worker重启后旧epoch的数字句柄无效；control重新发送完整固定依据并构造新Prepared输入，而不能只拿旧handle再试一次。

## 4. 超时、取消、重连的逐状态过程

`requestId`只用来关联本次内部或工具请求，不等于OperationRef。一次中途断连的纯编译可在固定basis上重算，并记录它是否具有相同EvaluationKey；被多个等待者共享的计算不能因为其中一个请求cancel就全部停止。新workerEpoch不接受旧session引用；若control还持有外部Operation，恢复时必须沿持久OperationRef读回其真实状态，而不是借重发纯编译请求创建第二次世界效果。

一个可直接画入控制器的有限状态机：

```text
Disconnected ──start──> Handshaking ──verified──> Ready
Ready ──open──> SnapshotOpen ──analyze──> Evaluating
Evaluating ──final-result──> Ready/SnapshotOpen
Evaluating ──cancel-consumer──> Evaluating(others) or Cancelling
any ──crash/EOF──> LostEpoch ──restart──> Handshaking
any ──protocol/identity mismatch──> Rejected (must not continue same handle)
```

这些是实现者的内部会话状态，需记录最终响应发送结果但不自称业务成功。部分结果或进度分片必须与同一requestId和basis绑定；客户端乱序收取时不允许把先到的一份旧candidate显示为current。

## 5. 六工具分别调用哪些内部Owner

| 工具 | 只读/候选/作用 | 内部来源与确切副作用 |
|---|---|---|
| `query` | 只读 | workspace的当前或指定snapshot、kernel查询、派生目录；不更新源/锁/Grant |
| `propose` | 产生候选 | application采集用户意图、workspace形成AuthorDelta，kernel检查；不自动commit |
| `check` | 取得证据 | assurance提出义务，实际target/toolchain在授权下执行检查，保留独立结果与失败 |
| `preview` | 只读可生成物 | kernel按固定根生成真实ArtifactSet与diff；不推入目标目录、不执行外部脚本 |
| `apply` | 受权编辑/发布 | execution重新检查当前基础与权限；workspace计划CAS/原生owner，不签其他外部服务效果 |
| `operation` | 有状态作用与恢复 | 执行准入、Attempt、Effect readback/reconcile、撤销/补偿的实际状态 |

精确参数签名沿 `schema/tools/*` 与 `docs/80-开发者与接口/工具协议/`。尚未协商结构化文件扩展的旧客户端，不应对不认识的编辑payload用宽松对象透传；可以保留只读诊断与失败、要求显式升级。request完成只表示该次请求给出了终态响应，外部效果 `UnknownOutcome`仍可随后被结算。

## 6. 断言什么才算多客户端真实完成

同一工程在CLI、脚本和Code-OSS产生的Candidate都携准确baseline和SourceProfile，保存走同一CAS；客户端可显示当前草稿、历史评估与真实世界观察，但不能持久写一份自己的“当前项目头”。GUI派生目录的facet可以改变呈现位置，不能成为新的Definition身份。AI可获取明确受权作用域、作候选和调用同一六工具；重连后检查当前权限，不能以旧对话里的“允许”代替撤销后的Grant。

必须测试：worker返回乱序；同requestId不同body拒绝；旧epoch句柄失效；固定ContentRef块重复/缺块；客户端断连后纯请求可重算但真实作用不盲重试；独立客户端并发改同一源时基线冲突；一个root部分失败与另一个root成功的结果都可见但没有全项目虚假PASS。

<a id="worker-request-tables-and-flow"></a>
## 连接、快照、请求、内容四张表的状态与流控程序

前文的单线状态图用于说明一次请求，不应实现为整个连接只能有一个SnapshotOpen/Evaluating状态。实际内部保存四张独立表：`Connection{epoch,image,codec,limits,writerState}`、`Snapshots{handle→immutable data,pins,closing}`、`Requests{id→bodyDigest,basis,producer,waiters,terminal,retainUntil}`、`Contents{ref→total,received,staging,verified,pins}`。每张表的key都带连接/会话作用域；一个请求结束不自动关闭其它快照。

帧读取器持有`Prefix{received[0..4]}`或`Payload{expected,received}`。不足4字节时继续收前缀，校验长度界限后才准入缓冲，再循环读取直到expected；EOF发生在中途为协议截断，不交给JSON解析器猜补。payload严格解码失败使当前连接协议失效；可回复的错误必须使用已确认的关联，不能从非法部分JSON取requestId。stdout只有一个writer，出队后完整写完该帧再切换；stderr持续有界排空，超额截断须保留关联和截断事件。

控制帧与数据帧使用分别有上限的队列，cancel/close不受内容队列满阻塞；但不能插入半帧。大结果和输入被切为有限帧，消息最大尺寸决定取消帧最坏等待的物理上界之一；CPU长循环也必须有取消检查点。对不可信计算无合作停止保证时，依真正隔离进程及资源回收合同终止，不能因有cancel字段就承诺有限停止。

`content.put`首期采用连续块：offset等于已接受连续前缀长度；重发完全落在前缀内时逐字节比对，完全一致可确认，交叠但含新尾部或位置跳跃拒绝并返回下一合法offset。总长度在首块前计入配额，base64只采用固定字母表与规范填充；解码长度与声明长度不等即拒绝。末块后同时核总长度、内容摘要、来源域，原子转Verified。digest错误清理该staging但不删除同hash其它有权已验证内容；上传会话退出释放自己的占用。

`snapshot.open`只引用Verified内容，成功时一次增加其依赖pins；任一依赖缺失时回滚本次已加pins，不发布半快照。`snapshot.close`先标closing、拒新请求，然后等待当前pins；已完成且编码自有结果可解除借用。不得发出“完全释放”响应后再读取旧arena。close被重复请求返回同一观察状态，不能减两次引用计数。

请求id同epoch内重复：payload/basis相同且仍保留则附加等待或重发已完成响应；相同id不同载荷拒绝。记录已过保留窗口时返回RequestExpired，不把旧id当新请求隐式重算。新id的纯计算可按query资格复用，但不得丢弃原消耗；业务Operation不进入这张去重表。终态结果只提交一次，cancel与完成用一次原子状态竞争决定协议结果；已完成的数学结果不能被晚到cancel改写为未发生。

Worker重启后所有旧handle和request关联失效；control用自己的固定内容和原PreparedJob重开snapshot，实际费用与预算不刷新。完整收到并独立持有的旧Artifact可按原资格保留；半帧结果不可采用。Provider已派发作用的恢复始终属于持久execution，不能因Worker失联删除其事件。

`semantic.analyze`等方法体由唯一方法codec表分派，表项包括固定输入/输出codec、snapshot要求、预算类别和粗粒度处理函数。没有wire定义的`compile`短名只是内部函数名，不能发上管道。一个批量方法可以在Worker内部串联多个纯职责，但其实际方法标识必须通过既有协议协商，不能把施工文字当隐式新方法发布。
