# ClaudeCodeStatusLine

简体中文 | [English](README.en.md)

一个零依赖的 Claude Code 自定义状态栏，带交互式设置界面。

```
Opus 5.5 │ high │ 📁 ClaudeCodeStatusLine │ 🌿 main *2 ↑1 │ 64.2k (6%) │ ⏱️ 23% │ 📅 61% │ 15:10 │ 11-09 17:00
```

## 功能

| 展示项 | 说明 |
| --- | --- |
| `model` | 当前模型 |
| `effort` | 推理强度（effort level） |
| `dir` | 工作目录（仅目录名 / 完整路径） |
| `git` | 分支、未提交改动数 `*N`、领先 `↑N` / 落后 `↓N` |
| `context` | 本会话上下文占用（token 数 + 百分比） |
| `usage5h` / `usage7d` | 5 小时 / 7 天用量百分比 |
| `reset5h` / `reset7d` | 5 小时 / 7 天用量重置时间（具体时刻或倒计时） |

- 百分比按阈值着色：< 50% 绿，< 80% 黄，≥ 80% 红。
- 用量数据合并两个来源：Claude Code 每次传入的会话数据，加上定时在后台拉取的官方用量接口。后台拉取不会阻塞状态栏渲染。
- 每个展示项都可以开关、调整顺序，配置修改后下次刷新状态栏即生效。

## 环境要求

- Node.js 18+（需要内置 `fetch`）
- Claude Code（用量接口复用 `~/.claude/.credentials.json` 中的登录凭据）

## 安装

```bash
git clone https://github.com/CrazyFigure/ClaudeCodeStatusLine.git
cd ClaudeCodeStatusLine
npm link        # 全局注册 ccsl 命令
```

然后在 `~/.claude/settings.json` 中加入以下配置（路径改成你本地的实际路径）：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node C:/Software/WorkSpace/ClaudeCodeStatusLine/statusline.js"
  }
}
```

> 在 Windows 上建议写成 `node <绝对路径>/statusline.js`，路径用正斜杠，最稳妥。

## `ccsl` 命令速查

`ccsl` 是 `npm link` 后注册的全局命令，用来查看和修改状态栏配置。

### 交互式设置（推荐）

```bash
ccsl            # 直接运行即进入设置界面（也可以用 ccsl --tui 或 ccsl -i）
```

| 按键 | 作用 |
| --- | --- |
| `↑` `↓` / `k` `j` | 移动光标 |
| `空格` / `回车` | 开关展示项、切换选项 |
| `←` `→` / `h` `l` | 切换选项 |
| `Shift+↑↓` / `K` `J` | 调整展示项顺序 |
| `r` `r` | 连按两次，恢复默认设置 |
| `q` / `Esc` | 退出 |

修改即时保存，界面顶部会实时显示预览。

### 命令行参数

```bash
ccsl --help                       # 查看帮助
ccsl --list                       # 查看当前配置
ccsl --on  git reset7d            # 开启展示项
ccsl --off git reset7d            # 关闭展示项
ccsl --off all --on model git     # all 代表全部项
ccsl --order model context git    # 调整顺序（未列出的项按原顺序排在后面）
ccsl --refresh 5m                 # 用量刷新间隔：1m | 3m | 5m | 10m | off（默认 3m）
ccsl --dir full                   # 目录显示：name（仅目录名）| full（完整路径）
ccsl --reset countdown            # 重置时间：time（具体时刻）| countdown（倒计时）
ccsl --ctx-percent off            # 上下文后是否附带百分比：on | off
ccsl --color off                  # 是否着色：on | off
ccsl --icons off                  # 是否显示图标：on | off
ccsl --sep " | "                  # 分隔符，默认 " │ "
```

可用的展示项：`model` `effort` `dir` `git` `context` `usage5h` `usage7d` `reset5h` `reset7d`

> `--refresh off` 会停止调用官方用量接口，只使用 Claude Code 传入的会话数据。

## 配合 Claude Code 斜杠命令（可选）

新建 `~/.claude/commands/statusline.md`，就可以在 Claude Code 里用 `/statusline off git reset7d` 这样的写法改配置：

```markdown
---
description: 配置状态栏展示项 / 用量刷新档位（例：/statusline off git reset7d、/statusline refresh 5m）
allowed-tools: Bash(node C:/Software/WorkSpace/ClaudeCodeStatusLine/statusline.js:*)
---

把用户参数 `$ARGUMENTS` 转换为 `node C:/Software/WorkSpace/ClaudeCodeStatusLine/statusline.js` 的命令行选项并执行，然后把输出的当前配置简要告诉用户。
```

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `statusline.js` | 状态栏主程序 + 命令行配置入口（`ccsl`） |
| `tui.js` | 交互式设置界面 |
| `config.json` | 个人配置（首次修改设置时自动生成，不入库） |
| `.usage-cache.json` | 用量接口缓存（自动生成，不入库） |

## 许可证

MIT
