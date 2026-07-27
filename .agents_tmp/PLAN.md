# 1. OBJECTIVE

Migrate and modernize a static HTML website (Russian Apocryphal Studio - a scholarly repository of early Christian texts in Russian) to the new domain **ixoye.space**, clean up HTTrack artifacts, remove dead tracking scripts, fix encoding, and convert content to a universal format suitable for a modern Progressive Web App (PWA) with offline capabilities.

# 2. CONTEXT SUMMARY

**What this site is:**
- A scholarly Russian-language website presenting the largest collection of early Christian and related texts in Russian
- Content includes: Nag Hammadi Library, New Testament apocrypha, Old Testament apocrypha, Gnostic texts, Dead Sea Scrolls, Hermetic treatises, and research articles
- Created in 2001, maintained until 2025

**Current State:**
- **Tech Stack:** Pure static HTML with inline CSS, windows-1251 encoding, some .shtml (SSI) files
- **Total HTML files:** ~200+ files across 9 content sections
- **CSS:** Single file (`ras.css`) with minimal styling
- **Total Content Size:** ~10-15MB of HTML content (estimated)

**Cleanup Required:**
- HTTrack website copier artifacts in every HTML file
- Dead tracking scripts (LiveInternet, Rambler, Mail.ru counters)
- windows-1251 encoding (needs UTF-8 conversion)
- Clutter from multiple archived/archived domains in root

**Content Sections:**
| Directory | Content |
|-----------|---------|
| `nag_hammadi/` | Nag Hammadi Library texts |
| `apocryph1/` | New Testament apocrypha (~100 texts) |
| `apocryph2/` | Old Testament apocrypha |
| `hermes/` | Hermetic treatises |
| `gnost/` | Gnostic texts |
| `kumran/` | Dead Sea Scrolls (Qumran texts) |
| `study/` | Research articles and commentaries |
| `links/`, `news/`, `contacts/` | Navigation/content pages |

# 3. APPROACH OVERVIEW

**Phase 1: Clean Up** - Remove all HTTrack artifacts, dead tracking scripts, and convert to UTF-8 encoding.

**Phase 2: Reorganize** - Move main content to project root, remove archived domain folders, restructure for maintainability.

**Phase 3: Convert to Universal Format** - Transform HTML content to **Markdown** for:
- Git-friendly version control
- Easy editing and collaboration
- Portable across platforms
- Convertible to any format (HTML, ePub, PDF, etc.)

**Phase 4: Modern Web App Foundation** - Set up PWA infrastructure:
- Convert to static site generator compatible format
- Add Service Worker for offline access
- Structure for IndexedDB caching
- Manifest for installability

**Offline Storage Considerations:**
| Storage Type | Capacity | Use Case |
|--------------|----------|----------|
| Service Worker Cache | Unlimited* | All static assets (HTML, CSS, JS, fonts, images) |
| IndexedDB | 50MB+ per origin | Search index, user preferences, bookmarks |
| localStorage | 5-10MB per domain | Simple key-value settings |

*Service Worker cache is virtually unlimited but depends on user's disk space. For ~200 texts (~10MB text), this easily fits in offline storage.

**Rationale for Markdown + PWA:**
- Markdown is the gold standard for text-focused content
- Git-friendly for collaborative editing
- Can be processed by static site generators (Astro, Hugo, Jekyll, Eleventy)
- PWA enables full offline functionality - essential for academic/research use

# 4. IMPLEMENTATION STEPS

## Step 1: Remove HTTrack Artifacts
**Goal:** Clean up all HTML files from HTTrack metadata
**Method:** 
- Remove HTTrack comment blocks from all `.html` and `.shtml` files
- Remove `<meta http-equiv="content-type" content="text/html;charset=windows-1251" />` tags
- Reference: All ~200 HTML files

## Step 2: Convert Encoding to UTF-8
**Goal:** Modernize from windows-1251 to UTF-8
**Method:**
- Convert all HTML files from windows-1251 to UTF-8 encoding
- Update meta charset declarations to `<meta charset="UTF-8">`
- Handle Cyrillic text correctly during conversion

## Step 3: Remove Dead Tracking Scripts
**Goal:** Remove obsolete/inactive tracking code
**Method:** Remove from all files:
- LiveInternet counter script in `<head>` section
- Rambler Top100 counter images and links
- Mail.ru TopList counter images
- Any other external tracking references

## Step 4: Reorganize Directory Structure
**Goal:** Clean project root and move content to proper location
**Method:**
- Move main site content to project root
- Delete archived domain folders (not part of main site):
  - `sodomdiscovery.site40.net/`
  - `www.sbible.boom.ru/`
  - `counter.rambler.ru/`
  - `top-fwz1.mail.ru/`
  - `top100.rambler.ru/`
  - `hts-cache/` directory
- Delete root-level clutter: `backblue.gif`, `fade.gif`, `cookies.txt`

## Step 5: Update Domain References & Clean Contacts
**Goal:** Update all references to new domain ixoye.space
**Method:**
- Update meta tags, footer emails, and any hardcoded URLs to ixoye.space
- Update sitemap and feed references if any
- **Leave `/contacts/` page empty** - contact information will be added later

## Step 6: Convert Content to Markdown
**Goal:** Transform HTML content to universal Markdown format for portability
**Method:**
- Create new `/content/` directory structure:
  ```
  /content/
    /nag-hammadi/       # Nag Hammadi texts
    /apocrypha/new/     # New Testament apocrypha
    /apocrypha/old/      # Old Testament apocrypha
    /gnostic/           # Gnostic texts
    /kumran/            # Dead Sea Scrolls
    /hermetic/          # Hermetic treatises
    /study/             # Research articles
  ```
- Convert each HTML file to Markdown:
  - Extract title, description from HTML head
  - Convert body content to Markdown
  - Preserve links, emphasis, structure
  - Create frontmatter (YAML) with metadata
- Store in `/content/` directory (git-tracked)
- Keep cleaned HTML in `/public/` for reference (no old URLs)
**Reference:** `/content/` (new directory), scripts for HTML→MD conversion

## Step 7: Create Web App Infrastructure
**Goal:** Set up foundation for modern web app with offline support
**Method:**
- Create `package.json` with:
  - Dependencies: unified/remark (Markdown processing), optionally Astro/Hugo
  - Scripts for build, dev, convert (HTML→MD)
- Create `.gitignore` (exclude /node_modules, /dist, .DS_Store)
- Create `/src/` directory with:
  - `/src/index.html` - Main SPA shell
  - `/src/styles/` - CSS/SCSS files
  - `/src/js/` - JavaScript modules
  - `/src/sw.js` - Service Worker for offline
- Create manifest.json for PWA installability
- Reference: `/src/`, `/public/`, `package.json`

## Step 8: Implement Service Worker for Offline
**Goal:** Enable full offline functionality via PWA
**Method:**
- Create `/src/sw.js` Service Worker that:
  - Caches app shell (HTML, CSS, JS)
  - Caches all content from `/content/` or `/public/`
  - Provides offline fallback
- Create `/src/js/app.js` to:
  - Register Service Worker
  - Initialize IndexedDB for search index and bookmarks
  - Load content dynamically
- Offline strategy:
  - App shell: Cache-first
  - Content: Cache-first with network fallback
  - Search: IndexedDB powered

## Step 9: Update Documentation
**Goal:** Document project structure and usage
**Method:**
- Update README.md with:
  - Project description (ixoye.space - Russian Apocryphal Studio)
  - Content sections overview
  - Setup instructions (npm install, npm run dev)
  - Offline capabilities explanation
  - How to contribute new content
- Add CONTRIBUTING.md with markdown format guide
- Add favicon placeholder

## Step 10: Verify Content Integrity
**Goal:** Ensure all content sections are intact and accessible
**Method:**
- Verify all content directories are present with converted markdown
- Check key files in each section
- Verify internal navigation works
- Test offline mode

# 5. TESTING AND VALIDATION

**Success Criteria:**
1. ✅ All HTML files are free of HTTrack comments
2. ✅ All HTML files use UTF-8 encoding
3. ✅ No LiveInternet/Rambler/Mail.ru tracking code remains
4. ✅ Directory structure is clean (no archived domain folders)
5. ✅ All references updated to ixoye.space
6. ✅ Markdown content exists in `/content/` directory
7. ✅ Content sections are complete (Nag Hammadi, apocrypha, Gnostic, etc.)
8. ✅ Service Worker registers successfully
9. ✅ Site works offline (disable network, refresh)
10. ✅ PWA is installable (manifest.json valid)
11. ✅ IndexedDB stores search index
12. ✅ package.json scripts work correctly
13. ✅ Site renders correctly in browser (visual check)

**Offline Storage Validation:**
```javascript
// Check available storage
navigator.storage.estimate().then(estimate => {
  console.log(`Used: ${estimate.usage / 1024 / 1024} MB`);
  console.log(`Quota: ${estimate.quota / 1024 / 1024} MB`);
});

// Expected: ~10-15MB used for all content
// Browser quota typically: 50MB - unlimited (varies by browser)
```

**Validation Commands:**
```bash
# Check for HTTrack artifacts
grep -r "HTTrack" --include="*.html" .

# Check for tracking scripts
grep -r "counter.yadro.ru\|counter.rambler\|top-fwz1.mail.ru" --include="*.html" .

# Check encoding
file *.html */**.html

# Count HTML files
find . -name "*.html" -o -name "*.shtml" | wc -l

# Count Markdown files (after conversion)
find ./content -name "*.md" | wc -l

# Check domain references
grep -r "ixoye.space" . --include="*.html" --include="*.md"
grep -r "apokrif.fullweb.ru" . --include="*.html" --include="*.md"
```

**PWA Testing:**
- Use Chrome DevTools → Application → Service Workers
- Check "Offline" checkbox, reload page
- Verify content loads without network
- Test "Add to Home Screen" on mobile devices
