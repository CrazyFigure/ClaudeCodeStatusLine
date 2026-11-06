#!/usr/bin/env node
/**
 * Claude Code 自定义状态栏
 *
 * 渲染：Claude Code 通过 stdin 传入会话 JSON，脚本输出一行状态文本
 * 配置：node statusline.js --help
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const CACHE_PATH = path.join(__dirname, '.usage-cache.json');
const LOCK_PATH = path.join(__dirname, '.usage-fetch.lock');
const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

// 所有可开关的展示项（顺序即默认展示顺序）
const ITEM_KEYS = ['model', 'effort', 'dir', 'git', 'context', 'usage5h', 'usage7d', 'reset5h', 'reset7d'];

// 用量刷新档位（秒），off 表示只用会话内数据、不调用官方接口
const REFRESH_TIERS = { '1m': 60, '3m': 180, '5m': 300, '10m': 600, off: 0 };

const DEFAULT_CONFIG = {
  items: Object.fromEntries(ITEM_KEYS.map((k) => [k, true])),
  usageRefresh: '3m',
  dirStyle: 'name',
  contextPercent: true,
  resetStyle: 'time',
  separator: ' │ ',
  color: true,
  icons: true,
};

// 少量点缀图标：只给语义不够直观的项加，保持简洁
const ICONS = {
  dir: '📁',
  git: '🌿',
  usage5h: '⏱️',
  usage7d: '📅',
};

// ---------------- 配置读写 ----------------

function loadConfig() {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    // 配置不存在或损坏时使用默认值
  }
  const cfg = { ...DEFAULT_CONFIG, ...user };
  // items 以用户配置的键顺序为准，缺失的项补在末尾并默认开启
  const items = {};
  for (const k of Object.keys(user.items || {})) if (ITEM_KEYS.includes(k)) items[k] = !!user.items[k];
  for (const k of ITEM_KEYS) if (!(k in items)) items[k] = true;
  cfg.items = items;
  if (!(cfg.usageRefresh in REFRESH_TIERS)) cfg.usageRefresh = DEFAULT_CONFIG.usageRefresh;
  return cfg;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

// ---------------- 颜色 ----------------

let useColor = true;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const C = { red: '31', green: '32', yellow: '33', blue: '34', magenta: '35', cyan: '36', gray: '90' };

// 按百分比阈值着色：<50 绿，<80 黄，>=80 红
function pctColor(p) {
  return p >= 80 ? C.red : p >= 50 ? C.yellow : C.green;
}

// ---------------- 格式化 ----------------

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(n);
}

const pad2 = (n) => String(n).padStart(2, '0');

// 重置时间：time 模式显示本地时刻（7d 带日期），countdown 模式显示剩余时长
function fmtReset(sec, withDate, style) {
  if (!sec) return '--';
  const ms = sec * 1000;
  const diff = ms - Date.now();
  if (diff <= 0) return '--';
  if (style === 'countdown') {
    const m = Math.floor(diff / 60000);
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    const mm = m % 60;
    if (d > 0) return `${d}d${h}h`;
    if (h > 0) return `${h}h${pad2(mm)}m`;
    return `${mm}m`;
  }
  // 四舍五入到分钟，避免 06:59:59.7 这类时间显示成 06:59
  const t = new Date(Math.round(ms / 60000) * 60000);
  const hm = `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  return withDate ? `${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} ${hm}` : hm;
}

// ---------------- Git ----------------

function gitInfo(dir) {
  if (!dir) return null;
  const r = spawnSync('git', ['-C', dir, 'status', '--porcelain=v2', '--branch'], {
    encoding: 'utf8',
    timeout: 1500,
    windowsHide: true,
    // 只读查询时不抢 index.lock，避免和用户的 git 操作冲突
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (r.status !== 0 || !r.stdout) return null;
  let branch = '';
  let oid = '';
  let ahead = 0;
  let behind = 0;
  let changes = 0;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice(14).trim();
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim();
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) [ahead, behind] = [+m[1], +m[2]];
    } else if (line && !line.startsWith('#')) changes++;
  }
  // 游离 HEAD 时显示短 commit id
  if (branch === '(detached)') branch = oid && oid !== '(initial)' ? oid.slice(0, 7) : 'detached';
  let s = branch;
  if (changes) s += ` *${changes}`;
  if (ahead) s += ` ↑${ahead}`;
  if (behind) s += ` ↓${behind}`;
  return { text: s, dirty: changes > 0 };
}

// ---------------- 用量：官方接口缓存 ----------------

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// 接口返回 → 统一结构 { pct, resetsAt(秒) }
function normWindow(w) {
  if (!w || typeof w.utilization !== 'number') return null;
  return { pct: w.utilization, resetsAt: w.resets_at ? Math.round(Date.parse(w.resets_at) / 1000) : 0 };
}

// 后台进程：拉取官方用量接口并写入缓存（由渲染进程按刷新档位触发）
async function fetchUsage() {
  const old = readJson(CACHE_PATH) || {};
  const out = { ...old, fetchedAt: Date.now() };
  try {
    const cred = readJson(CREDENTIALS_PATH);
    const token = cred && cred.claudeAiOauth && cred.claudeAiOauth.accessToken;
    if (!token) throw new Error('no oauth token');
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-statusline',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    out.five_hour = normWindow(j.five_hour);
    out.seven_day = normWindow(j.seven_day);
    out.dataAt = Date.now();
    delete out.error;
  } catch (e) {
    // 失败时保留旧数据，仅记录错误；fetchedAt 已更新，等下一个刷新周期再试
    out.error = String(e && e.message);
  }
  fs.writeFileSync(CACHE_PATH, JSON.stringify(out));
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {}
}

// 缓存过期时拉起独立后台进程去刷新，不阻塞本次渲染
function maybeTriggerFetch(cache, intervalSec) {
  if (!intervalSec) return;
  if (cache && Date.now() - (cache.fetchedAt || 0) < intervalSec * 1000) return;
  // 锁文件防止多次渲染同时发起请求；超过 30 秒的锁视为残留
  try {
    const st = fs.statSync(LOCK_PATH);
    if (Date.now() - st.mtimeMs < 30000) return;
  } catch {}
  try {
    fs.writeFileSync(LOCK_PATH, String(process.pid));
    const child = spawn(process.execPath, [__filename, '--fetch'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      // 让 Node 内置 fetch 走 HTTPS_PROXY / HTTP_PROXY 代理
      env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
    });
    child.unref();
  } catch {}
}

/**
 * 合并会话内数据（stdin，每次 API 响应后更新）与官方接口数据（定时刷新）
 * - 同一窗口（重置时间相近）：用量只增不减，取较大值即为较新值
 * - 不同窗口：取重置时间更晚的，即更新的那个窗口
 */
function mergeWindow(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (Math.abs((a.resetsAt || 0) - (b.resetsAt || 0)) < 300) {
    return { pct: Math.max(a.pct, b.pct), resetsAt: a.resetsAt || b.resetsAt };
  }
  return (a.resetsAt || 0) > (b.resetsAt || 0) ? a : b;
}

function stdinWindow(w) {
  if (!w || typeof w.used_percentage !== 'number') return null;
  return { pct: w.used_percentage, resetsAt: w.resets_at || 0 };
}

// 窗口已过重置时间：用量归零，重置时间未知
function liveWindow(w) {
  if (!w) return null;
  if (w.resetsAt && w.resetsAt * 1000 <= Date.now()) return { pct: 0, resetsAt: 0 };
  return w;
}

// ---------------- 渲染 ----------------

function render(input, cfg) {
  useColor = cfg.color !== false;
  const seg = {};

  // 模型
  const model = input.model && (input.model.display_name || input.model.id);
  if (model) seg.model = paint(C.magenta, model);

  // effort
  const effort = input.effort && input.effort.level;
  if (effort) seg.effort = paint(C.blue, effort);

  // 工作目录
  const dir = (input.workspace && input.workspace.current_dir) || input.cwd || '';
  if (dir) seg.dir = paint(C.cyan, cfg.dirStyle === 'full' ? dir : path.basename(dir) || dir);

  // git（仅在开启时执行，避免无谓的子进程开销）
  if (cfg.items.git && dir) {
    const g = gitInfo(dir);
    if (g) seg.git = paint(g.dirty ? C.yellow : C.green, g.text);
  }

  // 本会话上下文占用：取最近一次请求的输入总量（含缓存），新会话 current_usage 为空即从 0 计
  const cw = input.context_window || {};
  const u = cw.current_usage || {};
  const ctxTokens = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const ctxSize = cw.context_window_size || 0;
  const ctxPct = ctxSize ? Math.round((ctxTokens / ctxSize) * 100) : cw.used_percentage || 0;
  let ctxText = fmtTokens(ctxTokens);
  if (cfg.contextPercent) ctxText += ` (${ctxPct}%)`;
  seg.context = paint(pctColor(ctxPct), ctxText);

  // 5h / 7d 用量与重置时间
  const intervalSec = REFRESH_TIERS[cfg.usageRefresh];
  const needUsage = ['usage5h', 'usage7d', 'reset5h', 'reset7d'].some((k) => cfg.items[k]);
  if (needUsage) {
    const rl = input.rate_limits || {};
    const cache = intervalSec ? readJson(CACHE_PATH) : null;
    maybeTriggerFetch(cache, intervalSec);
    const w5 = liveWindow(mergeWindow(stdinWindow(rl.five_hour), cache && cache.five_hour));
    const w7 = liveWindow(mergeWindow(stdinWindow(rl.seven_day), cache && cache.seven_day));
    if (w5) {
      seg.usage5h = paint(pctColor(w5.pct), `${Math.round(w5.pct)}%`);
      seg.reset5h = paint(C.gray, fmtReset(w5.resetsAt, false, cfg.resetStyle));
    }
    if (w7) {
      seg.usage7d = paint(pctColor(w7.pct), `${Math.round(w7.pct)}%`);
      seg.reset7d = paint(C.gray, fmtReset(w7.resetsAt, true, cfg.resetStyle));
    }
  }

  const parts = [];
  const withIcons = cfg.icons !== false;
  for (const [k, on] of Object.entries(cfg.items)) {
    if (!on || !seg[k]) continue;
    parts.push(withIcons && ICONS[k] ? `${ICONS[k]} ${seg[k]}` : seg[k]);
  }
  return parts.join(paint(C.gray, cfg.separator));
}

// ---------------- 命令行配置 ----------------

const HELP = `用法: ccsl [选项]   （不带参数直接运行 ccsl 进入交互式设置界面）

  --list                 查看当前配置
  --on  <项...>          开启展示项
  --off <项...>          关闭展示项
  --order <项...>        调整展示顺序（未列出的项保持原相对顺序排在后面）
  --refresh <档位>       用量刷新间隔: ${Object.keys(REFRESH_TIERS).join(' | ')}（默认 3m）
  --dir <name|full>      目录显示：仅目录名 / 完整路径
  --reset <time|countdown>  重置时间显示：具体时刻 / 倒计时
  --ctx-percent <on|off> 上下文后是否附带百分比
  --color <on|off>       是否着色
  --icons <on|off>       是否显示图标
  --sep "<分隔符>"       分隔符，默认 " │ "

展示项: ${ITEM_KEYS.join(', ')}
可用 all 代表全部项，例如: --off all --on model git`;

function cli(args) {
  const cfg = loadConfig();
  const cmd = args[0];
  const rest = args.slice(1);
  const expand = (list) => (list.includes('all') ? ITEM_KEYS : list);
  const checkItems = (list) => {
    const bad = list.filter((k) => !ITEM_KEYS.includes(k));
    if (bad.length) throw new Error(`未知展示项: ${bad.join(', ')}\n可选: ${ITEM_KEYS.join(', ')}`);
  };
  const onOff = (v) => {
    if (v !== 'on' && v !== 'off') throw new Error('取值应为 on 或 off');
    return v === 'on';
  };

  switch (cmd) {
    case '--on':
    case '--off': {
      const list = expand(rest);
      checkItems(list);
      for (const k of list) cfg.items[k] = cmd === '--on';
      break;
    }
    case '--order': {
      checkItems(rest);
      const items = {};
      for (const k of rest) items[k] = cfg.items[k];
      for (const k of Object.keys(cfg.items)) if (!(k in items)) items[k] = cfg.items[k];
      cfg.items = items;
      break;
    }
    case '--refresh':
      if (!(rest[0] in REFRESH_TIERS)) throw new Error(`档位应为: ${Object.keys(REFRESH_TIERS).join(' | ')}`);
      cfg.usageRefresh = rest[0];
      break;
    case '--dir':
      if (!['name', 'full'].includes(rest[0])) throw new Error('取值应为 name 或 full');
      cfg.dirStyle = rest[0];
      break;
    case '--reset':
      if (!['time', 'countdown'].includes(rest[0])) throw new Error('取值应为 time 或 countdown');
      cfg.resetStyle = rest[0];
      break;
    case '--ctx-percent':
      cfg.contextPercent = onOff(rest[0]);
      break;
    case '--color':
      cfg.color = onOff(rest[0]);
      break;
    case '--icons':
      cfg.icons = onOff(rest[0]);
      break;
    case '--sep':
      if (rest[0] === undefined) throw new Error('请提供分隔符');
      cfg.separator = rest[0];
      break;
    case '--list':
      break;
    default:
      console.log(HELP);
      return;
  }
  if (cmd !== '--list') saveConfig(cfg);

  const items = Object.entries(cfg.items)
    .map(([k, v]) => `${v ? '[x]' : '[ ]'} ${k}`)
    .join('\n  ');
  console.log(`展示项（按顺序）:\n  ${items}
用量刷新: ${cfg.usageRefresh}
目录显示: ${cfg.dirStyle}
重置时间: ${cfg.resetStyle}
上下文百分比: ${cfg.contextPercent ? 'on' : 'off'}
着色: ${cfg.color ? 'on' : 'off'}
图标: ${cfg.icons ? 'on' : 'off'}
分隔符: "${cfg.separator}"`);
}

// ---------------- 入口 ----------------

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--fetch') return fetchUsage();
  // 在终端中直接运行（stdin 是 TTY，而非 Claude Code 的管道输入）时打开交互式设置界面
  if ((!args.length && process.stdin.isTTY) || args[0] === '--tui' || args[0] === '-i') {
    return require('./tui').runTui();
  }
  if (args.length) {
    try {
      cli(args);
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    }
    return;
  }

  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let input = {};
    try {
      input = JSON.parse(raw);
    } catch {}
    try {
      process.stdout.write(render(input, loadConfig()));
    } catch (e) {
      process.stdout.write(`statusline error: ${e.message}`);
    }
  });
}

module.exports = { ITEM_KEYS, REFRESH_TIERS, DEFAULT_CONFIG, CONFIG_PATH, CACHE_PATH, loadConfig, saveConfig, render };

// 被 tui.js 引用时只导出，不执行入口逻辑
if (require.main === module) main();
