# ClaudeCodeStatusLine

[简体中文](README.md) | English

A zero-dependency custom status line for Claude Code, with an interactive settings UI.

```
Opus 5.5 │ high │ 📁 ClaudeCodeStatusLine │ 🌿 main *2 ↑1 │ 64.2k (6%) │ ⏱️ 23% │ 📅 61% │ 15:10 │ 11-09 17:00
```

## Features

| Item | Description |
| --- | --- |
| `model` | Current model |
| `effort` | Effort level |
| `dir` | Working directory (folder name or full path) |
| `git` | Branch, uncommitted changes `*N`, ahead `↑N` / behind `↓N` |
| `context` | Context usage of the current session (tokens + percentage) |
| `usage5h` / `usage7d` | 5-hour / 7-day usage percentage |
| `reset5h` / `reset7d` | 5-hour / 7-day reset time (clock time or countdown) |

- Percentages are color-coded: < 50% green, < 80% yellow, ≥ 80% red.
- Usage data merges two sources: the session data that Claude Code sends on every refresh, and the official usage API, which is polled periodically in a background process so rendering is never blocked.
- Every item can be toggled and reordered. Changes take effect on the next status line refresh.

## Requirements

- Node.js 18+ (for built-in `fetch`)
- Claude Code (the usage API reuses the login credentials in `~/.claude/.credentials.json`)

## Installation

```bash
git clone https://github.com/CrazyFigure/ClaudeCodeStatusLine.git
cd ClaudeCodeStatusLine
npm link        # registers the global `ccsl` command
```

Then add this to `~/.claude/settings.json` (replace the path with your local one):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node C:/Software/WorkSpace/ClaudeCodeStatusLine/statusline.js"
  }
}
```

> On Windows, `node <absolute path>/statusline.js` with forward slashes is the most reliable form.

## `ccsl` cheat sheet

`ccsl` is the global command registered by `npm link`. Use it to view and change the status line settings.

### Interactive settings (recommended)

```bash
ccsl            # opens the settings UI (same as ccsl --tui or ccsl -i)
```

| Key | Action |
| --- | --- |
| `↑` `↓` / `k` `j` | Move cursor |
| `Space` / `Enter` | Toggle item / cycle option |
| `←` `→` / `h` `l` | Cycle option |
| `Shift+↑↓` / `K` `J` | Reorder items |
| `r` `r` | Press twice to restore defaults |
| `q` / `Esc` | Quit |

Changes are saved immediately, and a live preview is shown at the top.

### Command-line options

```bash
ccsl --help                       # show help
ccsl --list                       # show current settings
ccsl --on  git reset7d            # enable items
ccsl --off git reset7d            # disable items
ccsl --off all --on model git     # `all` means every item
ccsl --order model context git    # reorder (unlisted items keep their order, after these)
ccsl --refresh 5m                 # usage refresh interval: 1m | 3m | 5m | 10m | off (default 3m)
ccsl --dir full                   # directory: name | full
ccsl --reset countdown            # reset time: time | countdown
ccsl --ctx-percent off            # show percentage after context: on | off
ccsl --color off                  # colors: on | off
ccsl --icons off                  # icons: on | off
ccsl --sep " | "                  # separator, default " │ "
```

Available items: `model` `effort` `dir` `git` `context` `usage5h` `usage7d` `reset5h` `reset7d`

> `--refresh off` stops calling the official usage API and only uses the session data from Claude Code.

## Claude Code slash command (optional)

Create `~/.claude/commands/statusline.md` to change settings from inside Claude Code, e.g. `/statusline off git reset7d`:

```markdown
---
description: Configure status line items / usage refresh interval (e.g. /statusline off git reset7d, /statusline refresh 5m)
allowed-tools: Bash(node C:/Software/WorkSpace/ClaudeCodeStatusLine/statusline.js:*)
---

Convert the user's arguments `$ARGUMENTS` into command-line options for `node C:/Software/WorkSpace/ClaudeCodeStatusLine/statusline.js`, run it, and briefly report the resulting settings.
```

## Files

| File | Description |
| --- | --- |
| `statusline.js` | Status line renderer + command-line settings entry (`ccsl`) |
| `tui.js` | Interactive settings UI |
| `config.json` | Personal settings (created on first change, not committed) |
| `.usage-cache.json` | Usage API cache (auto-generated, not committed) |

## License

MIT
