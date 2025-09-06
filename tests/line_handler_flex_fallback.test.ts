import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEvents } from '../src/line/handler';
import type { Deps, LineEvent } from '../src/line/types';

describe('LINE handler - fallback when mesh overlay fails', () => {
  let deps: Deps;

  beforeEach(() => {
    deps = {
      replyMessage: vi.fn(async () => {}),
      pushMessage: vi.fn(async () => {}),
      getMessageContent: vi.fn(async () => ({ data: Buffer.from('img'), mimeType: 'image/png' })),
      // Called for both the edited image and potential mesh fallback
      editImageWithPrompt: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,AAA' })),
      store: {
        set: vi.fn(async () => {}),
        get: vi.fn(async () => ({ data: Buffer.from('img'), mimeType: 'image/png' })),
      },
      toPublicUrl: vi.fn(async (du: string) => `https://example.com/${du.length}.png`),
      // Simulate Python server being available but failing
      overlayMesh: vi.fn(async () => { throw new Error('python 500'); }),
      overlayMeshTransfer: vi.fn(async () => { throw new Error('python 500'); }),
    } as unknown as Deps;
  });

  it('still pushes the rating ask, and attempts to send a 2x2 flex', async () => {
    const events: LineEvent[] = [
      {
        type: 'postback',
        replyToken: 'r1',
        source: { type: 'user', userId: 'U' },
        timestamp: Date.now(),
        postback: { data: JSON.stringify({ t: 'nose' }) },
      } as any,
    ];

    await handleEvents(events, deps);

    // First push should be an image (the edited result)
    const pushCalls = (deps.pushMessage as any).mock.calls as any[];
    expect(pushCalls.length).toBeGreaterThanOrEqual(1);
    const hasImage = pushCalls.some(([, payload]: any) => Array.isArray(payload?.messages) && payload.messages.some((m: any) => m?.type === 'image'));
    expect(hasImage).toBe(true);

    // Ensure that we at least ask for rating even if flex fails
    const hasAsk = pushCalls.some(([, payload]: any) => Array.isArray(payload?.messages) && payload.messages.some((m: any) => m?.type === 'text' && /結果はいかがでしたか？/.test(m.text)));
    expect(hasAsk).toBe(true);
  });
});

