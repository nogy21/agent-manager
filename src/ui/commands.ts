import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { bold, dim } from '../colors.js';
import type { Context } from '../context.js';
import { CliError } from '../errors.js';
import { runAction } from '../run.js';
import { createUiServer } from './server.js';

/** Parse and validate a --port value (1..65535). */
function parsePort(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || String(n) !== value.trim() || n < 1 || n > 65535) {
    throw new CliError(`invalid --port: ${value} (expected an integer 1-65535)`);
  }
  return n;
}

/** Best-effort open in the default browser; failures are ignored silently. */
function openBrowser(url: string): void {
  const platform = process.platform;
  const bin = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(bin, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      /* no launcher available — ignore */
    });
    child.unref();
  } catch {
    /* ignore */
  }
}

export function buildUiCommand(getCtx: () => Context): Command {
  return new Command('ui')
    .description('Open the agman web dashboard (localhost)')
    .option('--port <n>', 'port to bind on 127.0.0.1 (default 4400)', parsePort)
    .option('--no-open', 'do not open the browser automatically')
    .action(
      runAction(async (opts: { port?: number; open?: boolean }) => {
        const ctx = getCtx();
        const ui = await createUiServer(ctx, { port: opts.port });
        console.log(bold(ui.url));
        console.log(dim('press Ctrl+C to stop'));
        if (opts.open !== false) {
          openBrowser(ui.url);
        }
        // The listening server keeps the event loop alive; the action resolves but
        // the process stays up until Ctrl+C.
      }),
    );
}
