'use strict';

// Snake — a zero-dependency terminal game that couples to Claude's activity.
//
// It polls ~/.claude/snake/state each tick: "play" while Claude is working,
// "pause" (freeze in place, keep the score) while Claude waits on you. Nothing
// here requires an npm install — just raw ANSI escapes and Node's TTY.

const state = require('./state');

// ---- ANSI helpers ---------------------------------------------------------
const ESC = '\x1b[';
const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
const CLEAR = '\x1b[2J\x1b[H';
const RESET = '\x1b[0m';

const C = {
  reset: RESET,
  dim: `${ESC}2m`,
  bold: `${ESC}1m`,
  green: `${ESC}32m`,
  brightGreen: `${ESC}92m`,
  red: `${ESC}91m`,
  yellow: `${ESC}93m`,
  cyan: `${ESC}96m`,
  gray: `${ESC}90m`,
};

function at(row, col) {
  return `${ESC}${row};${col}H`;
}

// ---- terminal setup / guaranteed teardown ---------------------------------
const out = process.stdout;
const inp = process.stdin;
let tornDown = false;

function teardown() {
  if (tornDown) return;
  tornDown = true;
  try {
    if (inp.isTTY) inp.setRawMode(false);
  } catch (_) {}
  try {
    out.write(CURSOR_SHOW + RESET + ALT_OFF);
  } catch (_) {}
  try {
    inp.pause();
  } catch (_) {}
}

// Restore the terminal on EVERY exit path — clean quit, Ctrl-C, kill, or crash.
process.on('exit', teardown);
process.on('SIGINT', () => { teardown(); process.exit(0); });
process.on('SIGTERM', () => { teardown(); process.exit(0); });
process.on('uncaughtException', (err) => {
  teardown();
  // Surface the error after the terminal is usable again.
  process.stderr.write(`\nsnake-claude crashed: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});

// ---- game model -----------------------------------------------------------
const MIN_COLS = 20;
const MIN_ROWS = 12;
const BASE_TICK = 130; // ms per step at score 0
const MIN_TICK = 60; // fastest step interval

const game = {
  cols: 0,
  rows: 0, // playfield interior size (cells), excludes border
  snake: [], // array of {x,y}, head last
  dir: { x: 1, y: 0 },
  nextDir: { x: 1, y: 0 },
  food: { x: 0, y: 0 },
  score: 0,
  high: state.readHighScore(),
  over: false,
  signal: state.PAUSE, // start paused: Claude isn't working at launch
  lastMtime: -1,
  tooSmall: false,
};

function fitBoard() {
  const cols = out.columns || 0;
  const rows = out.rows || 0;
  game.tooSmall = cols < MIN_COLS || rows < MIN_ROWS;
  if (game.tooSmall) return;
  // Reserve 1-cell border on each side and 2 rows for the HUD.
  game.cols = Math.max(8, cols - 2);
  game.rows = Math.max(6, rows - 4);
  // Keep the snake and food inside the (possibly resized) field.
  for (const seg of game.snake) {
    seg.x = Math.min(seg.x, game.cols - 1);
    seg.y = Math.min(seg.y, game.rows - 1);
  }
  if (game.food.x >= game.cols || game.food.y >= game.rows) placeFood();
}

function resetGame() {
  fitBoard();
  if (game.tooSmall) return;
  const cx = Math.floor(game.cols / 2);
  const cy = Math.floor(game.rows / 2);
  game.snake = [
    { x: cx - 1, y: cy },
    { x: cx, y: cy },
    { x: cx + 1, y: cy },
  ];
  game.dir = { x: 1, y: 0 };
  game.nextDir = { x: 1, y: 0 };
  game.score = 0;
  game.over = false;
  placeFood();
}

function placeFood() {
  if (game.cols <= 0 || game.rows <= 0) return;
  const occupied = new Set(game.snake.map((s) => `${s.x},${s.y}`));
  // Try random spots; fall back to first free cell if the board is nearly full.
  for (let i = 0; i < 200; i++) {
    const x = Math.floor(Math.random() * game.cols);
    const y = Math.floor(Math.random() * game.rows);
    if (!occupied.has(`${x},${y}`)) {
      game.food = { x, y };
      return;
    }
  }
  for (let y = 0; y < game.rows; y++) {
    for (let x = 0; x < game.cols; x++) {
      if (!occupied.has(`${x},${y}`)) {
        game.food = { x, y };
        return;
      }
    }
  }
}

function tickInterval() {
  // Speed up as the score climbs, but never below MIN_TICK.
  return Math.max(MIN_TICK, BASE_TICK - game.score * 4);
}

// ---- input ----------------------------------------------------------------
function setDir(x, y) {
  // Reject 180° reversals relative to the direction we are actually moving.
  if (x === -game.dir.x && y === -game.dir.y) return;
  game.nextDir = { x, y };
}

function onKey(buf) {
  const s = buf.toString();
  // Arrow keys arrive as escape sequences.
  if (s === '\x1b[A' || s === 'w' || s === 'W') return setDir(0, -1);
  if (s === '\x1b[B' || s === 's' || s === 'S') return setDir(0, 1);
  if (s === '\x1b[C' || s === 'd' || s === 'D') return setDir(1, 0);
  if (s === '\x1b[D' || s === 'a' || s === 'A') return setDir(-1, 0);

  if (s === 'q' || s === 'Q' || s === '\x03') { // q or Ctrl-C
    teardown();
    process.exit(0);
  }
  if ((s === 'r' || s === 'R') && game.over) {
    resetGame();
  }
}

// ---- update ---------------------------------------------------------------
function pollSignal() {
  const mtime = state.stateMtimeMs();
  if (mtime !== game.lastMtime) {
    const sig = state.read();
    if (sig) game.signal = sig; // ignore null (missing/garbage): hold last state
    game.lastMtime = mtime;
  }
}

function step() {
  if (game.over || game.tooSmall) return;

  game.dir = game.nextDir;
  const head = game.snake[game.snake.length - 1];
  const nx = head.x + game.dir.x;
  const ny = head.y + game.dir.y;

  // Wall collision.
  if (nx < 0 || ny < 0 || nx >= game.cols || ny >= game.rows) {
    return gameOver();
  }
  // Self collision (the tail cell is about to move away unless we just ate).
  const willEat = nx === game.food.x && ny === game.food.y;
  const body = willEat ? game.snake : game.snake.slice(1);
  if (body.some((seg) => seg.x === nx && seg.y === ny)) {
    return gameOver();
  }

  game.snake.push({ x: nx, y: ny });
  if (willEat) {
    game.score += 1;
    if (game.score > game.high) {
      game.high = game.score;
      state.writeHighScore(game.high);
    }
    placeFood();
  } else {
    game.snake.shift();
  }
}

function gameOver() {
  game.over = true;
}

// ---- render ---------------------------------------------------------------
function render() {
  if (game.tooSmall) {
    return renderTooSmall();
  }

  const width = game.cols + 2;
  const lines = [];

  // Title / HUD row.
  const title = `${C.brightGreen}${C.bold} SNAKE ${C.reset}${C.gray}·claude${C.reset}`;
  lines.push(title);

  // Top border.
  lines.push(`${C.gray}┌${'─'.repeat(game.cols)}┐${C.reset}`);

  // Build the field as a grid of single chars.
  const grid = [];
  for (let y = 0; y < game.rows; y++) {
    grid.push(new Array(game.cols).fill(' '));
  }
  // Food.
  grid[game.food.y][game.food.x] = 'F';
  // Snake body + head.
  for (let i = 0; i < game.snake.length; i++) {
    const seg = game.snake[i];
    grid[seg.y][seg.x] = i === game.snake.length - 1 ? 'H' : 'B';
  }

  for (let y = 0; y < game.rows; y++) {
    let row = `${C.gray}│${C.reset}`;
    for (let x = 0; x < game.cols; x++) {
      const cell = grid[y][x];
      if (cell === 'F') row += `${C.red}●${C.reset}`;
      else if (cell === 'H') row += `${C.brightGreen}${C.bold}◆${C.reset}`;
      else if (cell === 'B') row += `${C.green}■${C.reset}`;
      else row += ' ';
    }
    row += `${C.gray}│${C.reset}`;
    lines.push(row);
  }

  // Bottom border.
  lines.push(`${C.gray}└${'─'.repeat(game.cols)}┘${C.reset}`);

  // Score line.
  lines.push(
    `${C.cyan}score ${C.bold}${game.score}${C.reset}   ${C.gray}best ${game.high}${C.reset}`
  );

  let frame = CLEAR;
  for (let i = 0; i < lines.length; i++) {
    frame += at(i + 1, 1) + lines[i];
  }

  // Overlays sit on top of the field, centered.
  if (game.over) {
    frame += overlay(['GAME OVER', `score ${game.score}`, 'press r to restart', 'q to quit'], C.red);
  } else if (game.signal === state.PAUSE) {
    frame += overlay(['⏸ PAUSED', 'Claude is done —', 'your move.', '', 'plays while Claude thinks'], C.yellow);
  }

  out.write(frame);
}

function overlay(msgLines, color) {
  const boxRow = Math.max(1, Math.floor((game.rows - msgLines.length) / 2) + 2);
  let s = '';
  for (let i = 0; i < msgLines.length; i++) {
    const text = msgLines[i];
    const col = Math.max(2, Math.floor((game.cols - text.length) / 2) + 2);
    s += at(boxRow + i, col) + `${color}${C.bold}${text}${C.reset}`;
  }
  return s;
}

function renderTooSmall() {
  out.write(
    CLEAR +
      at(2, 1) +
      `${C.yellow}Pane too small.${C.reset}` +
      at(3, 1) +
      `${C.gray}Grow it to at least${C.reset}` +
      at(4, 1) +
      `${C.gray}${MIN_COLS}x${MIN_ROWS}.${C.reset}`
  );
}

// ---- main loop ------------------------------------------------------------
let loopTimer = null;

function loop() {
  pollSignal();
  if (!game.over && !game.tooSmall && game.signal === state.PLAY) {
    step();
  }
  render();
  // Reschedule with the current speed (interval shrinks as score grows).
  loopTimer = setTimeout(loop, tickInterval());
}

function start() {
  if (!inp.isTTY || !out.isTTY) {
    process.stderr.write('snake-claude: needs an interactive terminal (run it in a tmux pane).\n');
    process.exit(1);
  }

  out.write(ALT_ON + CURSOR_HIDE + CLEAR);
  inp.setRawMode(true);
  inp.resume();
  inp.on('data', onKey);

  // Re-fit on terminal / pane resize.
  out.on('resize', () => {
    fitBoard();
    render();
  });

  resetGame();
  loop();
}

start();
