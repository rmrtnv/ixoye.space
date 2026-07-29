# Static Site Cleanup + PWA Offline Support

## Context
Repository is now a pure static site deployed to GitHub Pages. Remove all non-website infrastructure and fix/enhance PWA functionality so the site works fully offline when installed as a PWA.

---

## Task 1: Fix `src/sw.js` CONTENT_PATHS

Replace broken paths with actual top-level directories:

```javascript
const CONTENT_PATHS = [
  '/', '/index.html',
  '/apocrypha-new/', '/apocrypha-old/',
  '/nag-hammadi/', '/gnostic/', '/kumran/',
  '/hermetic/', '/study/',
  '/contacts/', '/links/'
];
```

Or generate dynamically from a static list at the top of the file.

## Task 2: Cache-busting via `package.json` version

In `src/sw.js`, at install/activate:
1. Fetch `/package.json`
2. Extract `version` field; fallback to `'1'`
3. Use `ixoye-static-v{version}` and `ixoye-content-v{version}` as cache names
4. Delete old caches with different versions on activate

## Task 3: Remove search functionality from `src/js/app.js`

Delete:
- `addToSearchIndex()`, `searchIndex()`
- `search_index` IndexedDB store creation in `initIndexedDB()`
- `openSearch()` function
- Ctrl+F keyboard shortcut handler
- Search exports from `window.App`

Keep: bookmarks, preferences, online status, scroll position, storage estimate.

## Task 4: Auto-precache on standalone launch

Add to `src/js/app.js` `initApp()`:

```javascript
const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
if (isStandalone && navigator.serviceWorker.controller) {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const isWifi = !connection || connection.type !== 'cellular' || connection.effectiveType !== '2g';
  if (isWifi) {
    navigator.serviceWorker.controller.postMessage('precacheAll');
  }
}
```

Add to `src/sw.js` message handler:

```javascript
if (event.data === 'precacheAll') {
  const response = await fetch('/precache-manifest.json');
  const urls = await response.json();
  const cache = await caches.open(CONTENT_CACHE);
  await cache.addAll(urls);
}
```

## Task 5: Generate `precache-manifest.json`

Add to `package.json`:

```json
"generate-precache": "find . -name '*.html' -not -path './.git/*' | sed 's|^\\./||' | jq -Rn '[inputs]' > precache-manifest.json"
```

Optional one-time Git pre-commit hook (`.git/hooks/pre-commit`):

```bash
#!/bin/sh
npm run generate-precache
git add precache-manifest.json
```

## Task 6: Remove non-website files

Delete:
- `xray/` directory
- `docker-compose.yml`
- `Dockerfile`
- `nginx.conf`
- `ras.css`
- `.github/` directory
- `www/` directory

## Task 7: Update `.gitignore`

Add:
- `xray/logs/`

## Task 8: Update `README.md`

Remove Docker/Xray deployment instructions. Add:
- How to bump version to invalidate SW caches
- How to regenerate `precache-manifest.json`
- Note about offline/PWA support

## Validation
1. Run `npm run dev`, verify SW registers with versioned cache names from `package.json`
2. Navigate content pages, confirm cached in DevTools Application → Cache Storage
3. Enable offline in DevTools, navigate to cached pages — they load
4. Emulate standalone display mode, verify precache runs (check Console for SW message log)
5. Confirm no references to removed APIs (search, xray, docker)

## Out of Scope
- Modernizing legacy `index.html` markup
- Progress UI for precaching
- Custom install prompt UI
