import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getGlobalRoot(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.CLAUDE_CONFIG_DIR;
  if (typeof dir === 'string' && dir.length > 0) {
    return dir;
  }
  return path.join(os.homedir(), '.claude');
}

function hasProjectMarker(dir: string): boolean {
  // `.git` may be a directory (normal repo) or a file (worktrees/submodules).
  if (fs.existsSync(path.join(dir, '.git'))) {
    return true;
  }
  try {
    return fs.statSync(path.join(dir, '.claude')).isDirectory();
  } catch {
    return false;
  }
}

export function findProjectRoot(startDir: string): string {
  const start = path.resolve(startDir);
  let dir = start;
  // Walk up: dir, parent, ... until a marker is found or the filesystem root.
  while (true) {
    if (hasProjectMarker(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return start;
}
