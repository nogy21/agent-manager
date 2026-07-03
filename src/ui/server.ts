import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context, Scope } from '../context.js';
import { CliError } from '../errors.js';
import {
  diffDocs,
  docPath,
  initDoc,
  linkDoc,
  listDocs,
  readDoc,
  syncDocs,
  unlinkDoc,
} from '../docs/core.js';
import {
  copySkill,
  createSkill,
  findSkill,
  listSkills,
  readSkill,
  removeSkill,
  setSkillEnabled,
} from '../skills/core.js';
import { gatherStatus } from '../status.js';

export interface UiServer {
  server: http.Server;
  port: number;
  url: string;
  token: string;
  close(): Promise<void>;
}

const DEFAULT_PORT = 4400;
const MAX_PORT_TRIES = 10; // basePort .. basePort+10
const MAX_BODY = 1024 * 1024; // 1 MiB

// Resolves to <pkg>/public whether we run from dist/ui/server.js or src/ui/server.ts.
const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));

const STATIC_FILES: Record<string, string> = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/style.css': 'style.css',
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

type Json = Record<string, unknown>;

interface RouteArgs {
  ctx: Context;
  body: Json;
  query: URLSearchParams;
}

type RouteHandler = (args: RouteArgs) => unknown | Promise<unknown>;

// ---- request field coercion (clients send names/keys, never filesystem paths) ----

function reqStr(body: Json, field: string): string {
  const v = body[field];
  if (typeof v !== 'string') throw new CliError(`missing or invalid field: ${field}`);
  return v;
}

function optStr(body: Json, field: string): string | undefined {
  const v = body[field];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new CliError(`invalid field: ${field}`);
  return v;
}

function reqBool(body: Json, field: string): boolean {
  const v = body[field];
  if (typeof v !== 'boolean') throw new CliError(`missing or invalid field: ${field}`);
  return v;
}

function optBool(body: Json, field: string): boolean | undefined {
  const v = body[field];
  if (v === undefined || v === null) return undefined;
  return Boolean(v);
}

function asScope(v: unknown): Scope | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (v === 'global' || v === 'local') return v;
  throw new CliError(`invalid scope: ${String(v)} (use "global" or "local")`);
}

function reqScope(v: unknown): Scope {
  const scope = asScope(v);
  if (!scope) throw new CliError('missing scope (use "global" or "local")');
  return scope;
}

function asStringArray(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  throw new CliError('invalid "to" (expected an array of doc keys)');
}

function reqQuery(query: URLSearchParams, key: string): string {
  const v = query.get(key);
  if (v === null || v === '') throw new CliError(`missing query parameter: ${key}`);
  return v;
}

// ---- routing table: "METHOD /path" → handler ----

const routes: Record<string, RouteHandler> = {
  'GET /api/status': ({ ctx }) => gatherStatus(ctx),

  'GET /api/skills': ({ ctx }) => listSkills(ctx),
  'POST /api/skills': ({ ctx, body }) =>
    createSkill(ctx, reqStr(body, 'name'), {
      location: optStr(body, 'location'),
      scope: asScope(body.scope),
      description: optStr(body, 'description'),
    }),
  'POST /api/skills/toggle': ({ ctx, body }) =>
    setSkillEnabled(ctx, reqStr(body, 'name'), reqBool(body, 'enabled'), {
      scope: asScope(body.scope),
      locationKey: optStr(body, 'locationKey'),
    }),
  'POST /api/skills/delete': ({ ctx, body }) =>
    removeSkill(ctx, reqStr(body, 'name'), {
      scope: asScope(body.scope),
      locationKey: optStr(body, 'locationKey'),
    }),
  'POST /api/skills/copy': ({ ctx, body }) =>
    copySkill(
      ctx,
      reqStr(body, 'name'),
      { locationKey: reqStr(body, 'locationKey'), scope: reqScope(body.scope) },
      { force: optBool(body, 'force') },
    ),
  'GET /api/skills/content': ({ ctx, query }) => {
    const name = reqQuery(query, 'name');
    return readSkill(ctx, name, {
      locationKey: query.get('loc') || undefined,
      scope: asScope(query.get('scope')),
    });
  },
  'PUT /api/skills/content': ({ ctx, body }) => {
    const name = reqStr(body, 'name');
    const content = reqStr(body, 'content');
    const info = findSkill(ctx, name, {
      scope: asScope(body.scope),
      locationKey: optStr(body, 'locationKey'),
    });
    if (!info) throw new CliError(`skill not found: ${name}`);
    fs.writeFileSync(path.join(info.path, 'SKILL.md'), content);
    return { ok: true };
  },

  'GET /api/docs': ({ ctx }) => listDocs(ctx, { all: true }),
  'GET /api/docs/content': ({ ctx, query }) => readDoc(ctx, reqQuery(query, 'key')),
  'PUT /api/docs/content': ({ ctx, body }) => {
    const key = reqStr(body, 'key');
    const content = reqStr(body, 'content');
    const p = docPath(ctx, key);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return { ok: true };
  },
  'POST /api/docs/init': ({ ctx, body }) =>
    initDoc(ctx, reqStr(body, 'key'), { force: optBool(body, 'force') }),
  'POST /api/docs/sync': ({ ctx, body }) =>
    syncDocs(ctx, { from: optStr(body, 'from'), to: asStringArray(body.to) }),
  'POST /api/docs/link': ({ ctx, body }) =>
    linkDoc(ctx, reqStr(body, 'key'), { force: optBool(body, 'force') }),
  'POST /api/docs/unlink': ({ ctx, body }) => unlinkDoc(ctx, reqStr(body, 'key')),
  'GET /api/docs/diffpair': ({ ctx, query }) => {
    const { hub, spoke, same } = diffDocs(ctx, query.get('key') || undefined);
    return {
      same,
      hub: { label: hub.label, content: fs.readFileSync(hub.path, 'utf8') },
      spoke: { label: spoke.label, content: fs.readFileSync(spoke.path, 'utf8') },
    };
  },
};

// ---- HTTP plumbing ----

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data ?? null));
}

function readJsonBody(req: http.IncomingMessage): Promise<Json> {
  return new Promise<Json>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new CliError('request body too large (max 1 MiB)'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new CliError('request body must be a JSON object'));
          return;
        }
        resolve(parsed as Json);
      } catch {
        reject(new CliError('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res: http.ServerResponse, pathname: string): void {
  // Whitelist-only, plus a defensive traversal guard.
  if (pathname.includes('..')) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('bad request');
    return;
  }
  const file = STATIC_FILES[pathname];
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  let content: Buffer;
  try {
    content = fs.readFileSync(path.join(PUBLIC_DIR, file));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
  });
  res.end(content);
}

async function handleApi(
  ctx: Context,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<void> {
  const routeKey = `${req.method ?? 'GET'} ${url.pathname}`;
  const handler = routes[routeKey];
  if (!handler) {
    sendJson(res, 404, { error: `unknown route: ${routeKey}` });
    return;
  }
  try {
    let body: Json = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      body = await readJsonBody(req);
    }
    const result = await handler({ ctx, body, query: url.searchParams });
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof CliError) {
      sendJson(res, 400, { error: err.message });
    } else {
      sendJson(res, 500, { error: (err as Error)?.message ?? 'internal error' });
    }
  }
}

async function handleRequest(
  ctx: Context,
  token: string,
  port: number,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  // DNS-rebinding guard: only trust requests whose Host is our loopback authority.
  const host = req.headers.host ?? '';
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    sendJson(res, 403, { error: 'forbidden host' });
    return;
  }

  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

  if (url.pathname.startsWith('/api/')) {
    if (req.headers['x-agman-token'] !== token) {
      sendJson(res, 401, { error: 'unauthorized (missing or wrong x-agman-token)' });
      return;
    }
    await handleApi(ctx, req, res, url);
    return;
  }

  serveStatic(res, url.pathname);
}

export function createUiServer(
  ctx: Context,
  opts: { port?: number; token?: string } = {},
): Promise<UiServer> {
  const token = opts.token ?? crypto.randomBytes(16).toString('hex');
  const basePort = opts.port ?? DEFAULT_PORT;
  const ephemeral = basePort === 0; // port 0 → kernel-assigned ephemeral port (tests)

  return new Promise<UiServer>((resolve, reject) => {
    let boundPort = 0;
    let settled = false;
    let attempt = 0;

    const server = http.createServer((req, res) => {
      handleRequest(ctx, token, boundPort, req, res).catch((err: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        }
        res.end(JSON.stringify({ error: (err as Error)?.message ?? 'internal error' }));
      });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return; // post-listen errors are swallowed rather than crashing
      if (err.code === 'EADDRINUSE' && !ephemeral && attempt < MAX_PORT_TRIES) {
        attempt += 1;
        server.listen(basePort + attempt, '127.0.0.1');
        return;
      }
      settled = true;
      if (err.code === 'EADDRINUSE') {
        reject(
          new CliError(
            `no free port in ${basePort}-${basePort + MAX_PORT_TRIES} ` +
              `(is another agman ui already running?)`,
          ),
        );
      } else {
        reject(err);
      }
    });

    server.on('listening', () => {
      if (settled) return;
      settled = true;
      const addr = server.address();
      boundPort = addr && typeof addr === 'object' ? addr.port : basePort;
      resolve({
        server,
        port: boundPort,
        url: `http://127.0.0.1:${boundPort}/#${token}`,
        token,
        close: () =>
          new Promise<void>((res2, rej2) => {
            server.close((e) => (e ? rej2(e) : res2()));
          }),
      });
    });

    server.listen(ephemeral ? 0 : basePort, '127.0.0.1');
  });
}
