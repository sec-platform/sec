---
title: Semantic Mutation 事务
status: stable
domain: semantic-mutation
last-reviewed: 2026-08-13
---

# Semantic Mutation 事务

本文拥有受限语义意图到 Authoring/Governed Source transaction 的状态机、权限分层、计划/执行分离、writer协调、原子发布和恢复不变量。精确request/plan/result union、operation registry、journal schema、diagnostic、path算法、lease实现和retention由 `src/compiler/semantic-mutation/**`、共享workspace writer authority及合同/fault tests拥有。

## 定位

Semantic Mutation不是“让AI改文件”，也不是任意patch executor。它把一个受限intent在平台重新派生的authority、owner、source mapping、Delta/Impact和Verification边界内，转化为可计划、可拒绝、可提交或可恢复的canonical transition。

它只修改Authoring Source、Governed Source或相应domain的受权威输入。Engineering IR、Target IR、Projection、Artifact、Evidence、journal和`control/**`不能作为caller指定的写目标。

## 角色与权力

- **Caller / User / AI / CLI**：提交intent、target、允许的参数和业务expectation；
- **Product Policy**：把caller身份、workspace policy和operation request组合为authorization draft；
- **Operation Registry**：拥有支持的semantic operation、target kinds、required inputs、source adapters和minimum Verification；
- **Source Ownership Resolver**：从validated state解析唯一owner、canonical path和writable region；
- **Planner**：只读构建deterministic plan；
- **Transaction Executor**：在writer lease内重新计划、执行、发布和恢复；
- **Compiler / Delta / Impact / Verification**：独立产生canonical state、actual change、影响和验证结果；
- **Journal / Recovery**：持久化事务事实，不拥有产品语义。

Caller不能提交或伪造path、source bytes、source owner、Fact Delta、Impact、risk、required passes、minimum Verification、rollback decision、lease token、journal state或terminal result。

## Authorization 交集

最终权限是所有边界的交集，而不是任一宽权限的并集：

```text
caller capability
∩ allowed operation
∩ semantic target
∩ canonical source owner
∩ physical writable path/region
∩ preconditions and must-preserve facts
∩ policy and forbidden effects
∩ Target/Provider capability
∩ minimum Verification
∩ current workspace/candidate revision
```

任一项unknown、ambiguous、stale、conflicted或不兼容时拒绝或blocked；不能通过另一个Provider、AI confidence、文件存在或管理员权限自动补齐。

Authorization绑定workspace、app/domain、operation contract revision、target identity、base semantic/source revisions、policy revision和expiry。旧authorization不能跨workspace、rebase、owner migration或operation registry升级复用。

## Operation Registry

每个operation必须有唯一identity和versioned discriminated schema，并声明：

- target kinds和required semantic predicates；
- caller可提供的参数和明确禁止的derived字段；
- source owner/adapter requirements；
- allowed/forbidden paths、Effects和external capabilities；
- preconditions、must-preserve和postconditions；
- expected Delta shape和额外变化政策；
- minimum Verification和unsupported behavior；
- idempotency、retry、rollback/recovery与compatibility；
- positive、negative、concurrency、fault和round-trip tests。

新增operation不能在transport/UI另写一套switch。不存在registry entry时unsupported-before-write，不降级为任意source patch。

## 计划阶段

Plan/dry-run固定只读：

```text
validate raw request
→ resolve authorization and current validated base
→ resolve unique semantic target and source owner
→ resolve canonical path/region and source-byte identity
→ run isolated deterministic transform
→ rebuild validated canonical state
→ compute actual Fact/Entity Delta
→ compare expectations and postconditions
→ compute Impact and unknown frontier
→ derive conservative Verification union
→ classify risk/capability/resource requirements
→ emit immutable plan or blocked diagnostics
```

Plan必须绑定：operation/authorization revisions、base semantic/source/artifact revisions、source bytes digest、owner/path proof、expected/actual preview、Impact、Verification、provider/toolchain/profile revisions、estimated Effects/resources和expiry。

Plan不能写live source、创建live journal terminal、获取长期writer authority、启动不需要的production side effect或把staging bytes当作未来authority。

## Source Mapping 与 Path Proof

Semantic target到物理source的映射只有一个canonical producer。Path proof至少验证：

- repository/workspace identity；
- canonical repository-relative POSIX logical path；
- target-platform physical resolution；
- owner、writable region、generated/governed/opaque分类；
- symlink/reparse/junction/case/Unicode/path containment；
- file type、mode、source-byte digest和expected revision；
- forbidden `control/**`、journal、IR、Evidence和unowned区域。

绝对路径、UI传入路径、Provider related files、glob命中或字符串拼接都不能获得写authority。Mapping不完整时fail closed；Brownfield opaque region只能执行其显式adapter允许的operation。

## Isolated Transform

Transform必须在隔离root或内存模型中执行，输入只来自frozen plan所引用的authoritative source和validated context。它需要：

- deterministic output和canonical formatting策略；
- 保留comments、format和unowned regions的明确合同；
- 不执行ambient install/build/script/network，除非operation显式要求且有Provider capability；
- 不读取未授权secret/environment；
- bounded output、time、memory、process和network；
- parse/type/canonical rebuild失败时无live副作用。

AST/LST/codemod/AI结果都是transform实现或proposal，不自动证明semantic parity。

## Expectation、Delta 与 Impact

Caller可以声明业务expectation，但actual Entity/Fact/Assertion Delta由统一canonical producer计算。Planner/Executor检查：

- required change是否出现；
- forbidden change是否出现；
- must-preserve事实是否保持；
- additional changes是否在显式allowance内；
- source/artifact changes是否能追溯到semantic change；
- unknown/opaque/impact frontier是否超出authorization。

Predicted preview不能在apply后复用为actual。Lease内重建结果与plan不一致时必须重新plan或拒绝，不能只更新显示摘要。

Impact只推荐下游consumer/Acceptance/Gate；最终Verification plan由其owner结合Repository、Target、platform和Evidence重算。Caller不能降低minimum Verification或把not-run/unsupported当pass。

## Apply 与并发

Apply固定执行：

```text
validate request + expected plan identity
→ acquire unique workspace writer authority
→ reread live source/canonical state/policy/providers
→ re-resolve owner/path and re-plan
→ compare plan equivalence / CAS
→ open durable transaction journal
→ stage exact writes and backup/recovery material
→ run required pre-publication verification
→ publish atomically or by journaled protocol
→ rebuild live canonical state
→ recompute actual Delta/Impact
→ run post-publication/readback verification
→ terminalize accepted | rejected | rolled-back | recovery-required
→ release writer and cleanup with receipt
```

Apply不信任旧staging、旧path proof、旧Provider index或旧Impact。所有live writers服从同一个workspace writer authority；不同operation即使路径不同，也只有在未来domain/resource resolver证明安全时才能并行。

Source-byte CAS和semantic CAS同时成立才可发布。另一个writer、manual edit、rebase、owner migration、policy change、Target/Profile change或Provider invalidation都会使旧plan失效。

## Publish Boundary

发布前必须知道所有planned writes、deletes、renames、mode和artifact effects。多文件变化不能用逐文件“尽量成功”实现原子性；需要staging、journal、commit marker和recovery protocol。

Publication result至少区分：

- definitely not published；
- definitely published；
- durability/publication unknown。

不确定状态不能删除backup、journal或潜在authority。Process返回、文件存在、rename调用成功或parent directory未fsync都不足以单独证明durable commit。

## Terminal Result

产品级terminal只有：

- **accepted**：authoritative inputs已发布，live canonical rebuild与required Verification/readback通过；
- **rejected**：没有发布live changes，原因和next action明确；
- **rolled-back**：曾可能/已经发布，但exact prior bytes、modes和base canonical state已恢复并验证；
- **recovery-required**：无法证明accepted或exact rollback，需要唯一恢复流程。

不存在`partial-success`、`accepted-with-warning`、`failed-but-files-written`或“产品测试通过所以忽略cleanup”。Blocked是plan状态，不是伪terminal。

## Rollback

CAS-safe rollback必须避免覆盖后继合法writer或用户变化：

- 只恢复本transaction拥有且仍匹配published identity的路径；
- 使用journal记录的prior bytes/mode/absence和directory effects；
- 恢复后重新构建base canonical state并验证revision/observable contract；
- 不删除后继generation、unowned文件或不确定publication；
- rollback本身失败/中断继续保留recovery-required。

Artifact rollback从accepted canonical revision重新生成，不用旧artifact copy冒充authority。数据/外部系统rollback取决于change-management定义的migration/compensation策略。

## Journal

Journal是append-only或等价durable transaction governance state，至少绑定：

- transaction/operation/authorization/plan identity；
- workspace、base/live revisions和writer lease；
- source owner/path proof和write set；
- prior/staged/published identities；
- phase transitions、verification refs、cleanup和terminal result；
- recovery preconditions和retention/compaction lineage。

Journal不是Engineering IR、Authoring Source、Evidence替代品或UI状态。Terminal replay只能返回retained result，不重新执行副作用。Compaction必须保留active/uncertain/recovery generations和terminal lineage；不能按时间或文件数量删除唯一恢复证据。

### 持久 revision 的序列化版本

已发布的 Semantic Mutation v1 journal format 与 v2 contract revision domain 使用普通
`JSON.stringify` 的 insertion-order bytes 计算结构化 `sha256:` identity；这项序列化是对应
版本的一部分，不随平台通用 canonical primitive 的实现变化。Reader 与 writer 必须通过
`src/compiler/semantic-mutation/canonical.ts` 的唯一 digest owner 计算这些 revision，
包括 request、authorization、plan、verification、result、recovery、terminal 及 isolated
verification bindings；source、artifact、bundle 与 stream bytes 仍使用 raw byte digest。

同一 format/contract revision 不能同时接受或生成第二种结构化序列化，不能在读取时重算、
改写或删除历史 journal。若未来采用 sorted-key canonical JSON，必须先发布新的显式
format/contract revision，由 version-dispatched reader、migration receipt、retention 与旧 writer
consumer-zero 退出条件共同完成迁移；未声明版本的算法漂移必须 fail closed 并作为 compatibility
defect 修复，不能用 fixture refresh 或永久 dual-read 掩盖。

## Crash 与 Recovery

Recovery从read-only inspector读取workspace writer和journal状态，分类：

- 未开始publish：安全拒绝并清理staging；
- publish未发生且可证明：恢复not-published terminal；
- publish已完成但post-check未完成：重建live state并继续验证；
- 部分/未知publication：按journal和path CAS恢复或进入operator-required；
- prior rollback中断：继续同一recovery，不创建新普通operation；
- owner仍live或状态拓扑不可信：停止，不抢占。

Recovery必须幂等、可重入并绑定exact transaction/generation。超时不自动证明owner死亡；Windows/Unix/process/filesystem Evidence分别验证。

## Verification

Minimum Verification来自operation、changed semantic owners、Impact、Target/Profile、source/artifact和platform capability的保守并集。至少区分：

- pure semantic/contract validation；
- source parse/typecheck/build；
- affected Acceptance；
- artifact/package/runtime/browser/native；
- rollback/recovery/fault；
- documentation/release/consumer contract。

Pre-publication验证用于阻止已知无效变化；post-publication/readback验证证明live state和observable结果。未执行、unsupported、stale、cleanup失败或unknown Impact不能显示accepted。

## Product Adapter 与 Transport

CLI和AI caller使用同一product adapter：raw DTO validation和local trust checks之后，调用canonical plan/apply/query/recover。Transport不实现owner、path、risk、Delta、Impact、Verification或terminal switch。

Local HTTP mutating route必须在读取workspace前验证loopback/Host/Origin/capability并脱敏错误；apply绑定expected plan revision。UI不能通过直接刷新本地state把blocked/recovery-required改为成功。

## Retention、Audit 与隐私

持久记录只保留恢复、审计、Provenance和策略要求需要的最小数据。Secret、credential、source bytes、absolute host paths、AI prompt和环境变量按分类redact/encrypt/omit；backup/journal有owner、permission、expiry和安全删除条件。

Audit记录operation/caller/product policy、authorization、plan/result digests、actual source/Fact Delta、Verification和terminal，不需要保存模型隐藏推理。

## 支持与扩展

首个operation不能被泛化为“任意Semantic Mutation已完成”。每个新operation独立通过registry、source adapter、positive/negative/concurrency/fault/rollback和product acceptance。

跨domain Mutation（Documentation、Gate、Agent、Release、Repository）在相应Workspace domain建立raw/validated state和single writer前保持proposal，不能复用source mutation名称绕过domain authority。

## 验收

- Caller无法提交derived authority、path、Delta/Impact、risk或terminal字段；
- plan/dry-run无live write且byte-stable；
- owner/path proof处理symlink/reparse/case/Unicode和opaque boundary；
- apply在lease内重新计划并同时验证source/semantic CAS；
- 并发writer只有一个可发布，stale plan确定性拒绝；
- publish前失败无live变化；publish后失败只能rolled-back或recovery-required；
- crash/fault遍历每个journal/publication/cleanup边界；
- rollback不覆盖后继writer并能重建exact base canonical state；
- accepted绑定actual Delta/Impact和required Verification/readback；
- terminal replay不重复副作用；
- CLI/Agent消费同一adapter和结果；
- 至少一个canonical operation和一个Brownfield governed-source operation完成真实physical proof。
