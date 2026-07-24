'use strict';

// The tmux status-right bar, built in one place so `split` (initial render) and
// the `click` dispatch (when the minimize toggle flips) always agree.
//
// Buttons dispatch back through `kaboom.claude click <range>`. The minimize
// toggle is a single button that shows ›› while the game is expanded (click to
// shrink it to a sliver) and ‹‹ once minimized (click to restore its last size).

const btn = (name, label, bg) =>
  `#[fg=colour231,bg=${bg}]#[range=user|${name}] ${label} #[norange]#[default] `;

const HINT = `#[fg=colour246]Space to shoot · E to use#[default]   `;

// Normal split bar. `minimized` flips the toggle button's arrow + action.
function statusRight(minimized) {
  const toggle = minimized
    ? btn('restore', '‹‹ Restore', 'colour238')   // game is a sliver → click to bring it back
    : btn('minimize', '›› Minimize', 'colour238'); // game is open → click to minimize it
  return HINT +
    btn('claude', '◀ Claude', 'colour24') + btn('game', 'Game ▶', 'colour28') +
    toggle + btn('zoom', '⤢ Zoom', 'colour238') +
    btn('quit', '✕ Close game', 'colour88');
}

// Shown after the game pane is closed — the toggle now ends the whole session.
const CLOSE_CLAUDE_BAR =
  ' #[fg=colour231,bg=colour88]#[range=user|quitclaude] ✕ Close Claude — end session #[norange]#[default]';

module.exports = { statusRight, CLOSE_CLAUDE_BAR, btn };
