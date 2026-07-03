#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { red } from './colors.js';
import { createContext, type Context } from './context.js';
import { buildDocsCommand } from './docs/commands.js';
import { buildSkillsCommand } from './skills/commands.js';
import { buildStatusCommand } from './status.js';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string; description: string };

const program = new Command();
program
  .name('agman')
  .description(pkg.description)
  .version(pkg.version)
  .option('-C, --cwd <dir>', 'run as if agman was started in <dir>');

let ctx: Context | undefined;
const getCtx = (): Context => (ctx ??= createContext({ cwd: program.opts().cwd }));

program.addCommand(buildSkillsCommand(getCtx));
program.addCommand(buildDocsCommand(getCtx));
program.addCommand(buildStatusCommand(getCtx));

program.parseAsync(process.argv).catch((err) => {
  console.error(red(`error: ${err?.message ?? err}`));
  process.exitCode = 1;
});
