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

          // Prepare 2x2 grid assets
          const toDataUrl = (b: { data: Buffer; mimeType: string }) => `data:${b.mimeType};base64,${b.data.toString('base64')}`;
          const originalUrl = deps.toPublicUrl ? await deps.toPublicUrl(toDataUrl(blob)) : toDataUrl(blob);
          // Generate mesh overlays (prefer python-server if provided)
          let origMeshUrl: string;
          let afterMeshUrl: string;
          if (deps.overlayMesh) {
            const origMesh = await deps.overlayMesh(toDataUrl(blob));
            origMeshUrl = deps.toPublicUrl ? await deps.toPublicUrl(origMesh.dataUrl) : origMesh.dataUrl;
            const afterMesh = await deps.overlayMesh(edited.dataUrl);
            afterMeshUrl = deps.toPublicUrl ? await deps.toPublicUrl(afterMesh.dataUrl) : afterMesh.dataUrl;
          } else {
            // Fallback: use image model to draw mesh
            const origMesh = await deps.editImageWithPrompt(blob, MESH_OVERLAY_PROMPT);
            origMeshUrl = deps.toPublicUrl ? await deps.toPublicUrl(origMesh.dataUrl) : origMesh.dataUrl;
            const m = /^data:([^;]+);base64,(.*)$/i.exec(edited.dataUrl);
            const editedBlob = m ? { mimeType: m[1], data: Buffer.from(m[2], 'base64') } : { mimeType: 'image/png', data: Buffer.alloc(0) };
            const afterMesh = await deps.editImageWithPrompt(editedBlob as any, MESH_OVERLAY_PROMPT);
            afterMeshUrl = deps.toPublicUrl ? await deps.toPublicUrl(afterMesh.dataUrl) : afterMesh.dataUrl;
          }

          const flex = build2x2ComparisonFlex({
            before: originalUrl,
            after: url,
            beforeMesh: origMeshUrl,
            afterMesh: afterMeshUrl,
          });
          const ask: TextMessage = {
            type: 'text',
            text: '結果はいかがでしたか？',
            quickReply: buildRatingQuickReply(),
          } as any;
          if (deps.pushMessage) {
            await deps.pushMessage(userId, { messages: [img, flex as any, ask] });
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
      if ((ev as any).replyToken) {
        await deps.replyMessage((ev as any).replyToken, {
          messages: [{ type: 'text', text: '処理中にエラーが発生しました。時間をおいて再度お試しください。' }],
        });
      }
      // swallow
    }
  }
}
