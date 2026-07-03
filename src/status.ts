import { Command } from 'commander';
import { AGENTS, detectAgents, type AgentId } from './agents/registry.js';
import { bold, cyan, dim, green, yellow } from './colors.js';
import type { Context } from './context.js';
import { renderDocsTable } from './docs/commands.js';
import { docSpecs, listDocs, statDoc, type DocInfo } from './docs/core.js';
import { runAction } from './run.js';
import { listSkills, type SkillInfo } from './skills/core.js';
import { renderTable } from './table.js';

export interface AgentStatus {
  id: AgentId;
  name: string;
  detected: boolean;
  instruction: {
    mode: 'agents-native' | 'copy' | 'config';
    docKey: string | null;
    // agents-native → 'native'; copy/config → spoke sync state (missing hub → 'no-hub')
    state: 'native' | 'in-sync' | 'linked' | 'diverged' | 'missing' | 'no-hub';
  };
  skillCount: number; // enabled skills visible to this agent
}

export interface StatusReport {
  globalRoot: string;
  projectRoot: string;
  home: string;
  agents: AgentStatus[];
  docs: DocInfo[];
  skills: SkillInfo[];
  disabledCount: number;
  shadowedCount: number;
  hubExists: boolean;
}

/** Map an agent to the sync state of its spoke doc (copy/config agents only). */
function instructionState(
  ctx: Context,
  agentId: AgentId,
  docKey: string | null,
  hubExists: boolean,
): AgentStatus['instruction']['state'] {
  if (!hubExists || docKey === null) return 'no-hub';
  switch (statDoc(ctx, docKey).sync) {
    case 'linked':
      return 'linked';
    case 'in-sync':
      return 'in-sync';
    case 'diverged':
      return 'diverged';
    default:
      return 'missing'; // 'missing' / (unexpected) 'n/a' both surface as missing
  }
}

export function gatherStatus(ctx: Context): StatusReport {
  const detected = new Set(detectAgents(ctx));
  const skills = listSkills(ctx);
  const docs = listDocs(ctx);
  const hubExists = statDoc(ctx, 'agents').exists;

  // spoke key per copy/config agent, e.g. claude-code → 'claude'.
  const spokeKeyByAgent = new Map<AgentId, string>();
  for (const spec of docSpecs(ctx)) {
    if (spec.role === 'spoke' && spec.agentId !== null) {
      spokeKeyByAgent.set(spec.agentId, spec.key);
    }
  }

  const agents: AgentStatus[] = AGENTS.map((agent) => {
    const mode = agent.instructionMode;
    let docKey: string | null = null;
    let state: AgentStatus['instruction']['state'];
    if (mode === 'agents-native') {
      state = 'native';
    } else {
      docKey = spokeKeyByAgent.get(agent.id) ?? null;
      state = instructionState(ctx, agent.id, docKey, hubExists);
    }
    return {
      id: agent.id,
      name: agent.name,
      detected: detected.has(agent.id),
      instruction: { mode, docKey, state },
      skillCount: skills.filter((s) => s.enabled && s.visibleTo.includes(agent.id)).length,
    };
  });

  return {
    globalRoot: ctx.globalRoot,
    projectRoot: ctx.projectRoot,
    home: ctx.home,
    agents,
    docs,
    skills,
    disabledCount: skills.filter((s) => !s.enabled).length,
    shadowedCount: skills.filter((s) => s.shadowed).length,
    hubExists,
  };
}

/** Prefix every line of a rendered block with two spaces. */
function indent(block: string): string {
  return block
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function instructionCell(st: AgentStatus, labelByKey: Map<string, string>): string {
  const ins = st.instruction;
  if (ins.state === 'native') return green('AGENTS.md (native)');
  const label = (ins.docKey && labelByKey.get(ins.docKey)) || 'spoke';
  switch (ins.state) {
    case 'in-sync':
      return green(`${label} ✓ in sync`);
    case 'linked':
      return cyan(`${label} → AGENTS.md`);
    case 'diverged':
      return yellow(`${label} diverged`);
    case 'missing':
      return dim(`${label} missing`);
    case 'no-hub':
      return dim('AGENTS.md missing');
    default:
      return dim(label);
  }
}

function printAgents(report: StatusReport, ctx: Context): void {
  console.log(bold('Agents'));
  const labelByKey = new Map(docSpecs(ctx).map((s) => [s.key, s.label]));
  const rows = report.agents.map((a) => [
    a.name,
    a.detected ? green('yes') : dim('no'),
    instructionCell(a, labelByKey),
    a.skillCount > 0 ? String(a.skillCount) : dim('0'),
  ]);
  console.log(
    indent(renderTable(rows, { header: ['AGENT', 'DETECTED', 'INSTRUCTIONS', 'SKILLS'] })),
  );
}

function printDocs(report: StatusReport): void {
  console.log(bold('Docs'));
  console.log(indent(renderDocsTable(report.docs)));
}

function printSkills(report: StatusReport): void {
  const enabled = report.skills.filter((s) => s.enabled).length;
  let summary = `enabled ${enabled} · disabled ${report.disabledCount}`;
  if (report.shadowedCount > 0) {
    summary += yellow(` · ${report.shadowedCount} shadowed`);
  }
  console.log(`${bold('Skills')}  ${summary}`);
  console.log(indent(dim('run: agman skills list')));
}

function printTips(report: StatusReport): void {
  const tips: string[] = [];
  if (!report.hubExists) {
    tips.push(dim('tip: agman docs init agents'));
  }
  if (report.agents.some((a) => a.instruction.state === 'diverged')) {
    tips.push(yellow('spokes diverged') + dim(' — agman docs diff <key> · agman docs sync'));
  }
  const starved = report.agents.filter((a) => a.detected && a.skillCount === 0).map((a) => a.name);
  if (starved.length > 0) {
    tips.push(dim(`no skills visible to: ${starved.join(', ')}`));
  }
  if (tips.length === 0) return;
  console.log('');
  for (const tip of tips) console.log(tip);
}

function printHuman(report: StatusReport, ctx: Context): void {
  console.log(`${dim('project')}  ${report.projectRoot}`);
  console.log(`${dim('global ')}  ${report.globalRoot}`);
  console.log('');
  printAgents(report, ctx);
  console.log('');
  printDocs(report);
  console.log('');
  printSkills(report);
  printTips(report);
}

function printJson(report: StatusReport): void {
  const docs = report.docs.map((d) => ({ ...d, mtime: d.mtime ? d.mtime.toISOString() : null }));
  console.log(JSON.stringify({ ...report, docs }, null, 2));
}

export function buildStatusCommand(getCtx: () => Context): Command {
  const cmd = new Command('status').description('Overview of agents, memory docs, and skills');
  cmd.option('--json', 'print raw JSON instead of a summary');
  cmd.action(
    runAction((opts: { json?: boolean }) => {
      const ctx = getCtx();
      const report = gatherStatus(ctx);
      if (opts.json) {
        printJson(report);
        return;
      }
      printHuman(report, ctx);
    }),
  );
  return cmd;
}
