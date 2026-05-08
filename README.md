# MasterStream-Extractors

Hot-updatable extractor scripts for the **MasterStream** app.

The app fetches `manifest.json` from this repo at runtime (max once per hour).
If an extractor hash changed, the app downloads the new JS and uses it immediately — **no app update needed**.

---

## How to Update an Extractor

1. Edit the JS file in `extractors/`
2. Get the new MD5 hash (PowerShell):
   ```powershell
   Get-FileHash .\extractors\VideasyExtractor.js -Algorithm MD5
   ```
3. Update `manifest.json`:
   - Bump `"version"` by 1
   - Update the provider's `"hash"` with the new MD5
4. Commit and push to `main`
5. The app picks it up within **1 hour** (or on next cold start)

---

## Adding a New Provider

1. Create `extractors/NewProvider.js` (self-contained CommonJS, no imports)
2. Add it to `manifest.json`
3. Add `getRemoteExtractor('NewProvider')` in `MultiExtractorService.ts` on the app side

---

## File Format

Each extractor must:
- Be **self-contained** (no `import` statements, no external dependencies)
- Use **CommonJS** `module.exports`
- Export a single `extract(...)` async function
- Use the global `fetch` (available in React Native)

```js
(function () {
  async function extract(tmdbId, imdbId, title, isTv, season, episode) {
    // ... logic using fetch() ...
    return { url, quality, qualities, provider, headers, subtitles };
    // return null on failure
  }
  module.exports = { extract };
})();
```

---

## Providers

| Provider     | File                              | Args                                        |
|--------------|-----------------------------------|---------------------------------------------|
| Videasy      | extractors/VideasyExtractor.js    | (tmdbId, imdbId, title, isTv, season, ep)   |
| Vidlink      | extractors/VidlinkExtractor.js    | (tmdbId, isTv, season, episode)             |
| VidlinkSniffer | extractors/VidlinkSniffer.js   | (tmdbId, isTv, season, episode)             |
| VidSrc       | extractors/VidSrcExtractor.js     | (tmdbId, isTv, season, episode)             |
| VixSrc       | extractors/VixSrcExtractor.js     | (tmdbId, isTv, season, episode)             |
| VidSrcCC     | extractors/VidSrcCCExtractor.js   | (tmdbId, imdbId, isTv, season, episode)     |
