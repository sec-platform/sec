# 确认交互目标修订2：参数化单根与双实例

本设计固定profile:confirmation-interactive-host修订2；[修订1](target-profile.md)是同工程捕获的语义输入。Project准确请求 `profile:confirmation-interactive-host` 修订 **2**，并捕获独立 target-profile-v2.md。修订 1 不增加 System 能力；原文件/旧快照不删、不改义。修订 2 完整继承修订 1 的单用户/单文档会话、旧预览可确认、因果/至多一次/顺序/真实文档后态、UI 可见性、资源时限与未实现边界，新增责任如下：

1. **单组件根**保留原 `ConfirmationSession` export 与 rootId:session，显式读取 Root.argumentBindings 的准确 responseDelay；Project contextBindings 从入口外层环境的 `activatedSession` 绑定真实 Session。该入口名是本修订 2 的正式上下文合同，不是通过名字推断现实对象。一次激活以原 owner 提供/创建真实 Session 并保留来源、源组件对应、文档和 clock；source model 本身不发行它。
2. **TwoSessions System 根**消费真实的两个 ComponentUse。其激活环境正式提供 `activatedMainSession` 与 `activatedPreviewSession`；System.contextRoles 经 Project 的显式映射接收，随后各组件再次明确转传。目标必须取得两个独立真实 Session/文档/clock 激活，而非把一个输入复制到两个名字。相同 issuer、同类型或配置值不证明不同身份；错接同一 Session 时不满足本独立组合合同。
3. System 自身不新增确认业务事件、状态或统一监听阶段。目标形成两个独立交互面/可辨会话入口，各自四个流与预览历史、确认、生效和文档后态按本源保持；调用一侧不改变另一侧。不把两侧四项 observer 合成一个可串域的全局 cut。
4. 每侧静态期限均从实际绑定取得。主侧 1 秒、预览侧 0.5 秒；不能因源组件和关系复用就选较宽共同期限，不能从一侧资源资格外推另一侧。其组合调度、共用宿主资源、真实可见性及最坏界另由实际 Method/Target 证明，较紧期限不由“单线程继续运行”自动获得。
5. 对新单根源 1 秒行为的保持须沿准确参数实例化、context/ref 解析与同一源身份对应核验。既有旧 source revision 仍可用修订 1；旧已运行 Session 不因本次保存或 patch 变成新时限。新修订不重放旧编辑/确认或改写旧期限锚点。
6. 构造性 Method、激活 owner 绑定、UI/组合 lowering、native adapter、工具锁、构建与真实运行均未取得。这个 profile 定义新的准确义务和输入来源，不声称入口已执行或已有两个 Session。源形成/结构测试只证明其绑定设计，不签发生产运行保证。

入口外层 context 的确切类型均为本次准确 ModuleUse 解析的 `module:confirmation-session/Session` SubjectSchema；issuer/现实来源由原激活 owner 的 retained capability/合格模型承担，不是作者填写一个新的 issuerRef。未提供真实入口 owner 时保留 NeedsSessionBinding，不能把 activated* 字符串当对象。
