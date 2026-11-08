# Gift 研究原件与现行规范的边界

这里保存按字节核验的**只读研究原件**，不是可编辑的第二份 Gift 作者源、业务规则库、运行时表或合格 Method。
研究数据的解释归属于 [全体系信息结构](../全体系信息结构.md)、[抽象与开放定义](../../作者/组合/抽象与开放定义.md)、[领域接合](../../作者/组合/语义扩展与领域接合.md)及各专业 Owner。

## 原件索引

| 原件 | SHA-256（原字节） | 大小（字节） | 实际存储 |
|---|---|---:|---|
| [1786项完整内容与多维承接-dcefd94c9919.txt](1786%E9%A1%B9%E5%AE%8C%E6%95%B4%E5%86%85%E5%AE%B9%E4%B8%8E%E5%A4%9A%E7%BB%B4%E6%89%BF%E6%8E%A5-dcefd94c9919.txt) | `dcefd94c991963bc6b66ac2231bcba080d62560bf5477606f43480bd5279f58c` | 1,273,830 | 1273830 字节 |
| [568项具体合同-b1757d4d18a2.txt](568%E9%A1%B9%E5%85%B7%E4%BD%93%E5%90%88%E5%90%8C-b1757d4d18a2.txt) | `b1757d4d18a2f347446f7f5c53b102a3fbef10960b8418e6511c5c5e7dd97d56` | 570,258 | 570258 字节 |
| [568项模型责任追溯-735fed9f13fd.json](568%E9%A1%B9%E6%A8%A1%E5%9E%8B%E8%B4%A3%E4%BB%BB%E8%BF%BD%E6%BA%AF-735fed9f13fd.json) | `735fed9f13fdd7f865103567bb9555d81676ba8e69792fde234471074cc0fdfd` | 907,711 | 907711 字节 |
| [contracts-103e4996011c.psv](contracts-103e4996011c.psv) | `103e4996011cfb44e73e9c3dcda06ddf0eff66f428b65d3a556e99b84e8831a3` | 182,212 | 182212 字节 |
| [profiles-31df7289e53e.psv](profiles-31df7289e53e.psv) | `31df7289e53ef4d129158c53f1d34205280518a06a46345a90d1b203b942e207` | 15,802 | 15802 字节 |
| [research_model.original-c64d0bc4452a.json.gz](research_model.original-c64d0bc4452a.json.gz) | `c64d0bc4452a24e36f83fbfd27d22fe64dec4259666be7cbdac7b44a806b157e` | 36,217,206 | 2721713 字节，gzip 无损压缩 |
| [sources_registry-d123ad29279c.json](sources_registry-d123ad29279c.json) | `d123ad29279c575b28b5afeb7fb7cd0e9b9eef4fb2c834eaf318f70349a6c3e8` | 960,303 | 960303 字节 |
| [值结构定义-f7fc0b193433.txt](%E5%80%BC%E7%BB%93%E6%9E%84%E5%AE%9A%E4%B9%89-f7fc0b193433.txt) | `f7fc0b1934339e0d999283c9dc7a4c69f08d207a432e3686f89c94e7c8783a57` | 45,390 | 45390 字节 |
| [全部问题具名接合-f9936eb70e59.txt](%E5%85%A8%E9%83%A8%E9%97%AE%E9%A2%98%E5%85%B7%E5%90%8D%E6%8E%A5%E5%90%88-f9936eb70e59.txt) | `f9936eb70e591eed3dedc20381b2a1d4988d49fed329131f1198f1419950d1fb` | 1,038,189 | 1038189 字节 |
| [既有构造与接合完整保留-7d9953d69b6a.txt](%E6%97%A2%E6%9C%89%E6%9E%84%E9%80%A0%E4%B8%8E%E6%8E%A5%E5%90%88%E5%AE%8C%E6%95%B4%E4%BF%9D%E7%95%99-7d9953d69b6a.txt) | `7d9953d69b6a21431dc8f41c43e1a9b375a1835ddf44099c4cee447703c968ef` | 439,756 | 439756 字节 |
| [有限IR参考追溯-7d07206b41a1.json](%E6%9C%89%E9%99%90IR%E5%8F%82%E8%80%83%E8%BF%BD%E6%BA%AF-7d07206b41a1.json) | `7d07206b41a1deb68b7e9edbae208bf9b02558628e11096117afcc38999e57c9` | 3,199 | 3199 字节 |

### 原研究模型的精确复原

`docs/信息/研究数据/research_model.original-c64d0bc4452a.json.gz` 是 gzip 包装的**原始 36,217,206 字节 JSON**，仓库不另复制一份 36 MB 解压文件。
原字节 SHA-256：`c64d0bc4452a24e36f83fbfd27d22fe64dec4259666be7cbdac7b44a806b157e`；压缩包 SHA-256：`34286de87ec832a448ae66219409438cb307d550c5b5856f93c51c99b0819e40`。

```bash
python - <<'PY'
import gzip, hashlib, pathlib
p = pathlib.Path("docs/信息/研究数据/research_model.original-c64d0bc4452a.json.gz")
original = gzip.decompress(p.read_bytes())
assert len(original) == 36217206
assert hashlib.sha256(original).hexdigest() == "c64d0bc4452a24e36f83fbfd27d22fe64dec4259666be7cbdac7b44a806b157e"
print("verified original source bytes:", len(original))
PY
```

研究查询可按需解压到临时工作区或流式读取；不得把压缩二进制当 JSON 直接交给普通 Reader。
原件存储事实不自动证明每项 U/D 已被解释、采用、实现或现实验证。

## 维护与避免重复

- 正文含义、能力边界与专业规律在各原有规范 Owner 中维护；此处不维护第二套解释。
- 研究条目、历史来源、实际证据和旧版本留在不可变原件；文件名中的内容摘要不代表语义一致或前后版本已逐项合并。
- 历史研究、审查及已退役文本由 [研究原件索引](../../../alternatives/本地草稿封存/研究原件/INDEX.md) 保全；不在导航首页展开全量来源表。
- 新增原件须同时校验解码后真实 SHA、大小、索引和所有引用，不得把源保全等同正式生产采纳。
