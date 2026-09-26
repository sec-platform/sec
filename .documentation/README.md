# 当前文档输入与可重建元数据

本目录服务当前设计库，不是目标工程必须复制的一套平台。准确责任、格式、算法、失败边界和迁移由[身份域合同](../docs/维护/文档身份与重组协议.md#documentation-identity-domains)唯一拥有；[写入准入](../docs/维护/规格写作与完整性.md#documentation-write-admission)决定哪些变化需要进入规范。

`baseline.json`是纯输入边界声明，使用`sec.documentation-baseline/2`，自身进入源身份，不再保存生成摘要。`documents.json`保存已接受的稳定文档ID与当前位置；`known-regressions.json`保存人工选择的有限检查条件；它们不是可随意丢弃的缓存。`.documentation/README.md`是普通说明输入。未知元数据先分类，不自动取得权威。

`source-manifest.json`是`sec.documentation-source-manifest/2`的源快照；`requirements.json`由已取得REQ正文机械派生；`figures.json`是可选图缓存。三个文件均不进入源摘要，也不作为Git中的当前权威输入长期跟踪：干净checkout允许三者全部缺席。声明根内的其他源完整枚举，不靠隐藏、后缀或缓存目录名省略。边界改变也必须改变源身份；摘要只核字节，不是签名、批准、全部语义正确或模型已阅读证明。

`bun run docs:refresh`调用唯一Python枚举/生成入口，在工作树中按需重建要求定位与源清单，**不写任何权威输入，也不要求把生成结果提交回Git**。正式release从baseline和实际权威源重新捕获同一身份，在stage内生成自己的`source-manifest.json`与`requirements.json`；它不依赖工作树恰好残留一份旧投影。非阻塞原生锁协调同根合作写者；竞争拒绝，不轮询、不偷锁。中断产生的陈旧投影可检测并按同一来源重建。原子替换单文件不等于多个文件的原子事务，源变动时不能声称已经得到同一切面。自己临时文件在声明源外，未知临时材料不能顺手清理。

`python -B tools/documentation/check_docs.py`只读核对实际源、稳定身份、要求、材料和章节，并检查存在的投影是否对应。可重建投影缺席不抹掉源；声称封存阅读/发行则必须先生成准确源快照。核验不联网、不读取历史、不运行SEC，只依赖Python 3.10以上标准库。没有全语义/敌对并发文件系统的保证，不把有限回归词句表当语义审查。

`figures.json`可以保留以便已有缓存的离线阅读；其删除、重渲染或损坏不改变源身份。被阅读或发行选择后，实际字节由制品输入与外层manifest绑定；图源匹配、解压预算、SVG安全、引擎来源与未渲染状态由[阅读构建](../docs/维护/阅读构建.md)负责。不需要显示缓存的路径不加载它，缓存自填hash不签发规范或执行权限。

本文档库不保存旧址查询表、父稿谱系或逐版制作日记。必要研究、论文/标准版本、产品恢复前像与独立来源继续按各自合同保存。源根覆盖当前设计、示例和制作工具；`config/repository/`及`config/external-capabilities/ledger.yaml`由相应机器消费者拥有，不因此成为文档规范。

`docs:doctor`仍组合标准库检查器合同、设计制品检查与独立能力台账检查；缓存变化不作为源核验输入触发全源门禁。`tools/documentation/tests/`中的阅读工具测试需要已锁定的Markdown解析库，属于相交阅读工作而非普通文档任务的安装前置。声明、实现、局部检查、运行/宿主验收及远端发布分别报告。
