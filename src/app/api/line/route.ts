import { NextResponse } from 'next/server';
import { processLineWebhook } from '../../../line/webhook';
import { createLineClient } from '../../../line/client';
import { InMemoryImageStore } from '../../../line/store';
import { editImageWithGemini } from '../../../line/edit';
import * as cdn from '../../../line/cdn';
import { overlayMeshViaPythonServer, overlayMeshTransferViaPythonServer } from '../../../line/mesh';

export const runtime = 'nodejs';

const store = new InMemoryImageStore({ ttlMs: 5 * 60 * 1000 });

export async function POST(req: Request) {
  const signature = req.headers.get('x-line-signature');
  const channelSecret = process.env.LINE_CHANNEL_SECRET || '';
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

  if (!channelSecret || !accessToken) {
    return NextResponse.json({ ok: false, error: 'LINE env vars missing' }, { status: 500 });
  }

  const bodyText = await req.text();

  const client = createLineClient({ accessToken });
  // Derive public base URL from request headers (works on Vercel/NGINX behind proxy)
  const proto = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim();
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim();
  const baseUrl = process.env.PUBLIC_BASE_URL || (host ? `${proto}://${host}` : '');
  const res = await processLineWebhook({
    bodyText,
    signature,
    channelSecret,
    deps: {
      replyMessage: client.replyMessage,
      pushMessage: client.pushMessage,
      getMessageContent: client.getMessageContent,
      editImageWithPrompt: editImageWithGemini,
      store,
      toPublicUrl: async (dataUrl: string) => {
        // Convert data URL to Buffer and publish under /api/cdn/:id
        const m = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
        if (!m) return dataUrl;
        const mime = m[1];
        const buf = Buffer.from(m[2], 'base64');
        const id = cdn.put(buf, mime);
        if (!baseUrl) return `/api/cdn/${id}`; // best-effort
        return `${baseUrl}/api/cdn/${id}`;
      },
      overlayMesh: process.env.PYTHON_MESH_API_URL
        ? async (dataUrl: string, opts?: { renderW?: number; renderH?: number; alpha?: number; thickness?: number }) => {
            const out = await overlayMeshViaPythonServer(dataUrl, {
              baseUrl: process.env.PYTHON_MESH_API_URL as string,
              timeoutMs: 20000,
              alpha: opts?.alpha ?? 0.45,
              thickness: opts?.thickness ?? 1,
              renderW: opts?.renderW,
              renderH: opts?.renderH,
            });
            return out;
          }
        : undefined,
      overlayMeshTransfer: process.env.PYTHON_MESH_API_URL
        ? async (src: string, tgt: string, opts?: { swap?: boolean; canonToTarget?: boolean; alpha?: number; thickness?: number; renderW?: number; renderH?: number }) => {
            const out = await overlayMeshTransferViaPythonServer(src, tgt, {
              baseUrl: process.env.PYTHON_MESH_API_URL as string,
              timeoutMs: 25000,
              alpha: opts?.alpha ?? 0.45,
              thickness: opts?.thickness ?? 1,
              swap: opts?.swap,
              canonToTarget: opts?.canonToTarget,
              renderW: opts?.renderW,
              renderH: opts?.renderH,
            });
            return out;
          }
        : undefined,
    },
  });

  // Always 200 to LINE except signature failure
  if (res.status === 401) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
