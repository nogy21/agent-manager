import fs from 'node:fs';
import path from 'node:path';
import type { Context } from '../context.js';
import { CliError } from '../errors.js';

/**
 * Claude Code's per-project skill visibility, as stored in `.claude/settings.json`
 * (shared) and `.claude/settings.local.json` (personal). A skill absent from the map
 * is treated as `'on'`. `'off'` hides the skill from Claude Code in that project.
 */
export type SkillOverrideState = 'on' | 'name-only' | 'user-invocable-only' | 'off';

const OVERRIDE_STATES: readonly SkillOverrideState[] = [
  'on',
  'name-only',
  'user-invocable-only',
  'off',
];

/** The `.claude` settings files that carry `skillOverrides`, in precedence order (last wins). */
const SETTINGS_FILES = ['settings.json', 'settings.local.json'] as const;

/** The write target: personal, gitignored, matching Claude's own `/skills` menu default. */
const WRITE_FILE = 'settings.local.json';

function claudeDir(ctx: Context): string {
  return path.join(ctx.projectRoot, '.claude');
}

function isOverrideState(v: unknown): v is SkillOverrideState {
  return typeof v === 'string' && (OVERRIDE_STATES as readonly string[]).includes(v);
}

/** Extract a validated `skillOverrides` map from an arbitrary parsed settings object. */
function extractOverrides(parsed: unknown): Record<string, SkillOverrideState> {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const raw = (parsed as Record<string, unknown>).skillOverrides;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, SkillOverrideState> = {};
  for (const [name, state] of Object.entries(raw as Record<string, unknown>)) {
    if (isOverrideState(state)) result[name] = state;
  }
  return result;
}

/**
 * Lenient read of one settings file's `skillOverrides`. A missing file or malformed
 * JSON yields `{}` so listing never crashes on a broken settings file.
 */
function readOverridesFile(file: string): Record<string, SkillOverrideState> {
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return {}; // missing file
  }
  try {
    return extractOverrides(JSON.parse(content));
  } catch {
    return {}; // malformed JSON — tolerate for reads
  }
}

/**
 * The project's effective `skillOverrides`, merging `.claude/settings.json` then
 * `.claude/settings.local.json` (local wins). Lenient: broken files are ignored.
 */
export function readEffectiveOverrides(ctx: Context): Record<string, SkillOverrideState> {
  const dir = claudeDir(ctx);
  let merged: Record<string, SkillOverrideState> = {};
  for (const name of SETTINGS_FILES) {
    merged = { ...merged, ...readOverridesFile(path.join(dir, name)) };
  }
  return merged;
}

/** The effective override for a single skill name (default `'on'` when unset). */
export function effectiveOverride(ctx: Context, name: string): SkillOverrideState {
  return readEffectiveOverrides(ctx)[name] ?? 'on';
}

/**
 * Strict read of the write-target file (`settings.local.json`) as a plain object.
 * A missing file yields `{}`. A present-but-malformed file throws `CliError` so a
 * write never clobbers the user's settings.
 */
function readWriteTarget(file: string): Record<string, unknown> {
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return {}; // missing file — a fresh object is fine to create
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new CliError(
      `refusing to modify malformed JSON: ${file} (fix it, then retry)`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError(
      `refusing to modify ${file}: expected a JSON object at the top level`,
    );
  }
  return parsed as Record<string, unknown>;
}

/**
 * Set Claude Code's applicability for a skill in this project, writing ONLY to
 * `.claude/settings.local.json` (personal, gitignored). `'off'` hides the skill from
 * Claude Code; `'on'` restores the default by removing the key. All other settings
 * keys are preserved. Throws `CliError` if the target file exists but is malformed.
 */
export function setClaudeApplicability(
  ctx: Context,
  name: string,
  state: 'on' | 'off',
): void {
  const dir = claudeDir(ctx);
  const file = path.join(dir, WRITE_FILE);
  const settings = readWriteTarget(file);

  const rawOverrides = settings.skillOverrides;
  const overrides: Record<string, unknown> =
    rawOverrides !== null && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)
      ? { ...(rawOverrides as Record<string, unknown>) }
      : {};

  if (state === 'off') {
    overrides[name] = 'off';
  } else {
    delete overrides[name]; // default is 'on'
  }

  if (Object.keys(overrides).length === 0) {
    delete settings.skillOverrides;
  } else {
    settings.skillOverrides = overrides;
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}
