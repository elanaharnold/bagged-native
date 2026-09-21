# Bagged Tech Debt — Audit & Todo

Cross-repo reference for `bagged-native/` (Expo) and `bagged/` (web + Vercel API + Supabase).

Last updated: 2026-06-14

---

## Completed (2026-06-14 session)

| # | Fix | Repo |
|---|-----|------|
| 3 | Removed dead `USER_DELETED` branch in `providers/auth-provider.tsx` (TS compile error) | bagged-native |
| 5 | Gated all `console.log` behind `__DEV__` in `post-photo-upload.ts`, `rate.tsx`, `add-review-photos.tsx` (`lib/data.ts` was already gated) | bagged-native |
| 10 | Deleted Expo template dead code (`themed-*`, `use-theme-color`, `use-color-scheme*`, `constants/theme.ts`, `icon-symbol*`, `reset-project.js`) + removed npm script | bagged-native |
| 11 | Removed unused exports: `WEB_PASSWORD_RESET_REDIRECT` (`lib/auth.ts`); `displayStoreForRow`, `getUserRankings`, `searchUsers` (`src/data.js`) | both |
| 15 | Aligned `api/search-autocomplete.js` defaults with `api/search.js` (`fatsecret,usda`) | bagged |
| 16 | Deleted superseded scripts: `bulk_verify_loading_dock_to_curated.sql`, `backfill-fatsecret-macros.mjs` | bagged |

---

## Remaining — prioritized

Work through one item at a time; get approval before sweeping changes.

### P0 — highest breakage risk

- **#1 Web `description_key` inconsistency**
  - **Problem:** DB uses brand-scoped keys (`item::brand`, migration 056+) but several web paths still use item-only keys.
  - **Where:** `bagged/src/data.js` (`createPost`, `upsertCuratedProduct`, `fetchVerifiedCuratedNutritionByDescription`, `enrichPostsWithSharedNutrition`, etc.) and callers in `App.jsx`.
  - **Fix:** Switch all paths to `productDescriptionKey(item, brand)`; audit production data for mismatched keys before deploying.
  - **Risk:** Needs careful consideration — may surface rows with mismatched keys.

- **#2 Want-to-try vs ranked identity mismatch**
  - **Problem:** `rankKeyPair` is store-sensitive; `productDescriptionKey` is brand-only. Want cleanup after ranking can fail when store differs.
  - **Where:** `bagged-native/lib/data.ts`, `lib/want-to-try-feed.ts`
  - **Fix:** Decide single canonical match key; align want cleanup on rank.
  - **Risk:** Needs careful consideration — behavior change for edge cases.

### P1 — maintenance pain

- **#4** Split `bagged-native/lib/data.ts` (~6,565 lines) into modules: `feed`, `posts`, `search`, `macros`, `discover`, `social`, `curated` (barrel re-export).
- **#6** Consolidate FatSecret logic triplication: native `data.ts`, web `App.jsx`, `scripts/lib/fatsecret-resolve.mjs`.
- **#7** Extract logic from `bagged/src/App.jsx` (~11,211 lines) into `data.js` or modules.
- **#8** Consolidate macro normalization entry points in `lib/data.ts` (`normalizePostMacros`, `normalizeDiscoverExploreMacros`, raw `normalizeMacros`).
- **#9** Consolidate store helpers across `constants/grocery.ts`, `lib/format.ts`, and inline screen usage.

### P2 — quick wins

- **#12** Deduplicate photo URL normalization (`data.ts` vs `post-photo-strip.tsx`).
- **#13** Reuse `FilterBar` in `discover.tsx` instead of duplicate `DiscoverFilterPanel`.
- **#14** Fix stale TODO in `lib/data.ts` ~L2908 referencing missing `TODO.md`.
- **#17** Import photo upload directly from `post-photo-upload.ts` (drop `data.ts` re-export indirection).
- **#18** Replace default Expo `README.md` with project-specific docs.

### P3 — structural / long-term

- **#19** Split `app/rate.tsx` (~3,156 lines) into step components + `useRateFlow` hook.
- **#20** Split `app/(tabs)/discover.tsx` (~2,817 lines) into browse/search/admin modules.
- **#21** Converge web `data.js` with native `data.ts` (native is canonical direction).

### After cleanup

- **Step 4** Add file-header docs explaining purpose and key exports:
  - `bagged-native/lib/data.ts`
  - `bagged-native/lib/auth.ts`
  - `bagged-native/lib/post-photo-upload.ts`
  - `bagged/src/data.js`

---

## Architecture quick reference

```
bagged-native (Expo)          bagged (Vite web)
       │                            │
       └──────── lib/data.ts ───────┴── src/data.js (thinner)
                    │                      │
                    ▼                      ▼
              Supabase (Postgres, Auth, Storage, RPCs)
                    │
                    ▼
         bagged.vercel.app (/api/search, /api/fatsecret-food, /api/send-activity-push)
```

**Key identity keys:**
- `productDescriptionKey(item, brand)` → `"oat milk::oatly"` (DB truth)
- `rankKeyPair(item, store, brand)` → store-sensitive (want-to-try matching)

**External APIs:** FatSecret (primary), USDA/Kroger (wired, usually off via `SEARCH_SOURCES`), Expo Push. No Instacart or PostHog.

---

## How to resume

Pick an item number (e.g. "let's do #1") and work through it one change at a time with review before moving on.
test
