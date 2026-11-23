# Oh My Herdr

A workbench layout for the Herdr desktop app: machines, folders, spaces and terminals on the left, one 380 px drawer for files, sessions and favourites, and a 28 px status bar with CPU, memory, ports, waiting agents and review. Qingci follows light mode and Xuanmo dark mode; the optional Zhi paper theme adds torn paper edges and highlighter selection.

![Oh My Herdr](preview.png)

## What you see

- **Sidebar (268 px, collapses to a 44 px icon rail).** Brand strip with search, layout menu and `+`. Spaces grouped by machine → folder → space, each row led by a pixel sprite and the space's colour. Worktrees of one repository share the project's row with their own branch labels; a machine can hold a root folder whose projects indent one level. Agents in three groups — waiting, running, done — each row one click from its terminal. Footer: Preferences, Settings, Add machine.
- **Terminal area.** A 42 px header holds the tabs, Files / Sessions / Favourites, the Cockpit popup and the window controls. Each pane has a custom header: program, `~/`-folded folder, and the agent state (spinner, “waiting for you”, or a done check), with split / zoom / close on hover.
- **Right drawer (380 px).** Files: tree with search, read-only highlighted preview, `git` / `jj` status marks and one-click `@relative/path` copy. Sessions: OMP, Codex, Claude Code, CodeBuddy, Pi, project archives and optional OpenCode, filtered by keyword and source, local or on connected machines. Favourites: project folders you keep coming back to.
- **Status bar (28 px).** Server and branch, CPU and memory, listening ports, waiting agents, Review.

## Install

Ask your agent:

```
Read ~/.config/herdr-app/AGENTS.md, then add this layout: github.com/wahaha1024/oh-my-herdr
```

Or run the script:

```sh
git clone https://github.com/wahaha1024/oh-my-herdr
cd oh-my-herdr && ./install.ps1 -DryRun     # macOS / Linux: sh install.sh --dry-run
./install.ps1                             # macOS / Linux: sh install.sh
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
```

The installer needs an initialised config directory (`~/.config/herdr-app` with `settings.json`), so launch Herdr once first. Without `-Force` / `--force` it reports and skips files that already exist.

See [README](README.md#upgrade-restore-and-uninstall) for backup, restore and manifest-based uninstall commands. Do not delete mod/theme directories with wildcards. `refresh.ps1` copies the live Herdr config **into this repository**; it is not a deployment command. Use the installer to deploy repository changes.

## How it behaves

| Do this | What happens |
|---|---|
| Click a space or a terminal row | That space and terminal take focus; the space colour carries into tabs and panes |
| Click a waiting agent | Switches to that agent's space and tab, then focuses the pane |
| Right-click a session | Pin it, put it away, move it, open a tab beside it, split, zoom, or peek; a running session also offers Interrupt, a stopped one offers Compact. Slash commands (`/fork`, `/tree`, `/cost`, `/export`…) live under *More commands…* |
| Right-click a space → Set project folder | Binds the space to a project: a `cd` elsewhere in its terminal no longer moves it in the sidebar |
| Right-click a machine row | Set a root folder, then create spaces or folders inside it from the same menu |
| Type `path:line` in the drawer search | Opens that file in the read-only preview at that line; `↑` walks to the parent folder, `⌂` back to the project |
| Read the tab strip | Waiting is a red square, running an amber ring, done a green dot — the agents panel's palette, carried onto the tab |
| Drag the sidebar edge below 160 px, or click collapse | The sidebar becomes an icon rail; clicking again restores the stored width |
| Right-click inside a terminal | Pastes, with no menu in the way |
| Click the clock in a pane header | Opens that pane's OMP history: search prompts, replies and tool calls, read by turn, jump back while the turn is still in scrollback |
| Click Review in the status bar | Live `git diff HEAD` with the files this agent turn touched listed first, unified or side by side |
| Change the system appearance | Qingci ↔ Xuanmo; choose Zhi in Preferences for the paper look |
| Pick a language in Preferences | Chinese or English for the whole layout: sidebar, tabs, drawer, right-click menus and every setting |

## Built from

The layout root is a column: a 42 px titlebar, then a row of sidebar (Spaces and Agents weighted 5 : 4), work area and a 1 px divider, then the 28 px status row. The work area wraps the pane body in four 12 px torn-paper slices and holds the drawer.

Each mod does one job:

- `inkstone-chrome` — brand strip and footer.
- `inkstone-workbench` — machine / folder / space tree, terminals, icon rail.
- `inkstone-agents` — waiting / running / done groups.
- `inkstone-tabs` — tab strip, drawer buttons, Cockpit, window controls.
- `inkstone-pane` — pane header.
- `inkstone-edge` — torn-paper slices.
- `inkstone-files`, `inkstone-sessions`, `inkstone-favorites` — the three drawer pages.
- `inkstone-history` — turn-based history search and the large reader.
- `inkstone-review` — Git diff with current-turn ordering.
- `inkstone-metrics`, `inkstone-ports`, `inkstone-inbox` — status blocks.
- `inkstone-settings` — the preferences overlay.
- `inkstone-paste`, `inkstone-menu` — right-click paste and the context menu.
- `cockpit` — top-bar popup.

Themes: `themes/qingci.json` (light) and `themes/xuanmo.json` (dark) are named in the layout's `theme`; `themes/zhi.json` is the optional paper theme.

## Watch out

- History reads local OMP logs: Node is preferred; Windows falls back to PowerShell, macOS/Linux to the shell parser. Remote history is unavailable; use Sessions to resume it.
- OpenCode sessions need `sqlite3` on the machine that holds them. CodeBuddy icons use the viewing app's program table, but CodeBuddy does not report OSC 7501 working/done status.
- Existing files are preserved unless Force is requested; changed files are backed up and recorded under `.omh`. Program-table keys are never overwritten. Herdr 0.1.16+ is required for theme imports.
- The layout supports Chinese and English; choose the language in Preferences. The first-use guide can be dismissed and reopened there. Returning to the default layout does not terminate terminals.

## Done when

- `herdr-app status` reports no errors.
- With Qingci, torn paper edges are visible around the terminal area and along the sidebar cards; switching to Zhi turns them into the paper look.
- `Ctrl+Shift+P` lists Review, History and Sessions.
- Clicking a waiting agent lands on its terminal.
