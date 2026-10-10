#!/usr/bin/env python3
"""Convert ECDICT ecdict.csv into cet4.json / cet6.json for the English site."""
import csv
import json
import random
import re
import sys

SRC = "ecdict.csv"
OUT_DIR = ".."

# ECDICT 音标里混入了西里尔字母和 OCR 垃圾字符，统一修正为 IPA
PHONETIC_FIX = {
    "\u04d9": "\u0259",   # 西里尔 schwa → ə
    "\u0454": "e",        # 西里尔 є → e
    "^": "r",             # OCR 把 r 识别成 ^
    "\\\\:": "\u025c:",  # "\\:" → ɜ:
    "\\": "",
    "(?@)": "",
}

POS_MAP = {
    "a": "adj.", "ad": "adv.", "conj": "conj.", "prep": "prep.",
    "pron": "pron.", "int": "int.", "aux": "aux.",
}
POS_LINE = re.compile(r"^([A-Za-z][A-Za-z\.\s/]*?\.)\s+(\S.*)$")
BRACKET_LINE = re.compile(r"^\[(.+?)\]\s*(.*)$")
CJK = re.compile(r"[\u4e00-\u9fff]")


def norm_phonetic(p: str) -> str:
    for k, v in PHONETIC_FIX.items():
        p = p.replace(k, v)
    return p.strip()


def split_pos(pos_str: str):
    out = []
    for tok in pos_str.lower().split():
        tok = tok.strip().strip(".")
        if not tok:
            continue
        tok = POS_MAP.get(tok, tok + ".")
        if tok not in out:
            out.append(tok)
    return out


def fmt_meaning(text: str) -> str:
    # 中文语境下的 ASCII 逗号统一成全角
    text = re.sub(r"(?<=[\u4e00-\u9fff]),\s*", "，", text)
    text = re.sub(r",\s*(?=[\u4e00-\u9fff])", "，", text)
    text = re.sub(r"(?<=[\u4e00-\u9fff]);\s*", "；", text)
    text = re.sub(r";\s*(?=[\u4e00-\u9fff])", "；", text)
    return text.strip().strip(";")


def parse_entry(row):
    translation = (row["translation"] or "").replace("\\n", "\n")
    poses, meanings = [], []
    base = []  # 不带领域标签的基础释义
    for line in translation.split("\n"):
        line = line.strip()
        if not line:
            continue
        m = BRACKET_LINE.match(line)
        if m:
            label, rest = m.group(1), fmt_meaning(m.group(2))
            if label == "网络" or not rest:  # 网络释义噪声大，丢弃
                continue
            if any(rest in b for b in base):  # 与基础释义重复的领域释义，丢弃
                continue
            meanings.append(f"【{label}】{rest}")
            continue
        m = POS_LINE.match(line)
        if m and CJK.search(line):
            for p in split_pos(m.group(1)):
                if p not in poses:
                    poses.append(p)
            mean = fmt_meaning(m.group(2))
            base.append(mean)
            meanings.append(mean)
        else:
            mean = fmt_meaning(line)
            base.append(mean)
            meanings.append(mean)
    # 去重并保持顺序
    seen = set()
    meanings = [x for x in meanings if x and not (x in seen or seen.add(x))]
    return poses, meanings


def main():
    words = {}
    with open(SRC, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            tags = set((row["tag"] or "").split())
            if "cet4" not in tags and "cet6" not in tags:
                continue
            w = row["word"].strip().lower()
            if not w or not re.fullmatch(r"[a-z][a-z\-']*", w):
                continue
            poses, meanings = parse_entry(row)
            words[w] = {
                "word": w,
                "phonetic": norm_phonetic(row["phonetic"] or ""),
                "pos": ";".join(poses),
                "meaning": "；".join(meanings),
                "_tags": tags,
            }

    cet4 = sorted(w for w, e in words.items() if "cet4" in e["_tags"])
    # 六级只收四级以上的新增词（考纲即四级词 + 新增词）
    cet6 = sorted(w for w, e in words.items()
                  if "cet6" in e["_tags"] and "cet4" not in e["_tags"])

    for name, keys in (("cet4", cet4), ("cet6", cet6)):
        entries = []
        no_meaning = no_phonetic = 0
        for w in keys:
            e = words[w]
            e.pop("_tags")
            if not e["meaning"]:
                no_meaning += 1
            if not e["phonetic"]:
                no_phonetic += 1
            entries.append(e)
        with open(f"{OUT_DIR}/{name}.json", "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, indent=1)
        print(f"{name}: {len(entries)} 词条, 缺释义 {no_meaning}, 缺音标 {no_phonetic}")
        random.seed(42)
        for e in random.sample(entries, 10):
            print(" ", json.dumps(e, ensure_ascii=False))


if __name__ == "__main__":
    main()
