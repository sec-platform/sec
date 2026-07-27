---
name: sec-work-package-lifecycle
description: 创建、选择、发布和轮换 SEC 的唯一 frozen Work Package，并保持 current-state、rolling-plan、active pointer与 manifest parser一致。用于开包、换包、归档历史包、修复控制面漂移时；不用于产品实现或凭空设计新的 manifest schema。
compatibility: SEC 仓库；需要 Bun 和 Git。所有 manifest 必须通过 scripts/codex/work-package-contract.ts 的当前 parser。
---

# SEC Work Package Lifecycle

## 唯一合同

Work Package 机器格式只以 `scripts/codex/work-package-contract.ts` 为准。当前允许：

```text
codex-development-work-package-v1
codex-development-work-package-v2
```

不得发明任何 parser未接受的 schema、状态或字段。正文可以解释背景，但 owner、路径、base、acceptance 与 Evidence composition必须进入当前 schema允许的位置。

## 开包

1. A0执行一次 `bun scripts/codex/document-control-plane.ts status --json`，确认 live default ref和控制面 resolved。
2. 从 exact current `main`创建 `docs/work-packages/<id>.md`。
3. V1 manifest必须完整提供：

```text
schema
id
tracking
base
manifestState: frozen
requiredProfile
ciRevision
tasks[].id / owner / ownedPaths
forbiddenPaths
acceptance
tests
```

4. V2 manifest必须严格按当前 parser提供 `evidenceComposition`等精确键；不得把 V1/V2字段混用。
5.所有路径使用规范化 POSIX仓库相对路径；每个 changed record恰好一个 owner，rename/copy两端同 owner。
6.先 stage manifest，再按 Git blob bytes计算 digest：

```bash
git show :docs/work-packages/<id>.md | bun -e "const c=[];process.stdin.on('data',x=>c.push(x));process.stdin.on('end',()=>console.log('sha256:'+require('crypto').createHash('sha256').update(Buffer.concat(c)).digest('hex')))"
```

7.同一 candidate中原子更新：
   - `docs/work/active-work-package.md`
   - `docs/work/rolling-plan.md`
   - 新 frozen manifest
8. pointer必须保留当前 `selectionMode`、default ref、manifest path、Git-blob digest与 fail-closed语义；不得把 pointer写成 parser不支持的 `none`。
9.运行 manifest parser、changed-record ownership、控制面 lifecycle 与 `bun run docs:doctor`。

## 发布后的 selected manifest

selected manifest进入 default branch后，共享 resolver会因 `matchingDefaultBlob`语义返回运行态 `none`。这不等于可以立刻删除或移动 pointer引用的文件。

在没有下一个已冻结 Work Package时：

-保留 pointer；
-保留 `docs/work-packages/<selected>.md`；
-保留 rolling plan的当前包摘要；
-让 resolver从 live default branch确定 `none`。

禁止把仍被 pointer引用的 selected manifest移入 archive。

## 轮换与归档

只有下一个 Work Package已经冻结时，才在**同一个 candidate**中：

1.创建下一个 `docs/work-packages/<next>.md`；
2.更新 pointer到 next path和 digest；
3.更新 rolling plan；
4.把旧 selected manifest移入 `docs/archive/work-packages/`；
5.确认 `docs/work-packages/`中只有新 selected manifest；
6.运行 `bun run docs:doctor`与 lifecycle合同。

非 selected 的完成包应归档。不得单独批量移动 manifests后再补 pointer，也不得为每次 squash merge创建只更新 commit/PR identity的 closeout包。

## 控制面写预算

正常 Work Package只在开包与最终轮换/收口各更新一轮。普通进度只进入 Reconciliation Delta。只有 base、authority、contract、ownership、Review/CI blocker、用户 Goal变化或明确 `reload_if`才重新解析完整控制面。
