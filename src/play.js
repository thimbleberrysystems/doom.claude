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

// Coupling for `split` (KABOOM_ID injected into both panes). The game plays only
// while its pane is FOCUSED and freezes when you switch away — so you control
// pause/play just by moving between panes; nothing is ever forced. Separately,
// Claude's replies show a gentle "ready" note (no interruption). Standalone play
// (no KABOOM_ID) always runs and never pauses.
const KID = process.env.KABOOM_ID || null;
const ACT = KID ? path.join(os.homedir(), '.claude', 'kaboom', `activity.${KID}`) : null;
const SELF_PANE = process.env.TMUX_PANE || ''; // this game's tmux pane
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

// ---- rendering --------------------------------------------------------------
function pixel(fb, sw, sh, sx, sy) {
  if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) return [0, 0, 0];
  const i = (sy * sw + sx) * 4; // memory order B,G,R,A
  return [fb[i + 2], fb[i + 1], fb[i]];
}

// Pure: whole-frame ANSI string (used by tests).
function frameToString(fb, sw, sh, cols, rows) {
  const thpx = rows * 2;
  const scale = Math.min(cols / sw, thpx / sh);
  const offX = Math.floor((cols - sw * scale) / 2);
  const offY = Math.floor((thpx - sh * scale) / 2);
  let buf = '\x1b[H';
  for (let cy = 0; cy < rows; cy++) {
    let lastFg = -1, lastBg = -1;
    for (let cx = 0; cx < cols; cx++) {
      const sx = Math.floor((cx - offX) / scale);
      const t = pixel(fb, sw, sh, sx, Math.floor((cy * 2 - offY) / scale));
      const b = pixel(fb, sw, sh, sx, Math.floor((cy * 2 + 1 - offY) / scale));
      const fg = (t[0] << 16) | (t[1] << 8) | t[2];
      const bg = (b[0] << 16) | (b[1] << 8) | b[2];
      if (fg !== lastFg) { buf += `\x1b[38;2;${t[0]};${t[1]};${t[2]}m`; lastFg = fg; }
      if (bg !== lastBg) { buf += `\x1b[48;2;${b[0]};${b[1]};${b[2]}m`; lastBg = bg; }
      buf += '▀';
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

  const thpx = rows * 2;
  const scale = Math.min(cols / sw, thpx / sh);
  const offX = Math.floor((cols - sw * scale) / 2);
  const offY = Math.floor((thpx - sh * scale) / 2);

  const cur = new Int32Array(cols * rows * 2);
  let buf = '';
  for (let cy = 0; cy < rows; cy++) {
    let lastFg = -1, lastBg = -1, skip = 0, cursorSet = false;
    for (let cx = 0; cx < cols; cx++) {
      const sx = Math.floor((cx - offX) / scale);
      const t = pixel(fb, sw, sh, sx, Math.floor((cy * 2 - offY) / scale));
      const b = pixel(fb, sw, sh, sx, Math.floor((cy * 2 + 1 - offY) / scale));
      const fg = (t[0] << 16) | (t[1] << 8) | t[2];
      const bg = (b[0] << 16) | (b[1] << 8) | b[2];
      const idx = (cy * cols + cx) * 2;
      cur[idx] = fg; cur[idx + 1] = bg;
      if (prev && prev[idx] === fg && prev[idx + 1] === bg) { skip++; continue; }
      if (!cursorSet) { buf += `\x1b[${cy + 1};${cx + 1}H`; cursorSet = true; skip = 0; lastFg = lastBg = -1; }
      else if (skip > 0) { buf += `\x1b[${skip}C`; skip = 0; lastFg = lastBg = -1; }
      if (fg !== lastFg) { buf += `\x1b[38;2;${t[0]};${t[1]};${t[2]}m`; lastFg = fg; }
      if (bg !== lastBg) { buf += `\x1b[48;2;${b[0]};${b[1]};${b[2]}m`; lastBg = bg; }
      buf += '▀';
    }
    if (cursorSet) buf += '\x1b[0m';
  }
  prev = cur;
  if (buf) out.write(buf);
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
    case ' ': keys = [K.USE]; break;
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
  if (s.indexOf('\x03') !== -1) { teardown(); process.exit(0); }
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
      if (cp === 113 || cp === 81) { teardown(); process.exit(0); }   // q / Q
      if (cp === 99 && ctrl) { teardown(); process.exit(0); }         // Ctrl+C
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
// Read Claude's state. When Claude STARTS working, bring the game up so you can
// play the wait. When Claude replies, only show a note — never switch you back.
function pollClaude() {
  let m = 0;
  try { m = fs.statSync(ACT).mtimeMs; } catch (_) {}
  if (m !== claudeMtime) {
    let s = '';
    try { s = fs.readFileSync(ACT, 'utf8').trim(); } catch (_) {}
    if (s === 'busy') {
      claudeReady = false;
      prev = null;
      // Focus the game pane and start playing (deterministic, not reliant on
      // focus events). This is the ONLY automatic switch — and it's toward the
      // game, never back to Claude.
      if (SELF_PANE) tmuxSelf(['select-pane', '-t', SELF_PANE]);
      if (!focused) { focused = true; updatePaused(); }
    } else if (s === 'idle') {
      if (!claudeReady) { claudeReady = true; prev = null; }
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
      } else if (!focused) {
        // focus-in, or ANY keystroke = we're active in the game pane → play.
        // (the keystroke fallback keeps it working even without focus events.)
        focused = true;
        updatePaused();
      }
    }
    if (s === '\x03' || s === 'q' || s === 'Q') { teardown(); process.exit(0); }
    if (kittyEnabled) return handleKitty(s, engine);
    for (const key of mapKeyToDoom(s)) press(key);
  });

  const delay = Math.round(1000 / FPS);
  const loop = () => {
    if (KID) pollClaude();
    if (!paused) { engine.tick(); renderFrame(engine); if (claudeReady) drawClaudeNotice(); }
    else if (frozenDirty) { drawFrozen(); frozenDirty = false; }
    setTimeout(loop, delay);
  };
  loop();
}

module.exports = { start, frameToString, renderFrame, handleKitty, cpToDoom };
