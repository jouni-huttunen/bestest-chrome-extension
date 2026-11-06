# Bestest Chrome Extension — Specification

This document is the single source of truth for the extension. An agent must be
able to rebuild the entire extension from this file alone, without consulting
any external repository, website, or link. If code and this spec disagree, the
spec wins unless the owner says otherwise.

## 1. Purpose

A personal, single-user Chrome extension that customizes predefined websites
according to the owner's instructions. Each customization is a **feature**
scoped to one site. Features are added over time; each one is specified in
section 8 before it is implemented.

The extension is installed only via **Load unpacked**. The owner's everyday
install is the `release/` folder, the production release (9.1). Changes that
aren't released yet are tested by loading the project root, which loads as-is
(9.3).

## 2. Non-goals

- Chrome Web Store packaging, listing assets, signing, or `.crx`/`.zip` builds.
- Auto-update or update URLs.
- Browsers other than Chrome (they may work by accident; never a requirement).
- Extension UI beyond the on/off popup (section 5.5): no options page, no
  per-feature settings. (Elements a feature adds inside a site's page are fine.)
- Storage of anything other than the on/off state (section 5.2).
- Internationalization, analytics, telemetry, logging to any remote service.
- Network requests made by the extension itself. A feature may drive a site's
  own UI, which then sends that site's normal requests.

## 3. Global constraints

1. **Manifest V3**, with `"minimum_chrome_version": "111"`. MAIN-world content
   scripts are fully supported from this version.
2. **Plain modern JavaScript.** No build step, no npm, no bundler, no
   TypeScript, no third-party code. The folder must load in Chrome as-is. The
   release folder (9.1) is a plain copy of the runtime files, not a build: no
   file is transformed.
3. **Minimal permissions.** Exactly `storage` and `scripting`, plus
   `host_permissions` for the sites the features run on. Section 5.1 explains
   why. A feature may add another permission only if its spec section names it
   and explains why it is needed.
4. **Small extension shell.** One background service worker and one toolbar
   popup, used only for the per-feature on/off switches (section 5). No
   options page. No icons; Chrome's default placeholder icon is acceptable.
5. **Feature isolation.** Each feature has its own file(s), its own entry in
   `features/registry.js`, and is registered as its own content script.
   Features never share files, globals, or runtime state, and never depend on
   each other. One feature failing or being switched off must not affect
   another.
6. **Fail closed.** If a site's structure is not what a feature expects, the
   feature leaves the page untouched. A feature must never throw an uncaught
   error, neither at load time nor from any callback it installs into the page
   (setters, event listeners, observers).
7. **World choice.** Default to the ISOLATED world (omit `world`). Use
   `"world": "MAIN"` only when the feature must read or intercept the page's own
   JavaScript objects. MAIN-world scripts cannot use `chrome.*` APIs.
8. **Prefer CSS** (a feature `.css` file) for purely visual tweaks.
9. **Top frame only.** Register with `allFrames: false` unless a feature's
   spec says otherwise.
10. **Per-feature toggle, on by default.** Every feature can be switched off in
    the popup. All features are enabled by default, including newly added ones
    (section 5.2).
11. **Self-contained spec.** This spec never links to external sources
    (repositories, gists, articles, docs pages) as a basis for requirements,
    because they can disappear. When a feature is inspired by outside work, its
    relevant behavior is written out here in full. An origin may be named in
    plain words for context, never as a link the spec depends on.

## 4. Project layout

```
/
├── SPEC.md                      this file
├── AGENTS.md                    rules for coding agents
├── CLAUDE.md                    imports AGENTS.md for Claude Code
├── build-release.ps1             builds release/ when the owner asks for a release (9.1)
├── release/                     production release; rebuilt only on the owner's request
├── manifest.json
├── background.js                service worker: registers enabled features (5.3)
├── popup/
│   ├── popup.html               per-feature on/off switches (5.5)
│   ├── popup.css
│   └── popup.js
└── features/
    ├── registry.js              the feature list in code (5.4)
    └── <hostname>/
        ├── <feature-id>.js      a feature's script, and/or
        └── <feature-id>.css     a feature's stylesheet
```

- `<hostname>` is the site's bare hostname, e.g. `x.com`.
- A feature's file names are its feature ID, e.g. feature
  `twitter-media-grid-restore` → `features/x.com/twitter-media-grid-restore.js`.
  The exact paths are listed in the registry (section 6).

No other files are required. A README is optional; if present it must not
contradict this spec.

## 5. Manifest and extension shell

Features are not listed in the manifest. The service worker registers each
**enabled** feature as a content script at runtime, so any feature can be
switched off, including `document_start` MAIN-world ones.

### 5.1 Manifest

`manifest.json` must contain exactly these top-level keys:

| Key | Value |
|---|---|
| `manifest_version` | `3` |
| `name` | `"Bestest Chrome Extension"` |
| `version` | Current version (section 11). Started at `"0.1.0"`. Bump the minor part when a feature is added or removed, the patch part for fixes. |
| `description` | `"Personal site customizations, loaded unpacked."` |
| `minimum_chrome_version` | `"111"` |
| `permissions` | `["storage", "scripting"]` |
| `host_permissions` | Every distinct `matches` pattern in the registry (section 6), in registry order. |
| `background` | `{ "service_worker": "background.js", "type": "module" }` |
| `action` | `{ "default_title": "Bestest Chrome Extension", "default_popup": "popup/popup.html" }` |

There is no `content_scripts` key.

Why each permission is needed:

- `storage`: remembers each feature's on/off state (5.2).
- `scripting`: registers content scripts only for enabled features (5.3). This
  is the only race-free way to switch off a `document_start` MAIN-world script.
  A script that is always injected and checks a setting would get that setting
  asynchronously, after the page has already started.
- `host_permissions`: `registerContentScripts` requires host access for each
  feature's `matches`. It also lets the popup find open tabs on those sites to
  reload them (5.5).

Current manifest (the version must match section 11):

```json
{
  "manifest_version": 3,
  "name": "Bestest Chrome Extension",
  "version": "0.3.0",
  "description": "Personal site customizations, loaded unpacked.",
  "minimum_chrome_version": "111",
  "permissions": ["storage", "scripting"],
  "host_permissions": ["https://x.com/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": {
    "default_title": "Bestest Chrome Extension",
    "default_popup": "popup/popup.html"
  }
}
```

### 5.2 On/off state

- Stored in `chrome.storage.local` under the single key `"enabled"`: an object
  mapping feature ID → boolean.
- A feature is enabled unless its value is exactly `false`. A missing key or a
  missing ID means enabled, so every feature, including a newly added one,
  starts on.
- IDs that aren't in the registry (for example a removed feature) are ignored.
- Nothing else is stored.

### 5.3 Service worker (`background.js`)

An ES module that imports `FEATURES` from `./features/registry.js`.

`sync()` makes the registered content scripts match the on/off state:

1. Read `"enabled"` from `chrome.storage.local`.
2. Call `chrome.scripting.unregisterContentScripts()` with no filter, which
   removes every script this extension registered.
3. Call `chrome.scripting.registerContentScripts()` with one entry per enabled
   feature, in registry order:
   `{ id, matches, js, css, runAt, world, allFrames: false, persistAcrossSessions: true }`.
   Leave out `js` or `css` when the feature has none, and leave out `world`
   for ISOLATED features.

Calls to `sync()` are serialized (each one chains onto the previous promise),
so two syncs never interleave. Errors are caught. The service worker may
`console.error` them, which shows only in its own DevTools console, never in a
site's console.

`sync()` runs on:

- `chrome.runtime.onInstalled` (first install, extension reload, version change)
- `chrome.runtime.onStartup`
- `chrome.storage.onChanged` when the area is `"local"` and `"enabled"` changed

All listeners are registered synchronously at the module's top level, so
Chrome can wake the worker for them.

A change takes effect on the next load of an affected page. Pages that are
already open keep the old state until they are reloaded.

### 5.4 Code registry (`features/registry.js`)

An ES module exporting `FEATURES`: an array with exactly the rows of section 6,
in the same order. Each entry looks like this:

```js
{
  id: "twitter-easy-block",                      // registry ID, also the registered script ID
  title: "Twitter Easy Block",                   // popup label
  site: "x.com",                                 // popup group heading
  matches: ["https://x.com/*"],
  js: ["features/x.com/twitter-easy-block.js"],  // omit if the feature has no script
  // css: ["features/x.com/<id>.css"],           // omit if the feature has no stylesheet
  runAt: "document_idle",                        // document_start | document_end | document_idle
  world: "MAIN",                                 // omit for ISOLATED
}
```

`background.js` and `popup/popup.js` both read this file. No other file lists
features.

### 5.5 Popup (`popup/popup.html`, `popup/popup.css`, `popup/popup.js`)

- Opens from the extension's toolbar button (pin the extension to keep it
  visible).
- Layout: the heading "Bestest Chrome Extension", then the features grouped by
  `site` (the group heading is the hostname), in registry order. Each row has
  the feature `title` on the left and an on/off switch on the right. The switch
  is an `<input type="checkbox" role="switch">` with its `<label>`, checked =
  enabled.
- Width 300 px, system font. It follows the browser's light/dark mode via
  `prefers-color-scheme`.
- On open: read `"enabled"` and check the switch of every enabled feature.
- On toggle: read the stored `"enabled"` object, set that feature's value, and
  write the object back. Then show a notice under the list, "Reload open tabs
  to apply.", with a **Reload tabs** button.
- **Reload tabs** reloads every open tab whose URL matches the `matches` of any
  feature toggled since the popup opened (`chrome.tabs.query({ url: [...] })`,
  then `chrome.tabs.reload(tabId)` for each), then hides the notice. Tabs are
  never reloaded automatically, so a half-written post isn't lost by surprise.
- No other controls. No inline scripts (MV3 policy): the HTML loads `popup.js`
  with `<script type="module" src="popup.js">`.

## 6. Feature registry

`features/registry.js` (5.4) mirrors this table exactly: same entries, same
order, same values. The manifest's `host_permissions` are the distinct values
of the Matches column. Every feature is enabled by default (5.2).

| ID | Title | Site | Matches | Files | World | run_at | Revision |
|---|---|---|---|---|---|---|---|
| `twitter-media-grid-restore` | Twitter media grid restore | x.com | `https://x.com/*` | js: `features/x.com/twitter-media-grid-restore.js` | MAIN | `document_start` | 1 |
| `twitter-easy-block` | Twitter Easy Block | x.com | `https://x.com/*` | js: `features/x.com/twitter-easy-block.js` | MAIN | `document_idle` | 1 |
| `twitter-ui-cleanup` | Twitter UI Cleanup | x.com | `https://x.com/*` | css: `features/x.com/twitter-ui-cleanup.css` | ISOLATED | `document_start` | 1 |

**Revision** is a per-feature integer, bumped whenever that feature's behavior
changes. MAIN-world features expose it in their verification marker so the
owner can confirm the reloaded code is the new code.

## 7. Adding or changing a feature

1. Write or update the feature's section in section 8 using the template below.
   Do this **before** writing code.
2. Add or update its row in the registry (section 6).
3. Create or edit the feature's file(s) at the registry paths.
4. Add or update its entry in `features/registry.js` (5.4). If it runs on a new
   site, add that site's matches to `host_permissions` (5.1).
5. Bump the extension version and add a changelog line (section 11).
6. Do **not** rebuild `release/`. The change reaches it only when the owner
   asks for a new release (9.1).
7. To remove a feature permanently, delete its file(s), its `registry.js`
   entry, its registry row, and its section 8 entry, then note the removal in
   the changelog.

### Feature section template

```
### 8.N <Feature title> (`<feature-id>`)

- Goal:           what the owner sees change, in one or two sentences.
- Origin:         where the idea came from, in plain words (no links), or "original".
- Matches:        URL match patterns.
- World / run_at: ISOLATED|MAIN, document_start|document_end|document_idle.
- Permissions:    none, or each one with its justification.
- Behavior:       exact, step-by-step mechanism. Name every selector, property,
                  flag, and value. Precise enough to implement without guessing.
- Must not:       explicit list of things the feature must not do.
- Failure mode:   what happens when the site changes underneath it.
- Verification:   numbered manual steps with expected results.
```

### Script skeleton

Every feature script follows this shape:

```js
// <feature-id>: <one-line goal>. See SPEC.md section 8.N.
(() => {
  "use strict";

  try {
    // feature logic
  } catch {
    // Fail closed: leave the page untouched.
  }
})();
```

Any function the feature hands to the page (setter, listener, observer
callback) wraps its own body in `try/catch` as well, so that an unexpected page
shape can never throw into the site's code.

## 8. Features

### 8.1 Twitter media grid restore (`twitter-media-grid-restore`)

- **Goal:** On X (formerly Twitter) profile pages, the **Media** tab shows the
  legacy compact media grid (thumbnail gallery) instead of X's redesigned
  layout (full post cards / media carousel).
- **Origin:** Idea from a third-party open-source extension (2026). Not
  needed for implementation; this section defines everything.
- **Matches:** `https://x.com/*`
- **World / run_at:** MAIN / `document_start`
- **Permissions:** none.

**Background.** Before X's React app starts, an inline script in X's HTML
assigns the app's bootstrap state object to `window.__INITIAL_STATE__`. That
object contains feature switches at:

- `state.featureSwitch.defaultConfig[<flagName>]`
- `state.featureSwitch.user.config[<flagName>]`

Each flag entry is an object with a `value` property. Two flags select the
redesigned media layout:

- `responsive_web_profile_redesign_enabled`
- `rweb_media_carousel_enabled`

Setting both to `false` in both configs, before X reads them, makes X render
its legacy media grid. A MAIN-world script at `document_start` runs before any
page script, so it can intercept the assignment.

**Behavior.**

1. Constants:
   - `FLAG_NAMES = ["responsive_web_profile_redesign_enabled", "rweb_media_carousel_enabled"]`
   - `MARKER = "__BESTEST_TWITTER_MEDIA_GRID_RESTORE__"`
   - `REVISION = 1` (must equal the registry's Revision column)
2. `patch(state)`:
   - Collect `configs = [state?.featureSwitch?.defaultConfig, state?.featureSwitch?.user?.config]`.
   - For each config that is truthy, for each name in `FLAG_NAMES`: if
     `config[name]` is a non-null object, set `config[name].value = false`.
   - Do not create missing configs or flag entries. Do not touch any other key.
   - Wrap the body in `try/catch`; on error, stop patching silently.
   - Always return the same `state` reference it was given (never a copy).
3. Read the existing descriptor:
   `Object.getOwnPropertyDescriptor(window, "__INITIAL_STATE__")`. If it exists
   and is a data descriptor (`"value" in descriptor`), initialize the stored
   value to `patch(descriptor.value)`. Otherwise the stored value starts as
   `undefined`.
4. Redefine `window.__INITIAL_STATE__` with `Object.defineProperty` as an
   accessor:
   - `configurable: true` (so X can later delete or redefine it without errors)
   - `enumerable: true`
   - `get()` returns the stored value.
   - `set(value)` stores `patch(value)`. The value is always stored, even if
     patching failed.
5. Define the verification marker with `Object.defineProperty(window, MARKER, …)`:
   value `Object.freeze({ id: "twitter-media-grid-restore", revision: REVISION })`,
   `enumerable: false`, `writable: false`, `configurable: false`.
6. Steps 3–5 run inside one outer `try/catch`. If anything throws (for example
   `__INITIAL_STATE__` is already non-configurable), do nothing further and
   leave X untouched.

**Scope.** Only full page loads matter. X's in-app (SPA) navigation reuses the
state that was patched at load, so no DOM observers, URL watchers, or
re-patching are needed.

**Must not:**
- Modify the DOM or inject CSS.
- Make network requests or store any data.
- Change any feature switch other than the two named above, or any other part
  of the state.
- Log to the console.

**Failure mode.** This only works while X still ships the legacy media-grid
component behind these flag names. If X removes the component or renames the
flags, the feature silently does nothing and X renders its default layout.

**Verification.**
1. Load the extension (section 9). Open `https://x.com/<any-user>/media` and
   hard-reload (Ctrl+Shift+R). Expected: media appears as a compact grid of
   thumbnails, not as full post cards or a carousel.
2. In DevTools → Console (default "top" context), run:
   ```js
   window.__BESTEST_TWITTER_MEDIA_GRID_RESTORE__
   ```
   Expected: `{ id: "twitter-media-grid-restore", revision: 1 }`.
3. In the same console, run:
   ```js
   const fs = window.__INITIAL_STATE__?.featureSwitch;
   [fs?.defaultConfig, fs?.user?.config].map(c => [
     c?.responsive_web_profile_redesign_enabled?.value,
     c?.rweb_media_carousel_enabled?.value,
   ]);
   ```
   Expected: every defined value is `false`. (`undefined` entries mean X did not
   ship that flag in that config. If `__INITIAL_STATE__` itself is `undefined`,
   X cleared it after boot; rely on step 1.)
4. The console shows no errors whose source is
   `features/x.com/twitter-media-grid-restore.js`.
5. Switch this feature off in the popup and click **Reload tabs** (or
   hard-reload the media tab). Expected: X's standard (redesigned) layout
   returns and the marker from step 2 is `undefined`. Switch it back on and
   reload: the grid returns.

### 8.2 Twitter Easy Block (`twitter-easy-block`)

- **Goal:** Every post on X (formerly Twitter) whose author the owner does not
  follow gets a one-click **block button** where X's Grok "Explain this post"
  icon was (that icon is hidden on every post). One click starts a 1-second
  safety countdown, and a second click cancels it. When the countdown finishes,
  the author is blocked through X's own UI, with no visible menu or
  confirmation dialog, followed by an explosion animation as the post collapses
  out of the feed.
- **Origin:** Owner-provided design (Nov 2026). This section defines
  everything.
- **Matches:** `https://x.com/*` (twitter.com redirects to x.com, so it is not
  matched).
- **World / run_at:** MAIN / `document_idle`. MAIN is required because the
  feature reads React fiber properties (`__reactFiber$…` keys) that X attaches
  to DOM nodes. The isolated world can't see them.
- **Permissions:** none.
- **Why drive X's UI instead of calling X's API:** a direct API call would have
  to reproduce X's obfuscated `x-client-transaction-id` header and risks being
  flagged as automation. Clicking X's own menu (`⋯` → "Block @user" → confirm)
  makes X's client send its normal request (see **Reference** below). The
  feature never makes a network request itself.

#### 8.2.1 Constants and naming

All selectors, timings, and names live in one constants block at the top of the
script, so they can be updated in one place when X changes.

| Constant | Value |
|---|---|
| `TIMER_MS` | `1000`. Countdown length. Every countdown CSS duration is generated from it (never hard-coded). |
| `MAX_FIBER_DEPTH` | `40` |
| `POLL_MS` | `40`. Polling interval of `wait()`. |
| `MARKER` | `"__BESTEST_TWITTER_EASY_BLOCK__"` |
| `REVISION` | `1`. Must equal the registry's Revision column. |

DOM facts (verified on x.com, Nov 2026):

| Thing | Selector / location |
|---|---|
| Post | `article[data-testid="tweet"]` |
| Virtualized timeline cell wrapping a post | `article.closest('[data-testid="cellInnerDiv"]')` |
| Post's `⋯` menu button ("caret") | `article [data-testid="caret"]` |
| Grok "Explain this post" button | `article button[aria-label="Grok actions"]` |
| Popup layer root (menus, dialogs) | `#layers` |
| Open dropdown menu | `#layers [role="menu"]` |
| Menu items | `#layers [role="menu"] [role="menuitem"]` |
| Block menu item | `[data-testid="block"]` inside the open menu; fallback: the menu item whose trimmed text starts with `Block @` |
| Block confirmation dialog | `[data-testid="confirmationSheetDialog"]` |
| Confirm button in that dialog | `[data-testid="confirmationSheetConfirm"]` |
| Logged-in user's handle | text of `[data-testid="SideNav_AccountSwitcher_Button"]`, matched with `/@(\w+)/` |

Every class, id, and keyframe name the feature creates starts with `teb-`:

| Name | Use |
|---|---|
| `<style id="teb-style">` | The feature's stylesheet, appended to `document.head`. It is injected by the script (not a manifest `css` file) because its durations are generated from `TIMER_MS`. |
| `.teb-btn` | The block button. |
| `.teb-icon`, `.teb-ring`, `.teb-track`, `.teb-progress` | Parts of the button (8.2.5). |
| `.teb-arming`, `.teb-working`, `.teb-cancel`, `.teb-fail` | Visual-state classes on the button (8.2.5). |
| `html.teb-stealth` | Hides X's popups during a block job (8.2.6). |
| `article[data-teb-blocked="1"]` | Post whose author this feature blocked. Skipped from then on. |
| `.teb-grok-hidden` | Marks a Grok wrapper this feature hid with `display:none`. |

#### 8.2.2 Startup

1. If `window[MARKER]` already exists, stop (double-injection guard).
   Otherwise define it with `Object.defineProperty`: value
   `Object.freeze({ id: "twitter-easy-block", revision: REVISION })`,
   `enumerable: false`, `writable: false`, `configurable: false`.
2. Append `<style id="teb-style">` to `document.head`.
3. Start the observer (8.2.7) and run one scan immediately.

#### 8.2.3 Reading the author and follow status (no network)

The React fiber chain of each post's `article` contains a component whose
`memoizedProps.tweet` holds the full tweet object, including `tweet.user`.
Walk up `.return` at most `MAX_FIBER_DEPTH` levels (it was found about 13
levels up):

```js
function postUser(article) {
  const key = Object.keys(article).find(k => k.startsWith("__reactFiber"));
  let f = key && article[key];
  for (let d = 0; f && d < MAX_FIBER_DEPTH; d++, f = f.return) {
    const t = f.memoizedProps?.tweet;
    if (t?.user) return (t.retweeted_status || t).user; // reposts: the ORIGINAL author
  }
  return null;
}
```

Relevant `user` fields: `screen_name`, `id_str`, `following`, `followed_by`,
`blocking`, `blocked_by`, `follow_request_sent`. For reposts, X's `⋯` menu
targets the original author, so `retweeted_status.user` is the right object.

**Logged-in handle:** read from the account-switcher button (8.2.1),
lowercased, and cached once found. If it can't be read yet, skip the own-post
check below. An own post's button would then fail harmlessly, because X's menu
has no Block item on your own posts.

**Show rule.** A post gets a button only when **all** of these hold:

- `postUser(article)` returned a user.
- `user.following === false` (strictly; a missing field means no button).
- `user.blocking !== true`.
- `user.screen_name.toLowerCase()` ≠ the logged-in handle.

The Grok button is hidden on **every** post, followed accounts included.

#### 8.2.4 Placement

The Grok button and the caret each sit inside their own wrapper `div`.

- If the post has a Grok button: insert the block button as a sibling
  **before** the Grok wrapper (`grok.parentElement`).
- Otherwise insert it before the caret's wrapper (`caret.parentElement`).
- If the post has neither, it gets no button.

Hiding Grok means setting `display:none` on `grok.parentElement` and adding the
class `teb-grok-hidden` to it.

#### 8.2.5 Button, state machine, and visuals

**Element.** `<button type="button" class="teb-btn">` with:

- `aria-label`: `Block @<screen_name>`
- `title`: `Block @<screen_name> (click again to cancel)`
- `data-handle`: the `screen_name` it was created for
- `data-state`: the logical state, one of `""` (idle), `"arming"`, `"working"`
- Children: the icon SVG (`.teb-icon`) and the progress-ring SVG (`.teb-ring`).

**Look.**

- Button: 34×34 px, `border-radius: 9999px`, transparent background, no border,
  no padding, `position: relative`, contents centered, `cursor: pointer`. Idle
  icon color: `#71767b` (X's gray).
- Idle hover: icon `#f4212e` on background `rgba(244,33,46,.1)`.
- Icon (`.teb-icon`): 18.75×18.75 px, the "no" symbol, all strokes in
  `currentColor`: `viewBox="0 0 24 24"`, a circle (`cx=12 cy=12 r=9`) and a line
  from (5.64, 5.64) to (18.36, 18.36), both `fill:none; stroke-width:2;
  stroke-linecap:round`.
- Progress ring (`.teb-ring`): an SVG absolutely positioned over the whole
  button, `viewBox="0 0 34 34"`, `transform: rotate(-90deg)` so the fill starts
  at 12 o'clock, `pointer-events: none`. It has two circles, both `cx=17 cy=17
  r=15 fill:none stroke-width:2.5`:
  - `.teb-track`: stroke `rgba(244,33,46,.15)`.
  - `.teb-progress`: `stroke-dasharray: 94.25` (2πr), `stroke-dashoffset:
    94.25`, `stroke-linecap: round`.
  - Ring opacity: 0 unless the button has `.teb-arming`, then 1.

No numbers are shown anywhere. Time is conveyed only through the filling ring,
the color change, and the pulse speed.

**Visual-state classes.** Exactly one of `.teb-arming`, `.teb-working`,
`.teb-cancel`, `.teb-fail` is present at a time, or none at idle. To apply
one, remove all four, force a reflow (`void btn.offsetWidth`), then add the new
one. This reliably restarts animations, even on rapid double clicks.

**`.teb-arming` (countdown).** Every animation runs `TIMER_MS`, `linear`,
`forwards`:

- `.teb-progress`: `stroke-dashoffset` 94.25 → 0.
- `.teb-progress` stroke and the button's `color` (the icon): `#ffd400` at 0% →
  `#ff7a00` at 55% → `#f4212e` at 100%.
- Button background: `rgba(255,212,0,.08)` → `rgba(244,33,46,.28)`.
- `.teb-icon` accelerating heartbeat:
  ```css
  @keyframes teb-pulse{0%,16%{transform:scale(1)}8%{transform:scale(1.08)}
    28%,48%,64%,76%,86%,94%,100%{transform:scale(1)}
    38%,56%,70%,81%,90%,97%{transform:scale(1.14)}}
  ```

**`.teb-working`.** Icon `#f4212e` on background `rgba(244,33,46,.28)`. The
icon spins 360° every 800 ms, linear, infinite. Hover styles don't apply.

**`.teb-cancel`.** 350 ms, ease-out: button goes from `transform: scale(.8)`
with background `rgba(113,118,123,.25)` to `scale(1)` with a transparent
background.

**`.teb-fail`.** 400 ms horizontal shake: `translateX` 0 → −4 → 4 → −4 → 4 → 0
px.

**State machine.**

| `data-state` | Click does | Visual class |
|---|---|---|
| `""` (idle) | Store `setTimeout(fire, TIMER_MS)` on the button, set `data-state="arming"`. | none (or `.teb-cancel` / `.teb-fail` finishing) |
| `"arming"` | **Cancel:** `clearTimeout`, set `data-state=""`. | `.teb-arming`, then `.teb-cancel` on cancel |
| `"working"` | Ignored. | `.teb-working` |

The click handler always calls `preventDefault()` and `stopPropagation()`
first; otherwise X opens the post.

**`fire()`** first re-applies the show rule (8.2.3) to the article. If the
article no longer qualifies for the handle captured when the countdown started
(for example, the owner followed the author during the countdown), it sets
`data-state=""`, clears the visual class, and runs `update(article)` (8.2.7),
which removes or relabels the button. Nothing is blocked. This check doesn't
depend on when the last scan ran (scans pause while the tab is in the
background). Otherwise `fire()` sets `data-state="working"` (class
`.teb-working`) and enqueues the block job (8.2.6) for this button's article
and `data-handle`.

- On success: set `data-teb-blocked="1"` on the article, then run the
  celebration (8.2.8).
- On failure: set `data-state=""` and play `.teb-fail`.

**Serial queue.** Jobs never compete for X's single menu layer; they run one at
a time:

```js
let queue = Promise.resolve();
const enqueue = fn => (queue = queue.then(fn, fn));
```

#### 8.2.6 Performing the block through X's UI, invisibly

While a job runs, `<html>` has the class `teb-stealth`. That hides X's popups
but still lets them receive programmatic clicks:

```css
html.teb-stealth #layers [role="group"],
html.teb-stealth #layers [data-testid="sheetDialog"],
html.teb-stealth #layers [role="dialog"],
html.teb-stealth #layers [data-testid="mask"] { opacity:0!important; pointer-events:none!important; }
```

Helpers:

- `wait(fn, ms)` calls `fn` every `POLL_MS` until it returns a truthy value
  (resolves with that value) or until `ms` passes (resolves with `null`).
- `closeMenu()` closes an open dropdown. Escape key events do **not** close X's
  dropdown; click its full-screen backdrop instead. The structure is
  `[role=group] > div` with 3 children: the first is the full-viewport
  backdrop, the last is the `[role=menu]`.
  ```js
  const closeMenu = () => {
    const backdrop = document.querySelector('#layers [role="menu"]')
      ?.closest('[role="group"]')?.firstElementChild?.firstElementChild;
    if (backdrop) backdrop.click();
  };
  ```

Job steps (input: the article and the handle captured when the countdown
started). Every "fail" returns failure.

1. Add `teb-stealth` to `<html>`.
2. If the article is no longer in the document (`!article.isConnected`, e.g.
   X's virtualized feed recycled it during the countdown), fail.
3. If a menu is already open, `closeMenu()` and wait up to 1 s for it to
   disappear.
4. Click the article's caret. No caret: fail.
5. Wait up to 2 s for the Block menu item. Not found: `closeMenu()`, fail.
6. **Safety check:** the item's text must contain `@<handle>`
   (case-insensitive). Mismatch: `closeMenu()`, fail.
7. Click the item.
8. Wait up to 3 s for the confirm button. Not found: `closeMenu()`, fail.
9. Click the confirm button.
10. Wait up to 3 s for the confirmation dialog to be gone, then sleep 120 ms.
    If a menu is still open, `closeMenu()`.
11. Return success.

The whole job is wrapped in `try/catch`, and an exception counts as failure.
In a `finally` block, remove `teb-stealth` after 150 ms, so X's closing
transitions finish while still hidden. A job that starts while that delayed
removal is still pending cancels it (step 1). Without this, the previous job's
timer would strip `teb-stealth` in the middle of the next queued job and
flash its menu on screen.

#### 8.2.7 Keeping up with X's single-page app

- A `MutationObserver` on `document.body` with `{childList:true,
  subtree:true}` schedules a scan on every change.
- **Throttle with `requestAnimationFrame`:** at most one scan per frame.
  Without it, scrolling gets sluggish.
- A scan calls `update(article)` for every `article[data-testid="tweet"]`.
- `update(article)` is idempotent:
  1. Hide the Grok wrapper if it isn't hidden yet.
  2. If `data-teb-blocked="1"`, stop.
  3. Apply the show rule (8.2.3). Let `btn` be the article's existing
     `.teb-btn`.
  4. Qualifies and there's no `btn`: create and place one (8.2.4).
  5. Qualifies, `btn` is idle, and its `data-handle` differs from the current
     `screen_name` (the article was reused for another post): update
     `data-handle`, `aria-label`, and `title`.
  6. Doesn't qualify and `btn` exists: if `btn` is `"working"`, leave it.
     Otherwise clear its timer (if arming) and remove it. This happens, for
     example, right after the owner follows the author.
- The celebration's own effect elements also trigger the observer. That's
  harmless thanks to the throttle and idempotence.

#### 8.2.8 Block celebration (Web Animations API)

Every effect is a `div` with `position:fixed; pointer-events:none;
z-index:2147483647`, appended to `document.body`, centered on the button's
on-screen center, and removed when its animation finishes.

1. **Flash core.** A 34 px circle filled with
   `radial-gradient(circle,#fff 0%,#ffd400 35%,#f4212e 70%,transparent 72%)`,
   scale .4 → 2.4 and opacity 1 → 0 over 420 ms, easing
   `cubic-bezier(.2,.8,.3,1)`.
2. **Two shockwave rings.** 40 px circles, `box-sizing:border-box`,
   transparent fill:
   - Ring 1: 4 px `#f4212e` border, scale .3 → 10.
   - Ring 2: 2 px `#ff7a00` border, scale .3 → 7, starting 110 ms later.
   - Both fade opacity 1 → 0 over 700 ms, easing `cubic-bezier(.1,.7,.3,1)`.
3. **34 glowing shards.**
   - Direction: shard `i` of 34 points at angle `i/34·2π` plus a random 0–0.3
     rad of jitter. Distance `d`: random 70–200 px. Let `dx = cos(angle)·d`,
     `dy = sin(angle)·d`.
   - Shape: random size 3–9 px. Half are square, half are 2.5× as tall as
     wide. Half are round (`border-radius:50%`), half have 1 px corners.
   - Color: cycles through `#f4212e, #ff7a00, #ffd400, #fff` by shard index,
     with `box-shadow: 0 0 6px <color>`.
   - Keyframes, with one random `r` in [−1, 1] per shard so it keeps spinning
     the same way:
     - 0%: `translate(0,0) rotate(0) scale(1)`, opacity 1.
     - 60%: `translate(0.8·dx, 0.8·dy − 30px) rotate(r·540deg)`, opacity 1.
     - 100%: `translate(dx, dy + 30px) rotate(r·720deg) scale(.2)`, opacity 0.
       The rise at 60% followed by the +30 px end drift reads as gravity.
   - Duration: random 750–1200 ms, easing `cubic-bezier(.15,.8,.35,1)`.
4. **The post itself.** Three phases in sequence, chained via each animation's
   `.finished`:
   - **Jolt** (380 ms, `ease-out`) on the article: `translateX` 0 → −7 → 6 →
     −4 → 2 → 0 px. At the same time its `box-shadow` goes from an inset red
     border flash `inset 0 0 0 3px rgba(244,33,46,.9)` to an inner glow
     `inset 0 0 60px 10px rgba(244,33,46,.35)`.
   - **Burn out** (420 ms, `cubic-bezier(.5,0,.75,0)`, `fill:"forwards"`) on
     the article: to `filter: grayscale(1) blur(3px)`, `opacity: 0`,
     `transform: scale(.94)`.
   - **Collapse** (320 ms, `cubic-bezier(.4,0,.2,1)`) on the `cellInnerDiv`
     (or the article itself if there's no cell): set `overflow:hidden`, animate
     `height` from its measured px height to 0, then set `display:none`.

#### 8.2.9 Edge cases (all handled by the rules above)

- **Reposts:** target the original author, matching what X's menu blocks.
- **Own posts:** no button.
- **Already-blocked accounts:** no button.
- **Followed accounts:** no button.
- **Double-click during the countdown:** cancels. This is the intended
  misclick safety.
- **Clicks while working:** ignored.
- **Several countdowns at once:** each has its own timer; jobs run serially.
- **Stale menu left open from manual use:** closed before the job starts.
- **Wrong menu (race):** the handle check aborts the block.
- **Post scrolled away and recycled during the countdown:** the job fails (step
  2) instead of blocking someone else.
- **Focused-post pages (`/status/…`):** the main post and the replies are all
  `article[data-testid="tweet"]` and work the same way.

**Must not:**

- Call X's API, or make any network request itself.
- Block without a completed, uncancelled countdown.
- Block when the menu's Block item doesn't name the captured handle.
- Leave `teb-stealth` on `<html>`, or an X menu open, after a job.
- Throw into the page or log to the console.
- Touch posts other than to hide Grok, add or remove its button, and animate a
  post it just blocked.

**Failure mode.** X's selectors and fiber depth can change at any time. If
`postUser()` returns `null`, or a post has no caret or Grok button, that post
quietly gets no button and no console error. If X's menu or dialog changes, the
job fails after its timeout and the button shakes; nothing is blocked.

**Reference: X's underlying request** (informational, for verification only;
never called directly). X's client sends:

```
POST https://x.com/i/api/1.1/blocks/create.json
Content-Type: application/x-www-form-urlencoded
body: user_id=<id_str>
headers added by X's client: authorization (static web bearer), x-csrf-token (= ct0 cookie),
  x-twitter-auth-type: OAuth2Session, x-twitter-active-user: yes, x-client-transaction-id
```

Unblocking uses `blocks/destroy.json`.

**Verification.** Blocking is real, so test on accounts you're fine blocking,
and unblock them afterwards from their profile pages.

1. On the Home feed, posts by accounts you don't follow show the slash icon
   where the Grok icon was. Posts by followed accounts and your own posts show
   neither icon.
2. Hovering turns the icon red on a faint red circle.
3. Click once: the ring fills while the color goes yellow → orange → red, with
   a speeding pulse and no number. Click again within 1 s: the shrink/gray
   cancel animation plays, and DevTools → Network shows no `blocks/create.json`
   request.
4. Click once and wait: after 1 s, no menu or dialog is visible. You see the
   flash, two shockwaves, and the shard burst, and the post jolts, burns out,
   and collapses. Network shows `POST /i/api/1.1/blocks/create.json` with
   `user_id=<id_str>`.
5. Reload: the author's posts are gone or shown as blocked, and their profile
   shows "Blocked".
6. Start two countdowns about 200 ms apart: both authors get blocked, one after
   the other, with no stray menus.
7. After a block or a cancel, `<html>` has no `teb-stealth` class and there's
   no `#layers [role="menu"]` in the DOM.
8. Scrolling a long feed stays smooth, and newly loaded posts get buttons.
9. In the DevTools console, `window.__BESTEST_TWITTER_EASY_BLOCK__` returns
   `{ id: "twitter-easy-block", revision: 1 }`. The console shows no errors
   whose source is `features/x.com/twitter-easy-block.js`.
10. Feature 8.1 still works on a profile's Media tab (both features coexist).
11. Switch this feature off in the popup and click **Reload tabs**: no block
    buttons appear, and the Grok icons come back (unless 8.3 is on, which hides
    them on its own). Switch it back on and reload: the buttons return.

### 8.3 Twitter UI Cleanup (`twitter-ui-cleanup`)

- **Goal:** Hide the parts of X the owner doesn't use, **in every view**: all
  routes, every viewport width, and after every in-app navigation or
  re-render. Pages behind hidden links stay reachable by URL. The feature only
  hides elements. It never blocks requests or removes nodes.
- **Origin:** Owner-provided design (Nov 2026). This section defines
  everything.
- **Matches:** `https://x.com/*`
- **World / run_at:** CSS only, so there's no script and no world (registered
  as ISOLATED) / `document_start`, so nothing flashes into view on load.
- **Permissions:** none beyond the shell's.
- **Why pure CSS:** a stylesheet keeps applying through X's single-page
  navigation and re-renders by itself. No JavaScript and no observers are
  needed.

#### 8.3.1 What gets hidden

**Left navigation**

| # | Element | Notes |
|---|---|---|
| 1 | Notifications | aria-label changes with the unread count |
| 2 | Chat (Direct Messages) | visible text "Chat"; the testid still says DirectMessage |
| 3 | Calls | |
| 4 | Grok | |
| 5 | Creator Studio | |
| 6 | Premium | |
| 7 | Follower requests | only shown for protected accounts; label includes an unread count |
| 8 | Post (compose) button | the sidebar button, and the floating compose button on narrow screens |

Keep: Home, Explore, History, Profile, More, and the account switcher.

**Floating buttons (bottom-right corner)**

| # | Element |
|---|---|
| 9 | Grok drawer button |
| 10 | Chat drawer button |

**Right sidebar**

| # | Element | Notes |
|---|---|---|
| 11 | Subscribe to Premium | upsell card under the search box (Home and some other pages) |
| 12 | Today's News | headline card with a close (×) button |
| 13 | What's happening | "Trending now" list |
| 14 | Footer | Terms · Privacy · Cookies · Accessibility · Ads Info · More · © X Corp. |

Keep: the Search box, **Who to follow**, and **Relevant people** (the author
card on post pages).

**Inside posts**

| # | Element | Notes |
|---|---|---|
| 15 | Grok "Explain this post" button | in each post's header, next to the `⋯` menu. When Twitter Easy Block (8.2) is on, its block button takes this spot. |

#### 8.3.2 The stylesheet

`features/x.com/twitter-ui-cleanup.css` contains exactly this:

```css
/* twitter-ui-cleanup: hide unused X UI. See SPEC.md section 8.3. */

/* ── Left navigation (8.3.1 #1–8) ──────────────────────────────────────
   Deliberately NOT scoped to nav[aria-label="Primary"], so these also
   match the collapsed icon-only sidebar, the mobile bottom bar and the
   floating compose button. */
a[data-testid="AppTabBar_Notifications_Link"],
a[data-testid="AppTabBar_DirectMessage_Link"],
a[data-testid="AppTabBar_Calls_Link"],
a[href="/i/grok"][aria-label="Grok"],
a[aria-label="Creator Studio"],
a[data-testid="premium-signup-tab"],
a[href="/follower_requests"][aria-label^="Follower requests"],
[data-testid="SideNav_NewTweet_Button"],
a[href="/compose/post"],

/* ── Floating drawers, bottom-right (8.3.1 #9–10) ──────────────────── */
[data-testid="GrokDrawer"],
[data-testid="chat-drawer-root"],

/* ── Right sidebar (8.3.1 #11–14) ──────────────────────────────────────
   Hide each module's wrapper card (removes padding/border/gap), with
   the module itself as a fallback if the wrapper nesting changes. */
[data-testid="sidebarColumn"] [aria-label="Trending"] > div > div:has(aside[aria-label="Subscribe to Premium"]),
[data-testid="sidebarColumn"] [aria-label="Trending"] > div > div:has([data-testid="news_sidebar"]),
[data-testid="sidebarColumn"] [aria-label="Trending"] > div > div:has([aria-label="Timeline: Trending now"]),
[data-testid="sidebarColumn"] aside[aria-label="Subscribe to Premium"],
[data-testid="sidebarColumn"] [data-testid="news_sidebar"],
[data-testid="sidebarColumn"] section:has([aria-label="Timeline: Trending now"]),
nav[aria-label="Footer"],

/* ── Grok button in each post (8.3.1 #15) ──────────────────────────────
   Hide the wrapper div so no gap remains next to the ⋯ menu. */
article[data-testid="tweet"] div:has(> button[aria-label="Grok actions"]) {
  display: none !important;
}
```

#### 8.3.3 Selector reference (verified on x.com desktop, English UI, Nov 2026)

| # | Element | Selector | Why |
|---|---|---|---|
| 1 | Notifications | `a[data-testid="AppTabBar_Notifications_Link"]` (href `/notifications`) | stable testid; the aria-label changes with the unread count |
| 2 | Chat | `a[data-testid="AppTabBar_DirectMessage_Link"]` (href `/i/chat`, aria "Direct Messages") | |
| 3 | Calls | `a[data-testid="AppTabBar_Calls_Link"]` (href `/i/calls`) | |
| 4 | Grok nav link | `a[href="/i/grok"][aria-label="Grok"]` | no testid; the aria check spares `/i/grok` links inside post content |
| 5 | Creator Studio | `a[aria-label="Creator Studio"]` | no testid; the href carries an encoded token, so don't match on it |
| 6 | Premium | `a[data-testid="premium-signup-tab"]` (href `/i/premium_sign_up`) | |
| 7 | Follower requests | `a[href="/follower_requests"][aria-label^="Follower requests"]` | label is e.g. "Follower requests (10 unread requests)" |
| 8 | Post button | `[data-testid="SideNav_NewTweet_Button"]`, `a[href="/compose/post"]` | sits **outside** `nav[aria-label="Primary"]`; the href rule covers the mobile floating button |
| 9 | Grok drawer | `[data-testid="GrokDrawer"]` (contains `GrokDrawerHeader`) | hiding the drawer root means it can't open |
| 10 | Chat drawer | `[data-testid="chat-drawer-root"]` (contains `chat-drawer-main`) | same |
| 11 | Subscribe to Premium | `aside[aria-label="Subscribe to Premium"]` | not present on post pages |
| 12 | Today's News | `[data-testid="news_sidebar"]` | the articles inside are `news_sidebar_article_<id>` |
| 13 | What's happening | `[aria-label="Timeline: Trending now"]` inside `section[role="region"]` | items are `[data-testid="trend"]` |
| 14 | Footer | `nav[aria-label="Footer"]` | includes the © line |
| 15 | Grok in posts | `button[aria-label="Grok actions"]` → its parent `div` | |

The floating drawers live in a full-width fixed container that is 0 px tall.
Hiding the two drawer roots leaves nothing visible and nothing blocking
clicks.

Right-sidebar structure:

```
[data-testid="sidebarColumn"]
  └─ div[aria-label="Trending"]
       └─ div                                    ← module container
            ├─ div  Search box                                  keep
            ├─ div  (spacer)                                    keep
            ├─ div ⟶ aside[aria-label="Subscribe to Premium"]   hide
            ├─ div ⟶ [data-testid="news_sidebar"]               hide  (Today's News)
            ├─ div ⟶ section ⟶ [aria-label="Timeline: Trending now"]  hide  (What's happening)
            ├─ div ⟶ aside[aria-label="Who to follow"]          KEEP
            └─ div ⟶ nav[aria-label="Footer"]                   hide
```

On post pages the container holds an `aside` for "Relevant people" instead,
and that must stay.

#### 8.3.4 Rules and pitfalls

- **Scope the sidebar rules** under `[data-testid="sidebarColumn"]`. The
  full-page trending lists on `/explore` are main content and must stay
  visible.
- **Never use an unanchored `:has()`** such as
  `div:has([data-testid="news_sidebar"])`. Every ancestor up to `<body>`
  matches it, which hides the whole page. Always anchor it, either as
  `… > div > div:has(…)` or as `:has(> …)` for direct children.
- **Match sidebar `aside` elements only by exact aria-label.** Who to follow
  and Relevant people are also `aside` elements and must stay.
- **Don't scope the nav rules to the desktop sidebar.** Narrow layouts move
  these links into other containers.
- **Compatibility with Twitter Easy Block (8.2):** 8.2 finds the Grok button
  with `querySelector` to place its own button before the Grok wrapper. That
  still works while the button is hidden, because hidden elements stay in the
  DOM. The block button is inserted next to the wrapper, not inside it, so
  rule #15 doesn't hide it. Either feature alone hides the Grok icon.

#### 8.3.5 Open checks during build

These weren't verified when the feature was specified. Whoever builds or next
changes the feature checks them, and records the outcome here. Any selector a
check requires gets added to 8.3.2 and 8.3.3.

- **Narrow / mobile layout** (bottom tab bar, floating compose button). The
  selectors are meant to cover it, but this wasn't tested live. Check in
  DevTools device emulation at about 400 px. If a bottom-bar item survives, add
  its `data-testid` or `href`.
- **Below roughly 1000 px** X drops the right sidebar entirely, so the
  right-sidebar rules have nothing to do there.
- **Other UI languages.** These aria-labels are localized: `Creator Studio`,
  `Grok`, `Follower requests`, `Trending`, `Timeline: Trending now`,
  `Subscribe to Premium`, `Footer`, `Grok actions`. Everything matched by
  `data-testid` or `href` works in any language. Only the English UI is
  required for now.
- **Other pages.** Verified on Home, History and post pages. Still to check:
  Profile, Search, Notifications, Lists, Bookmarks, Settings. If a sidebar
  there lacks `aria-label="Trending"`, the fallback rules still hide the
  modules, but a small gap may remain.
- **More menu.** `AppTabBar_More_Menu` is intentionally left alone. Hidden
  destinations may still appear inside its popup.

**Must not:**

- Use JavaScript or observers, remove nodes, or block any request.
- Hide anything not listed in 8.3.1. In particular, these must stay visible:
  Home, Explore, History, Profile, More, the account switcher, the Search box,
  Who to follow, Relevant people, and the main-column trends on `/explore`.
- Use an unanchored `:has()`.

**Failure mode.** If X renames a testid or aria-label, only that one element
reappears. Nothing else breaks, and the hidden pages stay reachable by URL
either way.

**Verification.**

1. **Desktop, Home:** the left nav shows only Home, Explore, History, Profile
   and More, with no Post button. The bottom-right corner is empty. The right
   sidebar shows only Search and Who to follow, with no gaps where the hidden
   cards were.
2. **Posts:** no Grok icon next to `⋯`, and no leftover gap.
3. **Post page:** the Relevant people card is visible.
4. **Navigation:** move between Home, a profile, a post, Explore, History and
   Settings without reloading. Hidden items stay hidden everywhere.
5. **`/explore`:** the trending lists in the main column are visible.
6. **Hard reload:** nothing flashes into view.
7. **Direct URLs** (`/notifications`, `/i/chat`, `/i/grok`) still open their
   pages.
8. **Medium width** (icon-only sidebar): the same nav icons are hidden.
9. **Narrow width / mobile emulation:** no Notifications, Chat or Grok in the
   bottom bar, and no floating compose button.
10. **With Twitter Easy Block (8.2) on:** its block button sits where the Grok
    icon was, and blocking still works.
11. Switch this feature off in the popup and click **Reload tabs**: every
    hidden element is visible again. Switch it back on and reload: hidden
    again.

## 9. Install, update, remove

### 9.1 Release folder (production)

`release/` holds the **production release**: the version the owner actually
uses day to day. It contains only the files the extension needs at runtime, so
documentation and tooling never ship with it.

- **Updated only on request.** `release/` is rebuilt **only when the owner
  explicitly asks for a new release.** It is never rebuilt as part of a
  feature, fix, refactor, or spec change, even when that change is finished
  and tested. Between releases, the source files may be ahead of `release/`.
- **Contents:** exactly `manifest.json`, `background.js`, `popup/`, and
  `features/` (everything under it), copied unchanged from the project root.
  Nothing else. If a new runtime file or folder is added at the root, add it to
  this list and to the script's `$items` list.
- **Building a release** (only when asked):
  1. Run `.\build-release.ps1` from the project root in PowerShell. It empties
     `release/` (keeping the folder itself, so the path Chrome loaded stays
     valid), copies the items above, and prints the version and file count,
     e.g. `Built release/ (version 0.3.0, 9 files).`
  2. Add a changelog line (section 11): `Released <version> to release/.`
  3. Tell the owner to click reload on the release extension's card in
     `chrome://extensions` and reload affected tabs.
- **Never edit files in `release/` directly.** Change the source files, and
  the change ships with the next release.

### 9.2 Install the production release

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `release` folder.
4. Pin the extension (puzzle-piece menu → pin) so its popup is one click away.
   All features start enabled.

**Switch a feature on or off:** open the popup, flip the feature's switch, then
click **Reload tabs** (or reload the site's tabs yourself).

### 9.3 Test unreleased changes

The project root loads in Chrome as-is (constraint 2), so it serves as the
development copy:

1. In `chrome://extensions`, turn off the release extension's card, so the two
   copies don't run on the same pages.
2. **Load unpacked** the project root (the folder containing `SPEC.md`). It
   appears as a second card with the same name.
3. After changing any file, click the reload icon on the development card.
   This also re-runs `sync()` (5.3), so new or renamed features get
   registered. Then reload every affected tab. Already-open tabs keep the old
   script until reloaded, and `document_start` features need a full reload,
   not in-app navigation.
4. When done, turn the development card off and the release card back on.
   When the changes are good, ask for a new release (9.1).

**Remove:** click **Remove** on the extension's card, then reload affected tabs.
The on/off state is deleted along with the extension.

## 10. Testing

Testing is manual: run each feature's **Verification** steps after every change
to that feature, and spot-check the other features on their sites. There is no
automated test harness, to keep the project free of build tooling.

After every change, also confirm that `chrome://extensions` shows no errors on
the extension card (manifest and service-worker problems appear there).

**Extension shell verification** (after any change to sections 5.x):

1. Fresh install: the popup lists the three features under the heading
   "x.com", all switched on, and each feature's Verification passes.
2. Switch a feature off and click **Reload tabs**: open x.com tabs reload, and
   only that feature stops working. Switch it on and reload: it works again.
3. Close and reopen the popup: switches show the saved state.
4. Reload the extension in `chrome://extensions`, then restart Chrome: switch
   states persist, and enabled features work on the first page load after each.
5. In the service worker's console (`chrome://extensions` → the extension's
   "service worker" link), `await chrome.scripting.getRegisteredContentScripts()`
   lists exactly the enabled feature IDs, and there are no errors.

## 11. Version and changelog

Current extension version: **0.3.0**

| Date | Version | Change |
|---|---|---|
| 2026-11-03 | 0.1.0 | Spec created. Feature `twitter-media-grid-restore` (revision 1) specified. Not yet implemented. |
| 2026-11-03 | 0.2.0 | Feature `twitter-easy-block` (revision 1) specified. Not yet implemented. |
| 2026-11-03 | 0.3.0 | Feature `twitter-ui-cleanup` (revision 1) specified. Per-feature on/off switches added (popup, service worker, `storage` + `scripting` permissions); features are now registered at runtime instead of in the manifest. Not yet implemented. |
| 2026-11-03 | 0.3.0 | First implementation of the shell and all three features. Clarified during the build: Easy Block re-checks the show rule when the countdown ends (8.2.5), and back-to-back block jobs keep X's popups hidden (8.2.6). Not yet verified on live x.com; the 8.3.5 open checks are still open. |
| 2026-11-03 | 0.3.0 | Added `release/` (the production release, rebuilt only when the owner asks) and `build-release.ps1` (9.1). No change to extension behavior. |
| 2026-11-03 | 0.3.0 | Released 0.3.0 to release/. |
