import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentId } from '../src/agents/registry.js';
import type { Context } from '../src/context.js';
import { serializeFrontmatter } from '../src/frontmatter.js';
import { gatherStatus, type AgentStatus } from '../src/status.js';

let tmp: string;
let globalRoot: string;
let projectRoot: string;
let home: string;
let ctx: Context;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agman-status-')));
  // globalRoot deliberately not created — its existence makes claude-code "detected".
  globalRoot = path.join(tmp, 'ghome');
  projectRoot = path.join(tmp, 'proj');
  home = path.join(tmp, 'home');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  ctx = { globalRoot, projectRoot, cwd: projectRoot, home };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const agentsFile = (): string => path.join(projectRoot, 'AGENTS.md');
const claudeFile = (): string => path.join(projectRoot, 'CLAUDE.md');

function makeSkill(root: string, relDir: string, name: string): void {
  const dir = path.join(root, relDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), serializeFrontmatter({ name }, `# ${name}\n\nbody`));
}

function agent(ctxReport: ReturnType<typeof gatherStatus>, id: AgentId): AgentStatus {
  const found = ctxReport.agents.find((a) => a.id === id);
  if (!found) throw new Error(`no agent ${id}`);
  return found;
}

describe('gatherStatus — agents', () => {
  it('lists all six agents in registry order, none detected in a bare project', () => {
    const r = gatherStatus(ctx);
    expect(r.agents.map((a) => a.id)).toEqual([
      'claude-code',
      'codex',
      'cursor',
      'copilot',
      'gemini-cli',
      'windsurf',
    ]);
    expect(r.agents.every((a) => !a.detected)).toBe(true);
    expect(r.hubExists).toBe(false);
  });

  it('sets detected flags from global and project markers', () => {
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true }); // codex
    fs.mkdirSync(path.join(projectRoot, '.cursor'), { recursive: true }); // cursor
    fs.mkdirSync(globalRoot, { recursive: true }); // claude-code
    const r = gatherStatus(ctx);
    expect(agent(r, 'codex').detected).toBe(true);
    expect(agent(r, 'cursor').detected).toBe(true);
    expect(agent(r, 'claude-code').detected).toBe(true);
    expect(agent(r, 'gemini-cli').detected).toBe(false);
    expect(agent(r, 'windsurf').detected).toBe(false);
  });
});

describe('gatherStatus — instruction state', () => {
  it('marks agents-native tools as native with no spoke doc', () => {
    const r = gatherStatus(ctx);
    for (const id of ['codex', 'cursor', 'copilot', 'windsurf'] as AgentId[]) {
      expect(agent(r, id).instruction).toMatchObject({ mode: 'agents-native', state: 'native' });
      expect(agent(r, id).instruction.docKey).toBeNull();
    }
  });

  it('marks copy/config agents as no-hub when AGENTS.md is missing', () => {
    const r = gatherStatus(ctx);
    expect(agent(r, 'claude-code').instruction).toMatchObject({ mode: 'copy', state: 'no-hub' });
    expect(agent(r, 'gemini-cli').instruction).toMatchObject({ mode: 'config', state: 'no-hub' });
  });

  it('marks the spoke missing when the hub exists but CLAUDE.md does not', () => {
    fs.writeFileSync(agentsFile(), 'HUB\n');
    const r = gatherStatus(ctx);
    expect(agent(r, 'claude-code').instruction.state).toBe('missing');
    expect(agent(r, 'claude-code').instruction.docKey).toBe('claude');
  });

  it('marks the spoke in-sync when CLAUDE.md matches the hub', () => {
    fs.writeFileSync(agentsFile(), 'HUB\n');
    fs.writeFileSync(claudeFile(), 'HUB\n');
    expect(agent(gatherStatus(ctx), 'claude-code').instruction.state).toBe('in-sync');
  });

  it('marks the spoke diverged when CLAUDE.md differs from the hub', () => {
    fs.writeFileSync(agentsFile(), 'HUB\n');
    fs.writeFileSync(claudeFile(), 'OTHER\n');
    expect(agent(gatherStatus(ctx), 'claude-code').instruction.state).toBe('diverged');
  });

  it('marks the spoke linked when CLAUDE.md symlinks to the hub', () => {
    fs.writeFileSync(agentsFile(), 'HUB\n');
    fs.symlinkSync('AGENTS.md', claudeFile());
    expect(agent(gatherStatus(ctx), 'claude-code').instruction.state).toBe('linked');
  });
});

describe('gatherStatus — skills', () => {
  it('counts enabled skills by agent visibility', () => {
    makeSkill(projectRoot, path.join('.agents', 'skills'), 'shared');
    const r = gatherStatus(ctx);
    expect(agent(r, 'codex').skillCount).toBe(1); // .agents is visible to codex
    expect(agent(r, 'claude-code').skillCount).toBe(0); // but not to claude-code
  });

  it('excludes disabled skills from counts and reports disabledCount', () => {
    makeSkill(projectRoot, path.join('.agents', 'skills.disabled'), 'off');
    const r = gatherStatus(ctx);
    expect(agent(r, 'codex').skillCount).toBe(0);
    expect(r.disabledCount).toBe(1);
  });

  it('counts a global skill shadowed by a same-named local skill', () => {
    makeSkill(globalRoot, 'skills', 'dup'); // global claude location
    makeSkill(projectRoot, path.join('.claude', 'skills'), 'dup'); // local claude location
    const r = gatherStatus(ctx);
    expect(r.shadowedCount).toBe(1);
    const shadowed = r.skills.find((s) => s.name === 'dup' && s.scope === 'global');
    expect(shadowed?.shadowed).toBe(true);
  });
});

describe('gatherStatus — docs & hub', () => {
  it('exposes the default docs view and hubExists false on a bare project', () => {
    const r = gatherStatus(ctx);
    expect(r.docs.map((d) => d.key)).toEqual([
      'agents',
      'claude',
      'gemini',
      'copilot',
      'claude-local',
    ]);
    expect(r.hubExists).toBe(false);
    expect(r.globalRoot).toBe(globalRoot);
    expect(r.projectRoot).toBe(projectRoot);
    expect(r.home).toBe(home);
  });

  it('sets hubExists true when AGENTS.md is present', () => {
    fs.writeFileSync(agentsFile(), '# hub\n');
    expect(gatherStatus(ctx).hubExists).toBe(true);
  });
});
