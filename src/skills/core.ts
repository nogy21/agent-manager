import fs from 'node:fs';
import path from 'node:path';
import type { Context, Scope } from '../context.js';
import { CliError } from '../errors.js';
import { parseFrontmatter, serializeFrontmatter } from '../frontmatter.js';

export interface SkillInfo {
  name: string; // directory name
  scope: Scope;
  path: string; // absolute skill directory path
  description: string; // frontmatter `description`, '' if absent
  hasSkillMd: boolean;
  shadowed: boolean; // true on a GLOBAL skill when a local skill with the same name exists
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME_LEN = 64;
const DEFAULT_DESCRIPTION = 'TODO: one-line description of when to use this skill';

const TEMPLATE_BODY = [
  '# {{name}}',
  '',
  '## When to use',
  '',
  'Describe the situations where Claude should reach for this skill.',
  '',
  '## Instructions',
  '',
  'Step-by-step guidance for Claude when the skill is active.',
].join('\n');

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function notFoundError(name: string, scope?: Scope): CliError {
  return new CliError(`skill not found: ${name}${scope ? ` in ${scope} scope` : ''}`);
}

/** Build a SkillInfo for a given name/scope by reading the filesystem. */
function buildInfo(ctx: Context, name: string, scope: Scope): SkillInfo {
  const dir = path.join(skillsDir(ctx, scope), name);
  let hasSkillMd = false;
  let description = '';
  try {
    const content = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    hasSkillMd = true;
    description = parseFrontmatter(content).data.description ?? '';
  } catch {
    // No readable SKILL.md file in this directory.
  }
  // A global skill is shadowed iff a local skill directory with the same name exists.
  const shadowed = scope === 'global' && isDir(path.join(skillsDir(ctx, 'local'), name));
  return { name, scope, path: dir, description, hasSkillMd, shadowed };
}

export function skillsDir(ctx: Context, scope: Scope): string {
  return scope === 'global'
    ? path.join(ctx.globalRoot, 'skills')
    : path.join(ctx.projectRoot, '.claude', 'skills');
}

export function listSkills(ctx: Context, scope?: Scope): SkillInfo[] {
  const scopes: Scope[] = scope ? [scope] : ['global', 'local'];
  const result: SkillInfo[] = [];
  for (const s of scopes) {
    const dir = skillsDir(ctx, s);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // Missing skills dir contributes nothing.
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (!entry.isDirectory()) continue;
      result.push(buildInfo(ctx, entry.name, s));
    }
  }
  result.sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    if (a.scope === b.scope) return 0;
    return a.scope === 'local' ? -1 : 1; // local before global on a tie
  });
  return result;
}

export function findSkill(ctx: Context, name: string, scope?: Scope): SkillInfo | undefined {
  const order: Scope[] = scope ? [scope] : ['local', 'global']; // prefer local
  for (const s of order) {
    if (isDir(path.join(skillsDir(ctx, s), name))) {
      return buildInfo(ctx, name, s);
    }
  }
  return undefined;
}

export function readSkill(
  ctx: Context,
  name: string,
  scope?: Scope,
): { info: SkillInfo; content: string } {
  const info = findSkill(ctx, name, scope);
  if (!info) {
    throw notFoundError(name, scope);
  }
  if (!info.hasSkillMd) {
    throw new CliError(`skill directory exists but has no SKILL.md: ${info.path}`);
  }
  const content = fs.readFileSync(path.join(info.path, 'SKILL.md'), 'utf8');
  return { info, content };
}

export function createSkill(
  ctx: Context,
  name: string,
  opts: { scope: Scope; description?: string },
): SkillInfo {
  if (!NAME_RE.test(name) || name.length > MAX_NAME_LEN) {
    throw new CliError(
      `invalid skill name: ${name} — use lowercase letters, digits and hyphens, ` +
        `hyphen-separated (e.g. my-skill), max ${MAX_NAME_LEN} characters`,
    );
  }
  const dir = path.join(skillsDir(ctx, opts.scope), name);
  if (fs.existsSync(dir)) {
    throw new CliError(`skill already exists: ${dir}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const body = TEMPLATE_BODY.replace('{{name}}', name);
  const content = serializeFrontmatter(
    { name, description: opts.description ?? DEFAULT_DESCRIPTION },
    body,
  );
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  return buildInfo(ctx, name, opts.scope);
}

export function removeSkill(ctx: Context, name: string, scope?: Scope): SkillInfo {
  const info = findSkill(ctx, name, scope);
  if (!info) {
    throw notFoundError(name, scope);
  }
  fs.rmSync(info.path, { recursive: true, force: true });
  return info;
}

export function copySkill(
  ctx: Context,
  name: string,
  to: Scope,
  opts: { force?: boolean } = {},
): SkillInfo {
  const from: Scope = to === 'global' ? 'local' : 'global';
  const src = findSkill(ctx, name, from);
  if (!src) {
    throw new CliError(`skill not found in ${from} scope: ${name}`);
  }
  const destPath = path.join(skillsDir(ctx, to), name);
  if (fs.existsSync(destPath)) {
    if (!opts.force) {
      throw new CliError(`skill already exists at ${destPath} (use --force to overwrite)`);
    }
    fs.rmSync(destPath, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.cpSync(src.path, destPath, { recursive: true });
  return buildInfo(ctx, name, to);
}
