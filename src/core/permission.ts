/**
 * Permission system — a three-gate pipeline executed before every tool
 * invocation (inspired by tutorial s03):
 *
 *   1. deny  — hard deny list / explicit deny rules  → blocked
 *   2. rule  — rule match raises a reason            → ask resolver
 *   3. ask   — delegate to a PermissionResolver      → allow / deny
 *
 * Falls through to "allow" when no rule objects.
 */

import type { ToolUseBlock } from './types.js';

export type PermissionDecision = 'allow' | 'deny';

export type PermissionResult = PermissionDecision | 'ask' | 'passthrough';

export interface PermissionRuleContext {
  agentName: string;
  tool: ToolUseBlock;
}

export interface PermissionRule {
  name: string;
  /** Restrict this rule to a set of tool names; undefined = all tools. */
  tools?: string[];
  /**
   * Evaluate the tool call.
   * - return 'deny' | 'allow' to decide directly
   * - return 'ask' to escalate to the resolver (with `reason`)
   * - return 'passthrough' / null to let the next rule decide
   */
  check(ctx: PermissionRuleContext): PermissionResult | string | null;
  /** Human-readable reason shown when escalating. */
  reason?: string;
}

/** Resolves 'ask' decisions — e.g. by prompting a human or auto-approving in tests. */
export interface PermissionResolver {
  resolve(ctx: PermissionRuleContext, reason: string): Promise<PermissionDecision>;
}

/** A resolver that allows everything — handy for tests / trusted sandboxes. */
export class AllowAllResolver implements PermissionResolver {
  async resolve(): Promise<PermissionDecision> {
    return 'allow';
  }
}

/** A resolver that denies everything — handy for dry-run / audit. */
export class DenyAllResolver implements PermissionResolver {
  async resolve(): Promise<PermissionDecision> {
    return 'deny';
  }
}

export interface PermissionManagerOptions {
  rules?: PermissionRule[];
  resolver?: PermissionResolver;
}

export class PermissionManager {
  private rules: PermissionRule[];
  private resolver: PermissionResolver;

  constructor(opts: PermissionManagerOptions = {}) {
    this.rules = opts.rules ?? [];
    this.resolver = opts.resolver ?? new DenyAllResolver();
  }

  addRule(rule: PermissionRule): void {
    this.rules.push(rule);
  }

  setResolver(resolver: PermissionResolver): void {
    this.resolver = resolver;
  }

  /** Run the full pipeline; returns allow/deny plus the reason if denied. */
  async check(ctx: PermissionRuleContext): Promise<{ decision: PermissionDecision; reason?: string }> {
    for (const rule of this.rules) {
      if (rule.tools && !rule.tools.includes(ctx.tool.name)) continue;
      const verdict = rule.check(ctx);
      if (verdict === null || verdict === 'passthrough') continue;
      if (verdict === 'allow') return { decision: 'allow' };
      if (verdict === 'deny') {
        return { decision: 'deny', reason: rule.reason ?? `Denied by rule "${rule.name}"` };
      }
      // string reason → escalate to resolver
      if (typeof verdict === 'string') {
        const decision = await this.resolver.resolve(ctx, verdict);
        return { decision, reason: decision === 'deny' ? verdict : undefined };
      }
      // verdict === 'ask'
      const decision = await this.resolver.resolve(ctx, rule.reason ?? `Rule "${rule.name}" requires approval`);
      return { decision, reason: decision === 'deny' ? rule.reason : undefined };
    }
    return { decision: 'allow' };
  }
}
