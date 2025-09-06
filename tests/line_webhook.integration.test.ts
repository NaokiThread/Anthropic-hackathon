import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEvents } from '../src/line/handler';
import type { LineEvent, Deps } from '../src/line/types';

const baseDeps = (): Deps => ({
  replyMessage: vi.fn(async () => {}),
  pushMessage: vi.fn(async () => {}),
  getMessageContent: vi.fn(async () => ({ data: Buffer.from('img'), mimeType: 'image/png' })),
  editImageWithPrompt: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,AAA' })),
  store: {
    set: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
  },
  toPublicUrl: vi.fn(async (dataUrl: string) => `http://cdn/${Buffer.from(dataUrl).toString('hex').slice(0,8)}`),
});

describe('handleEvents', () => {
  let deps: Deps;
  beforeEach(() => { deps = baseDeps(); });

  it('image message -> replies with treatment quick reply', async () => {
    const events: LineEvent[] = [
      {
        type: 'message',
        replyToken: 'r1',
        source: { type: 'user', userId: 'U1' },
        timestamp: Date.now(),
        message: { id: 'm1', type: 'image' },
      } as any,
    ];
    await handleEvents(events, deps);
    expect(deps.getMessageContent).toHaveBeenCalledWith('m1');
    expect(deps.replyMessage).toHaveBeenCalled();
    const payload = (deps.replyMessage as any).mock.calls[0][1];
    expect(payload).toMatchObject({ messages: [ { quickReply: expect.any(Object) } ] });
  });

  it('postback with treatment -> replies "generating" then pushes edited image + 2x2 grid + rating quick reply', async () => {
    // Pre-store image for user
    (deps.store.get as any).mockResolvedValueOnce({ data: Buffer.from('img'), mimeType: 'image/png' });
    // Make editImageWithPrompt return different images for successive calls
    let call = 0;
    (deps.editImageWithPrompt as any).mockImplementation(async () => {
      call += 1;
      if (call === 1) return { dataUrl: 'data:image/png;base64,AFTER' }; // after image
      if (call === 2) return { dataUrl: 'data:image/png;base64,ORIG_MESH' }; // original with mesh
      return { dataUrl: 'data:image/png;base64,AFTER_MESH' }; // after with mesh
    });
    const events: LineEvent[] = [
      {
        type: 'postback',
        replyToken: 'r2',
        source: { type: 'user', userId: 'U1' },
        timestamp: Date.now(),
        postback: { data: JSON.stringify({ t: 'nose' }) },
      } as any,
    ];
    await handleEvents(events, deps);
    expect(deps.editImageWithPrompt).toHaveBeenCalled();
    // 1) immediate reply with generating text
    expect(deps.replyMessage).toHaveBeenCalled();
    const replyPayload = (deps.replyMessage as any).mock.calls[0][1];
    expect(replyPayload).toMatchObject({ messages: [ { type: 'text' } ] });
    // 2) push image + grid and ask for rating
    expect(deps.pushMessage).toHaveBeenCalled();
    const pushArgs = (deps.pushMessage as any).mock.calls[0];
    expect(pushArgs[0]).toBe('U1');
    const pushPayload = pushArgs[1];
    expect(Array.isArray(pushPayload.messages)).toBe(true);
    // Should include an image message (After), a flex (2x2), and a text (rating)
    const types = pushPayload.messages.map((m: any) => m.type);
    expect(types).toContain('image');
    expect(types).toContain('flex');
    expect(types).toContain('text');
    // Validate Flex message shape includes 4 images
    const flex = pushPayload.messages.find((m: any) => m.type === 'flex');
    expect(flex).toBeDefined();
    const body = flex.contents?.body;
    expect(body?.type).toBe('box');
    // Count image components recursively
    function countImages(node: any): number {
      if (!node) return 0;
      let c = node.type === 'image' ? 1 : 0;
      const children = ([] as any[]).concat(
        node.contents || [],
        node.children || [],
        node.body ? [node.body] : [],
        node.header ? [node.header] : [],
        node.footer ? [node.footer] : []
      );
      for (const ch of children) c += countImages(ch);
      return c;
    }
    expect(countImages(flex.contents)).toBeGreaterThanOrEqual(4);
  });

  it('postback with rating -> thanks reply', async () => {
    const events: LineEvent[] = [
      {
        type: 'postback',
        replyToken: 'r3',
        source: { type: 'user', userId: 'U1' },
        timestamp: Date.now(),
        postback: { data: JSON.stringify({ r: 'good' }) },
      } as any,
    ];
    await handleEvents(events, deps);
    expect(deps.pushMessage).not.toHaveBeenCalled();
    expect(deps.replyMessage).toHaveBeenCalled();
    const payload = (deps.replyMessage as any).mock.calls[0][1];
    expect(payload).toMatchObject({ messages: [ { type: 'text' } ] });
  });

  it('follow event -> sends guidance message', async () => {
    const events: LineEvent[] = [
      { type: 'follow', replyToken: 'rf', source: { type: 'user', userId: 'U2' }, timestamp: Date.now() } as any,
    ];
    await handleEvents(events, deps);
    expect(deps.replyMessage).toHaveBeenCalled();
    const payload = (deps.replyMessage as any).mock.calls[0][1];
    expect(payload).toMatchObject({ messages: [ { type: 'text' } ] });
  });

  it('non-image message -> sends guidance message via fallback', async () => {
    const events: LineEvent[] = [
      { type: 'message', replyToken: 'rm', source: { type: 'user', userId: 'U3' }, timestamp: Date.now(), message: { id: 't1', type: 'text' } } as any,
    ];
    await handleEvents(events, deps);
    expect(deps.replyMessage).toHaveBeenCalled();
    const payload = (deps.replyMessage as any).mock.calls[0][1];
    expect(payload).toMatchObject({ messages: [ { type: 'text' } ] });
  });
});
