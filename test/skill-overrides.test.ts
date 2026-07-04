import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { locationByKey } from '../src/agents/registry.js';
import type { Context, Scope } from '../src/context.js';
import { CliError } from '../src/errors.js';
import { serializeFrontmatter } from '../src/frontmatter.js';
import { listSkills } from '../src/skills/core.js';
import {
  effectiveOverride,
  readEffectiveOverrides,
  setClaudeApplicability,
} from '../src/skills/overrides.js';

let tmp: string;
let home: string;
let ghome: string;
let proj: string;
let ctx: Context;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agman-overrides-')));
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

/** Write a skill into a location (enabled). */
function makeSkillAt(key: string, scope: Scope, name: string): string {
  const dir = path.join(locDir(key, scope), name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), serializeFrontmatter({ name }, `# ${name}\n\nbody`));
  return dir;
}

/** Absolute path of a `.claude` settings file in the project. */
function settingsPath(file: 'settings.json' | 'settings.local.json'): string {
  return path.join(proj, '.claude', file);
}

/** Write a `.claude` settings file with arbitrary JSON text. */
function writeSettings(file: 'settings.json' | 'settings.local.json', json: string): void {
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(settingsPath(file), json);
}

function readSettingsJson(file: 'settings.json' | 'settings.local.json'): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(settingsPath(file), 'utf8')) as Record<string, unknown>;
}

describe('readEffectiveOverrides / effectiveOverride', () => {
  it('defaults to on when no settings files exist', () => {
    expect(readEffectiveOverrides(ctx)).toEqual({});
    expect(effectiveOverride(ctx, 'anything')).toBe('on');
  });

  it('reads skillOverrides from settings.json', () => {
    writeSettings('settings.json', JSON.stringify({ skillOverrides: { alpha: 'off' } }));
    expect(readEffectiveOverrides(ctx)).toEqual({ alpha: 'off' });
    expect(effectiveOverride(ctx, 'alpha')).toBe('off');
    expect(effectiveOverride(ctx, 'beta')).toBe('on');
  });

  it('merges with settings.local.json overriding settings.json', () => {
    writeSettings(
      'settings.json',
      JSON.stringify({ skillOverrides: { shared: 'off', onlyShared: 'name-only' } }),
    );
    writeSettings(
      'settings.local.json',
      JSON.stringify({ skillOverrides: { shared: 'on', onlyLocal: 'off' } }),
    );
    expect(readEffectiveOverrides(ctx)).toEqual({
      shared: 'on', // local wins over shared
      onlyShared: 'name-only',
      onlyLocal: 'off',
    });
    expect(effectiveOverride(ctx, 'shared')).toBe('on');
  });

  it('is lenient: malformed settings.json is treated as {} (does not throw)', () => {
    writeSettings('settings.json', '{ this is not json');
    writeSettings('settings.local.json', JSON.stringify({ skillOverrides: { keep: 'off' } }));
    expect(readEffectiveOverrides(ctx)).toEqual({ keep: 'off' });
  });

  it('ignores non-object skillOverrides and non-string state values', () => {
    writeSettings(
      'settings.json',
      JSON.stringify({ skillOverrides: { a: 'off', b: 123, c: 'bogus' } }),
    );
    // only the recognized string state survives
    expect(readEffectiveOverrides(ctx)).toEqual({ a: 'off' });
  });
});

describe('setClaudeApplicability', () => {
  it('off writes { skillOverrides: { name: "off" } } to settings.local.json only', () => {
    setClaudeApplicability(ctx, 'my-skill', 'off');
    expect(readSettingsJson('settings.local.json')).toEqual({
      skillOverrides: { 'my-skill': 'off' },
    });
    // written to the personal file, not the shared one
    expect(fs.existsSync(settingsPath('settings.json'))).toBe(false);
    // trailing newline + 2-space indent
    const raw = fs.readFileSync(settingsPath('settings.local.json'), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('  "skillOverrides"');
  });

  it('on removes the key and drops skillOverrides when it becomes empty', () => {
    setClaudeApplicability(ctx, 'solo', 'off');
    setClaudeApplicability(ctx, 'solo', 'on');
    expect(readSettingsJson('settings.local.json')).toEqual({});
  });

  it('on removes only the named key, keeping other overrides', () => {
    setClaudeApplicability(ctx, 'a', 'off');
    setClaudeApplicability(ctx, 'b', 'off');
    setClaudeApplicability(ctx, 'a', 'on');
    expect(readSettingsJson('settings.local.json')).toEqual({
      skillOverrides: { b: 'off' },
    });
  });

  it('preserves unrelated settings keys and pre-existing overrides', () => {
    writeSettings(
      'settings.local.json',
      JSON.stringify({ env: { FOO: 'bar' }, skillOverrides: { existing: 'name-only' } }, null, 2),
    );
    setClaudeApplicability(ctx, 'added', 'off');
    expect(readSettingsJson('settings.local.json')).toEqual({
      env: { FOO: 'bar' },
      skillOverrides: { existing: 'name-only', added: 'off' },
    });
  });

  it('on with no existing settings is a no-op that writes an empty object', () => {
    setClaudeApplicability(ctx, 'never-set', 'on');
    expect(readSettingsJson('settings.local.json')).toEqual({});
  });

  it('throws CliError and does NOT overwrite a malformed settings.local.json', () => {
    const original = '{ not valid json at all';
    writeSettings('settings.local.json', original);
    expect(() => setClaudeApplicability(ctx, 'x', 'off')).toThrow(CliError);
    // file left untouched
    expect(fs.readFileSync(settingsPath('settings.local.json'), 'utf8')).toBe(original);
  });

  it('throws CliError when settings.local.json is a non-object (JSON array)', () => {
    const original = '["not", "an", "object"]';
    writeSettings('settings.local.json', original);
    expect(() => setClaudeApplicability(ctx, 'x', 'off')).toThrow(CliError);
    expect(fs.readFileSync(settingsPath('settings.local.json'), 'utf8')).toBe(original);
  });

  it('creates the .claude directory when absent', () => {
    // fresh project: no .claude dir yet
    expect(fs.existsSync(path.join(proj, '.claude'))).toBe(false);
    setClaudeApplicability(ctx, 'fresh', 'off');
    expect(fs.existsSync(settingsPath('settings.local.json'))).toBe(true);
  });
});

describe('listSkills — claudeApplicability integration', () => {
  it('sets claudeApplicability only for Claude-visible skills, undefined otherwise', () => {
    makeSkillAt('claude', 'local', 'visible'); // visibleTo includes claude-code
    makeSkillAt('gemini', 'local', 'hidden'); // not visible to claude-code
    const byName = Object.fromEntries(listSkills(ctx).map((s) => [s.name, s]));
    expect(byName.visible.claudeApplicability).toBe('on'); // default
    expect(byName.hidden.claudeApplicability).toBeUndefined();
  });

  it('reflects an off override for a Claude-visible skill', () => {
    makeSkillAt('claude', 'local', 'target');
    setClaudeApplicability(ctx, 'target', 'off');
    const target = listSkills(ctx).find((s) => s.name === 'target');
    expect(target?.claudeApplicability).toBe('off');
  });

  it('leaves disabled skills (visibleTo []) without claudeApplicability', () => {
    // a disabled skill has visibleTo [] so it is not Claude-visible
    const dir = path.join(locDir('claude', 'local') + '.disabled', 'off-skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      serializeFrontmatter({ name: 'off-skill' }, '# off-skill\n\nbody'),
    );
    const s = listSkills(ctx).find((x) => x.name === 'off-skill');
    expect(s?.enabled).toBe(false);
    expect(s?.claudeApplicability).toBeUndefined();
  });

  it('leaves the agents location undefined — its visibleTo excludes claude-code', () => {
    // 'agents' visibleTo is codex/cursor/copilot/gemini-cli/windsurf — NOT claude-code
    makeSkillAt('agents', 'local', 'agentsonly');
    const s = listSkills(ctx).find((x) => x.name === 'agentsonly');
    expect(s?.claudeApplicability).toBeUndefined();
  });
});
