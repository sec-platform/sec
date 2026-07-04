---
title: Verification、Provenance 与治理投影规范
status: active
last-reviewed: 2026-07-04
---

# Verification、Provenance 与治理投影规范

本文定义 Verification、Artifact Provenance、ExplainGraph、ReviewSummary 和 Evidence 边界。Engineering IR 与 Fact Provenance 见 `14`。

## 1. Verification

生成项目验证入口：

```text
verify --lane fast|runtime|all
```

仓库开发测试的 affected/fast/slow/full 规则见测试文档，两套概念不得混用。

Verification 可以读取 Authoring Source、IR、Artifact 和 Runtime，但不能修改 canonical semantics。允许输出 Report、Trace、Diagnostic、Coverage 等 Evidence。

## 2. Acceptance

Acceptance 表达可观察结果，不等同于单元测试文件。

最小关系：

```text
Acceptance
  COVERS Block / Slot / Responsibility / Operation
  VERIFIED_BY Test or Runtime Probe
```

当前实现已经支持 Block/Slot coverage；Responsibility/Operation coverage 在 IR 语义对象落地后扩展。

Acceptance ID 必须稳定。测试文件路径是验证实现细节，不作为 Acceptance identity。

## 3. Policy Gate

Policy 由 official/project source 合并，明确 severity 和 target。`error`/`blocker` 可使 verification failed。

现有文本/AST 规则属于验证实现；长期 Policy 应优先绑定 Semantic Fact/Effect/Permission，例如：

```text
TicketQuery REQUIRES TenantContext
DatabaseQuery MUST_BE_SCOPED_BY tenantId
```

源码扫描可以证明或反驳 Contract，但不能把字符串包含关系直接升级成 canonical semantic fact。

## 4. Artifact Provenance

`control/provenance/provenance.json` 说明 Artifact 从哪里来。

当前核心字段：

- path。
- originType/originId/sourceBlock。
- registry source。
- sourcePath/runtimeTarget。
- generatedByPass/generatorTaskId。
- verifiedBy。
- overrideStatus。
- hash。

Artifact Provenance 和 Fact Provenance 必须分开：

```text
Artifact Provenance: 这个文件从哪里来？
Fact Provenance:      这个工程判断为什么成立？
```

不得把文件 origin 自动当成文件内所有语义 Fact 的 authority。

## 5. ExplainGraph

`control/graph/explain-graph.json` 是**治理解释投影**。

它回答：

- App 使用哪些 Block/Capability。
- Pin/Slot 如何关联。
- Artifact 来自哪里。
- Acceptance/Policy 如何覆盖。
- Repair/Upgrade/Override 影响哪些治理对象。

当前公开 node/edge contract 保持兼容。新增 Engineering IR 后，ExplainGraph 应由 IR + Governance Artifact 投影构建。

禁止把以下关系直接塞入 ExplainGraph 作为 IR 替代：

```text
OWNS
READS
MUTATES
CALLS
AWAITS
TRANSFORMS_TO
VALIDATES
PERFORMS_EFFECT
```

这些属于 `14` 的 Semantic Fact/Projection。

Mermaid/DOT/HTML 都是 ExplainGraph 的衍生展示，不是事实源。

## 6. ReviewSummary

ReviewSummary 聚合 Verification、Coverage、Policy、Artifact Provenance、Repair、Upgrade 和 Artifact 状态。

它必须回答“现在最应该审查什么”，而不是复制所有 JSON。

### Semantic Diff

Semantic Diff 的 canonical 输入是两个 IR revision 的 Fact Set 差异，加上 Artifact/Verification delta：

```text
IR A facts
vs
IR B facts
  → added facts
  → removed facts
  → changed semantic values
  → impacted guarantees/assumptions/verification
```

在 Fact Delta 实现前，现有 Engineering Semantic Diff 只属于 artifact/governance approximation，文档和 UI 必须明确这一点。

## 7. Evidence 分层

| 层 | 示例 | Authority |
| --- | --- | --- |
| Authoring/Compiler | Contract、Resolver、IR builder | authoritative / derived |
| Static Analysis | ts-morph、dependency analysis | derived evidence |
| Runtime Observation | trace、probe、coverage | observed |
| AI/External Provider | LLM、Graph-It-Live、GitNexus、Graphify | inferred/advisory |

外部工具经 provider adapter 归一。Raw report 只能作为 Evidence 引用。

现有 `ToolEvidenceReport` 的 `stableArtifact: false` 规则保持；Code Quality、Architecture Boundary、Semantic Pattern Report 在完整合同冻结前不进入 stable artifact 列表。

## 8. 稳定治理产物

稳定路径由 `CI_ARTIFACT_FILES`、路径合同和 Contract Freeze 共同决定；文档不复制会漂移的完整文件数量。

主要类别：

- state/lock。
- verification/policy/coverage/review evidence。
- artifact provenance。
- explain graph 及其投影。
- repair/upgrade workflow。
- Workbench view。
- CI artifact manifest。

新增 stable artifact 必须同时接入：

1. path contract。
2. CLI inspect 或明确 consumer。
3. artifact manifest。
4. contract freeze。
5. targeted test。
6. reference refresh（如属于 reference workspace）。

## 9. Verification 与 IR 的关系

Verification 不只验证文件存在。v0.3 后逐步增加：

- IR integrity verification。
- Contract completeness。
- Fact authority conflict diagnostics。
- Generator output coverage。
- Contract → IR → Artifact traceability。
- Semantic impact selected verification。

结果仍以结构化 Report 输出；禁止 Workbench 模板自行实现验证规则。
