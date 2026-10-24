# 本轮直接依据与采用边界

本页记录实际读取的主干/候选规范和公开原始材料。它不以来源权威代替本包设计的正确性，也不把公开资料中的指令当任务授权。

## 仓库来源

2026-10-24实时读取：main `7e70f411755d37f2612aa37996a205e892147ca3`；候选 `0acb144733f106beefc3609d721817816a2e3e8a`。本包增量针对已取得的累计离线设计包，不是已修改的main。

- [author-dialect-supply/1](https://github.com/sec-platform/sec/blob/0acb144733f106beefc3609d721817816a2e3e8a/schema/author/author-dialect-supply-1.schema.json)：供给声明的准确字段、内容身份与设计资格。完整读取；不等于真实Decoder已安装。
- [universal-author-module/2](https://github.com/sec-platform/sec/blob/0acb144733f106beefc3609d721817816a2e3e8a/schema/author/universal-author-module-2.schema.json)：实际读取相关分段，extension的四字段、Kind/Pack、数值、Activation及ValueSource；未宣称本轮重新取得全部大型Schema闭包。
- [旧policy模块](https://github.com/sec-platform/sec/blob/0acb144733f106beefc3609d721817816a2e3e8a/examples/结构化工作台/contracts/policy.json)：完整读取Network/Destruction规则、枚举及公开出口；旧主体模块只读取相关段，未伪造整个IDE工程。
- [旧成品合同](https://github.com/sec-platform/sec/blob/0acb144733f106beefc3609d721817816a2e3e8a/examples/成品形态/contracts/spec.json)：读取1—180行，确认req:value-type的enumMembers与Rule字段形状。
- [结构化源码](https://github.com/sec-platform/sec/blob/0acb144733f106beefc3609d721817816a2e3e8a/docs/作者/结构化源码.md)：相关段确认专业对象Body、精确数字与源回写边界。旧U/画像的实际支持声明仍须按其原修订解释。

## 公开原始材料

| 资料 | 本轮采用 | 不由资料推出 |
|---|---|---|
| [OCaml 5.3 effects](https://ocaml.org/manual/5.3/effects.html) | 效果处理与续体的区别；恢复次数、资源和深/浅处理需要准确规则 | 本包不是OCaml实现；多次恢复及跨目标保持需本身设计和实现 |
| [Lean Function Types](https://lean-lang.org/doc/reference/latest/Terms/Function-Types/) | 依赖函数的显式绑定不同于普通箭头 | JSON类型声明不等于Lean核已验；不自动安装Lean |
| [clingo language](https://potassco.org/guide/language/) | 默认否定、模型/勇敢/谨慎查询有成熟专业语言；本包明确GL reduct | 正程序方法不能自动承接负环；工具结果范围另核 |
| [Strategy Logic with Imperfect Information](https://arxiv.org/html/1805.12592v2) | 策略量化和观察约束独立；一般与可判定子域区分 | 不从有限游戏算例证明任意策略问题可决定 |
| [Hyperproperties survey/source](https://arxiv.org/html/2501.08063v1) | 系统执行集合的性质不等同单次执行谓词 | 同步有限例不覆盖所有异步/概率hyperlogic |
| [Pauli measurements](https://learn.microsoft.com/en-us/azure/quantum/concepts-pauli-measurements) | 不同测量基的区别和状态投影，精确矩阵见本包推导 | 经典模拟值不授予物理句柄或任意克隆能力 |
| [ODRL Information Model 2.2](https://www.w3.org/TR/odrl-model/) | 许可、禁止、义务、违例补救的不同责任 | 本包模型不是现实法律意见；声明不签发权限 |

外部页面按本轮实际读取使用，没有安装工具、获取物理提供者、运行目标产品或证明本文所有定理。


## 专业边界再审采用的直接材料

本次规范对照固定到设计分支`14930bc1da27d3f052a59d306d32d603d0b40cb7`，读取原专业语义、机器结构、供给签名及convergence/model-contracts的实际源。与先前来源的历史取得范围分别保留，不把新解释追认为旧Reader已支持。

| 原始资料及实际读取位置 | 支持的具体采用 | 不外推的内容 |
|---|---|---|
| [PRISM：非概率性质](https://www.prismmodelchecker.org/manual/PropertySpecification/Non-probabilisticProperties)，A/E及其state s解释 | 嵌套CTL在当前状态的路径域求值，而非反复回初态 | 不证明本包任意混合逻辑、概率或现实映像正确；未运行PRISM。 |
| [PRISM：部分可观察模型](https://www.prismmodelchecker.org/manual/ThePRISMLanguage/PartiallyObservableModels)，策略只能读取observables | 完整状态与观察历史是不同信息假设；隐藏状态不由求解器可见性取得 | 本包有限对抗游戏和概率POMDP并非同一产品；不从全信息策略推出部署可用。 |
| [Software Foundations：MoreStlc](https://softwarefoundations.cis.upenn.edu/plf-current/MoreStlc.html)，Pairs节的类型与规约 | 积需形成和投影消去，投影对已求值的积取成员，按值次序显式 | 本包多元积和System F/依赖组合仍需自己的保持证据；未运行Rocq或机械证明。 |
| [Potassco：ASP Basics](https://potassco.org/guide/basics/)，Core Rules与Integrity Constraint | 空体为真，完整性约束淘汰候选；空程序的空答案集不同于无答案集 | 本包无变量有限GL reduct的独立核对不代表一般ASP求解器已接入。 |

因果证据条件化以本包有限噪声枚举及q=P(evidence)直接推导：q为零没有可用的离散归一化条件式；模型族下识别不足是另一命题。混合事件的urgent先行/较小priority优先、轮转中删除上次候选后的定位及有限horizon终点X，均是当前明确选择的设计政策，不借外部名称伪称唯一通用惯例。精确来源支持的规则、本文推导、设计选择与实际工具执行分别记录。
