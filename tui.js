/**
 * 状态栏交互式设置界面（TUI）
 * 零依赖：基于 raw mode 读取按键 + ANSI 转义序列绘制
 */
'use strict';

const fs = require('fs');
const sl = require('./statusline');

// 展示项中文名
const ITEM_LABELS = {
  model: '模型',
  effort: 'Effort',
  dir: '工作目录',
  git: 'Git 状态',
  context: '上下文占用',
  usage5h: '5h 用量',
  usage7d: '7d 用量',
  reset5h: '5h 重置时间',
  reset7d: '7d 重置时间',
};

// 其他设置：每项是一组可循环切换的选项 [值, 显示文本]
const SEP_PRESETS = [' │ ', ' | ', ' · ', ' / ', '  '];
function settingDefs(cfg) {
  // 自定义分隔符不在预设中时，也放进可选列表，避免切换后丢失
  const seps = SEP_PRESETS.includes(cfg.separator) ? SEP_PRESETS : [cfg.separator, ...SEP_PRESETS];
  return [
    {
      key: 'usageRefresh',
      label: '用量刷新间隔',
      options: [
        ['1m', '1 分钟'],
        ['3m', '3 分钟'],
        ['5m', '5 分钟'],
        ['10m', '10 分钟'],
        ['off', '关闭（仅用本会话数据）'],
      ],
    },
    {
      key: 'dirStyle',
      label: '目录显示',
      options: [
        ['name', '仅目录名'],
        ['full', '完整路径'],
      ],
    },
    {
      key: 'resetStyle',
      label: '重置时间',
      options: [
        ['time', '具体时刻'],
        ['countdown', '倒计时'],
      ],
    },
    {
      key: 'contextPercent',
      label: '上下文百分比',
      options: [
        [true, '显示'],
        [false, '隐藏'],
      ],
    },
    {
      key: 'color',
      label: '着色',
      options: [
        [true, '开启'],
        [false, '关闭'],
      ],
    },
    {
      key: 'icons',
      label: '图标',
      options: [
        [true, '显示'],
        [false, '隐藏'],
      ],
    },
    { key: 'separator', label: '分隔符', options: seps.map((s) => [s, `"${s}"`]) },
  ];
}

// ---------------- 样式与宽度工具 ----------------

const esc = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
const bold = (s) => esc('1', s);
const dim = (s) => esc('90', s);
const cyan = (s) => esc('36', s);
const green = (s) => esc('32', s);

// 终端显示宽度：中日韩全角字符占 2 列
function strWidth(s) {
  let w = 0;
  for (const ch of s.replace(/\x1b\[[0-9;]*m/g, '')) {
    const c = ch.codePointAt(0);
    w += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ? 2 : 1;
  }
  return w;
}
const padW = (s, w) => s + ' '.repeat(Math.max(0, w - strWidth(s)));

// ---------------- 预览 ----------------

// 用示例会话数据 + 已缓存的真实用量渲染一行预览
function buildPreview(cfg) {
  let cache = null;
  try {
    cache = JSON.parse(fs.readFileSync(sl.CACHE_PATH, 'utf8'));
  } catch {}
  const now = Math.floor(Date.now() / 1000);
  const win = (c, pct, sec) => (c ? { used_percentage: c.pct, resets_at: c.resetsAt } : { used_percentage: pct, resets_at: now + sec });
  const input = {
    model: { display_name: 'Opus 5.5' },
    effort: { level: 'high' },
    workspace: { current_dir: process.cwd() },
    context_window: {
      context_window_size: 1000000,
      current_usage: { input_tokens: 2, cache_creation_input_tokens: 900, cache_read_input_tokens: 63300 },
    },
    rate_limits: {
      five_hour: win(cache && cache.five_hour, 23, 7200),
      seven_day: win(cache && cache.seven_day, 61, 259200),
    },
  };
  const line = sl.render(input, cfg);
  return line || dim('（所有展示项均已关闭）');
}

// ---------------- 主界面 ----------------

function runTui() {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error('交互式设置需要在终端中运行；非交互场景请使用 --help 中的命令行参数。');
    process.exitCode = 1;
    return;
  }

  let cfg = sl.loadConfig();
  let cursor = 0;
  let message = '';
  let confirmReset = false;
  let preview = buildPreview(cfg);

  const itemKeys = () => Object.keys(cfg.items);
  const rowCount = () => itemKeys().length + settingDefs(cfg).length;

  // 每次修改立即落盘并刷新预览，Claude Code 下次刷新状态栏即生效
  function commit(msg) {
    sl.saveConfig(cfg);
    preview = buildPreview(cfg);
    message = green('✓ ') + msg;
  }

  function draw() {
    const keys = itemKeys();
    const defs = settingDefs(cfg);
    const lines = [];
    lines.push('');
    lines.push('  ' + bold('Claude Code 状态栏设置'));
    lines.push('');
    lines.push('  ' + dim('预览'));
    lines.push('  ' + preview);
    lines.push('');
    lines.push('  ' + dim('展示项'));
    keys.forEach((k, i) => {
      const sel = cursor === i;
      const box = cfg.items[k] ? green('[✓]') : dim('[ ]');
      const label = padW(ITEM_LABELS[k] || k, 14);
      const text = sel ? cyan(bold(label)) : cfg.items[k] ? label : dim(label);
      lines.push(`  ${sel ? cyan('❯') : ' '} ${box} ${text} ${dim(k)}`);
    });
    lines.push('');
    lines.push('  ' + dim('其他设置'));
    defs.forEach((d, j) => {
      const i = keys.length + j;
      const sel = cursor === i;
      const opt = d.options.find(([v]) => v === cfg[d.key]) || d.options[0];
      const label = padW(d.label, 16);
      const value = sel ? cyan(`‹ ${opt[1]} ›`) : `  ${opt[1]}`;
      lines.push(`  ${sel ? cyan('❯') : ' '} ${sel ? cyan(bold(label)) : label} ${value}`);
    });
    lines.push('');
    lines.push('  ' + dim('↑↓ 选择   空格/回车 开关   ←→ 切换选项   Shift+↑↓ 或 K/J 调整顺序   r 恢复默认   q 退出'));
    lines.push('  ' + dim('修改即时保存，Claude Code 状态栏会在下次刷新时生效'));
    lines.push('  ' + (message || ''));
    // 光标归位后逐行覆盖并清除行尾，避免整屏清空造成闪烁
    stdout.write('\x1b[H' + lines.map((l) => l + '\x1b[K').join('\n') + '\x1b[J');
  }

  function cycleSetting(def, step) {
    const idx = def.options.findIndex(([v]) => v === cfg[def.key]);
    const next = def.options[(idx + step + def.options.length) % def.options.length];
    cfg[def.key] = next[0];
    commit(`${def.label}：${next[1]}`);
  }

  // 调整展示项顺序：与相邻项交换位置
  function moveItem(step) {
    const keys = itemKeys();
    if (cursor >= keys.length) return;
    const to = cursor + step;
    if (to < 0 || to >= keys.length) return;
    [keys[cursor], keys[to]] = [keys[to], keys[cursor]];
    cfg.items = Object.fromEntries(keys.map((k) => [k, cfg.items[k]]));
    cursor = to;
    commit(`已调整顺序：${ITEM_LABELS[keys[to]]}`);
  }

  function activate(step) {
    const keys = itemKeys();
    if (cursor < keys.length) {
      const k = keys[cursor];
      cfg.items[k] = !cfg.items[k];
      commit(`${ITEM_LABELS[k]}：${cfg.items[k] ? '开启' : '关闭'}`);
    } else {
      cycleSetting(settingDefs(cfg)[cursor - keys.length], step);
    }
  }

  function quit() {
    stdout.write('\x1b[?25h\x1b[?1049l');
    stdin.setRawMode(false);
    stdin.pause();
    console.log('状态栏设置已保存：' + sl.CONFIG_PATH);
    process.exit(0);
  }

  function onKey(key) {
    const prevConfirm = confirmReset;
    confirmReset = false;
    message = '';
    switch (key) {
      case '\x1b[A':
      case 'k':
        cursor = (cursor - 1 + rowCount()) % rowCount();
        break;
      case '\x1b[B':
      case 'j':
        cursor = (cursor + 1) % rowCount();
        break;
      case '\x1b[1;2A':
      case 'K':
        moveItem(-1);
        break;
      case '\x1b[1;2B':
      case 'J':
        moveItem(1);
        break;
      case ' ':
      case '\r':
      case '\n':
        activate(1);
        break;
      case '\x1b[C':
      case 'l':
        if (cursor >= itemKeys().length) activate(1);
        else if (!cfg.items[itemKeys()[cursor]]) activate(1);
        break;
      case '\x1b[D':
      case 'h':
        if (cursor >= itemKeys().length) activate(-1);
        else if (cfg.items[itemKeys()[cursor]]) activate(1);
        break;
      case 'r':
        // 恢复默认需要连按两次 r 确认
        if (prevConfirm) {
          cfg = JSON.parse(JSON.stringify(sl.DEFAULT_CONFIG));
          cursor = 0;
          commit('已恢复默认设置');
        } else {
          confirmReset = true;
          message = esc('33', '再按一次 r 确认恢复默认设置');
        }
        break;
      case 'q':
      case 'Q':
      case '\x1b':
      case '\x03':
        quit();
        return;
      default:
        break;
    }
    draw();
  }

  // 进入备用屏幕并隐藏光标；异常退出时也要还原终端
  stdout.write('\x1b[?1049h\x1b[?25l');
  process.on('exit', () => stdout.write('\x1b[?25h\x1b[?1049l'));
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  stdin.on('data', onKey);
  stdout.on('resize', draw);
  draw();
}

module.exports = { runTui };
