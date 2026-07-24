'use strict';

// The play/pause signal that couples a game to ONE Claude session.
//
// Design: each launch gets a unique id (SNAKE_CLAUDE_ID). The signal lives in a
// per-session file ~/.claude/snake/<id>.state holding a single token, "play" or
// "pause". Claude Code hooks — which inherit SNAKE_CLAUDE_ID from the claude
// process they run under — overwrite it; the matching game polls it each tick.
// Per-session files mean multiple concurrent Claude sessions never collide.

const os = require('os');
const fs = require('fs');
const path = require('path');

const PLAY = 'play';
const PAUSE = 'pause';

// ~/.claude/snake/ — colocated with Claude Code's own config so it is easy to
// find and clean up. We intentionally do NOT depend on $CLAUDE_* env vars.
const DIR = path.join(os.homedir(), '.claude', 'snake');
const HIGHSCORE_FILE = path.join(DIR, 'highscore'); // one high score across all sessions

function stateFile(id) {
  return path.join(DIR, `${id}.state`);
}

// The exact shell command used by the install hooks. Kept here so the launcher,
// the installer, and any docs all agree on one source of truth.
//   - Guarded on $SNAKE_CLAUDE_ID so a plain Claude session (no snake attached)
//     does nothing and exits 0 — the hooks are global but harmless elsewhere.
//   - The trailing "# snake.claude" marker makes install idempotent and
//     uninstall exact.
const MARKER = '# snake.claude';
function hookCommand(token) {
  // Runs as a child of the `claude` process. When Claude is inside tmux, both
  // the hook and the snake pane share the same tmux WINDOW, so we key the state
  // file by window id ("@N") — no env injection into Claude required, and two
  // Claude+Snake windows never collide. Outside tmux there is no snake attached,
  // so the hook does nothing. Always exits 0. Portable bash/zsh (Linux/macOS/WSL).
  return (
    `if [ -n "$TMUX" ]; then ` +
    `__scw=$(tmux display-message -p -t "$TMUX_PANE" '#{window_id}' 2>/dev/null); ` +
    `if [ -n "$__scw" ]; then mkdir -p "$HOME/.claude/snake" && ` +
    `printf ${token} > "$HOME/.claude/snake/$__scw.state"; fi; fi  ${MARKER}`
  );
}

function ensureDir() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch (_) {}
}

// Read the current signal for a session. Never throws: a missing / empty /
// garbage / mid-write file yields null, and callers hold their last state.
function read(id) {
  let raw;
  try {
    raw = fs.readFileSync(stateFile(id), 'utf8');
  } catch (_) {
    return null;
  }
  const token = String(raw).trim().toLowerCase();
  if (token === PLAY) return PLAY;
  if (token === PAUSE) return PAUSE;
  return null;
}

// Atomic write via temp-file + rename so a poller never sees a half-written file.
function write(id, token) {
  if (token !== PLAY && token !== PAUSE) return false;
  ensureDir();
  const target = stateFile(id);
  const tmp = `${target}.tmp`;
  try {
    fs.writeFileSync(tmp, token);
    fs.renameSync(tmp, target);
    return true;
  } catch (_) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

// Remove a session's state file (called on game exit to avoid leftovers).
function remove(id) {
  try { fs.unlinkSync(stateFile(id)); } catch (_) {}
  try { fs.unlinkSync(`${stateFile(id)}.tmp`); } catch (_) {}
}

// mtime helper so the game only re-reads the file when it actually changes.
function stateMtimeMs(id) {
  try {
    return fs.statSync(stateFile(id)).mtimeMs;
  } catch (_) {
    return 0;
  }
}

// Sweep away state files left behind by sessions that crashed without cleanup.
// Conservative: only touches *.state / *.state.tmp older than 24h.
function pruneStale(maxAgeMs = 24 * 60 * 60 * 1000) {
  let now;
  try {
    now = Date.now();
  } catch (_) {
    return; // Date.now unavailable in some sandboxes; skip pruning
  }
  let entries;
  try {
    entries = fs.readdirSync(DIR);
  } catch (_) {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith('.state') && !name.endsWith('.state.tmp')) continue;
    const p = path.join(DIR, name);
    try {
      if (now - fs.statSync(p).mtimeMs > maxAgeMs) fs.unlinkSync(p);
    } catch (_) {}
  }
}

function readHighScore() {
  try {
    const n = parseInt(fs.readFileSync(HIGHSCORE_FILE, 'utf8'), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (_) {
    return 0;
  }
}

function writeHighScore(score) {
  if (!Number.isFinite(score)) return;
  ensureDir();
  try {
    fs.writeFileSync(HIGHSCORE_FILE, String(Math.max(0, Math.floor(score))));
  } catch (_) {}
}

module.exports = {
  PLAY,
  PAUSE,
  DIR,
  HIGHSCORE_FILE,
  MARKER,
  stateFile,
  hookCommand,
  ensureDir,
  read,
  write,
  remove,
  stateMtimeMs,
  pruneStale,
  readHighScore,
  writeHighScore,
};
