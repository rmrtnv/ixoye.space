# Static Site Cleanup & PWA Fixes

## Context
Switching deploy target from Docker/Xray to GitHub Pages. Repository is now a pure static site.

## Tasks

### 1. Fix `src/sw.js` CONTENT_PATHS
Replace incorrect paths with actual top-level directories:
- `apocrypha-new/`, `apocrypha-old/`, `nag-hammadi/`, `gnostic/`, `kumran/`, `hermetic/`, `study/`, `contacts/`, `links/`

### 2. Add cache-busting via `package.json` version
- `sw.js` fetches `/package.json` at install/activate time
- Cache names: `ixoye-static-v{version}` and `ixoye-content-v{version}`
- Fallback to `'1'` if fetch fails

### 3. Remove search functionality from `src/js/app.js`
- Delete `search_index` IndexedDB store creation
- Delete `addToSearchIndex()` and `searchIndex()`
- Delete `openSearch()`
- Remove Ctrl+F keyboard shortcut handler
- Remove search exports from `window.App`

### 4. Remove non-website files/directories
Delete entirely:
- `xray/` (directory + config.json)
- `docker-compose.yml`
- `Dockerfile`
- `nginx.conf`
- `ras.css`
- `.github/` (workflows)
- `www/` (obsolete portfolio template)

### 5. Update `.gitignore`
Add `xray/logs/` and remove obsolete entries if any.

### 6. Verify `package.json`
Ensure it has a `version` field (it does: `1.0.0`). Document that bumping version busts SW caches.

## Validation
- Run `npm run dev` and verify service worker registers with versioned cache names
- Navigate to content pages and confirm they are cached (check DevTools Application tab)
- Verify no 404s from old `CONTENT_PATHS`
- Confirm search features are absent (no `/search` redirect, no search UI)

## Out of Scope
- Modernizing legacy `index.html` markup
- Adding new search implementation
