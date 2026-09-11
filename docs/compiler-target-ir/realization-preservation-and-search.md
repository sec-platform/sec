---
title: 实现资格、联合选择与性质保持
status: stable
domain: compiler-target-ir
---

# 实现资格、联合选择与性质保持

本文拥有 Compiler 在**一个语义要求如何由一组具体实现共同满足**这一问题上的深层合同：use-site qualification、条件实现、联合约束、搜索/优化、性质保持和 Resolution/Binder 的边界。它细化 [Compiler and Target IR](../compiler-target-ir.md)，不创建第二 resolver 或第二 Binding 模型。

## 1. 使用点而不是签名决定资格

候选资格至少绑定：

```text
Requirement/use-site identity
+ semantic/application/behavior revision
+ Target/Profile
+ public consumer boundary
+ required Effects/Permissions/resources
+ source/implementation revision
+ candidate closure and assumptions
+ verification/evidence requirements
```

相同函数签名、包名、版本或 source hash 不能代替使用点资格。两个同型主体仍是两个主体；只有明确共享 identity 才合并约束。

Requirement、Candidate、EligibilityResult、ResolutionDecision 与 ImplementationBinding 保持不同 identity。`Prefer` 只在硬条件全部合格后参与排序；`Require/Pin` 指向不合格实现时必须 blocked，不自动回退成别的候选。

## 2. Requirement 实例与联合实现

编译器不能只证明“每条要求分别存在某个实现”。对于同一成品必须存在**一套共同实现/运行策略**满足该配置的全部约束：

```text
exists ImplementationClosure:
  for all admitted inputs / contexts required by ProductContract:
    all hard obligations hold under the same closure
```

因此以下局部成功不能直接合成：

- 两个方法分别要求独占同一不可共享资源；
- 一个方法的前提依赖另一个方法的后置，而后者又反向依赖前者且没有独立种子；
- 每个测试样例都能临时选择不同程序通过，但没有一份统一程序；
- 同一准确主体被两个 use-site 固定为互斥值；
- 一个共同发行要求六个根全部完成，但只有其中五个取得宿主。

联合求解保留共享主体、作用域、条件、分支、见证、公共资源和实际读集，不提前展开无必要的全笛卡尔积。

## 3. 条件实现与完整输入域

一个快速方法可以只覆盖产品输入域的子集，只要整个绑定提供全域覆盖：

```text
capture exact input once
→ evaluate guard in source semantic domain
→ branch F if all F premises hold
→ branch G otherwise
```

Guard 必须在有损转换、截断、side-effectful getter 或随机读取之前求值。Guard 自身失败/unknown 不能一概当作 false；缺事实、预算结束、provider fault 等分别保留。

F、G及分派条件共同构成一个 ImplementationBinding 的实现闭包。运行时不得重新扫描 registry 或“找最新实现”。可能进入的所有分支都必须随产物取得；只有 Target/static premise 能证明某支不可达时才可裁剪。

内部条件不成为新的业务错误。产品接受 `2^63`，而 F 只支持 i64 时，`2^63` 应走 G，不能变成产品输入非法。

## 4. 支持图与循环前提

组件保证通常具有前提。编译器构造 support obligations，而不是把所有条件保证当事实：

```text
Guarantee G is usable iff
  every premise P has an independent admitted support
  or P remains an explicit public import of the deliverable
```

`A requires B first` 与 `B requires A first` 不会自己产生进展。合法反馈/递归可以有环，但必须提供初态、信用、固定点规则、调度/公平或其他真实支持。

安全与活性分开：状态不变量保持不代表系统会启动、完成或满足 deadline。容量/credit/queue 等资源也进入支持闭包，不能用 policy 声明制造物理容量。

## 5. 共享资源与组合预算

候选的局部资源界不能机械相加或机械去重。组合器按真实 owner、alias、lifetime 与并发区间建立资源需求：

- shared immutable code/data 可以按真实一份计；
- 两个独占 buffer 不能因内容相同合并；
- input/output/callback/cleanup 峰值都计入；
- 串行化只有在不违反公开并发/进展/deadline 时才是合法优化；
- unknown 上界不能被低优先级更快指标抵消。

## 6. 搜索、可行性与偏好

搜索首先求可行闭包，再在合格候选间按 approved policy 排序。

结果必须区分：

- `eligible` / 可行；
- `ineligible` / 有反证；
- `unknown` / 事实不足；
- `unsupported` / 当前能力不表达或目标不支持；
- `budget-exhausted` / 搜索未完成；
- `conflicted` / 输入权威事实互斥。

搜索预算耗尽不是逻辑无解。发现一个可行者后可按调用者目的提前结束；只有请求已定义“全局最优”且比较域/证据足够时才继续证明最优。

### 偏好比较

高优先级指标先比较。只有高层确定相等才进入下一层；存在 trade-off 或 unknown 时保留 Pareto/frontier，不凭空给不同量纲加权。

区间重叠、统计不显著或“没有测出差异”不等于相等。候选成本包含边界转换、冷启动、排队、复制、同步、设备传输、失败收尾与长期维护，不只比较内核 benchmark。

运行时由求解器选择的 `any/exists` 分支不能各自偷偷携带不同偏好而改变评价函数；公共偏好放在可比较共同 scope，确有条件评价则显式建模。

## 7. 实现演进与再次选择

Requirement 从 Q@2 变为 Q@3 时，旧方法 M@2 只有在**受影响义务仍有保持依据**时可继续使用。相同名字/签名不足以证明保持。

候选集变化不总是触发重选：

- policy 是“保持合格 binding”时，新候选出现不影响当前 binding；
- policy 是持续优化且用户接受成本时，可重新比较；
- security/support/license 等硬条件变化使旧 binding invalid；
- 只改 locator/document path 不改变 semantic input，不触发实现重选。

## 8. 性质保持不是一种关系

不同 Claim 需要不同 preservation relation：

| Claim | 保持对象 |
|---|---|
| 确定计算 | 指定输入上的结果、业务错误、终止/Effect观察 |
| trace property | 相关完整轨迹与允许投影 |
| confidentiality/noninterference | 不同 secret runs 之间的公开观察关系 |
| randomized/probabilistic | joint distribution、correlation、sampling identity、error bound |
| open component | 允许 target/linking context 中的行为 |
| time/resource | 明确环境和成本模型中的界限 |

“target behavior ⊆ source behavior”只对适用的 downward-closed 性质成立。例如源对每个 secret 都允许 `{0,1}`，目标直接输出 secret，逐输入仍是子集，却破坏跨运行非干扰。

Observation projection 由 Claim 定义，不由实现者为了容易证明而删掉 timing/log/resource 等受保护维度。

## 9. 验证候选与生产资格

某些方法必须先生成候选才能取得 Evidence。允许为**verification purpose**形成准确、隔离的 provisional Binding，保留尚未证明的命题；这不自动成为 production Binding。

```text
candidate buildability
!= verification admissibility
!= production eligibility
!= adoption
```

测试退出 0、checker self-report 或 caller 填 `verified=true` 都不能直接提升资格。Evidence 如何接纳由 Verification Governance 拥有。

## 10. 无解/空真与正常功能

若实现通过互相矛盾的环境假设让“坏状态不可达”，只能得到相应 conditional statement，不能宣布产品完成。产品声明的正常非空输入/输出/progress 要求必须与 safety 一起满足。

明确允许的空集合继续按逻辑语义处理；但整个产品没有正常功能不是因此自动完成。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

Implementation Resolution 以准确使用点和完整共同闭包判断资格；条件实现必须覆盖原产品输入域；搜索区分不可行、未知、能力不支持与预算耗尽；保持关系由实际 Claim 决定。任何签名、包名、局部测试或单次绿色都不能替代共同产品资格。
