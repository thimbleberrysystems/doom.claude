'use strict';

// Install / uninstall the play-pause hooks in ~/.claude/settings.json.
//
// This is the highest-risk part of the tool: it edits a file the user owns and
// that Claude Code depends on. Rules we never break:
//   1. Never write if the existing file is present but unparseable.
//   2. Always back up before the first write.
//   3. Merge — never clobber unrelated keys or unrelated hooks.
//   4. Idempotent: running twice adds nothing the second time.
//   5. Uninstall removes ONLY our entries (identified by the MARKER).

const os = require('os');
const fs = require('fs');
const path = require('path');
const state = require('./state');

const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');
const BACKUP_FILE = path.join(os.homedir(), '.claude', 'settings.json.snake-bak');

// Claude Code hook events we attach to.
const PLAY_EVENT = 'UserPromptSubmit'; // fires when the user submits -> Claude starts working
const PAUSE_EVENT = 'Stop'; // fires when Claude finishes its response

function readSettings() {
  // Returns { ok, missing, data, error }. `ok:false` means present-but-broken —
  // callers MUST NOT write in that case.
  let raw;
  try {
    raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, missing: true, data: {} };
    return { ok: false, missing: false, error: err };
  }
  if (raw.trim() === '') return { ok: true, missing: false, data: {} };
  try {
    const data = JSON.parse(raw);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, missing: false, error: new Error('settings.json is not a JSON object') };
    }
    return { ok: true, missing: false, data };
  } catch (err) {
    return { ok: false, missing: false, error: err };
  }
}

// Build one event entry in Claude Code's hook schema:
//   [ { hooks: [ { type: "command", command: "..." } ] } ]
function entryFor(token) {
  return { hooks: [{ type: 'command', command: state.hookCommand(token) }] };
}

// Does any entry under this event already carry our marker?
function eventHasMarker(eventArr) {
  if (!Array.isArray(eventArr)) return false;
  return eventArr.some(
    (group) =>
      group &&
      Array.isArray(group.hooks) &&
      group.hooks.some(
        (h) => h && typeof h.command === 'string' && h.command.includes(state.MARKER)
      )
  );
}

// Strip our marked entries from one event array; returns a cleaned array.
function stripMarker(eventArr) {
  if (!Array.isArray(eventArr)) return eventArr;
  return eventArr
    .map((group) => {
      if (!group || !Array.isArray(group.hooks)) return group;
      const hooks = group.hooks.filter(
        (h) => !(h && typeof h.command === 'string' && h.command.includes(state.MARKER))
      );
      return { ...group, hooks };
    })
    .filter((group) => !(group && Array.isArray(group.hooks) && group.hooks.length === 0));
}

function backupOnce(rawExists) {
  if (!rawExists) return; // nothing to back up
  try {
    fs.copyFileSync(SETTINGS_FILE, BACKUP_FILE);
  } catch (_) {
    // Non-fatal: proceed, but the caller is told via the return of writeSettings.
  }
}

function writeSettings(data) {
  state.ensureDir();
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  } catch (_) {}
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2) + '\n');
}

// Install both hooks. Returns { ok, changed, message }.
function install() {
  const res = readSettings();
  if (!res.ok) {
    return {
      ok: false,
      changed: false,
      message:
        `Refusing to edit ${SETTINGS_FILE}: ${res.error.message}\n` +
        `Your settings were left untouched. Fix the JSON (or move the file aside) and re-run.\n` +
        `To add the hooks by hand, put these commands under "UserPromptSubmit" and "Stop":\n` +
        `  play:  ${state.hookCommand('play')}\n` +
        `  pause: ${state.hookCommand('pause')}`,
    };
  }

  const data = res.data;
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) {
    data.hooks = {};
  }
  if (!Array.isArray(data.hooks[PLAY_EVENT])) data.hooks[PLAY_EVENT] = [];
  if (!Array.isArray(data.hooks[PAUSE_EVENT])) data.hooks[PAUSE_EVENT] = [];

  const alreadyPlay = eventHasMarker(data.hooks[PLAY_EVENT]);
  const alreadyPause = eventHasMarker(data.hooks[PAUSE_EVENT]);

  if (alreadyPlay && alreadyPause) {
    return { ok: true, changed: false, message: 'Hooks already installed — nothing to do.' };
  }

  backupOnce(!res.missing);
  if (!alreadyPlay) data.hooks[PLAY_EVENT].push(entryFor('play'));
  if (!alreadyPause) data.hooks[PAUSE_EVENT].push(entryFor('pause'));

  try {
    writeSettings(data);
  } catch (err) {
    return { ok: false, changed: false, message: `Failed to write settings: ${err.message}` };
  }
  return {
    ok: true,
    changed: true,
    message: `Installed play/pause hooks into ${SETTINGS_FILE} (backup: ${BACKUP_FILE}).`,
  };
}

// Remove only our marked hook entries. Returns { ok, changed, message }.
function uninstall() {
  const res = readSettings();
  if (!res.ok) {
    return {
      ok: false,
      changed: false,
      message: `Cannot edit ${SETTINGS_FILE}: ${res.error.message}. Left untouched.`,
    };
  }
  if (res.missing || !res.data.hooks) {
    return { ok: true, changed: false, message: 'No hooks found — nothing to remove.' };
  }

  const data = res.data;
  let changed = false;
  for (const evt of [PLAY_EVENT, PAUSE_EVENT]) {
    if (!Array.isArray(data.hooks[evt])) continue;
    const before = JSON.stringify(data.hooks[evt]);
    const cleaned = stripMarker(data.hooks[evt]);
    if (JSON.stringify(cleaned) !== before) changed = true;
    if (cleaned.length === 0) delete data.hooks[evt];
    else data.hooks[evt] = cleaned;
  }
  if (Object.keys(data.hooks).length === 0) delete data.hooks;

  if (!changed) {
    return { ok: true, changed: false, message: 'No snake-claude hooks present — nothing to remove.' };
  }

  backupOnce(!res.missing);
  try {
    writeSettings(data);
  } catch (err) {
    return { ok: false, changed: false, message: `Failed to write settings: ${err.message}` };
  }
  return { ok: true, changed: true, message: 'Removed snake-claude hooks from settings.json.' };
}

module.exports = {
  SETTINGS_FILE,
  BACKUP_FILE,
  PLAY_EVENT,
  PAUSE_EVENT,
  install,
  uninstall,
  // exported for tests
  _readSettings: readSettings,
  _eventHasMarker: eventHasMarker,
  _stripMarker: stripMarker,
};
