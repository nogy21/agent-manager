import fs from 'node:fs';
import path from 'node:path';
import type { Context, Scope } from '../context.js';
import { CliError } from '../errors.js';
import {
  agentsTemplate,
  claudeGlobalTemplate,
  claudeLocalTemplate,
  claudeProjectTemplate,
} from './templates.js';

export type DocTarget = 'claude' | 'agents' | 'local';

export interface DocInfo {
  target: DocTarget;
  scope: Scope;
  path: string; // absolute
  label: string; // 'CLAUDE.md (global)' | 'CLAUDE.md' | 'CLAUDE.local.md' | 'AGENTS.md'
  exists: boolean; // true iff readable content exists (broken symlink -> false)
  isSymlink: boolean;
  symlinkTarget?: string; // raw readlink value when isSymlink
  size?: number; // bytes, when exists
  lines?: number; // when exists
  mtime?: Date; // when exists
}

function docLabel(target: DocTarget, scope: Scope): string {
  if (target === 'agents') return 'AGENTS.md';
  if (target === 'local') return 'CLAUDE.local.md';
  return scope === 'global' ? 'CLAUDE.md (global)' : 'CLAUDE.md';
}

export function docPath(ctx: Context, target: DocTarget, scope: Scope): string {
  if (target === 'claude') {
    return scope === 'global'
      ? path.join(ctx.globalRoot, 'CLAUDE.md')
      : path.join(ctx.projectRoot, 'CLAUDE.md');
  }
  if (target === 'agents') {
    if (scope === 'global') {
      throw new CliError('AGENTS.md exists at project scope only');
    }
    return path.join(ctx.projectRoot, 'AGENTS.md');
  }
  // target === 'local'
  if (scope === 'global') {
    throw new CliError('CLAUDE.local.md exists at project scope only');
  }
  return path.join(ctx.projectRoot, 'CLAUDE.local.md');
}

function templateFor(target: DocTarget, scope: Scope): string {
  if (target === 'agents') return agentsTemplate;
  if (target === 'local') return claudeLocalTemplate;
  return scope === 'global' ? claudeGlobalTemplate : claudeProjectTemplate;
}

export function statDoc(ctx: Context, target: DocTarget, scope: Scope): DocInfo {
  const p = docPath(ctx, target, scope);
  const info: DocInfo = {
    target,
    scope,
    path: p,
    label: docLabel(target, scope),
    exists: false,
    isSymlink: false,
  };

  const link = fs.lstatSync(p, { throwIfNoEntry: false });
  if (!link) {
    return info; // nothing at this path at all
  }

  if (link.isSymbolicLink()) {
    info.isSymlink = true;
    try {
      info.symlinkTarget = fs.readlinkSync(p);
    } catch {
      // an unreadable link value is non-fatal
    }
  }

  // statSync / readFileSync follow symlinks; a dangling link (or a directory)
  // throws here and leaves exists false while isSymlink stays true.
  try {
    const content = fs.readFileSync(p, 'utf8');
    const s = fs.statSync(p);
    info.exists = true;
    info.size = s.size;
    info.mtime = s.mtime;
    info.lines = content.split('\n').length;
  } catch {
    // not a readable file (dangling symlink, directory, permissions)
  }

  return info;
}

export function listDocs(ctx: Context): DocInfo[] {
  return [
    statDoc(ctx, 'claude', 'global'),
    statDoc(ctx, 'claude', 'local'),
    statDoc(ctx, 'local', 'local'),
    statDoc(ctx, 'agents', 'local'),
  ];
}

export function readDoc(
  ctx: Context,
  target: DocTarget,
  scope: Scope,
): { info: DocInfo; content: string } {
  const info = statDoc(ctx, target, scope);
  if (!info.exists) {
    throw new CliError(`not found: ${info.path} (create it with "agman docs init ${target}...")`);
  }
  const content = fs.readFileSync(info.path, 'utf8');
  return { info, content };
}

export function initDoc(
  ctx: Context,
  target: DocTarget,
  scope: Scope,
  opts: { force?: boolean } = {},
): DocInfo {
  const p = docPath(ctx, target, scope);
  const existing = statDoc(ctx, target, scope);
  if (existing.exists && !opts.force) {
    throw new CliError(`already exists: ${p} (use --force to overwrite)`);
  }
  // The global root may not exist yet on a fresh machine.
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, templateFor(target, scope), 'utf8');
  return statDoc(ctx, target, scope);
}

export function linkDocs(
  ctx: Context,
  opts: { source?: 'claude' | 'agents'; force?: boolean } = {},
): { linkPath: string; targetPath: string } {
  const source = opts.source ?? 'claude';
  const claudePath = docPath(ctx, 'claude', 'local');
  const agentsPath = docPath(ctx, 'agents', 'local');

  // The source is the source of truth (the real file); the OTHER file becomes the symlink.
  const targetPath = source === 'claude' ? claudePath : agentsPath;
  const linkPath = source === 'claude' ? agentsPath : claudePath;

  const src = statDoc(ctx, source, 'local');
  if (!src.exists) {
    throw new CliError(
      `source not found: ${targetPath} (create it with "agman docs init ${source}")`,
    );
  }

  const existing = fs.lstatSync(linkPath, { throwIfNoEntry: false });
  if (existing) {
    if (existing.isSymbolicLink()) {
      fs.rmSync(linkPath); // replace a stale symlink
    } else if (opts.force) {
      fs.rmSync(linkPath);
    } else {
      throw new CliError(`${linkPath} exists and is a regular file (use --force to replace it)`);
    }
  }

  // Relative symlink: both files live in the project root, so the target is just the basename.
  fs.symlinkSync(path.basename(targetPath), linkPath);
  return { linkPath, targetPath };
}

export function syncDocs(
  ctx: Context,
  opts: { source: 'claude' | 'agents' },
): { fromPath: string; toPath: string; changed: boolean } {
  const claudePath = docPath(ctx, 'claude', 'local');
  const agentsPath = docPath(ctx, 'agents', 'local');
  const fromPath = opts.source === 'claude' ? claudePath : agentsPath;
  const toPath = opts.source === 'claude' ? agentsPath : claudePath;

  const src = statDoc(ctx, opts.source, 'local');
  if (!src.exists) {
    throw new CliError(
      `source not found: ${fromPath} (create it with "agman docs init ${opts.source}")`,
    );
  }

  // If the destination is a symlink that resolves to the source, no copy is needed.
  const destLink = fs.lstatSync(toPath, { throwIfNoEntry: false });
  if (destLink && destLink.isSymbolicLink()) {
    const raw = fs.readlinkSync(toPath);
    const resolved = path.resolve(path.dirname(toPath), raw);
    if (resolved === fromPath) {
      throw new CliError(`${toPath} is a symlink to ${fromPath}; already in sync (no copy needed)`);
    }
  }

  const fromContent = fs.readFileSync(fromPath);
  let changed = true;
  const dest = fs.statSync(toPath, { throwIfNoEntry: false });
  if (dest && dest.isFile()) {
    changed = !fromContent.equals(fs.readFileSync(toPath));
  }
  if (changed) {
    fs.writeFileSync(toPath, fromContent);
  }
  return { fromPath, toPath, changed };
}

export function compareDocs(ctx: Context): { a: DocInfo; b: DocInfo; same: boolean } {
  const a = statDoc(ctx, 'claude', 'local');
  const b = statDoc(ctx, 'agents', 'local');

  const missing: string[] = [];
  if (!a.exists) missing.push('CLAUDE.md');
  if (!b.exists) missing.push('AGENTS.md');
  if (missing.length > 0) {
    throw new CliError(`not found: ${missing.join(' and ')} (nothing to compare)`);
  }

  const same = fs.readFileSync(a.path, 'utf8') === fs.readFileSync(b.path, 'utf8');
  return { a, b, same };
}
