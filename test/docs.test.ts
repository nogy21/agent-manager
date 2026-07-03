import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Context, Scope } from '../src/context.js';
import { CliError } from '../src/errors.js';
import {
  compareDocs,
  docPath,
  initDoc,
  linkDocs,
  listDocs,
  readDoc,
  statDoc,
  syncDocs,
  type DocTarget,
} from '../src/docs/core.js';

let tmp: string;
let globalRoot: string;
let projectRoot: string;
let ctx: Context;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agman-docs-')));
  globalRoot = path.join(tmp, 'ghome');
  projectRoot = path.join(tmp, 'proj');
  fs.mkdirSync(globalRoot, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  ctx = { globalRoot, projectRoot, cwd: projectRoot };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const claudeFile = (): string => path.join(projectRoot, 'CLAUDE.md');
const agentsFile = (): string => path.join(projectRoot, 'AGENTS.md');
const localFile = (): string => path.join(projectRoot, 'CLAUDE.local.md');
const globalClaude = (): string => path.join(globalRoot, 'CLAUDE.md');

describe('docPath', () => {
  it('maps claude/global to <globalRoot>/CLAUDE.md', () => {
    expect(docPath(ctx, 'claude', 'global')).toBe(globalClaude());
  });
  it('maps claude/local to <projectRoot>/CLAUDE.md', () => {
    expect(docPath(ctx, 'claude', 'local')).toBe(claudeFile());
  });
  it('maps agents/local to <projectRoot>/AGENTS.md', () => {
    expect(docPath(ctx, 'agents', 'local')).toBe(agentsFile());
  });
  it('maps local/local to <projectRoot>/CLAUDE.local.md', () => {
    expect(docPath(ctx, 'local', 'local')).toBe(localFile());
  });
  it('throws for agents at global scope', () => {
    expect(() => docPath(ctx, 'agents', 'global')).toThrow(CliError);
  });
  it('throws for local at global scope', () => {
    expect(() => docPath(ctx, 'local', 'global')).toThrow(CliError);
  });
});

describe('statDoc', () => {
  it('reports a regular file with size, lines, and mtime', () => {
    fs.writeFileSync(claudeFile(), 'a\nb\n');
    const info = statDoc(ctx, 'claude', 'local');
    expect(info.exists).toBe(true);
    expect(info.isSymlink).toBe(false);
    expect(info.size).toBe(4);
    expect(info.lines).toBe(3);
    expect(info.mtime).toBeInstanceOf(Date);
    expect(info.label).toBe('CLAUDE.md');
  });

  it('reports a missing file as not existing', () => {
    const info = statDoc(ctx, 'claude', 'local');
    expect(info.exists).toBe(false);
    expect(info.isSymlink).toBe(false);
    expect(info.size).toBeUndefined();
    expect(info.mtime).toBeUndefined();
  });

  it('follows a valid symlink (exists, isSymlink, symlinkTarget)', () => {
    fs.writeFileSync(claudeFile(), 'hello\n');
    fs.symlinkSync('CLAUDE.md', agentsFile());
    const info = statDoc(ctx, 'agents', 'local');
    expect(info.isSymlink).toBe(true);
    expect(info.symlinkTarget).toBe('CLAUDE.md');
    expect(info.exists).toBe(true);
    expect(info.lines).toBe(2);
  });

  it('reports a dangling symlink (isSymlink true, exists false)', () => {
    fs.symlinkSync('nope.md', agentsFile());
    const info = statDoc(ctx, 'agents', 'local');
    expect(info.isSymlink).toBe(true);
    expect(info.exists).toBe(false);
    expect(info.symlinkTarget).toBe('nope.md');
  });
});

describe('listDocs', () => {
  it('returns the four docs in a fixed order', () => {
    const infos = listDocs(ctx);
    expect(infos).toHaveLength(4);
    expect(infos.map((i) => [i.target, i.scope])).toEqual([
      ['claude', 'global'],
      ['claude', 'local'],
      ['local', 'local'],
      ['agents', 'local'],
    ]);
  });
});

describe('readDoc', () => {
  it('returns the raw content', () => {
    fs.writeFileSync(claudeFile(), '# hi\ncontent\n');
    const { content, info } = readDoc(ctx, 'claude', 'local');
    expect(content).toBe('# hi\ncontent\n');
    expect(info.exists).toBe(true);
  });

  it('throws CliError when missing', () => {
    expect(() => readDoc(ctx, 'claude', 'local')).toThrow(CliError);
  });
});

describe('initDoc', () => {
  const cases: Array<{ name: string; target: DocTarget; scope: Scope; heading: string }> = [
    { name: 'claude/global', target: 'claude', scope: 'global', heading: '# Global Claude Instructions' },
    { name: 'claude/local', target: 'claude', scope: 'local', heading: '# CLAUDE.md' },
    { name: 'local/local', target: 'local', scope: 'local', heading: '# CLAUDE.local.md' },
    { name: 'agents/local', target: 'agents', scope: 'local', heading: '# AGENTS.md' },
  ];

  for (const { name, target, scope, heading } of cases) {
    it(`creates ${name} with the expected heading`, () => {
      const info = initDoc(ctx, target, scope);
      expect(info.exists).toBe(true);
      const content = fs.readFileSync(info.path, 'utf8');
      expect(content.split('\n')[0]).toBe(heading);
      expect(content.endsWith('\n')).toBe(true);
    });
  }

  it('creates missing parent directories', () => {
    const freshGlobal = path.join(tmp, 'fresh', 'nested');
    const ctx2: Context = { globalRoot: freshGlobal, projectRoot, cwd: projectRoot };
    const info = initDoc(ctx2, 'claude', 'global');
    expect(fs.existsSync(path.join(freshGlobal, 'CLAUDE.md'))).toBe(true);
    expect(info.exists).toBe(true);
  });

  it('refuses to overwrite an existing file without force', () => {
    fs.writeFileSync(claudeFile(), 'keep me\n');
    expect(() => initDoc(ctx, 'claude', 'local')).toThrow(CliError);
    expect(fs.readFileSync(claudeFile(), 'utf8')).toBe('keep me\n');
  });

  it('overwrites when force is set', () => {
    fs.writeFileSync(claudeFile(), 'old\n');
    initDoc(ctx, 'claude', 'local', { force: true });
    expect(fs.readFileSync(claudeFile(), 'utf8').split('\n')[0]).toBe('# CLAUDE.md');
  });
});

describe('linkDocs', () => {
  it('makes AGENTS.md a relative symlink to CLAUDE.md by default', () => {
    fs.writeFileSync(claudeFile(), 'source\n');
    const res = linkDocs(ctx);
    expect(res.linkPath).toBe(agentsFile());
    expect(res.targetPath).toBe(claudeFile());
    expect(fs.readlinkSync(agentsFile())).toBe('CLAUDE.md');
    expect(fs.readFileSync(agentsFile(), 'utf8')).toBe('source\n');
  });

  it('replaces an existing symlink without force', () => {
    fs.writeFileSync(claudeFile(), 'source\n');
    fs.writeFileSync(path.join(projectRoot, 'OTHER.md'), 'other\n');
    fs.symlinkSync('OTHER.md', agentsFile());
    linkDocs(ctx);
    expect(fs.readlinkSync(agentsFile())).toBe('CLAUDE.md');
  });

  it('refuses to replace a regular AGENTS.md without force', () => {
    fs.writeFileSync(claudeFile(), 'source\n');
    fs.writeFileSync(agentsFile(), 'real agents\n');
    expect(() => linkDocs(ctx)).toThrow(CliError);
    expect(fs.lstatSync(agentsFile()).isSymbolicLink()).toBe(false);
  });

  it('replaces a regular AGENTS.md when force is set', () => {
    fs.writeFileSync(claudeFile(), 'source\n');
    fs.writeFileSync(agentsFile(), 'real agents\n');
    linkDocs(ctx, { force: true });
    expect(fs.lstatSync(agentsFile()).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(agentsFile())).toBe('CLAUDE.md');
  });

  it('throws when the source is missing', () => {
    expect(() => linkDocs(ctx)).toThrow(CliError);
  });

  it('links CLAUDE.md to AGENTS.md when source is agents', () => {
    fs.writeFileSync(agentsFile(), 'agents source\n');
    const res = linkDocs(ctx, { source: 'agents' });
    expect(res.linkPath).toBe(claudeFile());
    expect(res.targetPath).toBe(agentsFile());
    expect(fs.readlinkSync(claudeFile())).toBe('AGENTS.md');
  });
});

describe('syncDocs', () => {
  it('copies content and reports changed true', () => {
    fs.writeFileSync(claudeFile(), 'from claude\n');
    const res = syncDocs(ctx, { source: 'claude' });
    expect(res.changed).toBe(true);
    expect(res.fromPath).toBe(claudeFile());
    expect(res.toPath).toBe(agentsFile());
    expect(fs.readFileSync(agentsFile(), 'utf8')).toBe('from claude\n');
  });

  it('reports changed false on a second run', () => {
    fs.writeFileSync(claudeFile(), 'from claude\n');
    syncDocs(ctx, { source: 'claude' });
    const res = syncDocs(ctx, { source: 'claude' });
    expect(res.changed).toBe(false);
  });

  it('throws when the destination is a symlink to the source', () => {
    fs.writeFileSync(claudeFile(), 'src\n');
    fs.symlinkSync('CLAUDE.md', agentsFile());
    expect(() => syncDocs(ctx, { source: 'claude' })).toThrow(CliError);
  });

  it('throws when the source is missing', () => {
    expect(() => syncDocs(ctx, { source: 'claude' })).toThrow(CliError);
  });
});

describe('compareDocs', () => {
  it('reports identical files as same', () => {
    fs.writeFileSync(claudeFile(), 'same\n');
    fs.writeFileSync(agentsFile(), 'same\n');
    expect(compareDocs(ctx).same).toBe(true);
  });

  it('reports differing files as not same', () => {
    fs.writeFileSync(claudeFile(), 'one\n');
    fs.writeFileSync(agentsFile(), 'two\n');
    expect(compareDocs(ctx).same).toBe(false);
  });

  it('throws when a file is missing', () => {
    fs.writeFileSync(claudeFile(), 'only claude\n');
    expect(() => compareDocs(ctx)).toThrow(CliError);
  });
});
