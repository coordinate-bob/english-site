# 词表数据说明

本目录的 CET-4 / CET-6 词表由开源词库 **ECDICT** 转换而来。

## 数据来源

- 仓库：[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)
- 原始文件：[`ecdict.csv`](https://github.com/skywind3000/ECDICT/blob/master/ecdict.csv)（raw 地址 <https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv>，约 66 MB）
- 许可证：**MIT License**（见仓库 [LICENSE](https://github.com/skywind3000/ECDICT/blob/master/LICENSE)），可自由使用与再分发，需保留版权声明
- 下载/转换日期：2026-10-09

## 词条筛选

ECDICT 每行一个词，含 `word / phonetic / translation / pos / tag` 等列，其中 `tag` 列用空格分隔多个标签（`cet4`、`cet6`、`gre`、`ielts` 等）。

- `cet4.json`：tag 含 `cet4` 的全部词条，共 **3846** 条（四级大纲约 4500 词，源词库收录 3846）
- `cet6.json`：tag 含 `cet6` 但**不含** `cet4` 的词条，即四级以上的六级新增词，共 **1956** 条（tag 含 `cet6` 的共 5407 条，其中 3451 条与四级重复，已剔除）

## 词条格式

```json
{ "word": "abandon", "phonetic": "ə'bændən", "pos": "v.", "meaning": "放弃；抛弃" }
```

- `word`：小写原词，按字母序排列、已去重
- `phonetic`：音标（DJ 音标风格）；源数据缺音标的留空字符串（cet4 缺 10 条、cet6 缺 19 条，多为派生副词/合成词，未编造补齐）
- `pos`：词性缩写，多词性用 `;` 分隔（`a.` 已归一为 `adj.`，`ad.` 已归一为 `adv.`）；无词性标注的留空字符串
- `meaning`：中文释义，多义项用 `;` 分隔，义项内的并列用 `，`；英文逗号/分号相邻中文时已统一为全角

## 转换方式

转换脚本：`.sources/convert.py`（同目录保留了脚本，未保留 66 MB 的源 csv，重跑时按上方原始 URL 重新下载即可）。核心逻辑：

1. `csv.DictReader` 读取源文件，按 `tag` 列筛出 cet4 / cet6 词条
2. 解析 `translation` 字段（部分行是字面 `\n` 而非真实换行，先统一替换再按行拆分）：
   - 行首词性缩写（如 `a. `、`vt. `）提取到 `pos`，其余为释义
   - `[计]`/`[法]`/`[医]` 等领域标签保留为 `【计】…` 形式；`[网络]` 释义噪声大，丢弃；与基础释义重复的领域释义丢弃
3. 音标清洗：源数据混入西里尔字母（`ә`→`ə`、`є`→`e`）和 OCR 垃圾（`^`→`r`、`\\:`→`ɜ:`、删除残留反斜杠与 `(?@)`）
4. 过滤非单词行（仅保留 `[a-z][a-z\-']*`），按 `word` 去重、按字母序排序，UTF-8 写出 JSON 数组（`indent=1`）

## 备注

- 候选来源 kajweb/dict 的四六级文件为 zip 打包的二进制词库（非纯文本），故未采用。
- ECDICT 的 `tag` 标签来自其上游词表整理，个别词条的级别归属可能与最新考纲有出入，整体覆盖率符合大纲量级。

## listening.json（每日听力材料）

人工精选的公开听力资源清单，共 **33** 条，字段为 `{ "title", "url", "source", "level", "minutes" }`，`level` 为 初级/中级/高级，`minutes` 为标注的大概时长。

来源站点（均为官方公开页面，链接于 2026-10-09 用 `curl` 逐一验证返回 HTTP 200）：

- **VOA Learning English**（learningenglish.voanews.com）：Let's Learn English 教学节目、VOA60 一分钟慢速新闻、Health & Lifestyle 视频节目、常速新闻
- **BBC Learning English**（bbc.co.uk/learningenglish）：6 Minute English 具体单集（2025 季）、The English We Speak 具体单集
- **TED Talks**（ted.com）：具体演讲单集
- **Luke's English Podcast**（teacherluke.co.uk）：具体单集（第 1000–1005 期及福尔摩斯读书节目）
- **StoryCorps**（storycorps.org）：具体访谈故事页
- **Scientific American 60-Second Science**（scientificamerican.com）：具体单集
- **ESL Fast**（eslfast.com）：分级对话练习栏目页

收录的均为具体节目/单集页面 URL（非站点首页）；个别栏目页型的入口（如 ESL Fast 的对话集）为该栏目的固定内容页。外链后续可能失效或改版，发现 404 时在对应站点内换同栏目新单集即可。

## resources.json（资源导航）

分类资源导航，共 **6** 类（历年真题 / 听力 / 阅读 / 语法 / 写作与翻译 / 备考经验）27 条，字段为 `{ "category", "items": [{ "name", "desc", "url" }] }`。均为真实、知名、公开的正规资源，链接于 2026-10-09 用 `curl` 抽查验证可访问（HTTP 200；个别站点有反爬拦截，浏览器中正常）：

- **历年真题**：中国教育考试网（cet.neea.edu.cn，四六级官网及大纲页）、可可英语四/六级真题频道、考试点四六级频道
- **听力**：BBC Learning English、VOA Learning English、可可英语听力频道、在线英语听力室（tingroom.com）、Randall's ESL Cyber Listening Lab（esl-lab.com）
- **阅读**：China Daily、纽约时报中文网、The Guardian、BBC News、Sixth Tone
- **语法**：Cambridge Grammar、Oxford Learner's Grammar、English Grammar（englishgrammar.org）、China Daily Language Tips
- **写作与翻译**：批改网、DeepL、有道翻译、Cambridge Dictionary
- **备考经验**：知乎四六级话题、哔哩哔哩四六级搜索、中国教育在线四六级频道、考试点真题课

## writing.json（写作素材）

供「写作」栏目使用，全部为**人工原创**内容（非摘自出版物或网络范文），共两部分：

- **sentences（功能句型）**：按写作环节分 10 类（开头引入 / 引出观点 / 列举论点 / 举例论证 / 因果推理 / 让步转折 / 强调重要 / 建议措施 / 结尾总结 / 展望未来），共 **32** 条。字段 `{ "id", "category", "en", "zh", "note" }`；`note` 为用法提示（适用题型、语法注意点），`en` 中的 `...` 为考场替换位
- **essays（优秀范文）**：共 **30** 篇原创范文，按 **3 种体裁**组织——观点类、现象解释类、名言评论类，**每种体裁 10 篇（四级 5 篇 + 六级 5 篇）**；四级正文 130–180 词，六级正文 150–200 词。字段 `{ "id", "level", "type", "title", "prompt", "gist", "body", "structure", "highlights" }`；`level` 为 `四级`/`六级`；`body` 段落间用空行分隔；`structure` 为逐段功能说明；`highlights` 为可迁移的亮点句及理由（`en` 必须是 `body` 中的原句）

站点对句型的「已背」标记存于浏览器 localStorage（`eng-writing-memorized`），与本文件无关。

## translation.json（翻译练习）

供「翻译」栏目使用，全部为**人工原创**内容（非摘自真题或出版物），共两部分：

- **tips（得分要点）**：**5** 条，对应栏目顶部卡片（短句化、专有名词、不逐字直译、降级表达、检查清单）
- **passages（练习段落）**：**50** 篇，覆盖四六级翻译五大题材——传统文化、历史景点、社会习俗、中国发展、地理特产，**每个题材 10 篇（四级 5 篇 + 六级 5 篇）**。新增 40 篇为 2026-10-25 批量扩写（zh 120–160 字、en 150–190 词），首批 10 篇长度略宽（zh ≤180 字、en ≥95 词）。字段 `{ "id", "topic", "level", "title", "image", "zh", "en", "terms", "tips" }`；`level` 为 `四级`/`六级`；`zh` 为待译中文段落，`en` 为参考译文，`terms` 为本篇专有名词/重点词（`{ "zh", "en", "note" }`），`tips` 为针对本篇的翻译手法提示

配图在 `../images/photos/` 目录，为 **50 张真实照片**（每篇一张，按主题匹配，2026-10-26 从 Pexels 下载，Pexels License 允许免费使用与修改、无需署名），文件名与 passage 的 `id` 一一对应（`<id>.jpg`）。少数无直接对应照片的主题使用了最接近的回退照片（如：皮影戏→戏曲表演、清明→踏青、白酒→baijiu 静物）。`../images/` 下的 10 张原创 SVG 插画保留，不再被引用，作为离线兜底可删可留。

站点对段落的「已掌握」标记存于浏览器 localStorage（`eng-translation-done`），与本文件无关。

> 备注：原计划改用 Wikimedia Commons 等图库照片，但本机网络无法访问这些站点，故改用原创 SVG；日后如需换真实照片，替换 `images/` 下对应文件并在本文件中更新 `image` 路径即可。

