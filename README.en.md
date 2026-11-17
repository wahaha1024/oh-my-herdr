# Oh My Herdr

A workbench layout for [Herdr](https://herdr.dev): spaces grouped by folder in the sidebar, each with a fixed colour; a collapsible drawer on the right for files and sessions; a status bar that keeps metrics in sight. Two themes: qingci (light) and xuanmo (dark).

中文说明见 [README.md](README.md).

![qingci](preview.png)
![xuanmo](preview-dark.png)

> Both images are drawn to the layout's proportions — not screenshots.

---

## What changed

- **Spaces grouped by folder.** Group headers (folder icon, count, rule), space rows, terminal rows — three levels of indent. Spaces carry a coloured number badge and a coloured name; colours are assigned automatically and remembered, and switching themes only swaps the light/dark step, not the hue.
- **Sidebar folds to 44px** into a rail of coloured badges, and back.
- **Top bar reworked.** Tabs are 30px tall; the panel buttons carry names; a small dot on the left shows the current space's colour.
- **Five drawer pages** — files, changes, cockpit, sessions, favourites — all closed by default. A session that is already running in some terminal is marked "open", and clicking it switches there instead of replaying the whole history through a fresh `--resume`.
- **Status bar**: CPU and memory, listening port count, agents waiting on you (click for the list), review entry.
- **Right-click pastes** in terminals, no menu.

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

1. `layouts/oh-my-herdr.json` → `~/.config/herdr-app/layouts/` (Windows: `C:\Users\<you>\.config\herdr-app\layouts\`).
2. Every folder under `mods/` → the config dir's `mods/`.
3. `themes/qingci.json`, `themes/xuanmo.json` → the config dir's `themes/`.
4. Merge the `global` section of `keys.json` into your own `keys.json` (on a conflict, pick one).
5. Switch to it:

```sh
herdr-app check mods/inkstone-workbench     # worth doing for every mod
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
```

Back is `ctrl-shift-l`; to undo, delete the files.

### Requirements

Herdr's shipped `files`, `changes` and `workspace-status` mods; `inkstone-sessions` reads `~/.omp/agent/sessions` (missing means an empty list, not an error); `inkstone-metrics` reads system CPU/memory; `inkstone-ports` reads listening ports. Everything runs locally, nothing goes on the network.

## Keys

| Key | Does |
|---|---|
| `alt-shift-p` | preferences (theme, appearance) |
| `alt-shift-r` | review |
| `alt-shift-m` | system metrics |
| `alt-shift-o` | port list |
| `alt-shift-i` | waiting list |

## Palette

Seven space colours, assigned by "least used index" and stored as indices, not hex: `shared("inkstone.spaceColors")` = `{spaceId: 0..6}`. Contrast against the qingci background is 4.82–5.69:1; against xuanmo, 6.39–11.26:1.

| # | Light | Dark | Hue |
|---|---|---|---|
| 0 | `#a84a50` | `#f08a8a` | brick |
| 1 | `#8a5619` | `#f2a46a` | ochre |
| 2 | `#7d640c` | `#e8c76a` | mustard |
| 3 | `#357041` | `#7ecf86` | bamboo |
| 4 | `#34618f` | `#6fb3ea` | indigo |
| 5 | `#5f5399` | `#9a8ce6` | violet |
| 6 | `#805083` | `#c98ae6` | wisteria |

The palette exists twice — `mods/inkstone-workbench/main.js` and `mods/inkstone-tabs/main.js` — because mods cannot import each other; change both.

## Themes

`themes/qingci.json` (background `#e8f0ec`, foreground `#2b333e`, accent `#126e82`) and `themes/xuanmo.json` (background `#14131a`, foreground `#d4cec4`, accent `#619ac3`), each a full 16-colour ANSI set plus semantic slots. The layout declares `theme: { "light": "qingci", "dark": "xuanmo" }` and follows `appearance` in `settings.json`.

The preview images are regenerated from `preview.svg` and the two theme files:

```sh
python mkprev.py    # reads themes/*.json, redraws both previews
```

## Limitations

- Sidebar width, drawer state and the folded rail are runtime state (`layouts/.state/`); they may not survive a restart. The 272/380 in the layout file are starting values.
- The four status blocks are fixed width — changing their content length means editing the `px` values in `layouts/oh-my-herdr.json`.
- Session matching goes through the terminal title (omp writes the session title into the OSC title). Rename the title by hand and it won't match, so a new session gets opened; sessions on other machines are out of scope.
- The cockpit page depends on the `cockpit` mod's own data shape; copying it out alone degrades.
- Sidebar grouping is inferred from cwd prefixes; deep directories get merged.

## Files

```
layouts/oh-my-herdr.json     layout
layouts/oh-my-herdr.png      layout preview (same as preview.png)
preview.svg                  diagram source, shared by both themes
mkprev.py                    generates preview.png / preview-dark.png
mods/inkstone-chrome         brand row + footer rows
mods/inkstone-workbench      folder/space/terminal list, rail mode
mods/inkstone-tabs           tabs + panel buttons + window buttons
mods/inkstone-sessions       omp session drawer
mods/inkstone-favorites      favourites drawer
mods/inkstone-inbox          waiting block + overlay
mods/inkstone-metrics        CPU/memory block
mods/inkstone-ports          port block
mods/inkstone-review         review block
mods/inkstone-settings       preferences overlay
mods/inkstone-paste          right-click paste in terminals
mods/cockpit                 cockpit drawer
themes/qingci.json           light
themes/xuanmo.json           dark
keys.json                    five alt-shift shortcuts
install.ps1 / install.sh     install (Windows / macOS·Linux)
refresh.ps1                  reverse-sync (pull the latest files back)
RECIPE.md                    brief for rebuilding it from scratch
```
