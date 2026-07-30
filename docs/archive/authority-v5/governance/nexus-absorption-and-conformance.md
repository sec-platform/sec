---
title: SEC × Nexus Conformance Corpus 与 Policy Pack
status: active
last-reviewed: 2026-07-23
---

# SEC × Nexus Conformance Corpus 与 Policy Pack

本文是`QzCrane/nexus`作为SEC首个完整Engineering Workspace Conformance Corpus时的唯一 Nexus 规范。它定义Census、机制裁决、EPR、Skills、Parity、迁移和退役门，但不定义第二套 SEC Core。

Nexus不是SEC Core模板。Nexus中的Bun、SPECTRA、HALO、Chrome、WebAudio、locale、EPR编号和具体路径只能进入Target Profile、Project Policy Pack、Adapter或fixture。

## 0. Authority 边界

本文件第5～46节的EPR、Skill、Toolchain、CI、Release、Privacy和Agent条款都是 **Nexus-derived conformance requirements**：它们用于要求 ledger 建立 `source requirement → SEC canonical owner → decision → parity/retirement evidence` 映射，不因写入本文就成为已吸收机制、当前能力或通用SEC权威。

| Requirement domain | SEC canonical owner |
|---|---|
| 文档owner与生命周期 | `docs/00-文档索引与一致性规则.md` |
| Engineering IR、identity、Delta、Impact、Mutation | `docs/14-Engineering IR与语义事实规范.md` 与对应代码/contract tests |
| Workbench、transport与local trust boundary | `docs/11-Workbench与可视化规范.md` |
| Agent execution、Work Package与Gate复用 | `AGENTS.md` 与 `docs/04-AI自主实现执行蓝图.md` |
| CI/test lane与current revision | `docs/test-feedback-and-ci-lanes.md` 与 `platform/shared/ci-verification-plan.ts` |
| Provider/MCP | `docs/governance/external-capability-and-provider-policy.md` 与 ledger |
| Nexus Census/Parity/Retirement当前状态 | 本文件、`nexus-absorption-ledger.yaml` 与 report |

若本文件的通用表述与上述 owner冲突，必须修正本文件并以 canonical owner为准；不得用 Nexus EPR反向改写 Core。每个 requirement 在 ledger 中仍为 undecided/missing 时，只能称为Corpus候选，不得声称已吸收。当前 exact baseline、coverage和完成结论只由 ledger/report记录，本规范不复制动态计数。

## 1. 完整吸收的严格定义

只有同时满足以下四个100%，才能使用“无遗漏吸收完成”：

```text
100% tracked-path classification
+ 100% mechanism decision coverage
+ 100% accepted-mechanism parity evidence
+ 100% owner / consumer / retirement reconciliation
```

### 1.1 Tracked-path classification

- exact Nexus baseline下每个Git tracked path均已分类；
- 每个路径标明authority、implementation、projection、generated、test、evidence、migration alias、archive、vendor、fixture、toolchain、workflow、release surface、public surface或ordinary product code；
- `unclassified`必须为0。

### 1.2 Mechanism decision coverage

每个识别出的机制只有一种决策：

```text
absorb-core
absorb-domain-ir
absorb-policy-pack
absorb-adapter
retain-project-specific
superseded
reject-with-rationale
```

不得使用`mentioned`、`later`、`probably covered`或仅有标题无裁决的状态。

### 1.3 Parity evidence

所有决定吸收的机制必须具有：

- positive parity；
- negative parity；
- failure parity；
- diagnostic parity；
- side-effect parity；
- migration parity。

不能只比较输出文案；必须比较合同、状态、诊断identity、失败边界和副作用。

### 1.4 Owner与退役

- 新SEC owner明确；
- 旧Nexus owner和所有消费者已定位；
- shadow parity解释全部差异；
- 生成物可重建；
- rollback可用；
- 真实e2e通过；
- 旧实现只有在上述条件满足后才退役；
- 不允许长期双writer或双authority。

## 2. 基线与持续漂移

每个Census revision记录：

```yaml
sourceRepository: QzCrane/nexus
sourceCommit: <exact-sha>
sourceTreeDigest: <deterministic-digest>
secRepository: sec-platform/sec
secBaseCommit: <exact-sha>
censusVersion: <integer>
capturedAt: <timestamp>
```

Nexus baseline变化后：

```text
old baseline
→ git diff --name-status
→ classify added/modified/deleted paths
→ update mechanism ledger
→ run affected parity
→ issue new census revision
```

旧Census不能证明新Nexus完整。

## 3. 全仓Census范围

### 3.1 Repository inventory

至少采集：

```text
git revision和tree
working tree状态
tracked paths和modes
submodules
attributes
symlinks
executable bit
generated/vendor/archive/fixture/binary
ignored但release相关的source
independently deployed surfaces
public repository targets
Git hooks和Git配置依赖
```

禁止只依赖GitHub Code Search或Markdown搜索。

### 3.2 Executable entrypoints

发现并追踪：

- root和nested package scripts；
- CLI；
- build和generator；
- architecture verifier；
- docs checker；
- release和public sync；
- Git hooks；
- AI host hooks；
- GitHub Actions；
- browser/Playwright/Chrome tests；
- remote deployment gates；
- registry和localization generators；
- lifecycle scripts；
- store/release tooling；
- integrity scripts。

每个入口追踪：

```text
declared command
→ physical executable
→ input owner
→ generated outputs
→ side effects
→ runtime/toolchain
→ failure semantics
→ tests
→ consumers
```

### 3.3 Authority和文档

覆盖：

- repository rules；
- AGENTS/CLAUDE和Skills；
- docs authority map；
- engineering principles；
- product strategy和roadmap；
- business hypotheses和research；
- architecture、protocol、security、privacy、permission；
- store copy和locales；
- release instructions；
- archive、redirect和generated mirror；
- public README；
- remote-site docs。

每个active document记录type、lifecycle、audience、owner、canonical path、links、projection、evidence scope、freshness和executable consumers。

### 3.4 Runtime和产品机制

不得跳过普通产品代码中沉淀的通用机制：

- authority；
- desired/actual/ACK；
- identity/generation/revision；
- READY barrier；
- unique writer；
- lease/disposer；
- admission；
- pure reads和observation commit；
- transaction和compensation；
- failure isolation；
- event attribution；
- recovery；
- structured errors；
- validation；
- least privilege；
- authenticated remote；
- privacy/data flow；
- Zero Neutral Work；
- bounded concurrency；
- dependency direction；
- registry/manifest/permission/localization projection；
- production artifact verification。

项目具体值可保留在Policy Pack，机制必须裁决。

### 3.5 Public和deployed surface

覆盖：

- source workspace；
- production extension artifact和ZIP；
- manifest、permissions和CSP；
- remote site；
- public repositories；
- README、Privacy、Store copy和all locales；
- licenses、checksums、receipts、tags/releases/submission status；
- browser和external provider policy dependencies。

只审计私库文件不能证明发布系统完整。

## 4. EPR绑定合同

每条EPR必须绑定：

```text
Nexus EPR
→ SEC invariant / policy
→ affected IR entities
→ positive acceptance
→ negative acceptance
→ failure acceptance
→ historical regressions
→ applicable Gate
```

以下29项全部必须完成。

## 5. EPR-001：单一事实源

- 每个领域一个canonical owner；
- alias、cache、UI、transport和projection只读；
- 迁移路径不能形成第二writer；
- duplicate owner检测进入Gate。

SEC映射：Authority Graph、Source Ownership、Generated Projection Ownership。

## 6. EPR-002：Desired、Actual、ACK与Optimistic分离

- request/setter/storage write不等于成功；
- ACK需要实际readback、event或processor evidence；
- optimistic state失败必须rollback；
- 状态模型推广到Workbench Mutation、Agent Task、Gate、Release、Toolchain和Public Deployment。

## 7. EPR-003：ACK绑定身份、generation和revision

- ACK绑定scope identity、generation、revision和intent；
- late result不能更新新对象；
- navigation/restart/replacement使旧ACK失效。

## 8. EPR-004：READY是完整能力屏障

- READY表示依赖、owner、resource和health都满足；
- initializing、degraded和failed可观察；
- cache invalidation和health probe明确；
- 不把“对象存在”当作“能力可用”。

## 9. EPR-005：Scope级唯一可写Runtime

- 一个scope一个writable runtime；
- 明确lifecycle、token/lease和consumer引用；
- 最后consumer释放resource；
- stale generation不能继续写入。

## 10. EPR-006：唯一writer和disposer

- 每个语义或物理字段只有一个writer；
- Adapter不能形成第二写路径；
- resource owner和disposer明确；
- duplicate listener/timer/queue检测。

## 11. EPR-007：按Capability选择最小完整策略

- 不用整页、整App或整工程的粗粒度mode代替能力选择；
- 用户声明目标，不选择内部实现路线；
- strategy必须完整满足capability contract。

## 12. EPR-008：不可逆资源按需Admission

- 昂贵、不可逆、特权和外部资源只有在闭合gate下建立；
- candidate失败恢复旧稳定路径；
- admission前不扩大权限或泄露状态。

## 13. EPR-009：规范身份与实际Activation分离

- canonical identity只有一个route；
- cache selection不等于actual activation；
- user-pinned和auto evidence优先级明确；
- instance state不污染persistent identity。

## 14. EPR-010：特权和外部动作前置Admission

- 不可逆、特权、网络、权限和用户激活前必须admit；
- terminal boundary不能通过扩大权限或继续猜测绕过；
- denied和unsupported是结构化结果。

## 15. EPR-011：读取纯净，观察显式提交

- read不产生write；
- observation成为authority必须显式commit；
- read、compare、revision、persist和publish分离；
- 不允许观察事件触发第二次回写循环。

## 16. EPR-012：控制事务和失败隔离

- control transaction串行或有明确并发语义；
- 字段/子操作失败隔离；
- 必要时补偿；
- 一个字段失败不能吞掉无关成功；
- atomicity由合同明确，不靠猜测。

## 17. EPR-013：Selection、Restore和Observation分离

- fact registry与selection engine分离；
- restore不伪装新selection；
- observation不直接改desired；
- 不同active target类型不互相清除。

## 18. EPR-014：事件先归因再改变状态

- 区分用户、系统、平台、remote和self-write事件；
- 系统自写事件不能伪装用户行为；
- event绑定identity/generation；
- 归因失败保持unknown而非擅自修改。

## 19. EPR-015：尊重平台原生生命周期

- 不能用模拟旁路平台真实activation、事件、getter和readback；
- handoff保存原owner baseline并可恢复；
- platform boundary失败是合法structured failure。

## 20. EPR-016：快捷操作的完整生命周期

- ensure、repeat、cancel和feedback显式；
- feedback只由明确intent触发；
- 一个intent一个feedback owner；
- repeat和replay防止重复副作用。

## 21. EPR-017：UI和可访问性受合同治理

- text、tooltip、icon、state和accessibility统一；
- i18n key完整；
- fallback可观察；
- reset和restore是不同Operation；
- UI不拥有业务事实。

## 22. EPR-018：观察只消费已有资源

- visualizer/observer不新建第二active resource；
- generation-aware lease；
- bounded in-flight和sampling；
- hidden/closed/error释放；
- 无active owner时零后台工作。

## 23. EPR-019：生命周期变化使旧状态失效

- navigation、update、restart、suspend和close使旧identity、ACK和lease失效；
- 恢复来自实际session/HELLO/evidence；
- 不依赖悬挂timer和stale cache。

## 24. EPR-020：结构化错误

错误至少包含：

- code；
- message；
- retryable；
- phase；
- causal identity；
- scope和generation（适用时）。

规则：

- retryable不授权越过安全边界；
- 禁止空catch、未处理Promise和泛化timeout；
- infrastructure failure与product failure分离。

## 25. EPR-021：边界输入验证

- message、sender、URL、origin、path、external bytes在边界验证；
- listener只拥有精确消息集合；
- unknown请求不误处理；
- secret不进入public projection；
- runtime validation不能被compile-time类型替代。

## 26. EPR-022：Authenticated Remote最小披露

- remote默认关闭；
- 认证前不披露状态；
- session、sequence和generation防重放；
- 单控制器或明确多控制器合同；
- capability boundary和最小数据披露。

## 27. EPR-023：Privacy与物理数据流一致

- Local-first不等于绝无网络；
- optional network明确opt-in；
- signaling、STUN/TURN/provider metadata和transmitted fields披露；
- retention和revocation明确；
- Manifest、Permission、Privacy、Store locales和artifact消费同一事实。

## 28. EPR-024：性能优化不牺牲正确性

- 不用猜测替代正确读取；
- 不跳过identity、READY和validation；
- 每项优化有可重现指标；
- lazy、coalescing、batching和trailing write保持语义；
- 性能证据有日期、范围和环境。

## 29. EPR-025：合同纯度和单向依赖

- contracts不导入runtime实现；
- public facade唯一；
- 禁止跨域deep import；
- 不复制wire shape；
- 按职责拆分，不按行数碎片化；
- dependency direction进入Rule Registry。

## 30. EPR-026：测试按机制匹配

- unit、contract、state、integration、browser和artifact分别证明不同性质；
- activation、navigation、restart和production artifact不能由unit替代；
- race需要多次和故障注入证据；
- skip和timeout调整需要独立理由。

## 31. EPR-027：每次变化形成可逆Closure

每次正式变化至少包含：

```text
contract
+ implementation
+ focused tests
+ owner docs
+ migration
+ public/release projection
+ rollback/recovery
```

Commit和PR应独立可理解、验证和回退。

## 32. EPR-028：Public Claim不超过Evidence

- `all`、`zero`、`any`、`guaranteed`、medical、no transmission等强承诺必须有明确scope和Gate；
- permission、activation、origin、CORS、DRM和closed boundary是合法限制；
- public copy是Release Evidence的窄Projection。

## 33. EPR-029：AI Hook、Git、CI和Review共用质量底线

- Hook是early feedback，不是security boundary；
- Workflow文件存在不等于CI执行；
- CI调用canonical scripts；
- actual GitHub check才是发布证据；
- Host Projection不能复制规则authority；
- stop checkpoint必须验证真实完成证据。

## 34. Project Skills全量绑定

baseline中的每个Skill建立AgentOperation：

1. add-dependency；
2. finish-feature；
3. lint；
4. new-module；
5. release-halo；
6. release-spectra；
7. sync-nexus；
8. test；
9. typecheck；
10. update-context；
11. verify。

每个Skill提炼：

- trigger；
- scope；
- owner discovery；
- allowed tools和Semantic Operations；
- physical path boundary；
- external fact requirements；
- prerequisite Gates；
- prohibited shortcuts；
- completion evidence；
- explicit authorization boundary。

### 34.1 Dependency governance

- 在最窄workspace安装；
- 先查重和平台能力；
- 查官方当前版本、license、maintenance、deprecation和CVE；
- 检查runtime/browser/worker/ESM、transitive deps、bundle、assets、network和ABI；
- runtime input仍需validation；
- 不维护会漂移的手工版本总表；
- 不使用模型记忆版本。

### 34.2 New module governance

- 先证明边界；
- 明确Responsibility、API、dependency direction、state/lifecycle/failure/test；
- 目录不是架构边界；
- public/private surface明确；
- 不通过新package逃避owner重构；
- 不复制应用模块冒充共享包；
- 不增加第二registry、owner或facade。

### 34.3 Test governance

- 按真实机制选suite；
- 跨context缺陷不能只跑最近文件；
- 纯函数不盲跑所有浏览器；
- regression测试先失败后通过；
- 不删、skip、弱化assertion或盲加timeout；
- flaky需要可复现的uncontrolled state；
- 单次成功不能证明race消失；
- snapshot更新审查语义；
- open handle/process/artifact泄漏是失败。

### 34.4 Typecheck governance

- 读第一个因果错误；
- 定位contract/runtime boundary；
- 检查duplicated DTO、stale generated type、dependency direction和discriminant；
- 先修model/validator，再修assertion；
- 禁止`as any`、blanket ignore和为兼容随意optional；
- generated type只从owner刷新。

### 34.5 Verifier governance

- canonical脚本拥有规则；
- 诊断有稳定Rule ID；
- 修owner，不加排除；
- rule change是行为变化，需positive/negative fixture；
- 当前violation不能成为削弱规则的理由；
- verifier不替代type/lint/test/browser/privacy。

### 34.6 Finish和update-context

- 最终Diff范围审计；
- 唯一Owner；
- 公共Projection按Impact更新；
- 不机械更新全部Markdown；
- 权限、数据流和网络变化必须影响README/Privacy/Permission/Store locales/remote/manifest；
- historical evidence保留日期和scope；
- 未完成Gate明确报告。

## 35. Agent source和Host Projection

- canonical Skills source唯一；
- 不复制`.skills/.claude/.codex`多套目录；
- frontmatter无损保留；
- index只读取必要top-level scalar；
- marker-based idempotent injection；
- deterministic skill ordering；
- AGENTS为入口和生成索引，不复制规则；
- CLAUDE/Codex为Host Projection；
- Projection equality/parity可验证；
- 外部工具破坏Projection后由host-specific repair Adapter恢复；
- generated projection无独立编辑权。

SEC目标：AgentSkillRegistry、HostProjection、ParityRule、GeneratedOwnership、HostRepairAdapter。

## 36. AI Hook和早期防错

- host wrapper足够薄；
- shared helper拥有stdin parsing、path normalization、command extraction、protected zones、exit semantics和checkpoint；
- pre-write guard；
- post-write focused feedback；
- shell guard；
- stop checkpoint；
- malformed payload不能意外allow；
- Hook不能让Host无限等待；
- synthetic payload smoke；
- protected/allowed path fixture；
- 各Host checkpoint parity；
- debug日志视为可能含敏感内容；
- Hook不是security boundary。

### AI pitfall rules

至少裁决：

- uncaught storage write；
- uncaught fetch；
- event listener disposer；
- dynamic fetch SSRF guard；
- serialized queue rejection chain；
- async browser message response lifetime；
- deep package import；
- retired/deleted type reuse；
- ESM relative import extension；
- deterministic diagnostics；
- changed-file focused mode；
- generated/vendor/dist skip；
- error/warning severity；
- heuristic scanner不冒充typechecker或authority；
- suppression窄且可审计。

## 37. Architecture Rule Registry

规则类型至少包括：

```text
DependencyDirectionRule
ContractPurityRule
UniqueWriterRule
ProtectedZoneRule
GeneratedOwnershipRule
PermissionDeclarationRule
ResourceReferenceRule
ForbiddenLiteralRule
PublicClaimRule
ModuleCohesionSignalRule
AgentHygieneRule
HostProjectionParityRule
RegistryConsistencyRule
LocaleCompletenessRule
```

Nexus业务字面量留在Policy Pack，不进入Core。

## 38. Toolchain Profile

必须统一：

- root command surface；
- runtime version；
- root/workspace manifest version；
- formatter/linter/build/compiler version；
- lockfile；
- 文档和配置版本引用；
- public target version；
- release runtime；
- toolchain profile owner；
- generated files修改入口；
- hook安装；
- external tool的版本和日期。

Toolchain变更自动Impact：

- manifests；
- lockfile；
- CI setup；
- Git hooks；
- Skills；
- docs/rules；
- release scripts；
- public target和generated repo；
- README/examples；
- runtime compatibility tests。

## 39. Registry、Plugin、Permission和Localization

从HALO类机制提炼：

- tool/script/system plugin type分离；
- system能力不能伪装普通工具；
- manifest拥有identity、type、category、loading和permission；
- directory与manifest一致；
- registry、loader和locale aggregate生成；
- UI/Background不维护第二inventory；
- plugin拥有自身state/lifecycle；
- panel不拥有关闭后仍运行的工作；
- persisted Background owner和wake/recovery；
- storage key namespaced/versioned；
- typed message contract；
- taxonomy和count是Projection；
- permission记录plugin、user action、install/optional/runtime、data surface、revocation、tests和public disclosure；
- Settings、permission manager和store copy消费同一source；
- locale source local、aggregate generated；
- name/description/action/error/accessibility locale completeness；
- inactive plugin Zero Neutral Work；
- build-time registry，不runtime scan；
- bounded batch/cancellation；
- reduced motion和error isolation；
- generated file不手改。

## 40. Git、CI和质量门

- pre-commit focused；
- commit-msg Conventional Commit；
- pre-push ordered gates；
- post-merge generated projection refresh；
- post-analyze repair；
- parallel只用于无依赖Gate；
- merge/rebase策略不能逃逸最终门；
- CI path selection；
- concurrency/cancel-in-progress；
- timeout；
- read-only permissions；
- frozen install；
- workflow调用canonical scripts；
- runner未启动是infrastructure failure；
- 实际check status而非YAML存在；
- 产品PR和trust-root PR分离。

## 41. Release Candidate、Artifact和Promotion

必须覆盖：

1. target version和exact source commit；
2. previous release/tag diff；
3. dirty/unexplained tree阻塞；
4. executable release plan owner；
5. ordered Gate list；
6. frozen dependency install；
7. architecture/type/lint/unit/browser/build/integrity/audit/remote deployment；
8. deterministic staging ZIP；
9. extracted artifact smoke；
10. source deterministic digest；
11. Gate期间source digest冻结；
12. source变化使release evidence失效；
13. archive/checksum/lockfile/source SHA-256；
14. required Gate receipt；
15. short-lived authenticated promotion capability；
16. receipt TTL和secure temporary mode；
17. promotion只在全部Gate后；
18. stale staging在开始和finally清理；
19. symlink政策；
20. deterministic path order；
21. source map/test/private docs/debug/remote/duplicate bundle审计；
22. ZIP固定大小不是正确Gate；
23. commit/tag/push/public sync/store submission独立授权；
24. store review status来自平台实际状态。

SEC目标：ReleaseCandidate、FrozenReleaseSource、GateReceipt、PromotionCapability、ArtifactIntegrity、PublicationAuthorization、ReleaseMutationStateMachine。

## 42. Remote Deployment Parity

验证：

- local source与live deployment SHA-256；
- MIME；
- CSP；
- Referrer-Policy；
- Permissions-Policy；
- X-Content-Type-Options；
- X-Frame-Options；
- COOP；
- 每项header唯一声明；
- base URL无credentials/query/fragment；
- timeout、manual redirect和bounded count；
- 禁止跨origin redirect；
- cache bypass和no-store/no-cache；
- 每个asset独立failure；
- 聚合diagnostics；
- root和explicit index；
- 远端实际值成为Release Evidence。

## 43. Private→Public Repository Projection

必须覆盖：

- 明确target、branch和remote；
- destructive action前处理未提交修改；
- 保留destination `.git`；
- 不移植private commit graph；
- filtered copy；
- private docs/agent/internal tests/assets排除；
- public README/Privacy/License projection；
- package metadata rewrite；
- clean install/build；
- generated artifact cleanup；
- 至多一个candidate commit；
- generator不Push；
- 完整Diff审计；
- 禁止source exclusion泄露；
- 错误Projection修source/generator，不手改生成仓；
- push/tag/release/store独立授权；
- 生成成功不等于授权。

## 44. Security、Privacy和Public Claims

- external message、sender、URL、origin、path、bytes验证；
- permission allowlist；
- 不扩大权限逃避设计；
- 不执行远程扩展代码；
- user-authored script sandbox；
- secret、credential、private key、session token不进Git；
- remote默认关闭；
- HMAC/sequence/replay protection；
- 最小披露；
- 物理流量、第三方provider、传输字段、retention和opt-in与Privacy一致；
- Manifest、Permission rationale、Privacy、Store locales、remote disclosure和artifact同源；
- Public Capability Set唯一；
- all locales投影相同能力和限制；
- 强承诺有明确证据scope。

## 45. Zero Neutral Work

一级Runtime Invariant：

```text
inactive / hidden / unowned / read-only
→ no recurring work
→ no resource acquisition
→ no polling
→ no hidden network
→ no unbounded listener / timer / queue / cache
```

覆盖Workbench、Agent、browser runtime、visualizer、plugin、CI watcher、release monitor、import provider和background service。

每个长期资源必须有owner、activation、lease、cancellation、disposer、hidden behavior、bounded queue、observable state和leak tests。

## 46. Historical Regression→Invariant

```ts
interface RegressionInvariantBinding {
  regressionEvidenceId: EvidenceId;
  invariantId: InvariantId;
  acceptanceIds: AcceptanceId[];
  affectedEntities: EntityId[];
  supersededWorkarounds: ArtifactId[];
  recurrenceCount: number;
}
```

要求：

- problem-to-principle和其他历史回归全部扫描；
- 历史修复不能只剩Commit Message；
- 测试说明保护哪个invariant；
- Gate有可追溯原因；
- 通用实现完成后删除旧workaround。

## 47. Parity类型

### 47.1 Semantic Parity

相同输入产生相同或更严格且可解释的判断。

### 47.2 Diagnostic Parity

稳定Rule ID、affected entity/path、failure class和severity；文案不要求逐字一致。

### 47.3 Side-effect Parity

新系统不能多写文件、多申请权限、多启动进程、多发网络或多发布。

### 47.4 Failure Parity

旧系统拒绝的危险输入不能被新系统放行；新系统更严格时需migration和rationale；未执行不能伪装通过。

### 47.5 Migration Parity

现有Nexus无需人工重写语义即可导入；identity稳定；owner唯一；generated output可重建；public projection不扩大；redirect/mirror和historical evidence保留。

## 48. Shadow Mode

正式替换前：

```text
old Nexus checker/generator
+ new SEC checker/generator
→ same corpus
→ compare decision/diagnostic/effect
→ classify every difference
```

差异只能是：

- 旧实现缺陷，SEC有证据修正；
- SEC缺陷；
- 项目特例；
- 有意强化；
- 仅输出格式不同。

`unexplained delta`必须为0。

## 49. Retirement Gate

旧实现只有同时满足以下条件才删除：

- 新canonical owner进入SEC；
- parity proven；
- 所有消费者迁移；
- generated output可重建；
- rollback路径；
- 文档和Skill更新；
- 真实Nexus e2e；
- 至少一次release candidate或等价端到端验证；
- 无unresolved discrepancy；
- 历史原因进入RegressionInvariantBinding。

## 50. 完成报告

报告至少包含：

1. exact Nexus commit和tree；
2. exact SEC commit；
3. tracked path count和分类统计；
4. executable entrypoints；
5. authority graph；
6. mechanism inventory；
7. EPR 29/29；
8. Skills全绑定；
9. scripts/workflows/hooks/generators/tests/release；
10. public/deployed surfaces；
11. accepted/rejected/retained decisions；
12. parity matrix；
13. unexplained deltas；
14. old implementations和retirement；
15. future delta procedure；
16. physical/tooling limitations。

完成门：

```text
Path coverage              100%
Mechanism decisions        100%
EPR bindings               29/29
Current skill bindings     100%
Executable entrypoints     100%
Generated owners           100%
Public claim projections   100%
Accepted parity            100%
Unexplained deltas         0
Unclassified               0
Unauthorized retirements   0
```

达不到时只能准确表述为Census或Parity进行中。
