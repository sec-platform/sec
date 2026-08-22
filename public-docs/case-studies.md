# 现实案例：为什么这些工程语义不能省略

SEC 的很多设计如果只看术语，会显得“是不是太严格了”：为什么要把计划和结果分开？为什么 unknown 不能当 false？为什么 Provider 替换还要看运行环境？为什么测试绿了还不够？为什么 Recovery 也要 Evidence？

现实系统已经反复给出答案。

这篇页面选择彼此差异很大的软件、基础设施、运维和系统工程案例。每个案例只提取一个或几个可以独立验证的机制；它们是 **design evidence（设计依据）**，不是 SEC 的 canonical authority。

## 1. 一个很小的 UUID 替换：实现等价不等于语义等价

### 现实问题

一个真实 TypeScript 浏览器应用使用第三方 `uuid` 包生成评论 ID。看起来最自然的现代化修改是：

```text
uuid.v4()
→ crypto.randomUUID()
```

然后删除第三方 dependency。

代码改动很小，类型也很简单。

### 深挖以后出现什么

这个 ID 不是临时字符串，而会进入持久化评论对象；应用还公开支持把本地 Web 服务绑定到外部 host。

再检查被替换 Provider 的真实 browser implementation，会发现它不是简单调用一个函数，而是：

```text
randomUUID 可用
→ 直接使用

否则
→ crypto.getRandomValues()
→ 设置 UUID v4 version / variant bits
→ 编码
```

因此一个无条件 `crypto.randomUUID()` 替换可能改变原有 environment support boundary。

### 关键语义

```text
Responsibility
Contract
Runtime environment
Provider capability
Implementation Binding
Support
Persistent-state consumer
```

### SEC 学到什么

Provider replacement 的正确问题不是：

> “新 API 看起来是不是一样？”

而是：

> “在所有 must-preserve semantic dimensions 上，新 implementation closure 是否满足同一个 Contract？”

所以：

```text
Source/API shape equivalent
!=
Semantic equivalent
```

### 不能推出什么

这不意味着每次换库都需要创建巨大 domain model。只有会改变 eligibility/Impact/Verification 的语义才应该进入该任务的闭包。

---

## 2. Kubernetes：一次写成功，不代表世界已经收敛

[Kubernetes 官方 controller 文档](https://kubernetes.io/docs/concepts/architecture/controller/) 把 controller 定义为持续观察集群状态并尝试让 current state 接近 desired state 的 control loop。它还强调集群本身可能持续变化，并且使用多个 controller 各自管理特定方面。

### 关键机制

```text
desired state
!=
current/observed state
```

以及：

```text
write once
→ external world may continue changing
→ observe again
→ reconcile again
```

### SEC 学到什么

对于真实工程、部署和运行系统：

```text
Plan
→ Effect
```

不能被视为一次性“完成证明”。

只要 subject 可以被外部 actor、runtime、provider 或环境改变，就需要明确：

- desired/canonical truth 在哪里；
- observed reality 在哪里；
- 谁拥有 reconcile；
- 哪个 observation 会使旧 Evidence 失效。

### 不能推出什么

SEC 不需要把所有工程对象都变成 Kubernetes resource，也不要求所有领域长期运行 daemon controller。这里吸收的是 **desired/observed/reconciliation 的机制**。

---

## 3. Terraform：Plan、Apply、Actual State 和 Recovery 是不同真值

[`terraform plan`](https://developer.hashicorp.com/terraform/cli/commands/plan) 会读取当前状态、比较 configuration，并生成预期 change actions；plan 本身不执行这些变化。官方文档还明确提醒，在计划后 target system 发生其他变化，最终 effect 可能与早期 speculative plan 不同。

[`terraform apply` 错误处理](https://developer.hashicorp.com/terraform/tutorials/cli/apply) 还说明：apply 某一步失败时，Terraform 会记录已发生的 resource changes 并退出；基础设施可能处于 invalid state，而且它不对部分完成的 apply 提供通用自动 rollback。

### 关键机制

```text
Expected Delta
!=
Actual Delta
```

```text
Plan valid at T0
!=
preconditions still true at T1
```

```text
Operation failed
!=
no physical effects happened
```

### SEC 学到什么

一个受治理的 mutation 至少要区分：

```text
request
authorization
plan
preconditions / revision
physical effects
actual readback
terminal state
recovery / forward recovery
```

计划不能自己签发“执行后现实和我预测一样”的证明。

### 不能推出什么

Terraform 的 state/locking 模型是基础设施领域的具体实现。SEC 应吸收 CAS、stale-plan、partial-effect、readback 等不可约机制，而不是复制 Terraform state format。

---

## 4. CrowdStrike 2024：配置数据也可以具有可执行合同

CrowdStrike 的 [Technical Root Cause Analysis](https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf) 对 2024 年 7 月事件给出了一个非常清楚的 producer/consumer mismatch：IPC Template Type 的 sensor code 提供 20 个 input，而 Template Type 定义声明预期 21 个；问题 content 最终让 interpreter 尝试读取第 21 项，触发越界读取。

CrowdStrike 随后增加了 input field count validation、bounds checking 和更多 deployment/acceptance layers。

### 关键机制

```text
Content accepted by validator
!=
producer-consumer contract compatible
```

而且：

```text
“这是配置/内容，不是普通应用代码”
!=
它没有 executable semantics
```

### SEC 学到什么

任何会被 runtime interpreter 消费、并影响控制流/资源/内存访问的 artifact，都可能需要：

```text
schema/shape identity
producer contract
consumer contract
version compatibility
compile-time validation
runtime guard
rollout evidence
```

不能只因为一个文件被叫做“content”或“config”就把它降级成无语义数据。

### 不能推出什么

这个事件并不证明“所有配置都要进入 Core semantic IR”。只有其合同、Effect、Compatibility 等与当前工程判断有关时才需要提升相应语义。

---

## 5. AWS S3 2017：有权限执行，不代表 Effect 被正确约束

AWS 对 [2017 年 US-EAST-1 S3 service disruption](https://aws.amazon.com/message/41926/) 的官方总结说明：一名被授权的 S3 团队成员按照既有 playbook 执行命令，本来只想移除少量服务器，但一个输入值填写错误，导致移除的服务器数量远大于预期，并影响依赖的其他 S3 subsystem。

### 关键机制

```text
actor authorized
+
playbook exists
+
command valid
```

仍然不等于：

```text
actual Effect bounded correctly
```

### SEC 学到什么

Permission 只回答：

> “谁可以做？”

还必须有独立语义回答：

```text
做什么
作用于哪些 exact subjects
最大 blast radius
资源/依赖影响
参数范围
expected Delta
```

因此：

```text
Authorization
!=
Effect Safety
```

### 不能推出什么

不是所有低风险操作都要复杂审批。关键是 Effect 范围、不可逆性和 failure cost 应该决定验证与授权强度。

---

## 6. Cloudflare 2019：功能正确不代表资源语义正确

Cloudflare 对 [2019 年 7 月 2 日全球中断](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/) 的详细复盘说明：新的 WAF 规则包含会产生巨大回溯的正则表达式，造成全球处理 HTTP/HTTPS 的 CPU 耗尽。

更关键的是，Cloudflare 明确写到：常规 CI/功能规则测试通过，但测试没有识别 runaway CPU；非紧急 WAF rule 又可以非常快地全球发布。事后改进包括规则性能 profiling、具有运行时保证的 regex engine 和 staged rollout。

### 关键机制

```text
Functional behavior passes
!=
Resource behavior safe
```

以及：

```text
simulate / config rule
仍然真实执行
仍然消耗 CPU
```

### SEC 学到什么

Effect 不只包括“写文件”“发网络请求”。

资源本身也可以是工程语义：

```text
CPU
memory
latency
processes
browser instances
I/O
quota
```

如果一个 requirement 声称 performance/resource safety，那么相应 Verification 必须实际覆盖它，不能让普通 functional test 冒充证明。

### 不能推出什么

每个函数都不需要永久性能预算。只有真实 consumer、风险或 optimization claim 需要时才把资源维度加入验证闭包。

---

## 7. GitLab 2017：Backup 存在不等于 Recovery 能力成立

GitLab 的 [2017 年数据库中断 postmortem](https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/) 记录了一次 primary database data 被意外移除的重大事故；服务长时间不可用，并最终存在无法恢复的 production data loss。

### 关键机制

一个系统可能同时拥有：

```text
backup scripts
replication
snapshots
recovery procedures
```

但真正有价值的问题是：

```text
在当前 exact state 下
是否存在 fresh、完整、可读、可恢复的 physical recovery path？
```

### SEC 学到什么

因此：

```text
Recovery design exists
!=
Recovery capability verified
```

Recovery Claim 需要自己的：

```text
subject
freshness
physical artifact
restore procedure
environment
readback
failure mode
```

而不是因为 README/配置中写了“有备份”就产生绿色状态。

### 不能推出什么

一个单次 disaster recovery drill 也不是永久证明；底层数据格式、credential、provider、retention 或环境变化都可能使旧 Evidence 失效。

---

## 8. Ariane 5 Flight 501：复用成功过的软件不等于新 Target 兼容

ESA 对 [Ariane 501 Inquiry Board report](https://www.esa.int/Newsroom/Press_Releases/Ariane_501_-_Presentation_of_Inquiry_Board_report) 的官方介绍指出，事故根源在惯性参考系统的软件 specification/design error；大量 review/test 没有充分分析和测试该系统以及完整 flight control system。报告还特别指出，一个只在起飞前有用途的 alignment function 在起飞后仍继续运行，并没有被代表性 simulation 覆盖。

### 关键机制

```text
implementation worked in previous system
!=
assumptions hold in new target/environment
```

一个实现真正可复用，需要的不只是 API/type 兼容，还包括：

```text
input domain
value ranges
timing
lifecycle
failure behavior
environment assumptions
```

### SEC 学到什么

Implementation Resolution 必须把真实 Target/Environment constraints 作为 hard eligibility 输入。

过去成功、测试存在、代码复用历史，都只是 Evidence，不能越过已经失效的硬假设。

### 不能推出什么

这也不意味着“复用危险，所以都自研”。正确结论正相反：成熟实现应该优先复用，但它的 **assumptions 和 conformance boundary 必须显式**。

---

## 9. MLIR：可扩展 IR 不能让每个 pass 都知道所有类型

[MLIR](https://mlir.llvm.org/docs/LangRef/) 允许多个拥有 namespace 的 dialect 在同一个 module 中共存。

[MLIR Interfaces](https://mlir.llvm.org/docs/Interfaces/) 更直接说明了为什么 interface 必要：如果每个 analysis/transformation 都要理解所有 operation/dialect 的具体语义，系统会充满 special case；interface 让 pass 按自己真正需要的通用 contract 工作。

### SEC 学到什么

这支持一个重要方向：

```text
Minimal Semantic Kernel
+ Domain Semantics
+ Generic Semantic Interfaces
```

而不是：

```text
每增加一个 domain
→ 修改所有 Core pass
```

### 不能推出什么

MLIR 主要解决 compiler IR。SEC 的 authority、Fact/Assertion、Evidence、physical reality 和 engineering lifecycle 都不同，因此不能把 MLIR dialect 直接当 SEC domain model。

---

## 10. SysML v2：跨硬件/软件的正式系统语义有现实需求

OMG 将 [SysML](https://www.omg.org/sysml/) 定义为用于 specification、analysis、design、verification 的通用系统建模语言，覆盖的系统可以同时包含 hardware、software、information、personnel、procedures、facilities。

[SysML v2 specification](https://www.omg.org/spec/SysML/) 还提供规范和 machine-readable libraries，包括系统、分析、因果、几何、单位、需求推导等 domain library。

### SEC 学到什么

它证明两个现实事实：

1. 工程世界确实需要跨软件文件之外的 structure / behavior / requirement / verification semantics；
2. 一个核心语言可以通过 domain library 扩展，而不是把所有领域概念永久塞进一个 monolithic object。

### 不能推出什么

SEC 不是 MBSE 工具的翻版，也不应该复制 SysML metamodel。SEC 仍然要服务代码、Brownfield、Implementation Resolution、Mutation 和工程 Evidence 等自己的核心问题。

---

## 11. W3C PROV：Provenance 本身也需要有效性

[W3C PROV Constraints](https://www.w3.org/TR/prov-constraints/) 把 provenance 建模为 entity、activity、agent 及其关系，并定义 uniqueness、event ordering、type、impossibility 等约束以及 normalization/validity/equivalence。

### SEC 学到什么

这支持一个容易被忽略的结论：

```text
provenance = "some string"
```

不够。

如果 provenance 会影响我们是否相信一个 Assertion，那么 provenance 自己也需要：

```text
identity
subject binding
producer/source
revision
validity
consistency
```

### 不能推出什么

SEC 没必要重新实现完整 PROV 标准；已有标准应优先作为机制和互操作候选，SEC 只拥有自己确实需要的工程 provenance contract。

---

## 12. OpenTelemetry Semantic Conventions：语义扩展也需要成熟度和真实验证

[OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/) 为 telemetry 中的 attributes、span、metric、event 等定义统一意义，并按 HTTP、database、messaging、cloud、system 等领域扩展。

其 [semantic convention groups](https://opentelemetry.io/docs/specs/semconv/general/semantic-convention-groups/) 明确定义 development、alpha、beta、release candidate、stable 等稳定度；[编写新 convention 的指导](https://opentelemetry.io/docs/specs/semconv/how-to-write-conventions/) 还强烈建议先在真实 instrumentation 中 prototype，确认术语跨不同技术真正适用，再逐步稳定。

### SEC 学到什么

新语义不能因为“名字听起来通用”就直接进入稳定 Core。

更合理的过程是：

```text
real use cases
→ experimental domain semantics
→ multiple implementations/corpora
→ incompatibility and migration analysis
→ stable semantics
```

这正适合用于攻击 SEC 未来的 Domain Semantic Extension 生命周期。

### 不能推出什么

Telemetry convention 主要描述 observability data；SEC 还需要 authority、mutation、implementation、physical effect 等更强语义，所以不能把 OpenTelemetry schema 当 Engineering IR。

---

## 13. 把这些案例放在一起，会出现一组重复出现的不可约边界

不同领域最终反复撞到同一批问题：

| 边界 | 如果混掉会发生什么 |
| --- | --- |
| Desired / Observed | 把旧计划当成当前现实 |
| Semantic / Implementation | 换实现时偷偷改变 Contract |
| Plan / Effect | 认为批准计划就等于实际只发生计划内变化 |
| Permission / Effect Scope | 有权限的人可以意外造成过大 blast radius |
| Functional / Resource semantics | 功能测试通过但 CPU/内存/延迟失控 |
| Config / Executable semantics | 把会驱动 runtime 行为的数据当无害文本 |
| Backup / Recovery | 有备份配置却无法真正恢复 |
| Previous success / Target compatibility | 把历史可用误认为新环境 hard eligibility |
| Fact / Assertion | 一个来源的说法直接变成世界真理 |
| Evidence / Authority | 测试或日志反向取得决策权 |
| Known / Unknown | 没观察到被误写成不存在 |

这就是 SEC 需要不断研究更广现实案例的原因。

不是为了把所有行业词汇收集到一个模型里，而是不断寻找：

> **哪些不同系统其实受同一个不可约约束控制；哪些看似相同的概念却因为真实机制不同而必须保持领域隔离。**

## 14. 案例库怎样继续增长

以后加入新案例时，至少回答：

```text
What happened?
What mechanism actually controlled the result?
Which semantic boundary mattered?
Which existing SEC owner already covers it?
Does it expose a genuine new gap?
What is the strongest alternative explanation?
What would reverse the conclusion?
What can a beginner learn from it?
```

如果一个新案例只是在重复已有机制，就链接已有设计，不新增一个新 schema。

如果它真的暴露新的决定性语义，才回到 canonical architecture 重算。

继续阅读：

- [完整工程语义系统](semantic-system.md)
- [SEC 怎样从现实问题推导设计](design-method.md)
- [设计、成熟度与证据](decisions-and-evidence.md)
- [故障排查](troubleshooting.md)
