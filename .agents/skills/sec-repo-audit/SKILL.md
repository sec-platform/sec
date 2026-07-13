---
name: sec-repo-audit
description: "在规划、继续开发、判断合并或仓库收口前，审计 SEC 当前 main、PR、Issue、branch、review、CI 与真实 diff；纯解释单个函数时不要触发。"
---

# SEC Repository Audit

本 Skill 只收集和裁决仓库事实，不修改文件、不触发 CI、不 merge/close PR。

## 必读输入

1. `AGENTS.md`
2. `docs/00-文档索引与一致性规则.md`
3. `docs/03-MVP实施计划与路线图.md`
4. `docs/04-AI自主实现执行蓝图.md`
5. 与候选变化直接相关的 authority、代码和测试
6. 对应 active `docs/work-packages/<id>.md`（若存在）

## 执行

1. 记录审计时间、default branch 与 exact `main` SHA。
2. 读取 open PR/Issue、最近 main commits、相关 branch head/base。
3. 对每条相关演进线检查：
   - merge-base、ahead/behind；
   - 真实 changed paths 和 diff；
   - main 是否已通过 squash/其他实现包含同等产品结果；
   - draft/ready/mergeable 状态；
   - unresolved review thread、review submission、`REQUEST_CHANGES`；
   - exact-head/current-base verification evidence 与失效边界。
4. 交叉检查 roadmap、authority、代码和测试；PR body、Issue、branch name 只作为线索。
5. 识别正在进行的单写者范围，禁止推荐与其 canonical surface 重叠的第二条写入线。
6. 计算当前最高杠杆动作：继续实现、先补计划、修 blocker、验证、merge、closeout，或不修改。

可用 subagent 时，委派 `repo-state-auditor` 做 read-only 收集；Root A0 负责最终裁决。

## 输出

```text
Audit as of:
Current main:
Open product lines:
Confirmed facts:
Unconfirmed/tool boundaries:
Authority conflicts:
Evidence freshness:
Ownership collisions:
Recommended next action:
Work Package plan required: yes/no + reason
```

必须使用 exact refs。工具不支持的物理操作或不可见元数据要明确标注，不得推测。
