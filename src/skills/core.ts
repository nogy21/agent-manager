import fs from 'node:fs';
import path from 'node:path';
import { locationByKey, skillsLocations, type AgentId } from '../agents/registry.js';
import type { Context, Scope } from '../context.js';
import { CliError } from '../errors.js';
import { parseFrontmatter, serializeFrontmatter } from '../frontmatter.js';
import { readEffectiveOverrides, type SkillOverrideState } from './overrides.js';

export interface SkillInfo {
  name: string;
  scope: Scope;
  locationKey: string; // 'claude' | 'agents' | ...
  path: string; // absolute skill dir (enabled: under location dir; disabled: under <dir>.disabled)
  description: string; // frontmatter `description`, '' if absent
  hasSkillMd: boolean;
  enabled: boolean;
  visibleTo: AgentId[]; // [] when disabled
  shadowed: boolean; // a global skill shadowed by an enabled local skill sharing >=1 agent
  // Claude Code's per-project applicability (from `.claude/settings*.json` skillOverrides).
  // Set ONLY for skills visible to Claude Code; `undefined` otherwise. Default 'on'.
  claudeApplicability?: SkillOverrideState;
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME_LEN = 64;
const DEFAULT_DESCRIPTION = 'TODO: one-line description of when to use this skill';
const DEFAULT_LOCATION = 'agents';

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

function notFoundError(name: string, scope?: Scope): CliError {
  return new CliError(`skill not found: ${name}${scope ? ` in ${scope} scope` : ''}`);
}

function isValidName(name: string): boolean {
  return NAME_RE.test(name) && name.length <= MAX_NAME_LEN;
}

function assertValidName(name: string): void {
  if (!isValidName(name)) {
    throw new CliError(
      `invalid skill name: ${name} — use lowercase letters, digits and hyphens, ` +
        `hyphen-separated (e.g. my-skill), max ${MAX_NAME_LEN} characters`,
    );
  }
}

/** The `<dir>.disabled` sibling of a location's enabled directory. */
function disabledDir(dir: string): string {
  return dir + '.disabled';
}

/** Names of immediate subdirectories (no dot-dirs, no files); [] if missing. */
function subdirNames(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => !e.name.startsWith('.') && e.isDirectory()).map((e) => e.name);
}

function readSkillMeta(dir: string): { hasSkillMd: boolean; description: string } {
  try {
    const content = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    return { hasSkillMd: true, description: parseFrontmatter(content).data.description ?? '' };
  } catch {
    return { hasSkillMd: false, description: '' };
  }
}

/** A skill before its cross-location `shadowed` flag is computed. */
type RawSkill = Omit<SkillInfo, 'shadowed'>;

/** Scan every skills location (both scopes) plus each `<dir>.disabled` sibling. */
function scanAll(ctx: Context): RawSkill[] {
  const result: RawSkill[] = [];
  for (const loc of skillsLocations(ctx)) {
    for (const name of subdirNames(loc.dir)) {
      const dir = path.join(loc.dir, name);
      result.push({
        name,
        scope: loc.scope,
        locationKey: loc.key,
        path: dir,
        enabled: true,
        visibleTo: loc.visibleTo,
        ...readSkillMeta(dir),
      });
    }
    const dis = disabledDir(loc.dir);
    for (const name of subdirNames(dis)) {
      const dir = path.join(dis, name);
      result.push({
        name,
        scope: loc.scope,
        locationKey: loc.key,
        path: dir,
        enabled: false,
        visibleTo: [], // a disabled skill is visible to no agent
        ...readSkillMeta(dir),
      });
    }
  }
  return result;
}

/**
 * A global skill is shadowed iff an enabled local skill with the same name shares
 * at least one visibleTo agent (i.e. some agent would see the local copy instead).
 */
function withShadowed(raw: RawSkill[]): SkillInfo[] {
  const enabledLocalVisibility = new Map<string, AgentId[][]>();
  for (const s of raw) {
    if (s.scope === 'local' && s.enabled) {
      const arr = enabledLocalVisibility.get(s.name) ?? [];
      arr.push(s.visibleTo);
      enabledLocalVisibility.set(s.name, arr);
    }
  }
  return raw.map((s) => {
    let shadowed = false;
    if (s.scope === 'global' && s.enabled) {
      const locals = enabledLocalVisibility.get(s.name) ?? [];
      shadowed = locals.some((lv) => lv.some((a) => s.visibleTo.includes(a)));
    }
    return { ...s, shadowed };
  });
}

/** Comparator implementing findSkill's preference order. */
function preferenceComparator(ctx: Context): (a: SkillInfo, b: SkillInfo) => number {
  const primaryKeys = new Set(skillsLocations(ctx).filter((l) => l.primary).map((l) => l.key));
  return (a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1; // enabled over disabled
    if (a.scope !== b.scope) return a.scope === 'local' ? -1 : 1; // local over global
    const ap = primaryKeys.has(a.locationKey) ? 0 : 1;
    const bp = primaryKeys.has(b.locationKey) ? 0 : 1;
    if (ap !== bp) return ap - bp; // primary locations first
    if (a.locationKey !== b.locationKey) return a.locationKey < b.locationKey ? -1 : 1;
    return 0;
  };
}

/**
 * Attach Claude Code's per-project applicability to every skill visible to Claude Code.
 * Reads the effective `skillOverrides` once (not per skill); leaves other skills untouched.
 */
function withClaudeApplicability(ctx: Context, skills: SkillInfo[]): SkillInfo[] {
  const overrides = readEffectiveOverrides(ctx);
  return skills.map((s) =>
    s.visibleTo.includes('claude-code')
      ? { ...s, claudeApplicability: overrides[s.name] ?? 'on' }
      : s,
  );
}

function allSkills(ctx: Context): SkillInfo[] {
  return withClaudeApplicability(ctx, withShadowed(scanAll(ctx)));
}

export function listSkills(
  ctx: Context,
  opts: { scope?: Scope; agent?: AgentId; includeDisabled?: boolean } = {},
): SkillInfo[] {
  const includeDisabled = opts.includeDisabled ?? true;
  let skills = allSkills(ctx);
  if (opts.scope) skills = skills.filter((s) => s.scope === opts.scope);
  if (!includeDisabled) skills = skills.filter((s) => s.enabled);
  if (opts.agent) {
    // agent filter matches visibility; disabled skills (visibleTo []) drop out.
    const agent = opts.agent;
    skills = skills.filter((s) => s.enabled && s.visibleTo.includes(agent));
  }
  skills.sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    if (a.scope !== b.scope) return a.scope === 'local' ? -1 : 1; // local before global on ties
    if (a.locationKey !== b.locationKey) return a.locationKey < b.locationKey ? -1 : 1;
    return 0;
  });
  return skills;
}

export function findSkill(
  ctx: Context,
  name: string,
  opts: { scope?: Scope; locationKey?: string } = {},
): SkillInfo | undefined {
  let candidates = allSkills(ctx).filter((s) => s.name === name);
  if (opts.scope) candidates = candidates.filter((s) => s.scope === opts.scope);
  if (opts.locationKey) candidates = candidates.filter((s) => s.locationKey === opts.locationKey);
  if (candidates.length === 0) return undefined;
  candidates.sort(preferenceComparator(ctx));
  return candidates[0];
}

function requireSkill(
  ctx: Context,
  name: string,
  opts: { scope?: Scope; locationKey?: string } = {},
): SkillInfo {
  const info = findSkill(ctx, name, opts);
  if (!info) throw notFoundError(name, opts.scope);
  return info;
}

export function readSkill(
  ctx: Context,
  name: string,
  opts: { scope?: Scope; locationKey?: string } = {},
): { info: SkillInfo; content: string } {
  const info = findSkill(ctx, name, opts);
  if (!info) throw notFoundError(name, opts.scope);
  if (!info.hasSkillMd) {
    throw new CliError(`skill directory exists but has no SKILL.md: ${info.path}`);
  }
  const content = fs.readFileSync(path.join(info.path, 'SKILL.md'), 'utf8');
  return { info, content };
}

export function createSkill(
  ctx: Context,
  name: string,
  opts: { location?: string; scope?: Scope; description?: string } = {},
): SkillInfo {
  assertValidName(name);
  const key = opts.location ?? DEFAULT_LOCATION;
  const scope: Scope = opts.scope ?? 'local';
  const loc = locationByKey(ctx, key, scope);
  const dir = path.join(loc.dir, name);
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
  return requireSkill(ctx, name, { scope, locationKey: key });
}

export function removeSkill(
  ctx: Context,
  name: string,
  opts: { scope?: Scope; locationKey?: string } = {},
): SkillInfo {
  const info = findSkill(ctx, name, opts);
  if (!info) throw notFoundError(name, opts.scope);
  fs.rmSync(info.path, { recursive: true, force: true });
  return info;
}

function copyInto(srcPath: string, destDir: string, name: string, force?: boolean): void {
  const destPath = path.join(destDir, name);
  if (fs.existsSync(destPath)) {
    if (!force) {
      throw new CliError(`skill already exists at ${destPath} (use --force to overwrite)`);
    }
    fs.rmSync(destPath, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.cpSync(srcPath, destPath, { recursive: true });
}

export function copySkill(
  ctx: Context,
  name: string,
  to: { locationKey: string; scope: Scope },
  opts: { force?: boolean } = {},
): SkillInfo {
  const dest = locationByKey(ctx, to.locationKey, to.scope);
  // Source is any skill with this name, excluding the destination location itself.
  const candidates = allSkills(ctx).filter(
    (s) => s.name === name && !(s.locationKey === to.locationKey && s.scope === to.scope),
  );
  candidates.sort(preferenceComparator(ctx));
  const src = candidates[0];
  if (!src) throw notFoundError(name);
  copyInto(src.path, dest.dir, name, opts.force);
  return requireSkill(ctx, name, { scope: to.scope, locationKey: to.locationKey });
}

export function installSkill(
  ctx: Context,
  sourcePath: string,
  to: { locationKey: string; scope: Scope },
  opts: { force?: boolean } = {},
): SkillInfo {
  const abs = path.resolve(sourcePath);
  const stat = fs.statSync(abs, { throwIfNoEntry: false });
  if (!stat) throw new CliError(`source path does not exist: ${abs}`);
  if (!stat.isDirectory()) throw new CliError(`source path is not a directory: ${abs}`);

  let skillMd: string;
  try {
    skillMd = fs.readFileSync(path.join(abs, 'SKILL.md'), 'utf8');
  } catch {
    throw new CliError(`source directory has no SKILL.md: ${abs}`);
  }

  const fmName = parseFrontmatter(skillMd).data.name ?? '';
  const name = isValidName(fmName) ? fmName : path.basename(abs);
  assertValidName(name);

  const dest = locationByKey(ctx, to.locationKey, to.scope);
  copyInto(abs, dest.dir, name, opts.force);
  return requireSkill(ctx, name, { scope: to.scope, locationKey: to.locationKey });
}

export function setSkillEnabled(
  ctx: Context,
  name: string,
  enabled: boolean,
  opts: { scope?: Scope; locationKey?: string } = {},
): SkillInfo {
  const matching = allSkills(ctx).filter((s) => {
    if (s.name !== name) return false;
    if (opts.scope && s.scope !== opts.scope) return false;
    if (opts.locationKey && s.locationKey !== opts.locationKey) return false;
    return true;
  });
  if (matching.length === 0) throw notFoundError(name, opts.scope);

  const comparator = preferenceComparator(ctx);
  // The instance to toggle lives in the opposite of the desired state.
  const toToggle = matching.filter((s) => s.enabled !== enabled).sort(comparator)[0];
  if (!toToggle) {
    // Nothing to move: every match is already in the desired state (no-op).
    return matching.sort(comparator)[0];
  }

  const loc = locationByKey(ctx, toToggle.locationKey, toToggle.scope);
  const target = enabled
    ? path.join(loc.dir, name)
    : path.join(disabledDir(loc.dir), name);
  if (fs.existsSync(target)) {
    throw new CliError(
      `cannot ${enabled ? 'enable' : 'disable'} ${name}: a skill already exists at ${target}`,
    );
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(toToggle.path, target);
  return requireSkill(ctx, name, { scope: toToggle.scope, locationKey: toToggle.locationKey });
}
