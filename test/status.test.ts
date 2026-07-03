import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Context } from '../src/context.js';
import { serializeFrontmatter } from '../src/frontmatter.js';
import { gatherStatus } from '../src/status.js';

const GLOBAL_REL = 'skills';
const LOCAL_REL = path.join('.claude', 'skills');

let tmp: string;
let globalRoot: string;
let projectRoot: string;
let home: string;
let ctx: Context;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agman-status-')));
  globalRoot = path.join(tmp, 'ghome');
  projectRoot = path.join(tmp, 'proj');
  home = path.join(tmp, 'home');
  fs.mkdirSync(globalRoot, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  ctx = { globalRoot, projectRoot, cwd: projectRoot, home };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeSkill(root: string, relDir: string, name: string, description?: string): void {
  const dir = path.join(root, relDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const data: Record<string, string> = { name };
  if (description !== undefined) data.description = description;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), serializeFrontmatter(data, `# ${name}\n\nbody`));
}
const makeGlobal = (name: string, d?: string): void => makeSkill(globalRoot, GLOBAL_REL, name, d);
const makeLocal = (name: string, d?: string): void => makeSkill(projectRoot, LOCAL_REL, name, d);

const claudeFile = (): string => path.join(projectRoot, 'CLAUDE.md');
const agentsFile = (): string => path.join(projectRoot, 'AGENTS.md');

describe('gatherStatus', () => {
  it('reports an empty fixture: no skills, four missing docs, no shadow, no differ', () => {
    const r = gatherStatus(ctx);
    expect(r.skills).toEqual([]);
    expect(r.docs).toHaveLength(4);
    expect(r.docs.every((d) => d.exists === false)).toBe(true);
    expect(r.shadowedCount).toBe(0);
    expect(r.docsDiffer).toBe(false);
    expect(r.globalRoot).toBe(globalRoot);
    expect(r.projectRoot).toBe(projectRoot);
  });

  it('returns the four docs in the fixed listDocs order', () => {
    const r = gatherStatus(ctx);
    expect(r.docs.map((d) => [d.target, d.scope])).toEqual([
      ['claude', 'global'],
      ['claude', 'local'],
      ['local', 'local'],
      ['agents', 'local'],
    ]);
  });

  it('counts a global skill shadowed by a same-named local skill', () => {
    makeGlobal('dup');
    makeLocal('dup');
    makeGlobal('solo');
    const r = gatherStatus(ctx);
    expect(r.shadowedCount).toBe(1);
    const globalDup = r.skills.find((s) => s.name === 'dup' && s.scope === 'global');
    expect(globalDup?.shadowed).toBe(true);
  });

  it('sorts skills by name ascending, local before global on a tie', () => {
    makeGlobal('zebra');
    makeGlobal('alpha');
    makeLocal('alpha');
    makeLocal('beta');
    const r = gatherStatus(ctx);
    expect(r.skills.map((s) => [s.name, s.scope])).toEqual([
      ['alpha', 'local'],
      ['alpha', 'global'],
      ['beta', 'local'],
      ['zebra', 'global'],
    ]);
  });

  it('flags docsDiffer when project CLAUDE.md and AGENTS.md differ', () => {
    fs.writeFileSync(claudeFile(), 'one\n');
    fs.writeFileSync(agentsFile(), 'two\n');
    expect(gatherStatus(ctx).docsDiffer).toBe(true);
  });

  it('does not flag docsDiffer when CLAUDE.md and AGENTS.md are identical', () => {
    fs.writeFileSync(claudeFile(), 'same\n');
    fs.writeFileSync(agentsFile(), 'same\n');
    expect(gatherStatus(ctx).docsDiffer).toBe(false);
  });

  it('does not flag docsDiffer when only CLAUDE.md exists', () => {
    fs.writeFileSync(claudeFile(), 'only claude\n');
    expect(gatherStatus(ctx).docsDiffer).toBe(false);
  });

  it('does not flag docsDiffer when only AGENTS.md exists', () => {
    fs.writeFileSync(agentsFile(), 'only agents\n');
    expect(gatherStatus(ctx).docsDiffer).toBe(false);
  });
});
