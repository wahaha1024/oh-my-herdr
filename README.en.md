# Oh My Herdr

A workbench layout for [Herdr](https://herdr.dev): spaces grouped by directory, each one carrying its own colour; a tab strip with panel buttons on top; a collapsible drawer on the right for files, changes and sessions; and a permanent status bar for CPU, ports, pending hand-offs and review. Two themes — `qingci` (moon-white) and `xuanmo` (ink-black).

[中文说明](README.md)

![Oh My Herdr](preview.png)

---

## Why

After a dozen spaces, Herdr's stock sidebar has two problems: every space looks identical, so your eye has nowhere to land; and switching spaces or opening a file means hunting through shortcuts and panels. This layout does three things:

1. **Every space becomes a coloured record** — a coloured number badge and a coloured name. The colour belongs to the space and follows it; switching theme changes brightness, never hue.
2. **The sidebar states the hierarchy** — directory group, space, terminal are three distinct sizes and indents, with a rule between groups. Drag the sidebar to 44px and it collapses into a rail of badges.
3. **The useful bits sit on the edges** — five drawer pages (files, changes, sessions, favourites, cockpit) and a status bar that always shows system metrics. Nothing requires a shortcut.

---

## Shape

```
┌──────────────┬────────────────────────────────────────────────────────────┐
│ Oh My Herdr  │  ⊞ tabs:  π  π DISK: server space  ×    +  ⎇ master  ▣ ⋯ ⚙ ─ □ ✕│ 42px
├──────────────┼────────────────────────────────────────────────────────────┤
│              │                                                            │
│  Workbench  2 agents                                                ┌─────┐ │
│  ▾ DSH                                        1/1                  │     │ │
│    ❶ DSH              (space: coloured badge + name)                │ dr- │ │
│      π terminal row                                                 │ awer│ │
│  ────────────────────────────────  (rule between groups)             │ 380 │ │
│  ▾ projects                                   6/6                  │     │ │
│    ❶ server          (group colour = first space's colour)           │     │ │
│      π DISK: server space                                            │     │ │
│    ❷ Magpie                                                         └─────┘ │
│  ▸ qrcode (collapsed group)                                                 │
│              │                                                            │
│  (272px)     │  terminals: 8 gap, 10 radius                                 │
├──────────────┴────────────────────────────────────────────────────────────┤
│ server82 ⎇ master · 2 agents     Ctrl+Shift+P commands │ CPU 10% 10.6 GB │ 27 │ none │ review │ 28px
└────────────────────────────────────────────────────────────────────────────┘
│ Preferences / Herdr settings / Add machine — sidebar footer, 120px          │
└────────────────────────────────────────────────────────────────────────────┘
```

| Region | Size | Contents |
|---|---|---|
| `sidebar` | 272px, draggable 44–420 | 46px brand, `inkstone-workbench` list, 120px footer |
| `inkstone-tabs` | 42px | tabs, panel buttons, space dot, window buttons |
| `panel-body` | fills | terminals (`terminal_padding` 14/12, 1px divider) |
| `panel` | 380px, draggable 280–620 | five-page stack, hidden by default |
| status bar | 28px | `workspace-status` + metrics + ports + inbox + review |

---

## What's in it

### Sidebar

**Directory group** — a 27px row: 11px chevron, 13px `folder.svg` tinted with the first space's colour, 13px semibold name, 10px "shown/total" count. A 1px rule separates groups.

**Space row** — 30px tall, radius 7, `pl(10) pr(8) gap(6)`:

- Badge: 16×16, radius 4, 9px semibold. Selected means **solid fill + inverted ink** (`#f7faf8` on dark fills, `#14131a` on light ones); otherwise a 15%-alpha wash of the same colour with the colour as text.
- Name: 14px in the space colour, semibold when selected.
- Then an 11px git branch and a 7px status dot.
- The selected row gets a 10%-alpha background of the space colour.

**Terminal / agent rows** — 24px, indented 38px (aligned to the name, not the badge), 11px:

- Spaces with agents show agent rows: program icon (16px, tinted when the program has a tint) + name + status dot or spinner.
- Plain terminals show `terminal.svg` or the program's icon + name.
- An empty space shows "no terminals yet".
- Clicking a space that is already shown sends nothing — every `space.select`/`tab.select` rebuilds the terminal view and replays the whole scrollback.

**Status is encoded by shape**, not just colour:

| Status | Shape |
|---|---|
| `blocked` | small solid square, radius 1 |
| `done` | solid circle |
| `working` | 2px ring + spinning `spinner.svg` (12px, 900ms) |
| `idle` | 1.5px hollow circle |

**Rail mode (sidebar < 160px)** — spaces shrink to their coloured number badges (tooltip carries name, terminal count, status), groups to their folder icon, the header keeps only `+`, centred. Click behaviour is unchanged.

### Tab strip

- Tabs: 30px, 14px type, max 200px, `π` prefix means an agent is running; the close button appears on hover.
- Panel buttons: 26px tall, 14px icon + 11px label (files / sessions / favourites / cockpit / changes), highlighting the active drawer page. **With Git off, "changes" disappears entirely** (`shared("inkstone.git")`).
- The rightmost element is a 7px dot in the current space's colour, tooltipped with the space name — one glance tells you which space this window is.
- Window buttons are drawn as vectors: with `titlebar: "none"` the layout owns them. The collapse button sits on this row whenever the sidebar is wider than 160px.

### Drawer (380px, right)

| Page | Mod | Contents |
|---|---|---|
| Files | shipped `files` | the current directory tree |
| Changes | shipped `changes` | git status |
| Cockpit | `cockpit` | space and terminal overview |
| Sessions | `inkstone-sessions` | omp sessions; **clicking one that is already running just switches to it** |
| Favourites | `inkstone-favorites` | `[{name, folder}]`, one click opens a space |

**The sessions drawer** solves a specific annoyance: clicking an old session runs `omp --resume`, which re-renders the entire history — it looks like the terminal scrolls from the top all the way down. So before launching anything it looks for the session among live terminals: if a terminal's title contains the first 24 characters of the session title and its cwd matches, it sends `space.select` + `tab.select` + `pane.focus` instead and never resumes. When several historical records share a title, only the newest is matched, so the wrong one can't be picked.

**The favourites drawer** stores `[{name, folder}]` in `shared("inkstone.favorites")`. "Collect current" saves the current space's folder; an "open" chip on a row means a space is already open on that folder.

**Right-click pastes.** `terminal_menu: "inkstone-paste"` means a right-click in a terminal does not raise a menu: it hands focus back to the terminal that was clicked, types the clipboard straight in, and closes itself. One click from right-click to paste.

### Status bar

`status-text` (shipped, fills the space) plus four fixed-width blocks:

| Block | Width | Contents |
|---|---|---|
| `inkstone-metrics` | 152 | CPU %, memory GB |
| `inkstone-ports` | 64 | number of listening ports |
| `inkstone-inbox` | 84 | agents waiting on you; opens a 400×320 list |
| `inkstone-review` | 88 | review entry point |

---

## Install

### Script (Windows PowerShell)

```powershell
.\install.ps1 -DryRun     # see what it would write
.\install.ps1             # never overwrites; keys.json only gains missing keys
```

### Script (macOS / Linux / WSL)

```sh
./install.sh --dry-run    # see what it would write
./install.sh              # never overwrites; --force overwrites
./install.sh --target=DIR # install somewhere else
```

Merging `keys.json` needs a working `python3` (or `python`); without one the script prints the keys to add by hand.

### On a second machine

Clone the repo and run the right script — layout, mods and themes come out identical. Three things are deliberately **not** in the repo: space colours and favourites (they live in `shared.json`), fonts and appearance (`settings.json`, not shipped), and each machine's own spaces and sessions (`view.json`, `~/.omp/agent/sessions`). So on a second machine spaces get their colours assigned afresh and favourites start empty; the behaviour is unaffected.

Each machine needs Herdr's shipped `files` / `changes` / `workspace-status` mods (they come with Herdr), `git` for the branch labels, and `omp` on `PATH` (only the sessions drawer uses it).

### By hand

1. `layouts/oh-my-herdr.json` → `~/.config/herdr-app/layouts/` (`C:\Users\<you>\.config\herdr-app\layouts\` on Windows).
2. Each folder under `mods/` → the config directory's `mods/`.
3. `themes/qingci.json`, `themes/xuanmo.json` → `themes/`.
4. Merge the `global` section of `keys.json` into your own; pick a winner for any clash.
5. Switch to it:

```sh
herdr-app check mods/inkstone-workbench     # worth running for every mod
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
```

`ctrl-shift-l` switches back; deleting the files removes it.

### Dependencies

Herdr's shipped `files`, `changes` and `workspace-status` mods. `inkstone-sessions` reads `~/.omp/agent/sessions` (empty list, no error, if absent). `inkstone-metrics` reads system CPU and memory; `inkstone-ports` reads listening ports. Everything runs locally; nothing calls the network.

---

## Keys

| Key | Action |
|---|---|
| `alt-shift-p` | preferences (theme, appearance) |
| `alt-shift-r` | review |
| `alt-shift-m` | system metrics |
| `alt-shift-o` | port list |
| `alt-shift-i` | pending list |

---

## Space colours

Seven colours. The light theme (qingci) uses the dark set, the dark theme (xuanmo) the bright set — **the same index keeps its hue across themes; only brightness changes**:

| # | Light (qingci) | Dark (xuanmo) | Hue |
|---|---|---|---|
| 0 | `#a84a50` | `#f08a8a` | brick |
| 1 | `#8a5619` | `#f2a46a` | ochre |
| 2 | `#7d640c` | `#e8c76a` | mustard |
| 3 | `#357041` | `#7ecf86` | bamboo |
| 4 | `#34618f` | `#6fb3ea` | indigo |
| 5 | `#5f5399` | `#9a8ce6` | iris |
| 6 | `#805083` | `#c98ae6` | wisteria |

Measured contrast: light set against `#e8f0ec` is 4.82–5.69:1; dark set against `#14131a` is 6.39–11.26:1.

What's stored is an **index, not a hex**: `shared("inkstone.spaceColors")` = `{spaceId: 0..6}`. A new space takes the least-used colour; a space's colour is reclaimed when it goes away. `luminance(hex)` (WCAG relative luminance) decides which set the current theme needs.

> `inkstone-workbench` and `inkstone-tabs` each keep their own copy of the palette — mods cannot import from each other. Change both `PALETTE_LIGHT` / `PALETTE_DARK` blocks, in `mods/inkstone-workbench/main.js` and `mods/inkstone-tabs/main.js`.

---

## Themes

`themes/qingci.json` (moon-white: `#e8f0ec` ground, `#2b333e` ink, `#126e82` accent) and `themes/xuanmo.json` (ink-black: `#14131a` ground, `#d4cec4` ink, `#619ac3` accent). Both are complete 16-colour ANSI palettes plus semantic slots (`surface`, `raised`, `hover`, `border`, `accent`, `blocked`, `done`, `working`, `idle`, …). The layout declares `theme: { "light": "qingci", "dark": "xuanmo" }`, so it follows `settings.json`'s `appearance`.

---

## What it reads and runs

| Kind | Detail |
|---|---|
| Reads | `~/.omp/agent/sessions/**/*.jsonl` (first lines only, for title and cwd), git state |
| Runs | `git` via `exec` (branch, worktree), `hc` (Herdr core queries) |
| Writes shared state | `inkstone.spaceColors`, `inkstone.favorites`, `inkstone.git`, `sidebar.width` |
| Network | none |

---

## Limits

- Sidebar width, drawer state and rail mode are runtime state (`layout.resize`, clicks), mostly under `layouts/.state/`, and are not guaranteed across restarts. The 272/380 in the layout file are the starting values.
- The four status blocks have fixed widths; changing their content length means editing the `px` values in `layouts/oh-my-herdr.json`.
- Session matching relies on terminal titles (omp writes its session title into the OSC title). Rename the title by hand and it won't be recognised — a fresh session will open instead. Sessions on other machines aren't matched.
- The cockpit page depends on the `cockpit` mod's data shape; copying it out on its own will degrade.
- Grouping is inferred from cwd prefixes; very deep trees get merged for display.

---

## Checking and developing

```sh
herdr-app check mods/inkstone-workbench        # → check passed
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
herdr-app status | jq .errors                  # → []
herdr-app shot out.png                         # eyeball it
```

After editing a mod, pull the current files back into this repo:

```powershell
.\refresh.ps1
```

---

## Files

```
layouts/oh-my-herdr.json     the layout
layouts/oh-my-herdr.png      preview (same as preview.png)
mods/inkstone-chrome         brand strip + three-row footer (`footer` prop)
mods/inkstone-workbench      directory/space/terminal list, rail mode
mods/inkstone-tabs           tabs, panel buttons, window buttons
mods/inkstone-sessions       omp session drawer
mods/inkstone-favorites      favourites drawer
mods/inkstone-inbox          pending status block + overlay
mods/inkstone-metrics        CPU/memory block
mods/inkstone-ports          ports block
mods/inkstone-review         review block
mods/inkstone-settings       preferences overlay
mods/inkstone-paste          right-click pastes straight into the terminal
mods/cockpit                 cockpit drawer
themes/qingci.json           moon-white
themes/xuanmo.json           ink-black
keys.json                    five alt-shift shortcuts
install.ps1 / install.sh     install (Windows / macOS·Linux)
refresh.ps1                  reverse-sync (pull the latest files back)
RECIPE.md                    brief for rebuilding it from scratch
```

## License

MIT
