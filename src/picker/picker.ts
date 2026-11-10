import * as vscode from 'vscode';
import { splitCommandLine } from '../profiles';
import type { CommandFlag, PathContext, PathSuggestion } from '../types';
import { HelpExecutor } from './help';
import { availableFlags, detectPathContext, insertFlag, insertPath, parseInput } from './input';
import { PathAutocompleteProvider } from './paths';

interface CommandQuickPickItem extends vscode.QuickPickItem {
  flag?: CommandFlag;
  isRunCommand?: boolean;
  pathSuggestion?: PathSuggestion;
}

export interface CommandInputResult {
  command: string;
  args: string[];
  cancelled: boolean;
}

/**
 * Custom Command: a quick pick for a command line that suggests the
 * command's flags from its `--help` and paths for flags that take one.
 */
export class CommandInputPicker {
  private readonly help = new HelpExecutor({
    debounceMs: 300,
    timeout: 5000,
    cacheMaxAge: 5 * 60 * 1000
  });
  private readonly paths = new PathAutocompleteProvider({ debounceMs: 100, maxResults: 15 });

  promptForCommand(defaultValue: string): Promise<CommandInputResult> {
    return new Promise((resolve) => {
      const quickPick = vscode.window.createQuickPick<CommandQuickPickItem>();
      quickPick.title = 'Enter Command with Arguments';
      quickPick.placeholder = 'Type command name, then select flags...';
      quickPick.value = defaultValue;
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;

      let disposed = false;
      let currentCommand = '';
      let flags: CommandFlag[] = [];
      let pathSuggestions: PathSuggestion[] = [];
      let pathContext: PathContext | null = null;

      const render = () => {
        const { existingArgs, partial } = parseInput(quickPick.value);
        quickPick.items = buildItems(
          quickPick.value.trim(),
          availableFlags(flags, partial, existingArgs),
          flags.length > 0,
          pathContext?.active ? pathSuggestions : [],
          pathContext?.active === true
        );
      };

      const loadHelp = (command: string, load: (done: (flags: CommandFlag[]) => void) => void) => {
        currentCommand = command;
        quickPick.busy = true;
        load((loaded) => {
          if (disposed) return;
          flags = loaded;
          pathContext = detectPathContext(quickPick.value, flags);
          render();
          quickPick.busy = false;
        });
      };

      quickPick.onDidChangeValue((value) => {
        const { command } = parseInput(value);
        pathContext = detectPathContext(value, flags);

        if (pathContext?.active) {
          const { partialPath, filterMode, isAbsolute } = pathContext;
          this.paths.getDebouncedSuggestions(partialPath, filterMode, isAbsolute, (found) => {
            if (disposed) return;
            pathSuggestions = found;
            render();
          });
        } else {
          pathSuggestions = [];
        }

        if (command && command !== currentCommand) {
          loadHelp(command, (done) => {
            this.help.getDebouncedHelp(command, (result) => done(result.flags));
          });
        } else if (command === currentCommand) {
          render();
        }
      });

      quickPick.onDidAccept(() => {
        const [selected] = quickPick.selectedItems;
        if (!selected || selected.isRunCommand) {
          // Quotes group words, as in a profile's command line
          const words = splitCommandLine(quickPick.value);
          // An unclosed quote: the Run item says so
          if (!words) return;
          resolve({ command: words[0] ?? '', args: words.slice(1), cancelled: false });
          quickPick.dispose();
          return;
        }
        if (selected.pathSuggestion) {
          if (pathContext?.active) {
            const { path, isDirectory } = selected.pathSuggestion;
            quickPick.value = insertPath(quickPick.value, pathContext, path, isDirectory);
          }
          return;
        }
        if (selected.flag) {
          // The picker stays open for more flags
          quickPick.value = insertFlag(quickPick.value, selected.flag.flag);
        }
      });

      quickPick.onDidHide(() => {
        disposed = true;
        resolve({ command: '', args: [], cancelled: true });
        quickPick.dispose();
      });

      const { command } = parseInput(defaultValue);
      if (command) {
        loadHelp(command, (done) => {
          void this.help.getHelp(command).then((result) => done(result.flags));
        });
      }

      quickPick.show();
    });
  }

  dispose(): void {
    this.help.dispose();
    this.paths.dispose();
  }
}

/**
 * Run, then path suggestions while a path is typed, then the matching flags.
 * `alwaysShow` bypasses the quick pick's own filtering.
 */
function buildItems(
  value: string,
  flags: CommandFlag[],
  hasHelp: boolean,
  paths: PathSuggestion[],
  pathActive: boolean
): CommandQuickPickItem[] {
  const items: CommandQuickPickItem[] = [];
  if (value && !splitCommandLine(value)) {
    items.push({
      label: '$(warning) Close the quote to run this command',
      alwaysShow: true
    });
  } else if (value) {
    items.push({
      label: `$(play) Run: ${value}`,
      description: 'Press Enter to execute this command',
      isRunCommand: true,
      alwaysShow: true
    });
  }

  if (paths.length > 0) {
    items.push({
      label: '$(folder) Path suggestions',
      kind: vscode.QuickPickItemKind.Separator,
      alwaysShow: true
    });
    for (const suggestion of paths) {
      items.push({
        label: `${suggestion.isDirectory ? '$(folder)' : '$(file)'} ${suggestion.name}`,
        description: suggestion.path,
        detail: suggestion.isDirectory ? 'Directory' : 'File',
        pathSuggestion: suggestion,
        alwaysShow: true
      });
    }
    if (hasHelp) {
      items.push({
        label: '$(symbol-property) Available flags',
        kind: vscode.QuickPickItemKind.Separator,
        alwaysShow: true
      });
    }
  }

  for (const flag of flags) {
    const label = flag.shortFlag ? `${flag.shortFlag}, ${flag.flag}` : flag.flag;
    items.push({
      label: label + (flag.valueHint ? ` ${flag.valueHint}` : ''),
      description: flag.description,
      detail: flag.takesValue ? '(requires value)' : undefined,
      flag,
      alwaysShow: true
    });
  }

  if (!hasHelp && value && !pathActive) {
    items.push({
      label: '$(info) No flag suggestions available',
      description: 'Type your command and press Enter to run',
      alwaysShow: true
    });
  }
  return items;
}
