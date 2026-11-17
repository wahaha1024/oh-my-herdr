// 活跃端口：状态栏一个紧凑指示器，点开是端口 / 进程清单。
// 取自 VladTemp27/herdr-orca 的 Live Ports 监视器；上游用 lsof（macOS / Linux），
// Windows 上改成 PowerShell 的 Get-NetTCPConnection -State Listen + Get-Process 取名。
// 每一行可以「在浏览器中打开」或「停止服务」（结束对应进程）。

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { exec, run, props, closeOverlay, theme } from "herdr";

const POWERSHELL = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  [
    "$map = @{}",
    "Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $map[[int]$_.Id] = $_.ProcessName }",
    "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ port=[int]$_.LocalPort; pid=[int]$_.OwningProcess; name=$map[[int]$_.OwningProcess]; addr=[string]$_.LocalAddress } } | Sort-Object port -Unique | ConvertTo-Json -Compress",
  ].join("\n"),
];

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
    cx.spawn(async (cx) => {
      const r = await exec("powershell", POWERSHELL, { timeout: 8000 }).catch((e) => ({ code: -1, stdout: "", stderr: String(e) }));
      let next = [];
      if (r?.code === 0 && r.stdout.trim()) {
        try {
          const parsed = JSON.parse(r.stdout.trim());
          next = (Array.isArray(parsed) ? parsed : [parsed])
            .map((x) => ({ port: Number(x.port), pid: Number(x.pid), name: x.name || "系统", addr: x.addr || "*" }))
            .filter((x) => x.port > 0)
            .sort((a, b) => a.port - b.port);
        } catch (e) {
          console.warn(`inkstone-ports: JSON ${e}`);
        }
      }
      this.loaded = true;
      if (next.length) this.failed = false;
      else if (r?.code !== 0) this.failed = true;
      this.list = next;
      this.busy = false;
      cx.notify();
    });
  }

  open(port) {
    exec("cmd", ["/c", "start", "", `http://127.0.0.1:${port}`]).catch(() => {});
  }

  stop(id, port, cx) {
    exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Stop-Process -Id ${id} -Force -ErrorAction SilentlyContinue`])
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
      .on_click(() => run("mod.open", { name: "inkstone-ports" }))
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
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
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
          : [div().px(10).py(10).text_size(12).text_color(t.dim).child(this.failed ? "读取端口失败：需要 PowerShell 的 Get-NetTCPConnection。" : this.loaded ? "没有端口在监听。" : "正在扫描端口…")]));
  }

  render(cx) {
    const t = theme();
    return props()?.overlay ? this.popup(t, cx) : this.compact(t);
  }
}
