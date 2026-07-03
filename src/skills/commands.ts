import path from 'node:path';
import { Command } from 'commander';
import { getAgent, locationByKey, type AgentId } from '../agents/registry.js';
import { bold, cyan, dim, green, red, yellow } from '../colors.js';
import type { Context, Scope } from '../context.js';
import { CliError } from '../errors.js';
import { openInEditor } from '../editor.js';
import { runAction } from '../run.js';
import { renderTable } from '../table.js';
import {
  copySkill,
  createSkill,
  findSkill,
  installSkill,
  listSkills,
  readSkill,
  removeSkill,
  setSkillEnabled,
  type SkillInfo,
} from './core.js';

const DESC_WIDTH = 60;
const PRIMARY_KEYS = ['claude', 'agents'];

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

function notFound(name: string, scope?: Scope): CliError {
  return new CliError(`skill not found: ${name}${scope ? ` in ${scope} scope` : ''}`);
}

function whereCell(s: SkillInfo): string {
  const base = s.scope === 'local' ? cyan(`${s.locationKey}:local`) : dim(`${s.locationKey}:global`);
  return base + (s.enabled ? '' : red(' (disabled)'));
}

function visibleCell(s: SkillInfo): string {
  return s.enabled ? dim(s.visibleTo.join(', ')) : dim('-');
}

function visibilityNote(info: SkillInfo): void {
  console.log(dim(`visible to: ${info.visibleTo.join(', ')}`));
}

export function buildSkillsCommand(getCtx: () => Context): Command {
  const cmd = new Command('skills').description('Manage skills across agents and scopes');

  cmd
    .command('list')
    .description('List skills across every agent skills location')
    .option('--global', 'only global skills')
    .option('--local', 'only project skills')
    .option('--agent <id>', 'only skills visible to <id>')
    .option('--enabled-only', 'hide disabled skills')
    .option('--json', 'output machine-readable JSON')
    .action(
      runAction(
        (opts: {
          global?: boolean;
          local?: boolean;
          agent?: string;
          enabledOnly?: boolean;
          json?: boolean;
        }) => {
          const ctx = getCtx();
          const scope = scopeFromFlags(opts);
          const agent: AgentId | undefined = opts.agent ? getAgent(opts.agent).id : undefined;
          const list = listSkills(ctx, { scope, agent, includeDisabled: !opts.enabledOnly });

          if (opts.json) {
            console.log(JSON.stringify(list, null, 2));
            return;
          }

          if (list.length === 0) {
            console.log(dim('no skills found'));
            const scopes: Scope[] = scope ? [scope] : ['local', 'global'];
            for (const key of PRIMARY_KEYS) {
              for (const s of scopes) {
                console.log(dim(`  ${key}:${s}  ${locationByKey(ctx, key, s).dir}`));
              }
            }
            return;
          }

          const rows = list.map((s) => {
            const nameCell = s.name + (s.shadowed ? ' ' + yellow('(shadowed)') : '');
            const descCell = !s.hasSkillMd
              ? dim('(no SKILL.md)')
              : truncateDescription(s.description);
            return [nameCell, whereCell(s), visibleCell(s), descCell];
          });
          console.log(
            renderTable(rows, { header: ['NAME', 'WHERE', 'VISIBLE TO', 'DESCRIPTION'] }),
          );
        },
      ),
    );

  cmd
    .command('show <name>')
    .description("Print a skill's SKILL.md")
    .option('--global', 'look in global scope')
    .option('--local', 'look in project scope')
    .option('--loc <key>', 'look only in a specific location key')
    .action(
      runAction((name: string, opts: { global?: boolean; local?: boolean; loc?: string }) => {
        const ctx = getCtx();
        const scope = scopeFromFlags(opts);
        const { info, content } = readSkill(ctx, name, { scope, locationKey: opts.loc });
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
    .option('--loc <key>', "location key (default: 'agents')")
    .action(
      runAction(
        (name: string, opts: { global?: boolean; description?: string; loc?: string }) => {
          const ctx = getCtx();
          const scope: Scope = opts.global ? 'global' : 'local';
          const key = opts.loc ?? 'agents';
          const info = createSkill(ctx, name, {
            location: key,
            scope,
            description: opts.description,
          });
          console.log(green('created') + ' ' + path.join(info.path, 'SKILL.md'));
          visibilityNote(info);
          // Nudge toward the complementary primary location so the skill is not
          // invisible to the agents the chosen location does not cover.
          if (!info.visibleTo.includes('claude-code')) {
            console.log(dim(`tip: agman skills copy ${name} --to claude`));
          } else {
            console.log(dim(`tip: agman skills copy ${name} --to agents`));
          }
        },
      ),
    );

  cmd
    .command('edit <name>')
    .description("Open a skill's SKILL.md in $EDITOR")
    .option('--global', 'look in global scope')
    .option('--local', 'look in project scope')
    .option('--loc <key>', 'look only in a specific location key')
    .action(
      runAction((name: string, opts: { global?: boolean; local?: boolean; loc?: string }) => {
        const ctx = getCtx();
        const scope = scopeFromFlags(opts);
        const info = findSkill(ctx, name, { scope, locationKey: opts.loc });
        if (!info) throw notFound(name, scope);
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
    .option('--loc <key>', 'look only in a specific location key')
    .option('-f, --force', 'actually remove the skill (required)')
    .action(
      runAction(
        (
          name: string,
          opts: { global?: boolean; local?: boolean; loc?: string; force?: boolean },
        ) => {
          const ctx = getCtx();
          const scope = scopeFromFlags(opts);
          const info = findSkill(ctx, name, { scope, locationKey: opts.loc });
          if (!info) throw notFound(name, scope);
          if (!opts.force) {
            throw new CliError(`refusing to remove ${info.path} (re-run with --force)`);
          }
          const removed = removeSkill(ctx, name, { scope, locationKey: opts.loc });
          console.log(green('removed') + ' ' + removed.path);
        },
      ),
    );

  cmd
    .command('copy <name>')
    .description('Copy a skill into another location')
    .requiredOption('--to <key>', 'destination location key (e.g. claude, agents)')
    .option('--global', 'copy into global scope (default: local)')
    .option('-f, --force', 'overwrite an existing destination skill')
    .action(
      runAction((name: string, opts: { to: string; global?: boolean; force?: boolean }) => {
        const ctx = getCtx();
        const scope: Scope = opts.global ? 'global' : 'local';
        const dest = locationByKey(ctx, opts.to, scope); // validates the key
        const info = copySkill(ctx, name, { locationKey: dest.key, scope }, { force: opts.force });
        console.log(green('copied') + ` ${name} → ${dest.key}:${scope}`);
        console.log(dim(info.path));
        visibilityNote(info);
      }),
    );

  cmd
    .command('install <path>')
    .description('Install a skill directory from the filesystem into a location')
    .requiredOption('--to <key>', 'destination location key (e.g. claude, agents)')
    .option('--global', 'install into global scope (default: local)')
    .option('-f, --force', 'overwrite an existing destination skill')
    .action(
      runAction((srcPath: string, opts: { to: string; global?: boolean; force?: boolean }) => {
        const ctx = getCtx();
        const scope: Scope = opts.global ? 'global' : 'local';
        const dest = locationByKey(ctx, opts.to, scope); // validates the key
        const info = installSkill(
          ctx,
          srcPath,
          { locationKey: dest.key, scope },
          { force: opts.force },
        );
        console.log(green('installed') + ` ${info.name} → ${dest.key}:${scope}`);
        console.log(dim(info.path));
        visibilityNote(info);
      }),
    );

  cmd
    .command('enable <name>')
    .description('Enable a disabled skill')
    .option('--global', 'look in global scope')
    .option('--local', 'look in project scope')
    .option('--loc <key>', 'look only in a specific location key')
    .action(
      runAction((name: string, opts: { global?: boolean; local?: boolean; loc?: string }) => {
        toggle(getCtx(), name, true, opts);
      }),
    );

  cmd
    .command('disable <name>')
    .description('Disable a skill (moves it aside so no agent sees it)')
    .option('--global', 'look in global scope')
    .option('--local', 'look in project scope')
    .option('--loc <key>', 'look only in a specific location key')
    .action(
      runAction((name: string, opts: { global?: boolean; local?: boolean; loc?: string }) => {
        toggle(getCtx(), name, false, opts);
      }),
    );

  return cmd;
}

/** Shared enable/disable command body. */
function toggle(
  ctx: Context,
  name: string,
  enabled: boolean,
  opts: { global?: boolean; local?: boolean; loc?: string },
): void {
  const scope = scopeFromFlags(opts);
  const matching = listSkills(ctx, { scope }).filter(
    (s) => s.name === name && (!opts.loc || s.locationKey === opts.loc),
  );
  if (matching.length === 0) throw notFound(name, scope);
  // A move only happens when some matching skill is in the opposite state.
  const willChange = matching.some((s) => s.enabled !== enabled);
  const info = setSkillEnabled(ctx, name, enabled, { scope, locationKey: opts.loc });
  const verb = enabled ? 'enabled' : 'disabled';
  if (willChange) {
    console.log(green(verb) + ' ' + info.path);
  } else {
    console.log(dim(`already ${verb}`) + ' ' + info.path);
  }
}
