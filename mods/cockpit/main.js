// 驾驶舱（Cockpit）：一屏看完所有智能体正在做什么、谁在等你。
// 取自 quaresc/cockpit 的核心三件事，用本机 API 重写为中文面板：
//   1. 待您处理（NEEDS YOU）：被确认 / 提问 / 报错卡住的智能体置顶，一键跳过去；
//   2. 下一步行动（NEXT MOVE）：等得最久的那个智能体，带时长；
//   3. 全景：每个 Space / 标签里的智能体、状态与已经运行多久。
// Cockpit 上游是 macOS / Linux 的 Rust TUI 插件，Windows 上无法运行它的二进制，
// 所以这里保留它的信息结构，界面用 herdr 的 mod 重画。

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, run, theme, props, closeOverlay, shared } from "herdr";

// 中英切换：shared 改动会让所有 mod 重绘，切换语言立即生效。
const LANG = "inkstone.lang";
const pick = (zh, en) => (shared(LANG) === "en" ? en : zh);

const LABEL = () => ({ working: pick("运行中", "Running"), blocked: pick("待处理", "Waiting"), done: pick("已完成", "Done"), idle: pick("空闲", "Idle") });
const tone = (t, s) => (s === "blocked" ? t.blocked : s === "done" ? t.done : s === "working" ? t.working : t.idle ?? t.dim);
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
function paperCard(view, t, content, fixedW, fixedH) {
  const dir = artEdgeDir(t);
  const line = tint(t.accent, "cc");
  if (!dir) {
    const box = content.rounded(8).border(1).border_color(line);
    return fixedW && fixedH ? box.w(fixedW).h(fixedH) : box;
  }
  const w = Math.max(240, fixedW ?? view._cardW ?? 396);
  const h = Math.max(200, fixedH ?? view._cardH ?? 460);
  const sideH = Math.max(0, h - 2 * EDGE_T);
  const art = (name, iw, ih) => image(`mods/inkstone-edge/${dir}/${name}.svg`).absolute().w(iw).h(ih);
  const hEdge = (side) => div().relative().w_full().h(EDGE_T).flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(Math.max(0, w - EDGE_CORNER)).h(EDGE_T).overflow_hidden().child(art(`${side}-l`, EDGE_LONG, EDGE_T).left(0).top(0)))
    .child(div().absolute().right(0).top(0).w(Math.min(w, EDGE_CORNER)).h(EDGE_T).overflow_hidden().child(art(`${side}-r`, EDGE_CORNER, EDGE_T).right(0).top(0)));
  const vEdge = (side) => div().relative().w(EDGE_T).h_full().flex_none().overflow_hidden()
    .child(div().absolute().left(0).top(0).w(EDGE_T).h(Math.max(0, sideH - EDGE_FOOT)).overflow_hidden().child(art(`${side}-t`, EDGE_T, EDGE_TALL).left(0).top(0)))
    .child(div().absolute().left(0).bottom(0).w(EDGE_T).h(Math.min(sideH, EDGE_FOOT)).overflow_hidden().child(art(`${side}-b`, EDGE_T, EDGE_FOOT).left(0).bottom(0)));
  const root = v_flex().id("ck-card");
  return (fixedW && fixedH ? root.w(w).h(h) : root.size_full().min_h(0)
    .on_size_change((sz, cx) => {
      if (Math.abs((view._cardW ?? 0) - sz.width) >= 1 || Math.abs((view._cardH ?? 0) - sz.height) >= 1) {
        view._cardW = sz.width;
        view._cardH = sz.height;
        cx.notify();
      }
    }))
    .child(hEdge("top"))
    .child(h_flex().w_full().flex_1().min_h(0)
      .child(vEdge("left"))
      .child(div().flex_1().min_w(0).min_h(0).h_full().overflow_hidden().border(1).border_color(line).child(content))
      .child(vEdge("right")))
    .child(hEdge("bottom"));
}

function dot(t, status, size = 7) {
  if (status === "idle" || !status) return div().size(size).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(size).flex_none().rounded(4).bg(tone(t, status));
}

// 一个智能体所属标签开始运行的时刻：tab.working_since。
function since(spaceId, tabId) {
  const tab = spaces().find((s) => s.id === spaceId)?.tabs?.find((c) => c.id === tabId);
  return tab?.working_since ?? null;
}

function duration(ms) {
  if (!ms || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return pick("刚刚", "just now");
  if (m < 60) return pick(`${m} 分钟`, `${m} min`);
  const h = Math.floor(m / 60);
  if (h < 24) return pick(`${h} 小时`, `${h} h`);
  return pick(`${Math.floor(h / 24)} 天`, `${Math.floor(h / 24)} d`);
}

// 智能体的标题来自终端输出，常带进度符号、Nerd Font 私有区图标和 emoji：
// 本机字体没有字形会画成豆腐块，先剥掉再显示。
function clean(text) {
  if (text == null) return "";
  return String(text)
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[\uFE00-\uFE0F\u200B-\u200F\u2028\u2029]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default class Cockpit extends View {
  init(_props, cx) {
    // 时长要随时间走：每分钟重画一次，比监听数据更省。
    cx.timer.every(60000, (cx) => cx.notify());
  }

  go(a) {
    const sp = spaces().find((s) => s.id === a.space);
    if (sp && !sp.active) run("space.select", { id: a.space });
    if (a.tab && !sp?.tabs?.find((x) => x.id === a.tab)?.active) run("tab.select", { id: a.tab });
    run("agent.focus", { terminal: a.address });
    if (props()?.overlay) closeOverlay(props().overlay);
  }

  tile(id, label, value, color, t, onClick) {
    return v_flex()
      .id(id)
      .flex_1()
      .min_w(0)
      .gap(2)
      .p(10)
      .rounded(9)
      .bg(t.surface)
      .border(1)
      .border_color(t.border)
      .when(Boolean(onClick), (el) => el.cursor_pointer().hover((s) => s.bg(t.raised)).on_click(onClick))
      .child(div().text_size(11).text_color(t.dim).child(label))
      .child(div().text_size(17).font_semibold().text_color(color).child(value));
  }

  row(a, t, extra) {
    return h_flex()
      .id(`ck-${a.address}`)
      .h(34)
      .flex_none()
      .px(10)
      .gap(8)
      .items_center()
      .rounded(8)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(`${a.program?.name ?? a.app ?? "Agents"} · ${a.space_name} · ${a.tab_name}`)
      .on_click(() => this.go(a))
      .child(dot(t, a.status))
      .child(v_flex()
        .flex_1()
        .min_w(0)
        .gap(1)
        .child(div().truncate().text_size(12).text_color(a.status === "blocked" ? t.blocked : t.foreground).child(clean(a.title) || a.program?.name || a.address))
        .child(div().truncate().text_size(11).text_color(t.dim).child(`${a.space_name} · ${a.tab_name}${a.app ? ` · ${a.app}` : ""}`)))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(extra ?? ""));
  }

  render() {
    const t = theme();
    // 休眠会话（tab.settle）的智能体不进驾驶舱：会话已收起，恢复后再出现。
    const asleep = new Set();
    for (const s of spaces()) for (const c of s.tabs ?? []) if (c.settled) asleep.add(c.id);
    const list = agents().filter((a) => !asleep.has(a.tab));
    const blocked = list.filter((a) => a.status === "blocked");
    const working = list.filter((a) => a.status === "working");
    const done = list.filter((a) => a.status === "done");
    // 下一步行动：卡住的里等最久的（working_since 最早），否则运行最久的。
    const pool = blocked.length ? blocked : working;
    const next = pool
      .map((a) => ({ a, since: since(a.space, a.tab) }))
      .sort((x, y) => (x.since ?? Infinity) - (y.since ?? Infinity))[0];
    const header = (text, count, color) =>
      h_flex()
        .h(28)
        .flex_none()
        .px(12)
        .items_center()
        .justify_between()
        .text_size(11)
        .text_color(t.dim)
        .child(text)
        .when(count !== undefined, (el) => el.child(div().text_color(color ?? t.dim).child(String(count))));

    const p = props();
    const framed = Boolean(p?.framed);
    const inner = v_flex()
      .size_full()
      .min_h(0)
      .bg(framed ? (t.paper ?? t.background) : t.chrome)
      .child(h_flex()
        .h(34)
        .flex_none()
        .px(14)
        .gap(8)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(svg("mods/inkstone-chrome/layers.svg").size(14).flex_none().text_color(t.accent))
        .child(div().flex_1().text_size(13).font_semibold().child(pick("驾驶舱", "Cockpit")))
        .child(div().text_size(11).text_color(blocked.length ? t.blocked : t.dim).child(blocked.length ? pick(`${blocked.length} 待您处理`, `${blocked.length} need you`) : pick("全部就绪", "All clear")))
        .when(Boolean(props()?.overlay), (el) => el.child(div()
          .id("ck-close")
          .px(6)
          .py(2)
          .rounded(5)
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(props()?.overlay))
          .child("Esc"))))
      .child(v_flex()
        .id("ck-body")
        .flex_1()
        .min_h(0)
        .overflow_y_scrollbar()
        .mode("always")
        .pb(10)
        .child(h_flex()
          .flex_none()
          .gap(8)
          .px(10)
          .pt(10)
          .child(this.tile("ck-t-agents", "Agents", String(list.length), t.foreground, t))
          .child(this.tile("ck-t-needs", pick("待处理", "Waiting"), String(blocked.length), blocked.length ? t.blocked : t.foreground, t))
          .child(this.tile("ck-t-work", pick("运行中", "Running"), String(working.length), t.foreground, t))
          .child(this.tile("ck-t-done", pick("已完成", "Done"), String(done.length), done.length ? t.done : t.foreground, t)))
        .when(Boolean(next), (el) => el.child(
          v_flex()
            .id("ck-next")
            .mx(10)
            .mt(10)
            .p(11)
            .gap(6)
            .rounded(10)
            .bg(t.raised)
            .border(1)
            .border_color(blocked.length ? t.blocked : t.border)
            .child(h_flex().gap(6).items_center().child(div().text_size(11).text_color(t.dim).child(pick("下一步行动", "Next step")))
              .child(div().flex_1())
              .child(div().text_size(11).text_color(t.dim).child(duration(Date.now() - (next.since ?? Date.now())))))
            .child(div().text_size(13).font_semibold().text_color(blocked.length ? t.blocked : t.foreground).truncate().child(clean(next.a.title) || next.a.program?.name || next.a.address))
            .child(div().text_size(11).text_color(t.dim).child(`${next.a.space_name} · ${next.a.tab_name} · ${LABEL()[next.a.status] ?? next.a.status}`))
            .child(h_flex().gap(8).items_center().child(div().flex_1())
              .child(div()
                .id("ck-go")
                .h(26)
                .px(12)
                .flex()
                .items_center()
                .justify_center()
                .rounded(7)
                .bg(t.solid)
                .text_color(t.solid_foreground)
                .text_size(12)
                .cursor_pointer()
                .hover((s) => s.opacity(0.88))
                .on_click(() => this.go(next.a))
                .child(pick("去处理", "Handle it"))))),
        )
        .when(blocked.length > 0, (el) => el.child(header(pick("待您处理", "Needs you"), blocked.length, t.blocked)).children(blocked.map((a) => this.row(a, t, pick("等待中", "Waiting")))))
        .child(header("Agents", list.length))
        .when(list.length === 0, (el) => el.child(div().px(14).py(8).text_size(12).text_color(t.dim).child(pick("还没有 Agents 在跑。在终端里启动一个 agent 就会出现在这里。", "No agent is running yet. Start one in a terminal and it shows up here."))))
        .children(list.filter((a) => a.status !== "blocked").map((a) => {
          const started = since(a.space, a.tab);
          return this.row(a, t, started ? duration(Date.now() - started) : "");
        })));
    return framed ? paperCard(this, t, inner, p?.width, p?.height) : inner;
  }
}
