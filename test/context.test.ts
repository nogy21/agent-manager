import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext } from '../src/context.js';
import { CliError } from '../src/errors.js';

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

describe('createContext', () => {
  it('resolves projectRoot from a fixture with .git', () => {
    const root = mkTmp();
    fs.mkdirSync(path.join(root, '.git'));
    const sub = path.join(root, 'sub');
    fs.mkdirSync(sub);

    const ctx = createContext({ cwd: sub, env: { CLAUDE_CONFIG_DIR: '/global/claude' } });

    expect(ctx.cwd).toBe(sub);
    expect(ctx.projectRoot).toBe(root);
    expect(ctx.globalRoot).toBe('/global/claude');
  });

  it('throws CliError when the provided cwd does not exist', () => {
    const root = mkTmp();
    const missing = path.join(root, 'does-not-exist');
    expect(() => createContext({ cwd: missing })).toThrow(CliError);
  });

  it('throws CliError when the provided cwd is a file, not a directory', () => {
    const root = mkTmp();
    const file = path.join(root, 'a-file');
    fs.writeFileSync(file, 'x');
    expect(() => createContext({ cwd: file })).toThrow(CliError);
  });
});
