// Browser-side CLIP text encoder for fully static hosting.
// Arbitrary query text is embedded in the browser; weights/tokenizer are
// fetched from Hugging Face on first use, not stored in this repository.
import {AutoTokenizer, CLIPTextModelWithProjection, env} from './vendor/transformers.min.js';

const MODEL_ID = 'Xenova/clip-vit-large-patch14';
const MODEL_SIZE_BYTES = 124987663; // onnx/text_model_quantized.onnx
const PROMPTS = ['{}', 'a 3d model of {}', 'a rendered asset of {}'];
const MAX_LENGTH = 77;
const DIM = 768;
let encoderPromise = null;
let activeHfToken = '';

function canonical(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ');
}

function normalize(values) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!(norm > 0)) throw new Error('browser CLIP query vector has zero norm');
  return values.map((value) => value / norm);
}

export function setHfToken(token) {
  activeHfToken = String(token || '').trim();
  try {
    if (activeHfToken) sessionStorage.setItem('modeldatabase.hfToken', activeHfToken);
    else sessionStorage.removeItem('modeldatabase.hfToken');
  } catch {}
  encoderPromise = null;
  return Boolean(activeHfToken);
}

function restoreHfToken() {
  try { return sessionStorage.getItem('modeldatabase.hfToken') || ''; } catch { return ''; }
}

function withHfAuth(init = {}) {
  const headers = new Headers(init.headers || {});
  if (activeHfToken && !headers.has('authorization')) headers.set('authorization', `Bearer ${activeHfToken}`);
  return {...init, headers};
}

async function loadEncoder(onProgress) {
  if (encoderPromise) return encoderPromise;
  encoderPromise = (async () => {
    if (!activeHfToken) activeHfToken = restoreHfToken();
    onProgress?.({stage: `downloading ${MODEL_ID} text model from Hugging Face`, loaded: 0, total: MODEL_SIZE_BYTES});
    env.allowRemoteModels = true;
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    // Transformers.js uses global fetch for remote model/tokenizer files.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => originalFetch(input, withHfAuth(init));
    try {
      const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
      const model = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, {
        quantized: true,
        device: 'wasm',
        progress_callback: (event) => onProgress?.({
          stage: event.status === 'progress' ? 'downloading CLIP text model' : `CLIP ${event.status || 'model'}`,
          loaded: Number(event.loaded || 0), total: Number(event.total || MODEL_SIZE_BYTES),
        }),
      });
      return {tokenizer, model};
    } finally {
      globalThis.fetch = originalFetch;
    }
  })();
  return encoderPromise;
}

function tensorToVector(tensor) {
  const values = Array.from(tensor.data);
  if (values.length !== DIM) throw new Error(`browser CLIP output has ${values.length} values; expected ${DIM}`);
  return normalize(values.map(Number));
}

export async function encodeQuery(text, {onProgress} = {}) {
  const clean = canonical(text);
  if (!clean) throw new Error('search text is empty');
  const {tokenizer, model} = await loadEncoder(onProgress);
  const prompts = PROMPTS.map((template) => template.replace('{}', clean));
  onProgress?.({stage: 'browser CLIP text embedding', loaded: 0, total: prompts.length});
  const vectors = [];
  for (let i = 0; i < prompts.length; i++) {
    const encoded = tokenizer(prompts[i], {padding: true, truncation: true, max_length: MAX_LENGTH});
    const output = await model({input_ids: encoded.input_ids, attention_mask: encoded.attention_mask});
    const tensor = output.text_embeds || output.last_hidden_state || output.logits || output[0];
    if (!tensor || !tensor.data) throw new Error('browser CLIP model returned no text embedding tensor');
    vectors.push(tensorToVector(tensor));
    onProgress?.({stage: 'browser CLIP text embedding', loaded: i + 1, total: prompts.length});
  }
  const mean = new Array(DIM).fill(0);
  for (const vector of vectors) for (let i = 0; i < DIM; i++) mean[i] += vector[i] / vectors.length;
  return {
    prompt: clean,
    vector: normalize(mean),
    runtime: {kind: 'browser-clip-transformers-js', model: MODEL_ID, source: 'huggingface.co', quantized: true, dim: DIM, model_bytes: MODEL_SIZE_BYTES},
    query_encoder: 'browser-clip-transformers-js',
  };
}
