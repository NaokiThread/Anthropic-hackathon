import { generateSurgeryPrompt, defaultIntensities, type SurgeryIntensity } from '../app/prompt';

export type Treatment = {
  id: string;
  label: string;
  // Static prompt text is not used anymore; we now derive from prompt.ts
  prompt?: string;
};

export const TREATMENTS: Treatment[] = [
  { id: 'nose', label: '鼻整形' },
  { id: 'double_eyelid', label: '二重まぶた' },
  { id: 'chin', label: '顎形成' },
  { id: 'jawline', label: '輪郭(フェイスライン)' },
];

export function buildTreatmentQuickReply() {
  return {
    items: TREATMENTS.map((t) => ({
      action: {
        type: 'postback',
        label: t.label,
        data: JSON.stringify({ t: t.id }),
        displayText: `施術: ${t.label}`,
      },
    })),
  } as const;
}

function intensitiesForTreatment(id: string): SurgeryIntensity | undefined {
  const base = { ...defaultIntensities };
  switch (id) {
    case 'nose':
      base.noseReshaping = 6; // 中～強めの自然な変化
      return base;
    case 'double_eyelid':
      base.eyeSurgery = 6;
      return base;
    case 'chin':
      base.facialContouring = 5; // 顎先中心の輪郭補正として表現
      return base;
    case 'jawline':
      base.facialContouring = 6; // 下顔面の輪郭形成をやや強めに
      return base;
    default:
      return undefined;
  }
}

export function treatmentToPrompt(id: string): string | undefined {
  const ints = intensitiesForTreatment(id);
  return ints ? generateSurgeryPrompt(ints) : undefined;
}

export function buildRatingQuickReply() {
  const items = [
    { key: 'good', label: 'Good 👍' },
    { key: 'bad', label: 'Bad 👎' },
  ].map((r) => ({
    action: {
      type: 'postback',
      label: r.label,
      data: JSON.stringify({ r: r.key }),
      displayText: `評価: ${r.label}`,
    },
  }));
  return { items } as const;
}

// Build a LINE Flex Message showing a 2x2 grid of images.
// Layout: [ Before | After ] on first row, [ Before+Mesh | After+Mesh ] on second row.
export function build2x2ComparisonFlex(urls: {
  before: string;
  after: string;
  beforeMesh: string;
  afterMesh: string;
}) {
  const image = (url: string) => ({ type: 'image', url, size: 'full', aspectMode: 'cover', aspectRatio: '1:1' });
  const twoCols = (a: string, b: string) => ({
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    contents: [
      { type: 'box', layout: 'vertical', flex: 1, contents: [image(a)] },
      { type: 'box', layout: 'vertical', flex: 1, contents: [image(b)] },
    ],
  });
  const labels = (a: string, b: string) => ({
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    contents: [
      { type: 'text', text: a, size: 'xs', color: '#666666', align: 'center', flex: 1 },
      { type: 'text', text: b, size: 'xs', color: '#666666', align: 'center', flex: 1 },
    ],
  });
  const contents = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        labels('Before', 'After'),
        twoCols(urls.before, urls.after),
        labels('Before + Mesh', 'After + Mesh'),
        twoCols(urls.beforeMesh, urls.afterMesh),
      ],
    },
  } as const;
  return {
    type: 'flex',
    altText: 'Before/After 2x2 比較',
    contents,
  } as const;
}

// Mesh overlay instruction for image models. Keep neutral and additive.
export const MESH_OVERLAY_PROMPT =
  'Overlay a subtle, semi-transparent green facial landmark wireframe/mesh on the face (eyes, nose, mouth, jawline). Keep the image otherwise unchanged. Return only the overlaid image.';
