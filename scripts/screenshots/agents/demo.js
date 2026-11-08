// Stand-in for a coding agent in the README screenshots: it draws a plausible
// session and reports its status and title the way the real agent does
// (see test/unit/agents.ts). Nothing is sent to any service.
//   node demo.js <agent>
// The scene each agent shows is set by AGENT_TABS_DEMO_<AGENT>, e.g.
// AGENT_TABS_DEMO_CLAUDE=blocked; the default is `working`.

const agent = process.argv[2];
const scene = process.env[`AGENT_TABS_DEMO_${agent.toUpperCase()}`] ?? 'working';
const out = (text) => process.stdout.write(text);
const ESC = '\x1b';
const status = (body) => out(`${ESC}]7501;${body}${ESC}\\`);
const title = (text) => out(`${ESC}]0;${text}\x07`);
const b64 = (text) => Buffer.from(text).toString('base64');

const reset = `${ESC}[0m`;
const bold = (t) => `${ESC}[1m${t}${reset}`;
const dim = (t) => `${ESC}[2m${t}${reset}`;
const rgb = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return (t) => `${ESC}[38;2;${n >> 16};${(n >> 8) & 255};${n & 255}m${t}${reset}`;
};
const orange = rgb('#d97757');
const green = rgb('#4ec9b0');
const red = rgb('#f48771');
const blue = rgb('#75beff');
const yellow = rgb('#e5c07b');
const gray = rgb('#8b8b8b');

const lines = (...rows) => out(`${rows.join('\r\n')}\r\n`);
const cols = () => process.stdout.columns || 60;
const rule = (color = gray) => color('─'.repeat(cols()));

const diff = [
  `  ${gray(' 12')}   const limiter = rateLimit({`,
  `  ${gray(' 13')} ${red('-   windowMs: 60_000,')}`,
  `  ${gray(' 13')} ${green('+   windowMs: config.rateLimit.window,')}`,
  `  ${gray(' 14')} ${red('-   max: 100,')}`,
  `  ${gray(' 14')} ${green('+   max: config.rateLimit.max,')}`,
  `  ${gray(' 15')}     standardHeaders: true,`
];

const scenes = {
  claude() {
    status('state=idle:app=claude-code');
    title('✳ Claude Code');
    const welcome = ` ✻ Welcome to Claude Code! `;
    lines(
      orange(`╭${'─'.repeat(welcome.length)}╮`),
      `${orange('│')} ${orange('✻')} Welcome to ${bold('Claude Code')}! ${orange('│')}`,
      orange(`╰${'─'.repeat(welcome.length)}╯`),
      '',
      `${gray('>')} Make the rate limiter configurable per route`,
      '',
      `${orange('⏺')} I'll read the middleware first.`,
      '',
      `${green('⏺')} ${bold('Read')}(src/middleware/rateLimit.ts)`,
      `  ⎿  Read 48 lines`,
      '',
      `${green('⏺')} ${bold('Update')}(src/middleware/rateLimit.ts)`,
      ...diff,
      ''
    );
    title('⠂ Configurable rate limits');
    status('state=working:app=claude-code');
    if (scene === 'blocked') {
      lines(
        rule(orange),
        ` ${bold('Bash command')}`,
        '',
        `   npm test -- rateLimit`,
        `   ${dim('Run the rate limiter tests')}`,
        '',
        ' Do you want to proceed?',
        ` ${orange('❯')} ${orange('1. Yes')}`,
        "   2. Yes, and don't ask again for npm test commands",
        '   3. No, and tell Claude what to do differently (esc)'
      );
      status(
        `state=blocked:kind=permission:app=claude-code:msg=${b64('Bash: npm test -- rateLimit')}`
      );
    } else {
      lines(
        `${orange('✻')} ${orange('Updating routes…')} ${dim('(42s · ↓ 1.2k tokens · esc to interrupt)')}`
      );
    }
  },

  codex() {
    status('state=idle:app=codex');
    title('Ready | api-server');
    lines(
      `${bold('>_ OpenAI Codex')} ${dim('(v0.165.0)')}`,
      '',
      `${dim('model:')}     gpt-5-codex   ${dim('/model to change')}`,
      `${dim('directory:')} ~/api-server`,
      '',
      `${gray('›')} Add request IDs to every log line`,
      '',
      `${bold('•')} Explored`,
      `  ${gray('└')} Read logger.ts, server.ts`,
      `${bold('•')} Edited src/logger.ts ${green('(+14')} ${red('-3)')}`,
      ''
    );
    status('state=working:app=codex');
    title('⠋ Working | Request IDs | api-server');
    // Finishes after the screenshot driver has moved to another tab
    setTimeout(
      () => {
        out(`\x1b]9;Agent turn complete\x07`);
        status('state=done:app=codex');
        title('Ready | Request IDs | api-server');
        lines(
          `${bold('•')} Every log line now carries the request ID from the`,
          '  `x-request-id` header, or a new UUID when it is missing.',
          '',
          `${gray('›')} ${dim('Ask Codex to do anything')}`
        );
      },
      Number(process.env.AGENT_TABS_DEMO_DELAY ?? 6000)
    );
  },

  pi() {
    status('state=idle:app=pi');
    title('π - Flaky auth test - api-server');
    lines(
      `${bold('pi')} ${dim('v1.4.0 · claude-opus · api-server')}`,
      '',
      `${blue('you')}  Why does test/auth.test.ts fail on CI only?`,
      '',
      `${green('pi')}   The token expiry uses the wall clock. CI runs in UTC, so`,
      '     the fixture date crosses midnight and the token expires.',
      '',
      `     ${yellow('edit')} test/auth.test.ts`,
      `     ${green('+ vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));')}`,
      ''
    );
    status('state=working:app=pi');
    if (scene === 'blocked') {
      lines(
        `${yellow('?')} ${bold('Also pin the timezone in the CI workflow?')}`,
        `  ${blue('❯')} Yes, set TZ=UTC in .github/workflows/test.yml`,
        '    No, only fix the test'
      );
      status(`state=blocked:kind=question:app=pi:msg=${b64('Also pin the timezone in CI?')}`);
    } else {
      lines(`${dim('⠋ running npm test…')}`);
    }
  },

  gemini() {
    title('◇  Ready (api-server)'.padEnd(80));
    lines(
      blue(bold(' ███ GEMINI')),
      '',
      `${gray('>')} Document the public API in README.md`,
      '',
      `${blue('✦')} I'll add a section for each endpoint.`,
      ''
    );
    title('✦  Writing the API reference (api-server)'.padEnd(80));
    lines(`${blue('⠼')} Writing the API reference ${dim('(18s)')}`);
  },

  opencode() {
    status('state=idle:app=opencode');
    title('OpenCode');
    lines(
      bold('opencode'),
      '',
      `${gray('┃')} Upgrade express to v5`,
      '',
      `${gray('┃')} Updated package.json and 3 routes for the v5 router.`,
      ''
    );
    status('state=working:app=opencode');
    title('OC | Express 5 upgrade');
    status('state=idle:app=opencode');
    lines(`${gray('>')} `);
  },

  copilot() {
    title('GitHub Copilot');
    lines(
      bold('GitHub Copilot CLI'),
      '',
      `${gray('>')} Find unused exports`,
      '',
      `${green('●')} Searching for unused exports…`
    );
  }
};

// Clear the screen and hide the cursor, as agents with their own input box do
out(`${ESC}[2J${ESC}[H${ESC}[?25l`);
scenes[agent]();
// Stay open like an agent at its prompt; answer the status support query
process.stdin.setRawMode?.(true);
process.stdin.on('data', (data) => {
  if (data.toString().includes('\x03')) process.exit(0);
});
setInterval(() => {}, 1 << 30);
