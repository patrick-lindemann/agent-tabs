import * as vscode from 'vscode';
import { missingCommand } from './profiles';
import type { CloseRisk } from './terminal/state';
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
  defaultProfile: LaunchSpec,
  monochrome: boolean,
  searchPath: (profile: LaunchSpec) => string,
  extensionUri: vscode.Uri
): Promise<ProfileChoice> {
  type Item = vscode.QuickPickItem & { choice?: ProfileChoice };
  const items: Item[] = [
    ...profiles.map((profile) => ({
      label: profile.label,
      description: [
        profile.commandLine,
        profile === defaultProfile ? '(default)' : undefined,
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

export interface TabEntry {
  id: string;
  label: string;
  description?: string;
  detail?: string;
}

/**
 * Quick pick over the open tabs with their status, most recently used first,
 * like Ctrl+Tab in the editor; returns the picked tab's id. `active` is the
 * entry selected at first: 1, the previously used tab, or -1, the least
 * recently used.
 */
export function pickTab(entries: TabEntry[], active: 1 | -1 = 1): Promise<string | undefined> {
  const pick = vscode.window.createQuickPick<TabEntry>();
  pick.placeholder = 'Switch to terminal tab';
  pick.matchOnDescription = true;
  pick.matchOnDetail = true;
  pick.items = entries;
  const preselected = active === 1 ? entries[1] : entries[entries.length - 1];
  if (preselected) pick.activeItems = [preselected];
  return new Promise((resolve) => {
    pick.onDidAccept(() => {
      resolve(pick.selectedItems[0]?.id);
      pick.hide();
    });
    pick.onDidHide(() => {
      resolve(undefined);
      pick.dispose();
    });
    pick.show();
  });
}

export interface BusyTab {
  /** The tab's name */
  label: string;
  /** The profile's name, e.g. `Claude Code` */
  agent: string;
  /** Why closing would lose something */
  reason: CloseRisk;
}

const REASONS: Record<BusyTab['reason'], string> = {
  working: 'is still working',
  waiting: 'is waiting for your input',
  draft: 'has a message you have not sent',
  session: 'still runs in its detached session'
};

/**
 * Asks before closing tabs whose agent is working, waiting for an answer or
 * has unsent input.
 * "Don't Ask Again" turns off `agentTabs.confirmClose`.
 */
export async function confirmClose(busy: BusyTab[]): Promise<boolean> {
  const [first] = busy;
  const single = busy.length === 1 && first;
  const message = single ? `Close "${first.label}"?` : `Close ${String(busy.length)} tabs?`;
  const detail = single
    ? `${first.agent} ${REASONS[first.reason]}. Closing the tab ends its session.`
    : 'Their agents are working, waiting for input, have a message you have not sent or still run in a detached session. Closing the tabs ends their sessions.';
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
