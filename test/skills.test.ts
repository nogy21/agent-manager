import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Context } from '../src/context.js';
import { CliError } from '../src/errors.js';
import { parseFrontmatter, serializeFrontmatter } from '../src/frontmatter.js';
import {
  copySkill,
  createSkill,
  findSkill,
  listSkills,
  readSkill,
  removeSkill,
  skillsDir,
} from '../src/skills/core.js';

const GLOBAL_REL = 'skills';
const LOCAL_REL = path.join('.claude', 'skills');

let tmp: string;
let ctx: Context;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agman-skills-')));
  const ghome = path.join(tmp, 'ghome');
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(ghome, { recursive: true });
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  ctx = { globalRoot: ghome, projectRoot: proj, cwd: proj };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Create <root>/<relDir>/<name>/SKILL.md with frontmatter; returns the skill dir. */
function makeSkill(root: string, relDir: string, name: string, description?: string): string {
  const dir = path.join(root, relDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const data: Record<string, string> = { name };
  if (description !== undefined) data.description = description;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), serializeFrontmatter(data, `# ${name}\n\nbody`));
  return dir;
}

const makeGlobal = (name: string, description?: string): string =>
  makeSkill(ctx.globalRoot, GLOBAL_REL, name, description);
const makeLocal = (name: string, description?: string): string =>
  makeSkill(ctx.projectRoot, LOCAL_REL, name, description);

describe('skillsDir', () => {
  it('resolves global and local skill directories', () => {
    expect(skillsDir(ctx, 'global')).toBe(path.join(ctx.globalRoot, 'skills'));
    expect(skillsDir(ctx, 'local')).toBe(path.join(ctx.projectRoot, '.claude', 'skills'));
  });
});

describe('listSkills', () => {
  it('returns [] when both skills dirs are missing', () => {
    expect(listSkills(ctx)).toEqual([]);
  });

  it('returns [] when the skills dirs exist but are empty', () => {
    fs.mkdirSync(skillsDir(ctx, 'global'), { recursive: true });
    fs.mkdirSync(skillsDir(ctx, 'local'), { recursive: true });
    expect(listSkills(ctx)).toEqual([]);
  });

  it('sorts by name ascending, local before global on ties', () => {
    makeGlobal('zebra');
    makeGlobal('alpha');
    makeLocal('alpha');
    makeLocal('beta');
    const list = listSkills(ctx);
    expect(list.map((s) => [s.name, s.scope])).toEqual([
      ['alpha', 'local'],
      ['alpha', 'global'],
      ['beta', 'local'],
      ['zebra', 'global'],
    ]);
  });

  it('marks shadowed=true only on the global skill a local shadows', () => {
    makeGlobal('dup');
    makeLocal('dup');
    makeGlobal('solo');
    const list = listSkills(ctx);
    const globalDup = list.find((s) => s.name === 'dup' && s.scope === 'global');
    const localDup = list.find((s) => s.name === 'dup' && s.scope === 'local');
    const solo = list.find((s) => s.name === 'solo');
    expect(globalDup?.shadowed).toBe(true);
    expect(localDup?.shadowed).toBe(false);
    expect(solo?.shadowed).toBe(false);
  });

  it('parses the description from frontmatter', () => {
    makeGlobal('described', 'does a thing');
    const [s] = listSkills(ctx, 'global');
    expect(s.hasSkillMd).toBe(true);
    expect(s.description).toBe('does a thing');
  });

  it('treats a directory without SKILL.md as hasSkillMd=false, description=""', () => {
    fs.mkdirSync(path.join(skillsDir(ctx, 'global'), 'bare'), { recursive: true });
    const [s] = listSkills(ctx, 'global');
    expect(s.name).toBe('bare');
    expect(s.hasSkillMd).toBe(false);
    expect(s.description).toBe('');
  });

  it('ignores dot-directories and stray files', () => {
    const gdir = skillsDir(ctx, 'global');
    fs.mkdirSync(gdir, { recursive: true });
    fs.mkdirSync(path.join(gdir, '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(gdir, 'stray.txt'), 'x');
    makeGlobal('real');
    expect(listSkills(ctx, 'global').map((s) => s.name)).toEqual(['real']);
  });

  it('filters to a single scope when one is given', () => {
    makeGlobal('g');
    makeLocal('l');
    expect(listSkills(ctx, 'global').map((s) => s.name)).toEqual(['g']);
    expect(listSkills(ctx, 'local').map((s) => s.name)).toEqual(['l']);
  });
});

describe('findSkill', () => {
  it('prefers local over global when no scope is given', () => {
    makeGlobal('dup', 'global one');
    makeLocal('dup', 'local one');
    const found = findSkill(ctx, 'dup');
    expect(found?.scope).toBe('local');
    expect(found?.description).toBe('local one');
  });

  it('honors an explicit scope and reports shadowed on the global', () => {
    makeGlobal('dup');
    makeLocal('dup');
    const g = findSkill(ctx, 'dup', 'global');
    expect(g?.scope).toBe('global');
    expect(g?.shadowed).toBe(true);
  });

  it('returns undefined for a miss', () => {
    expect(findSkill(ctx, 'nope')).toBeUndefined();
    expect(findSkill(ctx, 'nope', 'local')).toBeUndefined();
  });
});

describe('readSkill', () => {
  it('returns info and the raw SKILL.md content', () => {
    makeGlobal('r', 'desc');
    const { info, content } = readSkill(ctx, 'r', 'global');
    expect(info.name).toBe('r');
    expect(content).toContain('name: r');
    expect(content).toContain('# r');
  });

  it('throws CliError when the skill is missing', () => {
    expect(() => readSkill(ctx, 'ghost')).toThrow(CliError);
    expect(() => readSkill(ctx, 'ghost')).toThrow(/skill not found: ghost/);
  });

  it('names the scope in the not-found message when one is given', () => {
    expect(() => readSkill(ctx, 'ghost', 'local')).toThrow(/skill not found: ghost in local scope/);
  });

  it('throws CliError when the directory exists but has no SKILL.md', () => {
    fs.mkdirSync(path.join(skillsDir(ctx, 'global'), 'bare'), { recursive: true });
    expect(() => readSkill(ctx, 'bare', 'global')).toThrow(CliError);
    expect(() => readSkill(ctx, 'bare', 'global')).toThrow(/no SKILL\.md/);
  });
});

describe('createSkill', () => {
  it('writes frontmatter that round-trips with the default description', () => {
    const info = createSkill(ctx, 'new-skill', { scope: 'local' });
    expect(info.scope).toBe('local');
    expect(info.hasSkillMd).toBe(true);
    expect(info.description).toBe('TODO: one-line description of when to use this skill');

    const { data, body } = parseFrontmatter(fs.readFileSync(path.join(info.path, 'SKILL.md'), 'utf8'));
    expect(data.name).toBe('new-skill');
    expect(data.description).toBe('TODO: one-line description of when to use this skill');
    expect(body).toContain('## When to use');
    expect(body).toContain('## Instructions');
  });

  it('respects a custom description', () => {
    const info = createSkill(ctx, 'custom', { scope: 'global', description: 'my desc' });
    expect(info.description).toBe('my desc');
    const { data } = parseFrontmatter(fs.readFileSync(path.join(info.path, 'SKILL.md'), 'utf8'));
    expect(data.description).toBe('my desc');
  });

  it('rejects invalid names', () => {
    for (const bad of ['Bad', 'has space', '-lead', 'a--b', 'a'.repeat(65)]) {
      expect(() => createSkill(ctx, bad, { scope: 'local' })).toThrow(CliError);
    }
  });

  it('accepts a 64-char name but rejects a 65-char name', () => {
    expect(() => createSkill(ctx, 'a'.repeat(64), { scope: 'local' })).not.toThrow();
    expect(() => createSkill(ctx, 'a'.repeat(65), { scope: 'local' })).toThrow(CliError);
  });

  it('rejects creating a skill that already exists', () => {
    createSkill(ctx, 'dupe', { scope: 'local' });
    expect(() => createSkill(ctx, 'dupe', { scope: 'local' })).toThrow(/already exists/);
  });
});

describe('removeSkill', () => {
  it('deletes the directory and returns its info', () => {
    const created = createSkill(ctx, 'goner', { scope: 'local' });
    expect(fs.existsSync(created.path)).toBe(true);
    const removed = removeSkill(ctx, 'goner', 'local');
    expect(removed.name).toBe('goner');
    expect(removed.scope).toBe('local');
    expect(fs.existsSync(created.path)).toBe(false);
  });

  it('throws CliError when the skill is absent', () => {
    expect(() => removeSkill(ctx, 'ghost')).toThrow(CliError);
    expect(() => removeSkill(ctx, 'ghost', 'global')).toThrow(/skill not found: ghost in global scope/);
  });
});

describe('copySkill', () => {
  it('copies local → global including an asset file', () => {
    const src = makeLocal('porter', 'p');
    fs.writeFileSync(path.join(src, 'helper.py'), 'print("hi")\n');
    const info = copySkill(ctx, 'porter', 'global');
    expect(info.scope).toBe('global');
    expect(info.description).toBe('p');
    const destHelper = path.join(skillsDir(ctx, 'global'), 'porter', 'helper.py');
    expect(fs.readFileSync(destHelper, 'utf8')).toBe('print("hi")\n');
  });

  it('copies global → local including an asset file', () => {
    const src = makeGlobal('porter', 'p');
    fs.writeFileSync(path.join(src, 'helper.py'), 'x\n');
    const info = copySkill(ctx, 'porter', 'local');
    expect(info.scope).toBe('local');
    expect(fs.existsSync(path.join(skillsDir(ctx, 'local'), 'porter', 'helper.py'))).toBe(true);
  });

  it('throws when the source scope has no such skill', () => {
    expect(() => copySkill(ctx, 'ghost', 'global')).toThrow(
      /skill not found in local scope: ghost/,
    );
  });

  it('throws when the destination exists without --force', () => {
    makeLocal('dup', 'src');
    makeGlobal('dup', 'dest');
    expect(() => copySkill(ctx, 'dup', 'global')).toThrow(/already exists at .* \(use --force/);
  });

  it('overwrites and replaces destination contents with --force', () => {
    const src = makeLocal('dup', 'from-local');
    const dest = makeGlobal('dup', 'from-global');
    fs.writeFileSync(path.join(src, 'keep.py'), 'new\n');
    fs.writeFileSync(path.join(dest, 'stale.txt'), 'old');
    const info = copySkill(ctx, 'dup', 'global', { force: true });
    expect(info.description).toBe('from-local');
    expect(fs.existsSync(path.join(info.path, 'stale.txt'))).toBe(false);
    expect(fs.existsSync(path.join(info.path, 'keep.py'))).toBe(true);
  });
});
