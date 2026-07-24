'use strict';

// snake.claude — installer. Wires the status-line arcade into Claude Code by
// editing ~/.claude/settings.json:
//   - statusLine  → our runtime (node ~/.claude/snake/statusline.js) + refreshInterval:1
//   - hooks       → UserPromptSubmit/Stop/SubagentStart/SubagentStop write the
//                   busy/idle + timer + agent-count files the HUD reads
// and copies statusline.js to a stable path so the config never points into the
// transient npx cache.
//
// Rules (same discipline as the rest of the project):
//   - never write if settings.json is present-but-unparseable
//   - back up before the first write
//   - merge, don't clobber unrelated keys/hooks
//   - idempotent; uninstall removes only what we added (marker-based)

const os = require('os');
const fs = require('fs');
const path = require('path');

const HOME = os.homedir();
const SNAKE_DIR = path.join(HOME, '.claude', 'snake');
const DEST_STATUSLINE = path.join(SNAKE_DIR, 'statusline.js');
const PREV_STATUSLINE = path.join(SNAKE_DIR, 'prev-statusline.json');

const SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json');
const BACKUP_FILE = path.join(HOME, '.claude', 'settings.json.snake-bak');

const MARKER = '# snake.claude';

// Both runtimes live in this package's src/ and get copied to SNAKE_DIR.
const RUNTIMES = { statusline: 'statusline.js', probe: 'probe.js' };

// Is a statusLine command one of ours? (points at a script we installed)
function isOursCommand(cmd) {
  return (
    typeof cmd === 'string' &&
    (cmd.includes('snake/statusline.js') || cmd.includes('snake/probe.js'))
  );
}

// Hook commands — fast shell one-liners, each guaranteed to exit 0, each tagged
// with the marker so install is idempotent and uninstall is surgical.
const HOOKS = {
  UserPromptSubmit:
    `mkdir -p "$HOME/.claude/snake" && printf busy > "$HOME/.claude/snake/activity" ` +
    `&& date +%s > "$HOME/.claude/snake/start" && printf 0 > "$HOME/.claude/snake/agents" ; true  ${MARKER}`,
  Stop:
    `printf idle > "$HOME/.claude/snake/activity" && printf 0 > "$HOME/.claude/snake/agents" ; true  ${MARKER}`,
  SubagentStart:
    `mkdir -p "$HOME/.claude/snake" ; c=$(cat "$HOME/.claude/snake/agents" 2>/dev/null || echo 0) ; ` +
    `printf %s "$((c+1))" > "$HOME/.claude/snake/agents" ; true  ${MARKER}`,
  SubagentStop:
    `c=$(cat "$HOME/.claude/snake/agents" 2>/dev/null || echo 0) ; n=$((c-1)) ; ` +
    `[ "$n" -lt 0 ] && n=0 ; printf %s "$n" > "$HOME/.claude/snake/agents" ; true  ${MARKER}`,
};

function shellQuote(s) {
  return `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`;
}

// ---- settings.json read/write ---------------------------------------------
function readSettings() {
  let raw;
  try {
    raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, missing: true, data: {} };
    return { ok: false, error: err };
  }
  if (raw.trim() === '') return { ok: true, missing: false, data: {} };
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: new Error('settings.json is not a JSON object') };
    }
    return { ok: true, missing: false, data };
  } catch (err) {
    return { ok: false, error: err };
  }
}

function backupOnce(exists) {
  if (!exists) return;
  try {
    fs.copyFileSync(SETTINGS_FILE, BACKUP_FILE);
  } catch (_) {}
}

function writeSettings(data) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  } catch (_) {}
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2) + '\n');
}

// ---- hook helpers (marker-based, idempotent) ------------------------------
function eventHasMarker(arr) {
  return (
    Array.isArray(arr) &&
    arr.some(
      (g) =>
        g &&
        Array.isArray(g.hooks) &&
        g.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(MARKER))
    )
  );
}
function stripMarker(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr
    .map((g) => {
      if (!g || !Array.isArray(g.hooks)) return g;
      return { ...g, hooks: g.hooks.filter((h) => !(h && typeof h.command === 'string' && h.command.includes(MARKER))) };
    })
    .filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0));
}

// ---- install ---------------------------------------------------------------
// mode: 'statusline' (the game, default) or 'probe' (the diagnostic view).
function install(mode) {
  const runtime = RUNTIMES[mode] || RUNTIMES.statusline;
  const destFile = path.join(SNAKE_DIR, runtime);

  const res = readSettings();
  if (!res.ok) {
    return {
      ok: false,
      message:
        `Refusing to edit ${SETTINGS_FILE}: ${res.error.message}\n` +
        `Your settings were left untouched. Fix the JSON and re-run.`,
    };
  }
  const data = res.data;

  // Copy both runtimes to their stable home (so switching modes is instant),
  // and point the config at the chosen one.
  try {
    fs.mkdirSync(SNAKE_DIR, { recursive: true });
    for (const f of Object.values(RUNTIMES)) {
      fs.copyFileSync(path.join(__dirname, f), path.join(SNAKE_DIR, f));
    }
  } catch (err) {
    return { ok: false, message: `Could not install runtime: ${err.message}` };
  }

  backupOnce(!res.missing);

  // statusLine — stash any pre-existing one that isn't ours, then set ours.
  const existing = data.statusLine;
  const existingIsOurs = existing && isOursCommand(existing.command);
  if (existing && !existingIsOurs) {
    try {
      fs.writeFileSync(PREV_STATUSLINE, JSON.stringify(existing, null, 2));
    } catch (_) {}
  }
  data.statusLine = {
    type: 'command',
    command: `node ${shellQuote(destFile)}`,
    refreshInterval: 1,
    padding: 0,
  };

  // hooks — install our current entries. Strip any prior `# snake.claude`
  // entries first (self-heals across versions — e.g. old tmux play/pause hooks)
  // then add the fresh command. Idempotent, and preserves unrelated hooks.
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) data.hooks = {};
  for (const [event, command] of Object.entries(HOOKS)) {
    const arr = Array.isArray(data.hooks[event]) ? stripMarker(data.hooks[event]) : [];
    arr.push({ hooks: [{ type: 'command', command }] });
    data.hooks[event] = arr;
  }
  // Also strip our stale hooks from events we no longer use.
  for (const event of Object.keys(data.hooks)) {
    if (HOOKS[event]) continue;
    if (!Array.isArray(data.hooks[event])) continue;
    const cleaned = stripMarker(data.hooks[event]);
    if (cleaned.length === 0) delete data.hooks[event];
    else data.hooks[event] = cleaned;
  }

  try {
    writeSettings(data);
  } catch (err) {
    return { ok: false, message: `Failed to write settings: ${err.message}` };
  }

  // Prime the initial state so the first render looks right.
  try {
    fs.writeFileSync(path.join(SNAKE_DIR, 'activity'), 'idle');
  } catch (_) {}

  const what = mode === 'probe' ? 'diagnostic probe' : 'Pong + HUD status line';
  return {
    ok: true,
    message:
      `Installed the snake.claude ${what} into ${SETTINGS_FILE}\n` +
      `(backup: ${BACKUP_FILE}).` +
      (existing && !existingIsOurs ? `\nYour previous statusLine was saved to ${PREV_STATUSLINE}.` : ''),
  };
}

// ---- uninstall -------------------------------------------------------------
function uninstall() {
  const res = readSettings();
  if (!res.ok) {
    return { ok: false, message: `Cannot edit ${SETTINGS_FILE}: ${res.error.message}. Left untouched.` };
  }
  if (res.missing) return { ok: true, message: 'Nothing to remove.' };
  const data = res.data;
  let changed = false;

  // statusLine — remove ours; restore a stashed previous one if present.
  if (data.statusLine && isOursCommand(data.statusLine.command)) {
    let prev = null;
    try {
      prev = JSON.parse(fs.readFileSync(PREV_STATUSLINE, 'utf8'));
    } catch (_) {}
    if (prev) data.statusLine = prev;
    else delete data.statusLine;
    changed = true;
  }

  // hooks — strip our marked entries only.
  if (data.hooks && typeof data.hooks === 'object') {
    for (const event of Object.keys(HOOKS)) {
      if (!Array.isArray(data.hooks[event])) continue;
      const before = JSON.stringify(data.hooks[event]);
      const cleaned = stripMarker(data.hooks[event]);
      if (JSON.stringify(cleaned) !== before) changed = true;
      if (cleaned.length === 0) delete data.hooks[event];
      else data.hooks[event] = cleaned;
    }
    if (Object.keys(data.hooks).length === 0) delete data.hooks;
  }

  if (!changed) return { ok: true, message: 'No snake.claude config found — nothing to remove.' };

  backupOnce(true);
  try {
    writeSettings(data);
  } catch (err) {
    return { ok: false, message: `Failed to write settings: ${err.message}` };
  }

  // Remove the installed runtime + transient state (leave the backup).
  for (const f of ['statusline.js', 'probe.js', 'prev-statusline.json', 'arcade.json', 'activity', 'start', 'agents', 'highscore']) {
    try {
      fs.unlinkSync(path.join(SNAKE_DIR, f));
    } catch (_) {}
  }

  return { ok: true, message: 'Removed the snake.claude status line and hooks from settings.json.' };
}

module.exports = {
  SETTINGS_FILE,
  BACKUP_FILE,
  SNAKE_DIR,
  DEST_STATUSLINE,
  MARKER,
  HOOKS,
  install,
  uninstall,
  // for tests
  _readSettings: readSettings,
};
