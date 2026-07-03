import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { locationByKey } from '../src/agents/registry.js';
import type { Context, Scope } from '../src/context.js';
import { CliError } from '../src/errors.js';
import { parseFrontmatter, serializeFrontmatter } from '../src/frontmatter.js';
import {
  copySkill,
  createSkill,
  findSkill,
  installSkill,
  listSkills,
  readSkill,
  removeSkill,
  setSkillEnabled,
} from '../src/skills/core.js';

let tmp: string;
let home: string;
let ghome: string;
let proj: string;
let ctx: Context;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agman-skills-')));
  home = path.join(tmp, 'home');
  ghome = path.join(tmp, 'ghome');
  proj = path.join(tmp, 'proj');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(ghome, { recursive: true });
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  ctx = { globalRoot: ghome, projectRoot: proj, cwd: proj, home };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Absolute enabled dir for a (key, scope) location. */
function locDir(key: string, scope: Scope): string {
  return locationByKey(ctx, key, scope).dir;
}

/** Write a skill into a location; set `disabled` to place it under `<dir>.disabled`. */
function makeSkillAt(
  key: string,
  scope: Scope,
  name: string,
  opts: { description?: string; disabled?: boolean } = {},
): string {
  const base = locDir(key, scope);
  const dir = path.join(opts.disabled ? base + '.disabled' : base, name);
  fs.mkdirSync(dir, { recursive: true });
  const data: Record<string, string> = { name };
  if (opts.description !== undefined) data.description = opts.description;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), serializeFrontmatter(data, `# ${name}\n\nbody`));
  return dir;
}

describe('listSkills', () => {
  it('returns [] when nothing exists', () => {
    expect(listSkills(ctx)).toEqual([]);
  });

  it('lists skills across multiple locations with correct visibleTo and keys', () => {
    makeSkillAt('claude', 'local', 'a');
    makeSkillAt('agents', 'local', 'b');
    makeSkillAt('gemini', 'local', 'c');
    const list = listSkills(ctx);
    const byName = Object.fromEntries(list.map((s) => [s.name, s]));
    expect(byName.a.locationKey).toBe('claude');
    expect(byName.a.visibleTo).toEqual(['claude-code', 'copilot', 'windsurf']);
    expect(byName.b.locationKey).toBe('agents');
    expect(byName.b.visibleTo).toEqual(['codex', 'cursor', 'copilot', 'gemini-cli', 'windsurf']);
    expect(byName.c.locationKey).toBe('gemini');
    expect(byName.c.visibleTo).toEqual(['gemini-cli']);
    expect(list.every((s) => s.enabled)).toBe(true);
  });

  it('sorts by name asc, local before global, then locationKey asc', () => {
    makeSkillAt('claude', 'global', 'zebra');
    makeSkillAt('claude', 'local', 'alpha');
    makeSkillAt('agents', 'local', 'alpha'); // same name, tie broken by locationKey
    makeSkillAt('claude', 'global', 'alpha');
    const list = listSkills(ctx);
    expect(list.map((s) => [s.name, s.scope, s.locationKey])).toEqual([
      ['alpha', 'local', 'agents'],
      ['alpha', 'local', 'claude'],
      ['alpha', 'global', 'claude'],
      ['zebra', 'global', 'claude'],
    ]);
  });

  it('filters by scope', () => {
    makeSkillAt('agents', 'local', 'loc');
    makeSkillAt('agents', 'global', 'glob');
    expect(listSkills(ctx, { scope: 'local' }).map((s) => s.name)).toEqual(['loc']);
    expect(listSkills(ctx, { scope: 'global' }).map((s) => s.name)).toEqual(['glob']);
  });

  it('agent filter: gemini-cli sees .agents and .gemini skills but not .claude', () => {
    makeSkillAt('claude', 'local', 'claude-only');
    makeSkillAt('agents', 'local', 'agents-shared');
    makeSkillAt('gemini', 'local', 'gemini-only');
    const seen = listSkills(ctx, { agent: 'gemini-cli' }).map((s) => s.name);
    expect(seen.sort()).toEqual(['agents-shared', 'gemini-only']);
    expect(seen).not.toContain('claude-only');
  });

  it('agent filter drops disabled skills even if their location would be visible', () => {
    makeSkillAt('agents', 'local', 'off', { disabled: true });
    expect(listSkills(ctx, { agent: 'codex' })).toEqual([]);
  });

  it('includes disabled skills by default with enabled=false and visibleTo []', () => {
    makeSkillAt('agents', 'local', 'off', { disabled: true });
    const [s] = listSkills(ctx);
    expect(s.name).toBe('off');
    expect(s.enabled).toBe(false);
    expect(s.visibleTo).toEqual([]);
  });

  it('excludes disabled skills when includeDisabled is false', () => {
    makeSkillAt('agents', 'local', 'on');
    makeSkillAt('agents', 'local', 'off', { disabled: true });
    expect(listSkills(ctx, { includeDisabled: false }).map((s) => s.name)).toEqual(['on']);
  });

  it('treats a directory without SKILL.md as hasSkillMd=false', () => {
    fs.mkdirSync(path.join(locDir('agents', 'local'), 'bare'), { recursive: true });
    const [s] = listSkills(ctx);
    expect(s.hasSkillMd).toBe(false);
    expect(s.description).toBe('');
  });
});

describe('shadowing', () => {
  it('shadows a global skill when an enabled local skill shares an agent', () => {
    makeSkillAt('agents', 'global', 'dup');
    makeSkillAt('agents', 'local', 'dup');
    const g = listSkills(ctx).find((s) => s.name === 'dup' && s.scope === 'global');
    const l = listSkills(ctx).find((s) => s.name === 'dup' && s.scope === 'local');
    expect(g?.shadowed).toBe(true);
    expect(l?.shadowed).toBe(false);
  });

  it('does NOT shadow when visibility does not overlap (global claude vs local gemini)', () => {
    makeSkillAt('claude', 'global', 'dup');
    makeSkillAt('gemini', 'local', 'dup');
    const g = listSkills(ctx).find((s) => s.name === 'dup' && s.scope === 'global');
    expect(g?.shadowed).toBe(false);
  });

  it('shadows across different keys when the agent set overlaps (copilot)', () => {
    // global claude (copilot ∈ visibleTo) shadowed by local agents (copilot ∈ visibleTo)
    makeSkillAt('claude', 'global', 'dup');
    makeSkillAt('agents', 'local', 'dup');
    const g = listSkills(ctx).find((s) => s.name === 'dup' && s.scope === 'global');
    expect(g?.shadowed).toBe(true);
  });

  it('a disabled local skill does not shadow a global one', () => {
    makeSkillAt('agents', 'global', 'dup');
    makeSkillAt('agents', 'local', 'dup', { disabled: true });
    const g = listSkills(ctx).find((s) => s.name === 'dup' && s.scope === 'global');
    expect(g?.shadowed).toBe(false);
  });
});

describe('findSkill', () => {
  it('prefers enabled over disabled', () => {
    makeSkillAt('agents', 'local', 'dup', { description: 'on' });
    makeSkillAt('claude', 'local', 'dup', { description: 'off', disabled: true });
    expect(findSkill(ctx, 'dup')?.enabled).toBe(true);
  });

  it('prefers local over global', () => {
    makeSkillAt('agents', 'global', 'dup', { description: 'g' });
    makeSkillAt('agents', 'local', 'dup', { description: 'l' });
    expect(findSkill(ctx, 'dup')?.scope).toBe('local');
  });

  it('prefers primary locations (claude/agents) over others, then locationKey asc', () => {
    makeSkillAt('agents', 'local', 'dup');
    makeSkillAt('claude', 'local', 'dup');
    makeSkillAt('cursor', 'local', 'dup');
    // primary first, then locationKey asc: 'agents' < 'claude'
    expect(findSkill(ctx, 'dup')?.locationKey).toBe('agents');
  });

  it('honors an explicit locationKey filter', () => {
    makeSkillAt('agents', 'local', 'dup');
    makeSkillAt('claude', 'local', 'dup');
    expect(findSkill(ctx, 'dup', { locationKey: 'claude' })?.locationKey).toBe('claude');
  });

  it('returns undefined for a miss', () => {
    expect(findSkill(ctx, 'nope')).toBeUndefined();
  });
});

describe('readSkill', () => {
  it('returns info and raw content', () => {
    makeSkillAt('agents', 'local', 'r', { description: 'desc' });
    const { info, content } = readSkill(ctx, 'r');
    expect(info.name).toBe('r');
    expect(content).toContain('name: r');
  });

  it('throws CliError when missing', () => {
    expect(() => readSkill(ctx, 'ghost')).toThrow(/skill not found: ghost/);
  });

  it('throws CliError when the dir has no SKILL.md', () => {
    fs.mkdirSync(path.join(locDir('agents', 'local'), 'bare'), { recursive: true });
    expect(() => readSkill(ctx, 'bare')).toThrow(/no SKILL\.md/);
  });
});

describe('createSkill', () => {
  it("defaults to the 'agents' location at local scope", () => {
    const info = createSkill(ctx, 'new-skill');
    expect(info.locationKey).toBe('agents');
    expect(info.scope).toBe('local');
    expect(info.enabled).toBe(true);
    expect(info.path).toBe(path.join(locDir('agents', 'local'), 'new-skill'));
    expect(info.description).toBe('TODO: one-line description of when to use this skill');
    const { data, body } = parseFrontmatter(fs.readFileSync(path.join(info.path, 'SKILL.md'), 'utf8'));
    expect(data.name).toBe('new-skill');
    expect(body).toContain('## When to use');
    expect(body).toContain('## Instructions');
  });

  it('creates into an explicit location key', () => {
    const info = createSkill(ctx, 'commit-style', { location: 'claude', description: 'x' });
    expect(info.locationKey).toBe('claude');
    expect(info.visibleTo).toContain('claude-code');
    expect(info.path).toBe(path.join(locDir('claude', 'local'), 'commit-style'));
  });

  it('creates at global scope', () => {
    const info = createSkill(ctx, 'g', { location: 'agents', scope: 'global' });
    expect(info.scope).toBe('global');
    expect(info.path).toBe(path.join(locDir('agents', 'global'), 'g'));
  });

  it('rejects invalid names', () => {
    for (const bad of ['Bad', 'has space', '-lead', 'a--b', 'a'.repeat(65)]) {
      expect(() => createSkill(ctx, bad)).toThrow(CliError);
    }
    expect(() => createSkill(ctx, 'a'.repeat(64))).not.toThrow();
  });

  it('rejects an unknown location key', () => {
    expect(() => createSkill(ctx, 'x', { location: 'nope' })).toThrow(/unknown skills location/);
  });

  it('rejects creating a skill that already exists', () => {
    createSkill(ctx, 'dupe');
    expect(() => createSkill(ctx, 'dupe')).toThrow(/already exists/);
  });
});

describe('removeSkill', () => {
  it('deletes and returns info', () => {
    const created = createSkill(ctx, 'goner');
    const removed = removeSkill(ctx, 'goner');
    expect(removed.name).toBe('goner');
    expect(fs.existsSync(created.path)).toBe(false);
  });

  it('throws CliError when absent', () => {
    expect(() => removeSkill(ctx, 'ghost')).toThrow(/skill not found/);
  });
});

describe('copySkill', () => {
  it('copies between locations including an asset file, dest visibleTo reflects target', () => {
    const src = makeSkillAt('agents', 'local', 'porter', { description: 'p' });
    fs.writeFileSync(path.join(src, 'helper.py'), 'print("hi")\n');
    const info = copySkill(ctx, 'porter', { locationKey: 'claude', scope: 'local' });
    expect(info.locationKey).toBe('claude');
    expect(info.visibleTo).toEqual(['claude-code', 'copilot', 'windsurf']);
    expect(info.description).toBe('p');
    const destHelper = path.join(locDir('claude', 'local'), 'porter', 'helper.py');
    expect(fs.readFileSync(destHelper, 'utf8')).toBe('print("hi")\n');
    // Source remains in place.
    expect(fs.existsSync(src)).toBe(true);
  });

  it('throws when the destination exists without --force', () => {
    makeSkillAt('agents', 'local', 'dup', { description: 'src' });
    makeSkillAt('claude', 'local', 'dup', { description: 'dest' });
    expect(() => copySkill(ctx, 'dup', { locationKey: 'claude', scope: 'local' })).toThrow(
      /already exists at .* \(use --force/,
    );
  });

  it('overwrites with --force', () => {
    const src = makeSkillAt('agents', 'local', 'dup', { description: 'from-agents' });
    const dest = makeSkillAt('claude', 'local', 'dup', { description: 'from-claude' });
    fs.writeFileSync(path.join(src, 'keep.py'), 'new\n');
    fs.writeFileSync(path.join(dest, 'stale.txt'), 'old');
    const info = copySkill(ctx, 'dup', { locationKey: 'claude', scope: 'local' }, { force: true });
    expect(info.description).toBe('from-agents');
    expect(fs.existsSync(path.join(info.path, 'stale.txt'))).toBe(false);
    expect(fs.existsSync(path.join(info.path, 'keep.py'))).toBe(true);
  });

  it('excludes the destination itself as a source (only-in-dest => not found)', () => {
    makeSkillAt('claude', 'local', 'only');
    expect(() => copySkill(ctx, 'only', { locationKey: 'claude', scope: 'local' })).toThrow(
      /skill not found: only/,
    );
  });
});

describe('installSkill', () => {
  /** Build an external skill directory (outside any managed location). */
  function externalSkill(dirName: string, frontmatterName?: string): string {
    const dir = path.join(tmp, 'external', dirName);
    fs.mkdirSync(dir, { recursive: true });
    const data: Record<string, string> = {};
    if (frontmatterName !== undefined) data.name = frontmatterName;
    data.description = 'external skill';
    fs.writeFileSync(path.join(dir, 'SKILL.md'), serializeFrontmatter(data, '# body'));
    return dir;
  }

  it('installs using the frontmatter name', () => {
    const src = externalSkill('anything', 'imported-skill');
    const info = installSkill(ctx, src, { locationKey: 'agents', scope: 'local' });
    expect(info.name).toBe('imported-skill');
    expect(info.path).toBe(path.join(locDir('agents', 'local'), 'imported-skill'));
    expect(info.description).toBe('external skill');
  });

  it('falls back to the basename when frontmatter name is missing', () => {
    const src = externalSkill('base-named');
    const info = installSkill(ctx, src, { locationKey: 'agents', scope: 'local' });
    expect(info.name).toBe('base-named');
  });

  it('falls back to the basename when frontmatter name is invalid', () => {
    const src = externalSkill('good-base', 'Invalid Name');
    const info = installSkill(ctx, src, { locationKey: 'agents', scope: 'local' });
    expect(info.name).toBe('good-base');
  });

  it('throws when the source path does not exist', () => {
    expect(() =>
      installSkill(ctx, path.join(tmp, 'nope'), { locationKey: 'agents', scope: 'local' }),
    ).toThrow(/does not exist/);
  });

  it('throws when the source directory has no SKILL.md', () => {
    const dir = path.join(tmp, 'external', 'empty');
    fs.mkdirSync(dir, { recursive: true });
    expect(() => installSkill(ctx, dir, { locationKey: 'agents', scope: 'local' })).toThrow(
      /no SKILL\.md/,
    );
  });

  it('throws when both frontmatter name and basename are invalid', () => {
    const src = externalSkill('Bad Base', 'Also Bad');
    expect(() => installSkill(ctx, src, { locationKey: 'agents', scope: 'local' })).toThrow(
      /invalid skill name/,
    );
  });
});

describe('setSkillEnabled', () => {
  it('disable then enable round-trips the directory location', () => {
    const created = createSkill(ctx, 'toggle');
    const enabledPath = created.path;
    const disabledPath = path.join(locDir('agents', 'local') + '.disabled', 'toggle');

    const off = setSkillEnabled(ctx, 'toggle', false);
    expect(off.enabled).toBe(false);
    expect(off.visibleTo).toEqual([]);
    expect(fs.existsSync(enabledPath)).toBe(false);
    expect(fs.existsSync(disabledPath)).toBe(true);

    const on = setSkillEnabled(ctx, 'toggle', true);
    expect(on.enabled).toBe(true);
    expect(fs.existsSync(enabledPath)).toBe(true);
    expect(fs.existsSync(disabledPath)).toBe(false);
  });

  it('is a no-op when already in the desired state', () => {
    createSkill(ctx, 'stay');
    const info = setSkillEnabled(ctx, 'stay', true); // already enabled
    expect(info.enabled).toBe(true);
    expect(info.name).toBe('stay');
  });

  it('errors on a name collision (disable, recreate same name, then enable)', () => {
    createSkill(ctx, 'clash'); // enabled at agents:local
    setSkillEnabled(ctx, 'clash', false); // moved to agents:local.disabled
    createSkill(ctx, 'clash'); // new enabled at agents:local
    expect(() => setSkillEnabled(ctx, 'clash', true)).toThrow(/already exists at/);
  });

  it('throws CliError when the skill is absent', () => {
    expect(() => setSkillEnabled(ctx, 'ghost', false)).toThrow(/skill not found/);
  });
});
