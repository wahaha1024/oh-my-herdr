// 新建空间 / 新建文件夹面板。
// 为什么要单独一张面板：OMP 的会话按「启动时的工作目录」归档，而项目常常不在那个目录里。
// 起空间时把「终端从哪个目录起」与「会话属于哪个项目」一次说清，比事后 cd 修正可靠。
//
// props: { mode?: "space" | "folder" | "bind" | "root", folder?: string, machine?: string | null, space?: string }
//   space  — 目录可手输 / 系统选择器 / 最近用过；机器与起始程序可选。
//   folder — 在 folder 下建一个新目录，建成后在其中开空间。
//   bind   — 给已有空间指定「归属目录」：侧栏按它归组，不再跟着终端 cwd 跑。
//   root   — 给一台机器指定根目录：侧栏在它下面先留一行，右键即可新建子项目。
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, machines, spaces, focused, knownAgents, pickFolder, exec, shared, setShared, window, home } from "herdr";

// 中英切换：shared 改动会让所有 mod 重绘，切换语言立即生效。
const LANG = "inkstone.lang";
const pick = (zh, en) => (shared(LANG) === "en" ? en : zh);

const RECENT = "inkstone.recentFolders";
const BINDINGS = "inkstone.bindings";
const ROOTS = "inkstone.roots";
const isWin = () => window()?.platform === "windows";

// 最近目录按机器分开记：本机的 E:\项目 在远端没有任何意义。
const recentFor = (on) => {
  const all = shared(RECENT);
  if (Array.isArray(all)) return on ? [] : all.slice(0, 6);
  return (all?.[on ?? ""] ?? []).slice(0, 6);
};

const rememberRecent = (on, folder) => {
  const all = shared(RECENT);
  const map = Array.isArray(all) ? { "": all } : { ...(all ?? {}) };
  const key = on ?? "";
  map[key] = [folder, ...(map[key] ?? []).filter((x) => x !== folder)].slice(0, 6);
  setShared(RECENT, map);
};

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
  if (on) throw new Error(pick("远程机器暂不支持建目录，请到那台机器的终端里创建", "Remote machines can't create folders; make it in a terminal on that machine"));
  try {
    const r = await exec("mkdir", ["-p", path], { timeout: 15000 });
    if (r.code === 0) return r;
  } catch (e) {
    if (!isWin()) throw e;
  }
  const r = await exec("cmd", ["/c", "mkdir", path], { timeout: 15000 });
  // cmd 的 mkdir 遇到已存在的目录返回 1，那不是失败。
  if (r.code !== 0 && r.code !== 1) throw new Error(r.stderr.trim() || pick(`退出码 ${r.code}`, `exit ${r.code}`));
  return r;
}

export default class NewSpace extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.mode = ["folder", "bind", "root"].includes(p.mode) ? p.mode : "space";
    this.space = p.space ?? "";
    // 新建空间默认跟着当前空间走：在远端项目里按 + 通常也是想在远端开。
    this.machine = this.mode === "space"
      ? (p.machine ?? (spaces().find((s) => s.active)?.machine ?? null))
      : (p.machine ?? null);
    this.busy = false;
    this.err = "";
    this.agents = [];
    this.agent = null;
    this.recent = recentFor(this.machine);
    this.dir = InputState.new({ placeholder: this.machine ? pick("远端目录，例如 /home/me/project", "remote folder, e.g. /home/me/project") : pick("目录，例如 E:\\项目", "folder, e.g. E:\\projects") });
    this.dir.set_value(p.folder ?? (this.machine ? "" : (focused()?.cwd ?? home())));
    this.name = InputState.new({ placeholder: pick("新文件夹名", "new folder name") });
    this.dir.on("submit", () => (this.mode === "bind" ? this.bind(cx) : this.mode === "root" ? this.setRoot(cx) : this.create(cx)));
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
    this.recent = recentFor(name);
    this.dir.set_value(name ? "" : (focused()?.cwd ?? home()));
    this.loadAgents(cx);
    cx.notify();
  }

  browse(cx) {
    if (this.machine) {
      this.err = pick("系统选择器只在本机可用，远端目录请手输", "The system picker only works locally; type the remote path");
      cx.notify();
      return;
    }
    // 与 create 同理：选择器要等用户操作，回调必须立刻返回。
    pickFolder({ prompt: this.mode === "folder" ? pick("在这里建文件夹", "create a folder here") : pick("在新目录开空间", "open a space in the new folder") })
      .then((hit) => {
        if (!hit) return;
        this.dir.set_value(hit);
        this.err = "";
        cx.notify();
      })
      .catch(() => null);
  }

  // 归属目录：只写 shared，侧栏下一次渲染就按它归组。
  bind(cx) {
    const dir = expand(this.dir.value(), this.machine);
    if (!dir) {
      this.err = pick("请填写目录", "Enter a folder");
      cx.notify();
      return;
    }
    const all = { ...(shared(BINDINGS) ?? {}), [this.space]: dir };
    setShared(BINDINGS, all);
    closeOverlay(props()?.overlay);
  }

  unbind(_cx) {
    const all = { ...(shared(BINDINGS) ?? {}) };
    delete all[this.space];
    setShared(BINDINGS, all);
    closeOverlay(props()?.overlay);
  }

  // 机器根目录：只写 shared，侧栏下一次渲染就在这台机器下面留出那一行。
  setRoot(cx) {
    const dir = expand(this.dir.value(), this.machine);
    if (!dir) {
      this.err = pick("请填写目录", "Enter a folder");
      cx.notify();
      return;
    }
    setShared(ROOTS, { ...(shared(ROOTS) ?? {}), [this.machine ?? ""]: dir });
    closeOverlay(props()?.overlay);
  }

  clearRoot(_cx) {
    const all = { ...(shared(ROOTS) ?? {}) };
    delete all[this.machine ?? ""];
    setShared(ROOTS, all);
    closeOverlay(props()?.overlay);
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
      this.err = pick("请填写目录", "Enter a folder");
      cx.notify();
      return;
    }
    let target = dir;
    if (this.mode === "folder") {
      const name = String(this.name.value() ?? "").trim();
      if (!name) {
        this.err = pick("请填写文件夹名", "Enter a folder name");
        cx.notify();
        return;
      }
      if (/[\\/:*?"<>|]/.test(name)) {
        this.err = pick("名称不能包含 \\\\ / : * ? \" < > |", "A name cannot contain \\\\ / : * ? \" < > |");
        cx.notify();
        return;
      }
      target = join(dir, name);
      this.busy = true;
      this.err = "";
      cx.notify();
      try {
        const r = await mkdir(target, this.machine);
        if (r.code !== 0) throw new Error(r.stderr.trim() || pick(`退出码 ${r.code}`, `exit ${r.code}`));
      } catch (e) {
        this.busy = false;
        this.err = pick(`建目录失败：${String(e?.message ?? e)}`, `could not create the folder: ${String(e?.message ?? e)}`);
        cx.notify();
        return;
      }
      this.busy = false;
    }
    const args = { folder: target, machine: this.machine ?? "" };
    if (this.mode === "space" && this.agent?.run) args.argv = this.agent.run;
    run("space.new", args);
    rememberRecent(this.machine, target);
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
    const bind = this.mode === "bind";
    const root = this.mode === "root";
    const bound = Boolean(this.space && (shared(BINDINGS) ?? {})[this.space]);
    const hasRoot = Boolean((shared(ROOTS) ?? {})[this.machine ?? ""]);
    const local = this.machine === null;
    const list = machines().filter((m) => m.name !== null);
    return v_flex()
      .id("inkstone-space")
      .w_full()
      .bg(t.popover)
      .p(12)
      .gap(9)
      .text_size(12)
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child(root ? pick("设置机器根目录", "Set the machine's root folder") : bind ? pick("设置归属目录", "Set the project folder") : folder ? pick("新建文件夹", "New folder") : pick("新建空间", "New space")))
      .child(div().text_size(11).text_color(t.dim).child(root
        ? pick("侧栏会在这台机器下面先留出这一行：右键它就能新建子文件夹或空间，不必先有项目。", "The sidebar keeps a row under this machine: right-click it to create folders or spaces without a project first.")
        : bind
          ? pick("侧栏按这个目录归组；终端 cd 到别处也还留在同一项目下。", "The sidebar groups the space by this folder; a cd elsewhere keeps it in the same project.")
          : folder
            ? pick("在上面的目录里建一个子目录，建好后在其中开空间。", "Creates a subfolder above, then opens a space in it.")
            : pick("空格子里的目录就是终端起步的地方；OMP 会话按它归档，选对项目目录能少走弯路。", "The folder is where terminals start; OMP sessions are filed by it, so pick the project folder.")))
      .child(h_flex().gap(8).items_center()
        .child(this.label(folder ? pick("位置", "Folder") : pick("目录", "Folder")))
        .child(this.field(this.dir))
        .child(this.chip("sp-browse", pick("浏览…", "Browse…"), false, (_e, c) => this.browse(c))))
      .when(!folder && !bind, (el) => el
        .child(h_flex().gap(8).items_center()
          .child(this.label(pick("机器", "Machine")))
          .child(div().flex_1().flex().flex_wrap().gap(6)
            .child(this.chip("sp-m-local", pick("本机", "This computer"), local, () => this.pickMachine(null, cx)))
            .children(list.map((m, i) => this.chip(`sp-m-${i}`, m.name, this.machine === m.name, () => this.pickMachine(m.name, cx)))))))
      .when(!folder && !bind && !root, (el) => el
        .child(h_flex().gap(8).items_start()
          .child(this.label(pick("程序", "Program")))
          .child(div().flex_1().flex().flex_wrap().gap(6)
            .child(this.chip("sp-a-shell", pick("空终端", "Empty terminal"), !this.agent, () => { this.agent = null; cx.notify(); }))
            .children(this.agents.map((a, i) => this.chip(`sp-a-${i}`, a.name ?? a.key, this.agent?.key === a.key, () => { this.agent = a; cx.notify(); }))))))
      .when(folder, (el) => el
        .child(h_flex().gap(8).items_center()
          .child(this.label(pick("名称", "Name")))
          .child(this.field(this.name))))
      .when(Boolean(this.recent.length) && !folder && !root, (el) => el
        .child(h_flex().gap(8).items_center()
          .child(this.label(pick("最近", "Recent")))
          .child(div().flex_1().flex().flex_wrap().gap(6)
            .children(this.recent.map((p, i) => this.chip(`sp-r-${i}`, p, false, () => { this.dir.set_value(p); this.err = ""; cx.notify(); }))))))
      .when(Boolean(this.err), (el) => el.child(div().text_size(11).text_color(t.blocked).child(this.err)))
      .child(h_flex().gap(8).justify_end()
        .when(bind && bound, (el) => el.child(this.button("sp-unbind", pick("清除归属", "Clear project folder"), false, (_e, c) => this.unbind(c))))
        .when(root && hasRoot, (el) => el.child(this.button("sp-unroot", pick("清除根目录", "Clear root folder"), false, (_e, c) => this.clearRoot(c))))
        .child(this.button("sp-cancel", pick("取消", "Cancel"), false, () => closeOverlay(props()?.overlay)))
        .child(this.button(
          "sp-create",
          bind ? pick("设定归属", "Bind project folder") : root ? pick("设定根目录", "Set root folder") : (this.busy ? pick("创建中…", "Creating…") : (folder ? pick("创建并打开", "Create and open") : pick("创建", "Create"))),
          true,
          (_e, c) => (bind ? this.bind(c) : root ? this.setRoot(c) : this.create(c)),
        )));
  }
}
