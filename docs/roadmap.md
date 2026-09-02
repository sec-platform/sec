---
title: 当前 Work Selection Catalog
status: active
domain: current-control
---

# 当前 Work Selection Catalog

本文件是现行 WorkSelection 与 document-control consumer 的机器控制投影，只拥有当前 catalog。稳定能力阶段、进入/退出条件和产品完成边界由 [SEC 能力与交付 DAG](roadmap/capability-dag.md) 拥有。

### 现行 R14 工作选择投影

以下块仍被现行 WorkSelection 与 document-control consumer 读取，因此在迁移完成前必须保持机器可读。它是运行期工作目录的过渡载体，不是稳定 capability DAG；只能由唯一 renderer 原子更新，不得手工成为第二 roadmap。终态是由 canonical work records 编译独立 runtime projection，再将本块及 roadmap reader 一次性退役。

<!-- sec-work-selection-roadmap-catalog-v1:begin -->
```json
{
  "schema": "sec-roadmap-work-catalog-v1",
  "stageRef": "r14-agent-operation",
  "items": [
    {
      "packageId": "development-critical-path-spine-v1",
      "workId": "issue-398",
      "tracking": "issue-398",
      "currentSpecRef": "github:issue/398",
      "ownerRef": "github:issue/398",
      "kind": "focused",
      "disposition": "active",
      "priorityClass": "active-critical-path",
      "priorityEvidenceRefs": ["github:issue/398"],
      "prerequisiteWorkIds": [],
      "orderedAfterWorkIds": [],
      "reproductionOrEvidenceFreshness": "fresh",
      "rootCauseState": "repeat-root-cause",
      "rootCauseRef": "github:issue/398",
      "scopeClosure": "closed",
      "exitCriteriaRef": "github:issue/398#完成定义",
      "nearTermConsumerRef": "github:issue/316",
      "humanDecisionRef": null
    },
    {
      "packageId": "operation-read-plan-authority-canary-v1",
      "workId": "issue-346",
      "tracking": "issue-346",
      "currentSpecRef": "github:issue/346",
      "ownerRef": "github:issue/346",
      "kind": "focused",
      "disposition": "active",
      "priorityClass": "product-critical-path",
      "priorityEvidenceRefs": ["roadmap:r14/read-fast-path"],
      "prerequisiteWorkIds": [],
      "orderedAfterWorkIds": [],
      "reproductionOrEvidenceFreshness": "fresh",
      "rootCauseState": "repeat-root-cause",
      "rootCauseRef": "github:issue/346",
      "scopeClosure": "closed",
      "exitCriteriaRef": "github:issue/346#acceptance",
      "nearTermConsumerRef": null,
      "humanDecisionRef": null
    },
    {
      "packageId": "sec-static-convergence-v1",
      "workId": "issue-311",
      "tracking": "issue-311",
      "currentSpecRef": "github:issue/311",
      "ownerRef": "github:issue/311",
      "kind": "program",
      "disposition": "active",
      "priorityClass": "product-critical-path",
      "priorityEvidenceRefs": ["roadmap:r14/static-convergence"],
      "prerequisiteWorkIds": [],
      "orderedAfterWorkIds": [],
      "reproductionOrEvidenceFreshness": "fresh",
      "rootCauseState": "repeat-root-cause",
      "rootCauseRef": "github:issue/311",
      "scopeClosure": "closed",
      "exitCriteriaRef": "github:issue/311#acceptance",
      "nearTermConsumerRef": null,
      "humanDecisionRef": null
    },
    {
      "packageId": "candidate-control-transaction-v1",
      "workId": "issue-321",
      "tracking": "issue-321",
      "currentSpecRef": "github:issue/321",
      "ownerRef": "github:issue/321",
      "kind": "focused",
      "disposition": "active",
      "priorityClass": "product-critical-path",
      "priorityEvidenceRefs": ["roadmap:r14/candidate-control"],
      "prerequisiteWorkIds": [],
      "orderedAfterWorkIds": [],
      "reproductionOrEvidenceFreshness": "fresh",
      "rootCauseState": "repeat-root-cause",
      "rootCauseRef": "github:issue/321",
      "scopeClosure": "closed",
      "exitCriteriaRef": "github:issue/321#完成定义",
      "nearTermConsumerRef": null,
      "humanDecisionRef": null
    },
    {
      "packageId": "typescript-7-checker-acceleration-v1",
      "workId": "issue-312",
      "tracking": "issue-312",
      "currentSpecRef": "github:issue/312",
      "ownerRef": "github:issue/312",
      "kind": "focused",
      "disposition": "active",
      "priorityClass": "near-term-acceleration",
      "priorityEvidenceRefs": ["roadmap:r14/read-path-cutover"],
      "prerequisiteWorkIds": ["issue-346"],
      "orderedAfterWorkIds": [],
      "reproductionOrEvidenceFreshness": "fresh",
      "rootCauseState": "not-repeated",
      "rootCauseRef": "github:issue/312",
      "scopeClosure": "closed",
      "exitCriteriaRef": "github:issue/312#acceptance",
      "nearTermConsumerRef": "github:issue/316",
      "humanDecisionRef": null
    },
    {
      "packageId": "execution-wave-v1",
      "workId": "issue-349",
      "tracking": "issue-349",
      "currentSpecRef": "github:issue/349",
      "ownerRef": "github:issue/349",
      "kind": "focused",
      "disposition": "deferred",
      "priorityClass": "defer",
      "priorityEvidenceRefs": ["roadmap:r14/execution-wave"],
      "prerequisiteWorkIds": ["issue-321"],
      "orderedAfterWorkIds": ["issue-312"],
      "reproductionOrEvidenceFreshness": "fresh",
      "rootCauseState": "not-repeated",
      "rootCauseRef": "github:issue/349",
      "scopeClosure": "closed",
      "exitCriteriaRef": "github:issue/349#acceptance",
      "nearTermConsumerRef": null,
      "humanDecisionRef": null
    }
  ]
}
```
<!-- sec-work-selection-roadmap-catalog-v1:end -->
