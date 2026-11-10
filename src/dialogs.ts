import * as vscode from 'vscode';
import { migrateProfiles, missingCommand } from './profiles';
import type { AgentId, LaunchSpec } from './types';

/** Agents whose logo has brand colors; the others are drawn in the text color */
const BRAND_COLORED = new Set<AgentId>(['claude', 'antigravity', 'gemini', 'pi', 'devin']);

export type ProfileChoice = { profile: LaunchSpec } | 'custom' | 'manage' | undefined;

/**
 * Use Profile…: the profiles in their configured order with their logos and
 * Custom Command, then Manage Profiles. VS Code's native view menus
 * cannot follow a setting's order or list user-defined profiles.
 */
export async function pickProfile(
  profiles: LaunchSpec[],
  monochrome: boolean,
  searchPath: (profile: LaunchSpec) => string,
  extensionUri: vscode.Uri
): Promise<ProfileChoice> {
  type Item = vscode.QuickPickItem & { choice?: ProfileChoice };
  const items: Item[] = [
    ...profiles.map((profile, index) => ({
      label: profile.label,
      description: [
        profile.commandLine,
        index === 0 ? '(default)' : undefined,
        missingCommand(profile, searchPath(profile)) ? '· not installed' : undefined
      ]
        .filter(Boolean)
        .join(' '),
      iconPath: profileIcon(profile, monochrome, extensionUri),
      choice: { profile }
    })),
    { label: 'Custom Command', iconPath: new vscode.ThemeIcon('terminal'), choice: 'custom' },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: 'Manage Profiles', choice: 'manage' }
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Open a new tab with',
    matchOnDescription: true
  });
  return picked?.choice;
}

/**
 * The agent's logo; in its brand colors unless `agentTabs.monochromeIcons`
 * is set. Logos without brand colors follow the theme.
 */
function profileIcon(
  profile: LaunchSpec,
  monochrome: boolean,
  extensionUri: vscode.Uri
): vscode.IconPath {
  if (!profile.agent) {
    return new vscode.ThemeIcon('sparkle-filled');
  }
  const icon = (name: string) => vscode.Uri.joinPath(extensionUri, 'media', 'icons', `${name}.png`);
  if (!monochrome && BRAND_COLORED.has(profile.agent)) {
    return icon(profile.agent);
  }
  return { light: icon(`${profile.agent}-light`), dark: icon(`${profile.agent}-dark`) };
}

/**
 * Opens `agentTabs.profiles` in the Settings editor. Without own
 * profiles, the ones in use are written first, so there is something to
 * edit.
 */
export async function manageProfiles(profiles: LaunchSpec[]): Promise<void> {
  const config = vscode.workspace.getConfiguration('agentTabs');
  const inspected = config.inspect<unknown[]>('profiles');
  const isSet = [
    inspected?.globalValue,
    inspected?.workspaceValue,
    inspected?.workspaceFolderValue
  ].some((value) => Array.isArray(value) && value.length > 0);
  if (!isSet) {
    await config.update(
      'profiles',
      profiles.map((profile) => ({ name: profile.label, command: profile.commandLine })),
      vscode.ConfigurationTarget.Global
    );
  }
  await vscode.commands.executeCommand('workbench.action.openSettings', 'agentTabs.profiles');
}

/**
 * Rewrites `agentTabs.profiles` from the table of 2.0 into the list, in the
 * user and workspace settings that still have a table. Profiles written as a
 * table keep working until then.
 */
export async function migrateProfileSettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration('agentTabs');
  const inspected = config.inspect('profiles');
  const targets: Array<[unknown, vscode.ConfigurationTarget]> = [
    [inspected?.globalValue, vscode.ConfigurationTarget.Global],
    [inspected?.workspaceValue, vscode.ConfigurationTarget.Workspace]
  ];
  for (const [value, target] of targets) {
    const list = migrateProfiles(value);
    if (list) {
      try {
        await config.update('profiles', list, target);
      } catch {
        // A read-only settings file keeps the table, which is still read
      }
    }
  }
}

export interface TabEntry {
  id: string;
  label: string;
  description?: string;
  detail?: string;
}

/** Quick pick over the open tabs with their status; returns the picked tab's id */
export async function pickTab(entries: TabEntry[]): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(entries, {
    placeHolder: 'Switch to terminal tab'
  });
  return picked?.id;
}

export interface BusyTab {
  /** The tab's name */
  label: string;
  /** The profile's name, e.g. `Claude Code` */
  agent: string;
  working: boolean;
}

/**
 * Asks before closing tabs whose agent is working or waiting for an answer.
 * "Don't Ask Again" turns off `agentTabs.confirmClose`.
 */
export async function confirmClose(busy: BusyTab[]): Promise<boolean> {
  const [first] = busy;
  const single = busy.length === 1 && first;
  const message = single
    ? `Close "${first.label}"?`
    : `Close ${String(busy.length)} tabs with running agents?`;
  const detail = single
    ? `${first.agent} is ${first.working ? 'still working' : 'waiting for your input'}. Closing the tab ends its session.`
    : 'Their agents are working or waiting for input. Closing the tabs ends their sessions.';
  const close = busy.length === 1 ? 'Close' : 'Close All';
  const dontAsk = "Close and Don't Ask Again";

  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true, detail },
    close,
    dontAsk
  );
  if (choice === dontAsk) {
    await vscode.workspace
      .getConfiguration('agentTabs')
      .update('confirmClose', false, vscode.ConfigurationTarget.Global);
  }
  return choice !== undefined;
}
