# modeldatabase

Static GitHub Pages build of the modeldb compact visual search.

This is a browser-only snapshot:

- `index.html`, `app-static.js`, `assets/`, and `compact-index/` are the compact search app.
- `browser-clip-encoder.js` and `vendor/transformers.min.js` provide query embeddings directly in the browser; no `/clip/embed` server is needed.
- `thumbs/<hash>/0.webp` contains pre-extracted sprite sheets from the local `thumbs.pack`; no `/thumb/pack/*` range server is needed.
- GLB download links still point to the public Spawn CDN.

Generated from `/workspace/modeldatabase` and `/workspace/index/lance/thumbs.pack` (47,572 models).
