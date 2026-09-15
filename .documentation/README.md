# 当前文档核对元数据

这些文件只服务这份当前设计库，不是目标工程的新作者文件：`baseline.json`和`source-manifest.json`核对准确当前成员；`documents.json`保存当前文档ID与位置；`requirements.json`定位51项已取得要求；`known-regressions.json`列有限的已知不合格表达，不能证明所有语义正确或强迫未来模型读取。

当前包不保存文档旧址表、历史拆分谱系、父版本链或逐版制作记录。正确旧内容应已融合进现行规范，普通阅读与实现不依赖旧包、会话或复核附件。论文、标准、外部证据及产品对象的必要版本仍按各自职责保留。

源摘要取排序后的`(path,bytes,sha256)`成员数组的UTF-8紧凑JSON；仅`baseline.json`和`source-manifest.json`排除自身，以避免循环。摘要只核对字节，不是签名、批准或内容完整证明。修改完成后运行`bun run docs:refresh`，由唯一枚举器原子替换当前清单和baseline摘要；中途失败会留下可检测的不匹配，重跑同一命令即可收敛，不维护历史基线链。

在产品仓库中，`baseline.json`的`source_roots`明确文档制品的源边界；它不是产品、权限或运行状态注册表。`tools/source_inventory.py`是检查、设计审查和阅读构建共同使用的唯一枚举入口：完整遍历声明根，拒绝缺失、重叠、越界和链接路径，不跳过根内缓存或新文件；根内未登记文件由清单检查拒绝。根外的产品源码、Git对象、依赖和任务临时材料不进入文档制品。修改源边界与正文一样需要实际审查，不能靠缩小根来隐藏缺件。

文档源根覆盖当前设计、示例与制作工具；`audited_namespaces`完整审查`docs/`，不允许靠例外目录藏入旧 authority、运行状态或未登记文档。仓库控制输入统一位于`config/repository/`，外部能力账本位于`config/external-capabilities/ledger.yaml`；它们由各自机器消费者负责，不属于设计库，也不能与现行正文竞争 authority。

从SEC目录执行`python tools/check_docs.py`只读检查当前成员、身份、要求、材料和章节，不联网、不查询历史、不执行SEC。工具仅用Python 3.10或更高版本标准库，并假定检查期间文件没有并发改写；链接目标和语义承接还需制作时单独核对。协议与范围见[文档重组](../docs/维护/文档身份与重组协议.md)。

`figures.json`仅是当前图源对应的可重建渲染缓存。它使日常生成完整静态HTML不需安装浏览器工具；图变更后旧缓存拒绝，使用已有浏览器和可信本地引擎刷新。缓存不承担产品语义、历史原件或批准责任，可按阅读构建合同重建与退出。

仓库入口`bun run docs:doctor`先运行只依赖标准库的`tools/test_check_*.py`检查器合同测试，再检查实际设计制品和能力账本；Windows调用`python`，Linux调用受信环境提供的`python3`。可选HTML制作的`test_build_html.py`和`test_reading_modes.py`依赖锁定的Markdown解析库，修改阅读工具时单独运行，不把该可选依赖变成日常文档门禁的安装前置。
