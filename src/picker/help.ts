import { type ChildProcess, spawn } from 'node:child_process';
import { isInstalled } from '../profiles';
import type { ParsedHelp } from '../types';
import { CommandHelpParser } from './parser';

export interface HelpExecutorOptions {
  timeout?: number;
  debounceMs?: number;
  cacheMaxAge?: number;
  cacheMaxSize?: number;
}

interface CacheEntry {
  result: ParsedHelp;
  timestamp: number;
}

export class HelpExecutor {
  private cache = new Map<string, CacheEntry>();
  private pendingRequests = new Map<string, Promise<ParsedHelp>>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private parser = new CommandHelpParser();
  private options: Required<HelpExecutorOptions>;

  constructor(
    options: HelpExecutorOptions = {},
    private readonly spawnHelp: typeof spawn = spawn,
    private readonly isInstalled: (command: string) => boolean = (command) => isInstalled(command)
  ) {
    this.options = {
      timeout: options.timeout ?? 5000,
      debounceMs: options.debounceMs ?? 300,
      cacheMaxAge: options.cacheMaxAge ?? 5 * 60 * 1000, // 5 minutes
      cacheMaxSize: options.cacheMaxSize ?? 50
    };
  }

  async getHelp(command: string): Promise<ParsedHelp> {
    // Check cache first
    const cached = this.cache.get(command);
    if (cached && Date.now() - cached.timestamp < this.options.cacheMaxAge) {
      return cached.result;
    }

    // Check if request already pending
    const pending = this.pendingRequests.get(command);
    if (pending) {
      return pending;
    }

    // Execute with timeout
    const promise = this.executeHelp(command);
    this.pendingRequests.set(command, promise);

    try {
      const result = await promise;
      this.updateCache(command, result);
      return result;
    } finally {
      this.pendingRequests.delete(command);
    }
  }

  getDebouncedHelp(command: string, callback: (result: ParsedHelp) => void): void {
    // Clear existing timer for this command
    const existingTimer = this.debounceTimers.get(command);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(command);
      this.getHelp(command)
        .then((result) => {
          callback(result);
        })
        .catch(() => {
          callback({ command, flags: [], parseErrors: ['Failed to get help'] });
        });
    }, this.options.debounceMs);

    this.debounceTimers.set(command, timer);
  }

  /**
   * Runs `<command> --help` without a shell, so the input is never read
   * as shell code, and only for a program found on the PATH. Other help
   * conventions, e.g. `-h` or `help`, are not tried: they mean something
   * else for some programs, e.g. `shutdown -h`. The run counts once: when
   * it closes, fails or times out.
   */
  private executeHelp(command: string): Promise<ParsedHelp> {
    const unsupported = (reason: string): ParsedHelp => ({
      command,
      flags: [],
      parseErrors: [reason]
    });
    if (!this.isInstalled(command)) {
      return Promise.resolve(unsupported('Command not found'));
    }
    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      let proc: ChildProcess | undefined;
      const settle = (result: ParsedHelp) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(result);
      };
      const timeoutId = setTimeout(() => {
        proc?.kill();
        settle(unsupported('Help timed out'));
      }, this.options.timeout);

      try {
        proc = this.spawnHelp(command, ['--help'], {
          env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch {
        settle(unsupported('Command could not start'));
        return;
      }
      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      proc.on('error', () => settle(unsupported('Command could not start')));
      proc.on('close', () => {
        // Some commands write help to stderr, some exit with non-zero
        const output = stdout || stderr;
        settle(
          output.length > 50
            ? this.parser.parse(command, output)
            : unsupported('Command does not support --help')
        );
      });
    });
  }

  private updateCache(command: string, result: ParsedHelp): void {
    // Enforce cache size limit (LRU eviction)
    if (this.cache.size >= this.options.cacheMaxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(command, { result, timestamp: Date.now() });
  }

  clearCache(): void {
    this.cache.clear();
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.cache.clear();
  }
}
