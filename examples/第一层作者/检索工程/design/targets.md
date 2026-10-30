# 目标设计画像声明：精确目的与保持

本设计声明选择profile:retrieval-rust revision1及profile:retrieval-admin revision1。它们是被本Project捕获的准确设计合同，不是已注册/安装的Target Provider。实际consumer尚未实现时保留对应Needs；不靠profileRef字符串签资格。

## profile:retrieval-rust / 1

目标语言Rust。command输出选assembly/CommandLine公开system边界，形成命令行入口与服务实现；其查询执行使用同次选定QueryKernel与DataAccess，真实策略进口在独立CLI交付前有实际供应/允许的明确宿主合同。需交付准确源码、公开API/ABI、Cargo包/构建/依赖/锁与启动使用合同、必要资产和配置；不以仅生成声明称应用完整。

querylib输出选public/QueryLibrary系统门面。门面的唯一queryKernel成员采用同一query-private/QueryKernel Definition，publicEndpoints.query公开该成员真实QueryPort，externalRequirements准确保留StrategyPort宿主需求。结果/错误/取消/效果/寿命沿真实业务API映射，不绑定CLI运行实例或临时预算。依赖闭包禁止UI/网络/存储实现。方法可复用同一纯代码实现，公开符号和运行对象身份仍分开；不能复制共享可变状态。

该根的**公开查询门面源码贡献**必须映射到public/QueryLibrary及其公开endpoint，进入public模块preserve的准确旧布局/公开API基准；私有查询行为贡献映射到该根queryKernel子发生及query-private定义，方可reorganize。真实Rust公开别名或有保持依据的委托声明可以承担门面，不要求额外执行步骤、空wrapper或复制算法；单纯把private callable直接暴露再声称public控制已生效不合法。公共签名/公开模块路径/声明形态的保持与私有布局分别核验。

两个根的实际生产声明/初始化/配置/资产贡献由一个目标组合器汇合；共名/路径/版本冲突不得后写覆盖。公共API、public/QueryLibrary门面及public模块其他真实公开贡献在准确Base布局上preserve；query-private模块reorganize须与前者真实生产成员不重叠。若公开与内部目标成员共用同一不可分anchor，或一个目标成员被双重归属，须报告冲突/缺对应，不靠复制公开成员、重复导出、后写覆盖或“更局部控制”绕过。

## profile:retrieval-admin / 1

目标语言TypeScript。admin输出选AdminUI并保原管理交互、状态/可访问性、ServicePort错误/取消与业务关系；交付完整UI源码及真实需要的宿主/构建/依赖/资产。不是把QueryPort印为TS声明。该界面不进入CLI ServiceProcess，服务进口按本工程准确服务协议/端点供应；身份/权限/通信实现必须有原业务合同，不能用同端口Ref猜物理连接。

## 同一工程的产物关系

3个输出声明都属于同一Project；共同要求不因此创建一个额外隐藏产品根，也不把三个ProductRoot occurrence合一。CLI/UI服务对应通过选定业务/环境合同及产物映射保持；querylib只共享行为/代码来源。实际发行若要求整组，必须三必需根及共同不变量均闭合；某根独立完成可以保留，但不能宣布整组完整。ArtifactSet/运行完成由原Target/发行/执行owner另签。
