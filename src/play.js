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

// Coupling to Claude's activity — active only under `split`, where KABOOM_ID is
// injected into both panes. The game plays while Claude is thinking ("busy")
// and pauses when it replies ("idle"). Standalone play (no KABOOM_ID) never pauses.
const KID = process.env.KABOOM_ID || null;
const ACT = KID ? path.join(os.homedir(), '.claude', 'kaboom', `activity.${KID}`) : null;
let paused = !!KID;        // coupled → start paused (Claude is idle at launch)
let bannerDirty = !!KID;
let actMtime = -1;
let actState = 'idle';

// ---- terminal setup / guaranteed teardown ----------------------------------
let tornDown = false;
function teardown() {
  if (tornDown) return;
  tornDown = true;
  try { if (kittyEnabled) out.write('\x1b[<u'); } catch (_) {} // pop Kitty flags
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

// ---- pause coupling --------------------------------------------------------
function pollActivity() {
  let m = 0;
  try { m = fs.statSync(ACT).mtimeMs; } catch (_) {}
  if (m !== actMtime) {
    try { const s = fs.readFileSync(ACT, 'utf8').trim(); if (s === 'busy' || s === 'idle') actState = s; } catch (_) {}
    actMtime = m;
  }
  const shouldPause = actState !== 'busy';
  if (shouldPause !== paused) {
    paused = shouldPause;
    if (paused) bannerDirty = true;
    else prev = null; // resumed → force a full redraw
  }
}
function drawPausedBanner() {
  const cols = out.columns || 80, rows = out.rows || 24;
  const msg = ['⏸  PAUSED', '', 'Claude is ready — read the reply,', 'then send your next prompt.', '', 'kaboom plays while Claude is thinking.', '', 'Q to quit'];
  let s = '\x1b[2J';
  const top = Math.max(1, Math.floor((rows - msg.length) / 2));
  for (let i = 0; i < msg.length; i++) {
    const col = Math.max(1, Math.floor((cols - msg[i].length) / 2) + 1);
    s += `\x1b[${top + i};${col}H\x1b[97m${msg[i]}\x1b[0m`;
  }
  out.write(s);
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

  inp.on('data', (b) => {
    const s = b.toString('binary');
    if (kittyEnabled) return handleKitty(s, engine);
    if (s === '\x03' || s === 'q' || s === 'Q') { teardown(); process.exit(0); }
    for (const key of mapKeyToDoom(s)) press(key);
  });

  const delay = Math.round(1000 / FPS);
  const loop = () => {
    if (KID) pollActivity();
    if (!paused) { engine.tick(); renderFrame(engine); }
    else if (bannerDirty) { drawPausedBanner(); bannerDirty = false; }
    setTimeout(loop, delay);
  };
  loop();
}

module.exports = { start, frameToString, renderFrame, handleKitty, cpToDoom };
