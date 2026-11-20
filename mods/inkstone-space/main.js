// 新建空间 / 新建文件夹面板。
// 为什么要单独一张面板：OMP 的会话按「启动时的工作目录」归档，而项目常常不在那个目录里。
// 起空间时把「终端从哪个目录起」与「会话属于哪个项目」一次说清，比事后 cd 修正可靠。
//
// props: { mode?: "space" | "folder", folder?: string, machine?: string | null }
//   space  — 目录可手输 / 系统选择器 / 最近用过；机器与起始程序可选。
//   folder — 在 folder 下建一个新目录，建成后在其中开空间。
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, machines, focused, knownAgents, pickFolder, exec, shared, setShared, window, home } from "herdr";

const RECENT = "inkstone.recentFolders";
const isWin = () => window()?.platform === "windows";

// 本机允许 ~ 与 ~/x；远程不展开——本机的 home 展开到远端就是错的目录。
function expand(text, on) {
  const s = String(text ?? "").trim();
  if (on) return s;
  if (s === "~") return home();
  if (/^~[\\/]/.test(s)) return home().replace(/[\\/]+$/, "") + s.slice(1);
  return s;
}

const join = (dir, name) => `${dir.replace(/[\\/]+$/, "")}${isWin() ? "\\" : "/"}${name}`;

// 建目录只能在本机：远程机器用哪种 shell 不确定，猜错了会在错的地方建。
// mkdir -p 幂等且与 shell 无关，Windows 上由 Git Bash 提供；没有再退回 cmd 的 mkdir。
async function mkdir(path, on) {
  if (on) throw new Error("远程机器暂不支持建目录，请到那台机器的终端里创建");
  try {
    const r = await exec("mkdir", ["-p", path], { timeout: 15000 });
    if (r.code === 0) return r;
  } catch (e) {
    if (!isWin()) throw e;
  }
  const r = await exec("cmd", ["/c", "mkdir", path], { timeout: 15000 });
  // cmd 的 mkdir 遇到已存在的目录返回 1，那不是失败。
  if (r.code !== 0 && r.code !== 1) throw new Error(r.stderr.trim() || `退出码 ${r.code}`);
  return r;
}

export default class NewSpace extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.mode = p.mode === "folder" ? "folder" : "space";
    this.machine = p.machine ?? null;
    this.busy = false;
    this.err = "";
    this.agents = [];
    this.agent = null;
    this.recent = (shared(RECENT) ?? []).slice(0, 6);
    this.dir = InputState.new({ placeholder: this.machine ? "远端目录，例如 /home/me/project" : "目录，例如 E:\\项目" });
    this.dir.set_value(p.folder ?? (this.machine ? "" : (focused()?.cwd ?? home())));
    this.name = InputState.new({ placeholder: "新文件夹名" });
    this.dir.on("submit", () => this.create(cx));
    this.name.on("submit", () => this.create(cx));
    cx.timer.after(30, () => (this.mode === "folder" ? this.name : this.dir).focus());
    this.loadAgents(cx);
  }

  loadAgents(cx) {
    this.agents = [];
    if (this.mode !== "space") return;
    const on = this.machine;
    cx.spawn(async () => {
      try {
        const list = await knownAgents({ on });
        if (this.machine === on) this.agents = list.filter((a) => a.installed);
      } catch {
        if (this.machine === on) this.agents = [];
      }
      cx.notify();
    });
  }

  pickMachine(name, cx) {
    if (this.machine === name) return;
    this.machine = name;
    this.err = "";
    this.agent = null;
    this.dir.set_value(name ? "" : (focused()?.cwd ?? home()));
    this.loadAgents(cx);
    cx.notify();
  }

  async browse(cx) {
    if (this.machine) {
      this.err = "系统选择器只在本机可用，远端目录请手输";
      cx.notify();
      return;
    }
    const hit = await pickFolder({ prompt: this.mode === "folder" ? "在这里建文件夹" : "在新目录开空间" }).catch(() => null);
    if (hit) {
      this.dir.set_value(hit);
      this.err = "";
      cx.notify();
    }
  }

  create(cx) {
    // 不能在点击回调里 await：宿主会等回调返回，await exec 期间面板整个卡在「创建中…」。
    // 交给自己持有的异步流程，回调立刻返回。
    this.make(cx).catch((e) => {
      this.busy = false;
      this.err = String(e?.message ?? e);
      cx.notify();
    });
  }

  async make(cx) {
    if (this.busy) return;
    const dir = expand(this.dir.value(), this.machine);
    if (!dir) {
      this.err = "请填写目录";
      cx.notify();
      return;
    }
    let target = dir;
    if (this.mode === "folder") {
      const name = String(this.name.value() ?? "").trim();
      if (!name) {
        this.err = "请填写文件夹名";
        cx.notify();
        return;
      }
      if (/[\\/:*?"<>|]/.test(name)) {
        this.err = '名称不能包含 \\ / : * ? " < > |';
        cx.notify();
        return;
      }
      target = join(dir, name);
      this.busy = true;
      this.err = "";
      cx.notify();
      try {
        const r = await mkdir(target, this.machine);
        if (r.code !== 0) throw new Error(r.stderr.trim() || `退出码 ${r.code}`);
      } catch (e) {
        this.busy = false;
        this.err = `建目录失败：${String(e?.message ?? e)}`;
        cx.notify();
        return;
      }
      this.busy = false;
    }
    const args = { folder: target, machine: this.machine ?? "" };
    if (this.mode === "space" && this.agent?.run) args.argv = this.agent.run;
    run("space.new", args);
    setShared(RECENT, [target, ...(shared(RECENT) ?? []).filter((x) => x !== target)].slice(0, 6));
    closeOverlay(props()?.overlay);
  }

  chip(id, label, on, fn) {
    const t = theme();
    return div()
      .id(id)
      .h(26)
      .px(9)
      .flex_none()
      .flex()
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .text_size(11.5)
      .when(on, (el) => el.bg(t.selected).text_color(t.foreground))
      .when(!on, (el) => el.text_color(t.muted).border(1).border_color(t.border))
      .hover((h) => h.bg(t.hover))
      .on_click(fn)
      .child(div().truncate().child(label));
  }

  field(state) {
    const t = theme();
    const paper = Boolean(t.paper);
    return div()
      .flex_1()
      .min_w(0)
      .h(32)
      .px(8)
      .flex()
      .items_center()
      .rounded(6)
      .bg(paper ? (t.popover ?? t.surface) : t.input)
      .border(1)
      .border_color(t.border)
      .cursor_text()
      .child(Input.new(state).flex_1().h_full().text_size(12).text_color(t.foreground));
  }

  label(text) {
    const t = theme();
    return div().w(46).flex_none().text_size(11.5).text_color(t.muted).child(text);
  }

  button(id, label, primary, fn) {
    const t = theme();
    return div()
      .id(id)
      .h(28)
      .px(12)
      .flex_none()
      .flex()
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .text_size(12)
      .when(primary, (el) => el.bg(t.accent).text_color(t.background))
      .when(!primary, (el) => el.border(1).border_color(t.border).text_color(t.foreground))
      .hover((h) => h.opacity(0.85))
      .on_click(fn)
      .child(label);
  }

  render(cx) {
    const t = theme();
    const folder = this.mode === "folder";
    const local = this.machine === null;
    const list = machines().filter((m) => m.name !== null);
    return v_flex()
      .id("inkstone-space")
      .w_full()
      .bg(t.popover)
      .p(12)
      .gap(9)
      .text_size(12)
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child(folder ? "新建文件夹" : "新建空间"))
      .child(div().text_size(11).text_color(t.dim).child(folder
        ? "在上面的目录里建一个子目录，建好后在其中开空间。"
        : "空格子里的目录就是终端起步的地方；OMP 会话按它归档，选对项目目录能少走弯路。"))
      .child(h_flex().gap(8).items_center()
        .child(this.label(folder ? "位置" : "目录"))
        .child(this.field(this.dir))
        .child(this.chip("sp-browse", "浏览…", false, (_e, c) => this.browse(c))))
      .when(!folder, (el) => el
        .child(h_flex().gap(8).items_center()
          .child(this.label("机器"))
          .child(div().flex_1().flex().flex_wrap().gap(6)
            .child(this.chip("sp-m-local", "本机", local, () => this.pickMachine(null, cx)))
            .children(list.map((m, i) => this.chip(`sp-m-${i}`, m.name, this.machine === m.name, () => this.pickMachine(m.name, cx))))))
        .child(h_flex().gap(8).items_start()
          .child(this.label("程序"))
          .child(div().flex_1().flex().flex_wrap().gap(6)
            .child(this.chip("sp-a-shell", "空终端", !this.agent, () => { this.agent = null; cx.notify(); }))
            .children(this.agents.map((a, i) => this.chip(`sp-a-${i}`, a.name ?? a.key, this.agent?.key === a.key, () => { this.agent = a; cx.notify(); }))))))
      .when(folder, (el) => el
        .child(h_flex().gap(8).items_center()
          .child(this.label("名称"))
          .child(this.field(this.name))))
      .when(Boolean(this.recent.length) && !folder, (el) => el
        .child(h_flex().gap(8).items_center()
          .child(this.label("最近"))
          .child(div().flex_1().flex().flex_wrap().gap(6)
            .children(this.recent.map((p, i) => this.chip(`sp-r-${i}`, p, false, () => { this.dir.set_value(p); this.err = ""; cx.notify(); }))))))
      .when(Boolean(this.err), (el) => el.child(div().text_size(11).text_color(t.blocked).child(this.err)))
      .child(h_flex().gap(8).justify_end()
        .child(this.button("sp-cancel", "取消", false, () => closeOverlay(props()?.overlay)))
        .child(this.button("sp-create", this.busy ? "创建中…" : (folder ? "创建并打开" : "创建"), true, (_e, c) => this.create(c))));
  }
}
