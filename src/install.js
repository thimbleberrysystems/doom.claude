'use strict';

// doom.claude — installer. Wires the DOOM status-line HUD into Claude Code by
// editing ~/.claude/settings.json:
//   - statusLine  → our runtime (node ~/.claude/doom/statusline.js) + refreshInterval:1
//   - hooks       → UserPromptSubmit/Stop/SubagentStart/SubagentStop feed the HUD
//                   (busy/idle, turn start+end times, agent count)
// and copies the runtime to a stable path so the config never points into the
// transient npx cache.
//
// Rules: never write if settings.json is unparseable; back up before writing;
// merge (don't clobber); idempotent (replaces our own prior entries); uninstall
// removes only what we added (marker-based).

const os = require('os');
const fs = require('fs');
const path = require('path');

const HOME = os.homedir();
const DOOM_DIR = path.join(HOME, '.claude', 'doom');
const PREV_STATUSLINE = path.join(DOOM_DIR, 'prev-statusline.json');

const SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json');
const BACKUP_FILE = path.join(HOME, '.claude', 'settings.json.doom-bak');

const MARKER = '# doom.claude';

// Runtimes shipped in this package's src/, copied to DOOM_DIR at install.
const RUNTIMES = { statusline: 'statusline.js', probe: 'probe.js' };

function isOursCommand(cmd) {
  return (
    typeof cmd === 'string' &&
    (cmd.includes('doom/statusline.js') || cmd.includes('doom/probe.js'))
  );
}

function shellQuote(s) {
  return `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`;
}

// Hook commands — fast shell one-liners, guaranteed to exit 0, marker-tagged.
// State is keyed by session_id (parsed from the hook's own stdin JSON) so
// concurrent Claude sessions never clobber each other.
const SID = `sid=$(sed -n 's/.*"session_id":"\\([^"]*\\)".*/\\1/p'); [ -z "$sid" ] && sid=default`;
const HOOKS = {
  UserPromptSubmit:
    `d="$HOME/.claude/doom"; mkdir -p "$d"; ${SID}; ` +
    `printf busy > "$d/activity.$sid"; date +%s > "$d/start.$sid"; printf 0 > "$d/agents.$sid"; true  ${MARKER}`,
  Stop:
    `d="$HOME/.claude/doom"; mkdir -p "$d"; ${SID}; ` +
    `printf idle > "$d/activity.$sid"; date +%s > "$d/end.$sid"; printf 0 > "$d/agents.$sid"; true  ${MARKER}`,
  SubagentStart:
    `d="$HOME/.claude/doom"; mkdir -p "$d"; ${SID}; ` +
    `c=$(cat "$d/agents.$sid" 2>/dev/null || echo 0); printf %s "$((c+1))" > "$d/agents.$sid"; true  ${MARKER}`,
  SubagentStop:
    `d="$HOME/.claude/doom"; ${SID}; ` +
    `c=$(cat "$d/agents.$sid" 2>/dev/null || echo 0); n=$((c-1)); [ "$n" -lt 0 ] && n=0; printf %s "$n" > "$d/agents.$sid"; true  ${MARKER}`,
};

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

// ---- hook helpers (marker-based) ------------------------------------------
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
function install(mode) {
  const runtime = RUNTIMES[mode] || RUNTIMES.statusline;
  const destFile = path.join(DOOM_DIR, runtime);

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

  try {
    fs.mkdirSync(DOOM_DIR, { recursive: true });
    for (const f of Object.values(RUNTIMES)) {
      fs.copyFileSync(path.join(__dirname, f), path.join(DOOM_DIR, f));
    }
  } catch (err) {
    return { ok: false, message: `Could not install runtime: ${err.message}` };
  }

  backupOnce(!res.missing);

  const existing = data.statusLine;
  const existingIsOurs = existing && isOursCommand(existing.command);
  if (existing && !existingIsOurs) {
    try {
      fs.writeFileSync(PREV_STATUSLINE, JSON.stringify(existing, null, 2));
    } catch (_) {}
  }
  data.statusLine = { type: 'command', command: `node ${shellQuote(destFile)}`, refreshInterval: 1, padding: 0 };

  // hooks — replace any prior marked entries (self-heals across versions), keep others.
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) data.hooks = {};
  for (const [event, command] of Object.entries(HOOKS)) {
    const arr = Array.isArray(data.hooks[event]) ? stripMarker(data.hooks[event]) : [];
    arr.push({ hooks: [{ type: 'command', command }] });
    data.hooks[event] = arr;
  }
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

  const what = mode === 'probe' ? 'diagnostic probe' : 'DOOM HUD status line';
  return {
    ok: true,
    message:
      `Installed the doom.claude ${what} into ${SETTINGS_FILE}\n` +
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

  if (data.statusLine && isOursCommand(data.statusLine.command)) {
    let prev = null;
    try {
      prev = JSON.parse(fs.readFileSync(PREV_STATUSLINE, 'utf8'));
    } catch (_) {}
    if (prev) data.statusLine = prev;
    else delete data.statusLine;
    changed = true;
  }

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

  if (!changed) return { ok: true, message: 'No doom.claude config found — nothing to remove.' };

  backupOnce(true);
  try {
    writeSettings(data);
  } catch (err) {
    return { ok: false, message: `Failed to write settings: ${err.message}` };
  }

  try {
    fs.rmSync(DOOM_DIR, { recursive: true, force: true });
  } catch (_) {}

  return { ok: true, message: 'Removed the doom.claude status line and hooks from settings.json.' };
}

module.exports = {
  SETTINGS_FILE,
  BACKUP_FILE,
  DOOM_DIR,
  MARKER,
  HOOKS,
  install,
  uninstall,
  _readSettings: readSettings,
};
