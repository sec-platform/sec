---
title: 性质覆盖、解释与证据接纳
status: stable
domain: verification-governance
---

# 性质覆盖、解释与证据接纳

本文拥有一个 Verification 结果**究竟支持哪个 Claim、依赖什么模型/编码/工具、能否被当前用途采用**的完整接纳规则。执行环境/session仍由 verification execution owner 管理，本文不生产被验证 artifact，也不授予 Effect。

## 1. Evidence 不是绿色字符串

接纳链：

```text
E0 Claim identity + required observation/universe
E1 exact candidate/input/environment
E2 representation/encoding/model alignment
E3 reasoning basis + assumptions/trusted steps
E4 actual tool/test/observation result
E5 support direction and coverage
E6 consumer/adoption policy
E7 freshness/invalidation
```

任一阶段缺失都不能被后续 PASS 补偿。

Signed tool、sandbox、exit code 0、测试数量或 provider self-report只分别证明它们真实证明的事实，不等于 Claim 成立。

## 2. Claim 的观察和量词

Claim 定义：

- subject/revision；
- input/context universe；
- observations；
- quantification（single run/all runs/pairs of runs/distribution/linking contexts等）；
- acceptance relation；
- allowed approximation/risk；
- required evidence type/freshness。

实现者、checker或报告不能为了容易验证缩小 universe/observation。

## 3. 不同性质的验证

### 单执行/功能

确定函数可以对完整有限域枚举、symbolic proof、property-based tests或组合证据。测试只覆盖其输入/环境；样本成功不外推到全域。

### Trace property

需要捕获 property 真正使用的 event/order。只比最终返回值不能证明“没有中间非法Effect”。

### Noninterference/hyperproperty

需要比较多次运行/secret contexts之间的公开观察关系。逐输入结果都属于 source allowed set 仍可能泄露secret，因此普通 trace refinement 不足。

### Probability/statistics

要绑定 joint distribution、sampling identity、随机源和统计假设。边际相同不证明独立/联合相同；support set相同不证明概率相同。

### Open component/security

闭合 unit test 不证明面对允许/恶意 host、alias、reentry、reflection或native context仍成立。需要固定 closed assembly、真实 isolation premise或适用的 robust preservation 证据。

### Resource/time

需要 exact environment、workload、warm/cold、measurement method和统计/upper-bound语义。平均/benchmark不能替 hard realtime bound。

## 4. 模型与原要求对齐

“实现与Oracle一致”仍可能两者共同错误。例如产品要求数学整数，而实现和checker都使用有符号固定宽度回绕。

因此 Evidence 必须携带或可追溯：

- source Claim；
- translation/encoding；
- target theory/semantics；
- axioms/assumptions；
- unsupported/trusted steps；
- checker semantics；
- exact candidate bytes/IR。

Proof checker成功只支持它实际接受的公式/规则。`incomplete/unknown/trusted-step`等状态不能被 wrapper 改名为 PASS。

## 5. Evidence 聚合

多个 Evidence 只有在 Claim、subject、revision、universe和支持方向兼容时组合。复制同一报告不是新样本；同一底层数据派生的多个统计结果不是自动独立。

Evidence可以相互矛盾。系统保留各自 provenance并产生 conflict/frontier，不做“多数票变真”。

## 6. 探索与确认

实现搜索/benchmark不断尝试候选会对数据产生选择反馈。探索结果可以指导优化，但最终“优于基线”等确认性结论需：

1. 固定要确认的候选和结论；
2. 使用没有被该选择过程不当消耗的确认数据/预定方法，或适用的顺序/多重比较方法；
3. 记录失败样本和停止规则；
4. 绑定环境与成本口径；
5. Adoption后环境/版本变化使结论失效时重开。

确认失败不阻止继续探索，但已经看过的确认结果参与下一轮选择后，不再自动是全新的独立确认。

确定性完整枚举/形式证明不因为本协议被强制统计留出。

## 7. Requirements、Evidence 与 Verdict 分权

Requirement/Claim owner声明“必须是什么”；Evidence owner记录“观察/证明了什么”；Verdict owner按 policy/coverage/freshness评价。Evidence不能反向放宽 Requirement，producer也不能自签 Verdict。

监控发现“泄漏已经发生”可以证明事故/观察，不能替“泄漏从未发生”的预防性质。

## 8. 失效

Evidence至少在下列变化时检查失效：

- subject/candidate bytes/Binding；
- Claim/universe/observation；
- tool/checker/version/config；
- Target/environment/dependency；
- upstream model/encoding；
- security/support/expiry；
- dataset/benchmark protocol。

只改无关 locator 或报告排版不应失效语义证据。

## 9. 信任基与成本

并非所有任务都需要把整个世界形式证明。成熟 compiler/typechecker/test framework 可以在明确的 trusted computing base 中使用；高保证任务若不接受该T CB，再要求证书、独立 checker、redundant implementation或更强隔离。

信任选择本身是 governed risk decision，不能伪称“独立证明”。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

Evidence只有在Claim、观察/量词、编码/模型、推理基础、真实结果、coverage、采用政策和freshness全部对齐时才能支持Verdict；单次绿色、工具获准执行、实现与同模型checker一致或重复测量都不能越过其真实证明范围。
