'use strict';

// Real Doom in your terminal. Drives the vendored doomgeneric-WASM engine and
// renders the 640x400 framebuffer with half-block (▀) truecolor cells — each
// cell is two vertical pixels (top = foreground, bottom = background). Keyboard
// comes from raw-mode stdin; since terminals send press-only, we emulate key
// hold with a short release timer (autorepeat keeps a held key "down").

const { DoomEngine } = require('./doom-engine');
const { mapKeyToDoom } = require('./doom-keys');

const out = process.stdout;
const inp = process.stdin;

const FPS = 35;
const HOLD_MS = 220; // how long a key stays "pressed" after its last keystroke

// ---- terminal setup / guaranteed teardown ----------------------------------
let tornDown = false;
function teardown() {
  if (tornDown) return;
  tornDown = true;
  try { if (inp.isTTY) inp.setRawMode(false); } catch (_) {}
  try { out.write('\x1b[0m\x1b[?25h\x1b[?1049l'); } catch (_) {} // reset, show cursor, leave alt-screen
  try { inp.pause(); } catch (_) {}
}
process.on('exit', teardown);
process.on('SIGINT', () => { teardown(); process.exit(0); });
process.on('SIGTERM', () => { teardown(); process.exit(0); });
process.on('uncaughtException', (err) => {
  teardown();
  process.stderr.write(`\ndoom.claude crashed: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});

// ---- rendering --------------------------------------------------------------
function pixel(fb, sw, sh, sx, sy) {
  if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) return [0, 0, 0];
  const i = (sy * sw + sx) * 4; // memory order B,G,R,A
  return [fb[i + 2], fb[i + 1], fb[i]];
}

// Pure: turn a framebuffer into the ANSI half-block frame string (testable).
function frameToString(fb, sw, sh, cols, rows) {
  // Fit sw x sh into (cols) x (rows*2) pixels, preserving aspect, letterboxed.
  const thpx = rows * 2;
  const scale = Math.min(cols / sw, thpx / sh);
  const offX = Math.floor((cols - sw * scale) / 2);
  const offY = Math.floor((thpx - sh * scale) / 2);

  let buf = '\x1b[H';
  for (let cy = 0; cy < rows; cy++) {
    let lastFg = -1;
    let lastBg = -1;
    for (let cx = 0; cx < cols; cx++) {
      const sx = Math.floor((cx - offX) / scale);
      const syT = Math.floor((cy * 2 - offY) / scale);
      const syB = Math.floor((cy * 2 + 1 - offY) / scale);
      const t = pixel(fb, sw, sh, sx, syT);
      const b = pixel(fb, sw, sh, sx, syB);
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

function renderFrame(engine) {
  const fb = engine.frame();
  if (!fb) return;
  out.write(frameToString(fb, engine.width, engine.height, out.columns || 80, out.rows || 24));
}

// ---- input ------------------------------------------------------------------
const holdTimers = new Map();
function press(engine, key) {
  engine.pushKey(true, key);
  const existing = holdTimers.get(key);
  if (existing) clearTimeout(existing);
  holdTimers.set(key, setTimeout(() => {
    engine.pushKey(false, key);
    holdTimers.delete(key);
  }, HOLD_MS));
}

// ---- main -------------------------------------------------------------------
async function start() {
  if (!inp.isTTY || !out.isTTY) {
    process.stderr.write(
      'doom.claude: needs a real, interactive terminal.\n' +
      'Run it from a normal shell (not via Claude\'s `!`, a pipe, or a non-interactive shell).\n'
    );
    process.exit(1);
  }

  out.write('\x1b[?1049h\x1b[?25l\x1b[2J'); // alt-screen, hide cursor, clear
  out.write('\x1b[H\x1b[97mLoading DOOM…\x1b[0m');

  const engine = new DoomEngine();
  await engine.init();

  inp.setRawMode(true);
  inp.resume();
  inp.on('data', (b) => {
    const s = b.toString('binary');
    if (s === '\x03' || s === 'q' || s === 'Q') { teardown(); process.exit(0); }
    for (const key of mapKeyToDoom(s)) press(engine, key);
  });

  const delay = Math.round(1000 / FPS);
  const loop = () => {
    engine.tick();
    renderFrame(engine);
    setTimeout(loop, delay);
  };
  loop();
}

module.exports = { start, frameToString };
