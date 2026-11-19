// 活跃端口：状态栏一个紧凑指示器，点开是端口 / 进程清单。
// 取自 VladTemp27/herdr-orca 的 Live Ports 监视器：
//   - Windows：PowerShell Get-NetTCPConnection -State Listen + Get-Process；
//   - macOS：lsof -nP -iTCP -sTCP:LISTEN -F pcn + open + kill；
//   - Linux：lsof（优先）或 ss -ltnp + xdg-open + kill。
// 每一行可以「在浏览器中打开」或「停止服务」（结束对应进程）。

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { exec, run, props, closeOverlay, openOverlay, theme, themes, window } from "herdr";

const plat = () => window()?.platform ?? "windows";
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
  if (!dir) return content.rounded(8).border(1).border_color(line);
  const w = Math.max(200, view._cardW ?? 404);
  const h = Math.max(180, view._cardH ?? 484);
  const sideH = Math.max(0, h - 2 * EDGE_T);
  const art = (name, iw, ih) => image(`mods/inkstone-edge/${dir}/${name}.svg`).absolute().w(iw).h(ih);
  const hEdge = (side) => div().relative().w_full().h(EDGE_T).flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(Math.max(0, w - EDGE_CORNER)).h(EDGE_T).overflow_hidden().child(art(`${side}-l`, EDGE_LONG, EDGE_T).left(0).top(0)))
    .child(div().absolute().right(0).top(0).w(Math.min(w, EDGE_CORNER)).h(EDGE_T).overflow_hidden().child(art(`${side}-r`, EDGE_CORNER, EDGE_T).right(0).top(0)));
  const vEdge = (side) => div().relative().w(EDGE_T).h_full().flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(EDGE_T).h(Math.max(0, sideH - EDGE_FOOT)).overflow_hidden().child(art(`${side}-t`, EDGE_T, EDGE_TALL).left(0).top(0)))
    .child(div().absolute().left(0).bottom(0).w(EDGE_T).h(Math.min(sideH, EDGE_FOOT)).overflow_hidden().child(art(`${side}-b`, EDGE_T, EDGE_FOOT).left(0).bottom(0)));
  return v_flex().id("ports-card").size_full().min_h(0)
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

const POWERSHELL = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$map = @{}",
    "Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $map[[int]$_.Id] = $_.ProcessName }",
    "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ port=[int]$_.LocalPort; pid=[int]$_.OwningProcess; name=$map[[int]$_.OwningProcess]; addr=[string]$_.LocalAddress } } | Sort-Object port -Unique | ConvertTo-Json -Compress",
  ].join("\n"),
];

function parseLsof(text) {
  const seen = new Set();
  const out = [];
  let pid = 0;
  let name = "系统";
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line) continue;
    const tag = line[0];
    const val = line.slice(1);
    if (tag === "p") { pid = Number(val) || 0; name = "系统"; }
    else if (tag === "c") name = val || "系统";
    else if (tag === "n") {
      const idx = val.lastIndexOf(":");
      if (idx <= 0) continue;
      const port = Number(val.slice(idx + 1));
      const addr = val.slice(0, idx).replace(/^\[|\]$/g, "") || "*";
      if (port > 0 && !seen.has(port)) {
        seen.add(port);
        out.push({ port, pid, name, addr });
      }
    }
  }
  return out.sort((a, b) => a.port - b.port);
}

function parseSs(text) {
  const seen = new Set();
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/).slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const local = parts[3];
    const idx = local.lastIndexOf(":");
    if (idx <= 0) continue;
    const port = Number(local.slice(idx + 1));
    if (!port || seen.has(port)) continue;
    seen.add(port);
    const addr = local.slice(0, idx).replace(/^\[|\]$/g, "") || "*";
    const pm = /"([^"]+)",pid=(\d+)/.exec(line);
    out.push({ port, pid: pm ? Number(pm[2]) : 0, name: pm ? pm[1] : "系统", addr });
  }
  return out.sort((a, b) => a.port - b.port);
}

export default class Ports extends View {
  init(_p, cx) {
    this.scroll = ScrollHandle.new();
    this.list = [];
    this.failed = false;
    this.loaded = false;
    this.refresh(cx);
    cx.timer.every(15000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    const p = plat();
    const job = p === "windows"
      ? exec("powershell", POWERSHELL, { timeout: 8000 })
      : p === "macos"
        ? exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"], { timeout: 8000 })
        : exec("sh", ["-c", "if command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP -sTCP:LISTEN -F pcn; else echo __SS__; ss -ltnp 2>/dev/null; fi"], { timeout: 8000 });
    cx.spawn(async (cx) => {
      const r = await job.catch((e) => ({ code: -1, stdout: "", stderr: String(e) }));
      let next = [];
      const out = (r?.stdout ?? "").trim();
      if (r?.code === 0 && out) {
        if (p === "windows") {
          try {
            const parsed = JSON.parse(out);
            next = (Array.isArray(parsed) ? parsed : [parsed])
              .map((x) => ({ port: Number(x.port), pid: Number(x.pid), name: x.name || "系统", addr: x.addr || "*" }))
              .filter((x) => x.port > 0)
              .sort((a, b) => a.port - b.port);
          } catch (e) {
            console.warn(`inkstone-ports: JSON ${e}`);
          }
        } else if (out.startsWith("__SS__")) {
          next = parseSs(out.slice(6).trim());
        } else {
          next = parseLsof(out);
        }
      }
      this.loaded = true;
      // macOS 上没有任何进程监听时 lsof 返回退出码 1 且 stdout 为空，不算探测失败。
      const emptyLsof = p === "macos" && r?.code === 1 && !out && !(r?.stderr ?? "").trim();
      if (next.length || emptyLsof || r?.code === 0) this.failed = false;
      else if (r?.code !== 0) this.failed = true;
      this.list = next;
      this.busy = false;
      cx.notify();
    });
  }

  open(port) {
    const url = `http://127.0.0.1:${port}`;
    const p = plat();
    if (p === "windows") exec("cmd", ["/c", "start", "", url]).catch(() => {});
    else if (p === "macos") exec("open", [url]).catch(() => {});
    else exec("xdg-open", [url]).catch(() => {});
  }

  stop(id, port, cx) {
    if (!id) return;
    const p = plat();
    const job = p === "windows"
      ? exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Stop-Process -Id ${id} -Force -ErrorAction SilentlyContinue`])
      : exec("kill", ["-9", String(id)]);
    job
      .catch(() => {})
      .then(() => {
        this.list = this.list.filter((x) => !(x.pid === id && x.port === port));
        cx.notify();
      });
  }

  // 状态栏形态：一个图标 + 端口数，点开清单。读不到时显示「!」而不是 0，
  // 免得把「探测失败」看成「没有端口」。
  compact(t) {
    const n = this.list.length;
    const text = n ? String(n) : this.failed ? "!" : "—";
    const tip = n ? `${n} 个端口在监听` : this.failed ? "读取端口失败 · 点开查看" : "没有端口在监听";
    return h_flex()
      .id("ports-compact")
      .size_full()
      .flex_none()
      .px(8)
      .gap(5)
      .items_center()
      .border_l(1)
      .border_color(t.border)
      .cursor_pointer()
      .tooltip(tip)
      .accessibility_label(tip)
      .hover((s) => s.bg(t.hover))
      .on_click(() => openOverlay({ mod: "inkstone-ports", kind: "dialog", frame: "none", width: 404, height: 484, props: { framed: true } }))
      .child(svg("mods/workspace-chrome/server.svg").size(12).flex_none().text_color(n ? t.accent : this.failed ? t.blocked : t.dim))
      .child(div().w(20).flex_none().text_size(11).text_color(n ? t.muted : this.failed ? t.blocked : t.dim).child(text));
  }

  row(x, t, cx) {
    const web = ["0.0.0.0", "127.0.0.1", "::", "::1", ":::", "*"].includes(x.addr);
    return h_flex()
      .id(`port-${x.port}-${x.pid}`)
      .h(30)
      .flex_none()
      .px(10)
      .gap(8)
      .items_center()
      .rounded(6)
      .hover((s) => s.bg(t.hover))
      .child(div().w(56).flex_none().text_size(12).font_semibold().text_color(t.foreground).child(String(x.port)))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).tooltip(`${x.name} (${x.pid}) · ${x.addr}`).child(`${x.name} · ${x.pid}`))
      .when(web, (el) => el.child(div()
        .id(`port-open-${x.port}`)
        .px(8)
        .py(3)
        .rounded(6)
        .bg(t.raised)
        .text_size(11)
        .text_color(t.muted)
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .tooltip("在浏览器中打开")
        .on_click(() => this.open(x.port))
        .child("打开")))
      .child(div()
        .id(`port-stop-${x.port}`)
        .px(8)
        .py(3)
        .rounded(6)
        .text_size(11)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.blocked).text_color(t.solid_foreground))
        .tooltip("停止服务：结束该进程")
        .on_click(() => this.stop(x.pid, x.port, cx))
        .child("停止"));
  }

  popup(t, cx) {
    const inner = v_flex()
      .size_full()
      .min_h(0)
      .bg(t.paper ?? t.background)
      .child(h_flex()
        .h(34)
        .flex_none()
        .px(13)
        .gap(8)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(svg("mods/workspace-chrome/server.svg").size(14).flex_none().text_color(t.accent))
        .child(div().flex_1().text_size(13).font_semibold().child("活跃端口"))
        .child(div().text_size(11).text_color(t.dim).child(this.list.length ? `${this.list.length} 个在监听` : "无"))
        .child(div()
          .id("ports-close")
          .px(6)
          .py(2)
          .rounded(5)
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(props()?.overlay))
          .child("Esc")))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .px(6)
        .py(6)
        .gap(1)
        .overflow_y_scrollbar()
        .mode("always")
        .track_scroll(this.scroll)
        .children(this.list.length
          ? this.list.map((x) => this.row(x, t, cx))
          : [div().px(10).py(10).text_size(12).text_color(t.dim).child(this.failed ? (plat() === "windows" ? "读取端口失败：需要 PowerShell 的 Get-NetTCPConnection。" : "读取端口失败：需要 lsof 或 ss 可用。") : this.loaded ? "没有端口在监听。" : "正在扫描端口…")]));
    return props()?.framed ? paperCard(this, t, inner) : inner;
  }

  render(cx) {
    const t = theme();
    return props()?.overlay ? this.popup(t, cx) : this.compact(t);
  }
}
