---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-12
---

# SEC 滚动近期计划

本投影由唯一MainHealth repair renderer绑定exact `main@bd0962a69b7df921668fa7f10b9c317775176b45`、tree `f90200cc6a6b3fddbdd0d587023b4fb95838f77a`、health `sha256:4595384037c9af7891ffb1997b168358eb7c957bb969475023f07bdd85d21ad2`与排序failure fingerprints `sha256:d45db4cba70f7c03331169a18b8b32ab984c97d4a4bcff626555b08b8c3c9205`。旧epoch说明、caller prose与普通WorkDecision都不能参与本次repair projection；长期DAG、current spec和普通选择权仍归其canonical owner。

## 当前唯一 Work Package

### default-branch-health-repair-bd0962a69b7df921668fa7f10b9c317775176b45-4d556990782aad7ed252b7f9800c1f8000130e92e64ba53f080d7f1dc793366c

Exact degraded-main repair for `main@bd0962a69b7df921668fa7f10b9c317775176b45` and health `sha256:4595384037c9af7891ffb1997b168358eb7c957bb969475023f07bdd85d21ad2`. This temporary projection has no ordinary work-selection authority.

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
