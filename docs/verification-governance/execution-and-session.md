---
title: Verification 执行、复用与 Session
status: stable
domain: verification-governance
---

# Verification 执行、复用与 Session

本片段拥有 Action identity/execution/reuse、Impact selection、Candidate/Scope/Session/MainHealth、failure/retry、typecheck 与 hermetic runtime。

## 5. Action identity、execution 与复用

### 5.1 三层 identity

| Identity | Contains | Excludes |
| --- | --- | --- |
| Authoring input | language/provider/config/dependency generation + actual source/module closure | attempt time、Git transport |
| Attempt envelope | ActionKey + attemptId + deadline + lease + provider binding + settlement | pure semantic identity |
| Frozen Evidence | exact candidate content/generation only when Claim observes it + environment/result | cache/authoring identity as proof |

```text
VerificationActionKey = ActionKey(
  canonical producer revision,
  normalized operation,
  actual subject closure,
  Gate/Claim contract,
  environment/tool/provider semantics,
  dependency topology
)
```

branch、PR、session、wall clock、PID、temp path、lane 不进入 ActionKey。whole-tree digest 只在 Gate 真正观察 whole tree 时进入。

### 5.2 Resolution

```mermaid
flowchart LR
  K[Required ActionKey] --> R{Resolution}
  R -->|fresh terminal| Reuse[reuse PASS/FAIL]
  R -->|authenticated live| Join[join in-flight]
  R -->|missing/stale + absence claim| Exec[one physical execution]
  R -->|unknown start/outcome| Stop[reconcile / block]
  Exec --> S[settlement + readback]
  S --> T[immutable terminal Evidence]
```

Action builder纯计算，不为构造 key retain executable、启动 process/container或创建cache。terminal miss 且 runner 赢得唯一 start claim 后才取得 physical capability。start marker无terminal是 unknown outcome，不能靠新session/deadline/temp path replay。

cache hit/miss不签发 Result；provider availability只是negative circuit breaker，不是Effect authority。

## 6. Impact 与验证选择

Verification复用System Architecture唯一的`RequiredExecutionClosure`与`ExecutionSet`。本Domain只提供verification roots：changed semantic subjects → direct consumers → public/state/Effect/fixture/Claim dependencies → applicable Gates；不复制通用closure或reuse公式。

Impact只传播可证明关系；unknown edge产生保守 blocker/backstop，不允许假精确。plan/query zero Effect：在dependency preparation、cache write、process/provider start、network/fs mutation前返回selection。

测试读取生产文件或启动本地程序的关系，由同一 exact Source Program 的 observation producer 签发，并与静态 import 共同参与 consumer closure；它们保持独立的关系种类，不伪装成 import。调用绑定必须由现有 Program/TypeChecker 证明，目标必须属于同一 snapshot；动态参数、外部目标和无法证明的绑定保持 unknown。普通测试 helper 继续传播到可执行测试，不能被误当成遍历终点。

仅编译的测试输入必须同时属于 compiler-issued test 集合与 module graph，且没有 runtime consumer 或 entrypoint 义务，才可交给既有 typecheck Gate。文件后缀本身不构成豁免；selection resolved 也不代表 Gate 已执行或通过。未知诊断只报告实际未解析的路径，不能用全部 changed paths 代替精确 frontier。

Gate梯度：

```text
focused sentinel
→ affected authoring closure
→ candidate pre-freeze
→ frozen selected risk / hosted quick
→ virtual merge / release full backstop
```

不是每次固定全跑。`check:fast` 与 `check:affected` 只执行各自已选择的 authoring closure，不内嵌全仓 conformance audit，也不声称全仓 clean；显式 static audit、full backstop 与 MainHealth 仍消费各自完整 Gate。昂贵 Evidence 在 candidate frozen 后按 ActionKey 生产一次；同输入 PASS/FAIL/in-flight 分别 reuse/stop/join。

## 7. Candidate、Scope、Session 与 MainHealth

### 7.1 Identity chain

```text
Authoring → CandidateContent → FrozenGeneration → Published/Merged → New-main readback
```

content identity 与 transport generation 分离。Impact/Action消费实际 content closure；Session/PR/Review/Promotion消费各自要求的 exact generation。head变更会使 Review/attestation/Promotion stale，但不自动使语义未变的 ActionKey stale。

### 7.2 Scope

| Object | Owns |
| --- | --- |
| Scope proposal | requested paths/capabilities only |
| Scope grant | exact base、authorized/forbidden Effects、resources、trust epoch |
| Candidate attestation | candidate delta/effects ⊆ grant |

manifest/PR/candidate/self-digest 不能扩权。scope或authority变化产生新 grant。

### 7.3 VerificationSession

Session 只协调并引用 Task Capsule、Scope、Action/Result/Evidence、Review、MainHealth、Integration；不复制其字段/authority。Managed Continuation只reconcile事实和下一transition。

```mermaid
stateDiagram-v2
  [*] --> Oriented
  Oriented --> Planned: scope + impact + claims
  Planned --> Executing: admitted actions
  Executing --> AwaitingEvidence
  AwaitingEvidence --> ReviewReady: aggregate sufficient
  ReviewReady --> IntegrationReady: independent review + live health
  IntegrationReady --> Merging: single-use authorization consumed
  Merging --> Readback
  Readback --> Complete: new-main exact result + closeout
  Executing --> Blocked: unsupported/unknown/recovery
  Merging --> RecoveryRequired: response lost/ambiguous effect
```

每个 external Effect 前重读 operation-specific grant/provider/deadline。journal帮助恢复，不创造 Result/Review/merge truth。

### 7.4 MainHealth

同一 fresh exact default observation互斥投影：

| State | Legal route |
| --- | --- |
| ordinary | work selection / ordinary operation |
| repair | only owner-issued repair decision |
| locked | no work selection/effect |

incomplete/stale/duplicate/provider-conflict/unknown → locked。MainHealth是external/default ledger，不是Session cache或candidate baseline。

Publication 的 T1/T2 比较由 MainHealth owner 的同一 stable projection 编译：绑定 exact repository/default branch/main/tree、Runtime authority、本地物理 preimage、hosted health epoch 与 producer provenance，以及 repair/supersession 的语义和持久身份。重新采样产生的时间戳及其派生 byte digest 不改变 publication identity；provider、subject、preimage 或 prepared Effect identity 改变必须使比较失败。测试联合观察复用此投影，test-origin capability 仍不能调用 production publication。

```mermaid
flowchart LR
  T1[MainHealth T1 observation] --> S[Owner stable projection]
  T2[MainHealth T2 observation] --> S
  S -->|different or unknown| R[Reject publication and refresh]
  S -->|equal| P[Publish bound routing observation]
  P --> A[Effect owner revalidates complete current authority]
  A -->|issuer expiry preimage lease or provider invalid| R
  A -->|valid single use grant| E[Supersession Effect and durable readback]
```

Stable equality 只裁决 publication；完整 hosted bytes、有效期、issuer/permission、local preimage、mutation lease 和 prepared intent 仍由原 supersession Effect admission 与 recovery owner验证，不能用 stable digest替代。

## 8. Failure、retry 与 proof reset

Failure record：

```text
code + phase + Gate + owner + invariant
+ exact input + minimal reproduction + fingerprint
+ invalidated Evidence + cleanup state
+ next action + retry policy
```

| Condition | Action |
| --- | --- |
| same input + same deterministic fingerprint | reuse failure; stop repeat |
| observable transient cause changed | bounded retry |
| provider/process started, terminal missing | join/readback/reconcile; no replay |
| repeated frozen invalidation same root | proof reset to owner/model/fixture/selector architecture |
| cleanup/readback failed | preserve primary + settlement residue |

删除test、弱化assertion、无界加timeout、重复到绿、换Provider或unsupported→skipped 均不能消除 failure。

## 9. Typecheck 与行为测试

Typecheck证明指定 compiler/toolchain下 source/public contracts 可构造；behavior tests证明运行行为。两者不互替。

普通 TypeScript delta：

```text
stabilize source/import/generated closure
→ run affected/incremental canonical compiler proof
→ reuse same-input terminal
→ one frozen full proof only when Claim requires
```

不得每个 finding 后裸 full typecheck；也不得用 Review/test 代替 compiler proof。用户省略行为测试不自动省略 pure zero-write compiler proof；显式省略时只能标 `compiler-proof-missing`。

## 10. Hermetic Runtime 与 effectful-test supervisor

```mermaid
flowchart LR
  P[Prepare] --> A[Allocate]
  A --> E[Execute]
  E --> T[Terminate all children]
  T --> C[Owner cleanup]
  C -->|retirement failed| F[Preserve lease and live parent authority]
  F -->|same owner retry| C
  F -->|owner proven dead| S[Successor checks original generation identity]
  S -->|reclaim failed or successor dies| D[Retain original durable recovery identity]
  D --> S
  S -->|reclaim settled| C
  C -->|all resources settled| R[Independent readback]
  R --> X[One Gate terminal receipt]
```

resource classes：immutable-copyable、rebuildable、identity-bound、process-bound、non-copyable-control-state、external-capability、unknown。unknown 不复制/共享/并行。

effectful-test supervisor绑定 exact Action/child plan、one absolute deadline、aggregate budget和cancellation。primary failure/cancel/deadline 后停止新admission，终止已启动 children，settle streams，cleanup/readback，再发布 terminal。Promise timeout、parent exit、finally log 不足。

本地 slow suite 的 `logicalRunTimeoutMs` 由 test-budget owner 拥有，表示一次 admission 至观察器 terminal settlement 的总预算；Bun per-case timeout 不得延长它。依赖准备先由既有 dependency owner 完成。执行 compiler 绑定 owner-issued test inventory、对应 budget generation、唯一 suite/files、cwd 与 canonical argv；普通 DTO、缓存 WeakSet 或自写 digest 不能签发成员身份或执行权限。令两个 provider capability acquire/binding 前固定的 admission 时刻为 `A`、总预算为 `L`、既有 settlement margin 为 `M`，则 `Dlogical = A + L`、`Dchild = Dlogical - M`；child requirement context 绑定 `Dchild`，observer context 绑定 `Dlogical`，绝对期限参与同一 opaque context 的 digest。retain、observer arm/ready 与后续耗时均只缩短剩余窗口，不能从后续 acquisition 时刻或 ready barrier 重新计时。observer physical owner 先准备 retained roots 与 binding，绑定 operation 后才启动 worker。

上述 slow-suite semantic operation 由 retained command provider 与 repository observer physical owner 分别绑定 child 与 observer requirements，收齐 bindings 后才能执行；只准一个 Bun child，沿现有 ProcessResourceSession ledger 结算。runner 保留套件准入与预算来源验证；physical observer 只消费既有 foundation 签发的 single-consumer requirement binding context、exact operation 和自身 retained capability，不能反向导入测试策略。prepared observer 只保留物理 roots/binding，不接受 caller deadline；arm 从 operation 的绝对期限与 context 的 duration ceiling 得到剩余窗口。该 bound contract 的时长由已准入 operation 约束，普通命令和未绑定 observer 仍受五分钟上限约束，caller 数字不能扩大权限。slow/full lane 按唯一 suite registry 逐 suite 消费这一入口；exact slow files 无唯一归属、来源未签发、身份漂移、重复消费、过期或取消均在 Effect 前拒绝。不得保留含义模糊的 suite `timeoutMs` alias、全 slow 文件共用无归属 child 或第二执行器。宿主是否 GitHub Actions 不参与本地执行语义。

affected selection 的预算只拥有 source acquisition、selection compilation 与 selection readback，不得借给后续测试执行。fast batch 由同一 test-execution-policy owner 消费 exact issued test inventory/TestBudget、canonical argv/cwd 与实际 dispatch DAG；总预算为既有 bounded source revalidation ceiling、每个并发 wave 的最大 child supervisor ceiling 之和，再加入既有 settlement margin。inventory 只从 owner-issued WorkspaceSnapshot 的可执行测试路径投影，不因 tsconfig 的类型检查排除项改变 Bun 测试选集，也不要求完整语义编译或可命中的缓存；affected selection 仍消费其实际需要的完整 TestImpact。admission 固定一次绝对期限，不从 observer ready 或后续 child 启动重新计时；未知成员、队列、来源或预算不能以 caller 数字补齐。batch observer 先 arm，随后在其连续观察区间内执行最终 source revalidation、既有 child dispatch 与 settlement。revalidation 使用独立签发的有限 operation，不能复用 selection 已结算的 process session 或延长其原 deadline。selection 到 execution 的衔接依赖 exact generation 的重新验证，不能声称未观察的间隙具有连续性。direct fast、affected 与完整检查的 fast lane 消费同一执行 owner；外围 selection 或普通命令 fence 不能继续包住超出其预算的 batch。

```mermaid
flowchart LR
  S[Bounded source selection] --> P[Issued exact test plan and budget]
  P --> A[Fixed batch admission from dispatch DAG]
  A --> O[Arm retained repository observer]
  O --> V{Revalidate exact source generation}
  V -->|current| E[Existing child dispatch and resource queues]
  V -->|stale or unknown| R[Reject before child Effect]
  E --> T[Child and resource settlement]
  T --> F[Observer terminal and one batch outcome]
  R --> F
```

fast batch 的普通测试文件由一个 Bun 原生 `--parallel` worker pool 调度，`--isolate` 隔离文件全局上下文；worker 数和每个 worker 的测试并发共享既有 aggregate resource budget。SEC 不再切分固定大小的普通文件 shards 或实现第二个 worker scheduler；canonical argv 使用精确相对路径，caller 不得覆盖 worker、隔离或文件选集选项。涉及进程环境、cwd、完整进程生命周期或共享宿主资源的文件仍消费既有资源队列和独立 invocation，不能由 JavaScript 上下文隔离推断操作系统状态已恢复。`--no-orphans` 补充 Bun 子进程退出清理，不替代 retained process identity、observer 和 settlement。实际 dispatch 消费已签发的普通 pool 与资源阶段，不另行重建队列。logical budget 是整个 batch 的有限总 allowance，不承诺每个 child 用满自己的 ceiling 后仍无条件完成。所有 process-temp、Runtime State/Cache/TMP cleanup 与 authority release 消费同一 `Dlogical`；尾部 margin 是保留窗口，不是每个 cleanup 可重新领取的时长。cleanup 可使用 batch 未消耗的时间，但不能续窗；过期或尚有在途操作时保留未结算资源与 capability，不能把 observer 到期或 Promise 返回当作 cleanup terminal。外层异常清理只补尚未执行的路径，不以相同输入重试已失败的 cleanup。

test invocation retirement 开始后禁止新 generation；子资源清理失败保留其 recovery lease
及仍有效的 parent physical authority，已结算资源不在重试中重复删除。只有全部子资源与
lease 结算成功才释放 parent authority。死 owner 接管消费
[Workspace physical authority](../runtime-and-distribution.md#11-workspace-physical-authority)
的持久恢复身份与确认协议。普通异常测试不证明连续进程退出的恢复；必须验证原
generation 经再次接管仍可按原身份回收，且 foreign/identity-unknown residue 保留。
恢复失败不是 terminal。

同一 workspace 的独立 direct invocation 保持并行隔离，各自拥有唯一 invocation identity；不能用 workspace 单例 key 代替资源回收。恢复发现只消费既有 test-process mutation-lease namespace 的有界直接清单，并由 lease owner 签发 dead-owner reclaim；live owner 不受影响。State、Cache 与 TMP 的恢复逐一消费其原始物理身份，不能从目录名推导删除权限。创建后、身份持久发布前中断的 intent-only residue 保持 typed unknown 和原 recovery lease；当前物理创建能力不提供这一窗口的自动回收保证。

原 TMP parent/container 的恢复记录在 State staging 中发布，其字节摘要与 State 物理身份、invocation、lease owner 一起进入最终 generation binding；解析成功或 JSON 内的 owner 字段不能代替该绑定。恢复消费同一份已验证字节，记录改写或未发布保持 unknown。State 持有该恢复记录，因此只能在 TMP、Cache 完成结算后退役；State 缺失也不能证明 TMP 已结算，必须由对应 lease owner 确认。清理扫描与实际退役共用同一次有限期限，并受原 `Dlogical` 收窄；无父操作的通用清理默认窗口不得再次截断已签发的父操作期限。

untrusted package/build/test/provider需要 credential-free sandbox、bounded fs/network/process/resources和cleanup Evidence。temp dir、Node VM、browser context或lint不是恶意代码 sandbox。
