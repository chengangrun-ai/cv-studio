#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把真实简历并进语料。

用法：
  mkdir -p corpus/real
  把简历丢进去（.pdf / .docx）
  写 labels.csv（id,name,company,title,dates,skills；多值用 | 分隔；不知道的留空）
  python build_real.py && python extract.py && python score.py

没标注的文件也会被跑，只是那几个字段算作缺失（这本身也是一个信息：
你连自己简历里的公司名都写不全，机器更读不出来）。
"""
import csv, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REAL = ROOT / "corpus" / "real"
GT = ROOT / "ground_truth.json"
GT_REAL = ROOT / "ground_truth_real.json"

ARCH_CN = "真实简历"


def main():
    REAL.mkdir(parents=True, exist_ok=True)
    labels = {}
    lab_path = ROOT / "labels.csv"
    if lab_path.exists():
        with open(lab_path, encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                if row.get("id"):
                    labels[row["id"].strip()] = row

    docs = []
    for p in sorted(REAL.iterdir()):
        if p.suffix.lower() not in (".pdf", ".docx"):
            continue
        lab = labels.get(p.stem, {})
        docs.append(dict(
            id=p.stem, archetype="real", archetype_cn=ARCH_CN,
            lang="zh" if any('\u4e00' <= c <= '\u9fa5' for c in (lab.get("name") or "张")) else "en",
            file=str(p.relative_to(ROOT)).replace("\\", "/"),
            name=(lab.get("name") or "").strip(),
            company=(lab.get("company") or "").strip(),
            title=(lab.get("title") or "").strip(),
            dates=[d.strip() for d in (lab.get("dates") or "").split("|") if d.strip()],
            skills=[s.strip() for s in (lab.get("skills") or "").split("|") if s.strip()],
        ))

    GT_REAL.write_text(json.dumps(docs, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"真实简历 {len(docs)} 份，其中有标注 {sum(1 for d in docs if d['name'])} 份")


if __name__ == "__main__":
    main()
