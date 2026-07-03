import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { bold, cyan, dim, green, red, yellow } from '../colors.js';
import type { Context } from '../context.js';
import { openInEditor } from '../editor.js';
import { CliError } from '../errors.js';
import { runAction } from '../run.js';
import { renderTable } from '../table.js';
import {
  diffDocs,
  initDoc,
  linkDoc,
  listDocs,
  readDoc,
  statDoc,
  syncDocs,
  unlinkDoc,
  type DocInfo,
  type SyncResult,
} from './core.js';

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

export function fileCell(info: DocInfo): string {
  return info.label;
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

export function syncCell(info: DocInfo): string {
  switch (info.sync) {
    case 'hub':
      return bold('hub');
    case 'in-sync':
      return green('in sync');
    case 'diverged':
      return yellow('diverged');
    case 'linked':
      return cyan('linked');
    case 'missing':
    case 'n/a':
      return dim('-');
  }
}

const DOC_HEADER = ['FILE', 'SCOPE', 'STATUS', 'SYNC', 'SIZE', 'LINES', 'MODIFIED'];

export function docRow(info: DocInfo): string[] {
  return [
    fileCell(info),
    scopeCell(info),
    statusCell(info),
    syncCell(info),
    info.size !== undefined ? humanSize(info.size) : '',
    info.lines !== undefined ? String(info.lines) : '',
    info.mtime ? formatMtime(info.mtime) : '',
  ];
}

/** Render the shared docs table (used by both `docs list` and `status`). */
export function renderDocsTable(infos: DocInfo[]): string {
  return renderTable(infos.map(docRow), { header: DOC_HEADER });
}

function syncResultCell(r: SyncResult): string {
  switch (r.result) {
    case 'synced':
      return green('synced');
    case 'unchanged':
      return dim('unchanged');
    case 'linked':
      return cyan('linked, skipped');
    case 'skipped-missing-source':
      return yellow('skipped (source missing)');
  }
}

export function buildDocsCommand(getCtx: () => Context): Command {
  const docs = new Command('docs').description(
    'Manage AGENTS.md (hub) and per-agent instruction spokes',
  );

  docs
    .command('list')
    .description('List memory docs across agents and scopes')
    .option('--all', 'show every doc, including undetected global docs')
    .option('--json', 'print raw JSON instead of a table')
    .action(
      runAction((opts: { all?: boolean; json?: boolean }) => {
        const infos = listDocs(getCtx(), { all: opts.all });
        if (opts.json) {
          const data = infos.map((i) => ({ ...i, mtime: i.mtime ? i.mtime.toISOString() : null }));
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        console.log(renderDocsTable(infos));
      }),
    );

  docs
    .command('show <key>')
    .description("Print a doc's label, path, and contents")
    .action(
      runAction((key: string) => {
        const { info, content } = readDoc(getCtx(), key);
        console.log(bold(info.label));
        console.log(dim(info.path));
        console.log('');
        process.stdout.write(content.endsWith('\n') ? content : `${content}\n`);
      }),
    );

  docs
    .command('init <key>')
    .description('Create a doc from a starter template')
    .option('-f, --force', 'overwrite an existing file')
    .action(
      runAction((key: string, opts: { force?: boolean }) => {
        const ctx = getCtx();
        const before = statDoc(ctx, key); // validates the key and reports the right verb
        const info = initDoc(ctx, key, { force: opts.force });
        console.log(`${green(before.exists ? 'overwrote' : 'created')} ${info.path}`);
      }),
    );

  docs
    .command('edit <key>')
    .description('Open a doc in $EDITOR')
    .action(
      runAction((key: string) => {
        const info = statDoc(getCtx(), key);
        if (!info.exists) {
          throw new CliError(
            `not found: ${info.path} (create it with \`agman docs init ${info.key}\`)`,
          );
        }
        openInEditor(info.path);
      }),
    );

  docs
    .command('sync')
    .description('Copy the hub (AGENTS.md) out to its spoke files')
    .option('--from <key>', 'source doc to copy from (default: agents)')
    .option('--to <key...>', 'explicit target docs (default: detected/existing spokes)')
    .action(
      runAction((opts: { from?: string; to?: string[] }) => {
        const results = syncDocs(getCtx(), { from: opts.from, to: opts.to });
        if (results.length === 0) {
          console.log(dim('nothing to sync (no spoke targets)'));
          return;
        }
        for (const r of results) {
          console.log(`${syncResultCell(r)} ${r.path}`);
        }
        if (results.length > 1) {
          const counts = results.reduce<Record<string, number>>((acc, r) => {
            acc[r.result] = (acc[r.result] ?? 0) + 1;
            return acc;
          }, {});
          const parts = Object.entries(counts).map(([k, n]) => `${n} ${k}`);
          console.log(dim(`${results.length} targets: ${parts.join(', ')}`));
        }
      }),
    );

  docs
    .command('link <key>')
    .description('Symlink a spoke doc to the hub AGENTS.md')
    .option('-f, --force', 'replace an existing regular file')
    .action(
      runAction((key: string, opts: { force?: boolean }) => {
        const { linkPath } = linkDoc(getCtx(), key, { force: opts.force });
        console.log(`${green('linked')} ${path.basename(linkPath)} → AGENTS.md`);
      }),
    );

  docs
    .command('unlink <key>')
    .description('Replace a symlinked spoke with a real copy of the hub')
    .action(
      runAction((key: string) => {
        const { path: p } = unlinkDoc(getCtx(), key);
        console.log(`${green('materialized')} ${p}`);
      }),
    );

  docs
    .command('diff [key]')
    .description('Diff a spoke doc against the hub AGENTS.md (default: claude)')
    .action(
      runAction((key: string | undefined) => {
        const { hub, spoke, same } = diffDocs(getCtx(), key);
        console.log(dim(`hub ${hub.path}  vs  spoke ${spoke.path}`));
        if (same) {
          console.log(green(`${spoke.label} matches ${hub.label}`));
          return;
        }
        const result = spawnSync('git', ['diff', '--no-index', '--', hub.path, spoke.path], {
          stdio: 'inherit',
        });
        if (result.error) {
          // git is unavailable — fall back to a naive, set-based line diff.
          console.log(dim('(git not found; simple line diff)'));
          const hubLines = new Set(readFileSync(hub.path, 'utf8').split('\n'));
          const spokeLines = new Set(readFileSync(spoke.path, 'utf8').split('\n'));
          for (const line of hubLines) {
            if (!spokeLines.has(line)) console.log(red(`- ${line}`));
          }
          for (const line of spokeLines) {
            if (!hubLines.has(line)) console.log(green(`+ ${line}`));
          }
          process.exitCode = 1;
          return;
        }
        // git exits 1 when the files differ; that is expected here (diff convention).
        process.exitCode = 1;
      }),
    );

  return docs;
}
