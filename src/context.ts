import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './errors.js';
import { findProjectRoot, getGlobalRoot } from './paths.js';

export type Scope = 'global' | 'local';

export interface Context {
  globalRoot: string;
  projectRoot: string;
  cwd: string;
}

export function createContext(opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Context {
  const env = opts.env ?? process.env;
  const cwd = path.resolve(opts.cwd ?? process.cwd());

  if (opts.cwd !== undefined) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(cwd);
    } catch {
      throw new CliError(`--cwd directory does not exist: ${cwd}`);
    }
    if (!stat.isDirectory()) {
      throw new CliError(`--cwd is not a directory: ${cwd}`);
    }
  }

  return {
    globalRoot: getGlobalRoot(env),
    projectRoot: findProjectRoot(cwd),
    cwd,
  };
}
