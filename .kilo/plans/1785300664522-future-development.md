# ixoye.space — Future Development Plan

## Current State
- Static site with ~380 HTML pages across 9 content directories
- Deployed to GitHub Pages
- PWA manifest + Service Worker with versioned cache busting
- Auto-generated `precache-manifest.json` via pre-commit hook
- User-facing offline download prompt with progress UI
- **Known issue**: iOS/Mac Safari PWA precache flow is broken (SW controller/scope)

---

## Near-term Fixes (v1.1.0)

### 1. Fix PWA Offline Download
- Diagnose and resolve why `precacheAll` doesn't execute on iOS/Mac
- Known suspects: SW scope edge cases, `controllerchange` timing, `matchAll` client matching
- Add manual retry button in progress UI if auto-trigger fails
- Add visible error messages when precache fails (network, quota, etc.)

### 2. Improve Offline UX
- Show cached page count in UI when online vs offline
- Add "Clear cached data" option in progress modal
- Persist precache completion state in IndexedDB (not just sessionStorage)
- Auto-dismiss prompt after successful precache without manual close

### 3. Polish
- Remove legacy `index.html` TABLE/FONT markup or migrate to semantic HTML
- Add proper `<title>` and meta descriptions per page (currently generic)
- Fix `index.html` Quirks Mode (add `<!DOCTYPE html>`)
- Remove duplicate/obsolete files if any remain

---

## Medium-term (v1.2.0)

### Content Management
- Add sitemap.xml generator script
- Add RSS/Atom feed for new additions
- Implement client-side search using Lunr.js or FlexSearch (indexed in IndexedDB)
- Add reading progress indicator per page
- Add font size controls and theme toggle (light/dark)

### Performance
- Lazy-load images if any heavy assets added
- Add resource hints (`<link rel="preconnect">`, `dns-prefetch`)
- Compress/prepare for Brotli if GitHub Pages supports it
- Split `app.js` into modules for better caching

### Deployment
- Add GitHub Actions for automated testing (lint, link checks)
- Add PR preview deployments
- Automate `precache-manifest.json` generation in CI (in addition to pre-commit hook)

---

## Long-term (v2.0.0)

### Architecture
- Consider migrating to a lightweight static site generator (11ty, Astro) for:
  - Template consistency across 380 pages
  - Auto-generated navigation, sitemaps, feeds
  - Easier content updates via Markdown
- Keep PWA features intact during migration

### Features
- Multi-language support (i18n) if expanding beyond Russian
- User annotations/bookmarks sync via optional backend
- Text-to-speech for accessibility
- Print/PDF export per text

### Infrastructure
- Custom domain + CDN if GitHub Pages limits are reached
- Automated content sync from source manuscripts
- Accessibility audit and WCAG compliance

---

## Backlog (nice-to-have)

- Share button for individual texts (Web Share API)
- Reading history across sessions
- Estimated reading time per page
- Dark mode with warm sepia tones (better for long reading)
- Keyboard navigation between texts
- "Continue reading" from last position
- Offline-first sync for bookmarks/preferences to optional cloud

---

## How to Pick Up This Plan

1. Start with **Near-term Fixes** — they address current user-facing bugs
2. Test each fix on actual iOS/Mac PWA before moving on
3. Keep commits atomic and push to `main` — GitHub Pages deploys automatically
4. Bump `package.json` version when making user-visible changes (cache busting)
