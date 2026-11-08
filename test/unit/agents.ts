import type { AgentId } from '../../src/types';

/**
 * What each supported agent writes to its terminal during one turn, built
 * from its source code or documentation (see `source`). The tests run these
 * bytes through the real parser and status code, so a change in how an agent
 * reports its status only needs an update here.
 */

const ESC = '\x1b';
const ST = `${ESC}\\`;
const BEL = '\x07';

export const status = (body: string) => `${ESC}]7501;${body}${ST}`;
export const title = (text: string, terminator = BEL) => `${ESC}]0;${text}${terminator}`;
export const notify = (text: string) => `${ESC}]9;${text}${BEL}`;
export const query = `${ESC}]7501;?${ST}`;
export const msg = (text: string) => Buffer.from(text, 'utf8').toString('base64');

/** Screen output between signals, which must not confuse the parser */
const SCREEN = `${ESC}[2J${ESC}[H${ESC}[1mReading files…${ESC}[0m\r\n`;

export interface AgentTranscript {
  agent: AgentId;
  command: string;
  /** Where the bytes come from */
  source: string;
  /** Whether the agent waits for the terminal to answer `OSC 7501 ; ?` */
  queries: boolean;
  /** Output when the agent starts and sits at its prompt */
  start: string;
  /** Output after the user submits a prompt */
  working: string;
  /** Output when the agent asks for permission or an answer */
  blocked?: string;
  /** Output when the turn completes */
  done: string;
  /** Output when the user cancels the turn with Esc */
  cancelled?: string;
  /** Output when the turn fails */
  error?: string;
  /** A title the agent sets and the tab label it should give, if any */
  titles: Array<[title: string, label: string | undefined]>;
}

export const TRANSCRIPTS: AgentTranscript[] = [
  {
    agent: 'claude',
    command: 'claude',
    source:
      'code.claude.com/docs/en/terminal-config (v2.1.295+); reports after the probe, ' +
      'app=claude-code, child records with id=',
    queries: true,
    start: query + status('state=idle:app=claude-code') + title('✳ Claude Code'),
    working:
      status('state=working:app=claude-code') +
      title('⠂ Refactor API client') +
      SCREEN +
      status('state=working:id=bg1:app=claude-code:title=QmFzaA=='),
    blocked: status(
      `state=blocked:kind=permission:app=claude-code:msg=${msg('Allow Bash: npm test?')}`
    ),
    done: status('state=done:app=claude-code') + title('✳ Refactor API client'),
    cancelled: status('state=idle:app=claude-code'),
    error: status(`state=error:app=claude-code:msg=${msg('API Error: overloaded')}`),
    titles: [
      ['✳ Refactor API client', 'Refactor API client'],
      ['⠐ Refactor API client', 'Refactor API client'],
      ['Refactor API client', 'Refactor API client'],
      ['✳ Claude Code', undefined]
    ]
  },
  {
    agent: 'codex',
    command: 'codex',
    source:
      'codex-rs/tui/src/terminal_program_status.rs (0.163+): reports whenever stdout is a ' +
      'terminal, never queries; done becomes idle on the next key. OSC 9 from the profile options',
    queries: false,
    start: status('state=idle:app=codex'),
    working: status('state=working:app=codex') + SCREEN,
    blocked:
      notify('Approval requested: cargo test') + status('state=blocked:app=codex:kind=permission'),
    done: notify('Agent turn complete') + status('state=done:app=codex'),
    cancelled: status('state=idle:app=codex'),
    titles: [
      ['Ready | agent-terminal', undefined],
      ['⠋ Working | Fix login | agent-terminal', 'Fix login'],
      ['[ ! ] Action Required | Fix login | agent-terminal', 'Fix login']
    ]
  },
  {
    agent: 'pi',
    command: 'pi',
    source:
      'pi packages/tui/src/program-status.ts (1.1+): reports after the probe, app=pi; ' +
      'interactive-mode.ts title `π - <session> - <folder>`',
    queries: true,
    start: query + status('state=idle:app=pi') + title('π - agent-terminal'),
    working: `${status('state=working:app=pi')}${ESC}]9;4;3${BEL}${SCREEN}`,
    blocked: status(`state=blocked:kind=question:app=pi:msg=${msg('Which branch?')}`),
    done: `${status('state=done:app=pi')}${ESC}]9;4;0${BEL}`,
    cancelled: status('state=idle:app=pi'),
    error: status('state=error:app=pi'),
    titles: [
      ['π - Fix tests - agent-terminal', 'Fix tests'],
      ['π - agent-terminal', undefined]
    ]
  },
  {
    agent: 'opencode',
    command: 'opencode',
    source:
      'opencode packages/tui/src/context/program-status.ts: root record plus id= records ' +
      'per session, no done or error; app.tsx title `OpenCode` / `OC | <title>`',
    queries: false,
    start: status('state=idle:app=opencode') + title('OpenCode'),
    working:
      status('state=working:app=opencode:title=Rml4') +
      status('state=working:id=ses_1:app=opencode:title=Rml4') +
      title('OC | Fix login bug'),
    blocked: status(
      `state=blocked:kind=permission:app=opencode:msg=${msg('Allow edit of src/app.ts?')}`
    ),
    done: status('state=clear:id=ses_1') + status('state=idle:app=opencode'),
    titles: [
      ['OC | Fix login bug', 'Fix login bug'],
      ['OpenCode', undefined]
    ]
  },
  {
    agent: 'grok',
    command: 'grok',
    source: 'x.ai changelog 1.0.52 "support for OSC 7501" (via dozable.com); bytes inferred',
    queries: true,
    start: query + status('state=idle:app=grok'),
    working: status('state=working:app=grok') + SCREEN,
    blocked: status('state=blocked:kind=permission:app=grok'),
    done: status('state=done:app=grok'),
    titles: []
  },
  {
    agent: 'hermes',
    command: 'hermes',
    source:
      'NousResearch/hermes-agent PR #140837 (open): app=hermes, idle on cancel; ' +
      'display.bell_on_complete / bell_on_prompt ring the bell',
    queries: false,
    start: status('state=idle:app=hermes'),
    working: status('state=working:app=hermes') + SCREEN,
    blocked: status(`state=blocked:kind=auth:app=hermes:msg=${msg('sudo password')}`) + BEL,
    done: status('state=done:app=hermes') + BEL,
    cancelled: status('state=idle:app=hermes'),
    error: status('state=error:app=hermes'),
    titles: [['⏳ Release prep', 'Release prep']]
  },
  {
    agent: 'devin',
    command: 'devin',
    source: 'docs.devin.ai/cli/changelog v3000.11.92: idle, working, blocked, done, error',
    queries: false,
    start: status('state=idle:app=devin'),
    working: status('state=working:app=devin') + SCREEN,
    blocked: status('state=blocked:kind=permission:app=devin'),
    done: status('state=done:app=devin'),
    error: status('state=error:app=devin'),
    titles: []
  }
];

/**
 * Agents that report no OSC 7501 status. Their tabs fall back to the prompt
 * detector, which matches the text they show when they wait for an answer.
 */
export interface SilentAgent {
  agent: AgentId;
  command: string;
  source: string;
  /** Output while working, which must not look like a prompt */
  working: string;
  /** Output when the agent asks something */
  prompt: string;
  titles: Array<[title: string, label: string | undefined]>;
}

export const SILENT_AGENTS: SilentAgent[] = [
  {
    agent: 'gemini',
    command: 'gemini',
    source: 'gemini-cli packages/cli/src/utils/windowTitle.ts; OSC 7501 only in unmerged PR #29918',
    working: title('✦  Working… (agent-terminal)'.padEnd(80)) + SCREEN,
    prompt:
      title('✋  Action Required (agent-terminal)'.padEnd(80)) +
      'Apply this change?\r\n● 1. Yes, allow once\r\n  2. No (esc to cancel)',
    titles: [
      ['◇  Ready (agent-terminal)'.padEnd(80), undefined],
      ['✦  Working… (agent-terminal)'.padEnd(80), undefined],
      ['✋  Action Required (agent-terminal)'.padEnd(80), undefined],
      ['✦  Planning the refactor (agent-terminal)'.padEnd(80), 'Planning the refactor'],
      ['Gemini CLI (agent-terminal)'.padEnd(80), undefined]
    ]
  },
  {
    agent: 'copilot',
    command: 'copilot',
    source: 'github/copilot-cli#5320: no OSC 7501 (open)',
    working: SCREEN,
    prompt: 'Do you want to run this command?\r\n❯ 1. Yes\r\n  2. No, and tell Copilot',
    titles: []
  },
  {
    agent: 'cursor',
    command: 'agent',
    source: 'forum.cursor.com feature requests for OSC 7501 and status titles (open)',
    working: SCREEN,
    prompt: 'Run this command?\r\n › 1. Run (once)\r\n   2. Skip (esc to cancel)',
    titles: []
  },
  {
    agent: 'antigravity',
    command: 'agy',
    source: 'antigravity.google/docs/cli/title: sets no title unless the user configures a script',
    working: SCREEN,
    prompt: 'Allow running `npm test`? (y/n)',
    titles: []
  }
];
