---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-12
---

# SEC 滚动近期计划

本投影绑定受信 `main@56285ba26b776f12dd2a93c4d9908366d997d13a`。长期阶段DAG仍只由
`docs/roadmap.md`拥有，current spec仍只由下列Issue或更强machine owner拥有；本文件不解释Issue
正文、不拥有优先级，也不是backlog/registry。canonical MainHealth run `31548322778`、job
`93965413087`已证明imports、TypeScript与docs authority通过，且TCB single-owner旧失败不再出现。唯一
failure receipt是一个101项通过的fast batch中两条negative assertion：production均正确拒绝输入，但测试
仍把unbound scope proposal写成`trusted/authorized`。本Work Package只把断言改回canonical
`proposal/proposed`词汇，并在development-governance固化同一authority-level规则；不改production行为，
不重跑unchanged failure input。健康恢复后只能消费validated WorkDecision；
rolling prose或caller receipt都不能选择、重排或授权下一项。

## 当前唯一 Work Package

### main-health-repair-unbound-vocabulary-v1

Issue #346 MainHealth semantic assertion repair：Task Capsule仍是`unbound-planning-content`、
`effectAuthority=none`、`scopeGrantId=null`；两条negative tests不得在真实issuer receipt前把proposal称为
trusted/authorized。只消费exact hosted failure tail、independent exact-object静态Review与new-main health
readback；不建立alias、tracked Evidence、第二plan或临时production adapter。

## 候选 Work Package

### 1. operation-read-plan-authority-canary-v1

Issue #346；完成独立issuer-bound activation receipt和三个真实operation readback。它是当前R14
read-fast-path的直接后继。

### 2. delegation-consumer-zero-retirement-v1

Issue #275；仅在#346真实canary完成后迁移最后consumer并把Skill集合由八收敛到七，不保留alias。

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
- #352保持开放，直到exact new-main后的acceptance/work/child/consumer census和真实provider conditional
  mutation能力同时成立；partial slice只发布progress。

## 重新规划硬触发器

1. live main、catalog、current spec、registry、lifecycle、conflict或provider observation发生漂移；
2. selected package/tracking与WorkDecision不一致，或候选少于二、多于五、重复、手工重排或增删；
3. candidate changed path超出frozen ownedPaths、命中forbiddenPaths或出现第二mutable worktree/ref；
4. Issue title/body/comment、AI评分、wall-clock、rolling prose或caller JSON开始影响selection；
5. exact-head independent Review存在P0/P1/P2，或head/tree/base/manifest digest在Review后改变；
6. merge后尚未完成remote/new-main/local-main和branch/worktree/ref absence readback。

## 加速验收

默认只做changed-path ownership、strict schema/digest、pure replay、TCB lock机械生成和独立exact-object
静态Review；本轮不运行代码测试、typecheck、affected/full或hosted Gate。不得以少验证放宽parser、identity、
unknown、authority或readback；相同输入不得重复运行。
