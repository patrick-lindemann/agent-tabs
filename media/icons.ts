import antigravityIcon from './icons/antigravity.svg';
import antigravityMonoIcon from './icons/antigravity-mono.svg';
import claudeIcon from './icons/claude.svg';
import claudeMonoIcon from './icons/claude-mono.svg';
import codexIcon from './icons/codex.svg';
import copilotIcon from './icons/copilot.svg';
import cursorIcon from './icons/cursor.svg';
import devinIcon from './icons/devin.svg';
import devinMonoIcon from './icons/devin-mono.svg';
import geminiIcon from './icons/gemini.svg';
import geminiMonoIcon from './icons/gemini-mono.svg';
import grokIcon from './icons/grok.svg';
import hermesIcon from './icons/hermes.svg';
import opencodeIcon from './icons/opencode.svg';
import piIcon from './icons/pi.svg';
import piMonoIcon from './icons/pi-mono.svg';
import sparkleIcon from './icons/sparkle.svg';
import blockedIcon from './icons/status/blocked.svg';
import doneIcon from './icons/status/done.svg';
import errorIcon from './icons/status/error.svg';
import workingIcon from './icons/status/working.svg';
import terminalIcon from './icons/terminal.svg';
import type { AgentId, TabInfo } from './types';
/**
 * Agent logos (media/icons), from Lobe Icons (MIT,
 * https://github.com/lobehub/lobe-icons) except pi's (https://pi.dev). Each
 * has a version in its brand colors and one in the text color; logos without
 * brand colors only have the latter.
 */
export const AGENT_ICONS: Record<AgentId, { color: string; mono: string }> = {
  claude: { color: claudeIcon, mono: claudeMonoIcon },
  codex: { color: codexIcon, mono: codexIcon },
  antigravity: { color: antigravityIcon, mono: antigravityMonoIcon },
  gemini: { color: geminiIcon, mono: geminiMonoIcon },
  opencode: { color: opencodeIcon, mono: opencodeIcon },
  pi: { color: piIcon, mono: piMonoIcon },
  cursor: { color: cursorIcon, mono: cursorIcon },
  copilot: { color: copilotIcon, mono: copilotIcon },
  grok: { color: grokIcon, mono: grokIcon },
  hermes: { color: hermesIcon, mono: hermesIcon },
  devin: { color: devinIcon, mono: devinMonoIcon }
};

/**
 * Three dots, `!` alone without a triangle, the codicon `check`, and a bold
 * `×`, heavier than the close button's. Editor tabs show the same icons as
 * images.
 */
export const STATUS_ICONS: Record<NonNullable<TabInfo['status']>, string> = {
  working: workingIcon,
  blocked: blockedIcon,
  done: doneIcon,
  error: errorIcon
};

/** Plain shells: the codicon `terminal` */
export const TERMINAL_ICON = terminalIcon;

/** Idle profiles without a known agent: the codicon `sparkle-filled` */
export const IDLE_ICON = sparkleIcon;

export const CLOSE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/></svg>';
