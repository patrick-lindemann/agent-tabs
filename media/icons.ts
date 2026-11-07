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
import type { TabInfo } from './types';
const IS_MAC = navigator.platform.toUpperCase().includes('MAC');

/**
 * Agent logos (media/icons), from Lobe Icons (MIT,
 * https://github.com/lobehub/lobe-icons) except pi's (https://pi.dev). Each
 * has a version in its brand colors and one in the text color; logos without
 * brand colors only have the latter.
 */
export const AGENT_ICONS: Record<NonNullable<TabInfo['agent']>, { color: string; mono: string }> = {
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

export const STATUS_ICONS: Record<NonNullable<TabInfo['status']>, string> = {
  working:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle fill="currentColor" cx="3.5" cy="8" r="1.5"/><circle fill="currentColor" cx="8" cy="8" r="1.5"/><circle fill="currentColor" cx="12.5" cy="8" r="1.5"/></svg>',
  // `!` alone, without the triangle around it
  blocked:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7.1 2.5h1.8l-.3 7.5H7.4l-.3-7.5zM8 11.6a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z"/></svg>',
  // codicon `check`
  done: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.6572 3.13573C13.8583 2.9465 14.175 2.95614 14.3643 3.15722C14.5535 3.35831 14.5438 3.675 14.3428 3.86425L5.84277 11.8642C5.64597 12.0494 5.33756 12.0446 5.14648 11.8535L1.64648 8.35351C1.45121 8.15824 1.45121 7.84174 1.64648 7.64647C1.84174 7.45121 2.15825 7.45121 2.35351 7.64647L5.50976 10.8027L13.6572 3.13573Z"/></svg>',
  // A bold `×`, heavier than the close button's
  error:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>'
};

/** Idle profiles without a known agent: the codicon `sparkle-filled` */
export const IDLE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5.46524 9.82962C5.62134 9.94037 5.80806 9.99974 5.99946 9.99948C6.19151 10.0003 6.37897 9.94082 6.53546 9.82948C6.69223 9.71378 6.81095 9.55398 6.87646 9.37048L7.22346 8.30348C7.3077 8.05191 7.44906 7.82327 7.63646 7.63548C7.82305 7.44851 8.05078 7.30776 8.30146 7.22448L9.38746 6.87148C9.56665 6.80759 9.72173 6.68989 9.83146 6.53448C9.94145 6.37908 10.0005 6.19337 10.0005 6.00298C10.0005 5.81259 9.94145 5.62689 9.83146 5.47148C9.71293 5.30613 9.54426 5.18339 9.35046 5.12148L8.28146 4.77548C8.02989 4.69238 7.80123 4.55163 7.61371 4.36447C7.4262 4.1773 7.28503 3.9489 7.20146 3.69748L6.84846 2.61348C6.78519 2.43423 6.66777 2.27908 6.51246 2.16948C6.35557 2.06133 6.16951 2.00342 5.97896 2.00342C5.78841 2.00342 5.60235 2.06133 5.44546 2.16948C5.28572 2.28196 5.16594 2.44237 5.10346 2.62748L4.74846 3.71748C4.66476 3.96155 4.52691 4.18351 4.34524 4.36673C4.16358 4.54996 3.9428 4.6897 3.69946 4.77548L2.61546 5.12648C2.43437 5.19048 2.27775 5.30937 2.16743 5.4666C2.05712 5.62383 1.99859 5.81155 2.00003 6.00361C2.00146 6.19568 2.06277 6.38251 2.17541 6.53808C2.28806 6.69364 2.44643 6.81019 2.62846 6.87148L3.69546 7.21848C3.94767 7.30297 4.17673 7.44506 4.36446 7.63348C4.41519 7.6837 4.46262 7.73715 4.50646 7.79348C4.62481 7.94615 4.71614 8.11797 4.77646 8.30148L5.12846 9.38148C5.19143 9.56222 5.30914 9.71886 5.46524 9.82962ZM10.5344 13.8515C10.6703 13.9477 10.8328 13.9994 10.9994 13.9995C11.1642 13.998 11.3245 13.9456 11.4584 13.8495C11.5979 13.751 11.7029 13.611 11.7584 13.4495L12.0064 12.6875C12.0595 12.529 12.1485 12.385 12.2664 12.2665C12.3837 12.148 12.5277 12.0592 12.6864 12.0075L13.4584 11.7555C13.6161 11.701 13.7528 11.5985 13.8494 11.4625C13.9227 11.3595 13.9706 11.2405 13.9891 11.1154C14.0076 10.9903 13.9962 10.8626 13.9558 10.7428C13.9154 10.623 13.8472 10.5144 13.7567 10.4261C13.6662 10.3377 13.5561 10.272 13.4354 10.2345L12.6714 9.98548C12.5132 9.93291 12.3695 9.8443 12.2514 9.72663C12.1334 9.60896 12.0444 9.46547 11.9914 9.30748L11.7394 8.53348C11.685 8.37623 11.5825 8.24011 11.4464 8.14448C11.3443 8.07153 11.2266 8.02359 11.1026 8.00453C10.9787 7.98547 10.8519 7.99582 10.7327 8.03475C10.6135 8.07369 10.5051 8.1401 10.4163 8.22865C10.3274 8.31719 10.2607 8.42538 10.2214 8.54448L9.97435 9.30648C9.92207 9.46413 9.83452 9.60777 9.71835 9.72648C9.60382 9.84272 9.46428 9.9313 9.31035 9.98548L8.53435 10.2385C8.41689 10.2793 8.31057 10.347 8.22382 10.4361C8.13708 10.5252 8.0723 10.6333 8.03464 10.7518C7.99698 10.8704 7.98746 10.996 8.00686 11.1189C8.02625 11.2417 8.07401 11.3583 8.14635 11.4595C8.24456 11.5993 8.38462 11.7044 8.54635 11.7595L9.30935 12.0065C9.46821 12.0599 9.61262 12.1492 9.73135 12.2675C9.84958 12.3857 9.93801 12.5304 9.98935 12.6895L10.2424 13.4635C10.2971 13.6199 10.3992 13.7555 10.5344 13.8515Z"/></svg>';

export const CLOSE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/></svg>';

