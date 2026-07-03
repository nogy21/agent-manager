import { Command } from 'commander';
import type { Context } from '../context.js';

// Placeholder scaffold — a later phase rewrites this file entirely.
export function buildDocsCommand(getCtx: () => Context): Command {
  const cmd = new Command('docs').description('Manage CLAUDE.md / AGENTS.md memory files');
  cmd
    .command('list')
    .description('List docs')
    .action(() => {
      console.error('docs: not implemented yet');
      process.exitCode = 1;
    });
  return cmd;
}
