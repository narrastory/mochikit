import { describe, it, expect } from 'vitest';
import { InMemoryMessageBus } from '../../src/index.js';

describe('InMemoryMessageBus', () => {
  it('sends and consumes messages destructively', async () => {
    const bus = new InMemoryMessageBus();
    await bus.send({ from: 'm', to: 'w', content: 'hi', type: 'message' });
    await bus.send({ from: 'm', to: 'w', content: 'bye', type: 'message' });
    const peek = await bus.peekInbox('w');
    expect(peek).toHaveLength(2);
    const read = await bus.readInbox('w');
    expect(read).toHaveLength(2);
    expect(read[0].content).toBe('hi');
    const again = await bus.readInbox('w');
    expect(again).toHaveLength(0);
  });
});
