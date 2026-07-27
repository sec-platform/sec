---
name: sec-a0-integrator
description: 组织 SEC 正式开发运行，冻结唯一 Work Package、Task Envelope、candidate 与验证请求。用于用户要求继续开发、启动或重算工作包、分派 Worker、冻结候选、触发 Scope/Quick/Full 或处理 STOP_PROOF_RESET 时；不用于 Worker 的具体产品实现。
compatibility: SEC 仓库；需要 Bun、Git，以及执行 GitHub repository_dispatch 时可用的 GitHub CLI。
---

# SEC A0 Integrator

## 权威与职责

本 Skill 是 `AGENTS.md`、`docs/04-AI自主实现执行蓝图.md`、`docs/test-feedback-and-ci-lanes.md` 与代码合同的可执行投影，不产生第二套工程事实。发生冲突时停止，并以最新 `main`、canonical owner、真实 diff、CI、Review 和 parser 为准重算。

A0 独占：

- 当前 DAG、唯一 active Work Package 与 Task ownership；
- candidate freeze、Gate custody、Review/merge/closeout；
- `reload_if` 裁决和分支/worktree 收口。

A0 不替 Worker 并行修改同一 owner，不为普通纵切片制造子 Agent，也不靠轮询等待。

## 开包

1. 只执行一次 `bun scripts/codex/document-control-plane.ts status --json`。
2. 只有 default ref、GitHub facts、active pointer 和 workspace 全部 resolved 才继续；`unresolved`、`invalid` 或已有未收口 active run 均 fail closed。
3. 从最新事实冻结一个 Work Package，并向每个 Worker签发一个 Task Envelope：

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

4. 单一纵向切片默认零 Worker；只有两个以上依赖已满足、路径与 authority 完全不重叠、可独立提交的 seam 才允许并行。
5. 新用户修正先 reconcile；不得在没有新用户消息的情况下扩大权限或 scope。

## 冻结 candidate

只有同时满足以下条件才进入 frozen point：

- branch 只有一个正式 candidate；
- base、HEAD、tree、manifest digest 与 base→HEAD changed records 已确定；
-每个 changed path 恰好一个 owner，且无 forbidden path；
- worktree/index 无未解释漂移；
- focused evidence、适用 typecheck/docs/affected 已按变化类型完成；
-没有未处理的新用户修正。

冻结后不得为了整理历史改写 exact head。任何代码、manifest、base、authority 或用户 scope 变化都会产生新的 candidate generation，并使旧 Review/Gate Evidence失效。

## Scope Attestation

以下变量必须先从同一个 live PR 与 frozen manifest读取：

```text
$PR
$EXPECTED_HEAD
$EXPECTED_BASE
$MANIFEST_DIGEST
```

提交完整 payload，缺少任何键都不得 dispatch：

```bash
gh api --method POST repos/sec-platform/sec/dispatches \
  -f event_type=sec-scope-attest-v1 \
  -F "client_payload[pull_request]=$PR" \
  -f "client_payload[expected_head]=$EXPECTED_HEAD" \
  -f "client_payload[expected_base]=$EXPECTED_BASE" \
  -f "client_payload[manifest_digest]=$MANIFEST_DIGEST"
```

## Frozen Verification

以下变量必须与 Scope Attestation 的 exact identity 相同：

```text
$PR
$EXPECTED_HEAD
$EXPECTED_BASE
$MANIFEST_PATH
$MANIFEST_DIGEST
$PROFILE
```

只允许 `quick` 或 `full`：

```bash
gh api --method POST repos/sec-platform/sec/dispatches \
  -f event_type=sec-verify-frozen-v1 \
  -f "client_payload[schema]=codex-development-frozen-verification-request-v1" \
  -F "client_payload[pull_request]=$PR" \
  -f "client_payload[expected_head]=$EXPECTED_HEAD" \
  -f "client_payload[expected_base]=$EXPECTED_BASE" \
  -f "client_payload[manifest_path]=$MANIFEST_PATH" \
  -f "client_payload[manifest_digest]=$MANIFEST_DIGEST" \
  -f "client_payload[profile]=$PROFILE"
```

同一 exact Gate identity 已有未失效结果时直接复用。长 Gate 独立调用；禁止复合 shell、`Promise.all` 或主动轮询。

## Trust-root 变化

候选若修改 `.github/workflows/`、`docs/scripts/docs-doctor.ts`、`platform/shared/test-impact-rules/`、`scripts/codex/` 或其他当前 verifier trust root：

1. candidate 不得用自身新规则自证；
2. Scope 可由受信 base 验证；
3.执行独立 exact-head Review；
4.按当前 base-side manual bootstrap 合同验证；
5. merge 后 main-tree readback；
6.返回 `TASK_RESTART_REQUIRED`，新任务重新加载 trust root。

不得反复发送必然返回 `manual-bootstrap-required` 的 candidate-hosted Verification。

## STOP_PROOF_RESET

第二次**同一根因簇的 frozen candidate invalidation**后：

1. 停止 Review、affected、Quick、Risk、Full 与 merge；
2.保留当前 branch、diff、failure tail 和 Evidence；
3.重新冻结 failing reproduction、唯一 owner、invariant 与 changed-path census；
4.输出 `STOP_PROOF_RESET` 和决定性 blocker；
5.由 A0 重算当前 Work Package。

禁止硬重置工作树、删除未审计工作或把普通开发中一次测试失败计为 candidate invalidation。
