// Call Python Face Mesh server to overlay mesh on an input image data URL
export async function overlayMeshViaPythonServer(
  dataUrl: string,
  opts: { baseUrl: string; timeoutMs?: number; alpha?: number; thickness?: number; renderW?: number; renderH?: number }
): Promise<{ dataUrl: string }> {
  const { baseUrl } = opts;
  // Prepare multipart form with file 'image' and consent true
  const m = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
  if (!m) return { dataUrl };
  const mime = m[1];
  const buf = Buffer.from(m[2], 'base64');
  const form = new FormData();
  form.append('image', new Blob([buf], { type: mime }), 'image.png');
  form.append('consent', 'true');
  if (opts.alpha != null) form.append('alpha', String(opts.alpha));
  if (opts.thickness != null) form.append('thickness', String(opts.thickness));
  if (opts.renderW != null) form.append('render_w', String(opts.renderW));
  if (opts.renderH != null) form.append('render_h', String(opts.renderH));
  const url = `${baseUrl.replace(/\/$/, '')}/visualize-mesh`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 20000);
  const res = await fetch(url, { method: 'POST', body: form as any, signal: ac.signal as any });
  clearTimeout(t);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`overlayMeshViaPythonServer failed: ${res.status} ${txt}`);
  }
  const json = await res.json();
  const out = json?.mesh_image;
  if (typeof out === 'string' && out.startsWith('data:')) {
    return { dataUrl: out };
  }
  throw new Error('overlayMeshViaPythonServer: no mesh_image in response');
}

// Overlay mesh computed from the "source" image onto the "target" image
export async function overlayMeshTransferViaPythonServer(
  sourceDataUrl: string,
  targetDataUrl: string,
  opts: { baseUrl: string; timeoutMs?: number; alpha?: number; thickness?: number; swap?: boolean; canonToTarget?: boolean; renderW?: number; renderH?: number }
): Promise<{ dataUrl: string; info?: any }> {
  const { baseUrl } = opts;
  const parse = (du: string) => {
    const m = /^data:([^;]+);base64,(.*)$/i.exec(du);
    if (!m) throw new Error('Invalid data URL');
    return { mime: m[1], buf: Buffer.from(m[2], 'base64') };
  };
  const s = parse(sourceDataUrl);
  const target = parse(targetDataUrl);
  const form = new FormData();
  form.append('source_image', new Blob([s.buf], { type: s.mime }), 'source.png');
  form.append('target_image', new Blob([target.buf], { type: target.mime }), 'target.png');
  form.append('consent', 'true');
  form.append('swap', String(opts.swap ?? false));
  if (opts.alpha != null) form.append('alpha', String(opts.alpha));
  if (opts.thickness != null) form.append('thickness', String(opts.thickness));
  if (opts.canonToTarget != null) form.append('canon_to_target', String(!!opts.canonToTarget));
  if (opts.renderW != null) form.append('render_w', String(opts.renderW));
  if (opts.renderH != null) form.append('render_h', String(opts.renderH));
  const url = `${baseUrl.replace(/\/$/, '')}/mesh/overlay`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 25000);
  const res = await fetch(url, { method: 'POST', body: form as any, signal: ac.signal as any });
  clearTimeout(timer);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`overlayMeshTransferViaPythonServer failed: ${res.status} ${txt}`);
  }
  const json = await res.json();
  const out = json?.mesh_image;
  if (typeof out === 'string' && out.startsWith('data:')) return { dataUrl: out, info: json?.info };
  throw new Error('overlayMeshTransferViaPythonServer: no mesh_image in response');
}
