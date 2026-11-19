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
import { panes, props, run, exec, hc, theme, themes, home, checking, shared, writeTextFile, closeOverlay, openOverlay, setShared, watchFolder } from "herdr";

const PAPER = (t) => Boolean(t.paper);
const ink = (t, slot, fallback) => (PAPER(t) ? t[slot] : (t[fallback] ?? t.foreground));
const tint = (hex, a) => (typeof hex === "string" && hex.length === 7 ? hex + a : hex);
const EDGE_T = 12, EDGE_LONG = 3206, EDGE_TALL = 1794, EDGE_CORNER = 46, EDGE_FOOT = 40;
const EDGE_PRESETS = [
  { bg: "#e8f0ec", muted: "#5f6b67", dir: "ink-qingci" },
  { bg: "#f7f4ed", muted: "#746b5e", dir: "ink-xuanzhi" },
  { bg: "#14131a", muted: "#8b8597", dir: "ink-xuanmo" },
];
let edgeCacheKey = "";
let edgeCacheDir = null;
function artEdgeDir(t) {
  if (t.paper) return "ink";
  const key = t.background ?? "";
  if (key !== edgeCacheKey) {
    edgeCacheKey = key;
    const p = EDGE_PRESETS.find((x) => x.bg === key);
    if (!p) { edgeCacheDir = null; return null; }
    const cur = themes().find((x) => x.colors?.background === key);
    edgeCacheDir = cur?.colors?.muted === p.muted ? p.dir : null;
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

// 去掉开头的状态符号（π、⠧、图标字体私用区字符），留下标题本身。
const bare = (s) => String(s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function hhmm(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

// 读整个会话文件，返回 { items, seen }；seen 是文件字节数，用来判断有没有新内容。
// items 按文件顺序混放两类记录：{k:"m"} 是 user/assistant 消息，{k:"c"} 是上下文压缩点。
// 压缩点在 PowerShell 侧同一次扫描里顺手取出（只多一次 Contains 判断），不多起进程。
// 不走 readTextFile：21 MB 的字符串过一遍 IPC 要十几秒，面板会一直停在「读取…」。
// PowerShell 侧用 StreamReader 逐行读（21 MB / 4537 行约 400ms）；
// 预筛只放行含 user / assistant 的行——toolResult 动辄几十 KB 却一个字都用不上，
// 之前把它们也送进 ConvertFrom-Json 是白花的大头。
async function readMessages(file) {
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
    `elseif ($c.type -eq 'image') { if ($s) { $s += ' ' }; $s += '[图片]' } }; ` +
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
      const o = JSON.parse(line);
      if (o.k === "c") {
        items.push({
          k: "c",
          ts: String(o.ts ?? ""),
          text: String(o.text ?? ""),
          before: Number(o.before) || 0,
          after: Number(o.after) || 0,
          first: String(o.first ?? ""),
        });
        continue;
      }
      const tt = o.tools;
      const tools = (Array.isArray(tt) ? tt : tt ? [tt] : []).map(flat).filter(Boolean);
      items.push({
        k: "m",
        id: String(o.id ?? ""),
        ts: String(o.ts ?? ""),
        role: String(o.role ?? ""),
        text: String(o.text ?? ""),
        tools,
      });
    } catch {
      /* 正写到一半的行 */
    }
  }
  return { items, seen };
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
    this.histLines = 0;
    this.alignedLines = -1;
    this.busy = false;
    this.loading = true;
    this.note = "";
    this.over = null;
    this.expand = false; // 工具脉络默认折叠
    this.longText = false; // 原文超过三行先折起来，让工具和回复也露出来
    this.query = "";
    this.typing = false;
    this.closed = false; // 面板关掉后要停掉目录监听
    this.following = false;
    this.pendingReload = false;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "搜索提问、回复或工具…" });
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
    this.load(cx);
    // 会话文件是目录事件驱动的（见 follow），这里只兜「标题变了 = 换了会话」，
    // 纯内存比较，不起进程。
    cx.timer.every(15000, (c) => this.checkTitle(c));
  }

  // 关掉自己，并让窗格头按钮回到未开状态。
  shut() {
    this.closed = true;
    this.release();
    closeOverlay(this.oid);
  }

  // 被别的方式关掉（Esc、切布局、命令行 overlay.close）时也走这里，
  // 否则窗格头按钮会一直以为自己还开着，第一次点变成「关一个不存在的窗口」。
  async close() {
    this.closed = true;
    this.release();
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

  async load(cx, silent = false) {
    if (this.busy) return; // 目录事件和标题变化都可能同时调进来
    this.busy = true;
    if (!silent) {
      this.loading = true;
      this.note = "";
      cx.notify();
    }
    try {
      const p = this.pane();
      const found = p ? await findSession(p.title, p.cwd) : null;
      if (!found) {
        this.messages = [];
        this.marks = [];
        this.raw = [];
        this.align = [];
        this.histLines = 0;
        this.note = "没找到这个会话的记录";
        return;
      }
      this.file = found.file;
      this.size = found.size;
      this.title = found.title;
      const got = await readMessages(found.file);
      if (!got) throw new Error("会话文件读不出来");
      this.raw = got.items;
      // 轮次只在末尾追加，按 id 找回上一次选中的那条，否则每来一条新消息都把选择踢回最新。
      const was = this.sel >= 0 ? this.messages[this.sel] : null;
      const rr = rounds(this.raw);
      this.messages = rr.rounds;
      this.marks = rr.marks;
      const at = was ? this.messages.findIndex((m) => m.id === was.id) : -1;
      this.sel = at >= 0 ? at : this.messages.length - 1;
      // 先把列表放出去：解析完就画，对位（读 20000 行 + 从下往上匹配）留到后面补。
      // 轮次只往后追加，所以上一次的对位仍然有效：沿用前缀、末尾补 -1，
      // 否则每来一条新消息（活跃会话每几秒一次静默刷新）右侧的箭头就全被抹成暗点。
      const prevAlign = this.align;
      this.align = prevAlign.slice(0, this.messages.length);
      while (this.align.length < this.messages.length) this.align.push(-1);
      this.loading = false;
      cx.notify();
      if (!was) this.scroll.scroll_to_item(0); // 只在首次打开时跳到最新一条，别把用户滚到的位置拽回去
      this.follow(cx);
      // 能不能跳回终端要对着终端现有的几千行算，算完给列表右侧的箭头用。
      await this.syncAlign(cx);
    } catch (e) {
      // 读文件/读终端任何一步失手都要把 loading 收掉，否则面板会一直停在「读取会话…」。
      this.note = `读取失败：${e?.message ?? e}`;
    } finally {
      this.busy = false;
      this.loading = false;
      cx.notify();
    }
  }

  // 对位：哪一轮还在终端的保留区里、在第几行。强制读新（maxAge = 0），
  // 因为刚换了会话/刚滚过终端，缓存很可能已经不对。
  async syncAlign(cx) {
    const h = await readHistory(this.term, 0);
    this.histLines = h ? h.lines.length : 0;
    this.alignedLines = h ? h.lines.length : -1;
    this.align = h ? align(this.messages, h.lines) : [];
    cx.notify();
  }

  // 以前是每 5 秒起一个 PowerShell 问「文件长了没有」——一次进程 1.4–1.9s，白烧。
  // 现在监听会话目录：有写入才重载，并且 2 秒去抖（OMP 每写一行一条事件）。
  // 空闲时 0 次进程；对话过程中最多 1 次 / 2 秒。
  follow(cx) {
    if (this.following || !this.file) return;
    this.following = true;
    cx.spawn(async (c) => {
      try {
        while (!this.closed && this.file) {
          const dir = this.file.replace(/[\\/][^\\/]+$/, "");
          await watchFolder(dir);
          if (this.closed) break;
          this.queueReload(c);
        }
      } catch {
        this.following = false;
        this.note = "会话目录无法监听，切回终端后重新打开本面板";
        c.notify();
      }
    });
  }

  queueReload(cx) {
    if (this.pendingReload || this.closed) return;
    this.pendingReload = true;
    cx.timer.after(2000, (c) => {
      this.pendingReload = false;
      if (this.closed) return;
      if (this.busy) {
        this.queueReload(c); // 正在读就别叠着读，等这一轮读完再来
        return;
      }
      this.load(c, true);
    });
  }

  // 标题变了说明换了会话（或同一会话换了任务名）。会话首行没有 title 时别拿空串去比，
  // 否则每 15 秒重载一次。
  checkTitle(cx) {
    const p = this.pane();
    if (!p || !this.title) return;
    if (bare(p.title) !== this.title) this.load(cx, this.messages.length > 0);
  }

  async jump(i, cx) {
    const p = this.pane();
    if (!p) return;
    const h = await readHistory(this.term);
    if (!h) {
      this.note = "读不到终端历史";
      cx.notify();
      return;
    }
    // 对位要遍历几千行，同一次打开里历史行数没变就直接复用上次的结果。
    const reuse = this.alignedLines === h.lines.length && this.align.length === this.messages.length;
    const al = reuse ? this.align : align(this.messages, h.lines);
    if (!reuse) {
      this.align = al;
      this.alignedLines = h.lines.length;
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
    const text = flat(m.text).slice(0, 200) || "(空)";
    return div()
      .id(`hx-${m.id || i}`)
      .h(28)
      .flex_none()
      .flex()
      .items_center()
      .gap(8)
      .px(10)
      .when(on, (el) =>
        PAPER(t) ? el.bg("#f8dc4c8f").rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9) : el.bg(t.selected))
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
      .child(div().flex_none().w(40).text_size(11).text_color(t.dim).child(hhmm(m.ts)))
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(12)
          .text_color(on ? ink(t, "ink", "foreground") : t.foreground)
          .child(text),
      )
      // 工具步数：列表上就能分出「随口一句」和「真动了一轮」。
      .when((m.tools || []).length > 0, (el) =>
        el.child(div().flex_none().text_size(10).text_color(t.dim).child(`${m.tools.length} 步`)),
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
              .text_size(11)
              .text_color(t.dim)
              .hover((h) => h.text_color(t.accent))
              .tooltip("跳到终端里的这一轮")
              .accessibility_label("跳到终端")
              .on_click((e, c) => {
                c.stop_propagation();
                this.jump(i, c);
              })
              .child("→"),
          )
          .when(this.align[i] < 0, (el) => el.child(div().size(4).rounded_full().bg(t.dim))),
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
      .h(22)
      .flex_none()
      .px(10)
      .gap(6)
      .items_center()
      .border_t(1)
      .border_color(tint(PAPER(t) ? t.rule : t.border, "b8"))
      .child(svg("mods/inkstone-chrome/archive.svg").size(12).flex_none().text_color(t.dim))
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(10.5)
          .text_color(t.dim)
          .child(bits.length ? `上下文压缩 · ${bits.join(" · ")}` : "上下文压缩"),
      )
      .child(div().flex_none().text_size(10).text_color(t.dim).child(hhmm(mk.ts)));
  }

  // 复制走临时文件：exec 没有 stdin，中文直接拼进命令行会被引号和代码页吃掉。
  async copy(text, cx) {
    const body = String(text || "");
    if (!body) return;
    const tmp = `${home()}\\.herdr-history-copy.txt`;
    try {
      await writeTextFile(tmp, body, null);
      await exec(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `${PS}Set-Clipboard -Value (Get-Content -LiteralPath '${sq(tmp)}' -Raw -Encoding UTF8)`,
        ],
        { timeout: 15000 },
      );
      this.note = `已复制 ${body.length} 字`;
    } catch (e) {
      this.note = `复制失败：${e?.message ?? e}`;
    }
    cx.notify();
  }

  // 小文字按钮：复制、展开这类，跟 22px 的图标按钮分开。
  textButton(t, id, label, action) {
    const paper = PAPER(t);
    return div()
      .id(id)
      .h(20)
      .px(8)
      .flex()
      .items_center()
      .text_size(11)
      .text_color(ink(t, "pencil", "muted"))
      .when(paper, (s) => s.hover((h) => h.bg("#f8dc4c4d")).rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9))
      .when(!paper, (s) => s.hover((h) => h.bg(t.hover)).rounded(6))
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
    const text = m.text || "(空)";
    const reply = String(m.reply || "");
    const tools = m.tools || [];
    // 面板宽 460，11.5px 一行约 38 字；按真实的换行分段估高，短代码块不会被压成两行。
    const est = (s) => String(s).split("\n").reduce((n, seg) => n + Math.max(1, Math.ceil(seg.length / 38)), 0);
    // 长提问会把工具和回复挤出面板，默认只露三行，点「全文」再看全部。
    const held = est(text);
    const shown = this.longText ? held : Math.min(held, 3);
    const h = Math.min(320, 34 + shown * 17 + (held > 3 ? 16 : 0) + (tools.length ? 26 : 0) + (reply ? 24 + est(reply) * 17 : 0));
    return v_flex()
      .flex_none()
      .h(h)
      .max_h(h)
      .border_t(1)
      .border_color(paper ? tint(t.rule, "b8") : t.border)
      .child(
        h_flex()
          .flex_none()
          .h(30)
          .px(10)
          .gap(6)
          .items_center()
          .child(div().flex_none().text_size(11).text_color(t.dim).child(hhmm(m.ts)))
          .child(
            div()
              .flex_none()
              .text_size(10.5)
              .text_color(t.dim)
              .child(can ? "这一轮还在终端里" : `已滚出终端（仅留 ${this.histLines} 行）`),
          )
          .child(div().flex_1())
          .child(this.textButton(t, "hx-read", "阅读", (c) => this.openRead(i, c)))
          .when(est(text) > 3, (el) =>
            el.child(
              this.textButton(t, "hx-more", this.longText ? "收起" : "全文", (c) => {
                this.longText = !this.longText;
                c.notify();
              }),
            ),
          )
          .when(can, (el) => el.child(this.textButton(t, "hx-jump", "跳到终端", (c) => this.jump(i, c))))
          .child(this.textButton(t, "hx-copy-q", "复制原文", (c) => this.copy(text, c)))
          .when(reply !== "", (el) => el.child(this.textButton(t, "hx-copy-a", "复制回复", (c) => this.copy(reply, c)))),
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
          .child(
            div()
              .w_full()
              .min_w(0)
              .text_size(11.5)
              .line_height("17px")
              .text_color(ink(t, "ink", "foreground"))
              .when(!this.longText, (s) => s.max_h(51).overflow_hidden())
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
                    .child(div().flex_none().text_size(10.5).text_color(t.dim).child(`工具 ${tools.length} 步`))
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
                      this.textButton(t, "hx-expand", this.expand ? "收起" : "展开", (c) => {
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
                .child(div().flex_none().text_size(10.5).text_color(t.dim).child("回复"))
                .child(
                  div()
                    .w_full()
                    .min_w(0)
                    .text_size(11.5)
                    .line_height("17px")
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
    if (idx >= 0 && this.alignedLines > 0) {
      const total = p?.scroll?.total ?? this.alignedLines;
      const rows = p?.scroll?.len || 39;
      const abs = total - this.alignedLines + idx;
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
      lines: this.alignedLines,
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
          .child(div().text_size(12).text_color(t.dim).child("内容没有递过来，回面板再点一次")),
      );
    }
    const text = r.text || "(空)";
    const reply = String(r.reply || "");
    const tools = r.tools || [];
    const para = (s) =>
      div().w_full().min_w(0).text_size(13).line_height("21px").text_color(ink(t, "ink", "foreground")).child(s);
    const label = (s) =>
      h_flex().flex_none().w_full().items_center().gap(8)
        .child(div().flex_none().text_size(10.5).font_weight(700).text_color(t.dim).child(s))
        .child(div().flex_1().h(1).bg(tint(paper ? t.rule : t.border, "b8")));
    const head = h_flex()
      .flex_none()
      .h(34)
      .px(12)
      .gap(8)
      .items_center()
      .border_b(1).border_color(tint(paper ? t.rule : t.border, "b8"))
      .child(svg("mods/inkstone-history/history.svg").size(15).flex_none().text_color(ink(t, "pencil", "muted")))
      .child(div().flex_none().text_size(12.5).font_weight(700).text_color(ink(t, "ink", "foreground")).child(`${hhmm(r.ts)} 这一轮`))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(flat(String(text)).slice(0, 120)))
      .child(this.iconButton(t, "hx-r-close", "mods/inkstone-pane/close.svg", () => this.shut()));
    const foot = h_flex()
      .flex_none()
      .h(32)
      .px(10)
      .gap(6)
      .items_center()
      .border_t(1).border_color(tint(paper ? t.rule : t.border, "b8"))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.tip || (r.can ? "这一轮还在终端里" : `已滚出终端（仅留 ${r.lines} 行）`)))
      .when(r.can, (el) =>
        el.child(
          this.textButton(t, "hx-r-jump", "跳到终端", (c) => {
            run("pane.focus", { terminal: r.term });
            run("terminal.scroll", { terminal: r.term, to: "top" });
            run("terminal.scroll", { terminal: r.term, lines: Math.max(0, r.top) });
            this.tip = "终端已滚到这一轮";
            c.notify();
          }),
        ),
      )
      .child(this.textButton(t, "hx-r-copy-q", "复制原文", (c) => this.copy(text, c)))
      .when(reply !== "", (el) => el.child(this.textButton(t, "hx-r-copy-a", "复制回复", (c) => this.copy(reply, c))));
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
          .child(label("提问"))
          .child(para(text))
          .when(reply !== "", (el) => el.child(label("回复")).child(para(reply)))
          .when(tools.length > 0, (el) =>
            el.child(
              h_flex().flex_none().w_full().items_center().gap(8)
                .child(div().flex_none().text_size(10.5).font_weight(700).text_color(t.dim).child(`工具 ${tools.length} 步`))
                .child(div().flex_1().h(1).bg(tint(paper ? t.rule : t.border, "b8")))
                .child(
                  this.textButton(t, "hx-r-tools", this.toolsOpen ? "收起" : "展开", (c) => {
                    this.toolsOpen = !this.toolsOpen;
                    c.notify();
                  }),
                ),
            )
              .when(!this.toolsOpen, (s) =>
                s.child(div().w_full().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(tools.join(" · "))),
              )
              .when(this.toolsOpen, (s) =>
                s.child(div().w_full().min_w(0).text_size(11.5).line_height("18px").text_color(t.dim).child(tools.map((x, k) => `${k + 1}. ${x}`).join("\n"))),
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
      .h(34)
      .px(10)
      .gap(8)
      .items_center()
      .border_b(1).border_color(tint(paper ? t.rule : t.border, "b8"))
      .child(svg("mods/inkstone-history/history.svg").size(15).flex_none().text_color(ink(t, "pencil", "muted")))
      .child(div().flex_none().text_size(12.5).font_weight(700).text_color(ink(t, "ink", "foreground")).child("历史发言"))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.title || (p?.title ?? "")))
      .child(this.iconButton(t, "hx-close", "mods/inkstone-pane/close.svg", () => this.shut()));

    // 搜索条只在有轮次时出现：会话还没解析完时点它也没东西可筛。
    const searchRow = h_flex()
      .h(30)
      .flex_none()
      .mx(8)
      .mt(6)
      .px(8)
      .gap(6)
      .items_center()
      .rounded(6)
      .bg(t.background)
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
            .tooltip("清空搜索")
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
            ? "读取…"
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
          .child("回到最新"),
      );

    const body = this.loading && !this.messages.length
      ? [div().px(12).py(12).text_size(12).text_color(t.dim).child("读取会话…")]
      : this.messages.length
        ? rows.length
          ? rows
          : [div().px(12).py(12).text_size(12).text_color(t.dim).child("没有匹配的发言")]
        : [div().px(12).py(12).text_size(12).text_color(t.dim).child(this.note || "这个会话还没有发言")];

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
