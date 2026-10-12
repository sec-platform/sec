# Gift 工程设计

本包交付当前目标设计及其依据，按唯一专业 Owner 维护完整规则、接口、算法、失败恢复和未决；它不是可执行产品仓库。

## 阅读入口

- [总体架构](ARCHITECTURE.md)与[专业正文](docs/README.md)
- [产品要求](docs/00-系统与原则/产品/产品要求与工作约束.md)与[设计任务规则](docs/90-治理与参考/维护/设计任务规则.md)
- [工程清单、模块与锁](docs/10-作者与输入/作者源/工程源/工程清单模块与绑定锁协议.md)及[完整作者定义](docs/20-语义与组合/作者语义/开发者通用定义Profile-类型计算业务与系统构造.md)
- [实现供给](docs/30-实现解析/实现选择/实现解析与候选资格.md)、[目标生成](docs/40-目标与制品/目标/具体降低与目标输出.md)、[当前未实施与资格缺口](docs/90-治理与参考/状态/实施闭包.md)
- [独立研究、来源与组合案例](research/README.md)

## 实际目录与资格

- `docs/`：当前专业规范、采用理由、状态和维护规则。
- `schema/`：必要机器结构及设计候选；形状合法不等于生产 Reader 已实现。
- `examples/current/`：当前声明式 JSON 设计示例；`examples/legacy-declarative/`：明确版本的旧声明式材料。
- `research/`：来源、理论、比较、领域研究及兼容结构资料；不取得当前规范写权。
- `fixtures/`：组合研究和历史有限案例的 Markdown 说明；不附旧参考程序或运行环境。文中的历史文件名用于解释原案例。
- `witnesses/`：反例、挑战及其条件；文字见证不等于已运行测试。
- `knowledge.toml`：文档检索的 canonical/research 范围声明；不实现索引器。
- `LICENSE`、`LICENSES/`、`NOTICE`、`REUSE.toml`：许可与再分发责任。

本包不含 `tools/`、`PACKAGE_MANIFEST.json` 或 `_meta/`。直接阅读 Markdown 即可；交付差异、字节统计和制作核对放在包外。历史版本原包另行保留，不要求读者借它们拼齐当前规范。

当前 `gift.author-module/2` 纳入按需计算能力；普通业务与非计算工程仍优先，本阶段暂停新增计算研究与产品实现。没有因本次文档修订取得编译器、Method、Target、Provider、自举或部署资格。
