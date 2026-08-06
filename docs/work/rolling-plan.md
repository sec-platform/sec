---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-06
---

# SEC 滚动近期计划

本窗口从 `main@334c7717e9ed7ed40c250be9a9acc2f2fea77d83` 重算。PR #310（frozen-digest-canonical-form-repair-v1）
已合并并完成 new-main readback，canonical sha256 修复
已进入 `main`。PR #308（implementation-resolution-architecture-convergence-v1）从新 main 重建并激活，
统一承载 Implementation Resolution 设计的 canonical owner 融合。`main` 已包含 #280 v1 的产品修复与
post-merge provenance 记录；原 PR #281 的转移仍是 `repaired` 而非 `authorized`，平台防复发继续由 #279
拥有。PR #289 的 external Evidence、audit 与 import 修复方向保留为实现来源，但 exact candidate 已关闭。

近期顺序遵循三条硬约束：

1. 先完成当前文档/信息物理收缩，消除重复 owner、原始聊天、历史正文和叙事 Evidence；
2. 随后闭合 default-branch health/Verification/TCB 根因，使所有后继只消费外部物理 Evidence；
3. P0/P1 integrity 只做聚焦修复，之后立即回到 Physical Workspace、Source Program、
   Responsibility、Workbench 单写路径和 IR-owned Backend，禁止治理任务无限饥饿产品线。

## 当前唯一 Work Package

### implementation-resolution-architecture-convergence-v1

- Issue #307；PR #308；从 post-#310 新 main `334c7717` 重建并激活。
- 将 Issue #307 中已审计的 Implementation Resolution 设计融合到现有 canonical owners，
  不提交并列总设计文档，也不新建第二 resolver/comparator/compatibility evaluator。
- 修改 14 个 canonical authority docs + `docs/authority.json` + byte-exact generated `docs/README.md`
  + 本 successor manifest；不修改 package/lock、workflow、产品源码或测试。
- 前驱 `active-documentation-corpus-convergence-v2`（Issue #235，PR #284）已合并，
  manifest 已退役；旧 Review、Gate、Evidence 不复用。
- 完成后关闭 #307，从新 `main` 激活下一个候选。

## 候选 Work Package

### 1. default-branch-health-and-verification-bootstrap-sequence

按独立聚焦包从 then-latest main 执行，不复活 PR #289 的混合 control-plane candidate：

1. Issue #280 A：全树 canonical import baseline closure；所有 frozen TCB blob substitution 生成
   exact closure delta 并由 trusted-base candidate-as-SUT/bootstrap验证；
2. Issue #280 B：repository-audit 只消费 canonical pointer/lifecycle resolver，删除
   `matching-default-blob` false positive，不恢复 `docs/archive/**`；
3. Issue #280 C：revision health 只由 producer→external artifact→projector 推导，保留真实
   deterministic/environment/unsupported/unresolved/applicability，不在源码自报 SHA、时间或 trusted；
4. #291 闭合 canonical ordinary-data、ordering、dedup collision、freeze 与 digest 信任面；
5. #237/#239 将 Physical execution、Gate/Claim、CI/GitHub/CLI projection 收敛为单一 Verification truth；
6. #178/#279 分层 TCB builder/schema/frozen lock/trusted-base verifier并完成最终 trust transition。

PR #289 的 commits/patches只作为实现来源；其旧 pointer、rolling plan、archive、Review、Gate和
Evidence一律不复用。一个 ordinary successor必须证明修复后的主干路径可正常工作。

### 2. repository-information-lifecycle-v1

- Issue #282；在 #280 新主干 readback 后，对 exact tracked tree 建立唯一信息生命周期分类和
  `unknown = 0` 门禁。
- 扩展现有 repository audit，不创建第二审计系统；报告进入 CI Artifact，默认不 tracked。
- 检测 raw chat、private URL、占位 Evidence、本机路径、stale provider profile、archive current
  consumer、重复 instruction owner、临时输出和未知 retention。

### 3. repository-integrity-closeout-sequence

按独立聚焦包串行执行，不合并成巨型治理 PR：

1. #247 `public-publisher-network-removal-v1`：删除 live-worktree copy 与 force-push 网络入口；
2. #244 `external-input-security-boundary-v1`：GitHub 外部自然语言、Workbench HTTP/DOM/远程资源和
   outbound handoff只作 untrusted data/explicit export，普通编译、emit、Verification保持零隐式网络；
3. #248 `ci-git-and-ai-provenance-hygiene-v1`：immutable Action、commit/staged-tree、logger、Git hooks与
   AI assistance provenance、no-bypass readback；
4. #303 `workspace-lifecycle-safety-v1`：普通init不得覆盖现有Plan/package/config/source，reset-derived
   与显式destroy分离；
5. #190/#305：普通Verification不得把Workspace测试/Slot代码导入SEC宿主进程；Slot静态禁词降级为
   lint，未有Capability Profile与隔离Provider时fail closed。

每个 child package 都必须删除真实旁路，不能只新增 schema 或说明文档。

### 4. physical-workspace-and-typescript-source-program-v1

按真实 consumer 分成有序纵切片：

1. Issue #294：先闭合Plan/Registry/Block/Manifest逻辑identity、目录编码、source-bound cache和
   requested/actual object binding；
2. Issue #296：为当前 Semantic Frontend 建立只读 exact 多文件 Workspace Observation、raw digest、
   physical identity、pre/post readback 与 deterministic observation revision；
3. Issue #306：在扩大Source Program与Responsibility输入前，闭合 Semantic Contract strict raw schema、
   namespace/import/identity、semantic/source/provider revision、Type/Effect/Scenario基础语义，并把
   Verification requirement与physical PASS result分离；
4. 在真实 SEC TypeScript 子系统上消费 Observation，使用 Compiler API Program/TypeChecker产生
   module/symbol/type/span/control/data/state/effect candidates，保留 unknown/opaque；现有ts-morph代码生成、
   regex discovery和test-import selector不得冒充Source Program；
5. Issue #293：在 observed/inferred assertion 大量进入前闭合 Engineering IR raw→validated
   confidence/provenance/evidence/validity/attribute 边界；
6. 与 #224 Responsibility reconstruction/reconcile/adopt 和 focused Impact rules连接，形成首个
   Self-Observation / Self-Impact 纵切片。

### 5. product-self-bootstrap-sequence

仍拆成独立 successor，不形成一个大包：

1. Issue #287 `task-envelope-de-specialization-v1`：删除 Customer/Ticket、单一 Target、固定测试路径
   和 runtime attribution业务启发式；
2. Issue #288 `workbench-operation-unification-v1`：Workbench/CLI/HTTP/AI 只提交 Engineering Operation，
   退役直接 `source/app.yaml`、slot bootstrap 与 mutation inbox writer；
3. Issue #299 `block-capability-resolution-v1`：Capability requirement通过显式Provider selector、Registry
   trust、version/contract/effect compatibility形成冻结ProviderBinding，不再因唯一字符串匹配自动授权；
4. Issue #300 `block-composition-transaction-v1`：locked inputs形成Artifact owner DAG和staged desired tree，
   原子或可恢复发布，退役live install/generator/override direct writers；
5. Issue #290 `first-ir-owned-backend-v1`：以 `generated/routes.ts` 为首个真实 artifact，经过最小
   Application Route / Target Program IR 和 TypeScript Backend shadow parity，并通过 #300 发布，切换后删除
   raw-manifest `renderRouteGraph` writer。现有 state-transition semantic generator作为revision/provenance参考，
   不为未来语言预建无人消费的完整IR字段宇宙；
6. Issue #307 `implementation-resolution-kernel-v1`：在 #299/#300/#290 已提供真实 ProviderBinding、
   transactional artifact writer 和 Target Program IR consumer 后，由 `compiler-target-ir` 唯一拥有
   `semantic requirements → candidate closure → hard eligibility → policy optimization → deterministic tie-break
   → ResolutionDecision → exact ImplementationBinding → Target Program IR`。Block Resolver只解析
   Block/Capability依赖，Provider/Adapter/Generator/Workbench不得自行选库；首包只验证一个多候选真实纵切片，
   同时保留 L0 physical dependency、L1 typed invocation、L2 governed invocation、L3 candidate、
   L4 verified Provider/Adapter 和可选 L5 Normalize 的渐进接入，不预建全生态空模型。

## 已路由但不自动抢占近期顺序的缺陷

以下 finding 已有唯一 owner，只有成为当前阻塞、风险提升或被 selector 选中时才生成正式包；
不把 rolling plan 退化成永久 backlog：

- #216 release lane credential/fetch修复；
- #292 Opaque Module manifest/identity/install fail-closed；
- #295 Frontend Attachment isolation fail-closed；
- #297 Policy declaration/override/evaluator/Gate fail-closed；
- #298 Upgrade/Migration事务、dry-run、recovery、prototype path与unsupported operation安全；
- #301 exact-tree Release Artifact、package manifest、clean install、SBOM/provenance与promotion Evidence；
- #302 Repair精确失败归因、最小受控Mutation和真实re-verification；
- #304 CLI成功/失败统一Operation Envelope、纯净JSON、稳定退出码与packed binary测试；
- #190/#193 dependency bridge、filesystem/process/environment identity、provider与cleanup；
- #176 fast zero-test、Acceptance case Evidence和非PASS supportedClaims真值；
- #179 Pipeline Journal事件/CAS/recovery；
- #188 TypeScript Program驱动的transitive Semantic Test Impact；
- #194 immutable domain revisions、lock/artifact transaction publication与clean/incremental parity；
- #167 dormant unsafe microservice lowering 的 quarantine/Target Profile裁决。

## 并行与自动化恢复条件

Issue #207 不再自动排在产品纵切片之前。只有以下事实全部成立后，才激活
`parallel-resolver-correctness-v1-1`：

- ordinary candidate 的 exact-head Review/Gate/merge/readback 路径已连续稳定；
- default branch 无 direct-push/admin bypass；
- Verification 单真值、revision health与TCB bootstrap已闭合；
- package/lock、docs/work、workflow、Skill registry 和 mutable resources 有唯一 writer；
- 至少一个 Source Program/Responsibility 产品纵切片进入 `main`，证明并行不会继续饥饿产品线。

`unresolved` 永不授权并行。并行开发不等于同时写入 `main`；任一 candidate 先合并后，
剩余 epoch 因 base 变化失效并从新主干重算。

## 可并行只读工作

- #192 Node/Bun × Windows/Linux 物理 capability Evidence；
- #193 latest dependency/provider consumer census；
- #194 compiler cold/warm benchmark 与 pass/artifact census；
- 13K dev-runner authority proof 的独立 oracle、重复 substrate 和 mutation-detection 只读审计。

上述工作不得修改当前 manifest owned paths、package/lock、workflow、control plane 或产品代码；
结果只进入各自 Issue/Evidence owner，不自动取得合并资格。
