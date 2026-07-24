'use strict';

// Minimal Claude Code hook installer for the `split` pause-on-idle feature.
// Installs two hooks that flag Claude's activity into a per-session file the
// game watches: UserPromptSubmit → "busy" (Claude thinking), Stop → "idle".
// Guarded on $KABOOM_ID so they do NOTHING in any Claude session that isn't a
// kaboom split — harmless to leave installed. Marker-tagged for clean removal.

const os = require('os');
const fs = require('fs');
const path = require('path');

const HOME = os.homedir();
const KABOOM_DIR = path.join(HOME, '.claude', 'kaboom');
const SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json');
const BACKUP_FILE = path.join(HOME, '.claude', 'settings.json.kaboom-bak');
const MARKER = '# kaboom.claude';

const HOOKS = {
  UserPromptSubmit:
    `if [ -n "$KABOOM_ID" ]; then mkdir -p "$HOME/.claude/kaboom" && ` +
    `printf busy > "$HOME/.claude/kaboom/activity.$KABOOM_ID"; fi  ${MARKER}`,
  Stop:
    `if [ -n "$KABOOM_ID" ]; then mkdir -p "$HOME/.claude/kaboom" && ` +
    `printf idle > "$HOME/.claude/kaboom/activity.$KABOOM_ID"; fi  ${MARKER}`,
};

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
  try { fs.copyFileSync(SETTINGS_FILE, BACKUP_FILE); } catch (_) {}
}
function writeSettings(data) {
  try { fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); } catch (_) {}
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2) + '\n');
}
function stripMarker(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr
    .map((g) => (g && Array.isArray(g.hooks)
      ? { ...g, hooks: g.hooks.filter((h) => !(h && typeof h.command === 'string' && h.command.includes(MARKER))) }
      : g))
    .filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0));
}

// Install (idempotent — replaces any prior marked entries). Returns {ok,changed,message}.
function install() {
  const res = readSettings();
  if (!res.ok) {
    return { ok: false, changed: false, message: `Skipped pause hooks: cannot edit settings.json (${res.error.message}).` };
  }
  const data = res.data;
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) data.hooks = {};

  // Already current?
  const cur = JSON.stringify(data.hooks.UserPromptSubmit || []) + JSON.stringify(data.hooks.Stop || []);
  backupOnce(!res.missing);
  for (const [event, command] of Object.entries(HOOKS)) {
    const arr = Array.isArray(data.hooks[event]) ? stripMarker(data.hooks[event]) : [];
    arr.push({ hooks: [{ type: 'command', command }] });
    data.hooks[event] = arr;
  }
  const now = JSON.stringify(data.hooks.UserPromptSubmit) + JSON.stringify(data.hooks.Stop);
  try { writeSettings(data); } catch (err) {
    return { ok: false, changed: false, message: `Failed to write settings: ${err.message}` };
  }
  return { ok: true, changed: cur !== now, message: 'Pause-on-idle hooks ready (remove with: kaboom.claude unhook).' };
}

function uninstall() {
  const res = readSettings();
  if (!res.ok) return { ok: false, message: `Cannot edit settings.json: ${res.error.message}.` };
  if (res.missing || !res.data.hooks) return { ok: true, message: 'No kaboom hooks to remove.' };
  const data = res.data;
  let changed = false;
  for (const event of Object.keys(HOOKS)) {
    if (!Array.isArray(data.hooks[event])) continue;
    const before = JSON.stringify(data.hooks[event]);
    const cleaned = stripMarker(data.hooks[event]);
    if (JSON.stringify(cleaned) !== before) changed = true;
    if (cleaned.length === 0) delete data.hooks[event];
    else data.hooks[event] = cleaned;
  }
  if (Object.keys(data.hooks).length === 0) delete data.hooks;
  if (!changed) return { ok: true, message: 'No kaboom hooks present.' };
  backupOnce(true);
  try { writeSettings(data); } catch (err) { return { ok: false, message: `Failed to write settings: ${err.message}` }; }
  return { ok: true, message: 'Removed kaboom pause hooks from settings.json.' };
}

module.exports = { install, uninstall, KABOOM_DIR };
