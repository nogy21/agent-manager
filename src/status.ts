import fs from 'node:fs';
import { Command } from 'commander';
import { bold, cyan, dim, yellow } from './colors.js';
import type { Context } from './context.js';
import { fileCell, formatMtime, humanSize, scopeCell, statusCell } from './docs/commands.js';
import { listDocs, type DocInfo } from './docs/core.js';
import { runAction } from './run.js';
import { listSkills, type SkillInfo } from './skills/core.js';
import { renderTable } from './table.js';

const MAX_SKILLS_SHOWN = 15;
const DESC_WIDTH = 50;

export interface StatusReport {
  globalRoot: string;
  projectRoot: string;
  skills: SkillInfo[];
  docs: DocInfo[];
  shadowedCount: number;
  docsDiffer: boolean; // true iff project CLAUDE.md AND AGENTS.md both exist with different content
}

/** Locate a doc in a report by target + scope (order-independent). */
function findDoc(docs: DocInfo[], target: DocInfo['target'], scope: DocInfo['scope']): DocInfo | undefined {
  return docs.find((d) => d.target === target && d.scope === scope);
}

// Read both project docs and compare when both exist; never throws (a status
// overview should degrade gracefully rather than blow up on a read error).
function computeDocsDiffer(docs: DocInfo[]): boolean {
  const claude = findDoc(docs, 'claude', 'local');
  const agents = findDoc(docs, 'agents', 'local');
  if (!claude?.exists || !agents?.exists) return false;
  try {
    return fs.readFileSync(claude.path, 'utf8') !== fs.readFileSync(agents.path, 'utf8');
  } catch {
    return false;
  }
}

export function gatherStatus(ctx: Context): StatusReport {
  const skills = listSkills(ctx);
  const docs = listDocs(ctx);
  return {
    globalRoot: ctx.globalRoot,
    projectRoot: ctx.projectRoot,
    skills,
    docs,
    shadowedCount: skills.filter((s) => s.shadowed).length,
    docsDiffer: computeDocsDiffer(docs),
  };
}

function truncateDescription(s: string): string {
  return s.length > DESC_WIDTH ? s.slice(0, DESC_WIDTH) + '…' : s;
}

/** Prefix every line of a rendered block with two spaces. */
function indent(block: string): string {
  return block
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function printSkills(report: StatusReport): void {
  const localCount = report.skills.filter((s) => s.scope === 'local').length;
  const globalCount = report.skills.filter((s) => s.scope === 'global').length;
  let summary = `local ${localCount} · global ${globalCount}`;
  if (report.shadowedCount > 0) {
    summary += yellow(`, ${report.shadowedCount} shadowed`);
  }
  console.log(`${bold('Skills')}  ${summary}`);

  if (report.skills.length === 0) {
    console.log(indent(dim('no skills — create one with: agman skills create <name>')));
    return;
  }

  const shown = report.skills.slice(0, MAX_SKILLS_SHOWN);
  const rows = shown.map((s) => {
    const nameCell = s.name + (s.shadowed ? ' ' + yellow('(shadowed)') : '');
    const scopeC = s.scope === 'local' ? cyan('local') : dim('global');
    const descCell = dim(!s.hasSkillMd ? '(no SKILL.md)' : truncateDescription(s.description));
    return [nameCell, scopeC, descCell];
  });
  console.log(indent(renderTable(rows)));
  if (report.skills.length > MAX_SKILLS_SHOWN) {
    console.log(indent(dim(`… and ${report.skills.length - MAX_SKILLS_SHOWN} more`)));
  }
}

function printDocs(report: StatusReport): void {
  console.log('');
  console.log(bold('Docs'));
  const rows = report.docs.map((info) => [
    fileCell(info),
    scopeCell(info),
    statusCell(info),
    info.size !== undefined ? humanSize(info.size) : '',
    info.lines !== undefined ? String(info.lines) : '',
    info.mtime ? formatMtime(info.mtime) : '',
  ]);
  console.log(indent(renderTable(rows)));
}

function printTips(report: StatusReport): void {
  const tips: string[] = [];
  const claude = findDoc(report.docs, 'claude', 'local');
  const agents = findDoc(report.docs, 'agents', 'local');
  if (!claude?.exists) tips.push(dim('tip: agman docs init claude'));
  if (!agents?.exists) tips.push(dim('tip: agman docs init agents'));
  if (report.docsDiffer) {
    tips.push(
      yellow('CLAUDE.md and AGENTS.md differ') +
        dim(' — inspect: agman docs diff · reconcile: agman docs sync --source claude'),
    );
  }
  if (tips.length === 0) return;
  console.log('');
  for (const tip of tips) console.log(tip);
}

function printHuman(report: StatusReport): void {
  console.log(`${dim('project')}  ${report.projectRoot}`);
  console.log(`${dim('global ')}  ${report.globalRoot}`);
  console.log('');
  printSkills(report);
  printDocs(report);
  printTips(report);
}

function printJson(report: StatusReport): void {
  const docs = report.docs.map((d) => ({
    ...d,
    mtime: d.mtime ? d.mtime.toISOString() : null,
  }));
  console.log(JSON.stringify({ ...report, docs }, null, 2));
}

export function buildStatusCommand(getCtx: () => Context): Command {
  const cmd = new Command('status').description('Overview of skills and memory docs');
  cmd.option('--json', 'print raw JSON instead of a summary');
  cmd.action(
    runAction((opts: { json?: boolean }) => {
      const report = gatherStatus(getCtx());
      if (opts.json) {
        printJson(report);
        return;
      }
      printHuman(report);
    }),
  );
  return cmd;
}
