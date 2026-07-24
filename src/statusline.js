'use strict';

// doom.claude — status-line runtime: a DOOM HUD for your Claude session.
//
// Claude Code runs this once per refresh (~1s with refreshInterval:1), piping a
// JSON context on stdin. We render TWO rows into the status line:
//
//   E1M1  Opus 4.8     ▐▛▏  ‹m›     ‹m›        ✱ B L A M ✱     ← combat scene
//   AMMO 128k ║ HEALTH ▓▓▓▓▓▓░░ 66% ║ ( >_< ) ║ TIME 12s ║ 27 kills  ← status bar
//
// The telemetry becomes DOOM stats: HEALTH = remaining context (context filling
// = taking damage), AMMO = tokens, the DOOMGUY face reacts to Claude's state.
// Everything is keyed by session_id so concurrent Claude sessions don't collide.
//
// HARD RULE: this must NEVER throw — a crash would break the user's status bar.
// Everything is wrapped; on any error we print a minimal safe line and exit 0.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.claude', 'doom');

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
const red = (s) => color('91', s);
const green = (s) => color('92', s);
const yellow = (s) => color('93', s);
const blue = (s) => color('94', s);
const grey = (s) => color('90', s);
const white = (s) => color('97', s);
const brown = (s) => color('33', s);

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
function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// ---- width -----------------------------------------------------------------
function ttyCols() {
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
function visLen(s) {
  // Visible length ignoring ANSI escapes.
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

// ---- read the live Claude state --------------------------------------------
function readState(ctx, sid) {
  const activity = readFileSafe(P('activity', sid)) || 'idle';
  const busy = activity === 'busy';

  const start = parseInt(readFileSafe(P('start', sid)), 10);
  const end = parseInt(readFileSafe(P('end', sid)), 10);
  let elapsed = null;
  if (busy && isFinite(start)) elapsed = Math.max(0, nowSec() - start);

  let agents = parseInt(readFileSafe(P('agents', sid)), 10);
  if (!isFinite(agents) || agents < 0) agents = 0;

  const usedPct =
    ctx.context_window && isNum(ctx.context_window.used_percentage)
      ? ctx.context_window.used_percentage
      : null;
  const health = usedPct != null ? Math.round(100 - usedPct) : null;

  const tokens =
    ctx.context_window && isNum(ctx.context_window.total_input_tokens)
      ? ctx.context_window.total_input_tokens
      : null;

  let armor = null;
  if (ctx.rate_limits && ctx.rate_limits.five_hour && isNum(ctx.rate_limits.five_hour.used_percentage)) {
    armor = Math.round(100 - ctx.rate_limits.five_hour.used_percentage);
  }

  const model = (ctx.model && (ctx.model.display_name || ctx.model.id)) || 'Claude';

  // Grinning window: idle within 4s of the last Stop.
  const justDone = !busy && isFinite(end) && nowSec() - end <= 4;

  return { busy, elapsed, agents, health, tokens, armor, model, justDone };
}

// ---- DOOMGUY face (priority order) -----------------------------------------
function face(st) {
  if (st.health != null && st.health < 30) return red('( x_o )'); // hurt — context nearly full
  if (st.agents >= 3) return yellow('( O_O )'); // swarm
  if (st.busy) return white('( >_< )'); // gritting / focused
  if (st.justDone) return green('( ^o^ )'); // grin after a turn
  return grey('( -.- )'); // calm idle
}

function fmtTokens(n) {
  if (n == null) return null;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// ---- combat scene (row 1, the "game") --------------------------------------
const GUN = 3; // muzzle column
function loadGame(sid) {
  try {
    const g = JSON.parse(fs.readFileSync(gameFile(sid), 'utf8'));
    if (g && Array.isArray(g.imps) && isNum(g.kills)) return g;
  } catch (_) {}
  return { imps: [], kills: 0, flash: 0 };
}
function saveGame(g, sid) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(gameFile(sid), JSON.stringify(g));
  } catch (_) {}
}

// Advance the firefight one tick. Imps rush the gun fast enough that kills tick
// up every few seconds. Returns render + kills + whether we fired this tick.
function tickScene(st, sid, w) {
  const g = loadGame(sid);
  g.flash = Math.max(0, (g.flash || 0) - 1);
  const step = clamp(Math.round(w / 12), 3, 8);
  let fired = false;

  if (st.busy) {
    for (const imp of g.imps) imp.x -= step;
    const survivors = g.imps.filter((i) => i.x > GUN);
    const killed = g.imps.length - survivors.length;
    g.imps = survivors;
    if (killed > 0) {
      g.kills += killed;
      g.flash = 1;
      fired = true;
    }
    const target = 2 + Math.min(st.agents, 4); // more agents → more imps
    while (g.imps.length < target) {
      g.imps.push({ x: GUN + 6 + Math.floor(Math.random() * Math.max(1, w - GUN - 8)) });
    }
  } else {
    g.imps = []; // idle: the corridor clears
  }
  saveGame(g, sid);

  const cells = new Array(w).fill(' ');
  for (const imp of g.imps) {
    const x = clamp(Math.round(imp.x), 0, w - 1);
    cells[x] = 'm';
  }
  return { cells, kills: g.kills, flash: g.flash > 0 && st.busy || fired };
}

function renderScene(st, scene, w) {
  const level = `${red('E1M1')} ${dim(st.model)}`;
  if (!st.busy) {
    return ` ${level}  ${grey('▐▙▏')} ${dim('… zZ')}`;
  }
  const gun = scene.flash ? bold(yellow('▐▛▏▸')) : grey('▐▛▏ ');
  const field = scene.cells.map((c) => (c === 'm' ? brown('m') : ' ')).join('');
  const boom = scene.flash ? red(' †') : '';
  return ` ${level}  ${gun}${field}${boom}`;
}

// ---- DOOM status bar (row 2) -----------------------------------------------
function healthBar(health) {
  const width = 10;
  const filled = clamp(Math.round((health / 100) * width), 0, width);
  const bar = '▓'.repeat(filled) + '░'.repeat(width - filled);
  const col = health < 30 ? red : health < 60 ? yellow : green;
  return col(bar);
}

function buildBar(st) {
  const sep = dim(' ║ ');
  const parts = [];

  const ammo = fmtTokens(st.tokens);
  if (ammo != null) parts.push(`${dim('AMMO')} ${yellow(ammo)}`);

  if (st.health != null) {
    parts.push(`${dim('HEALTH')} ${healthBar(st.health)} ${bold(red(st.health + '%'))}`);
  }

  parts.push(face(st));

  if (st.armor != null) parts.push(`${dim('ARMOR')} ${blue(st.armor + '%')}`);

  if (st.elapsed != null) parts.push(`${dim('TIME')} ${white(st.elapsed + 's')}`);

  const g = st._kills;
  if (isNum(g)) parts.push(`${white(String(g))} ${dim('kills')}`);

  return ' ' + parts.join(sep);
}

// ---- one-row fallback ------------------------------------------------------
function buildCompact(st) {
  const bits = [];
  if (st.health != null) bits.push(`${dim('HP')} ${healthBar(st.health)} ${red(st.health + '%')}`);
  bits.push(face(st));
  const ammo = fmtTokens(st.tokens);
  if (ammo != null) bits.push(`${dim('AMMO')} ${yellow(ammo)}`);
  if (isNum(st._kills)) bits.push(`${white(String(st._kills))} ${dim('kills')}`);
  return ' ' + bits.join(dim(' · '));
}

// ---- main ------------------------------------------------------------------
function main() {
  const ctx = loadJSON(readStdin());
  const sid = sidKey(ctx);
  const cols = totalCols(ctx);
  const st = readState(ctx, sid);

  // Field width = full width minus the "E1M1 <model>  ▐▛▏ " banner + margin.
  const bannerVis = 10 + String(st.model).length;
  const w = clamp(cols - bannerVis - 2, 10, 400);

  // Advance the scene once (updates kills), then render both rows.
  const scene = tickScene(st, sid, w);
  st._kills = scene.kills;
  const sceneRow = renderScene(st, scene, w);
  const bar = buildBar(st);

  // Trim any row that would overflow the terminal width (avoid wrapping).
  const fit = (s) => {
    if (visLen(s) <= cols) return s;
    // crude trim keeping escapes intact enough for a status line
    let out = '';
    let vis = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\x1b') {
        const m = s.slice(i).match(/^\x1b\[[0-9;]*m/);
        if (m) {
          out += m[0];
          i += m[0].length - 1;
          continue;
        }
      }
      if (vis >= cols) break;
      out += s[i];
      vis++;
    }
    return out;
  };

  process.stdout.write(fit(sceneRow) + '\n' + fit(bar) + '\n');
}

try {
  main();
} catch (_) {
  try {
    process.stdout.write(' DOOM · doom.claude\n ( >_< ) HEALTH ▓▓▓▓░ \n');
  } catch (__) {}
}
