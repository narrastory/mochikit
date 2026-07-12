import { describe, it, expect, beforeEach } from 'vitest';
import { ProtocolManager, newRequestId } from '../../src/collaboration/protocols.js';

describe('ProtocolManager', () => {
  let pm: ProtocolManager;

  beforeEach(() => {
    pm = new ProtocolManager();
  });

  describe('createRequest', () => {
    it('creates a shutdown request and returns an ID', () => {
      const id = pm.createRequest('shutdown', 'lead', 'worker', 'Please stop');
      expect(id).toMatch(/^req_\d{6}$/);
      const state = pm.getRequest(id);
      expect(state).toBeDefined();
      expect(state!.type).toBe('shutdown');
      expect(state!.sender).toBe('lead');
      expect(state!.target).toBe('worker');
      expect(state!.status).toBe('pending');
      expect(state!.payload).toBe('Please stop');
    });

    it('creates a plan_approval request', () => {
      const id = pm.createRequest('plan_approval', 'worker', 'lead', 'Refactor auth module');
      const state = pm.getRequest(id);
      expect(state!.type).toBe('plan_approval');
    });

    it('generates unique IDs', () => {
      const id1 = pm.createRequest('shutdown', 'a', 'b', '');
      const id2 = pm.createRequest('shutdown', 'a', 'b', '');
      expect(id1).not.toBe(id2);
    });
  });

  describe('handleResponse', () => {
    it('approves a shutdown request', () => {
      const id = pm.createRequest('shutdown', 'lead', 'worker', '');
      const result = pm.handleResponse('shutdown_response', id, true);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('approved');
    });

    it('rejects a plan_approval request', () => {
      const id = pm.createRequest('plan_approval', 'worker', 'lead', 'Plan');
      const result = pm.handleResponse('plan_approval_response', id, false);
      expect(result!.status).toBe('rejected');
    });

    it('returns null for unknown request ID', () => {
      const result = pm.handleResponse('shutdown_response', 'req_999999', true);
      expect(result).toBeNull();
    });

    it('returns null for type mismatch (shutdown vs plan_approval)', () => {
      const id = pm.createRequest('shutdown', 'a', 'b', '');
      const result = pm.handleResponse('plan_approval_response', id, true);
      expect(result).toBeNull();
    });

    it('is idempotent — ignores duplicate responses', () => {
      const id = pm.createRequest('shutdown', 'a', 'b', '');
      pm.handleResponse('shutdown_response', id, true);
      const result = pm.handleResponse('shutdown_response', id, false); // second response
      expect(result).toBeNull(); // already resolved
    });
  });

  describe('listPending', () => {
    it('lists only pending requests', () => {
      pm.createRequest('shutdown', 'a', 'b', '');
      const id2 = pm.createRequest('plan_approval', 'c', 'd', '');
      pm.handleResponse('plan_approval_response', id2, true); // resolve the plan_approval
      const pending = pm.listPending();
      expect(pending).toHaveLength(1); // only the unresolved shutdown
      expect(pending[0].type).toBe('shutdown');
    });

    it('returns empty when all resolved', () => {
      const id = pm.createRequest('shutdown', 'a', 'b', '');
      pm.handleResponse('shutdown_response', id, true);
      expect(pm.listPending()).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('removes a request from tracking', () => {
      const id = pm.createRequest('shutdown', 'a', 'b', '');
      pm.remove(id);
      expect(pm.getRequest(id)).toBeUndefined();
    });
  });
});

describe('newRequestId', () => {
  it('produces req_NNNNNN format', () => {
    const id = newRequestId();
    expect(id).toMatch(/^req_\d{6}$/);
  });
});
