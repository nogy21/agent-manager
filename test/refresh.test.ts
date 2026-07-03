import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Context } from '../src/context.js';
import { CliError } from '../src/errors.js';
import {
  REFRESH_TOOLS,
  buildRefreshPrompt,
  detectRefreshTools,
  runRefresh,
} from '../src/docs/refresh.js';

let tmp: string;
let globalRoot: string;
let projectRoot: string;
let home: string;
let ctx: Context;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agman-refresh-')));
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

/** Create a fresh PATH dir holding fake `bin` executables (chmod 755). */
function binDir(bins: string[], body = '#!/bin/sh\nexit 0\n'): string {
  const dir = fs.mkdtempSync(path.join(tmp, 'bin-'));
  for (const b of bins) {
    const p = path.join(dir, b);
    fs.writeFileSync(p, body);
    fs.chmodSync(p, 0o755);
  }
  return dir;
}

describe('REFRESH_TOOLS', () => {
  it('lists the three agent CLIs with their bins and args', () => {
    expect(REFRESH_TOOLS.map((t) => t.id)).toEqual(['claude-code', 'codex', 'gemini-cli']);
    const byId = Object.fromEntries(REFRESH_TOOLS.map((t) => [t.id, t]));
    expect(byId['claude-code'].bin).toBe('claude');
    expect(byId['claude-code'].buildArgs('P')).toEqual(['-p', 'P']);
    expect(byId['codex'].bin).toBe('codex');
    expect(byId['codex'].buildArgs('P')).toEqual(['exec', 'P']);
    expect(byId['gemini-cli'].bin).toBe('gemini');
    expect(byId['gemini-cli'].buildArgs('P')).toEqual(['-p', 'P']);
  });
});

describe('detectRefreshTools', () => {
  it('detects exactly the tools present, in REFRESH_TOOLS order', () => {
    const dir = binDir(['claude', 'gemini']);
    const found = detectRefreshTools({ PATH: dir });
    expect(found.map((t) => t.id)).toEqual(['claude-code', 'gemini-cli']);
  });

  it('orders by REFRESH_TOOLS, not by PATH entry order', () => {
    // gemini first on PATH, then codex, then claude — result must still be canonical.
    const g = binDir(['gemini']);
    const c = binDir(['codex']);
    const a = binDir(['claude']);
    const found = detectRefreshTools({ PATH: [g, c, a].join(path.delimiter) });
    expect(found.map((t) => t.id)).toEqual(['claude-code', 'codex', 'gemini-cli']);
  });

  it('returns [] for an empty PATH', () => {
    expect(detectRefreshTools({ PATH: '' })).toEqual([]);
    expect(detectRefreshTools({})).toEqual([]);
  });

  it('ignores a non-executable file and a directory named like a bin', () => {
    const dir = binDir([]);
    fs.writeFileSync(path.join(dir, 'codex'), '#!/bin/sh\n'); // mode 644, not executable
    fs.mkdirSync(path.join(dir, 'claude')); // a directory, not a file
    expect(detectRefreshTools({ PATH: dir })).toEqual([]);
  });
});

describe('buildRefreshPrompt', () => {
  it('names the basename, the project root, and constrains edits to ONLY that file', () => {
    const docPathAbs = path.join(projectRoot, 'AGENTS.md');
    const prompt = buildRefreshPrompt(ctx, 'agents', docPathAbs);
    expect(prompt).toContain('AGENTS.md');
    expect(prompt).toContain(projectRoot);
    expect(prompt).toContain('ONLY');
    // sanity: a handful of lines, English, mentions the required review topics
    expect(prompt.split('\n').length).toBeGreaterThanOrEqual(5);
    expect(prompt).toMatch(/commands/i);
  });

  it('uses the basename of whichever doc path is passed', () => {
    const prompt = buildRefreshPrompt(ctx, 'claude', path.join(projectRoot, 'CLAUDE.md'));
    expect(prompt).toContain('CLAUDE.md');
  });
});

describe('runRefresh — validation', () => {
  it('rejects an unknown --tool, listing the valid ids', () => {
    const dir = binDir(['claude']);
    expect(() => runRefresh(ctx, { tool: 'bogus', env: { PATH: dir } })).toThrow(CliError);
    expect(() => runRefresh(ctx, { tool: 'bogus', env: { PATH: dir } })).toThrow(
      /claude-code, codex, gemini-cli/,
    );
  });

  it('rejects a known --tool that is not installed, with its install hint', () => {
    const dir = binDir(['claude']); // codex not present
    expect(() => runRefresh(ctx, { tool: 'codex', env: { PATH: dir } })).toThrow(CliError);
    expect(() => runRefresh(ctx, { tool: 'codex', env: { PATH: dir } })).toThrow(
      /npm install -g @openai\/codex/,
    );
  });

  it('errors listing every install hint when nothing is installed', () => {
    let msg = '';
    try {
      runRefresh(ctx, { env: { PATH: '' } });
    } catch (err) {
      msg = (err as CliError).message;
    }
    expect(msg).toContain('@anthropic-ai/claude-code');
    expect(msg).toContain('@openai/codex');
    expect(msg).toContain('@google/gemini-cli');
  });

  it('rejects an unknown --doc key', () => {
    const dir = binDir(['claude']);
    expect(() => runRefresh(ctx, { doc: 'bogus', env: { PATH: dir } })).toThrow(CliError);
  });
});

describe('runRefresh — dry run', () => {
  it('previews the first detected tool without spawning', () => {
    const dir = binDir(['claude']);
    const res = runRefresh(ctx, { dryRun: true, env: { PATH: dir } });
    expect(res.ran).toBe(false);
    expect(res.exitCode).toBeNull();
    expect(res.tool.id).toBe('claude-code');
    expect(res.command.startsWith('claude -p ')).toBe(true);
    // the long prompt is collapsed to one line and truncated
    expect(res.command).not.toContain('\n');
    expect(res.command).toContain('…');
  });

  it('honors an explicit installed --tool even when it is not first', () => {
    const dir = binDir(['claude', 'gemini']);
    const res = runRefresh(ctx, { tool: 'gemini-cli', dryRun: true, env: { PATH: dir } });
    expect(res.tool.id).toBe('gemini-cli');
    expect(res.command.startsWith('gemini -p ')).toBe(true);
  });

  it('does not invoke the onSpawn callback on a dry run', () => {
    const dir = binDir(['claude']);
    const onSpawn = vi.fn();
    runRefresh(ctx, { dryRun: true, env: { PATH: dir }, onSpawn });
    expect(onSpawn).not.toHaveBeenCalled();
  });
});

describe('runRefresh — real spawn', () => {
  it('runs the tool in the project root and returns its exit code', () => {
    const marker = path.join(tmp, 'marker.txt');
    // The fake claude records its args and cwd, proving how it was launched.
    const dir = binDir(['claude'], '#!/bin/sh\necho "$@" > "$MARKER"\npwd >> "$MARKER"\n');
    const onSpawn = vi.fn();
    const res = runRefresh(ctx, {
      env: { ...process.env, PATH: dir, MARKER: marker },
      onSpawn,
    });
    expect(res.ran).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(onSpawn).toHaveBeenCalledTimes(1);
    expect(onSpawn.mock.calls[0][0].id).toBe('claude-code');

    const out = fs.readFileSync(marker, 'utf8');
    expect(out.startsWith('-p ')).toBe(true); // argv[0] was the -p flag
    expect(out).toContain('AGENTS.md'); // the prompt targets the hub
    expect(out.trim().split('\n').pop()).toBe(projectRoot); // spawned with cwd = projectRoot
  });

  it('surfaces a nonzero exit code from the tool', () => {
    const dir = binDir(['claude'], '#!/bin/sh\nexit 3\n');
    const res = runRefresh(ctx, { env: { ...process.env, PATH: dir } });
    expect(res.ran).toBe(true);
    expect(res.exitCode).toBe(3);
  });
});
