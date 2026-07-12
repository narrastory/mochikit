/**
 * Team protocols — structured request-response state machine for inter-agent
 * coordination (tutorial s16).
 *
 * Supports two protocol types:
 * - shutdown: lead requests a teammate to gracefully shut down
 * - plan_approval: teammate submits a plan for lead approval before acting
 *
 * Each request is tracked by a unique request_id; responses are matched back
 * via ProtocolManager.
 */

export type ProtocolType = 'shutdown' | 'plan_approval';

export interface ProtocolState {
  requestId: string;
  type: ProtocolType;
  sender: string;
  target: string;
  status: 'pending' | 'approved' | 'rejected';
  payload: string;
  createdAt: number;
}

let reqCounter = 0;

/** Generate a unique request ID. */
export function newRequestId(): string {
  reqCounter += 1;
  return `req_${String(reqCounter).padStart(6, '0')}`;
}

export class ProtocolManager {
  private pending = new Map<string, ProtocolState>();

  /** Create a new protocol request. Returns the requestId. */
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
   * Handle a response to a pending request.
   * Validates type compatibility and idempotency.
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

  /** Look up a request by ID. */
  getRequest(requestId: string): ProtocolState | undefined {
    return this.pending.get(requestId);
  }

  /** List all pending (unresolved) requests. */
  listPending(): ProtocolState[] {
    return [...this.pending.values()].filter((r) => r.status === 'pending');
  }

  /** Remove a resolved request from tracking. */
  remove(requestId: string): void {
    this.pending.delete(requestId);
  }
}
