// Call Python Face Mesh server to overlay mesh on an input image data URL
export async function overlayMeshViaPythonServer(dataUrl: string, opts: { baseUrl: string }): Promise<{ dataUrl: string }> {
  const { baseUrl } = opts;
  // Prepare multipart form with file 'image' and consent true
  const m = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
  if (!m) return { dataUrl };
  const mime = m[1];
  const buf = Buffer.from(m[2], 'base64');
  const form = new FormData();
  form.append('image', new Blob([buf], { type: mime }), 'image.png');
  form.append('consent', 'true');
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/visualize-mesh`, { method: 'POST', body: form as any });
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

