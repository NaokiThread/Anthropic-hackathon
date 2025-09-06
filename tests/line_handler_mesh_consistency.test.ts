import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEvents } from '../src/line/handler';
import type { Deps, LineEvent } from '../src/line/types';

describe('LINE handler - mesh style consistency (unify on partial failure)', () => {
  let deps: Deps;

  beforeEach(() => {
    const imgBlob = { data: Buffer.from('img'), mimeType: 'image/png' } as any;
    const toDataUrl = `data:${imgBlob.mimeType};base64,${imgBlob.data.toString('base64')}`;
    let afterImage = 'data:image/png;base64,AFTER';

    deps = {
      replyMessage: vi.fn(async () => {}),
      pushMessage: vi.fn(async () => {}),
      getMessageContent: vi.fn(async () => imgBlob),
      // 1st call -> returns AFTER image; subsequent calls (fallback overlays) return dummy overlays
      editImageWithPrompt: vi.fn(async (_b: any, _p: string) => {
        // After image the first time
        const calls = (deps.editImageWithPrompt as any).mock.calls.length;
        if (calls === 0) return { dataUrl: afterImage };
        // Mesh overlays via model fallback thereafter
        return { dataUrl: 'data:image/png;base64,MODEL_OVERLAY' };
      }),
      store: {
        set: vi.fn(async () => {}),
        get: vi.fn(async () => imgBlob),
      },
      toPublicUrl: vi.fn(async (du: string) => `https://cdn/${Buffer.from(du).toString('hex').slice(0, 12)}`),
      // Provide overlayMeshTransfer but make AFTER path fail to force unification
      overlayMeshTransfer: vi.fn(async (src: string, tgt: string) => {
        if (src === tgt) {
          return { dataUrl: 'data:image/png;base64,PY_BEFORE' };
        }
        throw new Error('python 500');
      }),
    } as unknown as Deps;
  });

  it('falls back to model for both BEFORE/AFTER when one side fails, keeping style consistent', async () => {
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

    // After image generation + two model overlays (BEFORE/AFTER)
    expect((deps.editImageWithPrompt as any).mock.calls.length).toBeGreaterThanOrEqual(3);

    // Second push should include a text ask regardless
    const pushCalls = (deps.pushMessage as any).mock.calls as any[];
    const hasAsk = pushCalls.some(([, payload]: any) => Array.isArray(payload?.messages) && payload.messages.some((m: any) => m?.type === 'text'));
    expect(hasAsk).toBe(true);
  });
});

