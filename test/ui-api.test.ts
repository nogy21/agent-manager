import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Context } from '../src/context.js';
import { createUiServer, type UiServer } from '../src/ui/server.js';

let tmp: string;
let globalRoot: string;
let projectRoot: string;
let home: string;
let ctx: Context;
let server: UiServer;

beforeEach(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agman-ui-api-')));
  // globalRoot intentionally NOT created — its presence would mark claude-code detected.
  globalRoot = path.join(tmp, 'ghome');
  projectRoot = path.join(tmp, 'proj');
  home = path.join(tmp, 'home');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  ctx = { globalRoot, projectRoot, cwd: projectRoot, home };
  // port 0 → ephemeral kernel-assigned port (skips the +10 retry loop).
  server = await createUiServer(ctx, { port: 0 });
});

afterEach(async () => {
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function apiUrl(p: string): string {
  return `http://127.0.0.1:${server.port}${p}`;
}

interface CallOpts {
  token?: string | null; // undefined → default token; null → omit the header
  body?: unknown;
}

async function call(method: string, p: string, opts: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = opts.token === undefined ? server.token : opts.token;
  if (token) headers['x-agman-token'] = token;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  return fetch(apiUrl(p), init);
}

// undici's fetch forbids setting the Host header, so exercise the DNS-rebinding
// guard through a raw http.request where an arbitrary Host is allowed.
function rawGet(p: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: server.port, path: p, method: 'GET', headers: { Host: host } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('ui api — security & static', () => {
  it('rejects an /api request without a token (401 JSON)', async () => {
    const res = await call('GET', '/api/status', { token: null });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(typeof data.error).toBe('string');
  });

  it('rejects a request with a wrong Host header (403)', async () => {
    const { status, body } = await rawGet('/api/status', 'evil.example:1234');
    expect(status).toBe(403);
    expect(JSON.parse(body).error).toMatch(/host/i);
  });

  it('allows a localhost Host header through the guard', async () => {
    const { status } = await rawGet('/', `localhost:${server.port}`);
    expect(status).toBe(200);
  });

  it('serves / as HTML without a token', async () => {
    const res = await call('GET', '/', { token: null });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('<title>agman</title>');
  });

  it('serves /app.js with a javascript content-type', async () => {
    const res = await call('GET', '/app.js', { token: null });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('404s an unknown api route', async () => {
    const res = await call('GET', '/api/does-not-exist');
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(typeof data.error).toBe('string');
  });
});

describe('ui api — status', () => {
  it('GET /api/status returns the expected shape', async () => {
    const res = await call('GET', '/api/status');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agents.map((a: { id: string }) => a.id)).toEqual([
      'claude-code',
      'codex',
      'cursor',
      'copilot',
      'gemini-cli',
      'windsurf',
    ]);
    expect(Array.isArray(data.docs)).toBe(true);
    expect(Array.isArray(data.skills)).toBe(true);
    expect(data.hubExists).toBe(false);
    expect(data.projectRoot).toBe(projectRoot);
    expect(typeof data.disabledCount).toBe('number');
    expect(typeof data.shadowedCount).toBe('number');
  });
});

describe('ui api — skills', () => {
  async function createSkill(name: string, extra: Record<string, unknown> = {}): Promise<Response> {
    return call('POST', '/api/skills', { body: { name, location: 'agents', scope: 'local', ...extra } });
  }

  it('creates a skill and returns its info', async () => {
    const res = await createSkill('my-skill', { description: 'do a thing' });
    expect(res.status).toBe(200);
    const info = await res.json();
    expect(info).toMatchObject({
      name: 'my-skill',
      scope: 'local',
      locationKey: 'agents',
      enabled: true,
      hasSkillMd: true,
      description: 'do a thing',
    });
  });

  it('lists a created skill', async () => {
    await createSkill('listed-skill');
    const res = await call('GET', '/api/skills');
    const list = await res.json();
    expect(list.map((s: { name: string }) => s.name)).toContain('listed-skill');
  });

  it('toggles a skill disabled then enabled again', async () => {
    await createSkill('toggle-skill');
    const off = await call('POST', '/api/skills/toggle', {
      body: { name: 'toggle-skill', locationKey: 'agents', scope: 'local', enabled: false },
    });
    expect(off.status).toBe(200);
    expect((await off.json()).enabled).toBe(false);

    const on = await call('POST', '/api/skills/toggle', {
      body: { name: 'toggle-skill', locationKey: 'agents', scope: 'local', enabled: true },
    });
    expect((await on.json()).enabled).toBe(true);
  });

  it('round-trips SKILL.md via content PUT then GET', async () => {
    await createSkill('edit-skill');
    const newBody = '---\nname: edit-skill\ndescription: edited\n---\n# edit-skill\n\nnew body\n';
    const put = await call('PUT', '/api/skills/content', {
      body: { name: 'edit-skill', locationKey: 'agents', scope: 'local', content: newBody },
    });
    expect(put.status).toBe(200);
    expect((await put.json()).ok).toBe(true);

    const get = await call('GET', '/api/skills/content?name=edit-skill&loc=agents&scope=local');
    expect(get.status).toBe(200);
    const data = await get.json();
    expect(data.content).toBe(newBody);
    expect(data.info.name).toBe('edit-skill');
  });

  it('copies a skill into another location', async () => {
    await createSkill('copy-skill');
    const res = await call('POST', '/api/skills/copy', {
      body: { name: 'copy-skill', locationKey: 'claude', scope: 'local' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).locationKey).toBe('claude');

    const list = await (await call('GET', '/api/skills')).json();
    const copies = list.filter((s: { name: string }) => s.name === 'copy-skill');
    expect(copies.map((s: { locationKey: string }) => s.locationKey).sort()).toEqual([
      'agents',
      'claude',
    ]);
  });

  it('deletes a skill', async () => {
    await createSkill('doomed-skill');
    const del = await call('POST', '/api/skills/delete', {
      body: { name: 'doomed-skill', locationKey: 'agents', scope: 'local' },
    });
    expect(del.status).toBe(200);
    const list = await (await call('GET', '/api/skills')).json();
    expect(list.map((s: { name: string }) => s.name)).not.toContain('doomed-skill');
  });

  it('maps a CliError to 400 with a message (duplicate create)', async () => {
    await createSkill('dupe-skill');
    const res = await createSkill('dupe-skill');
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/already exists/);
  });

  it('maps an invalid skill name to 400', async () => {
    const res = await createSkill('Bad Name');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid skill name/);
  });

  it('returns 400 when editing content of a missing skill', async () => {
    const res = await call('PUT', '/api/skills/content', {
      body: { name: 'ghost-skill', locationKey: 'agents', scope: 'local', content: 'x' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not found/);
  });
});

describe('ui api — docs', () => {
  it('initializes the AGENTS.md hub', async () => {
    const res = await call('POST', '/api/docs/init', { body: { key: 'agents' } });
    expect(res.status).toBe(200);
    const info = await res.json();
    expect(info).toMatchObject({ key: 'agents', exists: true, sync: 'hub' });
  });

  it('reports sync states through diverge → diffpair → sync', async () => {
    await call('POST', '/api/docs/init', { body: { key: 'agents' } });
    // Write a diverging CLAUDE.md spoke via the content endpoint.
    await call('PUT', '/api/docs/content', { body: { key: 'claude', content: 'DIVERGED\n' } });

    let docs = await (await call('GET', '/api/docs')).json();
    let claude = docs.find((d: { key: string }) => d.key === 'claude');
    expect(claude.sync).toBe('diverged');

    const diff = await (await call('GET', '/api/docs/diffpair?key=claude')).json();
    expect(diff.same).toBe(false);
    expect(diff.spoke.content).toBe('DIVERGED\n');
    expect(diff.hub.label).toBe('AGENTS.md');

    const sync = await (await call('POST', '/api/docs/sync', { body: {} })).json();
    const claudeResult = sync.find((r: { key: string }) => r.key === 'claude');
    expect(claudeResult.result).toBe('synced');

    docs = await (await call('GET', '/api/docs')).json();
    claude = docs.find((d: { key: string }) => d.key === 'claude');
    expect(claude.sync).toBe('in-sync');
  });

  it('links then unlinks the claude spoke', async () => {
    await call('POST', '/api/docs/init', { body: { key: 'agents' } });

    const link = await call('POST', '/api/docs/link', { body: { key: 'claude' } });
    expect(link.status).toBe(200);
    let claude = (await (await call('GET', '/api/docs')).json()).find(
      (d: { key: string }) => d.key === 'claude',
    );
    expect(claude.isSymlink).toBe(true);
    expect(claude.sync).toBe('linked');

    const unlink = await call('POST', '/api/docs/unlink', { body: { key: 'claude' } });
    expect(unlink.status).toBe(200);
    claude = (await (await call('GET', '/api/docs')).json()).find(
      (d: { key: string }) => d.key === 'claude',
    );
    expect(claude.isSymlink).toBe(false);
    expect(claude.exists).toBe(true);
  });

  it('surfaces a linkDoc CliError as 400 (gemini is not symlink-safe)', async () => {
    await call('POST', '/api/docs/init', { body: { key: 'agents' } });
    const res = await call('POST', '/api/docs/link', { body: { key: 'gemini' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/gemini|symlink/i);
  });
});

describe('ui api — docs AI refresh', () => {
  it('GET /api/docs/refresh-tools lists the three tools with boolean installed flags', async () => {
    const res = await call('GET', '/api/docs/refresh-tools');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tools.map((t: { id: string }) => t.id)).toEqual([
      'claude-code',
      'codex',
      'gemini-cli',
    ]);
    for (const t of data.tools) {
      expect(typeof t.installed).toBe('boolean');
      expect(typeof t.bin).toBe('string');
      expect(typeof t.installHint).toBe('string');
    }
  });

  it('POST /api/docs/refresh with an unknown tool id → 400 listing the valid ids', async () => {
    const res = await call('POST', '/api/docs/refresh', { body: { tool: 'not-a-tool' } });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/unknown refresh tool/);
    expect(error).toMatch(/claude-code/);
    expect(error).toMatch(/codex/);
    expect(error).toMatch(/gemini-cli/);
  });

  it('POST /api/docs/refresh with no tool and an empty PATH → 400 with all install hints', async () => {
    // The handler reads process.env.PATH at request time, so temporarily blank it.
    const savedPath = process.env.PATH;
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agman-empty-path-'));
    process.env.PATH = emptyDir;
    try {
      const res = await call('POST', '/api/docs/refresh', { body: {} });
      expect(res.status).toBe(400);
      const { error } = await res.json();
      expect(error).toMatch(/@anthropic-ai\/claude-code/);
      expect(error).toMatch(/@openai\/codex/);
      expect(error).toMatch(/@google\/gemini-cli/);
    } finally {
      process.env.PATH = savedPath;
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('POST /api/docs/refresh with a known but uninstalled tool → 400 with its install hint', async () => {
    const savedPath = process.env.PATH;
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agman-empty-path-'));
    process.env.PATH = emptyDir;
    try {
      const res = await call('POST', '/api/docs/refresh', { body: { tool: 'codex' } });
      expect(res.status).toBe(400);
      const { error } = await res.json();
      expect(error).toMatch(/codex is not on PATH/);
      expect(error).toMatch(/@openai\/codex/);
    } finally {
      process.env.PATH = savedPath;
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('POST /api/docs/refresh spawns the detached tool with cwd=projectRoot (happy path)', async () => {
    // A fake `claude` that records its working directory then exits, so we can
    // prove the detached spawn actually launched — without running a real agent.
    const binDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agman-fakebin-')));
    const marker = path.join(binDir, 'marker.txt');
    const fakeClaude = path.join(binDir, 'claude');
    fs.writeFileSync(fakeClaude, `#!/bin/sh\necho "$PWD" > ${marker}\n`);
    fs.chmodSync(fakeClaude, 0o755);
    const savedPath = process.env.PATH;
    process.env.PATH = binDir + path.delimiter + (savedPath ?? '');
    try {
      const res = await call('POST', '/api/docs/refresh', { body: { tool: 'claude-code' } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toMatchObject({ started: true, tool: 'claude-code', bin: 'claude' });

      // The child writes the marker asynchronously after detaching; poll (~2s cap).
      let contents: string | null = null;
      for (let i = 0; i < 40; i++) {
        if (fs.existsSync(marker)) {
          contents = fs.readFileSync(marker, 'utf8').trim();
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(contents).toBe(projectRoot);
    } finally {
      process.env.PATH = savedPath;
      fs.rmSync(binDir, { recursive: true, force: true });
    }
  });
});
