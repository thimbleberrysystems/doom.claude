'use strict';

// snake.claude — diagnostic status line. Installed by `npx snake.claude probe`.
//
// It prints 10 numbered rows plus a couple of info rows, so you can:
//   1. count how many rows your Claude Code status line actually renders
//      (that's your height cap), and
//   2. see which fields the status-line JSON actually provides.
//
// Swap back to the game with `npx snake.claude install`, or remove everything
// with `npx snake.claude uninstall`.

const fs = require('fs');

function readStdin() {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

function main() {
  let ctx = {};
  try {
    ctx = JSON.parse(readStdin() || '{}') || {};
  } catch (_) {}

  const lines = [];
  for (let i = 1; i <= 10; i++) {
    lines.push(` snake.claude probe — row ${String(i).padStart(2, '0')}  (count the rows you can see)`);
  }

  const keys = Object.keys(ctx).join(', ') || '(none — no JSON received)';
  lines.push(` JSON keys: ${keys}`);

  const model = ctx.model && (ctx.model.display_name || ctx.model.id);
  const pct = ctx.context_window && ctx.context_window.used_percentage;
  const tok = ctx.context_window && ctx.context_window.total_input_tokens;
  lines.push(` model=${model != null ? model : '?'}  ctx%=${pct != null ? pct : '?'}  tokens=${tok != null ? tok : '?'}`);

  process.stdout.write(lines.join('\n') + '\n');
}

try {
  main();
} catch (_) {
  try {
    process.stdout.write(' snake.claude probe (error)\n');
  } catch (__) {}
}
