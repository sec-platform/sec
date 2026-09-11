---
title: 验收与反例目录
status: stable
domain: verification-governance
---

# 验收与反例目录

本文保存跨版本长期有价值的**验收类别和反例设计**，不是测试运行日志、case数量成绩或某次包的PASS清单。具体可执行test/proof由各实现与Verification Plan生成；本目录定义必须能够被覆盖的语义边界。

## 1. 作者与解释

必须覆盖：

- unknown field / duplicate key /非法schema拒绝；
- definition-kind prefix 使用未声明dialect → 拒绝；
- dialect constraint无法解析到唯一受支持revision、同前缀多义或Binding漂移 → 拒绝/重新绑定，不按本机latest解释；
- value/subject参数角色不混用；
- default只在省略时生效，显式值优先；
- default与硬Requirement冲突不自动改选；
- 同型不同subject不合并；
- `use`每个实例产生准确subject identity；
- `all/any/when/forEach/exists`的作用域、空域、见证与一次求值；
- 未启用分支结构仍合法，但缺运行供给不阻塞独立root；
- `exposes`只能暴露合法public subject/role，不穿透私有use-site；
- native source与structured requirement可共存，不产生双writer。

作者parser/解释器实施后，必须保留**机器可执行的正/负fixture**覆盖上述grammar与绑定语义；fixture是Verification输入，不是第二规范。fixture字段、示例值和目标语言接口只有在对应canonical contract要求它们时才具有长期authority，不能由旧范本字节反向定义Authoring Model。

## 2. 实现选择

必须覆盖：

- 每条Requirement分别有方法但无共同闭包 → 不可完成；
- 相同signature不同behavior → 重新资格判断；
- fast subset + general fallback → 全域保持；
- guard在窄转换前求值；
-高优先级cost unknown不能被低层更快掩盖；
- Pareto trade-off不凭空加权；
- search budget exhausted与logical unsat分开；
- require/pin指向ineligible → blocked；
- candidate order改变不改变稳定decision；
- provider/security/support变化使binding失效。

## 3. 组合与进展

必须覆盖：

- A依赖B、B依赖A无种子 → 不能循环自证；
- 初始credit=0的producer/consumer停滞；
- 每个task局部资源通过、共同并发超预算；
- safety invariant成立但liveness/deadline不成立；
- 不可满足环境导致vacuous safety，不得算产品功能完成；
- 一个root成功不代签共同发行；
-共享mutable instance不能因代码相同而合并。

## 4. 编译、Pass与增量

必须覆盖：

- Pass修改candidate后返回失败 → 不发布半成品；
- CFG不变但range改变 → range analysis失效；
- node地址复用不继承旧identity/cache；
- clean与incremental canonical结果相同；
- cache损坏/unknown → clean recompute；
- doc locator变化不强制semantic recompilation；
- semantic input变化使相交消费者失效；
- Backend不得重选Provider；
- unresolved Target node不得打印placeholder冒充完成。

## 5. 性质保持与证据

必须覆盖：

- target逐输入behavior subset却泄漏secret的noninterference反例；
- 相同随机边际、不同joint distribution；
- source/result相同但timing/log观察不同；
- 实现与checker共同采用错误整数模型；
- checker exit0但结果是incomplete/unknown；
- sandbox/signature合法但checker逻辑恒true；
- closed component正确但host/reentry/alias context破坏保证；
-重复报告不增加统计样本；
- 反复挑最好候选的探索结果不能直接当独立确认。

## 6. 跨实现数据与资源

必须覆盖：

- pin/强引用存在但另一个alias写入；
- copy破坏原alias关系；
- offset/stride计算溢出后错误通过bounds；
- cancellation返回但provider仍访问buffer；
- result已settled但late callback仍需cleanup；
- duplicate completion二次free；
- old method调用数为0但returned handle destructor仍在old module；
- input占满全部capacity导致completion无资源死锁；
- module load主文件hash固定但dependent library解析漂移。

## 7. 成品形式

每种已支持deliverable至少覆盖：

- AuthorDesignClosed、DeliverableContractClosed、ImplementationClosed、VerifiedAndAdopted四层不混同；
- Library只有declare无runtime body → implementation未闭合；
- CLI短写只续确认后缀，partial stdout不能exit0；
- Worker duplicate active ID不终结原请求；
- Handler完成不等于独立service/listener完成；
- Service readiness在真实listen之后，drain后再close；
- Plugin close等待accepted calls/resources；
- Desktop保存期间编辑不被旧save receipt清除dirty；
- Mobile恢复旧Running不能变成Completed；
- Stream checkpoint包含pending/unacked output；
- Migration代码可逆不等于数据一定可逆；
- Firmware reset需要真实fresh safe input；
- RealTime平均latency不证明hard deadline；
- Deployment API返回不等于目标健康/采用。

当某种deliverable已发布机器作者front-end/target API时，应至少有一个正向machine fixture证明可实例化/可降低，并有边界负例；fixture只能验证canonical Deliverable Contract 的实现，不能把某次示例默认值、TypeScript命名或旧schema变成产品语义。

## 8. 变更、迁移与恢复

必须覆盖：

- same/rename/move保持identity，split/merge/replacement产生明确lineage；
- Binding变更不自动改写semantic fact；
- new definition default只影响未显式固定且采用新definition的use-site；
- old in-flight operation继续绑定old generation；
- unknown external Effect先readback，不blind replay；
- rollback code存在但外部/数据状态无法完整回滚；
- consumer-zero前不能删旧reader/release/destructor；
- compatibility只在实际消费维度判断，不因版本号相近成立。

## 9. 信息与文档

必须覆盖：

-同一fact两个authority owner → fail；
- path变化不改semantic identity；
- generated index/HTML/SVG与source diverge → projection invalid；
- search/vector index删除可重建；
- lifecycle/as-built/as-designed不能被“latest”混合；
- applicability变化只影响相交view/consumer；
- stable docs不得包含session/main SHA/PR运行状态；
- obsolete proposal/history不能因“信息不丢”回到active authority。

## 10. 完成原则

验收集合不是固定case ID大全。新机制出现新可观察差异时，由其owner增加相应 property/negative witness；已被通用invariant完整覆盖的重复case不需要复制。删除case/fixture前必须证明其独立故障模式仍被更强property覆盖；机器fixture可以随schema/implementation迁移，但不能成为规范owner。

<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->
## 规范片段

SEC 的验收设计以独立故障模式、边界条件和反例为单位，而不是以case数量为质量指标；任何“完成”都必须能覆盖作者解释（含dialect绑定）、联合实现、组合进展、增量编译、性质/证据、资源寿命、成品消费、迁移恢复与信息authority的相交负例。机器范本只证明canonical contract的某个实现实例，不反向拥有语义。
