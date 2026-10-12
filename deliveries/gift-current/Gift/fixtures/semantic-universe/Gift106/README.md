# Gift106：开放自由意图语言的作者源草案与反例（历史研究说明）

**状态：设计样本，非发布的 dialect、非生产 AuthorProfile、非可直接执行的用户程序。** 原实验目录不更改 Gift105 有限运行实现，也不新建 Core 公共字段。实际规范仍由 `docs/20-语义与组合/作者语义/需求含义与实现责任.md`、`docs/20-语义与组合/组合/跨软件需求合同.md` 与 `docs/10-作者与输入/作者源/结构化源码.md` 分别拥有。原实验目录 `open:contract` 提供研究阶段的**严格结构形态**，用于独立验证什么信息能够表达、什么并不能由结构许可得出。

## 编码身份和源归属

样本逻辑模块使用既有外壳 `gift.author-module/1`，但 **`dialects.open.languageId="gift.proposal.open-intent"` 没有生产解释器**。把 Schema 中的 `open:contract` 复制进现有 Gift104/105 Reader，正确行为是拒绝未知语义，而非随便猜出业务代码。正式采纳时需要自己的 SemanticModule 解释、版本/摘要锁、Type/Ref/效果/义务、对真实 Method 的消费和目标资格，不允许靠纯结构图推出已支持。

每个行为定义的 `signature` 是调用边界，`claims` 的 `meaningRef` 是需要具备**确定语义定义**的谓词或外部合同，`bindings` 是局部参数/结果映射，`semanticDependencies` 只是提出需要什么定义的引用集合。**这里所有 `urn:gift:proposal:*` 都是刻意未解析的语义占位引用**，所以样本 `SHAPE_VALID_ONLY` 不能成为「该功能已可被编译」的证明。这不是让开发者将每个新业务都注册给 Core：一项合格的已发布语义库会让日常工程只引用其 Definition。

`worldEffects` 是目标程序将来可能触发的效果边界，不会让构建器获得当前宿主权限；真实 Effect 需要具体 Method、Grant/Provider、幂等与读回。`realization.mode` 区分委派、有作者实现、有绑定 Method 和尚未取得，缺项不自动替换空实现。

## 各样本的独立价值与尚未实现的部分

- `interval-normalization`：同覆盖、端点相接、最少分段与排序，不因合法实现唯一而指定排序扫描。
- `graph-path`：任意用户图、环、有路必须给路径、无路返回 None；不能将无路与搜索超预算混同。
- `latest-revision-editor`：最新修订安全与有假设的进展，解决「从不输出」的伪解。
- `stream-window`：事件时间/水位/迟到策略，不等同处理时间或固定列表操作。
- `double-entry-ledger`：每币种守恒、单库事务或跨服务未知状态，真正清算仍需授权。
- `numerical-integration`：单位、误差模型、终止/失败；计算算法可选择，不能凭容差数值证明数值精度。
- `custom-token-rule`：以前不存在的邻接规则与循环约束，是要求自由定义真正新功能的反例。
- `new-network-effect`：可声明未知原始世界效果，禁止把源码声明当成当前 Grant。
- `generic-composition`：高阶多态和纯度、稳定顺序、终止前提，不需要业务专用 Core 分派。
- `ui-accessibility`：输入/焦点、表现/无障碍、真实 UI 交互，后端函数不能代签。

此外 `examples/user-defined-interleave.gift` 是按当前**设计文法**撰写的递归定义示意，展示当没有合格算法供给时作者可以直接写一般计算主体，再由以后工程引用其公开定义；**尚未对生产 `.gift` 解析器进行构建或运行验收**。它不是所有业务都必须编辑的默认入口。

## 验证范围

它以 JSON Schema 2020-12 验证十份正例和六份负例，并额外检查 public exports、局部参数、语义依赖引用和提供 Method/代码引用的必要性；明确不执行 Gift 编译器、算法合成、Target 构建、现实 Provider、数值证明或性能基准。即使验证 PASS，所有 URN 都未解析，因而样本应标记为设计/结构可保存而非产品已实现。

六个反例分别检验：空 meaningRef、虚构自动合成模式、偷渡 host-side Effect、局部变量不存在、引用未声明谓词、公开导出指向未知 Definition。它们并不能穷尽安全攻击和所有逻辑问题；正式语言的 validator 还必须覆盖循环引用、Types、值codec、来源身份、版本/摘要、嵌套作用域、效果/接口不一致、冲突、预算与撤销。
