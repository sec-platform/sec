---
name: sec-ci-and-merge
description: 审查并收口 SEC 的 frozen pull request，核对 exact head/base、Scope、Verification、Review 与 trust-root 边界后执行带 SHA 前置条件的 squash merge和仓库清理。用于 PR 已冻结并要求审查、合并、关闭或清理时；不用于实现产品代码或改写候选历史。
compatibility: SEC 仓库；需要 Git、GitHub CLI，以及对目标仓库的 merge/branch 权限。
---

# SEC CI and Merge

## 不可绕过的前置条件

开始时只读取一次最新 PR/仓库状态，并冻结：

```text
PR number
current default-branch SHA
PR base SHA
exact head SHA
manifest path + digest
changed records
required verification profile
Review submissions + unresolved threads
effective REQUEST_CHANGES
```

只有以下条件同时成立才考虑 merge：

- PR open、非 Draft、同仓库、目标为 default branch；
- PR base 与 live default branch一致，head 与待合并 exact head一致；
-每个 changed path 唯一 owned，无 forbidden/probe/generated drift；
- Scope 与所需 Verification绑定同一 base/head/manifest；
- CI 实际通过，或 verifier trust-root变化已完成受信 base-side manual bootstrap；
-无 unresolved review thread和有效 `REQUEST_CHANGES`；
-能力仍有效，且最新 `main` 尚未包含或取代它。

缺失、pending、cancelled、expired、stale、损坏或 profile不匹配均不是 PASS。

## 禁止改写 frozen head

不得为了“先 squash 再合并”软重置分支或 force-push frozen head。GitHub squash merge本身会把 frozen PR diff作为一个主干提交发布。预先改写 head会使 Scope、Review、Verification 和 merge authority全部失效。

若发现 candidate必须修改，返回实现阶段，产生新的 exact head并重新验证；不得把旧 Evidence贴到新 head。

## Squash merge

再次读取 live PR并确认 `$EXPECTED_HEAD` 与 `$EXPECTED_BASE`仍成立。使用带 `sha` 前置条件的 REST merge：

```bash
gh api --method PUT "repos/sec-platform/sec/pulls/$PR/merge" \
  -f "merge_method=squash" \
  -f "sha=$EXPECTED_HEAD" \
  -f "commit_title=$COMMIT_TITLE"
```

只有响应明确包含 `merged: true` 和 merge SHA才算物理 merge完成。冲突、head漂移或 base变化立即停止，不重试旧 payload。

## Main readback

merge 后必须重新读取：

- PR final state；
- live `main` SHA/tree；
- base→main diff；
- manifest blob是否进入 default branch；
-产品结果是否真实存在；
- active pointer resolver结果；
-相关 Issue是否真的满足完成定义。

Squash merge 后按 tree和行为判断内容是否进入 `main`，不得因原 commit ancestry不在主干而误判遗漏。

## 清理

只在 main readback成功后执行：

1. GitHub 已合并的 PR无需再 `close`。
2. Issue只有全部完成条件真实满足时才关闭；导航 Issue保持开放。
3.确认 head branch没有独有未发布内容后删除远端 branch。
4.移除对应 worktree，再用安全删除本地 branch；不以强制删除掩盖未审计内容。
5.关闭 absorbed/superseded 的镜像、probe、diagnostic PR。
6.复核开放 PR、Issue、CI、branch与 worktree。
7.从新 `main` 重算 rolling plan；不创建只更新 SHA 的 post-merge pointer PR。

工具不能删除远端 branch或 worktree时，准确报告未执行的物理动作，不得把“建议清理”写成“已清理”。
