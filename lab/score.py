#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 raw.json 汇总成可引用的两张表。"""
import csv, json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "results"

NAME = {"single": "单栏纯文本（基线）", "twocol": "双栏侧边栏", "table": "表格布局",
        "icons": "图标字体联系方式", "photo": "照片与色块", "pagehead": "姓名放页眉",
        "multi": "两页长简历", "abs": "绝对定位（设计工具）", "image": "图片型（无文字层）",
        "docx": "Word 文档", "cngov": "中文国企表格", "serif": "衬线紧凑（LaTeX 风）"}
ORDER = ["single", "serif", "docx", "photo", "multi", "cngov", "table", "icons",
         "pagehead", "abs", "twocol", "image"]
FIELDS = [("name", "姓名"), ("company", "最近公司"), ("title", "职位"),
          ("dates", "起止时间"), ("skills", "技能")]

rows = json.loads((OUT / "raw.json").read_text(encoding="utf-8"))

by = defaultdict(list)
for r in rows:
    by[r["archetype"]].append(r)

docs = defaultdict(set)
for r in rows:
    docs[r["archetype"]].add(r["id"])


def pct(v, n):
    return f"{v / n * 100:.0f}%"


lines = []
lines.append("### 表 1 · 按版式（n = 文档数）\n")
lines.append("| 版式 | n | 还原率 | 定位（笨读取器） | 定位（聪明读取器） | 顺序正确 |")
lines.append("|---|--:|--:|--:|--:|--:|")
for k in ORDER:
    v = by[k]
    n = len(v)
    lines.append(
        f"| {NAME[k]} | {len(docs[k])} | {pct(sum(r['presence'] for r in v), n)} | "
        f"{pct(sum(r['assign'] for r in v), n)} | {pct(sum(r['assign_t'] for r in v), n)} | "
        f"{pct(sum(r['order'] for r in v), n)} |")

lines.append("\n### 表 2 · 按字段（只看失败集中的版式，乖/聪 = 两种读取器）\n")
lines.append("| 版式 | " + " | ".join(cn for _, cn in FIELDS) + " |")
lines.append("|---|" + "--:|" * len(FIELDS))
for k in ["table", "icons", "cngov", "pagehead", "abs"]:
    v = by[k]
    n = len(v)
    cells = []
    for f, _ in FIELDS:
        a = sum(r[f + "_a"] for r in v) / n * 100
        t = sum(r[f + "_t"] for r in v) / n * 100
        cells.append(f"{a:.0f} / {t:.0f}")
    lines.append(f"| {NAME[k]} | " + " | ".join(cells) + " |")

lines.append("\n### 表 3 · 按解析器\n")
bp = defaultdict(list)
for r in rows:
    bp[r["parser"]].append(r)
lines.append("| 解析器 | 记录数 | 还原率 | 定位率 | 顺序正确 |")
lines.append("|---|--:|--:|--:|--:|")
for p, v in bp.items():
    n = len(v)
    lines.append(f"| {p} | {n} | {pct(sum(r['presence'] for r in v), n)} | "
                 f"{pct(sum(r['assign'] for r in v), n)} | {pct(sum(r['order'] for r in v), n)} |")

(OUT / "table.md").write_text("\n".join(lines), encoding="utf-8")

with open(OUT / "raw.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)

print("\n".join(lines))
