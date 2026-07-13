/**
 * Team protocols — structured request-response state machine for inter-agent
 * coordination (tutorial s16).
 *
 * ## Supported protocol types
 * - **shutdown** — a lead agent requests a teammate to gracefully shut down.
 *   The teammate responds with `shutdown_response` (approved or rejected).
 * - **plan_approval** — a teammate submits an action plan to the lead for
 *   approval before executing. The lead responds with `plan_approval_response`.
 *
 * ## State machine
 * Each protocol request transitions through three states:
 * ```
 * pending → approved
 *        ↘ rejected
 * ```
 *
 * ## Transition guards
 * - **Type validation**: `handleResponse` checks that the response type
 *   matches the expected pattern (`<protocol_type>_response`). Mismatched
 *   types are silently ignored (returns `null`).
 * - **Idempotency**: once a request is `approved` or `rejected`, further
 *   responses are ignored. A request cannot transition out of a terminal
 *   state.
 *
 * ## Message types (6 total)
 * | Direction | Type | Purpose |
 * |-----------|------|---------|
 * | Any -> Any | `shutdown` | Request graceful shutdown |
 * | Any -> Any | `shutdown_response` | Accept or reject a shutdown request |
 * | Any -> Any | `plan_approval` | Submit a plan for approval |
 * | Any -> Any | `plan_approval_response` | Approve or reject a plan |
 * | Any -> Any | `info` | Unidirectional informational message |
 * | Any -> Any | `ack` | Acknowledge receipt of a message |
 *
 * ## Usage
 * A `ProtocolManager` tracks all pending requests. Agents communicate
 * protocol messages through the Team's shared MessageBus; the
 * `ProtocolManager` validates and resolves them via `handleResponse`.
 *
 * @example
 * ```ts
 * const pm = new ProtocolManager();
 * const reqId = pm.createRequest('shutdown', 'lead', 'worker-1', 'Please shut down');
 * // ... worker-1 responds ...
 * const result = pm.handleResponse('shutdown_response', reqId, true);
 * // result.status === 'approved'
 * ```
 */

/**
 * Supported protocol types.
 *
 * - `shutdown` — Request a teammate to stop processing.
 * - `plan_approval` — Request approval for an action plan before execution.
 */
export type ProtocolType = 'shutdown' | 'plan_approval';

/**
 * Snapshot of a single protocol request's state.
 *
 * Each request is identified by a unique `requestId` and tracks the sender,
 * target, current status, and the payload content.
 */
export interface ProtocolState {
  /** Unique identifier for this request (e.g. `req_000001`). */
  requestId: string;
  /** The protocol type — determines the expected response type. */
  type: ProtocolType;
  /** Name of the agent that initiated the request. */
  sender: string;
  /** Name of the agent the request is directed to. */
  target: string;
  /** Current resolution status. */
  status: 'pending' | 'approved' | 'rejected';
  /** Free-form content of the request or response. */
  payload: string;
  /** Unix timestamp (ms) when the request was created. */
  createdAt: number;
}

/** Monotonically increasing counter for generating unique request IDs. */
let reqCounter = 0;

/**
 * Generate a unique request ID.
 *
 * IDs are formatted as `req_` followed by a zero-padded counter
 * (e.g. `req_000001`, `req_000042`). The counter is module-scoped and
 * monotonically increasing — unique across all {@link ProtocolManager}
 * instances within the same process.
 *
 * @returns A unique request ID string.
 */
export function newRequestId(): string {
  reqCounter += 1;
  return `req_${String(reqCounter).padStart(6, '0')}`;
}

/**
 * Manages the lifecycle of protocol requests between agents.
 *
 * Acts as a state machine that:
 * 1. Creates new protocol requests with `createRequest`.
 * 2. Validates and resolves pending requests via `handleResponse`.
 * 3. Provides query methods for inspection (`getRequest`, `listPending`,
 *    `remove`).
 *
 * ## Transition rules
 * A request starts as `pending`. `handleResponse` will only transition it
 * to `approved` or `rejected` if:
 * - The request ID is known (exists in the manager).
 * - The response type matches the expected pattern (e.g. a `shutdown` request
 *   expects `shutdown_response`).
 * - The request is still `pending` (idempotency — terminal states are final).
 *
 * If any guard fails, `handleResponse` returns `null` and the state is
 * unchanged.
 */
export class ProtocolManager {
  /** Map of pending and resolved requests, keyed by request ID. */
  private pending = new Map<string, ProtocolState>();

  /**
   * Create a new protocol request in `pending` status.
   *
   * @param type - The protocol type (determines expected response type).
   * @param sender - Name of the initiating agent.
   * @param target - Name of the recipient agent.
   * @param payload - Free-form content describing the request.
   * @returns The unique request ID for tracking this request.
   */
  createRequest(
    type: ProtocolType,
    sender: string,
    target: string,
    payload: string,
  ): string {
    const requestId = newRequestId();
    this.pending.set(requestId, {
      requestId,
      type,
      sender,
      target,
      status: 'pending',
      payload,
      createdAt: Date.now(),
    });
    return requestId;
  }

  /**
   * Handle a response to a pending protocol request.
   *
   * Applies three guards before transitioning state:
   * 1. **Existence** — the request ID must be known.
   * 2. **Type match** — the response type must equal `<request_type>_response`.
   * 3. **Idempotency** — the request must still be `pending` (not already
   *    approved or rejected).
   *
   * @param responseType - The type string from the response message
   *   (e.g. `shutdown_response`).
   * @param requestId - The request ID this response is addressing.
   * @param approved - `true` to approve, `false` to reject.
   * @returns The updated `ProtocolState` if the transition succeeded, or
   *   `null` if any guard failed (unknown request, type mismatch, or already
   *   resolved).
   */
  handleResponse(
    responseType: string,
    requestId: string,
    approved: boolean,
  ): ProtocolState | null {
    const state = this.pending.get(requestId);
    if (!state) return null; // unknown request

    // Type validation
    const expectedResponse = `${state.type}_response`;
    if (responseType !== expectedResponse) return null; // type mismatch

    // Idempotency
    if (state.status !== 'pending') return null; // already resolved

    state.status = approved ? 'approved' : 'rejected';
    return state;
  }

  /**
   * Look up a protocol request by its ID.
   *
   * @param requestId - The unique request ID.
   * @returns The `ProtocolState` if found, or `undefined` if unknown.
   */
  getRequest(requestId: string): ProtocolState | undefined {
    return this.pending.get(requestId);
  }

  /**
   * List all unresolved (still `pending`) protocol requests.
   *
   * @returns Array of `ProtocolState` objects with status `pending`.
   */
  listPending(): ProtocolState[] {
    return [...this.pending.values()].filter((r) => r.status === 'pending');
  }

  /**
   * Remove a resolved request from tracking.
   *
   * Safe to call even if the request ID is unknown (no-op in that case).
   *
   * @param requestId - The unique request ID to remove.
   */
  remove(requestId: string): void {
    this.pending.delete(requestId);
  }
}
