# 贡献 SEC

这一部分面向开发 SEC 本身的人。

普通用户不需要先理解 SEC 的全部开发控制面才能使用产品。

## 先区分三层

```text
Product / Engineering semantics
Repository development governance
Hosted Git / CI / Review transport
```

三者不能混在一起。

## 正式开发入口

精确开发规则以：

- `AGENTS.md`
- `docs/development-governance.md`
- `docs/verification-governance.md`
- `docs/authority.json`
- current machine control plane

为准。

本页只负责解释，不取得 effect authority。

## Contributor 应先理解的原则

### 一个 Responsibility 一个 Owner

新增代码前先确认真实 semantic owner，而不是先选目录。

### Current physical facts 优先于聊天

Branch、Issue、PR body、报告和 AI memory 都不能证明当前 main 的真实实现状态。

### Candidate 不能自证 Trust Root

如果 candidate 修改 verifier、selector、Skill、CI trust 或 merge authority，它只能作为 SUT，被 trusted/independent path 验证。

### Review、Verification、Integration 分层

```text
Review 找设计/实现问题
Verification 证明 exact Claim
Integration 判断是否允许进入正式状态
```

一个绿色测试不自动等于 merge authority。

### Failure 必须路由到 Owner / Invariant / Next Action

“命令红了”不是 root cause。

### Affected / Incremental 是优化

最小执行 closure 的前提是：不能比 clean/reference truth 少掉必要工作。

### Compatibility path 必须有 Retirement Condition

临时 adapter、facade、fallback 和 legacy path 不能因为“以后再删”永久存活。

### Provider 只拥有机械能力

第三方库、工具、GitHub、Agent、AI 都不能因为被接入就取得 SEC semantic authority。

## 开始修改前

Contributor 应建立：

```text
current main
→ selected work identity
→ canonical owner closure
→ exact scope
→ acceptance
→ required verification
```

不要靠全仓预读和聊天历史建立“熟悉度”。

## 修改完成后

至少回答：

- 哪个 canonical state 改变了；
- 哪些只是 projection/artifact；
- Delta / Impact 是什么；
- 哪些 Verification required / not-applicable / unresolved；
- 有没有旧 writer/compatibility path 需要退役；
- new-main readback 后现实状态是什么。