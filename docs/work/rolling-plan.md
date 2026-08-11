---
title: SEC 滚动近期计划
status: active
domain: current-control
last-reviewed: 2026-08-11
---

# SEC 滚动近期计划

本窗口从受信 `main@985bc5ab8f7422f7135d8e10c23c52ffd060d75a`、
`tree@a2629c5a2b708f0c4947c3dac8ed63954bf6b92b` 重算；local、`origin/main` 与
live provider default一致，root clean，开放 PR 为零。PR #350、#351、#353、#354与imports
scope结果已经进入当前tree；旧candidate Review、Gate、Session、manifest或聊天顺序均不迁移。

这份文件只投影一个当前包和四个条件候选。长期能力顺序仍由`docs/roadmap.md`拥有，持久工作
身份与current spec仍由既有Issue拥有，eligibility/priority归#221 `WorkDecision`，order/conflict
归#207/#349；本文件不是第四份backlog或选择器输入。#221 Phase C切换前，本次投影是A0对
exact facts的显式reconciliation；切换后只能由validated WorkDecision物化或返回reconcile。

## 当前唯一 Work Package

### work-discovery-and-plan-convergence-v1

完成#221 Phase A与发现行为收敛：新增只消费bounded normalized facts的pure WorkDecision compiler，
把“发现问题后先解析既有work identity、owner与current spec，再固化/排序”的不可遗忘行为写入
唯一Skill和治理短投影，并修复repository audit把导航文字或裸对象名误报为Agent启发式的根因。
普通`.agents/skills/**` authoring也从泛化`agent-governance`重闭包拆为四个直接contract owner tests；
其中`agent-skills`用production pure source-governance projection扫描每个exact Skill字节与全部blocking
finding，而不为单个Skill修改启动物理全仓audit。authority/runtime变化仍保留原重闭包。当前包不读取raw Issue prose、不自动改Issue、不写GitHub、
不实现ExecutionWave，也不关闭#221。

## 候选 Work Package

### 1. issue-disposition-safety-v1

从then-current main执行#352：由现有integration/closeout owner实现machine-owned
`IssueDisposition`，PR renderer默认拒绝closing lexical pattern，只允许fresh authorized completion
set生成唯一closing clause；merge后按operation receipt逐Issue readback，并只精确reopen本次误关目标。

### 2. document-control-replan-recovery-v1

由#321/#311修复真实Windows canary暴露的control-plane recovery缺陷：同manifest pre-publication
replan在pointer已等于NEXT时必须byte-exact NOOP；Git index recovery identity以semantic
tree/entries与受保护tuple为准；terminal residue自动consumer-zero retire，人工删除不成为正常路径。

### 3. work-selection-live-projection-v1

继续#221 Phase B/C：trusted adapter只从repository orientation、#311 registry、#313 closeout、
#207 conflict与maintainer-adopted normalized identity收集facts，签发decision receipt；rolling writer
只物化该receipt的当前+二至五候选。不得抓取Issue body/comment、建立第二registry或静默覆盖冲突投影。

### 4. operation-read-plan-authority-canary-v1

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
