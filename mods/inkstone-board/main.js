// 看板：侧栏里的一列纵向分组——待你处理 / 进行中 / 待合并 / 空闲。
// 一行 = 一个标签（agent 的状态、分支、PR 由分支串起来）；点一行切到那个标签并聚焦它的终端。
// PR 数据来自 `gh pr list`，每个仓库根 90 秒一次；拿不到就只凭 agent 与终端分组，不阻塞渲染。

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, panes, run, theme, exec } from "herdr";

// 纸感只在定义了 paper 槽的主题下渲染（与其余 inkstone mod 同一判定）。
const PAPER = (t) => Boolean(t.paper);
// 主题槽可能自带 8 位 alpha（如 #ffffff18），只在纯 6 位色上补 alpha，避免拼出非法字面量。
const withAlpha = (c, a) => (/^#[0-9a-fA-F]{6}$/.test(c ?? "") ? `${c}${a}` : c);

const SECTIONS = [
  { id: "needs", name: "待你处理", tone: "blocked" },
  { id: "progress", name: "进行中", tone: "working" },
  { id: "review", name: "待合并", tone: "accent" },
  { id: "idle", name: "空闲", tone: "dim" },
];

// 羊皮纸：一档图按实际宽度拉伸，取最近的档位而不是精确命中，避免 404。
const PAD = 5, TALL = 1600;
const PARCHMENT = [144, 160, 176, 192, 208, 224, 240, 256, 272, 288, 304, 320, 336, 352, 368, 384, 400];
const nearestSheet = (w) => PARCHMENT.reduce((best, v) => (Math.abs(v - w) < Math.abs(best - w) ? v : best), PARCHMENT[0]);

// 这块画整张纸的 mid（只露两侧）：上接 workbench 的 paper、下接页脚的纸沿。
function sheet(view, part, content) {
  const w = Math.max(1, view.sheetW ?? 240), h = Math.max(1, view.sheetH ?? 400);
  const W = nearestSheet(w);
  const art = () => image(`mods/inkstone-chrome/ink/parchment-${W}.svg`).absolute().left(-PAD).w(w + 2 * PAD).h(TALL + 2 * PAD);
  const crop = part === "top" ? div().absolute().left(0).top(-PAD).w(w).h(h + PAD).overflow_hidden().child(art().top(0))
    : part === "foot" ? div().absolute().left(0).bottom(-PAD).w(w).h(h + PAD).overflow_hidden().child(art().bottom(0))
    : div().absolute().left(0).top(0).w(w).h(h).overflow_hidden().child(art().top(-520));
  return div().size_full().px(8)
    .child(div().id(`${part}-sheet`).relative().size_full()
      .on_size_change((size, cx) => {
        if (Math.abs((view.sheetW ?? 0) - size.width) >= 1 || Math.abs((view.sheetH ?? 0) - size.height) >= 1) {
          view.sheetW = size.width;
          view.sheetH = size.height;
          cx.notify();
        }
      })
      .child(crop)
      .child(div().relative().size_full().child(content)));
}

function since(ms) {
  if (!ms) return "";
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? "<1m" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

export default class Board extends View {
  init(_props, cx) {
    this.repos = {};
    this.busy = false;
    cx.timer.every(30000, (cx) => cx.notify());
    cx.timer.every(60000, () => this.refresh(cx));
    this.refresh(cx);
  }

  // 每个可能装着仓库的空间目录跑一次 gh；结果按目录缓存 90 秒。
  refresh(cx) {
    const folders = new Set();
    for (const s of spaces()) if (s.folder) folders.add(s.folder);
    const now = Date.now();
    const work = [...folders].filter((f) => !this.repos[f] || now - this.repos[f].at > 90000);
    if (!work.length) return;
    this.busy = true;
    for (const folder of work) {
      this.repos[folder] = { ...(this.repos[folder] ?? {}), at: now };
      exec("gh", ["pr", "list", "--json", "number,headRefName,state,isDraft,reviewDecision,statusCheckRollup", "--limit", "50"], { cwd: folder, timeout: 20000 })
        .then((out) => {
          if (out.code !== 0) {
            this.repos[folder] = { at: now, prs: [] };
            return;
          }
          try {
            this.repos[folder] = { at: now, prs: JSON.parse(out.stdout || "[]") };
          } catch {
            this.repos[folder] = { at: now, prs: [] };
          }
        })
        .catch(() => {
          this.repos[folder] = { at: now, prs: [] };
        })
        .finally(() => {
          this.busy = false;
          cx.notify();
        });
    }
  }

  prFor(space, branch) {
    if (!branch) return null;
    const prs = this.repos[space.folder]?.prs ?? [];
    const key = branch.toLowerCase();
    return prs.find((p) => (p.headRefName ?? "").toLowerCase() === key) ?? null;
  }

  // 一行：优先用 agent 的状态，其次看分支上有没有 PR，最后按空闲处理。
  cards() {
    const list = agents();
    const all = panes();
    const out = [];
    for (const space of spaces()) {
      for (const tab of space.tabs ?? []) {
        const tabPanes = all.filter((p) => p.tab === tab.id && p.terminal);
        const agent = list.find((a) => a.tab === tab.id);
        const branch = tabPanes.find((p) => p.branch)?.branch ?? null;
        const pr = this.prFor(space, branch);
        const checks = pr?.statusCheckRollup ?? [];
        const failed = checks.some((c) => c.conclusion === "FAILURE" || c.conclusion === "TIMED_OUT" || c.state === "FAILURE");
        const pending = checks.length > 0 && checks.some((c) => c.status === "IN_PROGRESS" || c.status === "QUEUED" || c.state === "PENDING");
        let section = "idle", status = "空闲", tone = "dim";
        if (agent?.status === "blocked") {
          section = "needs"; status = "等你确认"; tone = "blocked";
        } else if (agent?.status === "done") {
          section = "needs"; status = "已完成 · 待验收"; tone = "done";
        } else if (agent?.status === "working") {
          section = "progress"; status = "运行中"; tone = "working";
        } else if (pr && pr.state === "OPEN") {
          section = "review";
          status = failed ? `#${pr.number} 检查失败` : pending ? `#${pr.number} 检查中` : pr.reviewDecision === "APPROVED" ? `#${pr.number} 已批准` : `#${pr.number} 待合并`;
          tone = failed ? "blocked" : pr.reviewDecision === "APPROVED" ? "done" : "accent";
        }
        out.push({
          key: `${space.id}/${tab.id}`,
          section, status, tone,
          title: (tab.name && !/^\d+$/.test(tab.name) ? tab.name : agent?.title) || agent?.program?.name || tab.name || "终端",
          where: [space.name, branch].filter(Boolean).join(" · "),
          time: since(tab.changed_at ?? tab.working_since),
          space, tab,
          pane: tabPanes.find((p) => p.focused)?.id ?? tabPanes[0]?.id ?? agent?.pane ?? null,
          program: agent?.program ?? tabPanes[0]?.program ?? null,
        });
      }
    }
    const rank = { needs: 0, progress: 1, review: 2, idle: 3 };
    return out.sort((a, b) => rank[a.section] - rank[b.section]);
  }

  open(card) {
    if (!card.space.active) run("space.select", { id: card.space.id });
    if (card.tab && !card.tab.active) run("tab.select", { id: card.tab.id });
    if (card.pane) run("pane.focus", { pane: card.pane });
  }

  // 窄栏一行：状态点 + 标题 + 右侧时间；细节（空间 · 分支 / 状态）放 tooltip。
  row(t, c, i) {
    const tone = t[c.tone] ?? t.dim;
    const soft = PAPER(t) ? "#f8dc4c4d" : t.hover;
    return h_flex()
      .id(`board-row-${i}`)
      .flex_none()
      .h(24)
      .mx(6)
      .px(6)
      .gap(6)
      .items_center()
      .rounded_tl(3).rounded_tr(8).rounded_br(4).rounded_bl(9)
      .cursor_pointer()
      .hover((s) => s.bg(soft))
      .tooltip(`${c.title}\n${c.where}\n${c.status}`)
      .accessibility_label(`${c.title} · ${c.status}`)
      .on_click(() => this.open(c))
      .child(div().size(6).flex_none().rounded_full().bg(tone))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5)
        .text_color(PAPER(t) ? t.ink : c.tab?.active ? t.foreground : t.muted)
        .when(Boolean(c.tab?.active), (el) => el.font_semibold())
        .child(c.title))
      .when(Boolean(c.time), (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(c.time)));
  }

  section(t, sec, cards) {
    return v_flex()
      .flex_none()
      .min_w(0)
      .gap(1)
      .child(h_flex()
        .flex_none()
        .h(22)
        .px(12)
        .gap(6)
        .items_center()
        .child(div().text_size(11).font_semibold().text_color(t[sec.tone] ?? t.dim).child(sec.name))
        .child(div().text_size(10).text_color(t.dim).child(String(cards.length))))
      .children(cards.map((c, i) => this.row(t, c, i)));
  }

  render() {
    const t = theme();
    const cards = this.cards();
    const wide = (this.viewWidth ?? 999) >= 160;
    const paper = PAPER(t) && wide;
    const shown = SECTIONS.filter((s) => cards.some((c) => c.section === s.id));

    const inner = v_flex()
      .size_full()
      .min_w(0)
      .gap(2)
      .bg(paper ? t.paper : t.chrome)
      .child(div().flex_none().relative().h(1).mx(6)
        .child(div().absolute().left(0).right(0).top(0).h(1).bg(paper ? withAlpha(t.rule ?? t.stroke, "b8") : withAlpha(t.border, "80"))))
      .child(h_flex()
        .flex_none()
        .h(26)
        .px(12)
        .gap(6)
        .items_center()
        .child(div().text_size(12).font_bold().text_color(paper ? t.ink : t.foreground).child("看板"))
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim).child(`${cards.length} 项`)))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .gap(4)
        .pb(6)
        .overflow_y_scrollbar()
        .mode("always")
        .children(shown.length ? shown.map((s) => this.section(t, s, cards.filter((c) => c.section === s.id)))
          : [div().px(12).py(6).text_size(11).text_color(t.dim).child("没有正在进行的工作")]));

    const outer = div().size_full().relative()
      .on_size_change((size, cx) => {
        const w = Math.round(size.width);
        if ((this.viewWidth ?? 0) !== w) {
          this.viewWidth = w;
          cx.notify();
        }
      });

    // 侧栏收成 44px 图标轨时只留一列状态点，避免一块空白。
    if (!wide) {
      return outer.child(v_flex()
        .size_full()
        .bg(t.canvas ?? t.chrome)
        .items_center()
        .py(8)
        .gap(9)
        .children(cards.slice(0, 14).map((c) => div()
          .size(7)
          .flex_none()
          .rounded_full()
          .bg(t[c.tone] ?? t.dim)
          .cursor_pointer()
          .tooltip(`${c.title}\n${c.status}`)
          .on_click(() => this.open(c)))));
    }
    return outer.child(paper ? sheet(this, "mid", inner) : div().size_full().bg(t.chrome).child(inner));
  }
}
