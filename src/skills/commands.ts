import { Command } from 'commander';
import type { Context } from '../context.js';

// Placeholder scaffold — Phase 2 rewrites this file entirely.
export function buildSkillsCommand(getCtx: () => Context): Command {
  const cmd = new Command('skills').description('Manage skills (global & project scope)');
  cmd
    .command('list')
    .description('List skills')
    .action(() => {
      console.error('skills: not implemented yet');
      process.exitCode = 1;
    });
  return cmd;
}
