'use strict';

// kaboom.claude status-line capture.
//
// Claude Code only exposes live telemetry (model, tokens, context %, cost, rate
// limits) to a configured `statusLine` command via JSON on stdin. kaboom installs
// THIS script as that command so the game pane can show a Claude info panel.
//
// It is non-destructive: for kaboom sessions ($KABOOM_ID set) it writes the
// telemetry to info.<id>.json, and in ALL sessions it passes stdin through to the
// user's ORIGINAL status-line command (saved at install) and reprints its output,
// so the user's own status bar is unchanged. It must never throw or hang.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const KDIR = path.join(os.homedir(), '.claude', 'kaboom');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  // 1) Capture telemetry for the game (kaboom sessions only).
  try {
    const kid = process.env.KABOOM_ID;
    if (kid && /^[A-Za-z0-9_-]+$/.test(kid)) { // reject path-traversal chars in the id
      const j = JSON.parse(input);
      const cw = j.context_window || {};
      const cost = j.cost || {};
      const rl = j.rate_limits && j.rate_limits.five_hour;
      const info = {
        model: (j.model && j.model.display_name) || '',
        ctxPct: Math.round(cw.used_percentage || 0),
        inTok: cw.total_input_tokens || 0,
        outTok: cw.total_output_tokens || 0,
        ctxSize: cw.context_window_size || 0,
        costUsd: cost.total_cost_usd || 0,
        durMs: cost.total_duration_ms || 0,
        linesAdd: cost.total_lines_added || 0,
        linesDel: cost.total_lines_removed || 0,
        rl5h: rl ? Math.round(rl.used_percentage) : null,
        agentName: (j.agent && j.agent.name) || '',
        t: Date.now(),
      };
      try { fs.mkdirSync(KDIR, { recursive: true, mode: 0o700 }); } catch (_) {}
      fs.writeFileSync(path.join(KDIR, `info.${kid}.json`), JSON.stringify(info));
    }
  } catch (_) { /* bad/absent JSON → skip capture */ }

  // 2) Pass through to the user's original status line, if any.
  // This runs a stored command via `sh -c`, so guard the source file: it must be
  // a regular file we own (not a symlink someone planted) before we trust it.
  try {
    const f = path.join(KDIR, 'orig-statusline.json');
    const st = fs.lstatSync(f);
    const ownedByUs = typeof process.getuid !== 'function' || st.uid === process.getuid();
    if (st.isFile() && ownedByUs) {
      const orig = JSON.parse(fs.readFileSync(f, 'utf8')); // saved statusLine object, or null
      if (orig && orig.type === 'command' && typeof orig.command === 'string') {
        const r = spawnSync('sh', ['-c', orig.command], { input, encoding: 'utf8', timeout: 2000 });
        if (r.stdout) process.stdout.write(r.stdout);
      }
    }
  } catch (_) { /* no original / not trustworthy → print nothing */ }

  process.exit(0);
});
