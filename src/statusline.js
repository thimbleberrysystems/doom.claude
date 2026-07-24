'use strict';

// snake.claude — status-line runtime.
//
// Claude Code runs this once per refresh (~1s with refreshInterval:1), piping a
// JSON context on stdin. We render TWO rows into the status line:
//
//   <model> · <state> · ctx <n>% · <t>s · <n> agents      ← live Claude HUD
//   ❚      ●               ❚  L:R                          ← auto-play Pong
//
// State that must persist between runs (ball/paddles/score) lives in a small
// JSON file, since each invocation is a fresh, short-lived process. The HUD's
// busy/idle + timer + agent count come from files the hooks write.
//
// HARD RULE: this must NEVER throw — a crash would break the user's status bar.
// Everything is wrapped; on any error we print a minimal safe line and exit 0.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.claude', 'snake');
const F = {
  game: path.join(DIR, 'arcade.json'),
  activity: path.join(DIR, 'activity'),
  start: path.join(DIR, 'start'),
  agents: path.join(DIR, 'agents'),
};

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
  // Status line pipes JSON on stdin. When run interactively there's no pipe, so
  // guard on isTTY to avoid blocking, and never throw.
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
// A one-row rally: ball bounces between two end paddles; a paddle occasionally
// "misses", conceding a point and resetting the ball from center.
const MISS = 0.12; // chance a paddle misses when the ball reaches its wall
const WIN = 9; // first to WIN resets the match

function rand() {
  // Math.random is fine here (normal Node process, not a workflow sandbox).
  return Math.random();
}
function freshGame(w) {
  return { w, bx: Math.floor(w / 2), vx: rand() < 0.5 ? -1 : 1, sl: 0, sr: 0 };
}
function loadGame(w) {
  let g;
  try {
    g = JSON.parse(fs.readFileSync(F.game, 'utf8'));
  } catch (_) {
    g = null;
  }
  if (!g || g.w !== w || !isNum(g.bx) || !isNum(g.vx)) return freshGame(w);
  if (!isNum(g.sl)) g.sl = 0;
  if (!isNum(g.sr)) g.sr = 0;
  return g;
}
function saveGame(g) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(F.game, JSON.stringify(g));
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

// ---- layout ----------------------------------------------------------------
function totalCols(ctx) {
  // Claude may pass a width; fall back to stdout columns, else a sane default.
  const cand = [
    ctx && ctx.width,
    ctx && ctx.terminal && ctx.terminal.width,
    process.stdout && process.stdout.columns,
  ].find(isNum);
  return isNum(cand) ? cand : 60;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// ---- HUD -------------------------------------------------------------------
function buildHud(ctx) {
  const activity = readFileSafe(F.activity) || 'idle';
  const busy = activity === 'busy';

  const model =
    (ctx.model && (ctx.model.display_name || ctx.model.id)) || 'Claude';
  const dot = busy ? green('●') : grey('○');
  const state = busy ? 'thinking' : 'idle';

  const parts = [bold(white(model)), `${dot} ${busy ? yellow(state) : grey(state)}`];

  const pct =
    ctx.context_window && isNum(ctx.context_window.used_percentage)
      ? Math.round(ctx.context_window.used_percentage)
      : null;
  if (pct != null) parts.push(dim(`ctx ${pct}%`));

  if (busy) {
    const start = parseInt(readFileSafe(F.start), 10);
    if (isFinite(start)) {
      const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - start);
      parts.push(dim(`${elapsed}s`));
    }
  }

  const agents = parseInt(readFileSafe(F.agents), 10);
  if (isFinite(agents) && agents > 0) {
    parts.push(cyan(`${agents} agent${agents === 1 ? '' : 's'}`));
  }

  return ' ' + parts.join(dim(' · '));
}

// ---- game row --------------------------------------------------------------
function buildGame(cols) {
  // Reserve room for two paddles + a "  L:R" score label.
  const w = clamp(cols - 12, 12, 40);
  const g = tick(loadGame(w));
  saveGame(g);

  const cells = new Array(w).fill(' ');
  cells[clamp(g.bx, 0, w - 1)] = white('●');
  const court = dim('❚') + cells.join('') + dim('❚');
  const score = '  ' + dim(`${g.sl}:${g.sr}`);
  return ' ' + court + score;
}

// ---- main ------------------------------------------------------------------
function main() {
  const ctx = loadJSON(readStdin());
  const cols = totalCols(ctx);
  const hud = buildHud(ctx);
  const game = buildGame(cols);
  process.stdout.write(hud + '\n' + game + '\n');
}

try {
  main();
} catch (_) {
  // Absolute fallback — keep the status bar alive no matter what.
  try {
    process.stdout.write(' snake.claude\n ❚   ●        ❚\n');
  } catch (__) {}
}
