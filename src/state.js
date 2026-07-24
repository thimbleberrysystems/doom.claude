'use strict';

// The play/pause signal that couples the game to Claude's activity.
//
// Design: one tiny file holding a single token, "play" or "pause". Claude Code
// hooks overwrite it (UserPromptSubmit -> play, Stop -> pause); the game polls
// it every tick. This deliberately avoids signals/FIFOs so nothing can wedge —
// the worst case is reading a stale value for a single frame.

const os = require('os');
const fs = require('fs');
const path = require('path');

const PLAY = 'play';
const PAUSE = 'pause';

// ~/.claude/snake/ — colocated with Claude Code's own config so it is easy to
// find and clean up. We intentionally do NOT depend on $CLAUDE_* env vars.
const DIR = path.join(os.homedir(), '.claude', 'snake');
const STATE_FILE = path.join(DIR, 'state');
const HIGHSCORE_FILE = path.join(DIR, 'highscore');

// The exact shell command used by the install hooks. Kept here so the launcher,
// the installer, and any docs all agree on one source of truth. The trailing
// "# snake-claude" marker is what makes install idempotent and uninstall exact.
const MARKER = '# snake-claude';
function hookCommand(token) {
  // Portable across bash/zsh on Linux/macOS/WSL. mkdir -p is a no-op if present.
  return `mkdir -p "$HOME/.claude/snake" && printf ${token} > "$HOME/.claude/snake/state"  ${MARKER}`;
}

function ensureDir() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch (_) {
    // If we cannot create it, read()/write() degrade gracefully below.
  }
}

// Read the current signal. Never throws: a missing / empty / garbage / mid-write
// file yields null, and callers hold their last known state instead.
function read() {
  let raw;
  try {
    raw = fs.readFileSync(STATE_FILE, 'utf8');
  } catch (_) {
    return null;
  }
  const token = String(raw).trim().toLowerCase();
  if (token === PLAY) return PLAY;
  if (token === PAUSE) return PAUSE;
  return null;
}

// Atomic write via temp-file + rename so a poller never sees a half-written file.
function write(token) {
  if (token !== PLAY && token !== PAUSE) return false;
  ensureDir();
  const tmp = `${STATE_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, token);
    fs.renameSync(tmp, STATE_FILE);
    return true;
  } catch (_) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    return false;
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

// mtime helper so the game only re-reads the file when it actually changes.
function stateMtimeMs() {
  try {
    return fs.statSync(STATE_FILE).mtimeMs;
  } catch (_) {
    return 0;
  }
}

module.exports = {
  PLAY,
  PAUSE,
  DIR,
  STATE_FILE,
  HIGHSCORE_FILE,
  MARKER,
  hookCommand,
  ensureDir,
  read,
  write,
  readHighScore,
  writeHighScore,
  stateMtimeMs,
};
