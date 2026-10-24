# 开放计数的作者关系范本

活动源只有`design/*.module.json`与`library/*.module.json`，同一compact设计编码；derived只读对照和changes比较不进入源集合。

[应用源码](design/count.module.json)要求准确分类，公开evaluate接口输入CountQuery、输出Evaluation。输入range由lower与UpperBound构成；UpperBound为Unbounded(unit)或Finite(Int)，threshold为非负整数。结构合法但负阈值、负lower或Finite小于lower得到InvalidInput。字节/类型解码失败不是这个普通数值结果。

[完整解释库](library/count-envelope.module.json)包含18个定义，其中11个无递归纯解释函数；全部本地引用在库中，标准依赖仅为既有std:IntCompare。AtLeast、AtMost、Exactly沿原domain:meaning调用准确关系主体，不是未提供的库名。

分类对所有可能整数的包络成立，不自签现实资料是否落在范围内。AllSatisfy/AllViolate不是HostGrant或整个业务完成；Undetermined可以是本次正确查询结果。调用者可以提供假设范围做纯分析，现实采用必须绑定合格资料及当前用途。

[第二次修改](changes/exact-count.patch)将AtLeast改为Exactly。lower=3、upper=Unbounded、threshold=3的结果从AllSatisfy变Undetermined，角色、条款和API结构不变，行为与相交接受变化。after文件仅作比较。

[数学向量](mathematical-inputs.json)使用独立的记录编码，不是Gift运行值编码、Provider证据或实际运行结果；其中null仅表示没有有限上界。实际类型使用Unbounded(unit)，不接受JSON Infinity。

完整规范：作者含义、覆盖变换、更正与作用、同源编辑和VS Code呈现已进入本包六份规范正文。没有生产Reader/Target、真实数据接入或运行结果；不会把纯数学源冒充已部署监测服务。

Goal与接口的同处导出不自动形成运行绑定。实际组合应由原UseBinding把evaluate输入接query、返回接evaluation并固定所选条款；本样本只给出准确关系和接口形状。按边界比较得到唯一结果的正常算法已写入规范，尚无生产Target或实际端点。
