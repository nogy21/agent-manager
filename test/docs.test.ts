import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripAnsi } from '../src/colors.js';
import type { Context } from '../src/context.js';
import { CliError } from '../src/errors.js';
import {
  fileCell,
  formatMtime,
  humanSize,
  renderDocsTable,
  scopeCell,
  statusCell,
  syncCell,
} from '../src/docs/commands.js';
import {
  diffDocs,
  docPath,
  docSpecs,
  initDoc,
  linkDoc,
  listDocs,
  readDoc,
  statDoc,
  syncDocs,
  unlinkDoc,
} from '../src/docs/core.js';

let tmp: string;
let globalRoot: string;
let projectRoot: string;
let home: string;
let ctx: Context;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agman-docs-')));
  // NB: globalRoot is intentionally NOT created — claude-code is "detected"
  // whenever its global root exists, so tests create it only when they mean to.
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

const proj = (rel: string): string => path.join(projectRoot, rel);
const agentsFile = (): string => proj('AGENTS.md');
const claudeFile = (): string => proj('CLAUDE.md');
const geminiFile = (): string => proj('GEMINI.md');
const write = (p: string, s: string): void => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
};

describe('docPath', () => {
  it('maps the project-scope keys under projectRoot', () => {
    expect(docPath(ctx, 'agents')).toBe(agentsFile());
    expect(docPath(ctx, 'claude')).toBe(claudeFile());
    expect(docPath(ctx, 'gemini')).toBe(geminiFile());
    expect(docPath(ctx, 'copilot')).toBe(proj(path.join('.github', 'copilot-instructions.md')));
    expect(docPath(ctx, 'claude-local')).toBe(proj('CLAUDE.local.md'));
  });

  it('accepts "local" as an alias of claude-local', () => {
    expect(docPath(ctx, 'local')).toBe(docPath(ctx, 'claude-local'));
  });

  it('resolves the global-scope keys via resolveGlobalDoc', () => {
    expect(docPath(ctx, 'claude-global')).toBe(path.join(globalRoot, 'CLAUDE.md'));
    expect(docPath(ctx, 'codex-global')).toBe(path.join(home, '.codex', 'AGENTS.md'));
    expect(docPath(ctx, 'gemini-global')).toBe(path.join(home, '.gemini', 'GEMINI.md'));
    expect(docPath(ctx, 'windsurf-global')).toBe(
      path.join(home, '.codeium', 'windsurf', 'memories', 'global_rules.md'),
    );
  });

  it('throws CliError listing valid keys on an unknown key', () => {
    expect(() => docPath(ctx, 'bogus')).toThrow(CliError);
    expect(() => docPath(ctx, 'bogus')).toThrow(/agents/);
    expect(() => docPath(ctx, 'bogus')).toThrow(/local → claude-local/);
  });
});

describe('docSpecs', () => {
  it('returns the nine specs in fixed order with the right roles', () => {
    const specs = docSpecs(ctx);
    expect(specs.map((s) => s.key)).toEqual([
      'agents',
      'claude',
      'gemini',
      'copilot',
      'claude-local',
      'claude-global',
      'codex-global',
      'gemini-global',
      'windsurf-global',
    ]);
    expect(specs.find((s) => s.key === 'agents')?.role).toBe('hub');
    expect(specs.find((s) => s.key === 'agents')?.agentId).toBeNull();
    expect(specs.find((s) => s.key === 'claude')?.role).toBe('spoke');
    expect(specs.find((s) => s.key === 'gemini')?.role).toBe('spoke');
    expect(specs.find((s) => s.key === 'copilot')?.role).toBe('aux');
    expect(specs.filter((s) => s.scope === 'global')).toHaveLength(4);
  });

  it('labels global docs with descriptive, config-dir-safe suffixes', () => {
    const byKey = Object.fromEntries(docSpecs(ctx).map((s) => [s.key, s.label]));
    expect(byKey['claude-global']).toBe('CLAUDE.md (global)');
    expect(byKey['codex-global']).toBe('AGENTS.md (codex global)');
    expect(byKey['gemini-global']).toBe('GEMINI.md (global)');
    expect(byKey['windsurf-global']).toBe('global_rules.md (windsurf)');
  });
});

describe('statDoc', () => {
  it('reports a regular file with size, lines, and mtime', () => {
    write(agentsFile(), 'a\nb\n');
    const info = statDoc(ctx, 'agents');
    expect(info.exists).toBe(true);
    expect(info.isSymlink).toBe(false);
    expect(info.size).toBe(4);
    expect(info.lines).toBe(3);
    expect(info.mtime).toBeInstanceOf(Date);
    expect(info.label).toBe('AGENTS.md');
  });

  it('marks the hub with sync "hub"', () => {
    write(agentsFile(), '# hub\n');
    expect(statDoc(ctx, 'agents').sync).toBe('hub');
  });

  it('marks a spoke identical to the hub as in-sync', () => {
    write(agentsFile(), 'X\n');
    write(claudeFile(), 'X\n');
    expect(statDoc(ctx, 'claude').sync).toBe('in-sync');
  });

  it('marks a spoke differing from the hub as diverged', () => {
    write(agentsFile(), 'X\n');
    write(claudeFile(), 'Y\n');
    expect(statDoc(ctx, 'claude').sync).toBe('diverged');
  });

  it('marks a spoke symlinked to the hub as linked', () => {
    write(agentsFile(), 'X\n');
    fs.symlinkSync('AGENTS.md', claudeFile());
    const info = statDoc(ctx, 'claude');
    expect(info.isSymlink).toBe(true);
    expect(info.sync).toBe('linked');
  });

  it('marks an absent spoke (hub present) as missing', () => {
    write(agentsFile(), 'X\n');
    expect(statDoc(ctx, 'claude').sync).toBe('missing');
  });

  it('marks a spoke as n/a when there is no hub', () => {
    write(claudeFile(), 'Y\n');
    expect(statDoc(ctx, 'claude').sync).toBe('n/a');
  });

  it('marks aux docs as n/a regardless of content', () => {
    write(proj('CLAUDE.local.md'), 'notes\n');
    expect(statDoc(ctx, 'claude-local').sync).toBe('n/a');
    expect(statDoc(ctx, 'copilot').sync).toBe('n/a');
  });

  it('reports a dangling symlink as isSymlink true, exists false', () => {
    fs.symlinkSync('nope.md', claudeFile());
    const info = statDoc(ctx, 'claude');
    expect(info.isSymlink).toBe(true);
    expect(info.exists).toBe(false);
    expect(info.symlinkTarget).toBe('nope.md');
  });
});

describe('listDocs', () => {
  it('default view lists only the hub + project docs when nothing is detected', () => {
    const infos = listDocs(ctx);
    expect(infos.map((i) => i.key)).toEqual([
      'agents',
      'claude',
      'gemini',
      'copilot',
      'claude-local',
    ]);
  });

  it('adds codex-global when ~/.codex is detected (but not claude-global)', () => {
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    const keys = listDocs(ctx).map((i) => i.key);
    expect(keys).toContain('codex-global');
    expect(keys).not.toContain('claude-global');
  });

  it('adds claude-global when the global root exists', () => {
    fs.mkdirSync(globalRoot, { recursive: true });
    expect(listDocs(ctx).map((i) => i.key)).toContain('claude-global');
  });

  it('all=true returns every spec in fixed order', () => {
    const keys = listDocs(ctx, { all: true }).map((i) => i.key);
    expect(keys).toEqual(docSpecs(ctx).map((s) => s.key));
    expect(keys).toHaveLength(9);
  });
});

describe('readDoc', () => {
  it('returns the raw content', () => {
    write(agentsFile(), '# hi\ncontent\n');
    const { content, info } = readDoc(ctx, 'agents');
    expect(content).toBe('# hi\ncontent\n');
    expect(info.exists).toBe(true);
  });

  it('throws CliError mentioning init when missing', () => {
    expect(() => readDoc(ctx, 'agents')).toThrow(CliError);
    expect(() => readDoc(ctx, 'agents')).toThrow(/agman docs init agents/);
  });
});

describe('initDoc', () => {
  const headings: Array<[string, string]> = [
    ['agents', '# AGENTS.md'],
    ['claude', '# CLAUDE.md'],
    ['gemini', '# GEMINI.md'],
    ['copilot', '# GitHub Copilot instructions'],
    ['claude-local', '# CLAUDE.local.md'],
    ['claude-global', '# Global Claude Instructions'],
    ['codex-global', '# Global Codex instructions'],
    ['gemini-global', '# Global Gemini instructions'],
    ['windsurf-global', '# Windsurf global rules'],
  ];

  for (const [key, heading] of headings) {
    it(`creates ${key} with heading "${heading}" and its parents`, () => {
      const info = initDoc(ctx, key);
      expect(info.exists).toBe(true);
      const content = fs.readFileSync(info.path, 'utf8');
      expect(content.split('\n')[0]).toBe(heading);
      expect(content.endsWith('\n')).toBe(true);
    });
  }

  it('creates deeply nested parent directories', () => {
    const nested = path.join(tmp, 'fresh', 'nested');
    const ctx2: Context = { ...ctx, globalRoot: nested };
    initDoc(ctx2, 'claude-global');
    expect(fs.existsSync(path.join(nested, 'CLAUDE.md'))).toBe(true);
  });

  it('inits via the "local" alias', () => {
    const info = initDoc(ctx, 'local');
    expect(info.key).toBe('claude-local');
    expect(fs.existsSync(proj('CLAUDE.local.md'))).toBe(true);
  });

  it('refuses to overwrite without force', () => {
    write(agentsFile(), 'keep me\n');
    expect(() => initDoc(ctx, 'agents')).toThrow(CliError);
    expect(fs.readFileSync(agentsFile(), 'utf8')).toBe('keep me\n');
  });

  it('overwrites when force is set', () => {
    write(agentsFile(), 'old\n');
    initDoc(ctx, 'agents', { force: true });
    expect(fs.readFileSync(agentsFile(), 'utf8').split('\n')[0]).toBe('# AGENTS.md');
  });

  it('force replaces a symlink with a real file', () => {
    write(agentsFile(), 'HUB\n');
    fs.symlinkSync('AGENTS.md', claudeFile());
    initDoc(ctx, 'claude', { force: true });
    expect(fs.lstatSync(claudeFile()).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(claudeFile(), 'utf8').split('\n')[0]).toBe('# CLAUDE.md');
  });
});

describe('syncDocs', () => {
  it('syncs every detected spoke from the hub, creating missing files', () => {
    write(agentsFile(), 'HUB\n');
    fs.mkdirSync(proj('.claude'), { recursive: true }); // detect claude-code
    fs.mkdirSync(proj('.gemini'), { recursive: true }); // detect gemini-cli
    const results = syncDocs(ctx);
    expect(results.map((r) => r.key).sort()).toEqual(['claude', 'gemini']);
    expect(results.every((r) => r.result === 'synced')).toBe(true);
    expect(fs.readFileSync(claudeFile(), 'utf8')).toBe('HUB\n');
    expect(fs.readFileSync(geminiFile(), 'utf8')).toBe('HUB\n');
  });

  it('skips undetected spokes that have no file', () => {
    write(agentsFile(), 'HUB\n');
    fs.mkdirSync(proj('.claude'), { recursive: true }); // only claude detected
    const results = syncDocs(ctx);
    expect(results.map((r) => r.key)).toEqual(['claude']);
  });

  it('honors an explicit --to even for an undetected spoke', () => {
    write(agentsFile(), 'HUB\n');
    const results = syncDocs(ctx, { to: ['gemini'] });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ key: 'gemini', result: 'synced' });
    expect(fs.readFileSync(geminiFile(), 'utf8')).toBe('HUB\n');
  });

  it('reports unchanged on a second sync', () => {
    write(agentsFile(), 'HUB\n');
    fs.mkdirSync(proj('.claude'), { recursive: true });
    syncDocs(ctx);
    const results = syncDocs(ctx);
    expect(results[0].result).toBe('unchanged');
  });

  it('leaves a hub-symlinked spoke as linked without writing', () => {
    write(agentsFile(), 'HUB\n');
    fs.symlinkSync('AGENTS.md', claudeFile()); // spoke exists as a link to the hub
    const results = syncDocs(ctx, { to: ['claude'] });
    expect(results[0].result).toBe('linked');
    expect(fs.lstatSync(claudeFile()).isSymbolicLink()).toBe(true);
  });

  it('degrades to skipped-missing-source when the hub is absent (default source)', () => {
    const results = syncDocs(ctx);
    expect(results).toEqual([
      { key: 'agents', path: agentsFile(), result: 'skipped-missing-source' },
    ]);
  });

  it('throws when an explicitly named source is missing', () => {
    expect(() => syncDocs(ctx, { from: 'claude' })).toThrow(CliError);
  });

  it('supports reverse sync from a spoke into the hub', () => {
    write(claudeFile(), 'SPOKE\n');
    const results = syncDocs(ctx, { from: 'claude', to: ['agents'] });
    expect(results[0]).toMatchObject({ key: 'agents', result: 'synced' });
    expect(fs.readFileSync(agentsFile(), 'utf8')).toBe('SPOKE\n');
  });

  it('includes an existing spoke file even when its agent is undetected', () => {
    write(agentsFile(), 'HUB\n');
    write(geminiFile(), 'OLD\n'); // GEMINI.md exists; gemini-cli not otherwise detected
    const results = syncDocs(ctx);
    expect(results.map((r) => r.key)).toEqual(['gemini']);
    expect(results[0].result).toBe('synced');
    expect(fs.readFileSync(geminiFile(), 'utf8')).toBe('HUB\n');
  });

  it('rejects an aux target key', () => {
    write(agentsFile(), 'HUB\n');
    expect(() => syncDocs(ctx, { to: ['claude-local'] })).toThrow(CliError);
  });
});

describe('linkDoc', () => {
  it('links claude with a relative symlink to the hub', () => {
    write(agentsFile(), 'HUB\n');
    const res = linkDoc(ctx, 'claude');
    expect(res.linkPath).toBe(claudeFile());
    expect(res.targetPath).toBe(agentsFile());
    expect(fs.readlinkSync(claudeFile())).toBe('AGENTS.md');
    expect(fs.readFileSync(claudeFile(), 'utf8')).toBe('HUB\n');
  });

  it('refuses gemini and points at sync (upstream bug)', () => {
    write(agentsFile(), 'HUB\n');
    expect(() => linkDoc(ctx, 'gemini')).toThrow(CliError);
    expect(() => linkDoc(ctx, 'gemini')).toThrow(/sync/);
  });

  it('refuses copilot as reading AGENTS.md natively', () => {
    write(agentsFile(), 'HUB\n');
    expect(() => linkDoc(ctx, 'copilot')).toThrow(/natively/);
  });

  it('refuses the hub itself as not a spoke', () => {
    write(agentsFile(), 'HUB\n');
    expect(() => linkDoc(ctx, 'agents')).toThrow(/spoke/);
  });

  it('replaces an existing symlink without force', () => {
    write(agentsFile(), 'HUB\n');
    write(proj('OTHER.md'), 'other\n');
    fs.symlinkSync('OTHER.md', claudeFile());
    linkDoc(ctx, 'claude');
    expect(fs.readlinkSync(claudeFile())).toBe('AGENTS.md');
  });

  it('refuses a regular spoke file without force', () => {
    write(agentsFile(), 'HUB\n');
    write(claudeFile(), 'real\n');
    expect(() => linkDoc(ctx, 'claude')).toThrow(CliError);
    expect(fs.lstatSync(claudeFile()).isSymbolicLink()).toBe(false);
  });

  it('replaces a regular spoke file with force', () => {
    write(agentsFile(), 'HUB\n');
    write(claudeFile(), 'real\n');
    linkDoc(ctx, 'claude', { force: true });
    expect(fs.lstatSync(claudeFile()).isSymbolicLink()).toBe(true);
  });

  it('throws when the hub is missing', () => {
    expect(() => linkDoc(ctx, 'claude')).toThrow(CliError);
  });
});

describe('unlinkDoc', () => {
  it('materializes a symlinked spoke into a real copy of the hub', () => {
    write(agentsFile(), 'HUB\n');
    linkDoc(ctx, 'claude');
    const res = unlinkDoc(ctx, 'claude');
    expect(res.path).toBe(claudeFile());
    expect(fs.lstatSync(claudeFile()).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(claudeFile(), 'utf8')).toBe('HUB\n');
  });

  it('throws when the spoke is not a symlink', () => {
    write(claudeFile(), 'real\n');
    expect(() => unlinkDoc(ctx, 'claude')).toThrow(CliError);
  });
});

describe('diffDocs', () => {
  it('reports identical hub and spoke as same (defaulting to claude)', () => {
    write(agentsFile(), 'X\n');
    write(claudeFile(), 'X\n');
    expect(diffDocs(ctx).same).toBe(true);
  });

  it('reports differing hub and spoke', () => {
    write(agentsFile(), 'X\n');
    write(claudeFile(), 'Y\n');
    expect(diffDocs(ctx).same).toBe(false);
  });

  it('diffs an explicit gemini spoke', () => {
    write(agentsFile(), 'X\n');
    write(geminiFile(), 'X\n');
    expect(diffDocs(ctx, 'gemini').same).toBe(true);
  });

  it('throws naming the missing side', () => {
    write(agentsFile(), 'only hub\n');
    expect(() => diffDocs(ctx)).toThrow(/CLAUDE\.md/);
  });
});

describe('doc cells (command helpers)', () => {
  const plain = (s: string): string => stripAnsi(s);

  it('fileCell returns the full label', () => {
    write(agentsFile(), 'x\n');
    expect(fileCell(statDoc(ctx, 'agents'))).toBe('AGENTS.md');
    expect(fileCell(statDoc(ctx, 'claude-global'))).toBe('CLAUDE.md (global)');
  });

  it('scopeCell distinguishes local and global', () => {
    expect(plain(scopeCell(statDoc(ctx, 'claude')))).toBe('local');
    expect(plain(scopeCell(statDoc(ctx, 'claude-global')))).toBe('global');
  });

  it('statusCell reports ok / missing / symlink / broken', () => {
    write(agentsFile(), 'x\n');
    expect(plain(statusCell(statDoc(ctx, 'agents')))).toBe('ok');
    expect(plain(statusCell(statDoc(ctx, 'claude')))).toBe('missing');
    fs.symlinkSync('AGENTS.md', claudeFile());
    expect(plain(statusCell(statDoc(ctx, 'claude')))).toBe('symlink → AGENTS.md');
    fs.symlinkSync('nope.md', geminiFile());
    expect(plain(statusCell(statDoc(ctx, 'gemini')))).toBe('broken → nope.md');
  });

  it('syncCell renders hub / in sync / diverged / missing / n-a', () => {
    write(agentsFile(), 'X\n');
    expect(plain(syncCell(statDoc(ctx, 'agents')))).toBe('hub');
    write(claudeFile(), 'X\n');
    expect(plain(syncCell(statDoc(ctx, 'claude')))).toBe('in sync');
    fs.writeFileSync(claudeFile(), 'Y\n');
    expect(plain(syncCell(statDoc(ctx, 'claude')))).toBe('diverged');
    expect(plain(syncCell(statDoc(ctx, 'gemini')))).toBe('-'); // missing spoke
    expect(plain(syncCell(statDoc(ctx, 'claude-local')))).toBe('-'); // aux → n/a
  });

  it('syncCell renders linked for a hub symlink', () => {
    write(agentsFile(), 'X\n');
    fs.symlinkSync('AGENTS.md', claudeFile());
    expect(plain(syncCell(statDoc(ctx, 'claude')))).toBe('linked');
  });

  it('humanSize formats bytes and kilobytes', () => {
    expect(humanSize(512)).toBe('512 B');
    expect(humanSize(2048)).toBe('2.0 KB');
  });

  it('formatMtime formats a date as YYYY-MM-DD HH:MM', () => {
    expect(formatMtime(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02 03:04');
  });

  it('renderDocsTable includes the FILE and SYNC headers and the hub row', () => {
    write(agentsFile(), 'x\n');
    const table = plain(renderDocsTable(listDocs(ctx)));
    expect(table).toContain('FILE');
    expect(table).toContain('SYNC');
    expect(table).toContain('AGENTS.md');
  });
});
