# Oh My Herdr

**Less terminal scrolling, more time with the results.** A workspace layout for the [Herdr desktop app](https://herdr.dev/): spaces grouped by folder, agents sorted by who needs you, and files, sessions and diffs in one drawer.

Herdr Desktop 0.1.16+ · Windows / macOS / Linux · MIT · [简体中文](README.zh-CN.md)

![Oh My Herdr in the Qingci theme, with a collapsed space rail, split terminals and a file drawer](preview.png)

## Install

Ask your agent:

```
Read ~/.config/herdr-app/AGENTS.md, then add this layout: github.com/wahaha1024/oh-my-herdr
```

Or run the script yourself:

```sh
git clone https://github.com/wahaha1024/oh-my-herdr
cd oh-my-herdr && ./install.ps1 -Force        # macOS / Linux: ./install.sh --force
herdr-app do layout.switch '{"name":"oh-my-herdr"}'
```

`-Force` replaces the layout, mods and themes with this package's copies; `-DryRun` prints what would change and writes nothing. The installer needs an initialised config directory (`~/.config/herdr-app` with `settings.json`), so launch Herdr once before installing.

## What changes from Herdr’s default layout?

| When you want to… | Default Herdr | Oh My Herdr |
| --- | --- | --- |
| Switch between projects | Navigate the machine and space list | Browse spaces grouped by folder and expand them to see terminals. Space colours carry through the sidebar, tabs and panes. Collapse the sidebar to an icon rail when you need the room. |
| See who needs you | Check agent status in the sidebar and tabs | Scan separate waiting, running and done groups. Click a waiting agent to go straight to its terminal. |
| Find a file without leaving the terminal | Use the built-in files and changes panels | Open one drawer for files, sessions and favourites. Search and preview files, then copy an `@relative/path` reference in one click. |
| Recognise the current pane at a glance | Use the default pane header and theme | See the program, folder and status in each pane header. Qingci and Xuanmo follow the system’s light and dark modes; the optional [paper theme](screenshot-paper.png) adds torn edges and highlighter selection. |

## New workflows, not just a new look

- **Find an earlier reply without scrolling.** Search OMP prompts, replies and tool calls, read by turn, and see where context was compacted. Open long replies in a larger reader or jump back to a turn that’s still in terminal scrollback. This history panel currently supports local OMP sessions on Windows only.
- **Resume different agents’ sessions from one place.** Search and filter sessions from OMP, Codex, Claude Code, CodeBuddy, Pi, project archives and optional OpenCode (requires `sqlite3`), including on connected machines. Focus a session that’s already open, or resume a supported past session directly or by copying its resume command.
- **Review the files your agent just touched.** The review window reads the current Git diff and puts files identified from the latest OMP turn first. Switch between unified and side-by-side views, with staged, unstaged and untracked changes in one place.
- **Check ports and resource use without switching away.** See CPU, memory and listening ports in the status bar, or open a local service in your browser from the port list. Favourite frequently used project folders so you don’t have to browse for them again.

## Themes

Qingci follows the system’s light mode and Xuanmo its dark mode; both ship with the layout. The optional [Zhi paper theme](screenshot-paper.png) adds torn paper edges and highlighter selection.

![Oh My Herdr in the paper theme, with torn pane edges and a paper sidebar](screenshot-paper.png)

![The same layout with the file drawer open](screenshot.png)

## Notes

- The history panel reads local OMP sessions on Windows only.
- Sessions from OpenCode need `sqlite3` on the machine that holds the session.
- The installers skip files that already exist unless you pass `-Force` / `--force`, and they never delete themes left by an older install.
- To uninstall, remove `layouts/oh-my-herdr.json`, the `inkstone-*` folders under `mods/`, the `inkstone-*` and `zhi` themes, then run `herdr-app do layout.switch '{"name":"main"}'`.

## License

MIT
