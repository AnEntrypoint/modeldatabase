// Static browser bootstrap: load compact index app, but override /clip/embed
// with a browser-side Hugging Face CLIP text encoder before the app starts.
const VERSION = '20261114-large768-hf';
import {encodeQuery, setHfToken} from './browser-clip-encoder.js?v=20261114-large768-hf';

const tokenInput = document.getElementById('hf-token');
if (tokenInput) {
  try { tokenInput.value = sessionStorage.getItem('modeldatabase.hfToken') || ''; } catch {}
  tokenInput.addEventListener('change', () => setHfToken(tokenInput.value));
  tokenInput.addEventListener('input', () => setHfToken(tokenInput.value));
  window.__MODELDB_SET_HF_TOKEN__ = (token) => setHfToken(token);
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url;
  if (url && new URL(url, location.href).pathname === '/clip/embed') {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const result = await encodeQuery(body.text || body.query || '', {
      onProgress: (event) => {
        window.__MODELDB_PROGRESS__ = event;
        const label = document.getElementById('progress-label');
        if (label) label.textContent = event.total > 0 ? `${event.stage} ${event.loaded}/${event.total}` : event.stage;
      },
    });
    return new Response(JSON.stringify({
      ok: true,
      model: result.runtime.model,
      embedding_space: 'clip-image-lance',
      query_encoder: result.query_encoder,
      prompts: ['{}', 'a 3d model of {}', 'a rendered asset of {}'],
      dim: result.vector.length,
      query: result.prompt,
      vector: result.vector,
      runtime: result.runtime,
    }), {status: 200, headers: {'content-type': 'application/json'}});
  }
  return originalFetch(input, init);
};

await import('./assets/index-CzodRlXi.js?v=20261114-large768-hf');
