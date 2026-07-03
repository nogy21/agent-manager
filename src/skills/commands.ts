import path from 'node:path';
import { Command } from 'commander';
import { bold, cyan, dim, green, yellow } from '../colors.js';
import type { Context, Scope } from '../context.js';
import { CliError } from '../errors.js';
import { openInEditor } from '../editor.js';
import { runAction } from '../run.js';
import { renderTable } from '../table.js';
import {
  copySkill,
  createSkill,
  findSkill,
  listSkills,
  readSkill,
  removeSkill,
  skillsDir,
} from './core.js';

const DESC_WIDTH = 60;

/** Resolve an explicit scope from --global/--local, rejecting both at once. */
function scopeFromFlags(opts: { global?: boolean; local?: boolean }): Scope | undefined {
  if (opts.global && opts.local) {
    throw new CliError('--global and --local are mutually exclusive');
  }
  if (opts.global) return 'global';
  if (opts.local) return 'local';
  return undefined;
}

function truncateDescription(s: string): string {
  return s.length > DESC_WIDTH ? s.slice(0, DESC_WIDTH) + '…' : s;
}

export function buildSkillsCommand(getCtx: () => Context): Command {
  const cmd = new Command('skills').description('Manage skills (global & project scope)');

  cmd
    .command('list')
    .description('List skills across global and project scope')
    .option('--global', 'only global skills')
    .option('--local', 'only project skills')
    .option('--json', 'output machine-readable JSON')
    .action(
      runAction((opts: { global?: boolean; local?: boolean; json?: boolean }) => {
        const ctx = getCtx();
        const scope = scopeFromFlags(opts);
        const list = listSkills(ctx, scope);

        if (opts.json) {
          console.log(JSON.stringify(list, null, 2));
          return;
        }

        if (list.length === 0) {
          console.log(dim('no skills found'));
          console.log(dim(`  global: ${skillsDir(ctx, 'global')}`));
          console.log(dim(`  local:  ${skillsDir(ctx, 'local')}`));
          return;
        }

        const rows = list.map((s) => {
          const nameCell = s.name + (s.shadowed ? ' ' + yellow('(shadowed)') : '');
          const scopeCell = s.scope === 'local' ? cyan('local') : dim('global');
          const descCell = !s.hasSkillMd
            ? dim('(no SKILL.md)')
            : truncateDescription(s.description);
          return [nameCell, scopeCell, descCell];
        });
        console.log(renderTable(rows, { header: ['NAME', 'SCOPE', 'DESCRIPTION'] }));
      }),
    );

  cmd
    .command('show <name>')
    .description("Print a skill's SKILL.md")
    .option('--global', 'look in global scope')
    .option('--local', 'look in project scope')
    .action(
      runAction((name: string, opts: { global?: boolean; local?: boolean }) => {
        const ctx = getCtx();
        const scope = scopeFromFlags(opts);
        const { info, content } = readSkill(ctx, name, scope);
        console.log(bold(info.name));
        console.log(dim(path.join(info.path, 'SKILL.md')));
        console.log('');
        console.log(content);
      }),
    );

  cmd
    .command('create <name>')
    .description('Create a new skill from a template')
    .option('--global', 'create in global scope (default: project)')
    .option('-d, --description <text>', 'one-line description of the skill')
    .action(
      runAction((name: string, opts: { global?: boolean; description?: string }) => {
        const ctx = getCtx();
        const scope: Scope = opts.global ? 'global' : 'local';
        const info = createSkill(ctx, name, { scope, description: opts.description });
        console.log(green('created') + ' ' + path.join(info.path, 'SKILL.md'));
        const globalFlag = opts.global ? ' --global' : '';
        console.log(dim(`edit it with: agman skills edit ${name}${globalFlag}`));
      }),
    );

  cmd
    .command('edit <name>')
    .description("Open a skill's SKILL.md in $EDITOR")
    .option('--global', 'look in global scope')
    .option('--local', 'look in project scope')
    .action(
      runAction((name: string, opts: { global?: boolean; local?: boolean }) => {
        const ctx = getCtx();
        const scope = scopeFromFlags(opts);
        const info = findSkill(ctx, name, scope);
        if (!info) {
          throw new CliError(`skill not found: ${name}${scope ? ` in ${scope} scope` : ''}`);
        }
        if (!info.hasSkillMd) {
          throw new CliError(
            `skill directory exists but has no SKILL.md: ${info.path} ` +
              `(create one with: agman skills create ${name})`,
          );
        }
        openInEditor(path.join(info.path, 'SKILL.md'));
      }),
    );

  cmd
    .command('rm <name>')
    .description('Remove a skill directory')
    .option('--global', 'look in global scope')
    .option('--local', 'look in project scope')
    .option('-f, --force', 'actually remove the skill (required)')
    .action(
      runAction((name: string, opts: { global?: boolean; local?: boolean; force?: boolean }) => {
        const ctx = getCtx();
        const scope = scopeFromFlags(opts);
        const info = findSkill(ctx, name, scope);
        if (!info) {
          throw new CliError(`skill not found: ${name}${scope ? ` in ${scope} scope` : ''}`);
        }
        if (!opts.force) {
          throw new CliError(`refusing to remove ${info.path} (re-run with --force)`);
        }
        const removed = removeSkill(ctx, name, scope);
        console.log(green('removed') + ' ' + removed.path);
      }),
    );

  cmd
    .command('copy <name>')
    .description('Copy a skill between global and project scope')
    .requiredOption('--to <scope>', 'destination scope: global or local')
    .option('-f, --force', 'overwrite an existing destination skill')
    .action(
      runAction((name: string, opts: { to: string; force?: boolean }) => {
        const ctx = getCtx();
        if (opts.to !== 'global' && opts.to !== 'local') {
          throw new CliError(`invalid --to value: ${opts.to} (expected "global" or "local")`);
        }
        const to: Scope = opts.to;
        const from: Scope = to === 'global' ? 'local' : 'global';
        const info = copySkill(ctx, name, to, { force: opts.force });
        console.log(green('copied') + ` ${name}: ${from} → ${to}`);
        console.log(dim(info.path));
      }),
    );

  return cmd;
}
