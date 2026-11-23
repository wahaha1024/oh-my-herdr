// 会话：把本机各编程助手的会话列出来，点一条在它原来的目录里恢复。
// 数据源（不依赖 Python；Windows 走 PowerShell，macOS/Linux 走 sh + awk）：
//   - OMP：~/.omp/agent/sessions/<编码目录>/<时间戳>_<uuid>.jsonl
//   - Codex CLI：~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl（首行 type=session_meta）
//   - Claude Code：~/.claude/projects/<slug>/<sessionId>.jsonl
//   - CodeBuddy：~/.codebuddy/projects/<slug>/<sessionId>.jsonl（type=message 且 role 在顶层）
//   - Pi：~/.pi/agent/sessions/*.jsonl（首行 type=session）
//   - 本地归档：<当前空间>/.herdr/conversations/*.jsonl|*.json
//   - OpenCode（可选）：仅在本机已有 sqlite3 与 opencode.db 时只读查询
// 恢复命令：omp --resume <id> / codex resume <id> / claude --resume <id> / codebuddy --resume <id> / pi --session <id> / opencode --session <id>。
// 会话已经在某个终端里开着时不新起进程，直接切过去——新进程会把整段历史重渲染一遍。

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { exec, run, theme, spaces, panes, notify, terminals, window, checking, appHome, readTextFile, writeTextFile, shared } from "herdr";

// 中英切换：shared 改动会让所有 mod 重绘，切换语言立即生效。
const LANG = "inkstone.lang";
const pick = (zh, en) => (shared(LANG) === "en" ? en : zh);

const MAX_PER = 100;
const MAX_CODEX = 120;
const CACHE_TTL_MS = 45000;
const BIN_RETRY_MS = 60000;
const CACHE_FILE = () => `${appHome()}/data/inkstone-sessions-cache.json`;
const MEM_CACHE = new Map();
let DISK_LOADED = false;
let DISK_RAW = null;
let DISK_WRITE = Promise.resolve();
const SEP = "\u001f";
const plat = () => window()?.platform ?? "windows";

function toB64(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = ((cp - 0xd800) << 10) + (lo - 0xdc00) + 0x10000;
        i++;
      }
    }
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += abc[b0 >> 2];
    out += abc[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? abc[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? abc[b2 & 63] : "=";
  }
  return out;
}

function safeSessionFile(p) {
  const s = String(p ?? "").trim();
  if (!s) return false;
  if (!(/\.(jsonl|json)$/i.test(s))) return false;
  return /^([a-zA-Z]:[\\/]|\/)/.test(s);
}
const SOURCES = {
  omp: { label: "OMP", dir: ".omp/agent/sessions", bin: "omp", argv: (id) => ["--resume", id] },
  codex: { label: "Codex", dir: ".codex/sessions", bin: "codex", argv: (id) => ["resume", id] },
  claude: { label: "Claude", dir: ".claude/projects", bin: "claude", argv: (id) => ["--resume", id] },
  codebuddy: { label: "CodeBuddy", dir: ".codebuddy/projects", bin: "codebuddy", argv: (id) => ["--resume", id] },
  pi: { label: "Pi", dir: ".pi/agent/sessions", bin: "pi", argv: (id) => ["--session", id] },
  opencode: { label: "OpenCode", bin: "opencode", argv: (id) => ["--session", id] },
  local: { label: pick("本地", "Local"), bin: null, argv: null },
};

const SOURCE_ORDER = ["omp", "codex", "claude", "codebuddy", "pi", "opencode", "local"];

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
    "      if ($o.type -eq 'message' -and $o.role -eq 'user') { $c = @($o.content); if ($c.Count) { $txt = [string]$c[0].text } }",
    "      elseif ($o.type -eq 'message' -and $o.message.role -eq 'user') { $c = @($o.message.content); if ($c.Count) { $txt = [string]$c[0].text } }",
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
    "    $rows.Add(@($src, $m, $id, ($ti -replace '[\\r\\n]+', ' '), $cwd, $f.FullName) -join $SEP)",
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
    `Scan 'codebuddy' (Join-Path $env:USERPROFILE '${SOURCES.codebuddy.dir}') ${MAX_PER} $leaf`,
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
    "          if ($id) { $rows.Add(@('local', $m, $id, ($ti -replace '[\\r\\n]+', ' '), $cwd, $f.FullName) -join $SEP) }",
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
    "        $dbEsc = $db.Replace(\"'\", \"''\")",
    "        $sql = \"SELECT 'opencode' || char(31) || CAST(CASE WHEN time_updated > 100000000000 THEN time_updated / 1000 ELSE time_updated END AS INTEGER) || char(31) || id || char(31) || replace(replace(COALESCE(title,''), char(10), ' '), char(13), ' ') || char(31) || COALESCE(directory,'') || char(31) || '$dbEsc' FROM session WHERE time_archived IS NULL ORDER BY time_updated DESC LIMIT 30;\"",
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
  'BEGIN { sep = sprintf("%c", 31); id = ""; cwd = ""; ti = ""; fu = ""; if (src == "codebuddy" && fid != "") id = fid }',
"{",
'  ln = $0; if (length(ln) > 131072) ln = substr(ln, 1, 4096) " " substr(ln, length(ln) - 4095)',
'  if (id == "" && match(ln, /"id"[ \t]*:[ \t]*"[^"]*"/)) { s = substr(ln, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*"/, "", s); sub(/"$/, "", s); if (s != "") id = s }',
'  if (id == "" && match(ln, /"sessionId"[ \t]*:[ \t]*"[^"]*"/)) { s = substr(ln, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*"/, "", s); sub(/"$/, "", s); if (s != "") id = s }',
'  if (cwd == "" && match(ln, /"cwd"[ \t]*:[ \t]*"[^"]*"/)) { s = substr(ln, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*"/, "", s); sub(/"$/, "", s); if (s != "") cwd = s }',
'  if (ln ~ /"type"[ \t]*:[ \t]*"(title|title_change|custom-title|ai-title)"/ && match(ln, /"(title|customTitle|aiTitle)"[ \t]*:[ \t]*"[^"]*"/)) { s = substr(ln, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*"/, "", s); sub(/"$/, "", s); if (s != "") ti = s }',
'  if (ti == "" && match(ln, /"title"[ \t]*:[ \t]*"[^"]*"/)) { s = substr(ln, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*"/, "", s); sub(/"$/, "", s); if (s != "") ti = s }',
'  if (fu == "" && ln ~ /"role"[ \t]*:[ \t]*"user"/ && match(ln, /"text"[ \t]*:[ \t]*"[^"]*"/)) { s = substr(ln, RSTART, RLENGTH); sub(/^[^:]*:[ \t]*"/, "", s); sub(/"$/, "", s); if (s != "" && substr(s, 1, 1) != "<") fu = substr(s, 1, 80) }',
"}",
  'END { if (ti == "" && fu != "") ti = fu; if (id != "") printf "%s%s%s%s%s%s%s%s%s%s%s\\n", src, sep, m, sep, id, sep, ti, sep, cwd, sep, f }',
].join("\n");

const SH_SCAN = [
  'command -v awk >/dev/null 2>&1 || { printf "%s\\n" "awk not found" >&2; exit 127; }',
  "TARGET=$1",
  "SEP=$(printf '\\037')",
  "LEAF=''",
  'if [ -n "$TARGET" ]; then LEAF=$(basename "${TARGET%/}"); fi',
  "scan_files() {",
  "  src=$1; lim=$2",
  '  sort -rn | head -n "$lim" | while IFS=$(printf "\\t") read -r m f; do',
  '    { head -n 25 "$f"; tail -n 25 "$f"; } 2>/dev/null | awk -v src="$src" -v m="$m" -v sep="$SEP" -v fid="$(basename "$f" .jsonl)" -v f="$f" "$AWK"',
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
  `scan codebuddy "$HOME/${SOURCES.codebuddy.dir}" ${MAX_PER} 1`,
  `scan pi "$HOME/${SOURCES.pi.dir}" ${MAX_PER} 1`,
  'if [ -n "$TARGET" ] && [ -d "$TARGET/.herdr/conversations" ]; then',
  '  find "$TARGET/.herdr/conversations" -maxdepth 1 -type f -name "*.jsonl" 2>/dev/null | while IFS= read -r f; do',
  '    m=$(stat -c %Y "$f" 2>/dev/null) || m=$(stat -f %m "$f" 2>/dev/null) || m=0',
  '    printf "%s\\t%s\\n" "$m" "$f"',
  '  done | scan_files local 20',
  "fi",
  'OC_DB="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/opencode.db"',
  'if [ -f "$OC_DB" ] && command -v sqlite3 >/dev/null 2>&1; then',
  "  sqlite3 -readonly \"$OC_DB\" \"SELECT 'opencode' || char(31) || CAST(CASE WHEN time_updated > 100000000000 THEN time_updated / 1000 ELSE time_updated END AS INTEGER) || char(31) || id || char(31) || replace(replace(COALESCE(title,''), char(10), ' '), char(13), ' ') || char(31) || COALESCE(directory,'') FROM session WHERE time_archived IS NULL ORDER BY time_updated DESC LIMIT 30;\" 2>/dev/null | while IFS= read -r ln; do [ -n \"$ln\" ] && printf '%s\\037%s\\n' \"$ln\" \"$OC_DB\"; done || true",
  "fi",
].join("\n");

const ago = (sec) => {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (d < 60) return pick("刚刚", "just now");
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
    this.timeRange = "all";
    this.query = "";
    this.copied = null;
    this.bins = new Map();
    this.resumed = new Set();
    this.scannedKey = null;
    this.manage = false;
    this.selected = new Set();
    this.confirmOne = null;
    this.confirmBatch = false;
    this.deleting = false;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: pick("搜索标题、目录或 ID…", "Search titles, folders or IDs…") });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value();
      cx.notify();
    });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    if (!checking()) {
      const sp = this.activeSpace();
      const on = this.activeMachine(sp);
      const target = this.activeFolder(sp);
      const key = `${on ?? ""}|${target}`;
      this.activateKey(key, cx, false);
    } else {
      this.loading = false;
    }
    cx.timer.every(60000, (cx) => this.reload(cx, { silent: true }));
  }

  normCacheItems(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const x of arr) {
      if (!x || !x.id || !SOURCES[x.src]) continue;
      const files = Array.isArray(x.files) ? x.files.filter(Boolean) : (x.file ? [x.file] : []);
      out.push({
        src: x.src,
        m: Number(x.m) || 0,
        id: String(x.id),
        t: String(x.t ?? ""),
        cwd: String(x.cwd ?? ""),
        file: String(files[0] ?? ""),
        files,
      });
    }
    return out;
  }

  async loadDiskCache() {
    if (DISK_LOADED) return;
    await this.readDiskCache().catch(() => {});
    DISK_LOADED = true;
  }

  async readDiskCache() {
    const raw = await readTextFile(CACHE_FILE());
    DISK_RAW = raw ?? null;
    if (!raw) return;
    let obj;
    try { obj = JSON.parse(raw); } catch { return; }
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (!v || !Array.isArray(v.items)) continue;
      const ts = Number(v.ts) || 0;
      if (!MEM_CACHE.has(k) || ts > MEM_CACHE.get(k).ts) {
        MEM_CACHE.set(k, { ts, items: this.normCacheItems(v.items) });
      }
    }
  }

  flushDiskCache() {
    if (checking()) return;
    DISK_WRITE = DISK_WRITE.then(() => this.persistDiskCache());
    return DISK_WRITE;
  }

  async persistDiskCache() {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0 || DISK_RAW === null) await this.readDiskCache();
        const entries = [...MEM_CACHE.entries()]
          .sort((a, b) => b[1].ts - a[1].ts)
          .slice(0, 6);
        const json = JSON.stringify(Object.fromEntries(entries.map(([k, v]) => [k, {
          ts: v.ts,
          items: v.items.slice(0, 180).map((s) => ({
            src: s.src,
            m: s.m,
            id: s.id,
            t: String(s.t ?? "").slice(0, 140),
            cwd: s.cwd,
            files: (s.files ?? (s.file ? [s.file] : [])).slice(0, 2),
          })),
        }])));
        await writeTextFile(CACHE_FILE(), json, DISK_RAW);
        DISK_RAW = json;
        return;
      } catch {
        DISK_RAW = null;
      }
    }
  }

  writeCache(key, list) {
    if (!key || checking()) return;
    MEM_CACHE.set(key, { ts: Date.now(), items: (list ?? []).slice(0, 250) });
    this.flushDiskCache();
  }

  activateKey(key, cx, inRender = false) {
    this.scannedKey = key;
    const context = this.scanContext = {};
    this.reloading = null;
    this.detect();
    this.list = [];
    this.loading = true;
    this.failed = false;
    this.failReason = "";
    this.selected.clear();
    this.confirmOne = null;
    this.confirmBatch = false;
    const hit = MEM_CACHE.get(key);
    if (hit && hit.items.length) {
      this.list = hit.items;
      this.loading = false;
      this.failed = false;
      if (!inRender) cx.notify();
      if (Date.now() - hit.ts >= CACHE_TTL_MS) this.reload(cx, { silent: true });
      return;
    }
    if (!DISK_LOADED) {
      this.loading = this.list.length === 0;
      this.loadDiskCache().then(() => {
        if (this.scanContext !== context) return;
        const diskHit = MEM_CACHE.get(key);
        if (diskHit && diskHit.items.length) {
          this.list = diskHit.items;
          this.loading = false;
          this.failed = false;
          cx.notify();
          if (Date.now() - diskHit.ts >= CACHE_TTL_MS) this.reload(cx, { silent: true });
        } else {
          this.reload(cx);
        }
      });
      return;
    }
    this.reload(cx);
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
    let entry = this.bins.get(on);
    if (!entry) {
      entry = { paths: {}, retryAt: 0 };
      this.bins.set(on, entry);
    }
    const now = Date.now();
    if (now < entry.retryAt) return;
    entry.retryAt = now + BIN_RETRY_MS;
    const useWin = !on && plat() === "windows";
    for (const [key, src] of Object.entries(SOURCES)) {
      if (!src.bin || entry.paths[key]) continue;
      const job = useWin
        ? exec("where", [src.bin], { timeout: 5000 })
        : exec("sh", ["-c", `command -v ${src.bin}`], { on, timeout: 5000 });
      job
        .then((r) => {
          const line = r.code === 0 ? r.stdout.trim().split(/\r?\n/, 1)[0].trim() : "";
          if (line) entry.paths[key] = line;
        })
        .catch(() => {});
    }
  }

  reload(cx, opts = {}) {
    const sp = this.activeSpace();
    const on = this.activeMachine(sp);
    const target = this.activeFolder(sp);
    const scanKey = `${on ?? ""}|${target}`;
    if (scanKey !== this.scannedKey) return this.activateKey(scanKey, cx);
    if (this.reloading) return;
    const context = this.scanContext;
    const silent = Boolean(opts?.silent) && this.list.length > 0;
    this.reloading = context;
    if (!silent) this.loading = this.list.length === 0;
    this.detect(on);
    const useWin = !on && plat() === "windows";
    const fail = (reason) => {
      if (silent && !on) return;
      this.failed = true;
      this.failReason = on ? `「${on}」上的会话扫描需要 sh 和 awk。${reason}` : reason;
    };
    const job = useWin
      ? exec("powershell", buildPsScan(target), { timeout: 25000 })
      : exec("sh", ["-c", SH_SCAN, "sh", target], { on, timeout: 25000 });
    job
      .then((r) => {
        if (this.scanContext !== context) return;
        if (r?.code !== 0) {
          const err = String(r?.stderr ?? "").trim().split(/\r?\n/).filter(Boolean).pop();
          const code = `退出码 ${r?.code ?? pick("未知", "Unknown")}`;
          fail(err ? `${code}：${err}` : code);
          return;
        }
        const un = useWin ? (s) => s : (s) => String(s ?? "").replace(/\\(["\\])/g, "$1");
        const byKey = new Map();
        for (const line of String(r?.stdout ?? "").split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const [src, m, id, t, cwd, file] = trimmed.split(SEP);
          const fpath = un(file);
          const item = { src, m: Number(m) || 0, id: un(id), t: un(t), cwd: un(cwd), file: fpath, files: fpath ? [fpath] : [] };
          if (!item.id || !SOURCES[item.src]) continue;
          const dedup = `${item.src}:${item.id}`;
          const prev = byKey.get(dedup);
          if (!prev) {
            byKey.set(dedup, item);
          } else {
            const merged = item.m > prev.m ? { ...item, files: [...new Set([...prev.files, ...item.files])] } : { ...prev, files: [...new Set([...prev.files, ...item.files])] };
            byKey.set(dedup, merged);
          }
        }
        this.list = [...byKey.values()].sort((a, b) => b.m - a.m).slice(0, 400);
        this.writeCache(scanKey, this.list);
        const valid = new Set(this.list.map((s) => `${s.src}:${s.id}`));
        for (const k of [...this.selected]) if (!valid.has(k)) this.selected.delete(k);
        if (this.confirmOne && !valid.has(this.confirmOne)) this.confirmOne = null;
        this.failed = false;
        this.failReason = "";
      })
      .catch((e) => {
        if (this.scanContext !== context) return;
        fail(String(e?.message || e || pick("执行异常", "Something went wrong")));
      })
      .finally(() => {
        if (this.scanContext !== context) return;
        this.reloading = null;
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
      notify({ title: pick("会话已经开着", "The session is already open"), body: pick("切过去，不重新加载历史", "Switch to it without reloading history"), level: "info" });
      return;
    }
    const src = SOURCES[s.src];
    if (!src.bin || !src.argv) {
      cx.write_to_clipboard(s.id);
      notify({ title: pick("本地对话归档", "Local chat archive"), body: `已复制记录 ID：${s.id}`, level: "info" });
      return;
    }
    const bin = this.bins.get(this.activeMachine())?.paths[s.src] ?? src.bin;
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
    cx.timer.after(1800, (cx) => {
      if (this.copied === s.id) {
        this.copied = null;
        cx.notify();
      }
    });
  }

  askDeleteOne(s, cx) {
    const key = `${s.src}:${s.id}`;
    this.confirmOne = key;
    cx.notify();
    cx.timer.after(4000, (cx) => {
      if (this.confirmOne === key) {
        this.confirmOne = null;
        cx.notify();
      }
    });
  }

  toggleSelect(s, cx) {
    const key = `${s.src}:${s.id}`;
    if (this.selected.has(key)) this.selected.delete(key);
    else this.selected.add(key);
    this.confirmBatch = false;
    cx.notify();
  }

  async deleteItems(items, cx) {
    if (this.deleting || !items.length) return;
    this.deleting = true;
    cx.notify();
    const on = this.activeMachine();
    const context = this.scanContext;
    const useWin = !on && plat() === "windows";
    const fileItems = items.filter((s) => s.src !== "opencode");
    const ocItems = items.filter((s) => s.src === "opencode" && s.file && s.id);
    const files = [...new Set(fileItems.flatMap((s) => s.files ?? (s.file ? [s.file] : [])).filter(safeSessionFile))];
    const ocByDb = new Map();
    for (const s of ocItems) {
      if (!ocByDb.has(s.file)) ocByDb.set(s.file, []);
      ocByDb.get(s.file).push(s.id);
    }
    const oc = [...ocByDb.entries()].map(([db, ids]) => ({ db, ids }));
    const okFiles = new Set();
    const okOc = new Set();
    let errMsg = "";
    const remoteHint = on ? `无法在「${on}」完成删除，请确认远端在线且可运行 sh。` : "";
    try {
      if (useWin) {
        const removeBatch = async (batch, db) => {
          const files = db ? [] : batch;
          const oc = db ? [{ db, ids: batch }] : [];
          const b64 = toB64(JSON.stringify({ files, oc }));
          // 在 Windows 32767 字符限制内为脚本、引号和可执行文件路径留余量。
          if (b64.length > 24000) {
            if (batch.length === 1) {
              errMsg ||= pick("会话路径或标识过长，无法删除", "The path or id is too long to delete");
              return;
            }
            const mid = Math.floor(batch.length / 2);
            await removeBatch(batch.slice(0, mid), db);
            await removeBatch(batch.slice(mid), db);
            return;
          }
          const ps = [
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
            `$req = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json -ErrorAction Stop`,
            "foreach ($p in @($req.files)) {",
            "  if (-not $p) { continue }",
            "  try {",
            "    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force -ErrorAction Stop }",
            "    \"OK`t$p\"",
            "  } catch { \"ERR`t$p`t$($_.Exception.Message)\" }",
            "}",
            "if (-not $req.oc) { exit 0 }",
            "$sq = Get-Command sqlite3 -ErrorAction SilentlyContinue",
            'if (-not $sq) { "ERR`toc`t找不到 sqlite3"; exit 0 }',
            "foreach ($g in @($req.oc)) {",
            '  if (-not (Test-Path -LiteralPath $g.db)) { "ERR`toc`t找不到数据库：$($g.db)"; continue }',
            "  $inList = (@($g.ids) | ForEach-Object { \"'\" + ([string]$_).Replace(\"'\", \"''\") + \"'\" }) -join ','",
            "  if (-not $inList) { continue }",
            "  try {",
            "    & $sq.Source $g.db \"PRAGMA foreign_keys=ON; DELETE FROM session WHERE id IN ($inList);\" 2>$null",
            "    if ($LASTEXITCODE -eq 0) { foreach ($id in @($g.ids)) { \"OC`t$id\" } }",
            "    else { \"ERR`toc`texit $LASTEXITCODE\" }",
            "  } catch { \"ERR`toc`t$($_.Exception.Message)\" }",
            "}",
            "exit 0",
          ].join("\n");
          try {
            const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 20000 });
            for (const ln of r.stdout.split(/\r?\n/)) {
              if (ln.startsWith("OK\t")) okFiles.add(ln.slice(3));
              else if (db && ln.startsWith("OC\t")) okOc.add(`${db}\0${ln.slice(3)}`);
              else if (ln.startsWith("ERR\t")) errMsg ||= ln.split("\t").slice(2).join(" ");
            }
            if (r.code !== 0) errMsg ||= r.stderr.trim() || `PowerShell 退出码 ${r.code}`;
          } catch (e) {
            errMsg ||= String(e?.message ?? e);
          }
        };
        for (let i = 0; i < files.length; i += 50) await removeBatch(files.slice(i, i + 50), null);
        for (const { db, ids } of oc) {
          for (let i = 0; i < ids.length; i += 50) await removeBatch(ids.slice(i, i + 50), db);
        }
      } else {
        if (files.length) {
          const shDel = 'for p in "$@"; do if [ -e "$p" ]; then rm -f -- "$p" && printf "OK\\t%s\\n" "$p" || printf "ERR\\t%s\\n" "$p"; else printf "OK\\t%s\\n" "$p"; fi; done';
          const r = await exec("sh", ["-c", shDel, "sh", ...files], { on, timeout: 20000 });
          for (const ln of String(r?.stdout ?? "").split(/\r?\n/)) {
            if (ln.startsWith("OK\t")) okFiles.add(ln.slice(3));
            else if (ln.startsWith("ERR\t") && !errMsg) errMsg = `删除失败：${ln.slice(4)}`;
          }
          if (r?.code !== 0 && !errMsg) errMsg = String(r?.stderr ?? "").trim() || `sh 退出码 ${r?.code ?? pick("未知", "Unknown")}`;
        }
        for (const g of oc) {
          const inList = g.ids.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(",");
          const sql = `PRAGMA foreign_keys=ON; DELETE FROM session WHERE id IN (${inList});`;
          const r = await exec("sqlite3", [g.db, sql], { on, timeout: 10000 });
          if (r?.code === 0) for (const id of g.ids) okOc.add(`${g.db}\0${id}`);
          else if (!errMsg) errMsg = String(r?.stderr ?? "").trim() || pick("OpenCode 删除失败", "OpenCode delete failed");
        }
      }
      const deletedKeys = new Set();
      for (const s of items) {
        const k = `${s.src}:${s.id}`;
        if (s.src === "opencode") {
          if (okOc.has(`${s.file}\0${s.id}`)) deletedKeys.add(k);
        } else {
          const fs = (s.files ?? (s.file ? [s.file] : [])).filter(safeSessionFile);
          if (fs.length && fs.every((f) => okFiles.has(f))) deletedKeys.add(k);
        }
      }
      if (this.scanContext === context && deletedKeys.size) {
        this.list = this.list.filter((s) => !deletedKeys.has(`${s.src}:${s.id}`));
        for (const k of deletedKeys) this.selected.delete(k);
        this.writeCache(this.scannedKey, this.list);
      }
      this.confirmBatch = false;
      if (deletedKeys.size === items.length) {
        notify({ title: pick("已删除会话", "Session deleted"), body: `共删除 ${deletedKeys.size} 条会话记录`, level: "info" });
      } else if (deletedKeys.size > 0) {
        notify({ title: pick("部分会话已删除", "Some sessions were deleted"), body: `成功 ${deletedKeys.size} 条，失败 ${items.length - deletedKeys.size} 条。${remoteHint}${errMsg}`, level: "warn" });
      } else {
        notify({ title: pick("删除会话失败", "Couldn't delete the session"), body: remoteHint + (errMsg || pick("未找到可删除的会话文件", "No session file to delete")), level: "error" });
      }
    } catch (e) {
      notify({ title: pick("删除会话失败", "Couldn't delete the session"), body: remoteHint + String(e?.message ?? e), level: "error" });
    } finally {
      this.deleting = false;
      cx.notify();
    }
  }
  // 按「当前目录 / 全部」过滤后的列表（不含来源与关键字，用于计算来源药丸计数）。
  scoped() {
    const all = this.list;
    if (this.all) return all;
    const here = this.activeFolder();
    if (!here) return all;
    return all.filter((s) => inFolder(s.cwd, here));
  }

  inTimeRange(s, nowSec, range = this.timeRange) {
    if (range === "all") return true;
    const age = Math.max(0, nowSec - (s.m || 0));
    if (range === "7d") return age <= 7 * 86400;
    if (range === "30d") return age <= 30 * 86400;
    if (range === "gt30d") return age > 30 * 86400;
    return true;
  }

  shown() {
    const nowSec = Math.floor(Date.now() / 1000);
    let items = this.scoped();
    if (this.source !== "all") items = items.filter((s) => s.src === this.source);
    if (this.timeRange !== "all") items = items.filter((s) => this.inTimeRange(s, nowSec));
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
    if (src === "codebuddy") return t.ansi4;
    if (src === "pi") return t.ansi5;
    if (src === "opencode") return t.ansi6;
    return t.muted;
  }

  row(s, i, t, cx) {
    const src = SOURCES[s.src];
    const up = this.live(s);
    const key = `${s.src}:${s.id}`;
    const copied = this.copied === s.id;
    const checked = this.selected.has(key);
    const askingDel = !this.manage && this.confirmOne === key;
    const canDel = s.src === "opencode" ? Boolean(s.file && s.id) : (s.files ?? (s.file ? [s.file] : [])).some(safeSessionFile);
    const tip = this.manage
      ? `${s.cwd || "?"}\n点击选中或取消选中`
      : up
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
      .when(this.manage && checked, (el) => el.bg(t.selected))
      .cursor_pointer()
      .hover((h) => h.bg(this.manage && checked ? t.selected : t.hover))
      .tooltip(tip)
      .on_click((_e, cx) => {
        if (this.manage) this.toggleSelect(s, cx);
        else this.resume(s, cx);
      })
      .when(this.manage, (el) => el.child(div()
        .id(`ses-chk-${i}`)
        .size(15)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(4)
        .border(1)
        .border_color(checked ? t.accent : t.border)
        .bg(checked ? t.accent : t.background)
        .when(checked, (b) => b.child(svg("mods/inkstone-chrome/check.svg").size(10).text_color(t.accent_foreground)))))
      .child(div().w(44).flex_none().flex().items_center().justify_center().rounded(5).h(18).bg(t.raised)
        .child(div().text_size(9).text_color(this.badgeColor(s.src, t)).child(src.label)))
      .child(v_flex()
        .flex_1()
        .min_w(0)
        .gap(0)
        .child(div().w_full().truncate().text_size(12).child(s.t || base(s.cwd) || String(s.id).slice(0, 8)))
        .child(div().w_full().truncate().text_size(11).text_color(t.dim)
          .child(`${ago(s.m)} · ${base(s.cwd) || "?"} · ${String(s.id).slice(0, 6)}`)))
      .when(up && !askingDel, (el) => el.child(div()
        .flex_none()
        .px(5)
        .py(1)
        .rounded(4)
        .bg(t.raised)
        .text_size(9)
        .text_color(t.done)
        .child(pick("已打开", "Open"))))
      .when(askingDel, (el) => el
        .child(div()
          .id(`ses-del-ok-${i}`)
          .h(20)
          .px(6)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .rounded(4)
          .bg(t.blocked)
          .text_size(10)
          .font_semibold()
          .text_color(t.accent_foreground ?? "#ffffff")
          .cursor_pointer()
          .tooltip(up ? pick("该会话正运行中，确认仍删除本地记录？", "This session is running; delete its local record anyway?") : pick("确认永久删除该会话文件", "Permanently delete this session file"))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.deleteItems([s], cx);
          })
          .child(this.deleting ? pick("删除中", "Deleting") : pick("确认删", "Delete it")))
        .child(div()
          .id(`ses-del-no-${i}`)
          .h(20)
          .px(5)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .rounded(4)
          .bg(t.raised)
          .text_size(10)
          .text_color(t.muted)
          .cursor_pointer()
          .hover((h) => h.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.confirmOne = null;
            cx.notify();
          })
          .child(pick("取消", "Cancel"))))
      .when(!this.manage && !askingDel, (el) => el
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
          .tooltip(copied ? pick("已复制", "Copied") : src.bin ? `复制恢复命令：${this.cmdString(s)}` : pick("复制 ID", "Copy the ID"))
          .accessibility_label(pick("复制恢复命令", "Copy the resume command"))
          .hover((h) => h.bg(t.raised).text_color(t.foreground))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.copyCmd(s, cx);
          })
          .child(copied ? pick("已复制", "Copied") : pick("命令", "Command")))
        .when(canDel, (b) => b.child(div()
          .id(`ses-del-${i}`)
          .size(20)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .rounded(4)
          .cursor_pointer()
          .tooltip(up ? pick("删除会话记录（运行中）", "Delete the session record (running)") : pick("删除会话", "Delete the session"))
          .accessibility_label(pick("删除会话", "Delete the session"))
          .hover((h) => h.bg(t.raised))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.askDeleteOne(s, cx);
          })
          .child(svg("mods/inkstone-sessions/trash.svg").size(12).text_color(t.dim)))));
  }

  render(cx) {
    const t = theme();
    const sp = this.activeSpace();
    const on = this.activeMachine(sp);
    const here = this.activeFolder(sp);
    const key = `${on ?? ""}|${here}`;
    if (!checking() && key !== this.scannedKey) {
      this.activateKey(key, cx, true);
    }
    const scoped = this.scoped();
    const nowSec = Math.floor(Date.now() / 1000);
    const counts = {};
    for (const s of scoped) counts[s.src] = (counts[s.src] ?? 0) + 1;
    const activeSources = SOURCE_ORDER.filter((k) => counts[k] > 0);
    if (this.source !== "all" && !counts[this.source] && scoped.length > 0) this.source = "all";
    const srcScoped = this.source === "all" ? scoped : scoped.filter((s) => s.src === this.source);
    const tCounts = {
      "7d": srcScoped.filter((s) => this.inTimeRange(s, nowSec, "7d")).length,
      "30d": srcScoped.filter((s) => this.inTimeRange(s, nowSec, "30d")).length,
      "gt30d": srcScoped.filter((s) => this.inTimeRange(s, nowSec, "gt30d")).length,
    };
    const list = this.shown();
    const hasFilter = Boolean(this.query.trim()) || this.source !== "all" || this.timeRange !== "all";

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          if (this.typing || this.query) {
            this.query = "";
            this.input.set_value("");
            this.typing = false;
            this.handle.focus();
            cx.stop_propagation();
            cx.notify();
          } else if (this.confirmOne || this.confirmBatch) {
            this.confirmOne = null;
            this.confirmBatch = false;
            cx.stop_propagation();
            cx.notify();
          } else if (this.manage) {
            this.manage = false;
            this.selected.clear();
            cx.stop_propagation();
            cx.notify();
          }
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
        .child(div().text_size(12).font_semibold().child(pick("会话", "Sessions")))
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
          .tooltip(this.all ? pick("现在显示全部会话，点一下只看当前目录", "Showing every session — click to narrow to this folder") : pick("只看当前空间的目录，点一下显示全部", "Only this space's folder — click to show everything"))
          .accessibility_label(pick("切换会话范围", "Switch the session scope"))
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            this.all = !this.all;
            cx.notify();
          })
          .child(this.all ? pick("全部", "All") : pick("当前目录", "This folder")))
        .child(div()
          .id("ses-manage")
          .px(6)
          .py(2)
          .rounded(5)
          .text_size(11)
          .when(this.manage, (el) => el.bg(t.selected))
          .text_color(this.manage ? t.foreground : t.dim)
          .cursor_pointer()
          .tooltip(this.manage ? pick("退出批量删除模式", "Leave batch delete") : pick("批量选择并删除会话", "Select and delete sessions in bulk"))
          .accessibility_label(pick("批量管理会话", "Manage sessions in bulk"))
          .hover((s) => s.bg(this.manage ? t.selected : t.hover).text_color(t.foreground))
          .on_click((_e, cx) => {
            this.manage = !this.manage;
            this.confirmOne = null;
            this.confirmBatch = false;
            if (!this.manage) this.selected.clear();
            cx.notify();
          })
          .child(this.manage ? pick("完成", "Done") : pick("批量", "Batch")))
        .child(div()
          .id("ses-reload")
          .px(6)
          .py(2)
          .rounded(5)
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .tooltip(pick("重新扫描", "Rescan"))
          .accessibility_label(pick("重新扫描会话", "Rescan sessions"))
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.reload(cx, { force: true }))
          .child(this.reloading ? pick("更新中", "Updating") : pick("刷新", "Refresh"))))
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
          .tooltip(pick("清空搜索", "Clear the search"))
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
      .when(scoped.length > 0 || this.timeRange !== "all", (el) => el.child(h_flex()
        .flex_none()
        .px(8)
        .pt(5)
        .gap(4)
        .flex_wrap()
        .child(this.timePill(t, "all", pick("不限时间", "Any time"), cx))
        .child(this.timePill(t, "7d", `7天内 ${tCounts["7d"]}`, cx))
        .child(this.timePill(t, "30d", `30天内 ${tCounts["30d"]}`, cx))
        .child(this.timePill(t, "gt30d", `30天外 ${tCounts["gt30d"]}`, cx))))
      .when(this.manage, (el) => {
        const allSelected = list.length > 0 && list.every((s) => this.selected.has(`${s.src}:${s.id}`));
        const selItems = this.list.filter((s) => this.selected.has(`${s.src}:${s.id}`));
        const nSel = selItems.length;
        return el.child(h_flex()
          .h(30)
          .flex_none()
          .mx(8)
          .mt(6)
          .px(8)
          .gap(6)
          .items_center()
          .rounded(6)
          .bg(t.raised)
          .border(1)
          .border_color(t.border)
          .child(div()
            .id("ses-sel-all")
            .px(6)
            .py(2)
            .rounded(4)
            .text_size(11)
            .text_color(t.accent)
            .cursor_pointer()
            .hover((h) => h.bg(t.hover))
            .on_click((_e, cx) => {
              if (allSelected) {
                for (const s of list) this.selected.delete(`${s.src}:${s.id}`);
              } else {
                for (const s of list) this.selected.add(`${s.src}:${s.id}`);
              }
              this.confirmBatch = false;
              cx.notify();
            })
            .child(allSelected ? pick("取消全选", "Deselect all") : pick("全选", "Select all")))
          .child(div().text_size(11).text_color(t.dim).child(`已选 ${nSel}`))
          .child(div().flex_1())
          .when(this.confirmBatch && nSel > 0, (b) => b
            .child(div()
              .id("ses-batch-ok")
              .h(20)
              .px(7)
              .flex()
              .items_center()
              .rounded(4)
              .bg(t.blocked)
              .text_size(10.5)
              .font_semibold()
              .text_color(t.accent_foreground ?? "#ffffff")
              .cursor_pointer()
              .on_click((_e, cx) => this.deleteItems(selItems, cx))
              .child(this.deleting ? pick("删除中…", "Deleting…") : `确认删除 ${nSel} 条`))
            .child(div()
              .id("ses-batch-no")
              .h(20)
              .px(6)
              .flex()
              .items_center()
              .rounded(4)
              .text_size(10.5)
              .text_color(t.muted)
              .cursor_pointer()
              .hover((h) => h.bg(t.hover).text_color(t.foreground))
              .on_click((_e, cx) => {
                this.confirmBatch = false;
                cx.notify();
              })
              .child(pick("取消", "Cancel"))))
          .when(!this.confirmBatch, (b) => b.child(div()
            .id("ses-batch-del")
            .h(20)
            .px(7)
            .flex()
            .items_center()
            .rounded(4)
            .text_size(10.5)
            .font_medium()
            .when(nSel > 0, (el) => el.bg(t.blocked + "22"))
            .text_color(nSel > 0 ? t.blocked : t.dim)
            .when(nSel > 0, (x) => x.cursor_pointer().hover((h) => h.bg(t.blocked + "33")).on_click((_e, cx) => {
              this.confirmBatch = true;
              cx.notify();
            }))
            .child(nSel > 0 ? `删除 (${nSel})` : pick("删除", "Delete")))));
      })
      .when(this.failed, (el) => el.child(v_flex().px(10).py(6).gap(4).flex_none()
        .child(div().text_size(12).text_color(t.blocked).child(this.list.length
          ? pick("刷新会话失败，仍显示上次结果。", "Couldn't refresh sessions; still showing the last result.")
          : pick("扫描会话失败，点右上角「刷新」重试。", "Couldn't scan sessions; use “Refresh” at the top right to retry.")))
        .when(Boolean(this.failReason), (box) => box.child(div().text_size(11).text_color(t.dim).child(this.failReason)))))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .px(6)
        .py(6)
        .gap(1)
        .overflow_y_scrollbar()
        .children(list.length
          ? list.map((s, i) => this.row(s, i, t, cx))
          : this.failed ? [] : [this.emptyState(t, hasFilter, scoped.length, cx)]))
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
          : pick("OMP / Codex / Claude / Pi / 本地", "OMP / Codex / Claude / Pi / Local")))
        .child(div().flex_none().child(this.manage ? pick("点行勾选 · Esc 退出", "Click a row to tick it · Esc leaves") : pick("点行恢复 · Esc 清空搜索", "Click a row to resume · Esc clears the search"))));
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

  timePill(t, id, label, cx) {
    const on = this.timeRange === id;
    return div()
      .id(`ses-time-${id}`)
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
        this.timeRange = id;
        this.confirmBatch = false;
        cx.notify();
      })
      .child(label);
  }

  emptyState(t, hasFilter, scopedCount, cx) {
    if (this.loading) {
      return div().p(10).text_size(12).text_color(t.dim).child(pick("正在扫描会话…", "Scanning sessions…"));
    }
    if (hasFilter) {
      return v_flex().p(10).gap(8).items_start()
        .child(div().text_size(12).text_color(t.dim).child(pick("没有符合条件的会话。", "No sessions match.")))
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
            this.timeRange = "all";
            this.input.set_value("");
            cx.notify();
          })
          .child(pick("清除筛选", "Clear the filters")));
    }
    if (!this.all && scopedCount === 0 && this.list.length > 0) {
      return v_flex().p(10).gap(8).items_start()
        .child(div().text_size(12).text_color(t.dim).child(pick("当前空间目录还没有会话记录。", "This space's folder has no sessions yet.")))
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
    return div().p(10).text_size(12).text_color(t.dim).child(pick("还没有找到会话记录。", "No sessions found yet."));
  }
}
