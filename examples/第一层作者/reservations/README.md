# 资源预留：业务通用机制的完整关系源码

本工程是设计样本，不是已运行服务。活动作者源只有design和library，统一采用compact-design-draft；库使用同一codec的完整Definition分支，应用使用短Goal。derived是只读/2结构对照，changes是后继比较，不属于活动源。

[第一层实际源码](design/reservation.module.json)仅引用真实库中的NoOversell；[完整关系库](library/reservation.module.json)有42个Definition、30个纯解释函数，所有本地引用与所用类型已给出。std只使用固定的IntCompare、IntAdd和SeqUncons，不虚构第三方模块或Target。

[第二次修改](changes/keep-one-free.patch)在本工程根应用，将NoOversell改成KeepOneFree。它只限制新的成功预留；旧承诺和在途操作不由新源码自动消失。after副本仅用于比较，不能复制进design与原模块共同加载。

完整语义、互斥且覆盖的正常/错误分支、终止度量、容量归纳、实际消费者绑定、并发/恢复/权限/活性与不适用范围由[范本正文](../连续修改与反例.md#reservation-business-source)、[执行接合](../../../docs/开发/第一层编译承接.md#business-invariant-effect-lowering)和[角色写权](../../../docs/作者/紧凑结构与同源编辑.md#stateful-business-source-ownership)承担。

State是业务模型的状态，不是客户端自报的权威。Relation检查前后项不执行预留，也不保证真实数据库提交；只有真实Method/Provider按上述消费者映射接入后才能声明该运行资格。库提供成功业务状态幂等性，不单独提供全部成功/失败Operation回执的持久重试协议。释放已确认项被拒绝，补货/退款/到期/跨pool转移没有偷偷实现，须在真实任务中按独立语义扩展。

本轮仅做结构、词法、使用点类型形状与调用图核对，以及独立有限数学计算；未运行此Gift程序、完整官方Schema验证、目标工具或仓库测试。库完整成本已计入包内，不用隐藏大型语义库制造“通用只需一行”的宣传。

## 选择能力合同，不把固有不变量变成日常开关

这个Goal选择并绑定库中完整的NoOversell关系，不是在一个已经选定相同预留能力后又重复要求作者决定“是否允许超额”。合法输入、状态、正常/失败及不变量随该准确合同进入同一Use；应用作者只维护实际选择、对象绑定和独特参数。需要所有调用点再抄一份不超额条款，或允许用局部reset关闭这项固有保证，都违反[第一层合同继承](../../../docs/作者/第一层语言.md#inherited-contract-author-delta)。

KeepOneFree是新的准入政策差异，不是重新实现原预留算法。它对新请求的适用范围由真实合同决定；已经接受的独立不超额承诺、历史成功及在途责任不能通过删Goal或改库名解除。两个Use绑定同一pool/epoch时还要联合履行共享容量，分别满足纯关系不能代签现实并发安全；选择不同pool也不能用来回避原先共同对象上的要求。

此有限可替代数量模型不自动等于预售、独特座位、第三方交付或支付。真正引入这些模式时采用其精确对象、变体和合同，不能修改标签后宣称已有全部能力。本次不改机器定义或作用协议，只将现有例接到[继承合同的编译消费者](../../../docs/开发/第一层编译承接.md#inherited-contract-elaboration)及[可判错出口](../../../docs/运行/验收/第一层开发面.md#inherited-contract-acceptance)；实现和运行证据保持原未取得范围。
