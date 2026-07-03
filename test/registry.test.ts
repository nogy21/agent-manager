import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Context } from '../src/context.js';
import { CliError } from '../src/errors.js';
import {
  AGENTS,
  detectAgents,
  getAgent,
  locationByKey,
  resolveGlobalDoc,
  skillsLocations,
} from '../src/agents/registry.js';

let tmp: string;
let home: string;
let ghome: string;
let proj: string;
let ctx: Context;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agman-registry-')));
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

describe('getAgent', () => {
  it('returns the definition for a valid id', () => {
    expect(getAgent('claude-code').name).toBe('Claude Code');
    expect(getAgent('gemini-cli').id).toBe('gemini-cli');
  });

  it('throws CliError listing the valid ids on an unknown id', () => {
    expect(() => getAgent('bogus')).toThrow(CliError);
    expect(() => getAgent('bogus')).toThrow(/claude-code/);
    expect(() => getAgent('bogus')).toThrow(/windsurf/);
  });

  it('exposes six agents with the expected instruction modes', () => {
    expect(AGENTS.map((a) => a.id)).toEqual([
      'claude-code',
      'codex',
      'cursor',
      'copilot',
      'gemini-cli',
      'windsurf',
    ]);
    expect(getAgent('claude-code').instructionMode).toBe('copy');
    expect(getAgent('codex').instructionMode).toBe('agents-native');
    expect(getAgent('gemini-cli').instructionMode).toBe('config');
  });
});

describe('resolveGlobalDoc', () => {
  it("resolves claude-code's global doc under globalRoot (CLAUDE_CONFIG_DIR)", () => {
    expect(resolveGlobalDoc(ctx, getAgent('claude-code'))).toBe(path.join(ghome, 'CLAUDE.md'));
  });

  it('resolves ~-based global docs under home', () => {
    expect(resolveGlobalDoc(ctx, getAgent('codex'))).toBe(path.join(home, '.codex', 'AGENTS.md'));
    expect(resolveGlobalDoc(ctx, getAgent('gemini-cli'))).toBe(
      path.join(home, '.gemini', 'GEMINI.md'),
    );
    expect(resolveGlobalDoc(ctx, getAgent('windsurf'))).toBe(
      path.join(home, '.codeium', 'windsurf', 'memories', 'global_rules.md'),
    );
  });

  it('returns null for agents without a managed global doc', () => {
    expect(resolveGlobalDoc(ctx, getAgent('cursor'))).toBeNull();
    expect(resolveGlobalDoc(ctx, getAgent('copilot'))).toBeNull();
  });
});

describe('skillsLocations', () => {
  it('resolves global dirs against home, except claude which uses globalRoot', () => {
    const byKey = (key: string, scope: 'global' | 'local') =>
      skillsLocations(ctx).find((l) => l.key === key && l.scope === scope)!;
    expect(byKey('claude', 'global').dir).toBe(path.join(ghome, 'skills'));
    expect(byKey('agents', 'global').dir).toBe(path.join(home, '.agents', 'skills'));
    expect(byKey('windsurf', 'global').dir).toBe(
      path.join(home, '.codeium', 'windsurf', 'skills'),
    );
  });

  it('resolves project dirs against projectRoot, honoring the asymmetries', () => {
    const byKey = (key: string) => skillsLocations(ctx).find((l) => l.key === key && l.scope === 'local')!;
    expect(byKey('claude').dir).toBe(path.join(proj, '.claude', 'skills'));
    expect(byKey('agents').dir).toBe(path.join(proj, '.agents', 'skills'));
    // copilot's PROJECT dir is .github/skills (not ~/.copilot)
    expect(byKey('copilot').dir).toBe(path.join(proj, '.github', 'skills'));
  });

  it('marks only claude and agents as primary', () => {
    for (const loc of skillsLocations(ctx)) {
      const expected = loc.key === 'claude' || loc.key === 'agents';
      expect(loc.primary).toBe(expected);
    }
  });

  it('carries the verified visibleTo sets', () => {
    const vis = (key: string) => skillsLocations(ctx).find((l) => l.key === key)!.visibleTo;
    expect(vis('claude')).toEqual(['claude-code', 'copilot', 'windsurf']);
    expect(vis('agents')).toEqual(['codex', 'cursor', 'copilot', 'gemini-cli', 'windsurf']);
    expect(vis('gemini')).toEqual(['gemini-cli']);
  });

  it('returns 12 locations with all-unique resolved dirs', () => {
    const locs = skillsLocations(ctx);
    expect(locs).toHaveLength(12);
    const dirs = locs.map((l) => l.dir);
    expect(new Set(dirs).size).toBe(dirs.length);
  });

  it('dedupes by resolved dir when two locations collide', () => {
    // Force claude:global (globalRoot/skills) to collide with agents:global (~/.agents/skills).
    const collided: Context = { ...ctx, globalRoot: path.join(home, '.agents') };
    const locs = skillsLocations(collided);
    const dup = path.join(home, '.agents', 'skills');
    expect(locs.filter((l) => l.dir === dup)).toHaveLength(1);
    expect(locs).toHaveLength(11);
  });
});

describe('locationByKey', () => {
  it('returns the resolved location for a valid key + scope', () => {
    expect(locationByKey(ctx, 'claude', 'global').dir).toBe(path.join(ghome, 'skills'));
    expect(locationByKey(ctx, 'copilot', 'local').dir).toBe(path.join(proj, '.github', 'skills'));
  });

  it('throws CliError listing valid keys on an unknown key', () => {
    expect(() => locationByKey(ctx, 'nope', 'local')).toThrow(CliError);
    expect(() => locationByKey(ctx, 'nope', 'local')).toThrow(/claude/);
    expect(() => locationByKey(ctx, 'nope', 'local')).toThrow(/windsurf/);
  });
});

describe('detectAgents', () => {
  it('detects claude-code from an existing global root, and nothing else in a bare fixture', () => {
    expect(detectAgents(ctx)).toEqual(['claude-code']);
  });

  it('detects codex when ~/.codex exists', () => {
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    expect(detectAgents(ctx)).toContain('codex');
  });

  it('detects cursor from a project .cursor directory', () => {
    fs.mkdirSync(path.join(proj, '.cursor'), { recursive: true });
    expect(detectAgents(ctx)).toContain('cursor');
  });

  it('detects gemini-cli from a project GEMINI.md file', () => {
    fs.writeFileSync(path.join(proj, 'GEMINI.md'), '# rules\n');
    expect(detectAgents(ctx)).toContain('gemini-cli');
  });
});
