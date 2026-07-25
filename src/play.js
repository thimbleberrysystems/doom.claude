'use strict';

// Real Doom in your terminal. Drives the vendored doomgeneric-WASM engine and
// renders the 640x400 framebuffer with half-block (▀) truecolor cells — each
// cell is two vertical pixels (top = foreground, bottom = background).
//
// Input: on terminals that support the Kitty keyboard protocol we get real
// key press AND release events (crisp strafe/run). Elsewhere we fall back to
// press-only with a short hold timer (autorepeat keeps a held key "down").
//
// Rendering: cell-level frame diffing — only changed cells are repainted, with
// cursor jumps over unchanged runs — so it stays smooth even over SSH.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DoomEngine } = require('./doom-engine');
const { DoomKeys: K, mapKeyToDoom } = require('./doom-keys');

const out = process.stdout;
const inp = process.stdin;

const FPS = 35;
const HOLD_MS = 220;

let engine = null;
let kittyEnabled = false;

// Sixel (crisp pixel) rendering — engaged only when the terminal advertises it.
const SIXEL_FPS = 20;                 // clarity over motion (blocks run at FPS=35)
let useSixel = false;
let sixelCellW = 10, sixelCellH = 20; // character-cell pixel size (queried; fallback guess)
let frameToSixel = null;              // lazy-loaded from ./sixel when Sixel is used
let sixelPrevSig = -1;                // last drawn frame signature (for idle frame-skip)
let sixelCols = 0, sixelRows = 0;     // last pane size (detect resize → clear)
let sixelStartRow = 0;                // top row of the game image (rows above = info panel)
let panelTick = 0;                    // throttles the info-panel redraw

// Coupling for `split` (KABOOM_ID injected into both panes). The game plays only
// while its pane is FOCUSED and freezes when you switch away — so you control
// pause/play just by moving between panes; nothing is ever forced. Separately,
// Claude's replies show a gentle "ready" note (no interruption). Standalone play
// (no KABOOM_ID) always runs and never pauses.
const KID = process.env.KABOOM_ID || null;
const ACT = KID ? path.join(os.homedir(), '.claude', 'kaboom', `activity.${KID}`) : null;
// "Don't interrupt" flag, written by the status-bar button (bin click) and read
// here. A plain file (like ACT) — no cross-process tmux read to go wrong.
const KEEP = KID ? path.join(os.homedir(), '.claude', 'kaboom', `keep.${KID}`) : null;
const KDIR = path.join(os.homedir(), '.claude', 'kaboom'); // per-session info files (hooks + statusline)
const SELF_PANE = process.env.TMUX_PANE || ''; // this game's tmux pane
// After the game closes, the status bar shows just this — a ✕ that ends the
// whole split. Shared with split/click via src/bar.js.
const { CLOSE_CLAUDE_BAR, statusRight } = require('./bar');
const MIN_COLS = 6; // width of the minimized "sliver" (kept in sync with bin click)
let focused = false;       // game pane focused? starts false (split focuses Claude first)
let paused = !!KID;        // derived: coupled & not focused → frozen
let frozenDirty = !!KID;
let claudeReady = false;   // Claude has replied and you haven't gone back yet
let claudeMtime = -1;

// ---- terminal setup / guaranteed teardown ----------------------------------
let tornDown = false;
function teardown() {
  if (tornDown) return;
  tornDown = true;
  try { if (kittyEnabled) out.write('\x1b[<u'); } catch (_) {} // pop Kitty flags
  try { out.write('\x1b[?1004l\x1b[?1000l\x1b[?1006l'); } catch (_) {} // disable focus/mouse reporting
  try { if (inp.isTTY) inp.setRawMode(false); } catch (_) {}
  try { out.write('\x1b[0m\x1b[?25h\x1b[?1049l'); } catch (_) {}
  try { inp.pause(); } catch (_) {}
}
process.on('exit', teardown);
process.on('SIGINT', () => { teardown(); process.exit(0); });
process.on('SIGTERM', () => { teardown(); process.exit(0); });
process.on('uncaughtException', (err) => {
  teardown();
  process.stderr.write(`\nkaboom.claude crashed: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});

// Quit the game. In a split, close only the game's pane (Claude keeps running);
// standalone, just exit.
function quitGame() {
  teardown();
  if (KID && SELF_PANE) {
    // Closing the game flips the bottom-bar button to "✕ Close Claude", then
    // closes only the game pane (Claude keeps running).
    tmuxSelf(['set-option', '-g', 'status-right', CLOSE_CLAUDE_BAR]);
    tmuxSelf(['kill-pane', '-t', SELF_PANE]);
  }
  process.exit(0);
}

// ---- rendering (sextant blocks: 2×3 pixels per cell + colour clustering) ----
// Each cell shows a 2×3 sub-pixel block using a sextant glyph. Two wins over
// half/quadrant blocks: (1) 3 sub-pixels TALL (not 2) — the extra vertical detail
// is what makes small text legible; (2) fg/bg are chosen by clustering the 6
// sub-pixels into two colours by RGB distance, NOT luminance — so red-on-red menu
// text (similar brightness, different colour) no longer merges into noise.
// Sextants need a modern terminal font (Kitty/Ghostty/WezTerm/foot/recent Windows
// Terminal & VTE); set KABOOM_BLOCKS=quad to fall back to 2×2 quadrant glyphs.
const USE_SEXTANT = process.env.KABOOM_BLOCKS !== 'quad';
const SEXTANT = (() => {
  const t = new Array(64);
  t[0] = ' '; t[63] = '█'; t[21] = '▌'; t[42] = '▐';
  let cp = 0x1FB00;
  for (let v = 1; v < 63; v++) { if (v === 21 || v === 42) continue; t[v] = String.fromCodePoint(cp++); }
  return t;
})();
const QUAD = [' ', '▗', '▖', '▄', '▝', '▐', '▞', '▟', '▘', '▚', '▌', '▙', '▀', '▜', '▛', '█'];
// Sub-pixel layout: 2 wide (half-cell apart) × N tall. Sextant N=3, quadrant N=2.
const NY = USE_SEXTANT ? 3 : 2;
const DX = USE_SEXTANT ? [0, 1, 0, 1, 0, 1] : [0, 1, 0, 1];
const DY = USE_SEXTANT ? [0, 0, 1, 1, 2, 2] : [0, 0, 1, 1];
const GLYPH = USE_SEXTANT ? SEXTANT : QUAD;

function px(fb, sw, sh, x, y) {
  if (x < 0 || y < 0 || x >= sw || y >= sh) return [0, 0, 0];
  const i = (y * sw + x) * 4; // memory order B,G,R,A
  return [fb[i + 2], fb[i + 1], fb[i]];
}
function layout(sw, sh, cols, rows) {
  const vpx = rows * 2; // vertical extent in half-cell units (cell is ~2× tall)
  const scale = Math.min(cols / sw, vpx / sh);
  return { scale, offX: (cols - sw * scale) / 2, offY: (vpx - sh * scale) / 2 };
}
function dist2(a, b) { const r = a[0] - b[0], g = a[1] - b[1], b2 = a[2] - b[2]; return r * r + g * g + b2 * b2; }

// Returns [Fr,Fg,Fb, Br,Bg,Bb, patternBits] for cell (cx,cy).
function cell(fb, sw, sh, cx, cy, L) {
  const n = DX.length; // 6 (sextant) or 4 (quadrant)
  const vstep = 2 / NY; // vertical sub-pixel pitch in half-cell units
  const p = [];
  for (let k = 0; k < n; k++) {
    const sx = Math.floor((cx + DX[k] * 0.5 - L.offX) / L.scale);
    const sy = Math.floor((cy * 2 + DY[k] * vstep - L.offY) / L.scale);
    p.push(px(fb, sw, sh, sx, sy));
  }
  // Two-colour split seeded by the most-distant sub-pixel pair (colour, not luma).
  let mi = 0, mj = 1, md = -1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = dist2(p[i], p[j]); if (d > md) { md = d; mi = i; mj = j; } }
  const A = p[mi], B = p[mj];
  let fr = 0, fg = 0, fbb = 0, fn = 0, br = 0, bg = 0, bb = 0, bn = 0, bits = 0;
  for (let k = 0; k < n; k++) {
    if (dist2(p[k], A) <= dist2(p[k], B)) { fr += p[k][0]; fg += p[k][1]; fbb += p[k][2]; fn++; bits |= (1 << k); }
    else { br += p[k][0]; bg += p[k][1]; bb += p[k][2]; bn++; }
  }
  const Fr = fn ? (fr / fn) | 0 : 0, Fg = fn ? (fg / fn) | 0 : 0, Fb = fn ? (fbb / fn) | 0 : 0;
  const Br = bn ? (br / bn) | 0 : Fr, Bg = bn ? (bg / bn) | 0 : Fg, Bb = bn ? (bb / bn) | 0 : Fb;
  return [Fr, Fg, Fb, Br, Bg, Bb, bits];
}

// Pure: whole-frame ANSI string (used by tests).
function frameToString(fb, sw, sh, cols, rows) {
  const L = layout(sw, sh, cols, rows);
  let buf = '\x1b[H';
  for (let cy = 0; cy < rows; cy++) {
    let lastFg = -1, lastBg = -1;
    for (let cx = 0; cx < cols; cx++) {
      const c = cell(fb, sw, sh, cx, cy, L);
      const fg = (c[0] << 16) | (c[1] << 8) | c[2], bg = (c[3] << 16) | (c[4] << 8) | c[5];
      if (fg !== lastFg) { buf += `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`; lastFg = fg; }
      if (bg !== lastBg) { buf += `\x1b[48;2;${c[3]};${c[4]};${c[5]}m`; lastBg = bg; }
      buf += GLYPH[c[6]];
    }
    buf += '\x1b[0m';
    if (cy < rows - 1) buf += '\n';
  }
  return buf;
}

// Stateful, diffing renderer for the game loop.
let prev = null, prevCols = 0, prevRows = 0;
function renderFrame(eng) {
  const fb = eng.frame();
  if (!fb) return;
  const sw = eng.width, sh = eng.height;
  const cols = out.columns || 80, rows = out.rows || 24;
  if (cols !== prevCols || rows !== prevRows) { prev = null; prevCols = cols; prevRows = rows; out.write('\x1b[2J'); }
  const L = layout(sw, sh, cols, rows);

  const cur = new Int32Array(cols * rows * 3);
  let buf = '';
  for (let cy = 0; cy < rows; cy++) {
    let lastFg = -1, lastBg = -1, skip = 0, cursorSet = false;
    for (let cx = 0; cx < cols; cx++) {
      const c = cell(fb, sw, sh, cx, cy, L);
      const fg = (c[0] << 16) | (c[1] << 8) | c[2], bg = (c[3] << 16) | (c[4] << 8) | c[5];
      const idx = (cy * cols + cx) * 3;
      cur[idx] = fg; cur[idx + 1] = bg; cur[idx + 2] = c[6];
      if (prev && prev[idx] === fg && prev[idx + 1] === bg && prev[idx + 2] === c[6]) { skip++; continue; }
      if (!cursorSet) { buf += `\x1b[${cy + 1};${cx + 1}H`; cursorSet = true; skip = 0; lastFg = lastBg = -1; }
      else if (skip > 0) { buf += `\x1b[${skip}C`; skip = 0; lastFg = lastBg = -1; }
      if (fg !== lastFg) { buf += `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`; lastFg = fg; }
      if (bg !== lastBg) { buf += `\x1b[48;2;${c[3]};${c[4]};${c[5]}m`; lastBg = bg; }
      buf += GLYPH[c[6]];
    }
    if (cursorSet) buf += '\x1b[0m';
  }
  prev = cur;
  if (buf) out.write(buf);
}

// Cheap sampled signature of a frame + its output geometry — lets us skip
// re-encoding/emitting an identical frame (e.g. a static menu).
function sixelSig(fb, outW, outH) {
  let h = ((outW << 16) ^ outH) | 0;
  for (let i = 0; i < fb.length; i += 512) h = (Math.imul(h, 33) + fb[i]) | 0;
  return h;
}

// Sixel renderer: draw the framebuffer as real pixels, scaled to fill the pane
// (preserving Doom's 4:3 display aspect), wrapped in synchronized output so it
// never tears. Falls back to nothing if the frame isn't ready.
function renderFrameSixel(eng) {
  const fb = eng.frame();
  if (!fb) return;
  const sw = eng.width, sh = eng.height;
  const cols = out.columns || 80, rows = out.rows || 24;
  if (cols !== sixelCols || rows !== sixelRows) { // pane resized → clear stale pixels
    out.write('\x1b[2J'); sixelCols = cols; sixelRows = rows; sixelPrevSig = -1;
  }
  // Fit a 4:3 image inside the pane's pixel box, leaving the last row free so
  // the image can't spill past the pane and scroll it.
  const boxW = cols * sixelCellW, boxH = (rows - 1) * sixelCellH;
  const ASPECT = 4 / 3;
  let outW, outH;
  if (boxW / boxH > ASPECT) { outH = boxH; outW = Math.round(boxH * ASPECT); }
  else { outW = boxW; outH = Math.round(boxW / ASPECT); }
  // Never upscale past native 640x480 — extra pixels cost encode time with no
  // detail gain (source is 640x400). Downscale to fit smaller panes.
  const cap = Math.min(1, 640 / outW, 480 / outH);
  outW = Math.max(2, Math.round(outW * cap));
  outH = Math.max(2, Math.round(outH * cap));

  const sig = sixelSig(fb, outW, outH);
  if (sig === sixelPrevSig) return; // unchanged → nothing to redraw
  sixelPrevSig = sig;

  // Center horizontally; DOCK to the bottom of the pane (so the game sits
  // bottom-right, with empty space above). Leave the last row free to avoid
  // scrolling. Synchronized output (DEC 2026) swaps the whole frame at once.
  const padCols = Math.max(0, Math.floor((cols - Math.ceil(outW / sixelCellW)) / 2));
  const imgRows = Math.ceil(outH / sixelCellH);
  const startRow = Math.max(1, rows - imgRows);
  sixelStartRow = startRow; // rows 1..startRow-1 are the info-panel area
  const home = `\x1b[${startRow};${padCols + 1}H`;
  out.write('\x1b[?2026h' + home + frameToSixel(fb, sw, sh, outW, outH) + '\x1b[?2026l');
}

// ---- Claude info panel (drawn in the empty top rows of the game column) -----
const PC = { // palette (256-colour)
  label: '\x1b[38;5;244m', val: '\x1b[38;5;253m', cyan: '\x1b[38;5;44m',
  green: '\x1b[38;5;42m', yellow: '\x1b[38;5;222m', red: '\x1b[38;5;203m', reset: '\x1b[0m',
};
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const NEEDS_YOU = ['permission_prompt', 'idle_prompt', 'agent_needs_input'];

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) { const k = n / 1000; return (k >= 100 ? Math.round(k) : k.toFixed(1)) + 'k'; }
  return String(n | 0);
}
function fmtElapsed(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function ctxBar(pct, width) {
  const fill = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  const col = pct >= 85 ? PC.red : pct >= 60 ? PC.yellow : PC.green;
  return col + '▓'.repeat(fill) + '\x1b[38;5;238m' + '░'.repeat(width - fill) + PC.reset;
}
function readInfo() {
  const r = (name) => { try { return fs.readFileSync(path.join(KDIR, `${name}.${KID}`), 'utf8').trim(); } catch (_) { return ''; } };
  let info = {};
  try { info = JSON.parse(fs.readFileSync(path.join(KDIR, `info.${KID}.json`), 'utf8')); } catch (_) {}
  return {
    activity: r('activity'), start: parseInt(r('start'), 10) || 0, turns: parseInt(r('turns'), 10) || 0,
    agents: parseInt(r('agents'), 10) || 0, tool: r('tool'), bell: r('bell'), info,
  };
}
function buildPanelLines(d, cols) {
  const info = d.info || {}, now = Date.now(), L = [];
  const busy = d.activity === 'busy', needsYou = NEEDS_YOU.indexOf(d.bell) !== -1;
  // State line carries the "bell": working / needs-you / replied / idle.
  let state;
  if (busy) {
    const sp = SPIN[Math.floor(now / 100) % SPIN.length];
    const el = d.start ? '  ' + PC.label + fmtElapsed(Math.max(0, Math.floor(now / 1000) - d.start)) + PC.reset : '';
    state = `${PC.green}${sp} Working${PC.reset}${el}`;
  } else if (needsYou) state = `${PC.yellow}🔔 Claude needs you${PC.reset}`;
  else if (claudeReady) state = `${PC.yellow}🔔 Claude replied${PC.reset}`;
  else state = `${PC.label}✓ idle${PC.reset}`;
  L.push(' ' + state);
  if (info.model) L.push(' ' + PC.cyan + info.model + PC.reset);
  L.push('');
  if (info.ctxSize) {
    const w = Math.max(6, Math.min(12, cols - 14));
    L.push(' ' + PC.label + 'ctx ' + PC.reset + ctxBar(info.ctxPct || 0, w) + ' ' + PC.val + (info.ctxPct || 0) + '%' + PC.reset);
  }
  if (info.inTok) L.push(' ' + PC.label + 'tok ' + PC.reset + PC.val + fmtTokens(info.inTok) + PC.reset);
  if (d.agents > 0) L.push(' ' + PC.label + 'agents ' + PC.reset + PC.val + d.agents + PC.reset);
  if (busy && d.tool) L.push(' ' + PC.label + 'tool ' + PC.reset + PC.val + d.tool + PC.reset);
  if (info.costUsd) L.push(' ' + PC.label + 'cost ' + PC.reset + PC.val + '$' + info.costUsd.toFixed(2) + PC.reset);
  if (d.turns) L.push(' ' + PC.label + 'turn ' + PC.reset + PC.val + d.turns + PC.reset);
  // Controls — compact, at the bottom of the panel (cut first if space is tight).
  const key = (k, act) => PC.val + k + PC.reset + PC.label + ' ' + act + PC.reset;
  L.push('');
  L.push(' ' + PC.label + 'controls' + PC.reset);
  L.push(' ' + key('WASD', 'move') + '  ' + key('Space', 'fire'));
  L.push(' ' + key('E', 'use') + '  ' + key('Shift', 'run'));
  L.push(' ' + key('1-7', 'weapons') + '  ' + key('Tab', 'map'));
  L.push(' ' + key('Esc', 'menu') + '  ' + key('Q', 'quit'));
  return L;
}
function renderInfoPanel() {
  if (!KID || !useSixel) return;
  const maxRows = sixelStartRow - 1;
  if (maxRows < 3) return; // not enough room above the game
  const cols = out.columns || 80;
  const lines = buildPanelLines(readInfo(), cols);
  let buf = '';
  for (let i = 0; i < maxRows; i++) {
    buf += `\x1b[${i + 1};1H\x1b[K`;      // clear the panel row
    if (i < lines.length) buf += lines[i]; // then draw its content
  }
  out.write(buf);
}
function maybePanel() {
  if (useSixel && KID && (panelTick++ % 6 === 0)) renderInfoPanel(); // ~3x/sec at 20fps
}
// Paused screen for Sixel mode: clear only the game area (keep the info panel).
function drawFrozenSixel() {
  const rows = out.rows || 24, cols = out.columns || 80;
  const from = Math.max(1, sixelStartRow);
  const msg = '⏸  Paused — click here (or Alt-→) to play';
  const r = Math.floor((from + rows) / 2);
  const c = Math.max(1, Math.floor((cols - msg.length) / 2) + 1);
  out.write(`\x1b[${from};1H\x1b[0J\x1b[${r};${c}H\x1b[38;5;250m${msg}\x1b[0m`);
  sixelPrevSig = -1; // force a full game redraw on resume
}

// ---- input: legacy (press-only + hold emulation) ---------------------------
const holdTimers = new Map();
function press(key) {
  engine.pushKey(true, key);
  const existing = holdTimers.get(key);
  if (existing) clearTimeout(existing);
  holdTimers.set(key, setTimeout(() => { engine.pushKey(false, key); holdTimers.delete(key); }, HOLD_MS));
}

// ---- input: Kitty keyboard protocol (real press/release) -------------------
function cpToDoom(cp, shift) {
  let keys = [];
  switch (String.fromCharCode(cp).toLowerCase()) {
    case 'w': keys = [K.UP]; break;
    case 's': keys = [K.DOWN]; break;
    case 'a': keys = [K.STRAFE_L]; break;
    case 'd': keys = [K.STRAFE_R]; break;
    case 'f': keys = [K.FIRE]; break;
    case ' ': keys = [K.FIRE]; break;
    case 'e': keys = [K.USE]; break; // open doors / flip switches
  }
  if (cp === 13) keys = [K.ENTER];
  else if (cp === 9) keys = [K.TAB];
  else if (cp === 27) keys = [K.ESCAPE];
  else if (cp === 127) keys = [K.BACKSPACE];
  else if (cp >= 48 && cp <= 57) keys = [cp];
  else if (keys.length === 0 && cp >= 32) keys = [String.fromCharCode(cp).toLowerCase().charCodeAt(0)];
  if (shift && (keys[0] === K.UP || keys[0] === K.DOWN || keys[0] === K.STRAFE_L || keys[0] === K.STRAFE_R)) {
    keys = keys.concat([K.RSHIFT]);
  }
  return keys;
}

// Parse a chunk of Kitty CSI sequences → drive the engine. Exposed for tests.
function handleKitty(s, eng) {
  if (s.indexOf('\x03') !== -1) { quitGame(); }
  const re = /\x1b\[([0-9;:]*)([A-Za-z~])/g;
  let m;
  while ((m = re.exec(s))) {
    const groups = m[1].split(';');
    const fin = m[2];
    const cp = parseInt((groups[0] || '').split(':')[0] || '0', 10);
    const modev = (groups[1] || '').split(':');
    const mod = parseInt(modev[0] || '1', 10);
    const ev = parseInt(modev[1] || '1', 10); // 1 press, 2 repeat, 3 release
    const shift = ((mod - 1) & 1) !== 0;
    const ctrl = ((mod - 1) & 4) !== 0;
    let keys = [];
    if (fin === 'u') {
      if (cp === 113 || cp === 81) { quitGame(); }   // q / Q
      if (cp === 99 && ctrl) { quitGame(); }         // Ctrl+C
      keys = cpToDoom(cp, shift);
    } else if (fin === 'A') keys = shift ? [K.UP, K.RSHIFT] : [K.UP];
    else if (fin === 'B') keys = shift ? [K.DOWN, K.RSHIFT] : [K.DOWN];
    else if (fin === 'C') keys = [K.RIGHT];
    else if (fin === 'D') keys = [K.LEFT];
    const pressed = ev !== 3;
    for (const k of keys) eng.pushKey(pressed, k);
  }
}

// ---- focus-based pause + Claude-ready notice -------------------------------
function updatePaused() {
  const p = KID ? !focused : false;
  if (p !== paused) {
    paused = p;
    if (paused) frozenDirty = true;
    else prev = null; // regained focus → force a full redraw of the game
  }
}
function tmuxSelf(args) {
  try { require('child_process').spawnSync('tmux', args, { stdio: 'ignore' }); } catch (_) {}
}
function tmuxGet(args) {
  try { return (require('child_process').spawnSync('tmux', args, { encoding: 'utf8' }).stdout || '').trim(); }
  catch (_) { return ''; }
}
// Our own pane width in columns (0 if unknown).
function selfWidth() {
  if (!SELF_PANE) return 0;
  return parseInt(tmuxGet(['display-message', '-p', '-t', SELF_PANE, '#{pane_width}']), 10) || 0;
}
// Restore the game from the minimized sliver back to its last width. Called when
// you click the sliver (the ‹‹ on its border) — the strip itself is the button.
function restoreSelf() {
  let w = parseInt(tmuxGet(['show-options', '-pqv', '-t', SELF_PANE, '@kaboom_lastw']), 10);
  if (!w || w < MIN_COLS) {
    const win = parseInt(tmuxGet(['display-message', '-p', '-t', SELF_PANE, '#{window_width}']), 10) || 100;
    w = Math.round(win * 0.62);
  }
  tmuxSelf(['resize-pane', '-t', SELF_PANE, '-x', String(w)]);
  tmuxSelf(['select-pane', '-t', SELF_PANE, '-T', 'GAME ▶']); // drop the ‹‹ affordance
  tmuxSelf(['set-option', '-g', '@kaboom_min', '0']);
  tmuxSelf(['set-option', '-g', 'status-right',
    statusRight({ minimized: false, keepPlaying: keepPlaying() })]); // preserve Don't-interrupt
  prev = null; // force a full redraw at the new size
}
// Read Claude's state. When Claude STARTS working, bring the game into focus so
// you can play the wait. When Claude REPLIES, by default pause the game and
// return focus to Claude — unless "Don't interrupt" (the keep.<id> file) is on, in
// which case we stay and just show a 🔔 note.
function keepPlaying() {
  try { return fs.readFileSync(KEEP, 'utf8').trim() === '1'; } catch (_) { return false; }
}
function pollClaude() {
  let m = 0;
  try { m = fs.statSync(ACT).mtimeMs; } catch (_) {}
  if (m !== claudeMtime) {
    let s = '';
    try { s = fs.readFileSync(ACT, 'utf8').trim(); } catch (_) {}
    if (s === 'busy') {
      claudeReady = false;
      prev = null;
      // Focus the game pane so it starts playing. Does NOT zoom fullscreen —
      // you decide when to zoom (Alt-z / ⤢ button).
      if (SELF_PANE) tmuxSelf(['select-pane', '-t', SELF_PANE]);
      if (!focused) { focused = true; updatePaused(); }
    } else if (s === 'idle') {
      if (keepPlaying()) {
        // Opted out of interruption → stay in the game, show the 🔔 note.
        if (!claudeReady) { claudeReady = true; prev = null; }
      } else {
        // Default → hop back to Claude (game pauses via the focus-out event).
        claudeReady = false;
        tmuxSelf(['select-pane', '-L']);
      }
    }
    claudeMtime = m;
  }
}
// Calm prompt shown when the game pane isn't focused (you're over in Claude).
function drawFrozen() {
  const cols = out.columns || 80, rows = out.rows || 24;
  const msg = ['⏸  Paused', '', '▶  click here (or Alt-→) to play', '', 'Q to quit'];
  let s = '\x1b[2J';
  const top = Math.max(1, Math.floor((rows - msg.length) / 2));
  for (let i = 0; i < msg.length; i++) {
    const col = Math.max(1, Math.floor((cols - msg[i].length) / 2) + 1);
    s += `\x1b[${top + i};${col}H\x1b[97m${msg[i]}\x1b[0m`;
  }
  out.write(s);
}
// A one-line, non-blocking note over the top row while you're playing.
function drawClaudeNotice() {
  const cols = out.columns || 80;
  const t = ' 🔔  Claude replied — Alt-← (or click the left pane) to switch ';
  const col = Math.max(1, Math.floor((cols - t.length) / 2) + 1);
  out.write(`\x1b[1;1H\x1b[K\x1b[1;${col}H\x1b[30;43m${t}\x1b[0m`);
}

// Ask the terminal whether it supports the Kitty keyboard protocol.
function detectKitty() {
  return new Promise((resolve) => {
    try { inp.setRawMode(true); } catch (_) {}
    inp.resume();
    let acc = '';
    const onData = (d) => {
      acc += d.toString('binary');
      if (/\x1b\[\?\d+u/.test(acc)) finish(true);
    };
    const finish = (v) => { clearTimeout(timer); inp.removeListener('data', onData); resolve(v); };
    inp.on('data', onData);
    out.write('\x1b[?u'); // query current progressive-enhancement flags
    const timer = setTimeout(() => finish(false), 200);
  });
}

// Ask the terminal (through tmux, if present) whether it supports SIXEL, and for
// its character-cell pixel size so we can scale the frame to fill the pane.
// Sixel is reported as attribute "4" in the Primary Device Attributes reply
// (\x1b[?...c). Cell size comes from \x1b[16t → \x1b[6;<h>;<w>t. KABOOM_SIXEL
// forces the decision (1=on, 0=off) for debugging. Returns {supported,cellW,cellH}.
function detectSixel() {
  return new Promise((resolve) => {
    const forced = process.env.KABOOM_SIXEL;
    if (forced === '0') return resolve({ supported: false, cellW: 0, cellH: 0 });
    try { inp.setRawMode(true); } catch (_) {}
    inp.resume();
    let acc = '', cellW = 0, cellH = 0, sixel = false;
    const parse = () => {
      const cs = acc.match(/\x1b\[6;(\d+);(\d+)t/);
      if (cs) { cellH = parseInt(cs[1], 10); cellW = parseInt(cs[2], 10); }
      const da = acc.match(/\x1b\[\?([0-9;]+)c/); // Primary Device Attributes
      if (da) { sixel = da[1].split(';').includes('4'); finish(); } // DA is sent last → we're done
    };
    const finish = () => {
      clearTimeout(timer);
      inp.removeListener('data', onData);
      resolve({ supported: forced === '1' ? true : sixel, cellW, cellH });
    };
    const onData = (d) => { acc += d.toString('binary'); parse(); };
    inp.on('data', onData);
    out.write('\x1b[16t\x1b[c'); // cell-size first, then DA (whose reply ends the probe)
    const timer = setTimeout(finish, 300);
  });
}

// With Sixel the picture is fixed at ~640x480 and centered, so a wide game pane
// just adds black margins. Shrink our own pane to exactly wrap the image and
// hand the reclaimed width to Claude. Only shrinks (never steals from Claude on
// a small terminal), and only in a split (SELF_PANE), only for Sixel.
function fitGamePane() {
  if (!useSixel || !SELF_PANE) return;
  const cols = out.columns || 80, rows = out.rows || 24;
  const gameH = Math.min(480, Math.max(2, (rows - 1) * sixelCellH));
  const gameW = Math.min(640, Math.round(gameH * 4 / 3));
  const needed = Math.ceil(gameW / sixelCellW) + 2; // +2 cols so the image never clips
  if (needed < cols) {
    tmuxSelf(['resize-pane', '-t', SELF_PANE, '-x', String(needed)]);
    sixelCols = 0; // force a clear+redraw at the new width
  }
}

// ---- main -------------------------------------------------------------------
async function start() {
  if (!inp.isTTY || !out.isTTY) {
    process.stderr.write(
      'kaboom.claude: needs a real, interactive terminal.\n' +
      'Run it from a normal shell (not via Claude\'s `!`, a pipe, or a non-interactive shell).\n'
    );
    process.exit(1);
  }

  out.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H\x1b[97mLoading…\x1b[0m');

  const kitty = await detectKitty();
  // Sixel gives crisp, readable pixels. Engage it unless KABOOM_BLOCKS forces the
  // block renderer, and only if the ./sixel module loads cleanly.
  if (!process.env.KABOOM_BLOCKS) {
    const sx = await detectSixel();
    if (sx.supported) {
      try {
        ({ frameToSixel } = require('./sixel'));
        useSixel = true;
        if (sx.cellW) sixelCellW = sx.cellW;
        if (sx.cellH) sixelCellH = sx.cellH;
        fitGamePane(); // right-size our pane to the image; give the rest to Claude
      } catch (_) { useSixel = false; } // package missing/broken → keep blocks
    }
  }

  engine = new DoomEngine();
  await engine.init();

  inp.setRawMode(true);
  inp.resume();
  if (kitty) {
    out.write('\x1b[>11u'); // disambiguate + report events + all-keys-as-escape-codes
    kittyEnabled = true;
  }
  if (KID) out.write('\x1b[?1004h'); // focus in/out events (drive focus-based pause)

  inp.on('data', (b) => {
    const s = b.toString('binary');
    if (KID) {
      if (s.indexOf('\x1b[O') !== -1) {
        // focus-out: we left the game pane → freeze.
        if (focused) { focused = false; updatePaused(); }
      } else {
        // A real focus-in on the minimized sliver = you clicked it to restore.
        if (s.indexOf('\x1b[I') !== -1 && SELF_PANE && selfWidth() <= MIN_COLS + 2) {
          restoreSelf();
        }
        // focus-in, or ANY keystroke = we're active in the game pane → play.
        // (the keystroke fallback keeps it working even without focus events.)
        if (!focused) { focused = true; updatePaused(); }
      }
    }
    if (s === '\x03' || s === 'q' || s === 'Q') { quitGame(); }
    if (kittyEnabled) return handleKitty(s, engine);
    for (const key of mapKeyToDoom(s)) press(key);
  });

  const delay = Math.round(1000 / (useSixel ? SIXEL_FPS : FPS));
  let wasPaused = true;
  const loop = () => {
    if (KID) pollClaude();
    if (!paused) {
      if (wasPaused) { sixelPrevSig = -1; prev = null; wasPaused = false; } // force a full redraw on resume
      engine.tick();
      if (useSixel) { renderFrameSixel(engine); maybePanel(); }
      else { renderFrame(engine); if (claudeReady) drawClaudeNotice(); }
    } else {
      wasPaused = true;
      if (frozenDirty) { if (useSixel) drawFrozenSixel(); else drawFrozen(); frozenDirty = false; }
      maybePanel(); // keep Claude's info live even while the game is paused
    }
    setTimeout(loop, delay);
  };
  loop();
}

module.exports = { start, frameToString, renderFrame, handleKitty, cpToDoom, buildPanelLines };
