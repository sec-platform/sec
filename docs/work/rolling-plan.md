---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-12
---

# SEC 滚动近期计划

本投影绑定受信 `main@879af721ef6a3cd952a8b255ceb2d459021f567e`、tree
`b39cebc0c043d6709659d649b8178eb712163976` 与 `docs/roadmap.md` 的有序 R14 catalog。长期DAG、current
spec与选择权仍只归其canonical owner；本文件不解释Issue正文、不拥有优先级，也不是backlog/registry。
MainHealth run `31568797707`、job `94026162914` 的imports通过而TypeScript以三个稳定diagnostic失败；相同
输入不重跑。普通selector因degraded ledger停在reconcile，本次是用户明确授权的唯一manual-bootstrap
bridge：它不伪造ordinary WorkDecision、activation或Review receipt。进入new main后，MainHealth的一次
fresh observation在`ordinary-only | repair-only | locked`三态间互斥路由，后续repair不再依赖全Issue census。

## 当前唯一 Work Package

### default-branch-health-repair-v2

Exact `879af721` MainHealth repair：修复三个TypeScript产生边界，并安装future-safe repair lane、动态
failure-generation locator与O(1) routing。该bootstrap package不跟踪Issue；#177只拥有failure classification，
不拥有MainHealth或repair effect。此次manual projection由当前用户授权、exact diff、独立Review和new-main
readback共同约束，进入main后不保留第二手工入口。

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Issue #346 production cutover：本地caller只dispatch wake-up；default-branch GitHub Actions/App producer对
manifest-only draft PR签发immutable PRE artifact与App locator，同一PR完成实现后再为exact final head签发FINAL。
Task Capsule、Read Plan与Skill重验provider、artifact、WorkDecision、PR、manifest、owner closure和whole delta，
PRE用于实现前的最小读取/Skill选择，FINAL用于实现后的exact reconciliation，二者都不自行签发。当前PR只发布机制与legacy marker根修，不把自身冒充canary；Issue保持开放直到三个真实operation
与一次真实maintainer mutation observation完成。

### 2. delegation-consumer-zero-retirement-v1

Issue #275；#346机制进入new main后立即作为第一个真实PRE→FINAL canary，迁移最后consumer并把Skill集合由八
收敛到七，不保留alias。其结果计入#346的三次真实operation，但不因此提前关闭#346。

### 3. candidate-control-transaction-v1

Issue #321 focused slice；实现一个logical run一个mutable worktree/ref的机器lease、generation replacement
和provider/local双readback，根治v2/v3 candidate分裂。

### 4. typescript-7-checker-acceleration-v1

Issue #312/#193；只在read-path cutover及package/lock单写者成立后做TS7 native checker parity，TS6继续
拥有programmatic Compiler API、Language Service与imports kernel，直到迁移Evidence成立。

### 5. execution-wave-v1

Issue #349；等待WorkDecision、#207 order/conflict和前置control/verification closure可消费后，只编译
work refs、order、resource和cost，不复制Issue/Skill prose、权限或Verification算法。

## 后续与唯一 owner

- `docs/roadmap.md`拥有完整R14顺序；当前bounded catalog只保留能形成未来二至五候选的近端窗口。
- #327拥有repository path/module-specifier/primitive census以及`docs/evidence/**` consumer-zero retirement；
  #348继续唯一拥有import representation/effect，导入自动化不回退到手改名单。
- #193拥有每个真实重复机制的wheel/provider adoption与package/lock单写者；#316拥有性能真值。
- #346的production cutover已进入main但Issue保持开放，直到三个真实operation和一次真实maintainer
  mutation observation；#352与#186分别保留自己的完成条件，不因本repair或后继progress提前关闭。
- #349在#321/#312之后；它只编译work refs、order、resource和cost，不复制Issue/Skill prose、权限或
  Verification算法。

## 重新规划硬触发器

1. live main、catalog、current spec、registry、lifecycle、conflict或provider observation发生漂移；
2. selected package/tracking与WorkDecision不一致，或候选少于二、多于五、重复、手工重排或增删；
3. candidate changed path超出frozen ownedPaths、命中forbiddenPaths或出现第二mutable worktree/ref；
4. Issue title/body/comment、AI评分、wall-clock、rolling prose或caller JSON开始影响selection；
5. exact-head independent Review存在P0/P1/P2，或head/tree/base/manifest digest在Review后改变；
6. merge后尚未完成remote/new-main/local-main和branch/worktree/ref absence readback。

## 加速验收

默认执行`RequiredClosure ∩ MissingOrStale`：本repair只运行一次post-delta TypeScript check、直接改动的
MainHealth/document-control contract、必要的docs/imports/TCB机械检查与独立exact-object Review；不运行
affected/full/release/nightly或重复同一失败。不得以少验证放宽parser、identity、unknown、authority或
readback；fresh PASS直接复用，same-input failure直接复用。
