import * as path from 'path';
import type { AgentId, LaunchSpec, Profile, ProfileConfig } from './types';

interface AgentDefinition {
  label: string;
  command: string;
  /**
   * Arguments the extension needs for status reporting. Codex reports
   * `working` and `idle` but no `done`; with these options it writes an OSC 9
   * notification when a turn completes or needs approval, which tells a
   * finished turn apart from a cancelled one.
   */
  statusArgs: string[];
}

const AGENTS: Record<AgentId, AgentDefinition> = {
  pi: { label: 'pi', command: 'pi', statusArgs: [] },
  claude: { label: 'Claude Code', command: 'claude', statusArgs: [] },
  codex: {
    label: 'Codex',
    command: 'codex',
    statusArgs: [
      '-c',
      'tui.notification_method="osc9"',
      '-c',
      'tui.notifications=["agent-turn-complete","approval-requested"]',
      '-c',
      'tui.notification_condition="always"'
    ]
  }
};

const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

export const DEFAULT_PROFILES: ProfileConfig[] = AGENT_IDS.map((id) => ({ id }));

function isAgentId(id: string): id is AgentId {
  return Object.hasOwn(AGENTS, id);
}

/**
 * Validates `agentTerminal.profiles` and resolves its entries in order.
 * Entries with a built-in agent's id (`pi`, `claude`, `codex`) inherit its
 * label, command and status arguments; other entries need a command. Invalid
 * and duplicate entries are skipped and described in `problems`. Without any
 * valid entry, the built-in agents are used.
 */
export function resolveProfiles(
  entries: unknown,
  programStatus: boolean
): { profiles: Profile[]; problems: string[] } {
  const problems: string[] = [];
  const profiles: Profile[] = [];
  const seen = new Set<string>();

  if (!Array.isArray(entries)) {
    problems.push('it must be a list');
  } else {
    entries.forEach((entry, index) => {
      const config = parseProfileConfig(entry);
      if (!config) {
        problems.push(`entry ${String(index + 1)} is not a valid profile`);
      } else if (seen.has(config.id)) {
        problems.push(`"${config.id}" is listed twice`);
      } else if (!isAgentId(config.id) && !config.command) {
        problems.push(`"${config.id}" needs a command`);
      } else {
        seen.add(config.id);
        profiles.push(resolveProfile(config, programStatus));
      }
    });
  }

  if (profiles.length === 0) {
    problems.push('no valid profile is left, so pi, Claude Code and Codex are used');
    return {
      profiles: DEFAULT_PROFILES.map((config) => resolveProfile(config, programStatus)),
      problems
    };
  }
  return { profiles, problems };
}

function resolveProfile(config: ProfileConfig, programStatus: boolean): Profile {
  const agent = isAgentId(config.id) ? config.id : undefined;
  const definition = agent ? AGENTS[agent] : undefined;
  return {
    id: config.id,
    label: config.label ?? definition?.label ?? config.id,
    command: config.command ?? definition?.command ?? config.id,
    args: [...(definition && programStatus ? definition.statusArgs : []), ...(config.args ?? [])],
    env: config.env ?? {},
    agent
  };
}

function parseProfileConfig(value: unknown): ProfileConfig | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { id, label, command, args, env } = value as Record<string, unknown>;

  const isText = (text: unknown) => typeof text === 'string' && text.trim() !== '';
  const isStringRecord = (record: unknown): record is Record<string, string> =>
    typeof record === 'object' &&
    record !== null &&
    !Array.isArray(record) &&
    Object.values(record).every((entry) => typeof entry === 'string');

  if (typeof id !== 'string' || !isText(id)) return undefined;
  if (label !== undefined && (typeof label !== 'string' || !isText(label))) return undefined;
  if (command !== undefined && (typeof command !== 'string' || !isText(command))) {
    return undefined;
  }
  if (args !== undefined && !(Array.isArray(args) && args.every((a) => typeof a === 'string'))) {
    return undefined;
  }
  if (env !== undefined && !isStringRecord(env)) return undefined;

  return { id, label, command, args, env };
}

/**
 * Launches a custom command as given. A built-in agent in it, e.g.
 * `/usr/local/bin/codex`, gets its logo, title format and status arguments.
 */
export function launchForCommand(
  command: string,
  args: string[],
  programStatus: boolean
): LaunchSpec {
  const name = path.basename(command).replace(/\.(exe|cmd)$/i, '');
  const agent = AGENT_IDS.find((id) => AGENTS[id].command === name);
  const statusArgs = agent && programStatus ? AGENTS[agent].statusArgs : [];
  return {
    label: agent ? AGENTS[agent].label : name,
    command,
    args: [...statusArgs, ...args],
    env: {},
    agent
  };
}

/**
 * Turns a terminal title (OSC 0/2) into a short tab label, or undefined when
 * it carries nothing beyond the program name or folder.
 *
 * - pi: `π - <session name> - <folder>`; only a named session gives a label.
 * - Claude Code: `<spinner or ✳> <summary of the conversation>`.
 * - Others: the title without leading status glyphs.
 */
export function labelFromTitle(title: string, launch: LaunchSpec): string | undefined {
  let label: string | undefined;
  if (launch.agent === 'pi') {
    label = /^π - (.+) - [^-]+$/.exec(title)?.[1];
  } else {
    label = title.replace(/^[^\p{L}\p{N}]+/u, '');
  }
  label = label?.trim();
  if (!label || label.toLowerCase() === launch.label.toLowerCase()) {
    return undefined;
  }
  return label.length > 80 ? `${label.slice(0, 79)}…` : label;
}
