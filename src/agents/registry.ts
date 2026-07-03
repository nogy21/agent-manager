import fs from 'node:fs';
import path from 'node:path';
import type { Context } from '../context.js';
import { CliError } from '../errors.js';

export type AgentId = 'claude-code' | 'codex' | 'cursor' | 'copilot' | 'gemini-cli' | 'windsurf';

export interface SkillsLocation {
  key: string; // unique per (dirKey, scope), e.g. 'claude', 'agents', 'cursor', ...
  scope: 'global' | 'local';
  dir: string; // ABSOLUTE path resolved for ctx
  visibleTo: AgentId[]; // which agents scan this dir
  primary: boolean; // preferred location for its key
}

export interface AgentDef {
  id: AgentId;
  name: string; // display name
  instructionMode: 'agents-native' | 'copy' | 'config';
  // agents-native: reads project AGENTS.md directly; copy: needs own file synced from
  // AGENTS.md; config: could read AGENTS.md only via user config.
  projectDoc: string | null; // repo-relative path of the agent's OWN instruction file
  globalDoc: string | null; // path template resolved via resolveGlobalDoc
  symlinkSafe: boolean; // official stance allows symlinking its file -> AGENTS.md
  detect: { globalDirs: string[]; projectPaths: string[] }; // existence => agent in use
  docUrl: string;
}

/**
 * Resolve a path template for a context. Supported prefixes:
 *   - `<globalRoot>` -> ctx.globalRoot (keeps CLAUDE_CONFIG_DIR working)
 *   - `~`            -> ctx.home
 * Anything else is returned unchanged (already absolute).
 */
function resolveTemplate(ctx: Context, tpl: string): string {
  if (tpl === '<globalRoot>') return ctx.globalRoot;
  if (tpl.startsWith('<globalRoot>/')) {
    return path.join(ctx.globalRoot, tpl.slice('<globalRoot>/'.length));
  }
  if (tpl === '~') return ctx.home;
  if (tpl.startsWith('~/')) {
    return path.join(ctx.home, tpl.slice(2));
  }
  return tpl;
}

export const AGENTS: AgentDef[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    instructionMode: 'copy',
    projectDoc: 'CLAUDE.md',
    globalDoc: '<globalRoot>/CLAUDE.md',
    symlinkSafe: true, // officially endorsed `ln -s AGENTS.md CLAUDE.md`
    detect: { globalDirs: ['<globalRoot>'], projectPaths: ['CLAUDE.md', '.claude'] },
    docUrl: 'https://code.claude.com/docs/en/memory',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    instructionMode: 'agents-native',
    projectDoc: null, // AGENTS.md IS its file
    globalDoc: '~/.codex/AGENTS.md',
    symlinkSafe: true, // native anyway
    detect: { globalDirs: ['~/.codex'], projectPaths: ['.agents'] },
    docUrl: 'https://developers.openai.com/codex',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    instructionMode: 'agents-native', // root + nested AGENTS.md
    projectDoc: null, // .cursor/rules/*.mdc exist but AGENTS.md is native; .mdc unmanaged here
    globalDoc: null, // User Rules are app-internal
    symlinkSafe: false,
    detect: { globalDirs: ['~/.cursor'], projectPaths: ['.cursor'] },
    docUrl: 'https://cursor.com/docs/context/rules',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    instructionMode: 'agents-native', // chat.useAgentsMdFile default-on; coding agent native
    projectDoc: '.github/copilot-instructions.md', // optional extra, combined with AGENTS.md
    globalDoc: null,
    symlinkSafe: false, // documented breakage vscode#265063
    detect: {
      globalDirs: ['~/.copilot'],
      projectPaths: ['.github/copilot-instructions.md', '.github/skills'],
    },
    docUrl: 'https://code.visualstudio.com/docs/copilot/customization/custom-instructions',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    instructionMode: 'config', // reads AGENTS.md only if added to context.fileName
    projectDoc: 'GEMINI.md',
    globalDoc: '~/.gemini/GEMINI.md',
    symlinkSafe: false, // bug #11547: symlinked GEMINI.md not read — must copy
    detect: { globalDirs: ['~/.gemini'], projectPaths: ['GEMINI.md', '.gemini'] },
    docUrl: 'https://geminicli.com/docs/cli/gemini-md/',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    instructionMode: 'agents-native', // AGENTS.md root + subdirs
    projectDoc: null, // .windsurf/rules exist but AGENTS.md native
    globalDoc: '~/.codeium/windsurf/memories/global_rules.md',
    symlinkSafe: false, // no guidance
    detect: { globalDirs: ['~/.codeium/windsurf'], projectPaths: ['.windsurf'] },
    docUrl: 'https://docs.windsurf.com/windsurf/cascade/memories',
  },
];

/** Static definition of every skills location, before resolving to absolute paths. */
interface LocationDef {
  key: string;
  primary: boolean;
  visibleTo: AgentId[];
  globalDir: string; // template resolved against ctx
  projectDir: string; // relative to ctx.projectRoot
}

const LOCATIONS: LocationDef[] = [
  {
    key: 'claude',
    primary: true,
    visibleTo: ['claude-code', 'copilot', 'windsurf'],
    globalDir: '<globalRoot>/skills',
    projectDir: '.claude/skills',
  },
  {
    key: 'agents',
    primary: true,
    visibleTo: ['codex', 'cursor', 'copilot', 'gemini-cli', 'windsurf'],
    globalDir: '~/.agents/skills',
    projectDir: '.agents/skills',
  },
  {
    key: 'cursor',
    primary: false,
    visibleTo: ['cursor'],
    globalDir: '~/.cursor/skills',
    projectDir: '.cursor/skills',
  },
  {
    key: 'copilot',
    primary: false,
    visibleTo: ['copilot'],
    globalDir: '~/.copilot/skills',
    projectDir: '.github/skills',
  },
  {
    key: 'gemini',
    primary: false,
    visibleTo: ['gemini-cli'],
    globalDir: '~/.gemini/skills',
    projectDir: '.gemini/skills',
  },
  {
    key: 'windsurf',
    primary: false,
    visibleTo: ['windsurf'],
    globalDir: '~/.codeium/windsurf/skills',
    projectDir: '.windsurf/skills',
  },
];

/** Does anything (file, dir, or even a broken symlink) exist at this path? */
function pathExists(p: string): boolean {
  return fs.lstatSync(p, { throwIfNoEntry: false }) !== undefined;
}

export function getAgent(id: string): AgentDef {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) {
    throw new CliError(`unknown agent: ${id} (valid: ${AGENTS.map((a) => a.id).join(', ')})`);
  }
  return agent;
}

export function resolveGlobalDoc(ctx: Context, agent: AgentDef): string | null {
  return agent.globalDoc === null ? null : resolveTemplate(ctx, agent.globalDoc);
}

export function detectAgents(ctx: Context): AgentId[] {
  const result: AgentId[] = [];
  for (const agent of AGENTS) {
    const globalHit = agent.detect.globalDirs.some((d) => pathExists(resolveTemplate(ctx, d)));
    const projectHit = agent.detect.projectPaths.some((p) =>
      pathExists(path.join(ctx.projectRoot, p)),
    );
    if (globalHit || projectHit) {
      result.push(agent.id);
    }
  }
  return result;
}

export function skillsLocations(ctx: Context): SkillsLocation[] {
  const result: SkillsLocation[] = [];
  const seen = new Set<string>();
  for (const loc of LOCATIONS) {
    const scoped: Array<{ scope: 'global' | 'local'; dir: string }> = [
      { scope: 'global', dir: resolveTemplate(ctx, loc.globalDir) },
      { scope: 'local', dir: path.join(ctx.projectRoot, loc.projectDir) },
    ];
    for (const { scope, dir } of scoped) {
      if (seen.has(dir)) continue; // dedupe by resolved dir
      seen.add(dir);
      result.push({ key: loc.key, scope, dir, visibleTo: loc.visibleTo, primary: loc.primary });
    }
  }
  return result;
}

export function locationByKey(
  ctx: Context,
  key: string,
  scope: 'global' | 'local',
): SkillsLocation {
  const found = skillsLocations(ctx).find((l) => l.key === key && l.scope === scope);
  if (found) return found;
  const validKeys = LOCATIONS.map((l) => l.key).join(', ');
  throw new CliError(`unknown skills location: ${key} (valid: ${validKeys})`);
}
