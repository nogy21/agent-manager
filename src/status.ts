import { Command } from 'commander';
import type { Context } from './context.js';

// Placeholder scaffold — a later phase rewrites this file entirely.
export function buildStatusCommand(getCtx: () => Context): Command {
  const cmd = new Command('status').description('Overview of skills and memory docs');
  cmd.action(() => {
    console.error('status: not implemented yet');
    process.exitCode = 1;
  });
  return cmd;
}
