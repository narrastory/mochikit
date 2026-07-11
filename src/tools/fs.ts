/**
 * Filesystem tools — read_file, write_file, edit_file, glob, grep.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { BaseTool } from '../core/tool.js';
import type { ToolContext } from '../core/tool.js';

export class ReadFileTool extends BaseTool {
  readonly definition = {
    name: 'read_file',
    description: 'Read a UTF-8 text file. Returns up to limit lines.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'number', description: '1-based start line' },
        limit: { type: 'number', description: 'max lines to read' },
      },
      required: ['path'],
    },
  };

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

export class WriteFileTool extends BaseTool {
  readonly definition = {
    name: 'write_file',
    description: 'Write text to a file (creates or overwrites).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  };

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const p = path.resolve(ctx.cwd, this.requireString(input, 'path'));
    const content = this.requireString(input, 'content');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
    return `Wrote ${content.length} chars to ${p}`;
  }
}

export class EditFileTool extends BaseTool {
  readonly definition = {
    name: 'edit_file',
    description: 'Replace the first occurrence of old_string with new_string in a file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  };

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

export class GlobTool extends BaseTool {
  readonly definition = {
    name: 'glob',
    description: 'List files matching a glob pattern (e.g. "src/**/*.ts").',
    input_schema: {
      type: 'object',
      properties: { pattern: { type: 'string' } },
      required: ['pattern'],
    },
  };

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const pattern = this.requireString(input, 'pattern');
    const re = globToRegex(pattern);
    const matches: string[] = [];
    await walkFiles(ctx.cwd, async (rel) => {
      if (re.test(rel)) {
        matches.push(rel);
        if (matches.length >= 500) return;
      }
    });
    return matches.join('\n') || '(no matches)';
  }
}

export class GrepTool extends BaseTool {
  readonly definition = {
    name: 'grep',
    description: 'Search file contents for a regex pattern; returns matching lines.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', description: 'file or dir to search (default cwd)' },
      },
      required: ['pattern'],
    },
  };

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const pattern = this.requireString(input, 'pattern');
    const rel = this.optionalString(input, 'path') ?? '.';
    const root = path.resolve(ctx.cwd, rel);
    const re = new RegExp(pattern);
    const results: string[] = [];
    await walkFiles(root, async (file) => {
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

async function walkFiles(dir: string, visit: (file: string) => Promise<void>): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
      await walkFiles(full, visit);
    } else {
      await visit(full);
    }
  }
}

/** Convert a glob pattern (supports *, **, ?) to a RegExp matching a relative POSIX path. */
function globToRegex(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
        if (pattern[i + 1] === '/') i++; // consume slash after **
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

export function createFsTools() {
  return [new ReadFileTool(), new WriteFileTool(), new EditFileTool(), new GlobTool(), new GrepTool()];
}
