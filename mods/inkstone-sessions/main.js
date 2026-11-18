// 会话：把本机各编程助手的会话列出来，点一条在它原来的目录里恢复。
// 数据源（都不依赖 python，Windows 走 PowerShell，macOS/Linux 走 sh + awk）：
//   - OMP：~/.omp/agent/sessions/<编码目录>/<时间戳>_<uuid>.jsonl
//          第 1 行 {"type":"title","title":...}，第 2 行 {"type":"session","id","cwd","timestamp"}
//   - Codex CLI：~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl，第 1 行 type=session_meta，
//          字段在 payload.id / payload.cwd / payload.timestamp（该行含 base_instructions，约 19KB）
//   - Claude Code：~/.claude/projects/<slug>/<sessionId>.jsonl，行内带 sessionId / cwd / timestamp
//   - Pi：~/.pi/agent/sessions/*.jsonl，第 1 行 type=session（版本 3 起）
// 恢复命令：omp --resume <id> / codex resume <id> / claude --resume <id> / pi --resume <id>。
// 会话已经在某个终端里开着时不新起进程，直接切过去——新进程会把整段历史重渲染一遍。

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, run, theme, spaces, notify, terminals, window } from "herdr";

const MAX_PER = 30;
const SEP = "\u001f";
const plat = () => window()?.platform ?? "windows";

const SOURCES = {
  omp: { label: "OMP", dir: ".omp/agent/sessions", bin: "omp", argv: (id) => ["--resume", id] },
  codex: { label: "Codex", dir: ".codex/sessions", bin: "codex", argv: (id) => ["resume", id] },
  claude: { label: "Claude", dir: ".claude/projects", bin: "claude", argv: (id) => ["--resume", id] },
  pi: { label: "Pi", dir: ".pi/agent/sessions", bin: "pi", argv: (id) => ["--resume", id] },
};

const PS_SCAN = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$SEP = [string][char]31",
    "$rows = New-Object System.Collections.Generic.List[string]",
    "function Parse($line) { try { return ($line | ConvertFrom-Json) } catch { return $null } }",
    "function Scan($src, $root, $limit) {",
    "  if (-not (Test-Path -LiteralPath $root)) { return }",
    "  $files = Get-ChildItem -LiteralPath $root -Recurse -Filter *.jsonl -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First $limit",
    "  foreach ($f in $files) {",
    "      $id = ''; $ti = ''; $cwd = ''; $ts = ''; $fu = ''",
    "      $lines = Get-Content -LiteralPath $f.FullName -TotalCount 25 -Encoding UTF8 -ErrorAction SilentlyContinue",
    "      foreach ($ln in $lines) {",
    "        if (-not $ln) { continue }",
    "        $o = Parse $ln",
    "        if ($null -eq $o) { continue }",
    "        if (-not $id) {",
    "          if ($o.type -eq 'session' -and $o.id) { $id = [string]$o.id; $cwd = [string]$o.cwd; $ts = [string]$o.timestamp }",
    "          elseif ($o.type -eq 'session_meta' -and $o.payload.id) { $id = [string]$o.payload.id; $cwd = [string]$o.payload.cwd; $ts = [string]$o.payload.timestamp }",
    "          elseif ($o.sessionId) { $id = [string]$o.sessionId }",
    "        }",
    "        if (-not $cwd -and $o.cwd) { $cwd = [string]$o.cwd }",
    "        if ($o.type -eq 'title' -and $o.title) { $ti = [string]$o.title }",
    "        if ($o.type -eq 'title_change' -and $o.title) { $ti = [string]$o.title }",
    "        if ($o.type -eq 'custom-title' -and $o.customTitle) { $ti = [string]$o.customTitle }",
    "        if ($o.type -eq 'ai-title' -and $o.aiTitle) { $ti = [string]$o.aiTitle }",
    "        if (-not $fu) {",
    "          $txt = $null",
    "          if ($o.type -eq 'message' -and $o.message.role -eq 'user') { $c = @($o.message.content); if ($c.Count) { $txt = [string]$c[0].text } }",
    "          elseif ($o.type -eq 'response_item' -and $o.payload.role -eq 'user') { $c = @($o.payload.content); if ($c.Count) { $txt = [string]$c[0].text } }",
    "          elseif ($o.type -eq 'user' -and $o.message.role -eq 'user') { $c = @($o.message.content); if ($c.Count) { $txt = [string]$c[0].text } }",
    "          if ($txt) {",
    "            $t2 = ($txt -replace '\\s+', ' ').Trim()",
    "            if ($t2 -and -not $t2.StartsWith('<')) { $fu = $t2.Substring(0, [Math]::Min(80, $t2.Length)) }",
    "          }",
    "        }",
    "      }",
    "      if (-not $ti -and $fu) { $ti = $fu }",
    "      if ($id) {",
    "        $m = [int]([DateTimeOffset]$f.LastWriteTimeUtc).ToUnixTimeSeconds()",
    "        $rows.Add(@($src, $m, $id, $ti, $cwd) -join $SEP)",
    "      }",
    "    }",
    "}",
    `Scan 'omp' (Join-Path $env:USERPROFILE '${SOURCES.omp.dir}') ${MAX_PER}`,
    `Scan 'codex' (Join-Path $env:USERPROFILE '${SOURCES.codex.dir}') ${MAX_PER}`,
    `Scan 'claude' (Join-Path $env:USERPROFILE '${SOURCES.claude.dir}') ${MAX_PER}`,
    `Scan 'pi' (Join-Path $env:USERPROFILE '${SOURCES.pi.dir}') ${MAX_PER}`,
    "$rows | ForEach-Object { $_ }",
  ].join("\n"),
];

// 每条 JSON 首个出现的 id / cwd / 标题就够用了：取前 25 行，避免读大文件的整段历史。
const AWK = [
  'BEGIN { sep = sprintf("%c", 31); id = ""; cwd = ""; ti = ""; fu = "" }',
  '{',
  '  if (id == "" && match($0, /"id"[ \\t]*:[ \\t]*"[^"]*"/)) { s = substr($0, RSTART, RLENGTH); sub(/^[^:]*:[ \\t]*"/, "", s); sub(/"$/, "", s); if (s != "") id = s }',
  '  if (id == "" && match($0, /"sessionId"[ \\t]*:[ \\t]*"[^"]*"/)) { s = substr($0, RSTART, RLENGTH); sub(/^[^:]*:[ \\t]*"/, "", s); sub(/"$/, "", s); if (s != "") id = s }',
  '  if (cwd == "" && match($0, /"cwd"[ \\t]*:[ \\t]*"[^"]*"/)) { s = substr($0, RSTART, RLENGTH); sub(/^[^:]*:[ \\t]*"/, "", s); sub(/"$/, "", s); if (s != "") cwd = s }',
  '  if ($0 ~ /"type"[ \\t]*:[ \\t]*"(title|title_change|custom-title|ai-title)"/ && match($0, /"(title|customTitle|aiTitle)"[ \\t]*:[ \\t]*"[^"]*"/)) { s = substr($0, RSTART, RLENGTH); sub(/^[^:]*:[ \\t]*"/, "", s); sub(/"$/, "", s); if (s != "") ti = s }',
  '  if (fu == "" && $0 ~ /"role"[ \\t]*:[ \\t]*"user"/ && match($0, /"text"[ \\t]*:[ \\t]*"[^"]*"/)) { s = substr($0, RSTART, RLENGTH); sub(/^[^:]*:[ \\t]*"/, "", s); sub(/"$/, "", s); if (s != "" && substr(s, 1, 1) != "<") fu = substr(s, 1, 80) }',
  '}',
  'END { if (ti == "" && fu != "") ti = fu; if (id != "") printf "%s%s%s%s%s%s%s%s%s\\n", src, sep, m, sep, id, sep, ti, sep, cwd }',
].join("\n");

const SH_SCAN = [
  "SEP=$(printf '\\037')",
  "scan() {",
  "  src=$1; root=$2; lim=$3",
  '  [ -d "$root" ] || return 0',
  '  find "$root" -type f -name "*.jsonl" 2>/dev/null | while IFS= read -r f; do',
  '    m=$(stat -c %Y "$f" 2>/dev/null) || m=$(stat -f %m "$f" 2>/dev/null) || m=0',
  '    printf "%s\\t%s\\n" "$m" "$f"',
  '  done | sort -rn | head -n "$lim" | while IFS=$(printf "\\t") read -r m f; do',
  '    head -n 25 "$f" 2>/dev/null | awk -v src="$src" -v m="$m" -v sep="$SEP" "$AWK"',
  '  done',
  "}",
  `AWK='${AWK}'`,
  `scan omp "$HOME/${SOURCES.omp.dir}" ${MAX_PER}`,
  `scan codex "$HOME/${SOURCES.codex.dir}" ${MAX_PER}`,
  `scan claude "$HOME/${SOURCES.claude.dir}" ${MAX_PER}`,
  `scan pi "$HOME/${SOURCES.pi.dir}" ${MAX_PER}`,
].join("\n");

const ago = (sec) => {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (d < 60) return "刚刚";
  if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} 天前`;
  return new Date(sec * 1000).toLocaleDateString("zh-CN");
};
const base = (p) => String(p ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
const norm = (p) => String(p ?? "").replace(/[\\/]+$/, "").toLowerCase();

export default class Sessions extends View {
  init(_p, cx) {
    this.list = [];
    this.loading = true;
    this.failed = false;
    this.all = false;
    this.bins = {};
    this.detect();
    this.reload(cx);
    cx.timer.every(60000, (cx) => this.reload(cx));
  }

  // 各家的可执行文件位置：点会话时用它开终端。
  detect() {
    const p = plat();
    for (const [key, src] of Object.entries(SOURCES)) {
      const job = p === "windows"
        ? exec("where", [src.bin], { timeout: 5000 })
        : exec("sh", ["-c", `command -v ${src.bin}`], { timeout: 5000 });
      job
        .then((r) => {
          const line = String(r?.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
          if (line) this.bins[key] = line;
        })
        .catch(() => {});
    }
  }

  reload(cx) {
    const p = plat();
    const job = p === "windows"
      ? exec("powershell", PS_SCAN, { timeout: 25000 })
      : exec("sh", ["-c", SH_SCAN], { timeout: 25000 });
    job
      .then((r) => {
        if (r?.code !== 0) {
          this.failed = true;
          return;
        }
        this.list = String(r?.stdout ?? "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [src, m, id, t, cwd] = line.split(SEP);
            // PowerShell 走过 ConvertFrom-Json，反斜杠已还原；awk 是裸取 JSON 字面量，
            // 只剩 \\ 和 \" 两种转义需要还原（Windows 路径里 \n、\t 不是转义，别乱解）。
            const un = p === "windows" ? (s) => s : (s) => String(s ?? "").replace(/\\(["\\])/g, "$1");
            return { src, m: Number(m) || 0, id: un(id), t: un(t), cwd: un(cwd) };
          })
          .filter((x) => x.id && SOURCES[x.src])
          .sort((a, b) => b.m - a.m)
          .slice(0, MAX_PER * 2);
        this.failed = false;
      })
      .catch(() => {
        this.failed = true;
      })
      .finally(() => {
        this.loading = false;
        cx.notify();
      });
  }

  // 这个会话是不是已经开在某个终端里。各家都把会话标题写进了终端标题（OSC 0/2），
  // 所以按标题认；认出来就切过去，别再 resume 一遍——新进程会把整段历史重新渲染。
  live(s) {
    const head = String(s.t ?? "").trim().slice(0, 24);
    if (head.length < 4) return null;
    const cwd = norm(s.cwd);
    // 同一标题可能有几条记录（恢复过一次就会多一条），终端标题分不出新旧：
    // 只认最新的那条，别给旧记录也盖上「已打开」。
    const twins = this.list.filter((o) => norm(o.cwd) === cwd && String(o.t ?? "").trim().slice(0, 24) === head);
    if (twins.length > 1 && twins[0] !== s) return null;
    return terminals().find((x) => {
      if (!String(x.title ?? "").includes(head)) return false;
      return !cwd || !x.cwd || norm(x.cwd) === cwd;
    });
  }

  resume(s) {
    const up = this.live(s);
    if (up) {
      const labels = Array.isArray(up.labels)
        ? up.labels
        : Object.entries(up.labels ?? {}).map(([k, v]) => `${k}=${v}`);
      const label = (k) => {
        const hit = labels.find((l) => String(l).startsWith(`${k}=`));
        return hit ? String(hit).slice(k.length + 1) : null;
      };
      const space = label("herdr.space");
      const tab = label("herdr.tab");
      if (space && !spaces().find((z) => z.id === space)?.active) run("space.select", { id: space });
      if (tab) run("tab.select", { id: tab });
      if (up.address) run("pane.focus", { terminal: up.address });
      notify({ title: "会话已经开着", body: "切过去，不重新加载历史", level: "info" });
      return;
    }
    const src = SOURCES[s.src];
    const bin = this.bins[s.src] ?? src.bin;
    const args = { argv: [bin, ...src.argv(s.id)], place: "tab" };
    if (s.cwd) args.folder = s.cwd;
    run("terminal.open", args);
    notify({ title: `正在恢复 ${src.label} 会话`, body: s.t || s.id, level: "info" });
  }

  shown() {
    const all = this.list;
    if (this.all) return all;
    const here = norm(spaces().find((s) => s.active)?.folder);
    if (!here) return all;
    const hit = all.filter((s) => {
      const c = norm(s.cwd);
      return c && (c === here || c.startsWith(here + "\\") || c.startsWith(here + "/"));
    });
    return hit.length ? hit : all;
  }

  row(s, i, t) {
    const src = SOURCES[s.src];
    return h_flex()
      .id(`ses-${i}`)
      .h(44)
      .flex_none()
      .px(8)
      .gap(8)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((h) => h.bg(t.hover))
      .tooltip(this.live(s)
        ? `${s.cwd || "?"}\n这个会话正开着：点一下切过去，不重新加载`
        : `${s.cwd || "?"}\n点一下：${src.bin} ${src.argv(s.id).join(" ")}`)
      .on_click(() => this.resume(s))
      .child(div().w(38).flex_none().flex().items_center().justify_center().rounded(5).h(18).bg(t.raised)
        .child(div().text_size(9).text_color(s.src === "omp" ? t.accent : t.muted).child(src.label)))
      .child(v_flex()
        .flex_1()
        .min_w(0)
        .gap(0)
        .child(div().w_full().truncate().text_size(12).child(s.t || base(s.cwd) || String(s.id).slice(0, 8)))
        .child(div().w_full().truncate().text_size(11).text_color(t.dim).tooltip(s.cwd || "")
          .child(`${ago(s.m)} · ${base(s.cwd) || "?"} · ${String(s.id).slice(0, 6)}`)))
      .when(this.live(s), (el) => el.child(div()
        .flex_none()
        .px(5)
        .py(1)
        .rounded(4)
        .bg(t.raised)
        .text_size(9)
        .text_color(t.done)
        .child("已打开")));
  }

  render(_cx) {
    const t = theme();
    const list = this.shown();
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .child(h_flex()
        .h(34)
        .flex_none()
        .px(12)
        .gap(7)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(svg("mods/inkstone-chrome/terminal.svg").size(13).flex_none().text_color(t.accent))
        .child(div().text_size(12).font_semibold().child("会话"))
        .child(div().text_size(11).text_color(t.dim).child(String(list.length)))
        .child(div().flex_1())
        .child(h_flex()
          .id("ses-scope")
          .px(7)
          .py(3)
          .rounded(5)
          .text_size(11)
          .text_color(this.all ? t.muted : t.accent)
          .cursor_pointer()
          .tooltip(this.all ? "现在显示全部会话，点一下只看当前目录" : "只看当前空间的目录，点一下显示全部")
          .accessibility_label("切换会话范围")
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            this.all = !this.all;
            cx.notify();
          })
          .child(this.all ? "全部" : "当前目录"))
        .child(div()
          .id("ses-reload")
          .px(6)
          .py(2)
          .rounded(5)
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .tooltip("重新扫描")
          .accessibility_label("重新扫描会话")
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.reload(cx))
          .child("刷新")))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .px(6)
        .py(6)
        .gap(1)
        .overflow_y_scrollbar()
        .children(list.length
          ? list.map((s, i) => this.row(s, i, t))
          : [div().p(8).text_size(12).text_color(this.failed ? t.blocked : t.dim)
            .child(this.failed
              ? "读取会话失败：找不到 OMP / Codex / Claude / Pi 的会话目录。"
              : this.loading ? "正在扫描会话…" : "这个目录还没有会话记录。")]));
  }
}
