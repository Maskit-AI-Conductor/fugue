/**
 * Cross-platform utilities for Windows/Unix compatibility.
 */

import os from 'node:os';
import path from 'node:path';

/**
 * Returns platform-specific shell path.
 * - Windows: 'cmd.exe'
 * - Unix: '/bin/bash'
 */
export function getShell(): string {
  return process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
}

/**
 * Creates a cross-platform command to pipe file contents to a target command.
 * - Windows: type "file" | command
 * - Unix: cat "file" | command
 */
export function createPipeCommand(filePath: string, targetCommand: string): string {
  if (process.platform === 'win32') {
    return `type "${filePath}" | ${targetCommand}`;
  }
  return `cat "${filePath}" | ${targetCommand}`;
}

/**
 * Creates a unique temporary file path (cross-platform).
 * Uses Node.js os.tmpdir() which works on all platforms:
 * - Windows: %TEMP%
 * - Unix: /tmp
 */
export function createTempFilePath(prefix: string, extension = '.txt'): string {
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
  return path.join(os.tmpdir(), filename);
}
