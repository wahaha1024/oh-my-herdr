// 驾驶舱（Cockpit）：一屏看完所有智能体正在做什么、谁在等你。
// 取自 quaresc/cockpit 的核心三件事，用本机 API 重写为中文面板：
//   1. 待您处理（NEEDS YOU）：被确认 / 提问 / 报错卡住的智能体置顶，一键跳过去；
//   2. 下一步行动（NEXT MOVE）：等得最久的那个智能体，带时长；
//   3. 全景：每个空间 / 标签里的智能体、状态与已经运行多久。
// Cockpit 上游是 macOS / Linux 的 Rust TUI 插件，Windows 上无法运行它的二进制，
// 所以这里保留它的信息结构，界面用 herdr 的 mod 重画。

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, run, theme } from "herdr";

const LABEL = { working: "运行中", blocked: "待处理", done: "已完成", idle: "空闲" };
const tone = (t, s) => (s === "blocked" ? t.blocked : s === "done" ? t.done : s === "working" ? t.working : t.idle ?? t.dim);

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
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时`;
  return `${Math.floor(h / 24)} 天`;
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
    run("space.select", { id: a.space });
    run("tab.select", { id: a.tab });
    run("agent.focus", { terminal: a.address });
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
      .tooltip(`${a.program?.name ?? a.app ?? "智能体"} · ${a.space_name} · ${a.tab_name}`)
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
    const list = agents();
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

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .child(h_flex()
        .h(34)
        .flex_none()
        .px(14)
        .gap(8)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(svg("mods/workspace-chrome/layers.svg").size(14).flex_none().text_color(t.accent))
        .child(div().flex_1().text_size(13).font_semibold().child("驾驶舱"))
        .child(div().text_size(11).text_color(blocked.length ? t.blocked : t.dim).child(blocked.length ? `${blocked.length} 待您处理` : "全部就绪")))
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
          .child(this.tile("ck-t-agents", "智能体", String(list.length), t.foreground, t))
          .child(this.tile("ck-t-needs", "待处理", String(blocked.length), blocked.length ? t.blocked : t.foreground, t))
          .child(this.tile("ck-t-work", "运行中", String(working.length), t.foreground, t))
          .child(this.tile("ck-t-done", "已完成", String(done.length), done.length ? t.done : t.foreground, t)))
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
            .child(h_flex().gap(6).items_center().child(div().text_size(11).text_color(t.dim).child("下一步行动"))
              .child(div().flex_1())
              .child(div().text_size(11).text_color(t.dim).child(duration(Date.now() - (next.since ?? Date.now())))))
            .child(div().text_size(13).font_semibold().text_color(blocked.length ? t.blocked : t.foreground).truncate().child(clean(next.a.title) || next.a.program?.name || next.a.address))
            .child(div().text_size(11).text_color(t.dim).child(`${next.a.space_name} · ${next.a.tab_name} · ${LABEL[next.a.status] ?? next.a.status}`))
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
                .child("去处理")))),
        )
        .when(blocked.length > 0, (el) => el.child(header("待您处理", blocked.length, t.blocked)).children(blocked.map((a) => this.row(a, t, "等待中"))))
        .child(header("智能体", list.length))
        .when(list.length === 0, (el) => el.child(div().px(14).py(8).text_size(12).text_color(t.dim).child("还没有智能体在跑。在终端里启动一个 agent 就会出现在这里。")))
        .children(list.filter((a) => a.status !== "blocked").map((a) => {
          const started = since(a.space, a.tab);
          return this.row(a, t, started ? duration(Date.now() - started) : "");
        })));
  }
}
