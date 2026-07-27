---
name: sec-worker-development
description: 在 A0 签发的 SEC Task Envelope内实现单一 owned seam，执行 focused validation、候选冻结前检查并返回精确 Reconciliation Delta。用于已获得明确 owner、owned/forbidden paths、acceptance与 tests 的 Worker开发任务；不用于选择路线、触发 hosted Gate、合并或扩大 scope。
compatibility: SEC 仓库；需要 Bun 和 Git。Worker默认不拥有 GitHub merge、Gate dispatch或控制面重算权限。
---

# SEC Worker Development

## 接收条件

开始前必须得到一个完整 Task Envelope：

```text
goal / issue
exact base
branch
owner
owned paths
forbidden paths
prerequisites
acceptance
focused tests
gate_owner
stop condition
reload_if
```

缺字段、base漂移、owner冲突或存在未 reconcile用户修正时停止并交还 A0。Worker默认消费 A0 已冻结的 Capsule，不重复执行全量 status；只有命中 `reload_if`或 Envelope明确要求时才请求 A0重载。

## 实现闭环

1.只读取 acceptance、相关 canonical owner、公共类型、直接消费者和 focused tests。
2.在指定 `feat/`、`fix/`、`refactor/`、`docs/`或 `chore/`分支实现唯一纵切片。
3.不得修改 forbidden path、顺手重构相邻模块、删除覆盖、弱化断言或扩大 timeout。
4.开发中只运行当前 failing/focused sentinel：

```bash
bun test <focused-test-paths> --timeout 180000
```

5. TypeScript稳定后最多运行一次适用 typecheck；active docs变化时运行一次 docs doctor。
6. candidate准备冻结时先运行只读计划：

```bash
bun run check:affected --plan
```

7.只有计划 resolved且最终变化类型要求 affected时，运行一次：

```bash
bun run check:affected
```

8.显式 stage owned paths，检查 base→index diff和 changed-path census。
9. commit前调用唯一 authoring organizer：

```bash
bun run imports:freeze
```

10.确认 organizer只修改 index、working tree无未解释漂移，然后 commit、push或更新 Draft PR。
11.返回 Reconciliation Delta并停止。Worker不得触发 hosted Quick/Risk/Full、merge或 branch cleanup。

## 失败与 candidate invalidation

开发中尚未冻结 candidate时，focused test失败只是实现反馈，不增加 `candidate_invalidation_count`。

只有 frozen candidate因代码/manifest/base/authority变化，或 exact-head Review/Gate发现真实产品/合同缺陷而失效，才计一次 candidate invalidation：

-第一次：只修失败 delta并 refreeze一次；
-第二次同一根因簇：停止昂贵验证，输出 `STOP_PROOF_RESET`；
-瞬态基础设施失败、网络失败、executor不可用和用户主动改 scope分别记录，不冒充产品 invalidation。

禁止自动回退或硬重置工作树，也不得删除未审计工作。

## Reconciliation Delta

所有值来自实际命令或工具结果。未测量的 duration使用 `null`，不得编造估算。至少返回：

```json
{
  "tested_head": "<exact SHA or null before commit>",
  "tested_base": "<exact merge-base SHA>",
  "changed_files": [],
  "changed_symbols": [],
  "authority_delta": [],
  "acceptance_delta": [],
  "focused_results": [],
  "reusable_evidence": [],
  "invalidated_evidence": [],
  "blocker": null,
  "next_ready_seam": null,
  "metrics_ms": {
    "inspect": null,
    "implement": null,
    "focused_validation": null,
    "wait": 0,
    "reconcile": null
  },
  "counters": {
    "context_reload_count": 0,
    "duplicate_gate_count": 0,
    "tool_call_count": 0,
    "agent_spawn_count": 0,
    "agent_wait_timeout_count": 0,
    "context_compaction_count": 0,
    "candidate_invalidation_count": 0
  }
}
```

若无法读取某项，写明 `null`与原因；不得把计划、推测或旧 head结果包装成 exact-head Evidence。
