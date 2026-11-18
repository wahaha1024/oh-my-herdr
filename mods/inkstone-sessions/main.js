// 会话：把本机各编程助手的会话列出来，点一条在它原来的目录里恢复。
// 数据源（不依赖 Python；Windows 走 PowerShell，macOS/Linux 走 sh + awk）：
//   - OMP：~/.omp/agent/sessions/<编码目录>/<时间戳>_<uuid>.jsonl
//   - Codex CLI：~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl（首行 type=session_meta）
//   - Claude Code：~/.claude/projects/<slug>/<sessionId>.jsonl
//   - Pi：~/.pi/agent/sessions/*.jsonl（首行 type=session）
//   - 本地归档：<当前空间>/.herdr/conversations/*.jsonl|*.json
//   - OpenCode（可选）：仅在本机已有 sqlite3 与 opencode.db 时只读查询
// 恢复命令：omp --resume <id> / codex resume <id> / claude --resume <id> / pi --session <id> / opencode --session <id>。
// 会话已经在某个终端里开着时不新起进程，直接切过去——新进程会把整段历史重渲染一遍。

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { exec, run, theme, spaces, panes, notify, terminals, window, checking } from "herdr";

const MAX_PER = 30;
const MAX_CODEX = 50;
const SEP = "\u001f";
const plat = () => window()?.platform ?? "windows";

const SOURCES = {
  omp: { label: "OMP", dir: ".omp/agent/sessions", bin: "omp", argv: (id) => ["--resume", id] },
  codex: { label: "Codex", dir: ".codex/sessions", bin: "codex", argv: (id) => ["resume", id] },
  claude: { label: "Claude", dir: ".claude/projects", bin: "claude", argv: (id) => ["--resume", id] },
  pi: { label: "Pi", dir: ".pi/agent/sessions", bin: "pi", argv: (id) => ["--session", id] },
  opencode: { label: "OpenCode", bin: "opencode", argv: (id) => ["--session", id] },
  local: { label: "本地", bin: null, argv: null },
};

const SOURCE_ORDER = ["omp", "codex", "claude", "pi", "opencode", "local"];

function buildPsScan(target) {
  const esc = String(target ?? "").replace(/['‘’‚‛]/g, "$&$&");
  const body = [
    "param([string]$target)",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$SEP = [string][char]31",
    "$seen = @{}",
    "$rows = New-Object System.Collections.Generic.List[string]",
    "function Parse($line) { try { return ($line | ConvertFrom-Json) } catch { return $null } }",
    "function ReadHeadTail($path, $len) {",
    "  $list = New-Object System.Collections.Generic.List[string]",
    "  try {",
    "    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)",
    "    try {",
    "      $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8, $true)",
    "      for ($i = 0; $i -lt 25 -and -not $sr.EndOfStream; $i++) {",
    "        $ln = $sr.ReadLine()",
    "        if ($ln) { $list.Add($ln) }",
    "      }",
    "      if ($len -gt 65536 -and -not $sr.EndOfStream) {",
    "        $tailBytes = [Math]::Min(65536, [int]$len)",
    "        $fs.Seek(-$tailBytes, [System.IO.SeekOrigin]::End) | Out-Null",
    "        $buf = New-Object byte[] $tailBytes",
    "        $read = $fs.Read($buf, 0, $tailBytes)",
    "        if ($read -gt 0) {",
    "          $txt = [System.Text.Encoding]::UTF8.GetString($buf, 0, $read)",
    "          $parts = $txt -split '\\r?\\n'",
    "          $start = if ($tailBytes -lt $len) { 1 } else { 0 }",
    "          for ($j = $start; $j -lt $parts.Length; $j++) {",
    "            if ($parts[$j]) { $list.Add($parts[$j]) }",
    "          }",
    "        }",
    "      } elseif (-not $sr.EndOfStream) {",
    "        while (-not $sr.EndOfStream) {",
    "          $ln = $sr.ReadLine()",
    "          if ($ln) { $list.Add($ln) }",
    "        }",
    "      }",
    "    } finally { $fs.Dispose() }",
    "  } catch {}",
    "  return $list",
    "}",
    "function ReadJsonl($src, $f) {",
    "  if ($seen.ContainsKey($f.FullName)) { return }",
    "  $seen[$f.FullName] = $true",
    "  $id = ''; $ti = ''; $cwd = ''; $fu = ''",
    "  $lines = ReadHeadTail $f.FullName $f.Length",
    "  foreach ($ln in $lines) {",
    "    if (-not $ln) { continue }",
    "    if ($ln.Length -gt 131072) {",
    "      $sub = $ln.Substring(0, 4096) + ' ' + $ln.Substring($ln.Length - 4096)",
    "      if (-not $id -and $sub -match '\"id\"\\s*:\\s*\"([^\"]+)\"') { $id = $matches[1] }",
    "      if (-not $cwd -and $sub -match '\"cwd\"\\s*:\\s*\"([^\"]+)\"') { $cwd = $matches[1].Replace('\\\\', '\\') }",
    "      continue",
    "    }",
    "    $o = Parse $ln",
    "    if ($null -eq $o) { continue }",
    "    if (-not $id) {",
    "      if ($o.type -eq 'session' -and $o.id) { $id = [string]$o.id; $cwd = [string]$o.cwd }",
    "      elseif ($o.type -eq 'session_meta' -and $o.payload.id) { $id = [string]$o.payload.id; $cwd = [string]$o.payload.cwd }",
    "      elseif ($o.sessionId) { $id = [string]$o.sessionId }",
    "      elseif ($o.id) { $id = [string]$o.id }",
    "    }",
    "    if (-not $cwd -and $o.cwd) { $cwd = [string]$o.cwd }",
    "    if ($o.type -eq 'title' -and $o.title) { $ti = [string]$o.title }",
    "    elseif ($o.type -eq 'title_change' -and $o.title) { $ti = [string]$o.title }",
    "    elseif ($o.type -eq 'custom-title' -and $o.customTitle) { $ti = [string]$o.customTitle }",
    "    elseif ($o.type -eq 'ai-title' -and $o.aiTitle) { $ti = [string]$o.aiTitle }",
    "    elseif (-not $ti -and $o.title) { $ti = [string]$o.title }",
    "    elseif (-not $ti -and $o.name) { $ti = [string]$o.name }",
    "    if (-not $fu) {",
    "      $txt = $null",
    "      if ($o.type -eq 'message' -and $o.message.role -eq 'user') { $c = @($o.message.content); if ($c.Count) { $txt = [string]$c[0].text } }",
    "      elseif ($o.type -eq 'response_item' -and $o.payload.role -eq 'user') { $c = @($o.payload.content); if ($c.Count) { $txt = [string]$c[0].text } }",
    "      elseif ($o.type -eq 'user' -and $o.message.role -eq 'user') { $c = @($o.message.content); if ($c.Count) { $txt = [string]$c[0].text } }",
    "      elseif ($o.role -eq 'user' -and $o.text) { $txt = [string]$o.text }",
    "      if ($txt) {",
    "        $t2 = ($txt -replace '\\s+', ' ').Trim()",
    "        if ($t2 -and -not $t2.StartsWith('<')) { $fu = $t2.Substring(0, [Math]::Min(80, $t2.Length)) }",
    "      }",
    "    }",
    "  }",
    "  if (-not $ti -and $fu) { $ti = $fu }",
    "  if ($id) {",
    "    $m = [int]([DateTimeOffset]$f.LastWriteTimeUtc).ToUnixTimeSeconds()",
    "    $rows.Add(@($src, $m, $id, ($ti -replace '[\\r\\n]+', ' '), $cwd) -join $SEP)",
    "  }",
    "}",
    "function Scan($src, $root, $limit, $leaf) {",
    "  if (-not (Test-Path -LiteralPath $root)) { return }",
    "  $files = Get-ChildItem -LiteralPath $root -Recurse -Filter *.jsonl -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First $limit",
    "  foreach ($f in $files) { ReadJsonl $src $f }",
    "  if ($leaf -and $leaf.Length -ge 2) {",
    "    $dirs = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like \"*$leaf*\" }",
    "    foreach ($d in $dirs) {",
    "      $hits = Get-ChildItem -LiteralPath $d.FullName -Recurse -Filter *.jsonl -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 20",
    "      foreach ($f in $hits) { ReadJsonl $src $f }",
    "    }",
    "  }",
    "}",
    "$leaf = ''",
    "if ($target) { $leaf = Split-Path ($target.TrimEnd('\\','/')) -Leaf }",
    `Scan 'omp' (Join-Path $env:USERPROFILE '${SOURCES.omp.dir}') ${MAX_PER} $leaf`,
    `Scan 'codex' (Join-Path $env:USERPROFILE '${SOURCES.codex.dir}') ${MAX_CODEX} ''`,
    `Scan 'claude' (Join-Path $env:USERPROFILE '${SOURCES.claude.dir}') ${MAX_PER} $leaf`,
    `Scan 'pi' (Join-Path $env:USERPROFILE '${SOURCES.pi.dir}') ${MAX_PER} $leaf`,
    "if ($target) {",
    "  $conv = Join-Path $target '.herdr\\conversations'",
    "  if (Test-Path -LiteralPath $conv) {",
    "    $lfiles = Get-ChildItem -LiteralPath $conv -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.jsonl', '.json' } | Sort-Object LastWriteTime -Descending | Select-Object -First 20",
    "    foreach ($f in $lfiles) {",
    "      if ($f.Extension -eq '.jsonl') { ReadJsonl 'local' $f }",
    "      else {",
    "        try {",
    "          $raw = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue",
    "          $o = $raw | ConvertFrom-Json",
    "          $id = [string]($o.id, $o.session_id, $f.BaseName | Where-Object { $_ } | Select-Object -First 1)",
    "          $ti = [string]($o.title, $o.name, $o.summary, $f.BaseName | Where-Object { $_ } | Select-Object -First 1)",
    "          $cwd = [string]($o.cwd, $target | Where-Object { $_ } | Select-Object -First 1)",
    "          $m = [int]([DateTimeOffset]$f.LastWriteTimeUtc).ToUnixTimeSeconds()",
    "          if ($id) { $rows.Add(@('local', $m, $id, ($ti -replace '[\\r\\n]+', ' '), $cwd) -join $SEP) }",
    "        } catch {}",
    "      }",
    "    }",
    "  }",
    "}",
    "$sq = Get-Command sqlite3 -ErrorAction SilentlyContinue",
    "if ($sq) {",
    "  foreach ($db in @((Join-Path $env:LOCALAPPDATA 'opencode\\opencode.db'), (Join-Path $env:USERPROFILE '.local\\share\\opencode\\opencode.db'))) {",
    "    if (Test-Path -LiteralPath $db) {",
    "      try {",
    "        $sql = \"SELECT 'opencode' || char(31) || CAST(CASE WHEN time_updated > 100000000000 THEN time_updated / 1000 ELSE time_updated END AS INTEGER) || char(31) || id || char(31) || replace(replace(COALESCE(title,''), char(10), ' '), char(13), ' ') || char(31) || COALESCE(directory,'') FROM session WHERE time_archived IS NULL ORDER BY time_updated DESC LIMIT 30;\"",
    "        & $sq.Source -readonly $db $sql 2>$null | ForEach-Object { if ($_) { $rows.Add($_) } }",
    "      } catch {}",
    "      break",
    "    }",
    "  }",
    "}",
    "$rows | ForEach-Object { $_ }",
  ].join("\n");
  return ["-NoProfile", "-NonInteractive", "-Command", `& { ${body} } '${esc}'`];
}

// 每条 JSON 首个出现的 id / cwd / 标题就够用了：取前 25 行，避免读大文件的整段历史。
const AWK = [
  'BEGIN { sep = sprintf("%c", 31); id = ""; cwd = ""; ti = ""; fu = "" }',
"{",
'  ln = $0; if (length(ln) > 131072) ln = substr(ln, 1, 4096) " " substr(ln, length(ln) - 4095)',
'  if (id == "" && match(ln, /"id"[ \t]*:[ \t]*"[^"]*"/)) { s = substr(ln, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*"/, "", s); sub(/"$/, "", s); if (s != "") id = s }',
'  if (id == "" && match(ln, /"sessionId"[ \t]*:[ \t]*"[^"]*"/)) { s = substr(ln, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*"/, "", s); sub(/"$/, "", s); if (s != "") id = s }',
'  if (cwd == "" && match(ln, /"cwd"[ \t]*:[ \t]*"[^"]*"/)) { s = substr(ln, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*"/, "", s); sub(/"$/, "", s); if (s != "") cwd = s }',
'  if (ln ~ /"type"[ \t]*:[ \t]*"(title|title_change|custom-title|ai-title)"/ && match(ln, /"(title|customTitle|aiTitle)"[ \t]*:[ \t]*"[^"]*"/)) { s = substr(ln, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*"/, "", s); sub(/"$/, "", s); if (s != "") ti = s }',
'  if (ti == "" && match(ln, /"title"[ \t]*:[ \t]*"[^"]*"/)) { s = substr(ln, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*"/, "", s); sub(/"$/, "", s); if (s != "") ti = s }',
'  if (fu == "" && ln ~ /"role"[ \t]*:[ \t]*"user"/ && match(ln, /"text"[ \t]*:[ \t]*"[^"]*"/)) { s = substr(ln, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*"/, "", s); sub(/"$/, "", s); if (s != "" && substr(s, 1, 1) != "<") fu = substr(s, 1, 80) }',
"}",
  'END { if (ti == "" && fu != "") ti = fu; if (id != "") printf "%s%s%s%s%s%s%s%s%s\\n", src, sep, m, sep, id, sep, ti, sep, cwd }',
].join("\n");

const SH_SCAN = [
  "TARGET=$1",
  "SEP=$(printf '\\037')",
  "LEAF=''",
  'if [ -n "$TARGET" ]; then LEAF=$(basename "${TARGET%/}"); fi',
  "scan_files() {",
  "  src=$1; lim=$2",
  '  sort -rn | head -n "$lim" | while IFS=$(printf "\\t") read -r m f; do',
  '    { head -n 25 "$f"; tail -n 25 "$f"; } 2>/dev/null | awk -v src="$src" -v m="$m" -v sep="$SEP" "$AWK"',
  "  done",
  "}",
  "scan() {",
  "  src=$1; root=$2; lim=$3; use_leaf=$4",
  '  [ -d "$root" ] || return 0',
  '  find "$root" -type f -name "*.jsonl" 2>/dev/null | while IFS= read -r f; do',
  '    m=$(stat -c %Y "$f" 2>/dev/null) || m=$(stat -f %m "$f" 2>/dev/null) || m=0',
  '    printf "%s\\t%s\\n" "$m" "$f"',
  '  done | scan_files "$src" "$lim"',
  '  if [ "$use_leaf" = "1" ] && [ "${#LEAF}" -ge 2 ]; then',
  '    find "$root" -mindepth 1 -maxdepth 1 -type d -name "*$LEAF*" 2>/dev/null | while IFS= read -r d; do',
  '      find "$d" -type f -name "*.jsonl" 2>/dev/null | while IFS= read -r f; do',
  '        m=$(stat -c %Y "$f" 2>/dev/null) || m=$(stat -f %m "$f" 2>/dev/null) || m=0',
  '        printf "%s\\t%s\\n" "$m" "$f"',
  "      done",
  '    done | scan_files "$src" 20',
  "  fi",
  "}",
  `AWK='${AWK}'`,
  `scan omp "$HOME/${SOURCES.omp.dir}" ${MAX_PER} 1`,
  `scan codex "$HOME/${SOURCES.codex.dir}" ${MAX_CODEX} 0`,
  `scan claude "$HOME/${SOURCES.claude.dir}" ${MAX_PER} 1`,
  `scan pi "$HOME/${SOURCES.pi.dir}" ${MAX_PER} 1`,
  'if [ -n "$TARGET" ] && [ -d "$TARGET/.herdr/conversations" ]; then',
  '  find "$TARGET/.herdr/conversations" -maxdepth 1 -type f -name "*.jsonl" 2>/dev/null | while IFS= read -r f; do',
  '    m=$(stat -c %Y "$f" 2>/dev/null) || m=$(stat -f %m "$f" 2>/dev/null) || m=0',
  '    printf "%s\\t%s\\n" "$m" "$f"',
  '  done | scan_files local 20',
  "fi",
  'OC_DB="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/opencode.db"',
  'if [ -f "$OC_DB" ] && command -v sqlite3 >/dev/null 2>&1; then',
  '  sqlite3 -readonly "$OC_DB" "SELECT \'opencode\' || char(31) || CAST(CASE WHEN time_updated > 100000000000 THEN time_updated / 1000 ELSE time_updated END AS INTEGER) || char(31) || id || char(31) || replace(replace(COALESCE(title,\'\'), char(10), \' \'), char(13), \' \') || char(31) || COALESCE(directory,\'\') FROM session WHERE time_archived IS NULL ORDER BY time_updated DESC LIMIT 30;" 2>/dev/null || true',
  "fi",
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
const inFolder = (cwd, dir) => {
  const c = norm(cwd), h = norm(dir);
  return Boolean(c && h && (c === h || c.startsWith(h + "\\") || c.startsWith(h + "/")));
};

export default class Sessions extends View {
  init(_p, cx) {
    this.list = [];
    this.loading = true;
    this.failed = false;
    this.failReason = "";
    this.all = false;
    this.source = "all";
    this.query = "";
    this.copied = null;
    this.bins = {};
    this.resumed = new Set();
    this.scannedKey = null;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "搜索标题、目录或 ID…" });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value();
      cx.notify();
    });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    if (!checking()) {
      this.detect();
      this.reload(cx);
    } else {
      this.loading = false;
    }
    cx.timer.every(60000, (cx) => this.reload(cx));
  }

  activeSpace() {
    return spaces().find((s) => s.active) ?? null;
  }

  activeMachine(sp = this.activeSpace()) {
    return sp?.machine || null;
  }

  activeFolder(sp = this.activeSpace()) {
    if (!sp) return "";
    if (sp.folder) return sp.folder;
    const tabs = new Set((sp.tabs ?? []).map((c) => c.id));
    return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || "";
  }

  // 各家的可执行文件位置：按机器分别探测，点会话时用它开终端。
  detect(on = this.activeMachine()) {
    const mkey = on || "local";
    if (this.bins[mkey]) return;
    this.bins[mkey] = {};
    const useWin = !on && plat() === "windows";
    for (const [key, src] of Object.entries(SOURCES)) {
      if (!src.bin) continue;
      const job = useWin
        ? exec("where", [src.bin], { timeout: 5000 })
        : exec("sh", ["-c", `command -v ${src.bin}`], { on, timeout: 5000 });
      job
        .then((r) => {
          const line = String(r?.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
          if (line) this.bins[mkey][key] = line;
        })
        .catch(() => {});
    }
  }

  reload(cx) {
    if (this.reloading) return;
    this.reloading = true;
    const sp = this.activeSpace();
    const on = this.activeMachine(sp);
    const target = this.activeFolder(sp);
    this.scannedKey = `${on ?? ""}|${target}`;
    this.detect(on);
    const useWin = !on && plat() === "windows";
    const job = useWin
      ? exec("powershell", buildPsScan(target), { timeout: 25000 })
      : exec("sh", ["-c", SH_SCAN, "sh", target], { on, timeout: 25000 });
    job
      .then((r) => {
        if (r?.code !== 0) {
          this.failed = true;
          const err = String(r?.stderr ?? "").trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
          this.failReason = err ? `退出码 ${r?.code ?? "?"}：${err}` : `退出码 ${r?.code ?? "未知"}`;
          return;
        }
        const un = useWin ? (s) => s : (s) => String(s ?? "").replace(/\\(["\\])/g, "$1");
        const byKey = new Map();
        for (const line of String(r?.stdout ?? "").split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const [src, m, id, t, cwd] = trimmed.split(SEP);
          const item = { src, m: Number(m) || 0, id: un(id), t: un(t), cwd: un(cwd) };
          if (!item.id || !SOURCES[item.src]) continue;
          const dedup = `${item.src}:${item.id}`;
          const prev = byKey.get(dedup);
          if (!prev || item.m > prev.m) byKey.set(dedup, item);
        }
        this.list = [...byKey.values()].sort((a, b) => b.m - a.m).slice(0, 120);
        this.failed = false;
        this.failReason = "";
      })
      .catch((e) => {
        this.failed = true;
        this.failReason = String(e?.message || e || "执行异常");
      })
      .finally(() => {
        this.reloading = false;
        this.loading = false;
        cx.notify();
      });
  }

  // 三层识别实况会话：
  // 1) 终端 argv / foreground.argv 直接包含会话 ID（对保留参数的工具最准）；
  // 2) 终端 OSC 标题前 24 字 + 目录匹配（同一标题多记录只认最新那条）。
  live(s) {
    const terms = terminals();
    const byArgv = terms.find((x) => {
      const a1 = Array.isArray(x.argv) ? x.argv.join(" ") : "";
      const a2 = Array.isArray(x.foreground?.argv) ? x.foreground.argv.join(" ") : "";
      return (a1 && a1.includes(s.id)) || (a2 && a2.includes(s.id));
    });
    if (byArgv) return byArgv;
    const head = String(s.t ?? "").trim().slice(0, 24);
    if (head.length < 4) return null;
    const cwd = norm(s.cwd);
    const twins = this.list.filter((o) => norm(o.cwd) === cwd && String(o.t ?? "").trim().slice(0, 24) === head);
    if (twins.length > 1 && twins[0] !== s) return null;
    return terms.find((x) => {
      if (!String(x.title ?? "").includes(head)) return false;
      return !cwd || !x.cwd || norm(x.cwd) === cwd;
    });
  }

  cmdString(s) {
    const src = SOURCES[s.src];
    if (!src?.bin || !src?.argv) return s.id;
    return `${src.bin} ${src.argv(s.id).join(" ")}`;
  }

  resume(s, cx) {
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
    if (!src.bin || !src.argv) {
      cx.write_to_clipboard(s.id);
      notify({ title: "本地对话归档", body: `已复制记录 ID：${s.id}`, level: "info" });
      return;
    }
    const mkey = this.activeMachine() || "local";
    const bin = this.bins[mkey]?.[s.src] ?? src.bin;
    const args = { argv: [bin, ...src.argv(s.id)], place: "tab" };
    if (s.cwd) args.folder = s.cwd;
    this.resumed.add(s.id);
    run("terminal.open", args);
    notify({ title: `正在恢复 ${src.label} 会话`, body: s.t || s.id, level: "info" });
  }

  copyCmd(s, cx) {
    const text = this.cmdString(s);
    cx.write_to_clipboard(text);
    this.copied = s.id;
    cx.notify();
    cx.spawn(async (cx) => {
      await new Promise((r) => setTimeout(r, 1800));
      if (this.copied === s.id) {
        this.copied = null;
        cx.notify();
      }
    });
  }

  // 按「当前目录 / 全部」过滤后的列表（不含来源与关键字，用于计算来源药丸计数）。
  scoped() {
    const all = this.list;
    if (this.all) return all;
    const here = this.activeFolder();
    if (!here) return all;
    return all.filter((s) => inFolder(s.cwd, here));
  }

  shown() {
    let items = this.scoped();
    if (this.source !== "all") items = items.filter((s) => s.src === this.source);
    const q = this.query.trim().toLowerCase();
    if (q) {
      items = items.filter((s) => (
        String(s.t ?? "").toLowerCase().includes(q)
        || String(s.cwd ?? "").toLowerCase().includes(q)
        || String(s.id ?? "").toLowerCase().includes(q)
        || (SOURCES[s.src]?.label ?? "").toLowerCase().includes(q)
      ));
    }
    return items;
  }

  badgeColor(src, t) {
    if (src === "omp") return t.accent;
    if (src === "codex") return t.done;
    if (src === "claude") return t.working;
    if (src === "pi") return t.ansi5;
    if (src === "opencode") return t.ansi6;
    return t.muted;
  }

  row(s, i, t) {
    const src = SOURCES[s.src];
    const up = this.live(s);
    const copied = this.copied === s.id;
    const tip = up
      ? `${s.cwd || "?"}\n这个会话正开着：点一下切过去，不重新加载`
      : src.bin
        ? `${s.cwd || "?"}\n点一下：${this.cmdString(s)}`
        : `${s.cwd || "?"}\n本地归档记录（点一下复制 ID）`;
    return h_flex()
      .id(`ses-${i}`)
      .h(46)
      .flex_none()
      .px(8)
      .gap(8)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((h) => h.bg(t.hover))
      .tooltip(tip)
      .on_click((_e, cx) => this.resume(s, cx))
      .child(div().w(44).flex_none().flex().items_center().justify_center().rounded(5).h(18).bg(t.raised)
        .child(div().text_size(9).text_color(this.badgeColor(s.src, t)).child(src.label)))
      .child(v_flex()
        .flex_1()
        .min_w(0)
        .gap(0)
        .child(div().w_full().truncate().text_size(12).child(s.t || base(s.cwd) || String(s.id).slice(0, 8)))
        .child(div().w_full().truncate().text_size(11).text_color(t.dim)
          .child(`${ago(s.m)} · ${base(s.cwd) || "?"} · ${String(s.id).slice(0, 6)}`)))
      .when(up, (el) => el.child(div()
        .flex_none()
        .px(5)
        .py(1)
        .rounded(4)
        .bg(t.raised)
        .text_size(9)
        .text_color(t.done)
        .child("已打开")))
      .child(div()
        .id(`ses-cp-${i}`)
        .h(20)
        .px(5)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(4)
        .text_size(10)
        .text_color(copied ? t.done : t.dim)
        .cursor_pointer()
        .tooltip(copied ? "已复制" : src.bin ? `复制恢复命令：${this.cmdString(s)}` : "复制 ID")
        .accessibility_label("复制恢复命令")
        .hover((h) => h.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.copyCmd(s, cx);
        })
        .child(copied ? "已复制" : "命令"));
  }

  render(cx) {
    const t = theme();
    const sp = this.activeSpace();
    const on = this.activeMachine(sp);
    const here = this.activeFolder(sp);
    const key = `${on ?? ""}|${here}`;
    if (!checking() && key !== this.scannedKey && !this.reloading) {
      this.reload(cx);
    }
    const scoped = this.scoped();
    const counts = {};
    for (const s of scoped) counts[s.src] = (counts[s.src] ?? 0) + 1;
    const activeSources = SOURCE_ORDER.filter((k) => counts[k] > 0);
    if (this.source !== "all" && !counts[this.source] && scoped.length > 0) this.source = "all";
    const list = this.shown();
    const hasFilter = Boolean(this.query.trim()) || this.source !== "all";

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && (this.typing || this.query)) {
          this.query = "";
          this.input.set_value("");
          this.typing = false;
          this.handle.focus();
          cx.stop_propagation();
          cx.notify();
        }
      })
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
      .child(h_flex()
        .h(32)
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
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(svg("mods/inkstone-chrome/search.svg").size(12).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground))
        .when(Boolean(this.query), (el) => el.child(div()
          .id("ses-clear")
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
          .on_click((_e, cx) => {
            this.query = "";
            this.input.set_value("");
            cx.notify();
          })
          .child("✕"))))
      .when(activeSources.length >= 2 || this.source !== "all", (el) => el.child(h_flex()
        .flex_none()
        .px(8)
        .pt(6)
        .gap(4)
        .flex_wrap()
        .child(this.pill(t, "all", `全部 ${scoped.length}`, cx))
        .children(activeSources.map((k) => this.pill(t, k, `${SOURCES[k].label} ${counts[k]}`, cx)))))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .px(6)
        .py(6)
        .gap(1)
        .overflow_y_scrollbar()
        .children(list.length
          ? list.map((s, i) => this.row(s, i, t))
          : [this.emptyState(t, hasFilter, scoped.length, cx)]))
      .child(h_flex()
        .h(24)
        .flex_none()
        .px(10)
        .items_center()
        .justify_between()
        .border_t(1)
        .border_color(t.border)
        .text_size(10)
        .text_color(t.dim)
        .child(div().truncate().child(activeSources.length
          ? `来源：${activeSources.map((k) => SOURCES[k].label).join(" · ")}`
          : "OMP / Codex / Claude / Pi / 本地"))
        .child(div().flex_none().child("点行恢复 · Esc 清空搜索")));
  }

  pill(t, id, label, cx) {
    const on = this.source === id;
    return div()
      .id(`ses-src-${id}`)
      .h(20)
      .px(7)
      .flex_none()
      .flex()
      .items_center()
      .rounded(5)
      .text_size(10)
      .cursor_pointer()
      .bg(on ? t.selected : t.raised)
      .text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(on ? t.selected : t.hover))
      .on_click(() => {
        this.source = id;
        cx.notify();
      })
      .child(label);
  }

  emptyState(t, hasFilter, scopedCount, cx) {
    if (this.failed) {
      return v_flex().p(10).gap(4)
        .child(div().text_size(12).text_color(t.blocked).child("扫描会话失败，点右上角「刷新」重试。"))
        .when(Boolean(this.failReason), (el) => el.child(div().text_size(11).text_color(t.dim).child(this.failReason)));
    }
    if (this.loading) {
      return div().p(10).text_size(12).text_color(t.dim).child("正在扫描会话…");
    }
    if (hasFilter) {
      return v_flex().p(10).gap(8).items_start()
        .child(div().text_size(12).text_color(t.dim).child("没有符合条件的会话。"))
        .child(div()
          .id("ses-reset-filter")
          .px(8)
          .py(4)
          .rounded(5)
          .bg(t.raised)
          .text_size(11)
          .text_color(t.foreground)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click(() => {
            this.query = "";
            this.source = "all";
            this.input.set_value("");
            cx.notify();
          })
          .child("清除筛选"));
    }
    if (!this.all && scopedCount === 0 && this.list.length > 0) {
      return v_flex().p(10).gap(8).items_start()
        .child(div().text_size(12).text_color(t.dim).child("当前空间目录还没有会话记录。"))
        .child(div()
          .id("ses-show-all")
          .px(8)
          .py(4)
          .rounded(5)
          .bg(t.raised)
          .text_size(11)
          .text_color(t.foreground)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click(() => {
            this.all = true;
            cx.notify();
          })
          .child(`查看全部目录 (${this.list.length})`));
    }
    return div().p(10).text_size(12).text_color(t.dim).child("还没有找到会话记录。");
  }
}
