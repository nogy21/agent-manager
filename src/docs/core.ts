import fs from 'node:fs';
import path from 'node:path';
import {
  detectAgents,
  getAgent,
  resolveGlobalDoc,
  type AgentId,
} from '../agents/registry.js';
import type { Context, Scope } from '../context.js';
import { CliError } from '../errors.js';
import {
  agentsTemplate,
  claudeGlobalTemplate,
  claudeLocalTemplate,
  claudeProjectTemplate,
  codexGlobalTemplate,
  copilotTemplate,
  geminiGlobalTemplate,
  geminiTemplate,
  windsurfGlobalTemplate,
} from './templates.js';

export interface DocSpec {
  key: string; // CLI name
  label: string; // display label
  agentId: AgentId | null; // owning agent, or null for the shared hub
  scope: Scope;
  role: 'hub' | 'spoke' | 'aux';
}

export interface DocInfo extends DocSpec {
  path: string; // absolute
  exists: boolean;
  isSymlink: boolean;
  symlinkTarget?: string;
  size?: number;
  lines?: number;
  mtime?: Date;
  // hub: this IS the hub; linked: symlink resolving to hub path;
  // in-sync/diverged: byte-compare vs hub (spokes only, both exist);
  // missing: spoke file absent; n/a: aux, or hub missing.
  sync: 'hub' | 'in-sync' | 'diverged' | 'linked' | 'missing' | 'n/a';
}

/** Internal spec: DocSpec plus how to resolve its path and its init template. */
interface SpecDef extends DocSpec {
  projectRel?: string; // relative to projectRoot (scope 'local')
  globalAgent?: AgentId; // resolveGlobalDoc(getAgent(globalAgent)) (scope 'global')
  template: string;
}

const HUB_KEY = 'agents';

// Fixed order — every consumer relies on it.
const SPEC_DEFS: SpecDef[] = [
  {
    key: 'agents',
    label: 'AGENTS.md',
    agentId: null,
    scope: 'local',
    role: 'hub',
    projectRel: 'AGENTS.md',
    template: agentsTemplate,
  },
  {
    key: 'claude',
    label: 'CLAUDE.md',
    agentId: 'claude-code',
    scope: 'local',
    role: 'spoke',
    projectRel: 'CLAUDE.md',
    template: claudeProjectTemplate,
  },
  {
    key: 'gemini',
    label: 'GEMINI.md',
    agentId: 'gemini-cli',
    scope: 'local',
    role: 'spoke',
    projectRel: 'GEMINI.md',
    template: geminiTemplate,
  },
  {
    key: 'copilot',
    label: '.github/copilot-instructions.md',
    agentId: 'copilot',
    scope: 'local',
    role: 'aux',
    projectRel: path.join('.github', 'copilot-instructions.md'),
    template: copilotTemplate,
  },
  {
    key: 'claude-local',
    label: 'CLAUDE.local.md',
    agentId: 'claude-code',
    scope: 'local',
    role: 'aux',
    projectRel: 'CLAUDE.local.md',
    template: claudeLocalTemplate,
  },
  {
    key: 'claude-global',
    label: 'CLAUDE.md (global)',
    agentId: 'claude-code',
    scope: 'global',
    role: 'aux',
    globalAgent: 'claude-code',
    template: claudeGlobalTemplate,
  },
  {
    key: 'codex-global',
    label: 'AGENTS.md (codex global)',
    agentId: 'codex',
    scope: 'global',
    role: 'aux',
    globalAgent: 'codex',
    template: codexGlobalTemplate,
  },
  {
    key: 'gemini-global',
    label: 'GEMINI.md (global)',
    agentId: 'gemini-cli',
    scope: 'global',
    role: 'aux',
    globalAgent: 'gemini-cli',
    template: geminiGlobalTemplate,
  },
  {
    key: 'windsurf-global',
    label: 'global_rules.md (windsurf)',
    agentId: 'windsurf',
    scope: 'global',
    role: 'aux',
    globalAgent: 'windsurf',
    template: windsurfGlobalTemplate,
  },
];

const ALIASES: Record<string, string> = { local: 'claude-local' };

// Spoke keys (own instruction files agman keeps synced from the hub).
const SPOKE_KEYS = ['claude', 'gemini'];
// Valid explicit sync targets: the spokes plus the hub itself (reverse sync).
const SYNCABLE_KEYS = [HUB_KEY, ...SPOKE_KEYS];
// Keys whose agent has an OWN project instruction file that could be symlinked.
const LINKABLE_KEYS = ['claude', 'gemini', 'copilot'];

function canonicalKey(key: string): string {
  return ALIASES[key] ?? key;
}

function validKeysMessage(): string {
  return `${SPEC_DEFS.map((s) => s.key).join(', ')} (alias: local → claude-local)`;
}

function findSpec(key: string): SpecDef {
  const canon = canonicalKey(key);
  const spec = SPEC_DEFS.find((s) => s.key === canon);
  if (!spec) {
    throw new CliError(`unknown doc "${key}" (valid: ${validKeysMessage()})`);
  }
  return spec;
}

/** Read a file's raw bytes, or null when it is absent/unreadable. */
function readFileBuffer(p: string): Buffer | null {
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

/** Does any node (file, dir, or even a dangling symlink) exist at this path? */
function nodeExists(p: string): boolean {
  return fs.lstatSync(p, { throwIfNoEntry: false }) !== undefined;
}

export function docSpecs(_ctx: Context): DocSpec[] {
  return SPEC_DEFS.map(({ key, label, agentId, scope, role }) => ({
    key,
    label,
    agentId,
    scope,
    role,
  }));
}

export function docPath(ctx: Context, key: string): string {
  const spec = findSpec(key);
  if (spec.scope === 'global') {
    const resolved = resolveGlobalDoc(ctx, getAgent(spec.globalAgent as AgentId));
    if (resolved === null) {
      throw new CliError(`no global doc path for ${spec.key}`);
    }
    return resolved;
  }
  return path.join(ctx.projectRoot, spec.projectRel as string);
}

/** Resolve a symlink's target to an absolute path (or null on error). */
function resolvedLinkTarget(info: DocInfo): string | null {
  if (!info.isSymlink || info.symlinkTarget === undefined) return null;
  return path.resolve(path.dirname(info.path), info.symlinkTarget);
}

function computeSync(ctx: Context, spec: SpecDef, info: DocInfo): DocInfo['sync'] {
  if (spec.role === 'hub') return 'hub';
  if (spec.role === 'aux') return 'n/a';
  // spoke — compare against the hub.
  const hubPath = docPath(ctx, HUB_KEY);
  if (resolvedLinkTarget(info) === hubPath) return 'linked';
  const hubContent = readFileBuffer(hubPath);
  if (hubContent === null) return 'n/a'; // no hub to compare against
  if (!info.exists) return 'missing';
  const spokeContent = readFileBuffer(info.path);
  if (spokeContent === null) return 'missing';
  return spokeContent.equals(hubContent) ? 'in-sync' : 'diverged';
}

export function statDoc(ctx: Context, key: string): DocInfo {
  const spec = findSpec(key);
  const p = docPath(ctx, key);
  const info: DocInfo = {
    key: spec.key,
    label: spec.label,
    agentId: spec.agentId,
    scope: spec.scope,
    role: spec.role,
    path: p,
    exists: false,
    isSymlink: false,
    sync: 'n/a',
  };

  const link = fs.lstatSync(p, { throwIfNoEntry: false });
  if (link) {
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
  }

  info.sync = computeSync(ctx, spec, info);
  return info;
}

export function listDocs(ctx: Context, opts: { all?: boolean } = {}): DocInfo[] {
  if (opts.all) {
    return SPEC_DEFS.map((s) => statDoc(ctx, s.key));
  }
  const detected = new Set(detectAgents(ctx));
  const result: DocInfo[] = [];
  for (const spec of SPEC_DEFS) {
    if (spec.scope === 'local') {
      result.push(statDoc(ctx, spec.key)); // hub + project spokes/aux, always shown
    } else if (spec.agentId !== null && detected.has(spec.agentId)) {
      result.push(statDoc(ctx, spec.key)); // global doc, only for detected agents
    }
  }
  return result;
}

export function readDoc(ctx: Context, key: string): { info: DocInfo; content: string } {
  const info = statDoc(ctx, key);
  if (!info.exists) {
    throw new CliError(`not found: ${info.path} (create it with \`agman docs init ${info.key}\`)`);
  }
  const content = fs.readFileSync(info.path, 'utf8');
  return { info, content };
}

export function initDoc(ctx: Context, key: string, opts: { force?: boolean } = {}): DocInfo {
  const spec = findSpec(key);
  const p = docPath(ctx, key);
  const present = nodeExists(p);
  if (present && !opts.force) {
    throw new CliError(`already exists: ${p} (use --force to overwrite)`);
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (present) {
    fs.rmSync(p, { force: true }); // drop a stale file/symlink before rewriting
  }
  fs.writeFileSync(p, spec.template, 'utf8');
  return statDoc(ctx, key);
}

export type SyncResultKind = 'synced' | 'unchanged' | 'linked' | 'skipped-missing-source';

export interface SyncResult {
  key: string;
  path: string;
  result: SyncResultKind;
}

export function syncDocs(
  ctx: Context,
  opts: { from?: string; to?: string[] } = {},
): SyncResult[] {
  const fromKey = canonicalKey(opts.from ?? HUB_KEY);
  findSpec(fromKey); // validate the source key
  const fromPath = docPath(ctx, fromKey);
  const sourceBuf = readFileBuffer(fromPath);

  if (sourceBuf === null) {
    // An explicitly named source that is missing is a hard error; a defaulted
    // (hub) source that is missing degrades to a single skipped result so that
    // `agman docs sync` on a fresh repo reports gracefully instead of throwing.
    if (opts.from !== undefined) {
      throw new CliError(
        `source not found: ${fromPath} (create it with \`agman docs init ${fromKey}\`)`,
      );
    }
    return [{ key: fromKey, path: fromPath, result: 'skipped-missing-source' }];
  }

  let targetKeys: string[];
  if (opts.to && opts.to.length > 0) {
    targetKeys = opts.to.map((k) => {
      const canon = canonicalKey(k);
      if (!SYNCABLE_KEYS.includes(canon)) {
        throw new CliError(
          `cannot sync into "${k}" (valid targets: ${SYNCABLE_KEYS.join(', ')})`,
        );
      }
      return canon;
    });
  } else {
    const detected = new Set(detectAgents(ctx));
    targetKeys = SPOKE_KEYS.filter((k) => {
      const spec = findSpec(k);
      const exists = nodeExists(docPath(ctx, k));
      const isDetected = spec.agentId !== null && detected.has(spec.agentId);
      return exists || isDetected;
    });
  }
  targetKeys = targetKeys.filter((k) => k !== fromKey); // never sync a file into itself

  const results: SyncResult[] = [];
  for (const key of targetKeys) {
    const targetPath = docPath(ctx, key);
    // A symlink resolving to the source is already in sync — leave it alone.
    const lst = fs.lstatSync(targetPath, { throwIfNoEntry: false });
    if (lst && lst.isSymbolicLink()) {
      let resolved: string | null = null;
      try {
        resolved = path.resolve(path.dirname(targetPath), fs.readlinkSync(targetPath));
      } catch {
        // unreadable link value — fall through to a normal copy
      }
      if (resolved === fromPath) {
        results.push({ key, path: targetPath, result: 'linked' });
        continue;
      }
    }
    const current = readFileBuffer(targetPath);
    if (current !== null && current.equals(sourceBuf)) {
      results.push({ key, path: targetPath, result: 'unchanged' });
    } else {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, sourceBuf);
      results.push({ key, path: targetPath, result: 'synced' });
    }
  }
  return results;
}

function symlinkUnsafeReason(agentId: AgentId): string {
  if (agentId === 'gemini-cli') {
    return 'Gemini CLI does not read a symlinked GEMINI.md (upstream bug #11547); run `agman docs sync` to copy instead';
  }
  if (agentId === 'copilot') {
    return 'GitHub Copilot reads AGENTS.md natively, so no symlink is needed (and a symlink breaks it, vscode#265063)';
  }
  return `${agentId} does not support symlinked instruction files; run \`agman docs sync\` instead`;
}

export function linkDoc(
  ctx: Context,
  key: string,
  opts: { force?: boolean } = {},
): { linkPath: string; targetPath: string } {
  const spec = findSpec(key);
  if (!LINKABLE_KEYS.includes(spec.key)) {
    throw new CliError(`cannot link ${spec.label}: key must be a spoke (${SPOKE_KEYS.join(', ')})`);
  }
  const agent = getAgent(spec.agentId as AgentId);
  if (!agent.symlinkSafe) {
    throw new CliError(`cannot link ${spec.label}: ${symlinkUnsafeReason(agent.id)}`);
  }
  const hubPath = docPath(ctx, HUB_KEY);
  if (readFileBuffer(hubPath) === null) {
    throw new CliError(`hub not found: ${hubPath} (create it with \`agman docs init agents\`)`);
  }
  const linkPath = docPath(ctx, spec.key);
  const existing = fs.lstatSync(linkPath, { throwIfNoEntry: false });
  if (existing) {
    if (existing.isSymbolicLink()) {
      fs.rmSync(linkPath); // replace a stale symlink freely
    } else if (opts.force) {
      fs.rmSync(linkPath, { recursive: true, force: true });
    } else {
      throw new CliError(`${linkPath} exists and is a regular file (use --force to replace it)`);
    }
  }
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  // Relative symlink: both files live in the project root, so target is the basename.
  fs.symlinkSync(path.basename(hubPath), linkPath);
  return { linkPath, targetPath: hubPath };
}

export function unlinkDoc(ctx: Context, key: string): { path: string } {
  const spec = findSpec(key);
  if (spec.role !== 'spoke') {
    throw new CliError(
      `cannot unlink ${spec.label}: key must be a spoke (${SPOKE_KEYS.join(', ')})`,
    );
  }
  const p = docPath(ctx, spec.key);
  const link = fs.lstatSync(p, { throwIfNoEntry: false });
  if (!link || !link.isSymbolicLink()) {
    throw new CliError(`not a symlink: ${p} (nothing to materialize)`);
  }
  const hubBuf = readFileBuffer(docPath(ctx, HUB_KEY));
  if (hubBuf === null) {
    throw new CliError(`hub not found: ${docPath(ctx, HUB_KEY)}`);
  }
  fs.rmSync(p);
  fs.writeFileSync(p, hubBuf);
  return { path: p };
}

export function diffDocs(
  ctx: Context,
  key?: string,
): { hub: DocInfo; spoke: DocInfo; same: boolean } {
  const spokeKey = canonicalKey(key ?? 'claude');
  const spec = findSpec(spokeKey);
  if (spec.role !== 'spoke') {
    throw new CliError(`cannot diff ${spec.label}: key must be a spoke (${SPOKE_KEYS.join(', ')})`);
  }
  const hub = statDoc(ctx, HUB_KEY);
  const spoke = statDoc(ctx, spokeKey);
  const missing: string[] = [];
  if (!hub.exists) missing.push(hub.label);
  if (!spoke.exists) missing.push(spoke.label);
  if (missing.length > 0) {
    throw new CliError(`not found: ${missing.join(' and ')} (nothing to compare)`);
  }
  const same = fs.readFileSync(hub.path, 'utf8') === fs.readFileSync(spoke.path, 'utf8');
  return { hub, spoke, same };
}
