/**
 * Permission system — a three-gate pipeline executed before every tool
 * invocation (inspired by tutorial s03):
 *
 *   1. deny  — hard deny list / explicit deny rules  → blocked
 *   2. rule  — rule match raises a reason            → ask resolver
 *   3. ask   — delegate to a PermissionResolver      → allow / deny
 *
 * Falls through to "allow" when no rule objects.
 *
 * ## Pipeline walkthrough
 *
 * When a tool is about to be invoked, the agent loop calls
 * `PermissionManager.check()`. The manager iterates through all registered
 * `PermissionRule` instances (in registration order):
 *
 * - If a rule is scoped to specific tools (`rule.tools` is set) and the
 *   current tool is not in that list, the rule is skipped.
 * - If `check()` returns `'allow'`, the tool runs immediately (short-circuit).
 * - If `check()` returns `'deny'`, the tool is blocked with a reason
 *   (short-circuit — first deny wins).
 * - If `check()` returns a string, it escalates to the `PermissionResolver`
 *   with that string as the reason. If the resolver denies, the tool is
 *   blocked.
 * - If `check()` returns `'ask'`, it escalates to the resolver with the
 *   rule's `reason` field.
 * - If `check()` returns `'passthrough'` or `null`, the next rule is tried.
 * - If no rules match (or all passthrough), the tool is allowed.
 *
 * ## Why short-circuit on first deny?
 *
 * Security decisions should fail closed: once any rule says "no", there's no
 * point checking remaining rules. Allowing a later rule to override an
 * earlier deny would make the security posture unpredictable — the order of
 * rule registration would silently change the outcome, which is a recipe
 * for security bugs.
 *
 * ## Default resolver: DenyAllResolver
 *
 * If no resolver is configured, `PermissionManager` defaults to
 * `DenyAllResolver`. This means any rule that returns `'ask'` or a reason
 * string will result in denial. This is a safe default: tools are denied
 * unless explicitly configured otherwise. Use `AllowAllResolver` for
 * trusted sandboxes or testing.
 */

import type { ToolUseBlock } from './types.js';

/**
 * Final binary decision after the permission pipeline runs.
 *
 * - `'allow'` — the tool may execute.
 * - `'deny'` — the tool is blocked; the blocking rule's `reason` is
 *   returned to the agent loop for logging/error messages.
 */
export type PermissionDecision = 'allow' | 'deny';

/**
 * Intermediate result from a single `PermissionRule.check()`.
 *
 * - `'allow'` / `'deny'` — short-circuit the pipeline immediately.
 * - `'ask'` — escalate to the `PermissionResolver` with the rule's
 *   `reason`.
 * - `'passthrough'` — skip this rule and try the next one.
 * - `string` — escalate to the resolver with this string as the reason
 *   (convenience: the rule supplies a custom reason inline).
 * - `null` — same as passthrough; skip this rule.
 */
export type PermissionResult = PermissionDecision | 'ask' | 'passthrough';

/**
 * Context passed to every `PermissionRule.check()` call.
 *
 * Contains enough information for a rule to make an informed decision
 * without needing access to the full agent state.
 */
export interface PermissionRuleContext {
  /** Name of the agent that is running (useful for multi-agent setups). */
  agentName: string;
  /** The tool use block that is about to be executed. */
  tool: ToolUseBlock;
}

/**
 * A permission rule that evaluates tool invocations.
 *
 * Rules are registered with `PermissionManager.addRule()` and are checked
 * in registration order. Each rule can independently allow, deny, escalate,
 * or pass on a tool call.
 *
 * ## Scoping
 *
 * The optional `tools` array scopes the rule to specific tool names. When
 * set, the rule is only consulted for tools whose name appears in the
 * array. When undefined, the rule applies to all tools. This allows
 * fine-grained policies like "deny write_file for AgentA but allow it for
 * AgentB."
 */
export interface PermissionRule {
  /** Human-readable name for debugging/logging. */
  name: string;
  /**
   * Restrict this rule to a set of tool names; undefined = all tools.
   *
   * Tool names match the `ToolDefinition.name` field, which may include
   * a namespace prefix (e.g. `mcp__filesystem__read_file`).
   */
  tools?: string[];
  /**
   * Evaluate the tool call.
   *
   * - return 'deny' | 'allow' to decide directly
   * - return 'ask' to escalate to the resolver (with `reason`)
   * - return 'passthrough' / null to let the next rule decide
   * - return a string to escalate with that string as the reason
   *
   * @param ctx — Context including agent name and tool details.
   * @returns A permission result indicating the rule's decision.
   */
  check(ctx: PermissionRuleContext): PermissionResult | string | null;
  /**
   * Human-readable reason shown when escalating or denying.
   *
   * When `check()` returns `'ask'`, this reason is passed to the
   * resolver. When `check()` returns `'deny'`, this reason is returned
   * to the agent loop as the explanation for the denial.
   */
  reason?: string;
}

/**
 * Resolves 'ask' decisions — e.g. by prompting a human or auto-approving
 * in tests.
 *
 * The resolver is the final gatekeeper in the pipeline. When a rule
 * escalates with `'ask'` or a reason string, the resolver has the final
 * say. This is where human-in-the-loop approval or policy-based
 * auto-approval lives.
 */
export interface PermissionResolver {
  /**
   * Resolve an escalated permission check.
   *
   * @param ctx — Context about the tool and agent.
   * @param reason — The reason string from the rule that escalated
   *   (either the rule's `reason` field or the string returned by
   *   `check()`).
   * @returns A promise resolving to `'allow'` or `'deny'`.
   */
  resolve(ctx: PermissionRuleContext, reason: string): Promise<PermissionDecision>;
}

/**
 * A resolver that allows everything — handy for tests / trusted sandboxes.
 *
 * Use this when:
 * - Running unit tests that don't need permission checks.
 * - Running in a fully trusted environment (e.g. a sandbox without network
 *   access).
 * - Debugging without permission prompts getting in the way.
 *
 * **Security note:** Using this in production with real tools (file system,
 * network, shell) is dangerous. It grants all tools unconditionally.
 */
export class AllowAllResolver implements PermissionResolver {
  /**
   * Always allow, regardless of context or reason.
   *
   * @returns `'allow'` unconditionally.
   */
  async resolve(): Promise<PermissionDecision> {
    return 'allow';
  }
}

/**
 * A resolver that denies everything — handy for dry-run / audit.
 *
 * Use this when:
 * - Running a "dry run" to see what tools WOULD be called without actually
 *   executing them.
 * - Auditing tool usage patterns by logging all denied calls.
 * - Enforcing a read-only mode by denying all potentially-mutating tools
 *   (combined with `AllowAllResolver` for read-only tools via rules).
 *
 * This is also the **default resolver** if none is configured — all tools
 * are denied by default unless an explicit `AllowAllResolver` or custom
 * resolver is provided.
 */
export class DenyAllResolver implements PermissionResolver {
  /**
   * Always deny, regardless of context or reason.
   *
   * @returns `'deny'` unconditionally.
   */
  async resolve(): Promise<PermissionDecision> {
    return 'deny';
  }
}

/**
 * Configuration options for `PermissionManager`.
 */
export interface PermissionManagerOptions {
  /** Permission rules to evaluate in registration order. */
  rules?: PermissionRule[];
  /**
   * Resolver for escalated ('ask') decisions.
   *
   * Defaults to `DenyAllResolver` — tools are denied unless an explicit
   * resolver is configured.
   */
  resolver?: PermissionResolver;
}

/**
 * The permission manager — orchestrates the three-gate pipeline.
 *
 * ## Lifecycle
 *
 * 1. Create a `PermissionManager` with optional rules and resolver.
 * 2. Optionally add more rules via `addRule()`.
 * 3. Optionally change the resolver via `setResolver()`.
 * 4. Call `check(ctx)` before every tool invocation.
 *
 * ## Thread safety
 *
 * This class is not thread-safe. In a single-threaded Node.js event loop,
 * this is fine — all operations are synchronous except for the resolver's
 * `resolve()` call, which is `await`ed within the same event loop tick.
 */
export class PermissionManager {
  /** Ordered list of permission rules to evaluate. */
  private rules: PermissionRule[];
  /** Resolver for escalated decisions. Defaults to `DenyAllResolver`. */
  private resolver: PermissionResolver;

  /**
   * @param opts — Configuration options.
   * @param opts.rules — Initial set of permission rules.
   * @param opts.resolver — Resolver for 'ask' escalations. Defaults to
   *   `DenyAllResolver` (fail-closed) if not provided.
   */
  constructor(opts: PermissionManagerOptions = {}) {
    this.rules = opts.rules ?? [];
    // IMPORTANT: Default to DenyAllResolver — security decisions should fail
    // closed. If no resolver is configured, escalated 'ask' decisions result
    // in denial, not accidental allowance.
    this.resolver = opts.resolver ?? new DenyAllResolver();
  }

  /**
   * Add a permission rule to the evaluation pipeline.
   *
   * Rules are evaluated in the order they are added. To ensure a rule runs
   * before others, prepend it by manipulating `rules` directly (or add it
   * first before other rules).
   *
   * @param rule — The rule to add.
   */
  addRule(rule: PermissionRule): void {
    this.rules.push(rule);
  }

  /**
   * Replace the current resolver.
   *
   * This is useful for switching between interactive and non-interactive
   * modes (e.g., swapping `AllowAllResolver` in for CI environments).
   *
   * @param resolver — The new resolver to use.
   */
  setResolver(resolver: PermissionResolver): void {
    this.resolver = resolver;
  }

  /**
   * Run the full three-gate pipeline for a tool invocation.
   *
   * The pipeline evaluates rules in registration order:
   * 1. If a rule returns `'allow'` → allow immediately (short-circuit).
   * 2. If a rule returns `'deny'` → deny with reason (short-circuit).
   * 3. If a rule returns `'ask'` or a string → escalate to resolver.
   * 4. If a rule returns `'passthrough'` or `null` → try next rule.
   * 5. If no rules match → allow (permissive default for ungoverned tools).
   *
   * ## Short-circuit behavior
   *
   * The FIRST non-passthrough result wins. This means:
   * - A deny early in the rule list cannot be overridden by a later allow.
   * - An allow early in the rule list short-circuits before later rules.
   *
   * This is intentional: permission order is predictable and auditable,
   * and "first deny wins" is the safer default.
   *
   * @param ctx — Context about the tool invocation (agent name, tool block).
   * @returns A promise resolving to `{ decision, reason? }` where `reason`
   *   is set only on denial.
   */
  async check(ctx: PermissionRuleContext): Promise<{ decision: PermissionDecision; reason?: string }> {
    for (const rule of this.rules) {
      // Skip rules that are scoped to specific tools and don't match this one.
      if (rule.tools && !rule.tools.includes(ctx.tool.name)) continue;

      const verdict = rule.check(ctx);

      // Passthrough: rule has no opinion, let the next rule decide.
      if (verdict === null || verdict === 'passthrough') continue;

      // Accelerate: rule explicitly allows — tool runs immediately.
      if (verdict === 'allow') return { decision: 'allow' };

      // Block: rule explicitly denies — tool is stopped with reason.
      if (verdict === 'deny') {
        return { decision: 'deny', reason: rule.reason ?? `Denied by rule "${rule.name}"` };
      }

      // Escalate with inline reason string: e.g. check() returns
      // "This tool requires admin approval".
      // IMPORTANT: The resolver has final say here — if it denies, the
      // reason is preserved so the user knows why escalation was triggered.
      if (typeof verdict === 'string') {
        const decision = await this.resolver.resolve(ctx, verdict);
        return { decision, reason: decision === 'deny' ? verdict : undefined };
      }

      // Escalate with 'ask': resolver uses the rule's `reason` field.
      // verdict === 'ask'
      const decision = await this.resolver.resolve(ctx, rule.reason ?? `Rule "${rule.name}" requires approval`);
      return { decision, reason: decision === 'deny' ? rule.reason : undefined };
    }

    // No rules matched (or all passed through) — default to allow.
    // This is the fail-open default for ungoverned tools. The safety
    // comes from requiring explicit deny rules for sensitive tools,
    // not from implicitly blocking everything.
    return { decision: 'allow' };
  }
}
