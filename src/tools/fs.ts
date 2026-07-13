/**
 * Filesystem tools — read_file, write_file, edit_file, glob, grep.
 *
 * Each tool in this module wraps a Node.js `fs` operation and exposes it to the
 * agent as a callable tool via the ToolContext pattern. All paths are resolved
 * relative to `ctx.cwd` so the agent operates within its working directory.
 *
 * Security note: these tools do NOT perform path-traversal gating themselves.
 * That responsibility belongs to PermissionManager / PreToolUse hooks. Plugins
 * or harness code that wants to sandbox the agent should install a
 * PreToolUse hook that validates the `path` parameter against an allowlist
 * (e.g. `allowedGlobs`) before execution.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { BaseTool } from '../core/tool.js';
import type { ToolContext } from '../core/tool.js';

/**
 * Reads a UTF-8 text file and returns a portion of it with line numbers.
 *
 * Output is formatted as `lineNumber\tcontent` with 1-based line numbers,
 * matching the convention from common CLI tools so the LLM can reference
 * specific lines in follow-up edits.
 *
 * @remarks
 * The default limit of 2000 lines balances token economy against the need to
 * show large enough context windows for most source files. For very large
 * files the caller should use offset/limit to paginate.
 */
export class ReadFileTool extends BaseTool {
  readonly definition = {
    name: 'read_file',
    description: 'Read a UTF-8 text file. Returns up to limit lines.',
    input_schema: {
      type: 'object',
      properties: {
        /** Absolute or relative path to the file. Resolved against ctx.cwd. */
        path: { type: 'string' },
        /** 1-based start line. Defaults to 1 (beginning of file). */
        offset: { type: 'number', description: '1-based start line' },
        /** Maximum lines to return. Defaults to 2000. */
        limit: { type: 'number', description: 'max lines to read' },
      },
      required: ['path'],
    },
  };

  /**
   * Reads the file at the resolved path and returns line-numbered content.
   *
   * @param input - Must contain `path` (string). Optionally `offset` (1-based)
   *  and `limit` (max lines, default 2000).
   * @param ctx - The tool context providing `cwd` for path resolution.
   * @returns Newline-separated lines prefixed with `lineNumber\t`.
   */
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const p = path.resolve(ctx.cwd, this.requireString(input, 'path'));
    const offset = this.optionalNumber(input, 'offset') ?? 1;
    const limit = this.optionalNumber(input, 'limit') ?? 2000;
    const text = await fs.readFile(p, 'utf8');
    const lines = text.split('\n');
    const start = Math.max(0, offset - 1);
    const end = Math.min(lines.length, start + limit);
    return lines.slice(start, end).map((l, i) => `${start + i + 1}\t${l}`).join('\n');
  }
}

/**
 * Creates or overwrites a text file with the given content.
 *
 * Parent directories are created recursively via `fs.mkdir({ recursive: true })`,
 * so the caller does not need to create intermediate directories first.
 *
 * @remarks
 * This tool performs a full overwrite — it does not append. For targeted
 * edits, use {@link EditFileTool} instead.
 */
export class WriteFileTool extends BaseTool {
  readonly definition = {
    name: 'write_file',
    description: 'Write text to a file (creates or overwrites).',
    input_schema: {
      type: 'object',
      properties: {
        /** Absolute or relative path to the file. Resolved against ctx.cwd. */
        path: { type: 'string' },
        /** Full text content to write to the file. */
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  };

  /**
   * Writes content to the resolved file path, creating parent directories as needed.
   *
   * @param input - Must contain `path` (string) and `content` (string).
   * @param ctx - The tool context providing `cwd` for path resolution.
   * @returns Confirmation message with character count and resolved path.
   */
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const p = path.resolve(ctx.cwd, this.requireString(input, 'path'));
    const content = this.requireString(input, 'content');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
    return `Wrote ${content.length} chars to ${p}`;
  }
}

/**
 * Performs exact string replacement in an existing file.
 *
 * Replaces the **first** occurrence of `old_string` with `new_string`.
 * If `old_string` is not found, the tool returns an error message instead of
 * silently succeeding — this prevents silent failures when the agent's
 * understanding of the file is stale.
 *
 * @remarks
 * This is NOT a regex or multi-occurrence replacement. For multiple
 * replacements the agent must call this tool repeatedly.
 */
export class EditFileTool extends BaseTool {
  readonly definition = {
    name: 'edit_file',
    description: 'Replace the first occurrence of old_string with new_string in a file.',
    input_schema: {
      type: 'object',
      properties: {
        /** Absolute or relative path to the file. Resolved against ctx.cwd. */
        path: { type: 'string' },
        /** Exact text to find (must match precisely, including whitespace). */
        old_string: { type: 'string' },
        /** Replacement text. Must differ from old_string. */
        new_string: { type: 'string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  };

  /**
   * Reads the file, replaces the first match of oldStr with newStr, and writes back.
   *
   * @param input - Must contain `path`, `old_string`, and `new_string`.
   * @param ctx - The tool context providing `cwd` for path resolution.
   * @returns Confirmation message, or an error string if old_string was not found.
   */
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const p = path.resolve(ctx.cwd, this.requireString(input, 'path'));
    const oldStr = this.requireString(input, 'old_string');
    const newStr = this.requireString(input, 'new_string');
    const text = await fs.readFile(p, 'utf8');
    if (!text.includes(oldStr)) return `Error: old_string not found in ${p}`;
    const updated = text.replace(oldStr, newStr);
    await fs.writeFile(p, updated, 'utf8');
    return `Edited ${p}`;
  }
}

/**
 * Lists files matching a glob pattern by walking the filesystem.
 *
 * Supports standard glob syntax: `*` (single-segment wildcard), `**` (multi-segment
 * wildcard), and `?` (single character). Directories `node_modules`, `.git`, and
 * `dist` are skipped during the walk.
 *
 * @remarks
 * Results are truncated at 500 matches to avoid overwhelming the context window.
 * This tool does a naive in-process walk rather than shelling out to external
 * tools, which keeps it portable across platforms but means it may be slower
 * than `ripgrep --files` on very large trees.
 */
export class GlobTool extends BaseTool {
  readonly definition = {
    name: 'glob',
    description: 'List files matching a glob pattern (e.g. "src/**/*.ts").',
    input_schema: {
      type: 'object',
      properties: {
        /** Glob pattern (e.g. `"**​/*.ts"`, `"src/*.test.*"`). */
        pattern: { type: 'string' },
      },
      required: ['pattern'],
    },
  };

  /**
   * Walks the filesystem from `ctx.cwd` and returns files matching the pattern.
   *
   * @param input - Must contain `pattern` (string glob).
   * @param ctx - The tool context providing `cwd` for the walk root.
   * @returns Newline-separated list of matching relative paths, truncated at 500.
   */
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const pattern = this.requireString(input, 'pattern');
    const re = globToRegex(pattern);
    const matches: string[] = [];
    await walkFiles(ctx.cwd, async (rel) => {
      if (re.test(rel)) {
        matches.push(rel);
        // NOTE: cap at 500 to avoid flooding the context window
        if (matches.length >= 500) return;
      }
    });
    return matches.join('\n') || '(no matches)';
  }
}

/**
 * Searches file contents for lines matching a regex pattern.
 *
 * Uses `walkFiles` to recursively scan all files under a directory (skipping
 * `node_modules`, `.git`, and `dist`). Binary/unreadable files are silently
 * skipped.
 *
 * @remarks
 * Results are capped at 200 matching lines. The regex uses standard JavaScript
 * `RegExp` semantics (no `ripgrep` extensions like `--type` filtering or
 * multiline mode). For more advanced searches, use the BashTool with `rg`.
 */
export class GrepTool extends BaseTool {
  readonly definition = {
    name: 'grep',
    description: 'Search file contents for a regex pattern; returns matching lines.',
    input_schema: {
      type: 'object',
      properties: {
        /** Regex pattern to search for (JavaScript RegExp syntax). */
        pattern: { type: 'string' },
        /** File or directory to search. Defaults to cwd. */
        path: { type: 'string', description: 'file or dir to search (default cwd)' },
      },
      required: ['pattern'],
    },
  };

  /**
   * Recursively searches files and returns matching lines with file:line:content format.
   *
   * @param input - Must contain `pattern` (regex string). Optionally `path` (defaults to cwd).
   * @param ctx - The tool context providing `cwd` for path resolution.
   * @returns Newline-separated `file:line: content` lines, capped at 200 matches.
   */
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const pattern = this.requireString(input, 'pattern');
    const rel = this.optionalString(input, 'path') ?? '.';
    const root = path.resolve(ctx.cwd, rel);
    const re = new RegExp(pattern);
    const results: string[] = [];
    await walkFiles(root, async (file) => {
      // NOTE: cap at 200 lines to keep results manageable
      if (results.length >= 200) return;
      try {
        const text = await fs.readFile(file, 'utf8');
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            results.push(`${path.relative(ctx.cwd, file)}:${i + 1}: ${lines[i]}`);
            if (results.length >= 200) return;
          }
        }
      } catch {
        // skip binary / unreadable
      }
    });
    return results.join('\n') || '(no matches)';
  }
}

/**
 * Recursively walks a directory tree, calling `visit` on each file found.
 *
 * Skips `node_modules`, `.git`, and `dist` directories. Errors reading a
 * directory (e.g. permission denied) are silently swallowed so the walk
 * continues with sibling directories.
 *
 * @param dir - Root directory to walk.
 * @param visit - Async callback invoked with each file's absolute path.
 */
async function walkFiles(dir: string, visit: (file: string) => Promise<void>): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // NOTE: silently skip directories we can't read (permissions, etc.)
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // NOTE: these directories are universally noise for code search tasks
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
      await walkFiles(full, visit);
    } else {
      await visit(full);
    }
  }
}

/**
 * Converts a glob pattern to a `RegExp` for matching relative POSIX paths.
 *
 * Supports three glob features:
 * - `*` — matches any characters within a single path segment (except `/`)
 * - `**` — matches zero or more path segments (including `/`)
 * - `?` — matches exactly one character within a segment (except `/`)
 *
 * The resulting regex is anchored with `^...$` and uses POSIX `/` separators.
 *
 * @param pattern - Glob pattern string (e.g. `"src/**​/*.ts"`).
 * @returns A `RegExp` that tests whether a relative path matches the pattern.
 */
function globToRegex(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // NOTE: `**` matches across path segments (including slashes)
        re += '.*';
        i++;
        if (pattern[i + 1] === '/') i++; // consume slash after **
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      // NOTE: escape regex metacharacters so glob patterns like "test.js" work literally
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

/**
 * Creates the default set of filesystem tools.
 *
 * Returns one instance each of: ReadFileTool, WriteFileTool, EditFileTool,
 * GlobTool, and GrepTool. These are ready to register on an Agent via
 * `agent.addTool()` or through a Plugin.
 *
 * @returns An array of five filesystem tool instances.
 */
export function createFsTools() {
  return [new ReadFileTool(), new WriteFileTool(), new EditFileTool(), new GlobTool(), new GrepTool()];
}
