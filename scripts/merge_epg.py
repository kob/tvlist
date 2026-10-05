#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
合并多个 XMLTV EPG 源为单一 epg.xml。

- 源地址来自 EPG_SOURCES_FILE（默认 epg-sources.txt），每行一个 URL，支持 .gz；
  '#' 开头为注释，空行忽略。
- 合并规则：
    * <channel> 按 id 去重（保留首次出现的完整节点）；
    * <programme> 按 (channel, start) 去重（保留首次出现的完整节点），
      从而消解多个源之间的重叠节目。
- 输出 EPG_OUTPUT（默认 epg.xml），UTF-8 + XML 声明，带缩进。

仅依赖 Python 标准库，便于在 GitHub Actions (ubuntu-latest) 直接运行。
"""
import sys
import os
import gzip
import urllib.request
import xml.etree.ElementTree as ET

SOURCES_FILE = os.environ.get("EPG_SOURCES_FILE", "epg-sources.txt")
# 默认产出带 .gz 的压缩 XML：XMLTV 文本压缩比极高（72MB 明文 → ~7MB gz），
# 可避免每日往 git 历史里塞几十 MB。网页端会透明解压加载。
# 若想入库明文 xml，把下一行改成 "epg.xml" 即可（注意仓库体积）。
OUTPUT = os.environ.get("EPG_OUTPUT", "epg.xml.gz")
UA = "tvlist-epg-merge/1.0 (+https://github.com/kob/tvlist)"


def log(msg):
    print(f"[merge-epg] {msg}", flush=True)


def read_sources(path):
    out = []
    if not os.path.exists(path):
        log(f"源配置文件不存在: {path}")
        return out
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            out.append(s)
    return out


def fetch(url):
    """下载 URL，自动处理 gzip（Content-Encoding 或 .gz 文件本体）。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
        enc = (r.headers.get("Content-Encoding") or "").lower()
        if enc == "gzip":
            data = gzip.decompress(data)
    if data[:2] == b"\x1f\x8b":  # 文件本体就是 gzip
        data = gzip.decompress(data)
    return data


def ns_of(tag):
    """从 tag 中提取命名空间（含花括号），无则返回空串。"""
    if "}" in tag:
        return "{" + tag[1:].split("}")[0] + "}"
    return ""


def merge(sources):
    channels = {}          # id -> Element
    programmes = {}         # (channel, start) -> Element
    root_attrib = {}
    root_tag = "tv"
    ns = ""
    per_source = []

    for url in sources:
        try:
            data = fetch(url)
            root = ET.fromstring(data)
        except Exception as e:
            log(f"✗ 源获取/解析失败，跳过: {url} ({e})")
            per_source.append((url, 0, 0))
            continue

        root_tag = root.tag
        ns = ns_of(root_tag)
        if not root_attrib:
            root_attrib = dict(root.attrib)

        ch_tag = ns + "channel"
        pg_tag = ns + "programme"
        c_cnt = p_cnt = 0

        for ch in root.findall(ch_tag):
            cid = ch.get("id")
            if not cid:
                continue
            if cid not in channels:
                channels[cid] = ch
                c_cnt += 1

        for pg in root.findall(pg_tag):
            ch = pg.get("channel")
            st = pg.get("start")
            if not ch or not st:
                # 没有 key 的节目无法去重，仍保留（key 用占位）
                key = (ch or "", st or f"__{id(pg)}")
            else:
                key = (ch, st)
            if key not in programmes:
                programmes[key] = pg
                p_cnt += 1

        per_source.append((url, c_cnt, p_cnt))
        log(f"✓ 已合并: {url} (新增频道 {c_cnt}, 节目 {p_cnt})")

    if not channels and not programmes:
        log("未从任何源获取到有效数据，退出。")
        sys.exit(1)

    # 重建合并后的 <tv> 根节点
    new_root = ET.Element(root_tag, root_attrib)
    for cid in channels:
        new_root.append(channels[cid])
    for key in programmes:
        new_root.append(programmes[key])

    tree = ET.ElementTree(new_root)
    if ns:
        ET.register_namespace("", ns[1:-1])
    ET.indent(tree, space="  ")
    if OUTPUT.endswith(".gz"):
        with gzip.GzipFile(OUTPUT, "wb", mtime=0) as gz:
            tree.write(gz, encoding="utf-8", xml_declaration=True)
    else:
        tree.write(OUTPUT, encoding="utf-8", xml_declaration=True)

    log(f"合并完成 -> {OUTPUT}")
    log(f"频道总数: {len(channels)}，节目总数: {len(programmes)}")
    for url, c, p in per_source:
        log(f"  源 {url} -> +频道 {c}, +节目 {p}")
    return len(channels), len(programmes)


def main():
    sources = read_sources(SOURCES_FILE)
    if not sources:
        log(f"未在 {SOURCES_FILE} 中找到任何 EPG 源，退出。")
        sys.exit(1)
    log(f"共 {len(sources)} 个 EPG 源待合并")
    merge(sources)


if __name__ == "__main__":
    main()
