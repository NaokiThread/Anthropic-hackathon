import type { ImageBlob, ImageStore } from './store';

export type LineSource = { type: 'user'; userId: string } | { type: string; userId?: string };

export type MessageEvent = {
  type: 'message';
  replyToken: string;
  source: LineSource;
  timestamp: number;
  message: { id: string; type: 'image' | string };
};

export type PostbackEvent = {
  type: 'postback';
  replyToken: string;
  source: LineSource;
  timestamp: number;
  postback: { data: string };
};

export type LineEvent = MessageEvent | PostbackEvent | { type: string; [k: string]: any };

export type Deps = {
  replyMessage: (replyToken: string, payload: any) => Promise<void>;
  pushMessage: (to: string, payload: any) => Promise<void>;
  getMessageContent: (messageId: string) => Promise<ImageBlob>;
  editImageWithPrompt: (blob: ImageBlob, prompt: string) => Promise<{ dataUrl: string }>;
  store: ImageStore;
  toPublicUrl?: (dataUrl: string) => Promise<string>;
  // Optional: overlay a facial mesh on given image (dataUrl in / out)
  overlayMesh?: (dataUrl: string) => Promise<{ dataUrl: string }>;
};

export type TextMessage = { type: 'text'; text: string; quickReply?: any };
export type ImageMessage = { type: 'image'; originalContentUrl: string; previewImageUrl: string };
