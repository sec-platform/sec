# `/2` 最小持久作者工程与第二次修改

这是完整可读的结构设计正例，未运行产品 Reader、编译器、发行或真实效果。仅需私有定义时可删模块 exports，并移除不再需要的发行文件及对应 SourceScope；不为每个小程序强制建包。当前示例保留公开常量和可选发行描述以说明两种导出的不同责任。

另外提供一份**独立结构正例** [typed-values.module.json](typed-values.module.json)，不在上述工程的 `sourceScopes` 内，因此不会偷偷增加最小工程的模块、目标或发行成员。它在同一 `gift.author-module/2` 中展示：`ExactPrice` 的精确十进制定点 `{"coefficient":"120","scale":2}`、`BytePrefix` 的明示 hex 字节值 `"00ff"`，以及 `MakeIdentity` 返回的函数值，其 lambda 主体采用 `ExecBlock` 和局部 `var/set/if/return`，对应选定文本 `(n: Int) => scope { var copy = n; set copy = n; if true { return copy; } copy }`。外部返回类型是 `(Int)->Int` 的显式函数类型；两个局部绑定与普通运行变量不成为工程级身份/运行时Grant。例中条件为true，因此 `return` 发生在此lambda内；结构类型与真实控制分析仍须由其未来Reader/Checker验证，这里不声称已经执行函数或获得目标源码。

示例对照的非法情况包括：decimal 直接填 JSON `1.20`、bytes 缺编码、float 直接填 JSON `0.5`、lambda 的 `break` 穿越其词法外层循环，以及将 `scope {}` 静默等同于空记录 `{}`。前三项由选定新Schema显式拒绝或要求合格值构造；后两项由准确文本与控制 Checker 负责，不把 Schema 的结构合法性当作完整执行语义资格。该文件是工程设计示例，不增加测试Runner、IR账本或另一个作者源格式。

第一次输入由[工程清单](gift.project.json)、[作者模块](design/limit.module.json)和可选[发行描述](gift.package.json)组成。工程没有 targets/defaultTarget，因而是合法未生成工程，不声称有可执行入口。此时也没有依赖或目标解析结果，不填假锁；生产 Resolver 实际选择解释或供应后才保存真实绑定。

读入时先固定 Project 字节及受权 SourceScopes，捕获唯一 `module:limit` 作者文件，按准确 `/2` Schema 解释 `core:constant`；派生 ModuleIndex 指向该文件的真实源身份与修订，不由作者再填 modules 表。公开名 Limit 解析到本模块同名 Definition，包的 `.` 仅选择这个已公开出口，不重新公开私有定义。整数位宽/溢出与字面值由类型/值消费者核验；Schema 合格不自行证明任意目标能保持它。

第二次修改基于第一次固定前像，把 `design/limit.module.json` 中唯一 `body.value.value` 从字符串 `"3"` 改为字符串 `"5"`，保留 `moduleId`、Definition 键、公开名和类型合同。整数统一用规范十进制字符串，即使此值落入宿主安全整数范围也不另写 JSON number。结构化编辑可在准确前像上定位 `/definitions/Limit/body/value/value`，但该 Pointer 不是跨修订身份，重命名或并发变化后须重取来源与复证。新候选改变常量内容修订及其真实依赖消费者，不改变包的公开定位，也不因正文变化重选无关依赖。真实保存比较当前文件前像与权限，冲突保留双方内容；未要求保存时只返回候选。版本 `0.1.0` 是此例作者选择，不意味着已发布；若外部已发行同标签，重新发布不同内容必须由发行 Owner 拒绝或形成明确新版本，不能凭本地编辑覆盖外部包。

读回需取得实际写入的新作者字节及源修订。这个结果只证明相应源保存，不能据此声称源码生成、包上传、业务接受或运行观察已完成。旧 `/1` 输入须经过[全字段迁移](../../../docs/作者/工程源/清单模块与绑定锁.md#successor-author-project-contract)，不得仅改 schema 标签进入本例。
