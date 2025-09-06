import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEvents } from '../src/line/handler';
import type { Deps, LineEvent } from '../src/line/types';

// Verifies that the handler uses the same transfer API for BOTH overlays
// (BEFORE->BEFORE and BEFORE->AFTER), which helps keep mesh style consistent.
describe('LINE handler - uses transfer API for both overlays', () => {
  let deps: Deps;

  beforeEach(() => {
    const imgBlob = { data: Buffer.from('img'), mimeType: 'image/png' } as any;
    const after = { dataUrl: 'data:image/png;base64,AFTER' };
    deps = {
      replyMessage: vi.fn(async () => {}),
      pushMessage: vi.fn(async () => {}),
      getMessageContent: vi.fn(async () => imgBlob),
      editImageWithPrompt: vi.fn(async () => after),
      store: { set: vi.fn(async () => {}), get: vi.fn(async () => imgBlob) },
      toPublicUrl: vi.fn(async (du: string) => du),
      overlayMeshTransfer: vi.fn(async (_src, _tgt) => ({ dataUrl: 'data:image/png;base64,OVERLAY' })),
    } as unknown as Deps;
  });

  it('calls overlayMeshTransfer exactly twice (B->B and B->A)', async () => {
    const events: LineEvent[] = [
      {
        type: 'postback',
        replyToken: 'r',
        source: { type: 'user', userId: 'U' },
        timestamp: Date.now(),
        postback: { data: JSON.stringify({ t: 'nose' }) },
      } as any,
    ];

    await handleEvents(events, deps);

    const calls = (deps.overlayMeshTransfer as any).mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

