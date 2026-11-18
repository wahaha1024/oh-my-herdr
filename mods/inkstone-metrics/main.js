// 系统资源：状态栏显示 CPU 占用与内存，点开看总览和吃内存最多的进程。
// 取自 VladTemp27/herdr-orca 的 System Resource Meter：
//   - Windows：.NET PerformanceCounter + Win32_OperatingSystem；
//   - macOS：sysctl hw.memsize + vm_stat + top + ps + kill；
//   - Linux：/proc/stat + /proc/meminfo + ps + kill。

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { exec, props, closeOverlay, theme, run, window } from "herdr";

const SAMPLE = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  [
    "$cpu = New-Object System.Diagnostics.PerformanceCounter('Processor','% Processor Time','_Total')",
    "$mem = New-Object System.Diagnostics.PerformanceCounter('Memory','Available MBytes')",
    "$null = $cpu.NextValue()",
    "Start-Sleep -Milliseconds 300",
    "$c = [int][math]::Round($cpu.NextValue())",
    "$m = [int]$mem.NextValue()",
    "\"$c|$m\"",
  ].join("\n"),
];

const TOTAL = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "$o=Get-CimInstance Win32_OperatingSystem; [math]::Round([double]$o.TotalVisibleMemorySize/1MB,1)",
];

const PROCS = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "Get-Process -ErrorAction SilentlyContinue | Sort-Object WS -Descending | Select-Object -First 8 | ForEach-Object { \"$($_.ProcessName)|$($_.Id)|$([math]::Round($_.WS/1MB,1))\" }",
];

const MAC_SAMPLE = [
  "ps=$(pagesize 2>/dev/null || sysctl -n hw.pagesize 2>/dev/null || echo 16384)",
  "mb=$(vm_stat | awk -v ps=\"$ps\" '",
  "  /Pages active:/ { gsub(/\\./,\"\",$NF); a=$NF }",
  "  /Pages wired down:/ { gsub(/\\./,\"\",$NF); w=$NF }",
  "  /Pages occupied by compressor:/ { gsub(/\\./,\"\",$NF); c=$NF }",
  "  END { printf \"%.0f\", ((a+w+c)*ps)/1048576 }",
  "')",
  "cpu=$(top -l 2 -n 0 -s 0 2>/dev/null | awk '/CPU usage:/ { line=$0 } END { n=split(line,f,/[ ,%]+/); for(i=1;i<=n;i++) if(f[i]==\"idle\" && i>1) { printf \"%d\", 100-f[i-1]; exit } }')",
  "printf \"%s|%s\\n\" \"${cpu:-}\" \"${mb:-}\"",
].join("\n");

const LINUX_SAMPLE = [
  "read -r _ u1 n1 s1 i1 w1 q1 sq1 _ < /proc/stat",
  "sleep 0.3",
  "read -r _ u2 n2 s2 i2 w2 q2 sq2 _ < /proc/stat",
  "t1=$((u1+n1+s1+i1+w1+q1+sq1)); t2=$((u2+n2+s2+i2+w2+q2+sq2))",
  "dt=$((t2-t1)); di=$((i2+w2-i1-w1))",
  "cpu=\"\"; [ \"$dt\" -gt 0 ] && cpu=$(( (dt - di) * 100 / dt ))",
  "mb=$(awk '/MemTotal:/ { t=$2 } /MemAvailable:/ { a=$2 } END { if (t>0) printf \"%.0f\", (t-a)/1024 }' /proc/meminfo)",
  "printf \"%s|%s\\n\" \"$cpu\" \"$mb\"",
].join("\n");

const UNIX_PROCS = "ps -axo pid=,rss=,comm= 2>/dev/null | sort -k2 -nr | head -n 8 | awk '{ p=$1; r=$2; $1=\"\"; $2=\"\"; sub(/^ +/,\"\"); n=split($0,a,\"/\"); printf \"%s|%s|%.1f\\n\", a[n], p, r/1024 }'";
const plat = () => window()?.platform ?? "windows";

const ff = (n) => (n >= 10 ? n.toFixed(1) : n.toFixed(2));

export default class Metrics extends View {
  init(_p, cx) {
    this.scroll = ScrollHandle.new();
    this.cpu = null;
    this.used = null;
    this.total = null;
    this.procs = [];
    this.loadTotal(cx);
    this.sample(cx);
    cx.timer.every(20000, (cx) => this.sample(cx));
    if (props()?.overlay) this.loadProcs(cx);
  }

  loadTotal(cx) {
    const p = plat();
    const cmd = p === "windows"
      ? ["powershell", TOTAL]
      : p === "macos"
        ? ["sysctl", ["-n", "hw.memsize"]]
        : ["sh", ["-c", "awk '/MemTotal:/ { printf \"%.1f\", $2/1048576 }' /proc/meminfo"]];
    cx.spawn(async (cx) => {
      const r = await exec(cmd[0], cmd[1], { timeout: 15000 }).catch(() => null);
      const raw = Number((r?.stdout ?? "").trim());
      const n = p === "macos" ? raw / 1073741824 : raw;
      if (r?.code === 0 && Number.isFinite(n) && n > 0) this.total = n;
      cx.notify();
    });
  }

  sample(cx) {
    if (this.busy) return;
    this.busy = true;
    const p = plat();
    const cmd = p === "windows"
      ? ["powershell", SAMPLE]
      : ["sh", ["-c", p === "macos" ? MAC_SAMPLE : LINUX_SAMPLE]];
    cx.spawn(async (cx) => {
      const r = await exec(cmd[0], cmd[1], { timeout: 15000 }).catch(() => null);
      if (r?.code === 0) {
        const [cpuText, memText] = (r.stdout ?? "").trim().split("|");
        const cpu = cpuText === "" ? NaN : Number(cpuText);
        const mem = memText === "" ? NaN : Number(memText);
        if (Number.isFinite(cpu)) this.cpu = Math.max(0, Math.min(100, cpu));
        if (Number.isFinite(mem)) {
          if (p === "windows" && this.total) this.used = Math.max(0, this.total - mem / 1024);
          else if (p !== "windows") this.used = Math.max(0, mem / 1024);
        }
      }
      this.busy = false;
      cx.notify();
    });
  }

  loadProcs(cx) {
    const p = plat();
    const cmd = p === "windows" ? ["powershell", PROCS] : ["sh", ["-c", UNIX_PROCS]];
    cx.spawn(async (cx) => {
      const r = await exec(cmd[0], cmd[1], { timeout: 15000 }).catch(() => null);
      this.procs = (r?.stdout ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, pid, mb] = line.split("|");
          return { name, pid: Number(pid), mb: Number(mb) };
        })
        .filter((x) => Number.isFinite(x.pid) && x.pid > 0);
      cx.notify();
    });
  }

  stop(pid, cx) {
    const p = plat();
    const job = p === "windows"
      ? exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`])
      : exec("kill", ["-9", String(pid)]);
    job
      .catch(() => {})
      .then(() => {
        this.procs = this.procs.filter((x) => x.pid !== pid);
        cx.notify();
      });
  }

  tone(t) {
    if (this.cpu === null) return t.dim;
    if (this.cpu >= 85) return t.blocked;
    if (this.cpu >= 60) return t.working;
    return t.muted;
  }

  bar(value, max, color, t, height = 4) {
    const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    return div()
      .h(height)
      .w_full()
      .rounded(height / 2)
      .bg(t.border)
      .child(div().h(height).w(Math.round(pct * 1000) / 10, "%").rounded(height / 2).bg(color));
  }

  // 状态栏形态：CPU 12% · 3.8 GB。两段数字各自固定宽度，位数变化时右侧列不抖。
  compact(t) {
    const cpu = this.cpu === null ? "—" : `${this.cpu}%`;
    const mem = this.used === null ? "—" : `${ff(this.used)} GB`;
    return h_flex()
      .id("metrics-compact")
      .size_full()
      .flex_none()
      .px(8)
      .gap(5)
      .items_center()
      .border_l(1)
      .border_color(t.border)
      .cursor_pointer()
      .tooltip(this.total ? `内存 ${ff(this.used ?? 0)} / ${ff(this.total)} GB\n${cpu} · 点开看进程` : "读取系统资源…")
      .accessibility_label(`系统资源 CPU ${cpu} 内存 ${mem}`)
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("mod.open", { name: "inkstone-metrics" }))
      .child(svg("mods/workspace-chrome/monitor.svg").size(12).flex_none().text_color(this.tone(t)))
      .child(div().w(44).flex_none().whitespace_nowrap().text_size(11).text_color(this.tone(t)).child(`CPU ${cpu}`))
      .child(div().text_size(11).text_color(t.dim).child("·"))
      .child(div().w(56).flex_none().whitespace_nowrap().text_size(11).text_color(t.muted).child(mem));
  }

  popup(t, cx) {
    const cpu = this.cpu ?? 0;
    const used = this.used ?? 0;
    const total = this.total ?? 0;
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
        .child(svg("mods/workspace-chrome/monitor.svg").size(14).flex_none().text_color(t.accent))
        .child(div().flex_1().text_size(13).font_semibold().child("系统资源"))
        .child(div()
          .id("metrics-close")
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
        .p(12)
        .gap(14)
        .overflow_y_scrollbar()
        .mode("always")
        .track_scroll(this.scroll)
        .child(v_flex()
          .gap(5)
          .child(h_flex().items_center().justify_between()
            .child(div().text_size(12).text_color(t.muted).child("CPU 占用"))
            .child(div().text_size(12).text_color(this.tone(t)).child(this.cpu === null ? "—" : `${cpu}%`)))
          .child(this.bar(cpu, 100, this.tone(t), t, 6)))
        .child(v_flex()
          .gap(5)
          .child(h_flex().items_center().justify_between()
            .child(div().text_size(12).text_color(t.muted).child("物理内存"))
            .child(div().text_size(12).text_color(t.foreground).child(total ? `${ff(used)} / ${ff(total)} GB` : "—")))
          .child(this.bar(used, total || 1, used / (total || 1) >= 0.9 ? t.blocked : t.accent, t, 6)))
        .child(h_flex().items_center().justify_between()
          .child(div().text_size(11).text_color(t.dim).child("占用最高的进程"))
          .child(div()
            .id("metrics-refresh")
            .px(7)
            .py(2)
            .rounded(5)
            .text_size(11)
            .text_color(t.dim)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click(() => this.loadProcs(cx))
            .child("刷新")))
        .child(v_flex()
          .gap(1)
          .children(this.procs.length
            ? this.procs.map((p) => h_flex()
              .id(`proc-${p.pid}`)
              .h(28)
              .flex_none()
              .px(8)
              .gap(8)
              .items_center()
              .rounded(6)
              .hover((s) => s.bg(t.hover))
              .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).tooltip(`${p.name} (${p.pid})`).child(p.name))
              .child(div().w(66).flex_none().text_size(11).text_color(p.mb >= 2048 ? t.working : t.dim).child(`${p.mb.toFixed(0)} MB`))
              .child(div()
                .id(`proc-stop-${p.pid}`)
                .px(7)
                .py(2)
                .rounded(5)
                .text_size(11)
                .text_color(t.dim)
                .cursor_pointer()
                .hover((s) => s.bg(t.blocked).text_color(t.solid_foreground))
                .tooltip("结束该进程")
                .on_click(() => this.stop(p.pid, cx))
                .child("结束")))
            : [div().px(8).py(8).text_size(12).text_color(t.dim).child("读取中…")])));
  }

  render(cx) {
    const t = theme();
    return props()?.overlay ? this.popup(t, cx) : this.compact(t);
  }
}
