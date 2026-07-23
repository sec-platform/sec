---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-23
---

# SEC 滚动近期计划

本计划依据 `docs/work/current-state.yaml` 的最新快照重新计算：Goal九文件 revision仍为`sha256:555a187d…`，`origin/main`仍是`8aa2d2d`，#137仍为Draft；PR #138已转Ready，V1 Scope成功，但唯一Quick在`project-runtime.test.ts`仍断言已退役的v0.3路线标题而失败。该测试是`docs/03`的显式roadmap-authority consumer，V1又禁止`tests/**`，因此命中`reload_if`并升格为V2，而不是重跑旧head或把历史标题塞回canonical路线图。当前唯一正式包仍是 **Docs Document Authority V5 Reconciliation V2**；所有runtime、SM-4A和Nexus工作保持candidate/suspended。

本窗口只有一个 active package 与四个候选。它不证明任何能力完成，也不复制 `03` 的长期阶段合同、`14` 的Mutation authority或`current-state`的exact动态字段。

```text
Docs Document Authority V5 Reconciliation V2 (active; PR #138 repair)
├─→ runtime V10 diagnostic/owner repair + PR #137 reconciliation
│   └─→ SM-4A trusted authorization ingress replay
├─→ docs-doctor semantic-superset trust-root bootstrap
└─→ Nexus Phase 0A exact-tree census (read-only candidate)
```

## 当前唯一 Work Package

### docs-document-authority-v5-reconciliation-v2

- 结果：把九份V4 Goal与V5 payload逐项归入现有canonical owners；让AGENTS、README、`docs/04`、稳定路线图和三个近期控制面使用同一authority分工，并让唯一roadmap executable consumer验证新合同。
- 根因：原包只证明机械overlay，不能证明语义；V1虽关闭文档回退，却遗漏了`docs/03`的显式测试consumer，导致Quick在旧v0.3标题上失败。根因是ownership闭包不完整，不是新路线图缺失。
- 边界：只改manifest精确拥有的canonical文档/导航、三个控制面与`tests/integration/project-runtime.test.ts`；`docs/scripts/docs-doctor.ts`、CI/workflow、production/package、replacement源包和其他用户dirty root禁止触碰。
- 当前事实：V1 head `897250bcd6e48802f24c58adfb0c843dac497735` 的Scope run `30012100577`成功；唯一Quick run `30012238172`中docs-doctor/typecheck通过，affected为39 pass/1 fail；schedule revalidation `30016007890`正确保持merge-gate失败。V1 manifest按原bytes保留为失败历史证据；V2拥有22个路径并覆盖base→candidate的21个changed records。PR #138为Ready、0 Review/thread。
- 退出：稳定DAG与三个控制面的authority分离在AGENTS/README/docs04/test中一致；测试验证P0–P12、单一snapshot/target pipeline和完成边界；最终head保持base上的单一commit，focused roadmap/docs contracts、doctor、YAML、imports、scope、patch、GitNexus compare、新head一次Scope/Quick和Review/merge-gate闭合。
- 完成语义：候选、安装输出、manifest或PR都不能证明完成；只有最终结果进入`main`且required evidence/Review无阻塞后，才从新`main`重算。

## 候选 Work Package

### 1. runtime-v10-owner-repair-and-pr137-reconciliation

- 产品结果：从新的Goal/main重冻runtime前置，消费已有one-shot诊断身份，选择唯一production owner repair，并把PR #137已被successor吸收的内容以无重复writer的最终tree收敛。
- 依赖：当前文档authority先进入`main`；必须重新读取#137 head/base/Review/CI与本地successor，丢弃旧Goal revision下未冻结的manifest。
- 边界：不重跑永久FAIL的affected identity，不把focused/telemetry/cleanup组合成Quick PASS；任何新正文只运行一次。若最终仍修改verifier trust root，继续使用独立review和manual bootstrap，不由候选自证。
- 退出：临时retention selector删除；canonical affected在最终实现head上只运行一次并PASS后才允许Risk；PR/head-bound evidence随新head全部重算；tree无probe/generated drift。

### 2. docs-doctor-policy-superset-v1

- 工程结果：以`8aa2d2d` doctor为底实现V5 policy的语义超集，而不是替换legacy诊断。
- 依赖：必须在#137/V10 revision seam闭合后重新选择revision与bootstrap顺序；不得与runtime包同时修改verifier trust root。
- 必需fixture：legacy ERROR/WARN不丢失；required owner、frontmatter/status、唯一H1、V4实体/引用policy、`file:///`、广义repo path、deprecated token和clean corpus false-positive均有正负向证明。
- 边界：installer跨平台fixture只有在形成tracked、独立职责的package tool时才进入；不把用户原始replacement目录提交为第二docs树。

### 3. sm4a-trusted-authorization-ingress-replay-v1

- 产品结果：Compiler/Mutation owner把trusted-local policy draft转换为既有canonical authorization，为shared adapter提供唯一入口。
- 依赖：runtime前置和#137 reconciliation先进入`main`；从新base重放已有窄production/test delta并重冻manifest，旧exact-head evidence不复用。
- 边界：SM-2继续独占owner/path authority，SM-1继续独占request/plan/result revision；不接CLI/HTTP/Workbench，不混入Task Envelope v2或AI。
- 退出：focused owner contract、canonical affected、适用Risk、type/import/docs与Review在同一最终head闭合。

### 4. nexus-phase-0a-exact-tree-census

- 产品结果：从ledger绑定的exact Nexus commit/tree物化1,439/1,439 path/mode/object inventory，追踪entrypoints、EPR 29/29、Skills 11/11与mechanism decisions。
- 执行方式：只读采集可并行，ledger写入和owner裁决仍由A0串行；不能成为第二active package。
- 边界：V5 EPR/Skill段落只是Corpus requirement，不能反向拥有SEC Core；不使用live dirty worktree或stale图索引冒充exact census。
- 退出：unclassified/undecided为0并生成deterministic manifest；这仍不等于Parity或Retirement完成。

## 单写者、证据与重算

- 正式active package始终只有一个；Goal/roadmap、verifier revision、runtime owner、authorization owner和Nexus ledger分别按依赖串行冻结。
- 相同 `gate_key + tested head + profile` 的未失效结果必须复用；permanent FAIL与diagnostic identity不得重跑或包装成PASS。
- Merge/close、相关`main`变化、新CI/Review blocker、架构反证、实现supersede、Nexus Census新前置或长期Goal变化后，刷新current-state并整体重算本窗口，不追加永久Backlog。
