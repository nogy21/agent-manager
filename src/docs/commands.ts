import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { bold, cyan, dim, green, red, yellow } from '../colors.js';
import type { Context, Scope } from '../context.js';
import { openInEditor } from '../editor.js';
import { CliError } from '../errors.js';
import { runAction } from '../run.js';
import { renderTable } from '../table.js';
import {
  compareDocs,
  initDoc,
  linkDocs,
  listDocs,
  readDoc,
  statDoc,
  syncDocs,
  type DocInfo,
  type DocTarget,
} from './core.js';

function parseTarget(value: string): DocTarget {
  if (value === 'claude' || value === 'agents' || value === 'local') {
    return value;
  }
  throw new CliError(`unknown target "${value}" (expected: claude, agents, local)`);
}

function scopeOf(opts: { global?: boolean }): Scope {
  return opts.global ? 'global' : 'local';
}

function parseSource(value: string): 'claude' | 'agents' {
  if (value === 'claude' || value === 'agents') {
    return value;
  }
  throw new CliError(`unknown source "${value}" (expected: claude, agents)`);
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatMtime(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// FILE column drops the ' (global)' suffix — the SCOPE column carries the scope.
export function fileCell(info: DocInfo): string {
  return info.label.replace(/ \(global\)$/, '');
}

export function scopeCell(info: DocInfo): string {
  return info.scope === 'global' ? dim('global') : cyan('local');
}

export function statusCell(info: DocInfo): string {
  if (info.isSymlink) {
    const target = info.symlinkTarget ?? '?';
    return info.exists ? cyan(`symlink → ${target}`) : yellow(`broken → ${target}`);
  }
  return info.exists ? green('ok') : dim('missing');
}

export function buildDocsCommand(getCtx: () => Context): Command {
  const docs = new Command('docs').description('Manage CLAUDE.md / AGENTS.md memory files');

  docs
    .command('list')
    .description('List CLAUDE.md / AGENTS.md docs across scopes')
    .option('--json', 'print raw JSON instead of a table')
    .action(
      runAction((opts: { json?: boolean }) => {
        const infos = listDocs(getCtx());
        if (opts.json) {
          const data = infos.map((i) => ({
            ...i,
            mtime: i.mtime ? i.mtime.toISOString() : null,
          }));
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        const rows = infos.map((info) => [
          fileCell(info),
          scopeCell(info),
          statusCell(info),
          info.size !== undefined ? humanSize(info.size) : '',
          info.lines !== undefined ? String(info.lines) : '',
          info.mtime ? formatMtime(info.mtime) : '',
        ]);
        console.log(
          renderTable(rows, {
            header: ['FILE', 'SCOPE', 'STATUS', 'SIZE', 'LINES', 'MODIFIED'],
          }),
        );
      }),
    );

  docs
    .command('show <target>')
    .description('Print a doc\'s label, path, and contents')
    .option('--global', 'target the global scope')
    .action(
      runAction((target: string, opts: { global?: boolean }) => {
        const { info, content } = readDoc(getCtx(), parseTarget(target), scopeOf(opts));
        console.log(bold(info.label));
        console.log(dim(info.path));
        console.log('');
        process.stdout.write(content.endsWith('\n') ? content : `${content}\n`);
      }),
    );

  docs
    .command('init <target>')
    .description('Create a doc from a starter template')
    .option('--global', 'target the global scope')
    .option('-f, --force', 'overwrite an existing file')
    .action(
      runAction((target: string, opts: { global?: boolean; force?: boolean }) => {
        const ctx = getCtx();
        const t = parseTarget(target);
        const scope = scopeOf(opts);
        // Detect an existing file before writing so we can report the right verb.
        const before = statDoc(ctx, t, scope);
        const info = initDoc(ctx, t, scope, { force: opts.force });
        console.log(`${green(before.exists ? 'overwrote' : 'created')} ${info.path}`);
      }),
    );

  docs
    .command('edit <target>')
    .description('Open a doc in $EDITOR')
    .option('--global', 'target the global scope')
    .action(
      runAction((target: string, opts: { global?: boolean }) => {
        const t = parseTarget(target);
        const info = statDoc(getCtx(), t, scopeOf(opts));
        if (!info.exists) {
          throw new CliError(`not found: ${info.path} (create it with "agman docs init ${t}")`);
        }
        openInEditor(info.path);
      }),
    );

  docs
    .command('diff')
    .description('Diff the project CLAUDE.md against AGENTS.md')
    .action(
      runAction(() => {
        const { a, b, same } = compareDocs(getCtx());
        if (same) {
          console.log(green('CLAUDE.md and AGENTS.md are identical'));
          return;
        }
        const result = spawnSync('git', ['diff', '--no-index', '--', a.path, b.path], {
          stdio: 'inherit',
        });
        if (result.error) {
          // git is unavailable — fall back to a naive, set-based line diff.
          console.log(dim('(git not found; simple line diff)'));
          const aLines = readFileSync(a.path, 'utf8').split('\n');
          const bLines = readFileSync(b.path, 'utf8').split('\n');
          const aSet = new Set(aLines);
          const bSet = new Set(bLines);
          for (const line of aSet) {
            if (!bSet.has(line)) console.log(red(`- ${line}`));
          }
          for (const line of bSet) {
            if (!aSet.has(line)) console.log(green(`+ ${line}`));
          }
          process.exitCode = 1;
          return;
        }
        // git exits 1 when the files differ; that is expected here (diff convention).
        process.exitCode = 1;
      }),
    );

  docs
    .command('link')
    .description('Symlink one project doc to the other (AGENTS.md and CLAUDE.md)')
    .option('--source <claude|agents>', 'file to keep as the real source of truth', 'claude')
    .option('-f, --force', 'replace an existing regular file')
    .action(
      runAction((opts: { source: string; force?: boolean }) => {
        const source = parseSource(opts.source);
        const { linkPath, targetPath } = linkDocs(getCtx(), { source, force: opts.force });
        console.log(`${green('linked')} ${path.basename(linkPath)} → ${path.basename(targetPath)}`);
      }),
    );

  docs
    .command('sync')
    .description('Copy one project doc\'s contents over the other')
    .requiredOption('--source <claude|agents>', 'file to copy contents from')
    .action(
      runAction((opts: { source: string }) => {
        const source = parseSource(opts.source);
        const { fromPath, toPath, changed } = syncDocs(getCtx(), { source });
        if (changed) {
          console.log(`${green('synced')} ${path.basename(fromPath)} → ${path.basename(toPath)}`);
        } else {
          console.log(dim('already in sync'));
        }
      }),
    );

  return docs;
}
