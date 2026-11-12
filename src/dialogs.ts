import * as vscode from 'vscode';
import { discoverAgents, missingCommand, type ProfileSetting } from './profiles';
import type { CloseRisk } from './terminal/state';
import type { AgentId, LaunchSpec } from './types';

/** Agents whose logo has brand colors; the others are drawn in the text color */
const BRAND_COLORED = new Set<AgentId>(['claude', 'antigravity', 'gemini', 'pi', 'devin']);

export type ProfileChoice = { profile: LaunchSpec } | 'custom' | 'manage' | 'discover' | undefined;

/**
 * Use Profile…: the profiles in their configured order with their logos,
 * then Custom Command…, then Discover Profiles and Manage Profiles…. VS
 * Code's native view menus cannot follow a setting's order or list
 * user-defined profiles.
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
    { label: 'Custom Command…', iconPath: new vscode.ThemeIcon('edit'), choice: 'custom' },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    // Manage Profiles… last: ↑ from the first item lands on it, and it
    // changes nothing, unlike Discover Profiles
    { label: 'Discover Profiles', choice: 'discover' },
    { label: 'Manage Profiles…', choice: 'manage' }
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
  const { icon } = profile;
  if (icon === 'terminal') return new vscode.ThemeIcon('terminal');
  if (icon === 'sparkle') return new vscode.ThemeIcon('sparkle-filled');
  const file = (name: string) => vscode.Uri.joinPath(extensionUri, 'media', 'icons', `${name}.png`);
  if (!monochrome && BRAND_COLORED.has(icon)) {
    return file(icon);
  }
  return { light: file(`${icon}-light`), dark: file(`${icon}-dark`) };
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

/** Global state key: the user turned off the warning before Discover Profiles */
const DISCOVER_WARNING_KEY = 'agentTabs.discoverProfiles.skipWarning';

/**
 * Discover Profiles: appends a profile to `agentTabs.profiles` for each known
 * agent installed on this machine that has none yet. It changes the setting,
 * so it warns first, until the user chooses not to be warned again. Without
 * own profiles, the installed ones in use are written first, so the new
 * ones follow them. `searchPath` is the PATH the tabs get.
 */
export async function discoverProfiles(
  profiles: LaunchSpec[],
  searchPath: (profile?: LaunchSpec) => string,
  globalState: vscode.Memento
): Promise<void> {
  if (!globalState.get<boolean>(DISCOVER_WARNING_KEY, false)) {
    const discover = 'Discover';
    const dontShow = "Discover and Don't Show Again";
    const choice = await vscode.window.showWarningMessage(
      'Discover profiles?',
      {
        modal: true,
        detail:
          'Agent Tabs looks for installed coding agents that have no profile yet and adds a profile for each to the end of agentTabs.profiles. This changes your settings.'
      },
      discover,
      dontShow
    );
    if (choice === undefined) return;
    if (choice === dontShow) await globalState.update(DISCOVER_WARNING_KEY, true);
  }

  const config = vscode.workspace.getConfiguration('agentTabs');
  const inspected = config.inspect<unknown>('profiles');
  const own = (value: unknown): value is unknown[] => Array.isArray(value) && value.length > 0;
  // Where the profiles in use come from; the setting has no folder scope
  const inWorkspace = own(inspected?.workspaceValue);
  const setting = inWorkspace ? inspected?.workspaceValue : inspected?.globalValue;
  // Without own profiles, the ones made for the installed agents and the
  // Terminal profile are kept; those for agents that are not installed are not
  const existing = own(setting)
    ? profiles
    : profiles.filter((profile) => !missingCommand(profile, searchPath(profile)));

  const found = discoverAgents(existing, searchPath());
  if (found.length === 0) {
    void vscode.window.showInformationMessage(
      'Agent Tabs: found no installed agents without a profile.'
    );
    return;
  }
  const current = own(setting)
    ? setting
    : existing.map(
        (profile): ProfileSetting => ({
          name: profile.label,
          command: profile.commandLine
        })
      );
  await config.update(
    'profiles',
    [...current, ...found],
    inWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
  );
  const names = found.map((profile) => profile.name).join(', ');
  const manage = 'Manage Profiles…';
  const choice = await vscode.window.showInformationMessage(
    `Agent Tabs: added ${found.length === 1 ? 'a profile' : `${String(found.length)} profiles`}: ${names}.`,
    manage
  );
  if (choice === manage) {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'agentTabs.profiles');
  }
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
  session: 'still runs in a detached session'
};

/**
 * Asks before closing tabs whose agent is working or waiting for an answer,
 * or whose detached session still runs. The title says why for one tab, and
 * the detail lists each tab with its reason for several.
 * "Don't Ask Again" closes them and turns off `agentTabs.confirmClose`.
 */
export async function confirmClose(busy: BusyTab[]): Promise<boolean> {
  const [first] = busy;
  const single = busy.length === 1 && first;
  const message = single
    ? `${first.agent} in "${first.label}" ${REASONS[first.reason]}`
    : `${String(busy.length)} tabs are still in use`;
  const detail = single
    ? 'Closing the tab ends its session.'
    : [
        ...busy.map((tab) => `"${tab.label}": ${tab.agent} ${REASONS[tab.reason]}`),
        '',
        'Closing the tabs ends their sessions.'
      ].join('\n');
  const close = single ? 'Close' : 'Close All';
  const dontAsk = "Don't Ask Again";

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
