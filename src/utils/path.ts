/**
 * Path utilities.
 */

import { homedir } from "node:os";

/**
 * Expand tilde (~) in a path to the user's home directory.
 */
export function expandTilde(path: string): string {
  if (path.startsWith('~/')) {
    return homedir() + path.slice(1);
  }
  return path;
}
