---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-12
---

# SEC 滚动近期计划

本包激活时从受信 `main@41f72db071cbbd5cc9a9bfeaa9c2bcec855ca7d7`、
`tree@7383e11c405ac1ce232d3cd7e8ef8cd404587237` 重算；当时protected root local main、
`origin/main`与live provider default一致，root clean，且不存在预先开放PR。该段只记录激活
snapshot，不替代每次effect前的live resolver。PR #350、#351、#353、#354、#357与imports scope
结果已经进入该base tree；旧candidate Review、Gate、Session、manifest或聊天顺序均不迁移。

这份文件只投影一个当前包和四个条件候选。长期能力顺序仍由`docs/roadmap.md`拥有，持久工作
身份与current spec仍由既有Issue拥有，eligibility/priority归#221 `WorkDecision`，order/conflict
归#207/#349；本文件不是第四份backlog或选择器输入。#221 Phase C切换前，本次投影是A0对
exact facts的显式reconciliation；切换后只能由validated WorkDecision物化或返回reconcile。

## 当前唯一 Work Package

### document-control-replan-recovery-v1

由#321/#311修复真实Windows canary暴露的control-plane recovery缺陷：同manifest pre-publication
replan在pointer已等于NEXT时必须byte-exact NOOP；Git index recovery identity以semantic
tree/entries与受保护tuple为准；terminal residue自动consumer-zero retire，人工删除不成为正常路径。

## 候选 Work Package

### 1. work-selection-live-projection-v1

继续#221 Phase B/C：trusted adapter只从repository orientation、#311 registry、#313 closeout、
#207 conflict与maintainer-adopted normalized identity收集facts，签发decision receipt；rolling writer
只物化该receipt的当前+二至五候选。不得抓取Issue body/comment、建立第二registry或静默覆盖冲突投影。

### 2. operation-read-plan-authority-canary-v1

从then-current main完成#346的独立issuer-bound activation receipt与三个真实operation canary：普通
focused operation、zero-or-one Skill operation和maintainer mutation case。Capsule/Read Plan consumer
只验证receipt与raw-byte identity，不自行签发authority；只记录read/context/tool量和owner closure。

## 后续但暂不占 formal writer

- 三个#346 canary readback后执行#275最终consumer census；只有`sec-task-delegation` production
  consumer为零，才把route切到deterministic owner并一次删除第八个Skill ID/file，不保留alias。
  同一切片原子迁移全部保留Skill的frontmatter：installed canonical `quick_validate.py`当前对已修改
  与未修改Skill都拒绝top-level `compatibility`，而repo contract仍强制该旧字段；应统一迁到标准
  `metadata`并同时切换parser/tests，对全部保留Skill验证，不能只给当前文件做兼容特例。
- #349 `ExecutionWave`在#221 live decision receipt与#207 conflict/order facts可消费后实现；它只编译
  work refs/order/conflict/resource/cost，不复制Issue/Skill prose、命令、权限或Verification算法。
- #312 TypeScript 7在read-path cutover后按#193 package/lock单写者执行native checker parity；TS6
  继续拥有programmatic Compiler API、Language Service与imports kernel，直到独立迁移Evidence成立。
- #327继续拥有repository path、module-specifier与重复primitive census，并与#282/#271共同完成
  `docs/evidence/**` consumer census和确定性retirement；unknown或仍有consumer的对象不得按年龄删除。
- #348只拥有import representation/effect；package exports/public API由产品contract与release owner
  拥有。imports自动选择已进入main，后续不靠手工改名单或创建v2/v3 branch维持。
- #193只接受“一个真实重复机制→一个measured Provider cutover→全部consumer迁移→旧实现删除”，
  不以添加dependency、adapter或长期fallback冒充轮子采用。
- #316/#190已有“unit/contract不得无条件准备browser/runtime provider”的唯一owner。本包新增pure
  sentinel首次被全局runtime-deps preload拖到34秒无输出，而相同测试使用现有no-provider seam后为
  118ms、8/8；后续Verification/test partition必须让pure owner自动选择该closure，不能依赖人工环境变量。
- candidate/control transaction之后依次进入VerificationSession physical partition + Requirement
  closure、#349 ExecutionWave、Review/trust transition与promotion/retirement；每项是then-current main
  上可独立readback的纵切片，不使用长期umbrella branch。
- #352保持开放，直到Review/trust transition提供独立、post-main、逐acceptance Evidence与完整
  work/child/consumer census的completion assessment；Issue writer仍须等待provider capability证明真实
  conditional mutation。两项任一缺失都只允许progress，不为提前关Issue建立临时maintainer flag。

## 重新规划硬触发器

任一条件成立立即停止并从 then-latest main 重算：

1. main、PR、branch、manifest、trust revision、runner input 或相同 failure fingerprint
   发生未处理漂移；
2. 本包 changed path 超出 frozen ownedPaths 或命中 forbiddenPaths；
3. normalized work facts、WorkDecision、Task Capsule、Read Plan或scope intersection出现未闭合；
4. WorkDecision开始读取Issue prose、模型评分、wall-clock或候选自签发authority；
5. 未先完成 exact-head independent Review（P0-P2 清零）就宣称 merge-ready；
6. merge 后没有先完成 exact new-main readback 与 `TASK_RESTART_REQUIRED` 就继续
   后续 trust-epoch 或治理工作。

## 加速验收

默认只做changed-path ownership、schema/digest、selector replay与control-plane静态闭包。只运行
Skill canonical validator和直接拥有本次delta的focused contract case；不运行`check:affected`、
`check:full`、全仓audit、slow/hosted partition或相同输入rerun。速度不能来自放宽identity/parser、
把raw prose当facts、伪造Review/Gate或把unknown升级成PASS。
