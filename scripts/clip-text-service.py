#!/usr/bin/env python3
"""Local CLIP text embedding endpoint for arbitrary modeldb queries."""
import json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import torch
from transformers import CLIPModel, CLIPTokenizerFast

MODEL = 'openai/clip-vit-large-patch14'
PROMPTS = ('{}', 'a 3d model of {}', 'a rendered asset of {}')
PORT = int(os.environ.get('PORT', '8794'))

tok = CLIPTokenizerFast.from_pretrained(MODEL)
model = CLIPModel.from_pretrained(MODEL).eval()

def encode(text):
    text = ' '.join(str(text or '').strip().split())
    if not text: raise ValueError('empty query')
    prompts = [p.format(text) for p in PROMPTS]
    batch = tok(prompts, padding=True, truncation=True, return_tensors='pt')
    with torch.no_grad():
        out = model.get_text_features(**batch)
        if hasattr(out, 'text_embeds'): feats = out.text_embeds
        elif hasattr(out, 'pooler_output'): feats = out.pooler_output
        elif hasattr(out, 'last_hidden_state'): feats = out.last_hidden_state[:, 0]
        elif torch.is_tensor(out): feats = out
        else: raise RuntimeError(f'unsupported CLIP output {type(out)}')
        feats = feats.float()
        feats = feats / feats.norm(dim=-1, keepdim=True)
        v = feats.mean(dim=0)
        v = v / v.norm()
    return {
        'model': MODEL,
        'embedding_space': 'clip-image-lance',
        'query_encoder': 'clip-text',
        'prompts': list(PROMPTS),
        'dim': int(v.shape[0]),
        'query': text,
        'vector': [float(x) for x in v.cpu().numpy()],
    }

class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(b)))
        self.send_header('access-control-allow-origin', '*')
        self.send_header('access-control-allow-headers', 'content-type')
        self.send_header('cache-control', 'no-store')
        self.end_headers()
        self.wfile.write(b)
    def do_OPTIONS(self): self._json(200, {'ok': True})
    def do_GET(self):
        if urlparse(self.path).path == '/health': return self._json(200, {'ok': True, 'model': MODEL, 'prompts': list(PROMPTS)})
        return self._json(404, {'error': 'not_found'})
    def do_POST(self):
        if urlparse(self.path).path != '/embed': return self._json(404, {'error': 'not_found'})
        n = int(self.headers.get('content-length', '0') or 0)
        try:
            body = json.loads(self.rfile.read(n) or b'{}')
            r = encode(body.get('text') or body.get('query') or '')
            r['ok'] = True
            return self._json(200, r)
        except Exception as e:
            return self._json(400, {'ok': False, 'error': str(e)})
    def log_message(self, fmt, *args):
        pass

if __name__ == '__main__':
    print(json.dumps({'ok': True, 'event': 'listening', 'port': PORT, 'model': MODEL}), flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
