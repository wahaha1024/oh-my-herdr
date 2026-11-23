// 历史发言：窗格头一个按钮，点开是当前 OMP 会话里我发过的消息。
// 点一条 → 下面展开「我打的原文 / 这轮动了哪些工具 / agent 最后怎么回的」，
// 命中时还能把 Herdr 的视图滚到那条消息在 scrollback 里的位置（不碰程序、不重发消息）。
//
// 为什么要点开就要给三段：终端只保留约 1000 行（~/.config/herdr-core 下没有 config.toml，
// settings.json 也没有 scrollback 项，改不了），一个连续调工具的轮次就能吃掉几百行，
// 所以只有最近两三轮的发言还在缓冲区里。更早的「看上下文」只能由面板自己给——
// 数据来自同一份 jsonl：一条 user 到下一条 user 之间的 assistant 文本与 toolCall 标题。
//
// 会话识别：按 pane.cwd 拼目录名（E:\DSH → --E--DSH--），OMP 只把同一项目的会话放进那个目录；
// 标题对得上就用标题匹配到的那个，对不上（新会话还没起名）用目录里最新的那个。
//
// 行号换算：`hc read <t> --lines N --json` 给出整段保留历史（末行 = 当前屏最后一行），
// 发言原文在其中按「从下往上、单调」对位，得到距文本顶的行号 i；
// 绝对行 = total - L + i（total 取 panes()[..].scroll.total），
// 定位用 scroll {to:"top"} 再 {lines: 绝对行 - 1}，让这一轮从视口顶部开始。

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, InputState, Input } from "gpui-base";
import { panes, props, run, exec, hc, theme, home, appHome, checking, shared, readTextFile, writeTextFile, closeOverlay, openOverlay, setShared, watchFolder } from "herdr";

// 中英切换：shared 改动会让所有 mod 重绘，切换语言立即生效。
const LANG = "inkstone.lang";
const pick = (zh, en) => (shared(LANG) === "en" ? en : zh);

const PAPER = (t) => Boolean(t.paper);
const ink = (t, slot, fallback) => (PAPER(t) ? t[slot] : (t[fallback] ?? t.foreground));
const tint = (hex, a) => (typeof hex === "string" && hex.length === 7 ? hex + a : hex);
const EDGE_T = 12, EDGE_LONG = 3206, EDGE_TALL = 1794, EDGE_CORNER = 46, EDGE_FOOT = 40;
const EDGE_PRESETS = [
  { bg: "#e8f0ec", muted: "#5f6b67", dir: "ink-qingci" },
  { bg: "#f7f4ed", muted: "#746b5e", dir: "ink-xuanzhi" },
  { bg: "#e9e2d4", muted: "#665f53", dir: "ink-xuanzhi" }, // xuanzhi-dimmed
  { bg: "#14131a", muted: "#8b8597", dir: "ink-xuanmo" },
  { bg: "#19181e", muted: "#8f8996", dir: "ink-xuanmo" }, // xuanmo-dimmed
];
let edgeCacheKey = "";
let edgeCacheDir = null;
function artEdgeDir(t) {
  if (t.paper) return "ink";
  const bg = t.background ?? "", muted = t.muted ?? "";
  const key = `${bg}|${muted}`;
  if (key !== edgeCacheKey) {
    edgeCacheKey = key;
    const p = EDGE_PRESETS.find((x) => x.bg === bg && x.muted === muted)
      ?? EDGE_PRESETS.find((x) => x.bg === bg);
    edgeCacheDir = p ? p.dir : null;
  }
  return edgeCacheDir;
}
function paperCard(view, t, content) {
  const dir = artEdgeDir(t);
  const line = tint(t.accent, "cc");
  if (!dir) return content.rounded(10).border(1).border_color(line);
  const w = Math.max(200, view._cardW ?? 484);
  const h = Math.max(160, view._cardH ?? 520);
  const sideH = Math.max(0, h - 2 * EDGE_T);
  const art = (name, iw, ih) => image(`mods/inkstone-edge/${dir}/${name}.svg`).absolute().w(iw).h(ih);
  const hEdge = (side) => div().relative().w_full().h(EDGE_T).flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(Math.max(0, w - EDGE_CORNER)).h(EDGE_T).overflow_hidden().child(art(`${side}-l`, EDGE_LONG, EDGE_T).left(0).top(0)))
    .child(div().absolute().right(0).top(0).w(Math.min(w, EDGE_CORNER)).h(EDGE_T).overflow_hidden().child(art(`${side}-r`, EDGE_CORNER, EDGE_T).right(0).top(0)));
  const vEdge = (side) => div().relative().w(EDGE_T).h_full().flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(EDGE_T).h(Math.max(0, sideH - EDGE_FOOT)).overflow_hidden().child(art(`${side}-t`, EDGE_T, EDGE_TALL).left(0).top(0)))
    .child(div().absolute().left(0).bottom(0).w(EDGE_T).h(Math.min(sideH, EDGE_FOOT)).overflow_hidden().child(art(`${side}-b`, EDGE_T, EDGE_FOOT).left(0).bottom(0)));
  return v_flex().id("hx-card").size_full().min_h(0)
    .on_size_change((sz, cx) => {
      if (Math.abs((view._cardW ?? 0) - sz.width) >= 1 || Math.abs((view._cardH ?? 0) - sz.height) >= 1) {
        view._cardW = sz.width;
        view._cardH = sz.height;
        cx.notify();
      }
    })
    .child(hEdge("top"))
    .child(h_flex().w_full().flex_1().min_h(0)
      .child(vEdge("left"))
      .child(div().flex_1().min_w(0).min_h(0).h_full().overflow_hidden().border(1).border_color(line).child(content))
      .child(vEdge("right")))
    .child(hEdge("bottom"));
}
const sq = (s) => String(s).replace(/'/g, "''");
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// PowerShell 的 stdout 是 OEM 代码页，中文路径/正文不设 UTF-8 会变乱码。
const PS = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; ";
const HISTORY_LINES = "20000";

// 解析会话 jsonl 改由 node 做：node 启动约 96ms，PowerShell 1.1–1.9s；
// 而且进程内能用 fs 定位到字节偏移，只读上次之后新增的那几行
// （活跃会话每 2 秒一次静默刷新，重扫 36MB 是最白花的一笔）。
// 下面这段是子进程源码，判定顺序 / 字段名 / 截断长度必须与 readMessages 的 PowerShell 分支逐条一致。
// 它是宿主模板字符串的内容，所以里面不能出现反引号和美元花括号。
const NODE_SRC = `
const fs = require("fs");
const file = process.argv[1];
const from = Number(process.argv[2]) || 0;
const fd = fs.openSync(file, "r");
const size = fs.fstatSync(fd).size;
const start = (from > 0 && from <= size) ? from : 0;
const span = Math.max(0, size - start);
const buf = Buffer.allocUnsafe(span);
let got = 0;
while (got < span) { const n = fs.readSync(fd, buf, got, span - got, start + got); if (n <= 0) break; got += n; }
fs.closeSync(fd);
const text = buf.toString("utf8", 0, got);
const nl = text.lastIndexOf("\\n");
const body = nl >= 0 ? text.slice(0, nl + 1) : "";
const seen = start + Buffer.byteLength(body, "utf8");
const items = [];
const lines = body.split("\\n");
for (const line of lines) {
  if (!line) continue;
  if (line.indexOf('"type":"compaction"') >= 0) {
    let o; try { o = JSON.parse(line); } catch (e) { continue; }
    let tx = String(o.shortSummary || o.summary || "");
    if (tx.length > 300) tx = tx.slice(0, 300);
    items.push({ k: "c", ts: String(o.timestamp || ""), text: tx, before: Number(o.tokensBefore) || 0, after: Number(o.tokensAfter) || 0, first: String(o.firstKeptEntryId || "") });
    continue;
  }
  if (line.indexOf('"type":"message"') < 0) continue;
  let o; try { o = JSON.parse(line); } catch (e) { continue; }
  const m = o.message; if (!m) continue;
  if (m.role !== "user" && m.role !== "assistant") continue;
  let s = ""; const tools = [];
  const cs = Array.isArray(m.content) ? m.content : [];
  for (const c of cs) {
    if (c.type === "text" && c.text) { if (s) s += " "; s += c.text; continue; }
    if (c.type === "image") { if (s) s += " "; s += pick("[图片]", "[image]"); continue; }
    if (c.type !== "toolCall") continue;
    let ag = c.arguments;
    if (typeof ag === "string") { try { ag = JSON.parse(ag); } catch (e) { ag = null; } }
    let h = "";
    if (ag) { if (ag.path) h = String(ag.path); else if (ag.command) h = String(ag.command).split("\\n")[0]; else if (ag.query) h = String(ag.query); }
    let t = String(c.intent || c.name || "");
    if (h) t = t + " " + h;
    if (t.length > 120) t = t.slice(0, 120);
    tools.push(t);
  }
  if (!s && tools.length === 0) continue;
  if (s.length > 4000) s = s.slice(0, 4000);
  items.push({ k: "m", id: String(o.id || ""), ts: String(o.timestamp || ""), role: m.role, text: s, tools: tools });
}
process.stdout.write(JSON.stringify({ from: start, seen: seen, items: items }));
`;

const NODE = { ok: null };      // null = 还没探测过；探测结果之后固定，不再每次试
const PARSED = new Map();       // 文件绝对路径 -> { seen, at, items }，内存里最多 4 个会话
const FOUND = new Map();        // `标题|cwd` -> { file, title, size, at }
const CACHE_TTL = 120000;       // 会话文件查找结果的复用时长
// readTextFile 只读得回 1 MiB，超了就解析失败、也就再也覆盖不回去：
// 宁可这次不落盘（冷开退化成一次 node 全量解析，约 0.5 s），也不写一份读不回来的缓存。
const CACHE_MAX_BYTES = 900000;
const CACHE_FILE = () => `${appHome()}/data/inkstone-history-cache.json`;

function utf8Bytes(s) {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

async function nodeOk() {
  if (NODE.ok !== null) return NODE.ok;
  const r = await exec("node", ["-e", "1"], { timeout: 5000 }).catch(() => null);
  NODE.ok = Boolean(r && r.code === 0);
  return NODE.ok;
}

// 磁盘缓存：{ v:1, entries:{ [文件]: { seen, at, items } } }。
// 只按 seen 与文件当前长度对齐（jsonl 只追加）；文件损坏/半写一律当空缓存，不报错。
let diskMemo = null;
let diskRaw = null;             // 上次读到的原文：writeTextFile 的 expected 必须与磁盘内容一致
let saveDirty = false;
let saving = false;
let savedAt = 0;

async function diskCache() {
  if (diskMemo) return diskMemo;
  let obj = { v: 1, entries: {} };
  try {
    const s = await readTextFile(CACHE_FILE());
    diskRaw = s ?? null;
    if (s) {
      const o = JSON.parse(s);
      if (o && o.v === 1 && o.entries && typeof o.entries === "object") obj = o;
    }
  } catch {
    /* 半写或手改坏了：当空缓存，下次写回时覆盖 */
  }
  diskMemo = obj;
  return obj;
}

async function saveCache() {
  if (!saveDirty) return;
  saveDirty = false;
  savedAt = Date.now();
  if (checking()) return; // `herdr-app check` 会真的跑 init，别在检查时写盘
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const db = await diskCache();
      const entries = { ...db.entries };
      for (const [k, e] of PARSED) {
        if (!entries[k] || e.at >= (entries[k].at || 0)) entries[k] = e;
      }
      const rows = Object.entries(entries).filter(([, e]) => e && Array.isArray(e.items));
      rows.sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
      const next = { v: 1, entries: Object.fromEntries(rows.slice(0, 3)) };
      const json = JSON.stringify(next);
      if (utf8Bytes(json) > CACHE_MAX_BYTES) return;
      await writeTextFile(CACHE_FILE(), json, diskRaw);
      diskRaw = json;
      diskMemo = next;
      return;
    } catch {
      // 重新读取并合并其他实例写入的条目；不把未落盘的快照当作 expected。
      diskRaw = null;
      diskMemo = null;
    }
  }
}

// 活跃会话每 2 秒刷新一次，没必要每次都落盘：5 秒一次就够，关窗时再补一次。
// 用节流而不是 cx.timer.after：定时器只在第一次刷新时排一次，之后如果没真正触发，
// 缓存会一直停在旧 seen 上（实测 12 分钟没更新），节流不依赖任何回调。
function maybeSave() {
  saveDirty = true;
  if (saving || Date.now() - savedAt < 5000) return;
  saving = true;
  saveCache().finally(() => {
    saving = false;
  });
}

// 去掉开头的状态符号（π、⠧、图标字体私用区字符），留下标题本身。
const bare = (s) => String(s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function hhmm(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 字号只这几档。以前从 11 到 12.5 都挤在一起，配上清一色的灰，什么都分不出来。
// 不换 font_family：它要机器上真实存在的字形名（Consolas / Menlo 跨平台不一致），
// 面板要在 Windows / macOS / Linux 上长得一样，层次只靠字号 + 字重 + 颜色 + 色块。
const FS = {
  title: 13.5,
  sub: 10.5,
  row: 12.5,
  time: 10.5,
  badge: 9.5,
  label: 10.5,
  body: 12,
  readTitle: 15,
  readBody: 13.5,
  readMeta: 11,
};

// 段落标签：3px 色块 + 加粗小字，让「提问 / 回复 / 工具」一眼分开。
function sectionLabel(t, text, color, size = FS.label) {
  return h_flex()
    .flex_none()
    .items_center()
    .gap(5)
    .child(div().flex_none().w(3).h(size - 0.5).rounded(1).bg(color))
    .child(div().flex_none().text_size(size).font_weight(700).text_color(color).child(text));
}

// 主操作（跳到终端）：实心 accent，和周围一圈描边小按钮分开，不用再找。
function primaryButton(t, id, label, action) {
  return div()
    .id(id)
    .h(22)
    .px(9)
    .flex()
    .items_center()
    .rounded(6)
    .bg(t.accent)
    .text_size(11)
    .font_weight(600)
    .text_color(t.accent_foreground ?? t.background)
    .cursor_pointer()
    .hover((h) => h.bg(t.solid ?? t.accent))
    .on_click((_e, c) => {
      c.stop_propagation();
      action(c);
    })
    .child(label);
}

// 小徽标：会话轮数这类只需要「在那儿」的信息，不参与点击。
function chip(t, label) {
  return div()
    .flex_none()
    .h(18)
    .px(6)
    .flex()
    .items_center()
    .rounded(9)
    .bg(t.surface)
    .border(1)
    .border_color(t.border)
    .text_size(FS.sub)
    .text_color(t.muted)
    .child(label);
}

// 会话文件按 cwd 分目录存（E:\DSH → --E--DSH--），同一个 cwd 目录里通常只有一个在写的会话。
// 先在这个目录里按标题对；对不上（新会话还没起名）就取该目录里最新的那个——
// 这不叫瞎猜，目录本身就是「这个项目」的范围。目录不存在时才退回全局按标题找，
// 全局还找不到就返回 null（以前会退回「最近改过的文件」，等于把别的项目当成本会话）。
async function findSession(title, cwd) {
  const root = `${home()}\\.omp\\agent\\sessions`;
  const want = bare(title);
  // 末尾多一个分隔符就会多拼出一个 '-'（E:\DSH\ → --E--DSH---），Test-Path 直接失败。
  const clean = String(cwd ?? "").replace(/[\\/]+$/, "");
  const dir = clean ? `--${clean.replace(/[:\\/]/g, "-")}--` : "";
  const cmd =
    PS +
    `$root='${sq(root)}'; ` +
    (dir
      ? `$d=Join-Path $root '${sq(dir)}'; if (Test-Path -LiteralPath $d) { $p=$d; '@@dir' } else { $p=$root; '@@all' }; `
      : `$p=$root; '@@all'; `) +
    // 会话文件在 $root\<项目目录>\ 下面一层；退回 $root 时只扫这一层，
    // 不加 -Depth 1 就一条都列不出来，用 -Recurse 又会把更深的附件目录也扫进来。
    `Get-ChildItem -LiteralPath $p -Filter *.jsonl -Recurse -Depth 1 -ErrorAction SilentlyContinue | ` +
    `Sort-Object LastWriteTime -Descending | Select-Object -First 40 | ForEach-Object { ` +
    `$l = Get-Content -LiteralPath $_.FullName -TotalCount 1 -Encoding UTF8 -ErrorAction SilentlyContinue; ` +
    `if ($l) { '{0}|{1}|{2}' -f $_.FullName, $_.Length, $l } }`;
  const r = await exec("powershell", ["-NoProfile", "-Command", cmd], { timeout: 30000 }).catch(() => null);
  if (!r || r.code !== 0) return null;
  let mode = "all";
  let newest = null;
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line) continue;
    if (line === "@@dir" || line === "@@all") {
      mode = line.slice(2);
      continue;
    }
    const cut = line.indexOf("|");
    if (cut < 0) continue;
    const rest = line.slice(cut + 1);
    const cut2 = rest.indexOf("|");
    if (cut2 < 0) continue;
    const file = line.slice(0, cut);
    const size = Number(rest.slice(0, cut2)) || 0;
    const first = rest.slice(cut2 + 1);
    let head = "";
    try { head = bare(JSON.parse(first).title ?? ""); } catch { continue; }
    const rec = { file, size, title: head };
    if (!newest) newest = rec;
    if (want && head && (want.endsWith(head) || head.endsWith(want))) return rec;
  }
  if (mode === "dir" && newest) return newest;
  return null;
}

// 同一会话每 2 秒刷新一次都要重新列目录 + 读 40 个文件首行，纯属重复劳动：
// 标题和 cwd 没变就复用上次找到的文件（2 分钟内有效）。找不到不缓存——新会话的文件可能还没落盘。
async function findSessionCached(title, cwd) {
  const key = `${bare(title)}|${String(cwd ?? "")}`;
  const hit = FOUND.get(key);
  if (hit && Date.now() - (hit.at || 0) < CACHE_TTL) return hit;
  const found = await findSession(title, cwd);
  if (!found) return null;
  const rec = { file: found.file, size: found.size, title: found.title, at: Date.now() };
  FOUND.set(key, rec);
  if (FOUND.size > 16) FOUND.delete(FOUND.keys().next().value);
  return rec;
}

// 两套解析器共用一份规整：压缩点留四要素，消息统一成 { id, ts, role, text, tools }。
function normItem(o) {
  if (!o) return null;
  if (o.k === "c") {
    return {
      k: "c",
      ts: String(o.ts ?? ""),
      text: String(o.text ?? ""),
      before: Number(o.before) || 0,
      after: Number(o.after) || 0,
      first: String(o.first ?? ""),
    };
  }
  const tt = o.tools;
  return {
    k: "m",
    id: String(o.id ?? ""),
    ts: String(o.ts ?? ""),
    role: String(o.role ?? ""),
    text: String(o.text ?? ""),
    tools: (Array.isArray(tt) ? tt : tt ? [tt] : []).map(flat).filter(Boolean),
  };
}

// 读会话文件，返回 { items, seen, from }：items 按文件顺序混放 {k:"m"} 与 {k:"c"}，
// from 是这次实际开始解析的字节偏移（0 = 全量），seen 是「已完整解析到哪」——
// 下次从 seen 续读就不会把正写到一半的那一行吃掉。
// 有 node 走 node（启动快、能定位偏移）；没有就退回 PowerShell 全量扫，功能不变只是慢。
// 不走 readTextFile：21 MB 的字符串过一遍 IPC 要十几秒，面板会一直停在「读取…」。
async function readMessages(file, fromByte = 0) {
  if (await nodeOk()) {
    const nr = await exec("node", ["-e", NODE_SRC, file, String(fromByte)], { timeout: 30000 }).catch(() => null);
    if (nr && nr.code === 0) {
      let j = null;
      try { j = JSON.parse(String(nr.stdout ?? "").trim()); } catch { j = null; }
      if (j && Array.isArray(j.items)) {
        const items = [];
        for (const o of j.items) {
          const it = normItem(o);
          if (it) items.push(it);
        }
        return { items, seen: Number(j.seen) || 0, from: Number(j.from) || 0 };
      }
    }
    // 输出都解析不了说明这台机器上的 node 不对劲，别每 2 秒再试一次。
    NODE.ok = false;
  }
  const cmd =
    PS +
    `$p='${sq(file)}'; $fs=[System.IO.File]::Open($p,'Open','Read','ReadWrite'); ` +
    `$len=$fs.Length; $sr=New-Object System.IO.StreamReader($fs,[Text.Encoding]::UTF8); ` +
    `'@@' + $len; ` +
    `$q=[string][char]34; $k=$q+'type'+$q+':'+$q+'message'+$q; $kc=$q+'type'+$q+':'+$q+'compaction'+$q; ` +
    `$u=$q+'role'+$q+':'+$q+'user'+$q; $a=$q+'role'+$q+':'+$q+'assistant'+$q; ` +
    `while (($line = $sr.ReadLine()) -ne $null) { ` +
    // 压缩点单独成行，不含 "type":"message"，必须放在 message 预筛之前判。
    `if ($line.Contains($kc)) { try { $o = $line | ConvertFrom-Json } catch { continue }; ` +
    `$tx=''; if ($o.shortSummary) { $tx=[string]$o.shortSummary } elseif ($o.summary) { $tx=[string]$o.summary }; ` +
    `if ($tx.Length -gt 300) { $tx=$tx.Substring(0,300) }; ` +
    `[pscustomobject]@{ k='c'; ts=$o.timestamp; text=$tx; before=$o.tokensBefore; after=$o.tokensAfter; first=$o.firstKeptEntryId } | ` +
    `ConvertTo-Json -Compress; continue }; ` +
    `if (-not $line.Contains($k)) { continue }; ` +
    `if (-not ($line.Contains($u) -or $line.Contains($a))) { continue }; ` +
    `try { $o = $line | ConvertFrom-Json } catch { continue }; ` +
    `$m = $o.message; if (-not $m) { continue }; ` +
    `if ($m.role -ne 'user' -and $m.role -ne 'assistant') { continue }; ` +
    `$s=''; $tl=New-Object System.Collections.ArrayList; foreach ($c in $m.content) { ` +
    `if ($c.type -eq 'text' -and $c.text) { if ($s) { $s += ' ' }; $s += $c.text } ` +
    `elseif ($c.type -eq 'toolCall') { ` +
    `$h=''; $ag=$c.arguments; if ($ag -is [string]) { try { $ag = $ag | ConvertFrom-Json } catch {} }; ` +
    `if ($ag) { if ($ag.path) { $h=[string]$ag.path } elseif ($ag.command) { $h=([string]$ag.command).Split([char]10)[0] } elseif ($ag.query) { $h=[string]$ag.query } }; ` +
    `$t=[string]$c.intent; if (-not $t) { $t=[string]$c.name }; if ($h) { $t=$t+' '+$h }; ` +
    `if ($t.Length -gt 120) { $t=$t.Substring(0,120) }; [void]$tl.Add($t) } ` +
    `elseif ($c.type -eq 'image') { if ($s) { $s += ' ' }; $s += pick("[图片]", "[image]") } }; ` +
    `if (-not $s -and $tl.Count -eq 0) { continue }; if ($s.Length -gt 4000) { $s=$s.Substring(0,4000) }; ` +
    `[pscustomobject]@{ k='m'; id=$o.id; ts=$o.timestamp; role=$m.role; text=$s; tools=$tl } | ` +
    `ConvertTo-Json -Compress -Depth 4 }; ` +
    `$sr.Close()`;
  const r = await exec("powershell", ["-NoProfile", "-Command", cmd], { timeout: 30000 }).catch(() => null);
  if (!r || r.code !== 0) return null;
  let seen = 0;
  const items = [];
  for (const line of String(r.stdout ?? "").split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("@@")) {
      seen = Number(line.slice(2)) || 0;
      continue;
    }
    try {
      const it = normItem(JSON.parse(line));
      if (it) items.push(it);
    } catch {
      /* 正写到一半的行 */
    }
  }
  // PowerShell 分支永远全量：行边界的字节偏移在 PS 里算不划算（见计划里的取舍），
  // 能跑 node 的机器（OMP 本身是 node 应用）都走上面的增量路径。
  return { items, seen, from: 0 };
}

// 终端里一行会被折行、行尾会补空格，所以匹配放在「去掉全部空白的整段历史」上做，
// 命中后再按偏移反查回行号。片段取最长的几段连续中文；短于 8 个字的不算数。
const ZH_RUN = /[\u4e00-\u9fff，。、：；！？「」（）0-9]{8,}/g;
const EN_RUN = /[A-Za-z0-9_.:/-]{10,}/g;

function probesOf(text) {
  const s = String(text ?? "").replace(/\s+/g, "");
  const zh = (s.match(ZH_RUN) || []).sort((a, b) => b.length - a.length).slice(0, 3);
  const en = (s.match(EN_RUN) || []).sort((a, b) => b.length - a.length).slice(0, 2);
  return [...zh, ...en];
}

// 把扁平的记录流折成「轮次」：一条 user 开一轮，
// 它之后、下一条 user 之前的 assistant 文本与工具调用都归这一轮。
// 面板要回答的就三件事：我问了什么、这轮动了几次工具、最后怎么回的。
// 压缩点（{k:"c"}）不占轮次，另存成 marks，用 at 记住「它前面已有几轮」，
// 再用 firstKeptEntryId 反查「前 N 轮已归档」——反查不到（指向没解析的 toolResult）就只报 tokens。
function rounds(items) {
  const out = [];
  const marks = [];
  const ids = new Map();
  let cur = null;
  for (const r of items) {
    if (r.k === "c") {
      marks.push({ ts: r.ts, text: r.text, before: r.before, after: r.after, first: r.first, at: out.length, archived: null });
      continue;
    }
    if (r.role === "user") {
      cur = { id: r.id, ts: r.ts, text: r.text, probes: probesOf(r.text), reply: "", tools: [] };
      out.push(cur);
      if (r.id) ids.set(r.id, out.length - 1);
      continue;
    }
    if (!cur) continue; // 会话开头可能直接是 assistant，没有对应的提问，跳过
    if (r.id) ids.set(r.id, out.length - 1);
    if (r.text) cur.reply = r.text; // 只留最后一条，中间的过渡语对看结论没价值
    for (const t of r.tools || []) if (t) cur.tools.push(t);
  }
  for (const mk of marks) {
    const j = mk.first ? ids.get(mk.first) : undefined;
    if (j !== undefined) mk.archived = j;
  }
  // 原文太短（「继续」「好」）时自己定位不到，退到这一轮回复里的片段当锚；
  // 回复里的片段同时也是「这段对话确实在这一屏」的佐证，所以无条件并进来。
  // 对位要求两个片段互相印证，只有一条探针时连「我的原话还留在终端里」都认不出来。
  for (const m of out) {
    if (m.reply) m.probes = [...m.probes, ...probesOf(m.reply).slice(0, 2)];
  }
  return { rounds: out, marks };
}

// 整段保留历史：行与 Herdr 视图的行一一对应（已用编号终端验证过）。
// 连续跳转（↑↓ 敲一串、反复点同一行）没必要每次都把 20000 行重新读一遍——
// 终端内容在两次跳之间不会变，给 1.5s 的窗口复用；真正重算对位时传 maxAge = 0。
const HIST = new Map();
async function readHistory(term, maxAge = 1500) {
  const key = String(term ?? "");
  const hit = HIST.get(key);
  if (hit && maxAge > 0 && Date.now() - hit.at <= maxAge) return hit.h;
  const r = await hc(["read", key, "--lines", HISTORY_LINES, "--json"]).catch(() => null);
  if (!r || r.code !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    const lines = String(j.text ?? "").split("\n");
    const h = { lines, complete: Boolean(j.complete) };
    HIST.set(key, { h, at: Date.now() });
    if (HIST.size > 8) HIST.delete(HIST.keys().next().value);
    return h;
  } catch {
    return null;
  }
}

// 把历史压成一条没有空白的字符串，并记下每行的起点偏移。
function squashLines(lines) {
  const starts = [];
  const parts = [];
  let pos = 0;
  for (const l of lines) {
    const t = l.replace(/\s+/g, "");
    starts.push(pos);
    parts.push(t);
    pos += t.length;
  }
  return { text: parts.join(""), starts };
}

function lineAt(starts, off) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// 从底部向上找：只在上一条命中的位置之上继续，避免同一段文字重复命中。
// 我会在思考里大量引用原话，所以短片段单独命中很容易撞到「我当时引用它的那段」；
// 除了超长片段，还要求它的另一个片段也落在附近，才认这个位置。
function align(messages, lines) {
  const { text, starts } = squashLines(lines);
  const out = new Array(messages.length).fill(-1);
  let floor = text.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const ps = (messages[i].probes || []).filter((p) => p.length >= 12);
    for (let a = 0; a < ps.length; a += 1) {
      const at = text.lastIndexOf(ps[a], floor);
      if (at < 0) continue;
      let corroborated = false;
      for (let k = 0; k < ps.length; k += 1) {
        if (k === a) continue;
        const j = text.indexOf(ps[k], Math.max(0, at - 4000));
        if (j >= 0 && j <= Math.min(text.length, at + 4000)) {
          corroborated = true;
          break;
        }
      }
      if (ps[a].length < 30 && !corroborated) continue;
      out[i] = lineAt(starts, at);
      floor = at;
      break;
    }
  }
  return out;
}

function historyStatus(can, lines, pending = pick("对齐中…", "Aligning…")) {
  if (can) return pick("这一轮还在终端里", "This turn is still in the terminal");
  if (lines === null) return pending;
  if (lines < 0) return pick("读不到终端历史", "Can't read the terminal history");
  return `已滚出终端（仅留 ${lines} 行）`;
}

export default class History extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    // 多个窗格各开一个浮层时靠 overlay id 认领「哪个窗口是我」，别去清别人的记录。
    this.oid = String(props()?.overlay ?? "");
    // 阅读窗口：一轮的全文（提问 + 工具 + 回复），内容由面板经 shared 递过来，
    // 自己不碰 jsonl、不监听目录，所以开得比面板快得多。
    if (props()?.mode === "read") {
      this.readMode = true;
      this.read = shared("inkstone.history.read") ?? null;
      this.term = String(this.read?.term ?? "");
      this.tip = "";
      this.toolsOpen = false; // 工具多则一屏全是步骤，默认收起，把回复顶上去
      return;
    }
    // 窗格头的按钮会带上 terminal；从命令行 `mod.open` 打开时不带，退到当前焦点窗格。
    const cur = panes().find((x) => x.focused) ?? panes()[0] ?? null;
    this.term = String(props()?.terminal ?? cur?.terminal ?? "");
    this.messages = [];
    this.marks = [];
    this.file = "";
    this.size = 0;
    this.title = "";
    this.sel = -1;
    this.align = [];
    this.raw = [];
    this.histLines = null;
    this.alignTot = -1; // 上次对位时终端的 scroll.total，用来判断要不要重算
    this.busy = false;
    this.loading = true;
    this.note = "";
    this.over = null;
    this.expand = false; // 工具脉络默认折叠
    this.longText = false; // 原文超过三行先折起来，让工具和回复也露出来
    this.query = "";
    this.typing = false;
    this.closed = false; // 面板关掉后要停掉目录监听
    this.following = null;
    this.pendingReload = null;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: pick("搜索提问、回复或工具…", "Search prompts, replies or tools…") });
    this.input.on("change", (_e, c) => {
      this.query = this.input.value();
      c.notify();
    });
    this.input.on("focus", (_e, c) => {
      this.typing = true;
      c.notify();
    });
    this.input.on("blur", (_e, c) => {
      this.typing = false;
      c.notify();
    });
    // 多个窗格各开一个浮层时靠 overlay id 认领「哪个窗口是我」，别去清别人的记录。
    this.oid = String(props()?.overlay ?? "");
    this.scroll = ScrollHandle.new();
    if (checking()) {
      this.loading = false;
      return;
    }
    // 窗格头按钮靠这条记录判断"再点一次是收起"。
    setShared("inkstone.history", { term: this.term, id: this.oid });
    this.checkTitle(cx);
    // 目录事件驱动读取；定时器只检测换会话，并在没有监听时补读。
    cx.timer.every(15000, (c) => {
      this.checkTitle(c);
      if (!this.following && !this.busy && this.pane()) this.queueReload(c);
    });
  }

  // 关掉自己，并让窗格头按钮回到未开状态。
  shut() {
    this.closed = true;
    this.stopFollowing();
    this.release();
    // 关窗时把还没落盘的解析结果写掉，下次冷开就能直接出列表。
    if (saveDirty) saveCache();
    closeOverlay(this.oid);
  }

  // 被别的方式关掉（Esc、切布局、命令行 overlay.close）时也走这里，
  // 否则窗格头按钮会一直以为自己还开着，第一次点变成「关一个不存在的窗口」。
  async close() {
    this.closed = true;
    this.stopFollowing();
    this.release();
    if (saveDirty) saveCache();
  }

  // 窗格 B 已经接管时，A 关窗不能顺手抹掉 B 的按钮状态——只有登记的仍是我才清。
  release() {
    const st = shared("inkstone.history");
    if (!st || String(st.id) !== this.oid) return;
    setShared("inkstone.history", null);
  }

  pane() {
    return panes().find((p) => p.terminal === this.term) ?? null;
  }

  // 把记录流摆到面板上：轮次、压缩点、选择、箭头。
  // 缓存里先摆一次（冷开时第一屏不用等全量解析），拿到新增字节后再摆一次，所以抽成一处。
  apply(raw, scroll) {
    this.raw = raw;
    // 轮次只在末尾追加，按 id 找回上一次选中的那条，否则每来一条新消息都把选择踢回最新。
    const was = this.sel >= 0 ? this.messages[this.sel] : null;
    const rr = rounds(raw);
    this.messages = rr.rounds;
    this.marks = rr.marks;
    const at = was ? this.messages.findIndex((m) => m.id === was.id) : -1;
    this.sel = at >= 0 ? at : this.messages.length - 1;
    // 轮次只往后追加，所以上一次的对位仍然有效：沿用前缀、末尾补 -1，
    // 否则每来一条新消息（活跃会话每几秒一次静默刷新）右侧的箭头就全被抹成暗点。
    this.align = this.align.slice(0, this.messages.length);
    while (this.align.length < this.messages.length) this.align.push(-1);
    if (!was && scroll) this.scroll.scroll_to_item(0); // 只在首次打开时跳到最新一条，别把用户滚到的位置拽回去
  }

  async load(cx, silent = false) {
    if (this.busy || this.closed) return;
    this.busy = true;
    const source = this.source;
    const current = () => !this.closed && this.source === source;
    let file = "";
    if (!silent) {
      this.loading = true;
      this.note = "";
      cx.notify();
    }
    try {
      const p = this.pane();
      // 已经认得文件就别再列目录：findSession 是 1.1–1.9s 的进程，而活跃会话每 2 秒刷新一次。
      // 换会话由 checkTitle 把 this.file 清空来触发。
      const found = this.file
        ? { file: this.file, title: this.title }
        : p ? await findSessionCached(p.title, p.cwd) : null;
      if (!current()) return;
      if (!found) {
        this.messages = [];
        this.marks = [];
        this.raw = [];
        this.align = [];
        this.histLines = null;
        this.note = pick("没找到这个会话的记录", "No record found for this session");
        return;
      }
      file = found.file;
      this.file = file;
      if (found.title) this.title = found.title;
      if (found.size) this.size = found.size;
      // 1) 缓存里的列表先上屏（内存或上次落盘的），冷开不用干等一次全量解析。
      const db = await diskCache();
      if (!current()) return;
      const entry = PARSED.get(file) ?? db.entries[file] ?? null;
      const cached = entry && Array.isArray(entry.items) && entry.items.length ? entry : null;
      if (cached) {
        this.apply(cached.items, true);
        this.loading = false;
        this.note = pick("同步中…", "Syncing…");
        cx.notify();
      }
      // 2) 只解析上次之后新增的字节；node 不可用时 from = 0，整份重来（等同改造前的行为）。
      const from = (await nodeOk()) ? (cached?.seen ?? 0) : 0;
      if (!current()) return;
      const got = await readMessages(file, from);
      if (!current()) return;
      if (!got) throw new Error(pick("会话文件读不出来", "Can't read the session file"));
      const items = got.from > 0 && cached ? cached.items.concat(got.items) : got.items;
      PARSED.set(file, { seen: got.seen, at: Date.now(), items });
      if (PARSED.size > 4) PARSED.delete(PARSED.keys().next().value);
      this.apply(items, true);
      this.note = "";
      this.loading = false;
      cx.notify();
      maybeSave();
      this.follow(cx);
      // 能不能跳回终端要对着终端现有的几千行算，算完给列表右侧的箭头用。
      await this.syncAlign(cx);
    } catch (e) {
      if (!current()) return;
      // 读文件/读终端任何一步失手都要把 loading 收掉，否则面板会一直停在「读取会话…」。
      // 顺手把文件句柄和缓存都丢掉：下次重新按标题找，别对着一个坏路径重试。
      this.note = `读取失败：${e?.message ?? e}`;
      this.file = "";
      this.stopFollowing();
      if (file) PARSED.delete(file);
    } finally {
      this.busy = false;
      if (current()) {
        this.loading = false;
        cx.notify();
      } else if (!this.closed) {
        this.load(cx);
      }
    }
  }

  // 对位：哪一轮还在终端的保留区里、在第几行。
  // 终端保留区不跟着新消息变，行数和对位长度都没动就直接复用上一次的结果。
  async syncAlign(cx) {
    const source = this.source;
    const p = this.pane();
    const tot = p?.scroll?.total ?? -1;
    const previous = this.histLines;
    if (previous !== null && previous > 0 && this.align.length === this.messages.length && this.alignTot === tot) return;
    const h = await readHistory(this.term, previous === null || previous < 0 ? 0 : 1500);
    if (this.closed || this.source !== source) return;
    this.histLines = h ? h.lines.length : -1;
    this.align = h ? align(this.messages, h.lines) : [];
    this.alignTot = tot;
    cx.notify();
  }

  // 以前是每 5 秒起一个 PowerShell 问「文件长了没有」——一次进程 1.4–1.9s，白烧。
  // 现在监听会话目录：有写入才重载，并且 2 秒去抖（OMP 每写一行一条事件）。
  // 空闲时 0 次进程；对话过程中最多 1 次 / 2 秒。
  stopFollowing() {
    const following = this.following;
    this.following = null;
    following?.handle?.cancel();
  }

  follow(cx) {
    if (this.closed || !this.file) return;
    const dir = this.file.replace(/[\\/][^\\/]+$/, "");
    if (this.following?.dir === dir) return;
    this.stopFollowing();
    const following = this.following = { dir, handle: null };
    cx.spawn(async (c) => {
      try {
        while (this.following === following && !this.closed) {
          following.handle = watchFolder(dir);
          const changes = await following.handle;
          if (!changes.length || this.following !== following || this.closed) break;
          this.queueReload(c);
        }
      } catch {
        // 监听失败时由标题检测计时器补一次读取，读完再尝试监听。
      } finally {
        if (this.following === following) this.following = null;
      }
    });
  }

  queueReload(cx) {
    if (this.pendingReload || this.closed) return;
    const pending = this.pendingReload = this.source;
    cx.timer.after(2000, (c) => {
      if (this.closed || this.pendingReload !== pending) return;
      this.pendingReload = null;
      if (this.busy) {
        this.queueReload(c); // 正在读就别叠着读，等这一轮读完再来
        return;
      }
      this.load(c, true);
    });
  }

  // 比较终端的标题和目录，而不是会话文件里的标题；文件标题可能为空或带不同前缀。
  checkTitle(cx) {
    const p = this.pane();
    const title = bare(p?.title);
    const cwd = p?.cwd ?? "";
    if (this.source?.title === title && this.source.cwd === cwd) return;
    this.source = { title, cwd };
    this.stopFollowing();
    this.pendingReload = null;
    this.file = "";
    this.title = "";
    this.size = 0;
    this.messages = [];
    this.marks = [];
    this.raw = [];
    this.sel = -1;
    this.align = [];
    this.histLines = null;
    this.alignTot = -1;
    this.note = "";
    this.loading = true;
    if (this.busy) cx.notify();
    else this.load(cx);
  }

  async jump(i, cx) {
    const p = this.pane();
    if (!p) return;
    const source = this.source;
    const h = await readHistory(this.term);
    if (this.closed || this.source !== source) return;
    if (!h) {
      this.note = pick("读不到终端历史", "Can't read the terminal history");
      cx.notify();
      return;
    }
    // 对位要遍历几千行，同一次打开里历史行数没变就直接复用上次的结果。
    const reuse = this.histLines === h.lines.length && this.align.length === this.messages.length;
    const al = reuse ? this.align : align(this.messages, h.lines);
    if (!reuse) {
      this.align = al;
      this.histLines = h.lines.length;
    }
    const idx = al[i] ?? -1;
    if (idx < 0) {
      this.note = `终端只留了最近 ${h.lines.length} 行，这条已经滚出去了`;
      cx.notify();
      return;
    }
    const total = p.scroll?.total ?? h.lines.length;
    const rows = p.scroll?.len || 39;
    const abs = total - h.lines.length + idx;
    // 锚点是 agent 输出的第一行，往上留一行让「这一轮」看起来从顶上开始。
    const target = Math.max(0, Math.min(Math.max(0, total - rows), abs - 1));
    if (p.pane) run("pane.focus", { pane: p.pane });
    run("terminal.scroll", { terminal: this.term, to: "top" });
    run("terminal.scroll", { terminal: this.term, lines: target });
    this.sel = i;
    this.note = "";
    cx.notify();
  }

  latest(cx) {
    run("terminal.scroll", { terminal: this.term, to: "bottom" });
    this.sel = this.messages.length - 1;
    cx.notify();
  }

  // 搜索只做一次性过滤：轮次最多几十条，每次渲染现算比维护索引省事也更快。
  // 回复和工具名也进索引——「只记得 agent 改过哪个文件」是最常见的找法。
  matches(i, q) {
    const m = this.messages[i];
    return `${m.text ?? ""} ${m.reply ?? ""} ${(m.tools || []).join(" ")}`.toLowerCase().includes(q);
  }

  visible() {
    const q = this.query.trim().toLowerCase();
    if (!q) return this.messages.map((_, i) => i);
    const out = [];
    for (let i = 0; i < this.messages.length; i += 1) if (this.matches(i, q)) out.push(i);
    return out;
  }

  // 列表自上而下是最新→最旧，所以 ↑ 是更新（下标 +1），↓ 是更旧。
  step(dir, cx) {
    if (!this.messages.length) return;
    const vis = this.visible();
    if (!vis.length) return;
    const at = vis.indexOf(this.sel);
    const next = at < 0 ? vis[vis.length - 1] : vis[Math.max(0, Math.min(vis.length - 1, at + dir))];
    if (next === this.sel) return;
    this.sel = next;
    this.expand = false;
    this.longText = false;
    cx.notify();
  }

  iconButton(t, id, art, action) {
    const on = this.over === id;
    return div()
      .id(id)
      .size(22)
      .flex()
      .items_center()
      .justify_center()
      .text_color(on ? ink(t, "ink", "foreground") : ink(t, "pencil", "muted"))
      .when(on, (el) =>
        PAPER(t) ? el.bg("#f8dc4c9e").rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9) : el.bg(t.hover).rounded(6))
      .on_hover((h, cx) => {
        this.over = h ? id : this.over === id ? null : this.over;
        cx.notify();
      })
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action(cx);
      })
      .child(svg(art).size(14));
  }

  row(t, m, i, cx) {
    const on = this.sel === i;
    const hasReply = Boolean(m.reply);
    const n = (m.tools || []).length;
    const text = flat(m.text).slice(0, 200) || pick("(空)", "(empty)");
    return div()
      .id(`hx-${m.id || i}`)
      .h(30)
      .flex_none()
      .flex()
      .items_center()
      .gap(8)
      .px(8)
      .when(on, (el) =>
        PAPER(t) ? el.bg("#f8dc4c8f").rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9) : el.bg(tint(t.accent, "1f")))
      .on_click((e, cx) => {
        cx.stop_propagation();
        this.sel = i;
        this.expand = false;
        this.longText = false;
        // 双击直接跳：选中一次之后最常见的动作就是跳到终端看上下文。
        if (e.click_count >= 2) {
          this.jump(i, cx);
          return;
        }
        cx.notify();
      })
      // 行首竖条：选中 = accent 实色，这轮 agent 有回复 = 绿条，还没回 = 不画（保持文字对齐）。
      .child(
        div()
          .flex_none()
          .w(3)
          .h(16)
          .rounded(2)
          .when(on, (s) => s.bg(t.accent))
          .when(!on && hasReply, (s) => s.bg(tint(t.done, "cc"))),
      )
      .child(
        div()
          .flex_none()
          .w(36)
          .text_size(FS.time)
          .font_weight(500)
          .text_color(on ? t.accent : t.dim)
          .child(hhmm(m.ts)),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(FS.row)
          .when(on, (el) => el.font_weight(600))
          .text_color(on ? ink(t, "ink", "foreground") : t.foreground)
          .child(text),
      )
      // 工具步数：列表上就能分出「随口一句」和「真动了一轮」。
      .when(n > 0, (el) =>
        el.child(
          div()
            .flex_none()
            .h(15)
            .px(4)
            .flex()
            .items_center()
            .rounded(4)
            .bg(tint(t.working, "26"))
            .text_size(FS.badge)
            .text_color(t.working)
            .child(`${n} 步`),
        ),
      )
      // 「这轮 agent 回话了」本身就是最常筛的条件，给它一个绿徽标。
      .when(hasReply, (el) =>
        el.child(
          div()
            .flex_none()
            .h(15)
            .px(4)
            .flex()
            .items_center()
            .rounded(4)
            .bg(tint(t.done, "26"))
            .text_size(FS.badge)
            .text_color(t.done)
            .child(pick("回复", "Reply")),
        ),
      )
      .child(
        div()
          .flex_none()
          .w(14)
          .flex()
          .items_center()
          .justify_center()
          // 还在终端保留区里的轮次给一个能点的箭头，点一下就是「跳到终端」；
          // 已经滚出去的只留一个暗点，点行本身看详情。
          .when(this.align[i] >= 0, (el) =>
            el
              .id(`hx-j-${i}`)
              .cursor_pointer()
              .text_size(12)
              .text_color(t.accent)
              .hover((h) => h.text_color(t.foreground))
              .tooltip(pick("跳到终端里的这一轮", "Jump to this turn in the terminal"))
              .accessibility_label(pick("跳到终端", "Jump to the terminal"))
              .on_click((e, c) => {
                c.stop_propagation();
                this.jump(i, c);
              })
              .child("→"),
          )
          .when(this.align[i] < 0, (el) => el.child(div().size(4).rounded_full().bg(t.idle)))
      );
  }

  // 上下文压缩点：不占轮次，只在列表里插一条分隔，说明「前面那些轮次已被压进摘要」。
  markRow(t, mk) {
    const wan = (n) => (n > 0 ? `${(n / 10000).toFixed(1)}万` : "");
    const bits = [];
    const b = wan(mk.before);
    const a = wan(mk.after);
    if (b || a) bits.push(`${b || "?"} → ${a || "?"} tokens`);
    if (mk.archived > 0) bits.push(`前 ${mk.archived} 轮已归档`);
    return h_flex()
      .h(24)
      .flex_none()
      .px(0)
      .gap(6)
      .items_center()
      .bg(tint(t.accent, "12"))
      .border_t(1)
      .border_color(tint(PAPER(t) ? t.rule : t.border, "b8"))
      // 左侧竖条和普通行的竖条同宽，压缩点整条读起来像一个「分节」。
      .child(div().flex_none().w(3).h_full().bg(tint(t.accent, "99")))
      .child(svg("mods/inkstone-chrome/archive.svg").size(12).flex_none().text_color(t.accent))
      .child(
        h_flex()
          .flex_none()
          .items_center()
          .gap(4)
          .child(div().flex_none().text_size(10.5).font_weight(700).text_color(t.accent).child(pick("上下文压缩", "Context compaction")))
          .when(bits.length > 0, (el) =>
            el.child(div().flex_none().text_size(10).text_color(t.muted).child(`· ${bits.join(" · ")}`)),
          ),
      )
      .child(div().flex_1())
      .child(div().flex_none().pr(8).text_size(10).text_color(t.dim).child(hhmm(mk.ts)));
  }

  copy(text, cx) {
    const body = String(text || "");
    if (!body) return;
    try {
      cx.write_to_clipboard(body);
      this.note = `已复制 ${body.length} 字`;
    } catch (e) {
      this.note = `复制失败：${e?.message ?? e}`;
    }
    cx.notify();
  }

  // 次要操作：描边小按钮，和实心主按钮区分开 —— 以前四个按钮是同一个灰度，认不出主次。
  textButton(t, id, label, action) {
    const paper = PAPER(t);
    return div()
      .id(id)
      .h(22)
      .px(8)
      .flex()
      .items_center()
      .rounded(6)
      .border(1)
      .border_color(paper ? tint(t.rule, "cc") : tint(t.border, "cc"))
      .text_size(11)
      .text_color(ink(t, "pencil", "muted"))
      .when(paper, (s) => s.hover((h) => h.bg("#f8dc4c4d")))
      .when(!paper, (s) =>
        s.hover((h) => h.bg(t.hover).border_color(t.accent).text_color(t.accent)),
      )
      .on_click((_e, c) => {
        c.stop_propagation();
        action(c);
      })
      .child(label);
  }

  // 点开一条：先给「我问的」，再给「这轮动了什么」，最后给「agent 怎么回的」。
  // 终端只留约 1000 行，旧轮次早就滚没了，这三段才是「看上下文」的全部来源。
  detail(t, m, i, cx) {
    const paper = PAPER(t);
    const can = this.align[i] >= 0;
    const text = m.text || pick("(空)", "(empty)");
    const reply = String(m.reply || "");
    const tools = m.tools || [];
    // 面板宽 460，12px 一行约 36 字；按真实的换行分段估高，短代码块不会被压成两行。
    const est = (s) => String(s).split("\n").reduce((n, seg) => n + Math.max(1, Math.ceil(seg.length / 36)), 0);
    // 长提问会把工具和回复挤出面板，默认只露三行，点「全文」再看全部。
    const held = est(text);
    const shown = this.longText ? held : Math.min(held, 3);
    const LH = 18;
    const h = Math.min(340, 36 + shown * LH + (held > 3 ? 18 : 0) + (tools.length ? 30 : 0) + (reply ? 26 + est(reply) * LH : 0));
    return v_flex()
      .flex_none()
      .h(h)
      .max_h(h)
      .border_t(1)
      .border_color(paper ? tint(t.rule, "b8") : t.border)
      .child(
        h_flex()
          .flex_none()
          .h(32)
          .px(10)
          .gap(6)
          .items_center()
          .child(div().flex_none().text_size(11).font_weight(700).text_color(t.foreground).child(hhmm(m.ts)))
          .child(
            div()
              .flex_none()
              .text_size(FS.sub)
              .text_color(can ? t.done : t.muted)
              .child(historyStatus(can, this.histLines)),
          )
          .child(div().flex_1())
          .child(this.textButton(t, "hx-read", pick("阅读", "Reader"), (c) => this.openRead(i, c)))
          .when(est(text) > 3, (el) =>
            el.child(
              this.textButton(t, "hx-more", this.longText ? pick("收起", "Collapse") : pick("全文", "Full text"), (c) => {
                this.longText = !this.longText;
                c.notify();
              }),
            ),
          )
          .child(this.textButton(t, "hx-copy-q", pick("复制原文", "Copy the original"), (c) => this.copy(text, c)))
          .when(reply !== "", (el) => el.child(this.textButton(t, "hx-copy-a", pick("复制回复", "Copy the reply"), (c) => this.copy(reply, c))))
          // 主操作实心 accent，放最右；其余四个是描边按钮，一眼分得出该点哪个。
          .when(can, (el) => el.child(primaryButton(t, "hx-jump", pick("跳到终端", "Jump to the terminal"), (c) => this.jump(i, c)))),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .w_full()
          .px(10)
          .pb(8)
          .gap(6)
          .overflow_y_scrollbar()
          .child(sectionLabel(t, pick("提问", "Prompt"), t.accent))
          .child(
            div()
              .w_full()
              .min_w(0)
              .text_size(FS.body)
              .line_height(`${LH}px`)
              .text_color(ink(t, "ink", "foreground"))
              .when(!this.longText, (s) => s.max_h(54).overflow_hidden())
              .child(text),
          )
          .when(tools.length > 0, (el) =>
            el.child(
              v_flex()
                .w_full()
                .min_w(0)
                .when(paper, (s) => s.border_t(1).border_color(tint(t.rule, "b8")))
                .pt(5)
                .gap(2)
                .child(
                  h_flex()
                    .w_full()
                    .gap(6)
                    .items_center()
                    .child(sectionLabel(t, `工具 ${tools.length} 步`, t.working))
                    .child(
                      div()
                        .flex_1()
                        .min_w(0)
                        .truncate()
                        .text_size(10.5)
                        .text_color(t.dim)
                        .when(!this.expand, (s) => s.child(tools.join(" · "))),
                    )
                    .child(
                      this.textButton(t, "hx-expand", this.expand ? pick("收起", "Collapse") : pick("展开", "Expand"), (c) => {
                        this.expand = !this.expand;
                        c.notify();
                      }),
                    ),
                )
                .when(this.expand, (s) =>
                  s.children(
                    tools.map((x, k) =>
                      h_flex()
                        .w_full()
                        .gap(6)
                        .child(div().flex_none().w(14).text_size(10).text_color(t.dim).child(String(k + 1)))
                        .child(div().flex_1().min_w(0).text_size(10.5).line_height("15px").text_color(t.dim).child(x)),
                    ),
                  ),
                ),
            ),
          )
          .when(reply !== "", (el) =>
            el.child(
              v_flex()
                .w_full()
                .min_w(0)
                .when(paper, (s) => s.border_t(1).border_color(tint(t.rule, "b8")))
                .pt(5)
                .gap(3)
                .child(sectionLabel(t, pick("回复", "Reply"), t.done))
                .child(
                  div()
                    .w_full()
                    .min_w(0)
                    .text_size(FS.body)
                    .line_height(`${LH}px`)
                    .text_color(ink(t, "ink", "foreground"))
                    .child(reply),
                ),
            ),
          ),
      );
  }

  // 面板只有 460 宽、详情形最高 320，长回复只看得到开头几行。把同一轮全文铺到一个窗口里。
  openRead(i, cx) {
    const m = this.messages[i];
    if (!m) return;
    const p = this.pane();
    const idx = this.align[i] ?? -1;
    // 对位结果已经在内存里，顺手把「这一轮在 scrollback 的第几行」也算好带过去，
    // 阅读窗口就不用为了点一次「跳到终端」再跑一遍 34 MB 的解析。
    let top = -1;
    const lines = this.histLines;
    if (idx >= 0 && lines !== null && lines > 0) {
      const total = p?.scroll?.total ?? lines;
      const rows = p?.scroll?.len || 39;
      const abs = total - lines + idx;
      top = Math.max(0, Math.min(Math.max(0, total - rows), abs - 1));
    }
    setShared("inkstone.history.read", {
      term: this.term,
      title: this.title || (p?.title ?? ""),
      ts: m.ts,
      text: m.text || "",
      reply: m.reply || "",
      tools: m.tools || [],
      can: idx >= 0,
      lines,
      top,
    });
    openOverlay({
      mod: "inkstone-history",
      kind: "window",
      key: "hist-read",
      frame: "none",
      // 阅读窗口按「一行 60–70 个汉字」定宽，再宽长句就找不到换行了。
      width: 0.62,
      height: 0.86,
      props: { mode: "read" },
    });
    this.note = "";
    cx.notify();
  }

  renderRead(cx) {
    const t = theme();
    const paper = PAPER(t);
    const r = this.read;
    if (!r) {
      return paperCard(
        this,
        t,
        v_flex().size_full().bg(t.paper ?? t.background).items_center().justify_center()
          .child(div().text_size(12).text_color(t.dim).child(pick("内容没有递过来，回面板再点一次", "The content didn't arrive; go back to the panel and click again"))),
      );
    }
    const text = r.text || pick("(空)", "(empty)");
    const reply = String(r.reply || "");
    const tools = r.tools || [];
    const para = (s, size = FS.readBody, lh = "22px") =>
      div().w_full().min_w(0).text_size(size).line_height(lh).text_color(ink(t, "ink", "foreground")).child(s);
    // 段落标签：色块区分「提问 / 回复 / 工具」，右边一条细线把这一节圈出来。
    const label = (s, color) =>
      h_flex().flex_none().w_full().items_center().gap(8)
        .child(sectionLabel(t, s, color, 11))
        .child(div().flex_1().h(1).bg(tint(paper ? t.rule : t.border, "b8")));
    const head = h_flex()
      .flex_none()
      .h(38)
      .px(12)
      .gap(8)
      .items_center()
      .border_b(1).border_color(tint(paper ? t.rule : t.border, "b8"))
      .child(svg("mods/inkstone-history/history.svg").size(15).flex_none().text_color(ink(t, "pencil", "muted")))
      .child(
        div()
          .flex_none()
          .text_size(FS.readTitle)
          .font_weight(700)
          .text_color(ink(t, "ink", "foreground"))
          .child(`${hhmm(r.ts)} 这一轮`),
      )
      .child(div().flex_1().min_w(0).truncate().text_size(FS.sub).text_color(t.muted).child(flat(String(text)).slice(0, 120)))
      .child(this.iconButton(t, "hx-r-close", "mods/inkstone-pane/close.svg", () => this.shut()));
    const foot = h_flex()
      .flex_none()
      .h(32)
      .px(10)
      .gap(6)
      .items_center()
      .border_t(1).border_color(tint(paper ? t.rule : t.border, "b8"))
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(FS.sub)
          .text_color(this.tip ? t.done : r.can ? t.muted : t.dim)
          .child(this.tip || historyStatus(r.can, r.lines, pick("打开阅读时尚未对齐", "Not aligned when the reader opened"))),
      )
      .child(this.textButton(t, "hx-r-copy-q", pick("复制原文", "Copy the original"), (c) => this.copy(text, c)))
      .when(reply !== "", (el) => el.child(this.textButton(t, "hx-r-copy-a", pick("复制回复", "Copy the reply"), (c) => this.copy(reply, c))))
      .when(r.can, (el) =>
        el.child(
          primaryButton(t, "hx-r-jump", pick("跳到终端", "Jump to the terminal"), (c) => {
            run("pane.focus", { terminal: r.term });
            run("terminal.scroll", { terminal: r.term, to: "top" });
            run("terminal.scroll", { terminal: r.term, lines: Math.max(0, r.top) });
            this.tip = pick("终端已滚到这一轮", "The terminal is scrolled to this turn");
            c.notify();
          }),
        ),
      );
    const inner = v_flex()
      .size_full()
      .min_h(0)
      .bg(t.paper ?? t.background)
      .overflow_hidden()
      .track_focus(this.handle)
      .on_key_down((e, c) => {
        if (String(e.key ?? "").toLowerCase() !== "escape") return;
        c.stop_propagation();
        this.shut();
      })
      .child(head)
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .w_full()
          .px(16)
          .py(12)
          .gap(8)
          .overflow_y_scrollbar()
          .mode("always")
          .track_scroll(this.scroll)
          .child(label(pick("提问", "Prompt"), t.accent))
          .child(para(text))
          .when(reply !== "", (el) => el.child(label(pick("回复", "Reply"), t.done)).child(para(reply, 13, "21px")))
          .when(tools.length > 0, (el) =>
            el.child(
              h_flex().flex_none().w_full().items_center().gap(8)
                .child(sectionLabel(t, `工具 ${tools.length} 步`, t.working, 11))
                .child(div().flex_1().h(1).bg(tint(paper ? t.rule : t.border, "b8")))
                .child(
                  this.textButton(t, "hx-r-tools", this.toolsOpen ? pick("收起", "Collapse") : pick("展开", "Expand"), (c) => {
                    this.toolsOpen = !this.toolsOpen;
                    c.notify();
                  }),
                ),
            )
              .when(!this.toolsOpen, (s) =>
                s.child(
                  div()
                    .w_full()
                    .min_w(0)
                    .truncate()
                    .text_size(FS.readMeta)
                    .text_color(t.muted)
                    .child(tools.join(" · ")),
                ),
              )
              .when(this.toolsOpen, (s) =>
                s.child(
                  div()
                    .w_full()
                    .min_w(0)
                    .text_size(FS.readMeta)
                    .line_height("18px")
                    .text_color(t.muted)
                    .child(tools.map((x, k) => `${k + 1}. ${x}`).join("\n")),
                ),
              ),
          ),
      )
      .child(foot);
    return paperCard(this, t, inner);
  }

  render(cx) {
    if (this.readMode) return this.renderRead(cx);
    const t = theme();
    const paper = PAPER(t);
    const p = this.pane();
    const vis = this.visible();
    const rows = [];
    // 最新在最上面。压缩点挂在「它之后第一轮」的位置上，倒序渲染时正好落在两轮之间；
    // at 已经到末尾的（最后一次压缩之后没有新发言）贴在最顶上。
    // marks 按文件顺序（旧→新），列表是最新在上，所以末尾这几条要倒着摆。
    for (let k = this.marks.length - 1; k >= 0; k -= 1) {
      const mk = this.marks[k];
      if (mk.at >= this.messages.length) rows.push(this.markRow(t, mk));
    }
    for (let k = vis.length - 1; k >= 0; k -= 1) {
      const i = vis[k];
      rows.push(this.row(t, this.messages[i], i, cx));
      // 同一位置可能连着几条压缩（隔几秒压两次），倒着放才是「新的在上」。
      for (let q = this.marks.length - 1; q >= 0; q -= 1) {
        if (this.marks[q].at === i) rows.push(this.markRow(t, this.marks[q]));
      }
    }
    const head = h_flex()
      .flex_none()
      .h(40)
      .px(10)
      .gap(8)
      .items_center()
      .border_b(1).border_color(tint(paper ? t.rule : t.border, "b8"))
      .child(svg("mods/inkstone-history/history.svg").size(15).flex_none().text_color(ink(t, "pencil", "muted")))
      .child(
        div()
          .flex_none()
          .text_size(FS.title)
          .font_weight(700)
          .text_color(ink(t, "ink", "foreground"))
          .child(pick("历史发言", "History")),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(FS.sub)
          .text_color(t.muted)
          .child(this.title || (p?.title ?? "")),
      )
      // 轮数常驻在头部；搜索时的命中数放在搜索框右侧，避免同一行里写两遍。
      .when(this.messages.length > 0, (el) => el.child(chip(t, `${this.messages.length} 轮`)))
      .child(this.iconButton(t, "hx-close", "mods/inkstone-pane/close.svg", () => this.shut()));

    // 搜索条只在有轮次时出现：会话还没解析完时点它也没东西可筛。
    const searchRow = h_flex()
      .h(32)
      .flex_none()
      .mx(8)
      .mt(6)
      .px(8)
      .gap(6)
      .items_center()
      .rounded(6)
      // zhi 的 input 槽是深灰（给终端里的输入框用），纸上应该用更浅的一层。
      .bg(paper ? (t.popover ?? t.surface) : t.input)
      .border(1)
      .border_color(this.typing ? t.accent : t.border)
      .cursor_text()
      .on_mouse_down("left", (_e, c) => c.stop_propagation())
      .child(svg("mods/inkstone-chrome/search.svg").size(12).flex_none().text_color(t.dim))
      .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground))
      .when(Boolean(this.query), (el) =>
        el.child(
          div()
            .id("hx-clear")
            .size(16)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(4)
            .text_size(11)
            .text_color(t.dim)
            .cursor_pointer()
            .tooltip(pick("清空搜索", "Clear the search"))
            .hover((h) => h.bg(t.hover).text_color(t.foreground))
            .on_click((_e, c) => {
              c.stop_propagation();
              this.query = "";
              this.input.set_value("");
              c.notify();
            })
            .child("✕"),
        ),
      );

    const foot = h_flex()
      .flex_none()
      .h(30)
      .px(10)
      .gap(8)
      .items_center()
      .border_t(1).border_color(tint(paper ? t.rule : t.border, "b8"))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(this.note ? t.blocked : t.dim).child(
        this.note ||
          (this.loading
            ? pick("读取…", "Reading…")
            : this.query.trim()
              ? `命中 ${vis.length} / ${this.messages.length} 条发言`
              : `${this.messages.length} 条发言`),
      ))
      .child(
        div()
          .id("hx-latest")
          .h(20)
          .px(8)
          .flex()
          .items_center()
          .text_size(11)
          .text_color(ink(t, "pencil", "muted"))
          .on_click((_e, c) => {
            c.stop_propagation();
            this.latest(c);
          })
          .child(pick("回到最新", "Back to the latest")),
      );

    const hint = (s) => div().px(12).py(12).text_size(FS.body).text_color(t.dim).child(s);
    const body = this.loading && !this.messages.length
      ? [hint(pick("读取会话…", "Reading the session…"))]
      : !this.messages.length
        ? [hint(this.note || pick("这个会话还没有发言", "This session has no turns yet"))]
        : this.query.trim() && !vis.length
          ? [hint(pick("没有匹配的发言", "No matching turns"))]
          : rows;

    const inner = v_flex()
      .size_full()
      .min_h(0)
      .bg(t.paper ?? t.background)
      .overflow_hidden()
      .track_focus(this.handle)
      // ↑↓ 走轮次、Enter 跳到终端、Esc 先清搜索再冒泡给浮层；
      // 焦点只在用户点过面板后落在这里（不自动抢终端的键盘）。
      .on_key_down((e, c) => {
        const k = String(e.key ?? "").toLowerCase();
        if (k === "escape") {
          if (this.typing || this.query) {
            this.query = "";
            this.input.set_value("");
            this.typing = false;
            this.handle.focus();
            c.stop_propagation();
            c.notify();
          }
          return;
        }
        if (this.typing) return;
        if (k === "arrowup" || k === "up") {
          c.stop_propagation();
          this.step(1, c);
          return;
        }
        if (k === "arrowdown" || k === "down") {
          c.stop_propagation();
          this.step(-1, c);
          return;
        }
        if (k === "enter" && this.sel >= 0) {
          c.stop_propagation();
          this.jump(this.sel, c);
          return;
        }
        // r = read：这一轮全文铺到一个窗口里（面板太窄，长回复在这里只能看到开头）。
        if (k === "r" && this.sel >= 0) {
          c.stop_propagation();
          this.openRead(this.sel, c);
        }
      })
      .child(head)
      .when(this.messages.length > 0, (el) => el.child(searchRow))
      .child(v_flex().flex_1().min_h(0).py(4).overflow_y_scrollbar().mode("always").track_scroll(this.scroll).children(body))
      .when(!this.loading && this.messages.length > 0 && this.sel >= 0, (el) =>
        el.child(this.detail(t, this.messages[this.sel], this.sel, cx)),
      )
      .child(foot);
    return paperCard(this, t, inner);
  }
}
