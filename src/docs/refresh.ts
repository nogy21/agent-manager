import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Context } from '../context.js';
import { CliError } from '../errors.js';
import { docPath } from './core.js';

export interface RefreshTool {
  id: 'claude-code' | 'codex' | 'gemini-cli';
  bin: string;
  buildArgs(prompt: string): string[];
  installHint: string;
}

// Fixed order — `runRefresh` picks the first detected tool from this list.
export const REFRESH_TOOLS: RefreshTool[] = [
  {
    id: 'claude-code',
    bin: 'claude',
    buildArgs: (prompt) => ['-p', prompt],
    installHint: 'npm install -g @anthropic-ai/claude-code (then `claude` once to log in)',
  },
  {
    id: 'codex',
    bin: 'codex',
    buildArgs: (prompt) => ['exec', prompt],
    installHint: 'npm install -g @openai/codex (then `codex` once to log in)',
  },
  {
    id: 'gemini-cli',
    bin: 'gemini',
    buildArgs: (prompt) => ['-p', prompt],
    installHint: 'npm install -g @google/gemini-cli (then `gemini` once to log in)',
  },
];

/** Is `p` a regular file the current process may execute? (follows symlinks) */
function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Which refresh tools are runnable right now: for each, look up its `bin` on
 * `env.PATH` (no shell) and keep it when an executable file is found. Order
 * follows REFRESH_TOOLS.
 */
export function detectRefreshTools(env: NodeJS.ProcessEnv = process.env): RefreshTool[] {
  const entries = (env.PATH ?? '').split(path.delimiter).filter((e) => e.length > 0);
  return REFRESH_TOOLS.filter((tool) =>
    entries.some((dir) => isExecutableFile(path.join(dir, tool.bin))),
  );
}

/** The English instruction handed to the agent CLI on stdin/argv. */
export function buildRefreshPrompt(ctx: Context, _docKey: string, docPathAbs: string): string {
  const basename = path.basename(docPathAbs);
  return [
    `You are updating ${basename}, the agent-instructions hub of the repository at ${ctx.projectRoot}.`,
    `Review the current codebase — its build and test commands, architecture, conventions, and gotchas — and rewrite ${basename} so it is accurate and concise.`,
    `ONLY modify ${basename}: do not edit any other file, and do not commit or run git.`,
    `Preserve existing content that is still correct; drop or fix anything that is now stale.`,
    `If ${basename} does not exist, create it with these sections: Project overview, Commands, Architecture, Conventions, Gotchas.`,
    `Write plain English aimed at a coding agent that will read this file before working in the repo.`,
  ].join('\n');
}

/** A one-line, shell-ish record of the command, with the prompt truncated. */
function previewCommand(bin: string, args: string[]): string {
  const parts = args.map((a) => {
    const oneLine = a.replace(/\s+/g, ' ');
    return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine;
  });
  return [bin, ...parts].join(' ');
}

function unknownToolError(tool: string): CliError {
  return new CliError(
    `unknown refresh tool "${tool}" (valid: ${REFRESH_TOOLS.map((t) => t.id).join(', ')})`,
  );
}

function notInstalledError(tool: RefreshTool): CliError {
  return new CliError(
    `${tool.id} is not on PATH. Install it with: ${tool.installHint}. ` +
      'If it is already installed, run it once so it is logged in.',
  );
}

function noneInstalledError(): CliError {
  const hints = REFRESH_TOOLS.map((t) => `  - ${t.id}: ${t.installHint}`).join('\n');
  return new CliError(`no supported AI agent CLI found on PATH. Install one:\n${hints}`);
}

export interface RefreshResult {
  tool: RefreshTool;
  docKey: string;
  command: string;
  ran: boolean;
  exitCode: number | null;
}

export interface RefreshOptions {
  tool?: string;
  doc?: string;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  // Invoked with the resolved tool right before the CLI is spawned, so a caller
  // can print context ahead of the tool's own (inherited) output. Never fired on
  // a dry run.
  onSpawn?: (tool: RefreshTool, command: string) => void;
}

/**
 * Ask an installed agent CLI to rewrite the hub doc against the current repo.
 * Validates the doc key and the requested tool, then either previews (dryRun)
 * or spawns the tool with stdio inherited (it streams its own output).
 */
export function runRefresh(ctx: Context, opts: RefreshOptions = {}): RefreshResult {
  const env = opts.env ?? process.env;
  const docKey = opts.doc ?? 'agents';
  const docPathAbs = docPath(ctx, docKey); // validates the key (throws CliError if unknown)

  const detected = detectRefreshTools(env);
  let tool: RefreshTool;
  if (opts.tool !== undefined) {
    const known = REFRESH_TOOLS.find((t) => t.id === opts.tool);
    if (!known) throw unknownToolError(opts.tool);
    if (!detected.some((t) => t.id === known.id)) throw notInstalledError(known);
    tool = known;
  } else {
    if (detected.length === 0) throw noneInstalledError();
    tool = detected[0];
  }

  const args = tool.buildArgs(buildRefreshPrompt(ctx, docKey, docPathAbs));
  const command = previewCommand(tool.bin, args);

  if (opts.dryRun) {
    return { tool, docKey, command, ran: false, exitCode: null };
  }

  opts.onSpawn?.(tool, command);
  const result = spawnSync(tool.bin, args, { cwd: ctx.projectRoot, stdio: 'inherit', env });
  if (result.error) {
    throw new CliError(
      `failed to launch ${tool.bin}: ${result.error.message} (install: ${tool.installHint})`,
    );
  }
  return { tool, docKey, command, ran: true, exitCode: result.status };
}
