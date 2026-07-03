import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findProjectRoot, getGlobalRoot } from '../src/paths.js';

const created: string[] = [];

function mkTmp(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agman-')));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length) {
    fs.rmSync(created.pop()!, { recursive: true, force: true });
  }
});

describe('getGlobalRoot', () => {
  it('uses CLAUDE_CONFIG_DIR when set', () => {
    expect(getGlobalRoot({ CLAUDE_CONFIG_DIR: '/custom/claude' })).toBe('/custom/claude');
  });

  it('resolves a relative CLAUDE_CONFIG_DIR to an absolute path', () => {
    expect(getGlobalRoot({ CLAUDE_CONFIG_DIR: 'rel-dir' })).toBe(path.resolve('rel-dir'));
  });

  it('falls back to ~/.claude when unset', () => {
    expect(getGlobalRoot({})).toBe(path.join(os.homedir(), '.claude'));
  });

  it('ignores an empty CLAUDE_CONFIG_DIR', () => {
    expect(getGlobalRoot({ CLAUDE_CONFIG_DIR: '' })).toBe(path.join(os.homedir(), '.claude'));
  });
});

describe('findProjectRoot', () => {
  it('finds a directory containing a .git directory', () => {
    const root = mkTmp();
    fs.mkdirSync(path.join(root, '.git'));
    expect(findProjectRoot(root)).toBe(root);
  });

  it('finds a directory containing a .git file (worktree/submodule)', () => {
    const root = mkTmp();
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
    expect(findProjectRoot(root)).toBe(root);
  });

  it('finds a directory containing a .claude directory', () => {
    const root = mkTmp();
    fs.mkdirSync(path.join(root, '.claude'));
    expect(findProjectRoot(root)).toBe(root);
  });

  it('resolves to the nearest ancestor from a nested subdir', () => {
    const root = mkTmp();
    fs.mkdirSync(path.join(root, '.git'));
    const nested = path.join(root, 'a', 'b', 'c');
    fs.mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(root);
  });

  it('returns the startDir itself when no marker exists anywhere above', () => {
    const root = mkTmp();
    const sub = path.join(root, 'no-markers-here');
    fs.mkdirSync(sub);
    expect(findProjectRoot(sub)).toBe(sub);
  });
});
