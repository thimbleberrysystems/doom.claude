'use strict';

// snake.claude — status-line runtime.
//
// Claude Code runs this once per refresh (~1s with refreshInterval:1), piping a
// JSON context on stdin. We render TWO rows into the status line:
//
//   <model> · <state> · ctx <n>% · <t>s · <n> agents      ← live Claude HUD
//   ❚      ●               ❚  L:R                          ← auto-play Pong
//
// Everything is keyed by session_id so multiple concurrent Claude sessions each
// get their own HUD state + their own Pong (no shared-file clobbering).
//
// HARD RULE: this must NEVER throw — a crash would break the user's status bar.
// Everything is wrapped; on any error we print a minimal safe line and exit 0.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.claude', 'snake');

function sidKey(ctx) {
  const raw = ctx && typeof ctx.session_id === 'string' ? ctx.session_id : '';
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, '_');
  return safe || 'default';
}
const P = (name, sid) => path.join(DIR, `${name}.${sid}`);
const gameFile = (sid) => path.join(DIR, `arcade.${sid}.json`);

// ---- ANSI helpers ----------------------------------------------------------
const useColor = !process.env.NO_COLOR;
function color(code, s) {
  return useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s);
}
const dim = (s) => color('2', s);
const bold = (s) => color('1', s);
const cyan = (s) => color('36', s);
const green = (s) => color('92', s);
const yellow = (s) => color('93', s);
const grey = (s) => color('90', s);
const white = (s) => color('97', s);

// ---- safe IO ---------------------------------------------------------------
function readStdin() {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}
function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch (_) {
    return '';
  }
}
function loadJSON(str) {
  try {
    const v = JSON.parse(str || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (_) {
    return {};
  }
}
function isNum(x) {
  return typeof x === 'number' && isFinite(x);
}

// ---- Pong model (auto-play) ------------------------------------------------
const MISS = 0.12; // chance a paddle misses when the ball reaches its wall
const WIN = 9; // first to WIN resets the match

function rand() {
  return Math.random();
}
function freshGame(w) {
  return { w, bx: Math.floor(w / 2), vx: rand() < 0.5 ? -1 : 1, sl: 0, sr: 0 };
}
function loadGame(w, sid) {
  let g;
  try {
    g = JSON.parse(fs.readFileSync(gameFile(sid), 'utf8'));
  } catch (_) {
    g = null;
  }
  if (!g || g.w !== w || !isNum(g.bx) || !isNum(g.vx)) return freshGame(w);
  if (!isNum(g.sl)) g.sl = 0;
  if (!isNum(g.sr)) g.sr = 0;
  return g;
}
function saveGame(g, sid) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(gameFile(sid), JSON.stringify(g));
  } catch (_) {}
}
function tick(g) {
  const w = g.w;
  g.bx += g.vx;
  if (g.bx <= 0) {
    if (rand() < MISS) {
      g.sr++;
      g.bx = Math.floor(w / 2);
      g.vx = 1;
    } else {
      g.bx = 0;
      g.vx = 1;
    }
  } else if (g.bx >= w - 1) {
    if (rand() < MISS) {
      g.sl++;
      g.bx = Math.floor(w / 2);
      g.vx = -1;
    } else {
      g.bx = w - 1;
      g.vx = -1;
    }
  }
  if (g.sl >= WIN || g.sr >= WIN) {
    g.sl = 0;
    g.sr = 0;
  }
  return g;
}

// ---- width -----------------------------------------------------------------
function ttyCols() {
  // The status line is piped (no stdout TTY) and Claude passes no width field,
  // but the controlling terminal is reachable via /dev/tty — ask it directly.
  try {
    const out = require('child_process').execSync('stty size </dev/tty', {
      encoding: 'utf8',
      timeout: 200,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const c = parseInt(String(out).trim().split(/\s+/)[1], 10);
    return isNum(c) ? c : null;
  } catch (_) {
    return null;
  }
}
function totalCols(ctx) {
  const cand = [
    ttyCols(),
    ctx && ctx.width,
    process.stdout && process.stdout.columns,
    parseInt(process.env.COLUMNS, 10),
  ].find(isNum);
  return isNum(cand) ? cand : 80;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// ---- HUD -------------------------------------------------------------------
function buildHud(ctx, sid) {
  const busy = (readFileSafe(P('activity', sid)) || 'idle') === 'busy';

  const model = (ctx.model && (ctx.model.display_name || ctx.model.id)) || 'Claude';
  const dot = busy ? green('●') : grey('○');
  const state = busy ? yellow('thinking') : grey('idle');

  const parts = [bold(white(model)), `${dot} ${state}`];

  const pct = ctx.context_window && isNum(ctx.context_window.used_percentage)
    ? Math.round(ctx.context_window.used_percentage)
    : null;
  if (pct != null) parts.push(dim(`ctx ${pct}%`));

  if (busy) {
    const start = parseInt(readFileSafe(P('start', sid)), 10);
    if (isFinite(start)) {
      const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - start);
      parts.push(dim(`${elapsed}s`));
    }
  }

  const agents = parseInt(readFileSafe(P('agents', sid)), 10);
  if (isFinite(agents) && agents > 0) {
    parts.push(cyan(`${agents} agent${agents === 1 ? '' : 's'}`));
  }

  return ' ' + parts.join(dim(' · '));
}

// ---- game row --------------------------------------------------------------
function buildGame(cols, sid) {
  const w = clamp(cols - 10, 12, 400); // fill the width; leave room for paddles + score
  const g = tick(loadGame(w, sid));
  saveGame(g, sid);

  const cells = new Array(w).fill(' ');
  cells[clamp(g.bx, 0, w - 1)] = white('●');
  const court = dim('❚') + cells.join('') + dim('❚');
  return ' ' + court + '  ' + dim(`${g.sl}:${g.sr}`);
}

// ---- main ------------------------------------------------------------------
function main() {
  const ctx = loadJSON(readStdin());
  const sid = sidKey(ctx);
  const cols = totalCols(ctx);
  const hud = buildHud(ctx, sid);
  const game = buildGame(cols, sid);
  process.stdout.write(hud + '\n' + game + '\n');
}

try {
  main();
} catch (_) {
  try {
    process.stdout.write(' snake.claude\n ❚   ●        ❚\n');
  } catch (__) {}
}
