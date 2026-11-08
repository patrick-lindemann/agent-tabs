import { describe, expect, it } from 'vitest';
import { launchForCommand } from '../../src/profiles';
import { TerminalStateManager } from '../../src/terminal/state';
import { resetStatus, StatusTracker } from '../../src/terminal/status';
import type { AgentId, TabStatus, TerminalInstance } from '../../src/types';
import { type AgentTranscript, notify, query, status, TRANSCRIPTS, title } from './agents';

const COMMANDS: Record<AgentId, string> = {
  claude: 'claude',
  codex: 'codex',
  antigravity: 'agy',
  gemini: 'gemini',
  opencode: 'opencode',
  pi: 'pi',
  cursor: 'agent',
  copilot: 'copilot',
  grok: 'grok',
  hermes: 'hermes',
  devin: 'devin'
};

/**
 * One tab running an agent, fed through the same tracker and state manager as
 * the extension. `inView` is whether the tab is shown.
 */
function tab(agent: AgentId, options: { inView?: boolean; programStatus?: boolean } = {}) {
  const state = new TerminalStateManager();
  const tracker = new StatusTracker();
  const instance: TerminalInstance = {
    id: 'tab',
    isActive: options.inView ?? false,
    launch: launchForCommand(COMMANDS[agent], [], true)
  };
  state.set(instance.id, instance);
  const replies: string[] = [];
  let inView = options.inView ?? false;
  return {
    instance,
    replies,
    output(data: string): boolean {
      return tracker.track(instance, data, {
        programStatus: options.programStatus ?? true,
        inView,
        reply: (reply) => replies.push(reply)
      });
    },
    show(shown: boolean) {
      inView = shown;
      instance.isActive = shown;
    },
    get status(): TabStatus | undefined {
      return state.getStatus(instance);
    },
    get text(): string | undefined {
      return state.describeStatus(instance);
    },
    get busy(): boolean {
      return state.isBusy(instance);
    },
    get label(): string {
      return state.getLabel(instance, true, 4);
    }
  };
}

describe.each(TRANSCRIPTS)('$agent tab status', (transcript: AgentTranscript) => {
  const { agent } = transcript;

  it('is recognized from its command', () => {
    expect(launchForCommand(transcript.command, [], true).agent).toBe(agent);
  });

  it(transcript.queries ? 'gets an answer to its support query' : 'needs no answer', () => {
    const t = tab(agent);
    t.output(transcript.start);
    expect(t.replies).toEqual(transcript.queries ? ['\x1b]7501;?\x1b\\'] : []);
  });

  it('shows nothing at the prompt and working during a turn', () => {
    const t = tab(agent);
    t.output(transcript.start);
    expect(t.status).toBeUndefined();
    t.output(transcript.working);
    expect(t.status).toBe('working');
    expect(t.busy).toBe(true);
  });

  if (transcript.blocked) {
    const blocked = transcript.blocked;
    it('needs input when it asks something, then works again', () => {
      const t = tab(agent);
      t.output(transcript.start + transcript.working + blocked);
      expect(t.status).toBe('blocked');
      expect(t.busy).toBe(true);
      t.output(transcript.working);
      expect(t.status).toBe('working');
    });
  }

  it('is done when the turn completes in a background tab, until shown', () => {
    const t = tab(agent);
    t.output(transcript.start + transcript.working + transcript.done);
    expect(t.status).toBe('done');
    expect(t.busy).toBe(false);
    t.instance.unseen = undefined; // the seen timer in Tabs clears this
    expect(t.status).toBeUndefined();
  });

  it('shows nothing when the turn completes in view', () => {
    const t = tab(agent, { inView: true });
    t.output(transcript.start + transcript.working + transcript.done);
    expect(t.status).toBeUndefined();
  });

  if (transcript.cancelled) {
    const cancelled = transcript.cancelled;
    it('shows nothing after a cancel, even in a background tab', () => {
      const t = tab(agent);
      t.output(transcript.start + transcript.working + cancelled);
      expect(t.status).toBeUndefined();
    });
  }

  if (transcript.error) {
    const error = transcript.error;
    it('failed when the turn fails in a background tab', () => {
      const t = tab(agent);
      t.output(transcript.start + transcript.working + error);
      expect(t.status).toBe('error');
    });
  }

  it('starts a new turn without the previous result', () => {
    const t = tab(agent);
    t.output(transcript.start + transcript.working + transcript.done);
    t.output(transcript.working);
    expect(t.status).toBe('working');
    expect(t.instance.unseen).toBeUndefined();
  });

  it('shows no status with programStatus off', () => {
    const t = tab(agent, { programStatus: false });
    t.output(transcript.start + transcript.working);
    expect(t.status).toBeUndefined();
    expect(t.replies).toEqual([]);
  });

  it.each(transcript.titles)('labels the tab from the title %j', (text, label) => {
    const t = tab(agent);
    t.output(title(text));
    expect(t.instance.titleLabel).toBe(label);
  });
});

describe('status details', () => {
  it('shows the reported message, e.g. what needs approval', () => {
    const t = tab('claude');
    t.output(TRANSCRIPTS[0].start + TRANSCRIPTS[0].blocked);
    expect(t.text).toBe('Needs input: Allow Bash: npm test?');
  });

  it("shows Codex's approval notification when the report has no message", () => {
    const t = tab('codex');
    t.output(status('state=working') + notify('Approval requested: cargo test'));
    t.output(status('state=blocked:kind=permission'));
    expect(t.text).toBe('Needs input: Approval requested: cargo test');
  });

  it('ignores child records, e.g. a background task finishing', () => {
    const t = tab('claude');
    t.output(status('state=working') + status('state=done:id=bg1'));
    expect(t.status).toBe('working');
  });

  it('forgets an earlier notification when the agent clears its status', () => {
    const t = tab('codex');
    t.output(status('state=working') + notify('Approval requested: rm -rf build'));
    t.output(status('state=clear'));
    t.output(status('state=blocked:kind=question'));
    expect(t.text).toBe('Needs input');
  });

  it('forgets the status when the agent clears it', () => {
    const t = tab('pi');
    t.output(status('state=blocked:kind=question'));
    t.output(status('state=clear'));
    expect(t.status).toBeUndefined();
    expect(t.instance.programState).toBeUndefined();
  });
});

describe('Codex without done reports (before 0.163)', () => {
  it('is done when idle follows a turn-complete notification', () => {
    const t = tab('codex');
    t.output(status('state=working:app=codex'));
    t.output(notify('Agent turn complete') + status('state=idle:app=codex'));
    expect(t.status).toBe('done');
  });

  it('is done when the notification arrives in the same chunk after idle', () => {
    const t = tab('codex');
    t.output(status('state=working:app=codex'));
    t.output(status('state=idle:app=codex') + notify('Agent turn complete'));
    expect(t.status).toBe('done');
  });

  it('shows nothing for a bare idle, which is a cancel', () => {
    const t = tab('codex');
    t.output(status('state=working:app=codex'));
    t.output(status('state=idle:app=codex'));
    expect(t.status).toBeUndefined();
  });

  it('needs input after a plan prompt notification', () => {
    const t = tab('codex', { inView: true });
    t.output(status('state=working:app=codex'));
    t.output(notify('Plan mode prompt: Implement this plan?') + status('state=idle:app=codex'));
    expect(t.status).toBe('blocked');
    expect(t.text).toBe('Needs input: Plan mode prompt: Implement this plan?');
  });

  it('does not count a notification from a previous turn', () => {
    const t = tab('codex');
    t.output(status('state=working') + notify('Agent turn complete') + status('state=done'));
    t.instance.unseen = undefined;
    t.output(status('state=working'));
    t.output(status('state=idle'));
    expect(t.status).toBeUndefined();
  });

  it('treats done turning into idle on a key press as no change', () => {
    const t = tab('codex');
    t.output(status('state=working') + status('state=done'));
    t.output(status('state=idle'));
    expect(t.status).toBe('done');
  });
});

describe('the bell', () => {
  it('means a question the agent did not report while it works', () => {
    const t = tab('pi');
    t.output(status('state=working:app=pi'));
    expect(t.output('Pick a branch:\r\n› main\x07')).toBe(true);
    expect(t.status).toBe('blocked');
    expect(t.busy).toBe(true);
  });

  it('is cleared by the next report', () => {
    const t = tab('pi');
    t.output(`${status('state=working')}\x07`);
    t.output(status('state=working'));
    expect(t.status).toBe('working');
  });

  it('only counts after the working report it follows', () => {
    const t = tab('pi');
    t.output(`\x07${status('state=working')}`);
    expect(t.status).toBe('working');
  });

  it('does nothing at the prompt, e.g. Hermes ringing when done', () => {
    const t = tab('hermes');
    t.output(`${status('state=done')}\x07`);
    expect(t.status).toBe('done');
    expect(t.instance.needsInput).toBeFalsy();
  });
});

describe('tracker', () => {
  it('reports whether the label or status changed', () => {
    const t = tab('claude');
    expect(t.output('plain output')).toBe(false);
    expect(t.output(title('✳ Fix login'))).toBe(true);
    expect(t.output(title('⠂ Fix login'))).toBe(false);
    expect(t.output(status('state=working'))).toBe(true);
  });

  it('answers every support query', () => {
    const t = tab('claude');
    t.output(query + query);
    expect(t.replies).toHaveLength(2);
  });

  it('keeps a sequence split across chunks for each tab separately', () => {
    const tracker = new StatusTracker();
    const launch = launchForCommand('pi', [], true);
    const a: TerminalInstance = { id: 'a', isActive: false, launch };
    const b: TerminalInstance = { id: 'b', isActive: false, launch };
    const options = { programStatus: true, inView: false, reply: () => {} };
    tracker.track(a, '\x1b]7501;state=wor', options);
    tracker.track(b, status('state=done'), options);
    tracker.track(a, 'king\x1b\\', options);
    expect(a.programState).toBe('working');
    expect(b.programState).toBe('done');
  });

  it('starts over after forgetting a tab', () => {
    const tracker = new StatusTracker();
    const instance: TerminalInstance = {
      id: 'a',
      isActive: false,
      launch: launchForCommand('pi', [], true)
    };
    const options = { programStatus: true, inView: false, reply: () => {} };
    tracker.track(instance, '\x1b]7501;state=wor', options);
    tracker.forget('a');
    tracker.track(instance, 'king\x1b\\', options);
    expect(instance.programState).toBeUndefined();
  });

  it('resets everything a run reported before a restart', () => {
    const t = tab('claude');
    t.output(title('✳ Fix login') + status('state=error:msg=RmFpbGVk'));
    t.instance.exited = true;
    t.instance.missing = 'claude';
    resetStatus(t.instance);
    expect(t.status).toBeUndefined();
    expect(t.label).toBe('Claude Code');
    expect(t.instance).toMatchObject({ exited: false, reportsStatus: false });
  });
});
