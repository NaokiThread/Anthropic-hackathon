import type { Deps, LineEvent, TextMessage, ImageMessage } from './types';
import { buildTreatmentQuickReply, treatmentToPrompt, buildRatingQuickReply, build2x2ComparisonFlex, MESH_OVERLAY_PROMPT } from './templates';

function getUserId(ev: LineEvent): string | undefined {
  const src = (ev as any).source;
  return src?.userId;
}

export async function handleEvents(events: LineEvent[], deps: Deps): Promise<void> {
  for (const ev of events) {
    try {
      // Follow (友だち追加) 時にガイダンスを送信
      if (ev.type === 'follow' && (ev as any).replyToken) {
        const msg: TextMessage = {
          type: 'text',
          text: '顔写真を貼ってください！整形のシミュレーションを実施いたします！',
        };
        await deps.replyMessage((ev as any).replyToken, { messages: [msg] });
        continue;
      }
      if (ev.type === 'message' && ev.message?.type === 'image') {
        const userId = getUserId(ev);
        if (!userId) continue;
        const content = await deps.getMessageContent(ev.message.id);
        await deps.store.set(userId, content);
        const msg: TextMessage = {
          type: 'text',
          text: '顔写真を貼ってください！整形のシミュレーションを実施いたします！',
          quickReply: buildTreatmentQuickReply(),
        };
        await deps.replyMessage(ev.replyToken, { messages: [msg] });
        continue;
      }

      if (ev.type === 'postback') {
        const userId = getUserId(ev);
        if (!userId) continue;
        let data: any = {};
        try { data = JSON.parse(ev.postback?.data ?? '{}'); } catch {}
        // Rating feedback flow
        const rating = typeof data?.r === 'string' ? data.r : undefined;
        if (rating === 'good' || rating === 'bad') {
          const msg: TextMessage = {
            type: 'text',
            text: rating === 'good' ? 'フィードバックありがとうございます！👍' : 'ご意見ありがとうございます。改善に活かします。',
          };
          await deps.replyMessage(ev.replyToken, { messages: [msg] });
          continue;
        }

        // Treatment selection flow
        const treatment = data?.t as string | undefined;
        const prompt = treatment ? treatmentToPrompt(treatment) : undefined;
        const blob = await deps.store.get(userId);
        if (prompt && blob) {
          // 1) immediate reply: generating
          const generating: TextMessage = {
            type: 'text',
            text: 'AIが画像を生成しています。少々お待ちください…',
          };
          await deps.replyMessage(ev.replyToken, { messages: [generating] });

          // 2) compute and push result
          const edited = await deps.editImageWithPrompt(blob, prompt);
          const url = deps.toPublicUrl ? await deps.toPublicUrl(edited.dataUrl) : edited.dataUrl;
          const img: ImageMessage = {
            type: 'image',
            originalContentUrl: url,
            previewImageUrl: url,
          } as any;

          // Push edited image first to ensure at least one result reaches the user promptly
          if (deps.pushMessage) {
            try {
              await deps.pushMessage(userId, { messages: [img] });
            } catch (e) {
              // non-fatal; continue to attempt grid + ask
            }
          }

          // Prepare 2x2 grid assets
          const toDataUrl = (b: { data: Buffer; mimeType: string }) => `data:${b.mimeType};base64,${b.data.toString('base64')}`;
          const originalUrl = deps.toPublicUrl ? await deps.toPublicUrl(toDataUrl(blob)) : toDataUrl(blob);
          // Generate mesh overlays with robust fallbacks
          // 方針: 可能であれば Python の transfer API を両方に使い、
          // どちらか一方だけフォールバックになった場合は両方ともモデル重ね描きに揃える（見た目の一貫性優先）
          let origMeshUrl: string | undefined;
          let afterMeshUrl: string | undefined;
          let usedModelFallbackBefore = false;
          let usedModelFallbackAfter = false;
          const fallbackMeshWithModel = async (dataUrl: string) => {
            const m = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
            const b = m ? { mimeType: m[1], data: Buffer.from(m[2], 'base64') } : { mimeType: 'image/png', data: Buffer.alloc(0) };
            const out = await deps.editImageWithPrompt(b as any, MESH_OVERLAY_PROMPT);
            return deps.toPublicUrl ? await deps.toPublicUrl(out.dataUrl) : out.dataUrl;
          };

          if (deps.overlayMeshTransfer || deps.overlayMesh) {
            // 強制正規化: 両方とも 1024x1024 に描画
            const CANON = 1024;
            try {
              if (deps.overlayMeshTransfer) {
                const afterMesh = await deps.overlayMeshTransfer(toDataUrl(blob), edited.dataUrl, {
                  swap: false,
                  renderW: CANON,
                  renderH: CANON,
                });
                afterMeshUrl = deps.toPublicUrl ? await deps.toPublicUrl(afterMesh.dataUrl) : afterMesh.dataUrl;
              } else if (deps.overlayMesh) {
                const afterMesh = await deps.overlayMesh(edited.dataUrl, { renderW: CANON, renderH: CANON });
                afterMeshUrl = deps.toPublicUrl ? await deps.toPublicUrl(afterMesh.dataUrl) : afterMesh.dataUrl;
              }
            } catch (e) {
              console.warn('[LINE] AFTER mesh overlay failed; trying simple or model fallback:', (e as Error)?.message);
              try {
                if (deps.overlayMesh) {
                  const afterMesh = await deps.overlayMesh(edited.dataUrl, { renderW: CANON, renderH: CANON });
                  afterMeshUrl = deps.toPublicUrl ? await deps.toPublicUrl(afterMesh.dataUrl) : afterMesh.dataUrl;
                } else {
                  throw e;
                }
              } catch (e2) {
                try {
                  afterMeshUrl = await fallbackMeshWithModel(edited.dataUrl);
                  usedModelFallbackAfter = true;
                } catch (e3) {
                  console.error('[LINE] AFTER model overlay also failed:', (e3 as Error)?.message);
                }
              }
            }

            try {
              if (deps.overlayMeshTransfer) {
                // BEFORE + Mesh も transfer API を優先（スタイル統一）
                const beforeMesh = await deps.overlayMeshTransfer(toDataUrl(blob), edited.dataUrl, { swap: true, canonToTarget: true, renderW: CANON, renderH: CANON });
                origMeshUrl = deps.toPublicUrl ? await deps.toPublicUrl(beforeMesh.dataUrl) : beforeMesh.dataUrl;
              } else if (deps.overlayMesh) {
                // 最終フォールバック: 単体API
                const beforeMesh = await deps.overlayMesh(toDataUrl(blob), { renderW: CANON, renderH: CANON });
                origMeshUrl = deps.toPublicUrl ? await deps.toPublicUrl(beforeMesh.dataUrl) : beforeMesh.dataUrl;
              }
            } catch (e) {
              console.warn('[LINE] BEFORE mesh overlay failed; fallback to model:', (e as Error)?.message);
              try {
                origMeshUrl = await fallbackMeshWithModel(toDataUrl(blob));
                usedModelFallbackBefore = true;
              } catch (e2) {
                console.error('[LINE] BEFORE model overlay also failed:', (e2 as Error)?.message);
              }
            }
          } else {
            // No Python server: 両方ともモデル重ね描き
            origMeshUrl = await fallbackMeshWithModel(toDataUrl(blob));
            afterMeshUrl = await fallbackMeshWithModel(edited.dataUrl);
            usedModelFallbackBefore = true;
            usedModelFallbackAfter = true;
          }

          // 片方だけフォールバックになってしまった場合は、見た目を揃えるため両方ともモデル重ね描きに置き換え
          if (
            (origMeshUrl && afterMeshUrl) &&
            ((usedModelFallbackBefore && !usedModelFallbackAfter) || (!usedModelFallbackBefore && usedModelFallbackAfter))
          ) {
            try {
              const [b, a] = await Promise.all([
                fallbackMeshWithModel(toDataUrl(blob)),
                fallbackMeshWithModel(edited.dataUrl),
              ]);
              origMeshUrl = b;
              afterMeshUrl = a;
              usedModelFallbackBefore = true;
              usedModelFallbackAfter = true;
              console.log('[LINE] Unified mesh style by using model overlays for both BEFORE/AFTER');
            } catch (e) {
              console.warn('[LINE] Failed to unify mesh style via model overlays:', (e as Error)?.message);
            }
          }

          // Attempt to push 2x2 flex + ask together (preferred)
          if (deps.pushMessage) {
            const ask: TextMessage = {
              type: 'text',
              text: '結果はいかがでしたか？',
              quickReply: buildRatingQuickReply(),
            } as any;
            if (origMeshUrl && afterMeshUrl) {
              try {
                const flex = build2x2ComparisonFlex({
                  before: originalUrl,
                  after: url,
                  beforeMesh: origMeshUrl,
                  afterMesh: afterMeshUrl,
                });
                await deps.pushMessage(userId, { messages: [flex as any, ask] });
              } catch (e) {
                console.error('[LINE] build or push flex failed; sending ask only:', (e as Error)?.message);
                await deps.pushMessage(userId, { messages: [ask] });
              }
            } else {
              // If meshes are unavailable, still send ask to keep UX progressing
              await deps.pushMessage(userId, { messages: [ask] });
            }
          }
        } else {
          const msg: TextMessage = {
            type: 'text',
            text: '画像が見つからないか、施術が不明です。最初に写真を送信し、続いて施術を選択してください。',
          };
          await deps.replyMessage(ev.replyToken, { messages: [msg] });
        }
        continue;
      }

      // Fallback: 非画像メッセージなど
      if ((ev as any).replyToken) {
        await deps.replyMessage((ev as any).replyToken, {
          messages: [{ type: 'text', text: '顔写真を貼ってください！整形のシミュレーションを実施いたします。' }],
        });
      }
    } catch (e) {
      // Must reply 200 to LINE even on errors; notify user when possible
      const userId = getUserId(ev);
      const errMsg = { messages: [{ type: 'text', text: '処理中にエラーが発生しました。時間をおいて再度お試しください。' }] };
      if (userId && deps.pushMessage) {
        try { await deps.pushMessage(userId, errMsg); } catch {}
      } else if ((ev as any).replyToken) {
        try { await deps.replyMessage((ev as any).replyToken, errMsg); } catch {}
      }
      // swallow
    }
  }
}
