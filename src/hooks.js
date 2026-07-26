'use strict';

// Claude Code hook + status-line installer for the `split` info panel.
//
// Writes small per-session files (keyed by $KABOOM_ID) that the game pane reads
// to show Claude's state + telemetry:
//   activity.<id>  busy|idle           (UserPromptSubmit / Stop)
//   start.<id>     turn start epoch     (UserPromptSubmit)  end.<id> (Stop)
//   turns.<id>     turn counter         (UserPromptSubmit)
//   agents.<id>    running subagents    (SubagentStart / SubagentStop)
//   tool.<id>      current tool name    (PreToolUse / cleared PostToolUse)
//   bell.<id>      notification type    (Notification / cleared UserPromptSubmit)
//   info.<id>.json model/tokens/ctx/... (statusLine wrapper, see kaboom-statusline.js)
//
// Every hook is guarded on $KABOOM_ID so it does NOTHING outside a kaboom split.
// The statusLine is installed non-destructively: the user's original is saved and
// passed through, and restored on `unhook`. Marker-tagged for clean removal.

const os = require('os');
const fs = require('fs');
const path = require('path');

const HOME = os.homedir();
const KABOOM_DIR = path.join(HOME, '.claude', 'kaboom');
const SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json');
const BACKUP_FILE = path.join(HOME, '.claude', 'settings.json.kaboom-bak');
const ORIG_SL = path.join(KABOOM_DIR, 'orig-statusline.json');
const SL_SCRIPT = path.join(__dirname, 'kaboom-statusline.js');
// Copied to a STABLE path so the statusLine command keeps working after the npx
// cache (where this package may live) is cleared. The wrapper is dependency-free.
const SL_STABLE = path.join(KABOOM_DIR, 'kaboom-statusline.js');
const MARKER = '# kaboom.claude';

function q(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

// Shell guard prefix: bail unless $KABOOM_ID is a safe id (no path/traversal
// chars — prevents writing state files outside ~/.claude/kaboom); ensure the
// state dir exists and is private (700).
const G = 'case "$KABOOM_ID" in ""|*[!A-Za-z0-9_-]*) exit 0;; esac; ' +
  'K="$HOME/.claude/kaboom"; mkdir -p "$K"; chmod 700 "$K" 2>/dev/null';
// Sanitize a counter read from a state file before arithmetic (a crafted
// non-numeric value could otherwise abuse bash arithmetic expansion).
const NUM = (v) => `case $${v} in *[!0-9]*) ${v}=0;; esac`;
const HOOKS = {
  UserPromptSubmit:
    `${G}; printf busy > "$K/activity.$KABOOM_ID"; date +%s > "$K/start.$KABOOM_ID"; ` +
    `n=$(cat "$K/turns.$KABOOM_ID" 2>/dev/null||echo 0); ${NUM('n')}; echo $((n+1)) > "$K/turns.$KABOOM_ID"; ` +
    `: > "$K/bell.$KABOOM_ID"  ${MARKER}`,
  Stop:
    `${G}; printf idle > "$K/activity.$KABOOM_ID"; date +%s > "$K/end.$KABOOM_ID"  ${MARKER}`,
  SubagentStart:
    `${G}; n=$(cat "$K/agents.$KABOOM_ID" 2>/dev/null||echo 0); ${NUM('n')}; echo $((n+1)) > "$K/agents.$KABOOM_ID"  ${MARKER}`,
  SubagentStop:
    `${G}; n=$(cat "$K/agents.$KABOOM_ID" 2>/dev/null||echo 0); ${NUM('n')}; m=$((n-1)); [ $m -lt 0 ] && m=0; ` +
    `echo $m > "$K/agents.$KABOOM_ID"  ${MARKER}`,
  PreToolUse:
    `${G}; t=$(sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p'|head -1); ` +
    `printf '%s' "$t" > "$K/tool.$KABOOM_ID"  ${MARKER}`,
  PostToolUse:
    `${G}; : > "$K/tool.$KABOOM_ID"  ${MARKER}`,
  Notification:
    `${G}; ty=$(sed -n 's/.*"notification_type"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p'|head -1); ` +
    `printf '%s' "$ty" > "$K/bell.$KABOOM_ID"  ${MARKER}`,
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
  // Only back up the PRISTINE settings once — never overwrite a good backup with
  // an already-modified (hooked) copy.
  try { if (!fs.existsSync(BACKUP_FILE)) fs.copyFileSync(SETTINGS_FILE, BACKUP_FILE); } catch (_) {}
}
function writeSettings(data) {
  try { fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); } catch (_) {}
  // Atomic write (temp + rename) so a crash or a concurrent writer can't leave
  // the user's global settings.json truncated/corrupt.
  const tmp = SETTINGS_FILE + '.kaboom-tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, SETTINGS_FILE);
}
function stripMarker(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr
    .map((g) => (g && Array.isArray(g.hooks)
      ? { ...g, hooks: g.hooks.filter((h) => !(h && typeof h.command === 'string' && h.command.includes(MARKER))) }
      : g))
    .filter((g) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0));
}
function isOurStatusLine(sl) {
  return sl && typeof sl.command === 'string' && sl.command.includes('kaboom-statusline');
}

// Install (idempotent — replaces any prior marked entries). Returns {ok,changed,message}.
function install() {
  const res = readSettings();
  if (!res.ok) {
    return { ok: false, changed: false, message: `Skipped pause hooks: cannot edit settings.json (${res.error.message}).` };
  }
  const data = res.data;
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) data.hooks = {};

  backupOnce(!res.missing);

  // Hooks: strip any prior kaboom entries for this event, then add the current one.
  for (const [event, command] of Object.entries(HOOKS)) {
    const arr = Array.isArray(data.hooks[event]) ? stripMarker(data.hooks[event]) : [];
    arr.push({ hooks: [{ type: 'command', command }] });
    data.hooks[event] = arr;
  }

  // statusLine: save the user's original (unless it's already ours), then install
  // our wrapper (copied to a stable path). The wrapper passes the original
  // through so nothing is lost.
  try { fs.mkdirSync(KABOOM_DIR, { recursive: true, mode: 0o700 }); } catch (_) {}
  if (!isOurStatusLine(data.statusLine)) {
    // 0600: the wrapper runs this file's command via `sh -c`, so keep it private.
    try { fs.writeFileSync(ORIG_SL, JSON.stringify(data.statusLine || null), { mode: 0o600 }); } catch (_) {}
  }
  let slPath = SL_STABLE;
  try { fs.copyFileSync(SL_SCRIPT, SL_STABLE); } catch (_) { slPath = SL_SCRIPT; } // fall back to in-package path
  data.statusLine = { type: 'command', command: `node ${q(slPath)}`, refreshInterval: 1 };

  try { writeSettings(data); } catch (err) {
    return { ok: false, changed: false, message: `Failed to write settings: ${err.message}` };
  }
  return { ok: true, changed: true, message: 'Info-panel hooks + status line ready (remove with: kaboom.claude unhook).' };
}

function uninstall() {
  const res = readSettings();
  if (!res.ok) return { ok: false, message: `Cannot edit settings.json: ${res.error.message}.` };
  if (res.missing) return { ok: true, message: 'No kaboom hooks to remove.' };
  const data = res.data;
  let changed = false;

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

  // Restore the user's original status line (or remove ours).
  if (isOurStatusLine(data.statusLine)) {
    let orig = null;
    try { orig = JSON.parse(fs.readFileSync(ORIG_SL, 'utf8')); } catch (_) {}
    if (orig && typeof orig === 'object') data.statusLine = orig;
    else delete data.statusLine;
    changed = true;
  }
  try { fs.unlinkSync(ORIG_SL); } catch (_) {}
  try { fs.unlinkSync(SL_STABLE); } catch (_) {}

  if (!changed) return { ok: true, message: 'No kaboom hooks present.' };
  backupOnce(true);
  try { writeSettings(data); } catch (err) { return { ok: false, message: `Failed to write settings: ${err.message}` }; }
  return { ok: true, message: 'Removed kaboom hooks + restored your status line.' };
}

module.exports = { install, uninstall, KABOOM_DIR };
