# cv(studio) · 简历工坊

一份数据，四套版式，六道体检。网页端和 MCP 服务器共用同一份 JSON。

![预览](docs/preview.png)

## 为什么是这么个东西

先把五个开源简历工具拆开看了一遍 —— [LapisCV](https://github.com/BingyanStudio/LapisCV)、[RenderCV](https://github.com/rendercv/rendercv)、[Reactive Resume](https://github.com/reactive-resume/reactive-resume)、[Resume-Matcher](https://github.com/srbhr/Resume-Matcher)、[tw93/Kami](https://github.com/tw93/Kami)。它们各管一段：模板、排版、产品、JD 匹配、交付形态。中间空着一件事：**导出的那份 PDF，机器到底读不读得懂。**

所以先造了一把尺子 —— 51 份语料、3 个解析器、98 条测量 —— 量出六种死法，再按这六条做工具。

| 版式 | 还原率 | 字段定位 | 顺序正确 |
|---|--:|--:|--:|
| 单栏纯文本 | 100% | 100% | 100% |
| 双栏侧边栏 | 100% | 100% | **0%** |
| 姓名放页眉 | 100% | 62% | 50% |
| 图片型（无文字层） | **0%** | 0% | 0% |

完整表格、复现脚本和事故现场在 [`lab/`](lab/)。

## 三个文件

```
index.html        网页端，双击就开，零依赖
mcp-server.mjs    给 Agent 用的 MCP 服务器，零依赖
data/profile.json 数据（网页「导出 JSON」就是这个格式）
```

## 快速开始

**网页端**：双击 `index.html`。第一次让你选「看示例」还是「从零开始」。

- 左边填资料，中间实时变，右边体检
- 顶部四个胶囊换版式：衬线学术 / 工程等宽 / 极简无衬线 / 中文国企
- 顶栏「问 Agent」是引导式问答，「Agent 接口」里是 MCP 配置
- 数据存在浏览器 localStorage；换设备用「导出 JSON」

**导出 PDF**：浏览器打印 → 另存为 PDF，A4，页边距选「无」。

**自测**：

```bash
node test-mcp.mjs     # 14 项，含真实 PDF 落盘
```

## 让 Agent 调

服务器零依赖，有 node 就行。Claude Desktop 或 Cursor：

```json
{
  "mcpServers": {
    "cv-studio": {
      "command": "node",
      "args": ["<你的路径>/cv-studio/mcp-server.mjs"]
    }
  }
}
```

| 工具 | 干什么 |
|---|---|
| `profile_get` | 读全部资料 |
| `profile_set` | 写，深合并，只传要改的 |
| `resume_check` | 六项体检 + 关键词覆盖 |
| `resume_export` | 出 pdf / html / md / json，写到 `out/` |
| `track_add` | 记一次投递，带上当时的体检结果 |
| `track_stats` | 回复率统计，样本 < 8 会明确警告 |

连上之后只需要说「按这份 JD 改简历」，Agent 会自己 `profile_get` → `profile_set` → `resume_check` → `resume_export`。

数据目录和输出目录都能改：`CV_STUDIO_DATA`、`CV_STUDIO_OUT`（自测就是这么隔离的）。

## 六项体检

不是拍脑袋定的，是 `lab/` 量出来的六种死法。

**版式三项**（这个渲染器天生满足）

1. **单栏** —— 双栏的文本流是逐行跳栏交错的，还原率 100% 但顺序 0%
2. **姓名在首块** —— 放页眉会被画到文档最后一行（14 行的文档，名字在第 13 行）
3. **有文字层** —— 图片型 PDF 抽取结果是 0 字符

**内容三项**（你自己决定）

4. 姓名已填
5. 每段经历有起止
6. 技能分组非空

> 这六项是**结构检查**，不是解析器实测。要真实的字段还原率，跑 `lab/extract.py`。

## 四套版式

![四套版式](docs/skins.png)

同一份数据，四种排版。中文国企那套带照片位、出生年月、政治面貌、籍贯。

## 边界

- **没有后端**。数据在本机，换设备要手动搬 JSON。
- **导出用浏览器打印**，不是 Typst。够用，但没有字体子集嵌入和分页控制 —— 实测显示单栏 + 打印这条链路是 100% 可读的，所以先没换。
- **关键词词典**硬编码 70 来个词，覆盖产品 / 技术 / 财务 / 销售 / HR，冷门行业会漏。
- **没有版本历史**。改了就改了。
- **Agent 改完的文件，网页不会自动读** —— 这一环还没接上。

## lab 里怎么复现

```bash
cd lab
python gen_corpus.py     # 生成 51 份对抗性语料（需要 Chrome）
python extract.py        # 三个解析器跑一遍，出 raw.json
python score.py          # 出表
```

语料内容是合成的（虚构人名公司），**版式和 PDF 生成链路是真的**。真简历放进 `lab/corpus/real/` + 一份 `labels.csv`，跑同样的命令就并入同一张表。

## License

[MIT](LICENSE)
