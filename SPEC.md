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

The extension is installed only via **Load unpacked**, directly from the
project root, which loads in Chrome as-is (section 9). The project root is the
extension's only source.

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
   TypeScript, no third-party code. The project root must load in Chrome
   as-is.
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
    relevant behavior is written out here in full.

## 4. Project layout

```
/
├── README.md                    short human guide: purpose and installation
├── SPEC.md                      this file
├── AGENTS.md                    rules for coding agents
├── CLAUDE.md                    imports AGENTS.md for Claude Code
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

No other files are required. `README.md` is a short introduction for people;
it must not contradict this spec, and this spec wins if they ever disagree.
The documentation files (`README.md`, `SPEC.md`, `AGENTS.md`, `CLAUDE.md`)
are ignored by Chrome and load harmlessly alongside the extension.

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
  "version": "0.4.3",
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
| `twitter-easy-block` | Twitter Easy Block | x.com | `https://x.com/*` | js: `features/x.com/twitter-easy-block.js` | MAIN | `document_idle` | 6 |
| `twitter-ui-cleanup` | Twitter UI Cleanup | x.com | `https://x.com/*` | css: `features/x.com/twitter-ui-cleanup.css` | ISOLATED | `document_start` | 2 |

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
6. To remove a feature permanently, delete its file(s), its `registry.js`
   entry, its registry row, and its section 8 entry, then note the removal in
   the changelog.

### Feature section template

```
### 8.N <Feature title> (`<feature-id>`)

- Goal:           what the owner sees change, in one or two sentences.
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
  follow gets a one-click **block button** as the first (leftmost) icon in the
  post header's icon group, before X's Grok "Explain this post" icon and the
  `⋯` menu. This feature never hides or changes X's own icons; hiding the Grok
  icon is Twitter UI Cleanup's job (8.3.1 #15). One click starts a 1-second
  safety countdown, and a second click cancels it. When the countdown finishes,
  the author is blocked through X's own UI, with no visible menu or
  confirmation dialog, followed by an explosion animation as the post collapses
  out of the feed. A profile page of an account the owner does not follow gets
  the same button as the first icon of the profile header's button row,
  directly left of its `⋯` button (8.2.10).
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
| `REVISION` | `6`. Must equal the registry's Revision column. |

DOM facts (verified on x.com, Nov 2026):

| Thing | Selector / location |
|---|---|
| Post | `article[data-testid="tweet"]` |
| Virtualized timeline cell wrapping a post | `article.closest('[data-testid="cellInnerDiv"]')` |
| Post's `⋯` menu button ("caret") | `article [data-testid="caret"]` |
| Grok "Explain this post" button | `article button[aria-label="Grok actions"]`. Used only to find the first icon (8.2.4); never hidden or changed by this feature. |
| Popup layer root (menus, dialogs) | `#layers` |
| Open dropdown menu | `#layers [role="menu"]` |
| Menu items | `#layers [role="menu"] [role="menuitem"]` |
| Block menu item | `[data-testid="block"]` inside the open menu; fallback: the menu item whose trimmed text starts with `Block @` |
| Block confirmation dialog | `[data-testid="confirmationSheetDialog"]` |
| Confirm button in that dialog | `[data-testid="confirmationSheetConfirm"]` |
| Logged-in user's handle | text of `[data-testid="SideNav_AccountSwitcher_Button"]`, matched with `/@(\w+)/` |
| Profile header's `⋯` button | `[data-testid="primaryColumn"] [data-testid="userActions"]` (aria-label "More"). Absent on the owner's own profile. Its parent is the header's button row (`⋯`, Message, Subscribe, Follow), a flex row. |
| Profile header's `⋯` menu | Same `#layers [role="menu"]`; its Block item is `[data-testid="block"]` with text `Block @<handle>`, and the confirmation dialog is the same as for posts (8.2.6). |

Every class, id, and keyframe name the feature creates starts with `teb-`:

| Name | Use |
|---|---|
| `<style id="teb-style">` | The feature's stylesheet, appended to `document.head`. It is injected by the script (not a manifest `css` file) because its durations are generated from `TIMER_MS`. |
| `.teb-btn` | The block button. |
| `.teb-profile` | Added to the block button on a profile page (8.2.10). |
| `--teb-fg`, `--teb-border` | Custom properties set inline on a profile button, copied from the profile's `⋯` button (8.2.10). |
| `.teb-icon`, `.teb-ring`, `.teb-track`, `.teb-progress` | Parts of the button (8.2.5). |
| `.teb-arming`, `.teb-working`, `.teb-cancel`, `.teb-fail` | Visual-state classes on the button (8.2.5). |
| `html.teb-stealth` | Hides X's popups during a block job (8.2.6). |
| `article[data-teb-blocked="1"]` | Post whose author this feature blocked. Skipped from then on. |

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
- `user.screen_name.toLowerCase()` is not in the in-memory set of handles this
  feature blocked since the page loaded. X doesn't update the user data of
  other posts or of the profile header right away, so without this set the
  author's other posts would keep their buttons.

The same rule applies to the profile header's user (8.2.10).

#### 8.2.4 Placement

The block button is the **first icon** of the post header's icon group. The
group is the Grok button and the caret, each inside its own wrapper `div`, in
that order. The **anchor** is the group's first wrapper:

- If the post has a Grok button: the Grok wrapper (`grok.parentElement`).
- Otherwise: the caret's wrapper (`caret.parentElement`).
- If the post has neither, it gets no button.

The block button is inserted as a sibling directly **before** the anchor. The
result is `⊘ Grok ⋯` when the Grok icon is visible, and `⊘ ⋯` when Twitter UI
Cleanup (8.3) hides it. The Grok wrapper keeps its place in the DOM while it's
hidden, so the anchor is the same in both cases.

The anchor is re-evaluated on every `update()` (8.2.7), not only when the button
is created. X often renders a post's Grok button some time after its caret
(posts loaded while scrolling the feed, and posts on `/status/…` pages,
verified Nov 2026). The caret wrapper sits in a vertical column, so a button
placed by the caret fallback stacks above the `⋯` instead of sitting in the
header row, and with Grok visible it would also end up after Grok. When Grok
appears later, the existing button is moved in front of the Grok wrapper
(8.2.7 step 5).

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
- **No layout change.** On posts the button has `margin: -7px 0`, so it takes
  only 20 px of layout height, the same as X's own header icons (the Grok and
  caret wrappers are 20 px tall). The 34 px circle and ring still draw in
  full, overflowing the header row by 7 px above and below, which is how X
  draws its own hover circles. Without this, the button stretched the header
  row from 20 to 34 px and pushed the post content down by 14 px (measured on
  live x.com, Nov 2026). The profile button (`.teb-profile`, 8.2.10) keeps its
  own margins, because it sits in a row of 36 px buttons.
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

- On success: set `data-teb-blocked="1"` on the article, add the handle
  (lowercased) to the blocked-handles set (8.2.3), then run the celebration
  (8.2.8).
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
- A scan calls `update(article)` for every `article[data-testid="tweet"]`,
  then `updateProfile()` once (8.2.10).
- `update(article)` is idempotent:
  1. If `data-teb-blocked="1"`, stop.
  2. Apply the show rule (8.2.3). Let `btn` be the article's existing
     `.teb-btn`.
  3. Qualifies and there's no `btn`: create and place one (8.2.4).
  4. Qualifies, `btn` is idle, and its `data-handle` differs from the current
     `screen_name` (the article was reused for another post): update
     `data-handle`, `aria-label`, and `title`.
  5. Qualifies, `btn` is idle, and `btn.nextElementSibling` isn't the current
     anchor (8.2.4: the Grok wrapper if the post has one, otherwise the caret
     wrapper): move `btn` with `anchor.parentElement.insertBefore(btn, anchor)`.
     Moving keeps the element, its click listener, and its state. Only idle
     buttons are moved, because re-inserting an element restarts its CSS
     animations (an arming ring would visibly start over).
  6. Doesn't qualify and `btn` exists: if `btn` is `"working"`, leave it.
     Otherwise clear its timer (if arming) and remove it. This happens, for
     example, right after the owner follows the author.
- The celebration's own effect elements also trigger the observer. That's
  harmless thanks to the throttle and idempotence.

#### 8.2.8 Block celebration (Web Animations API)

Every effect is a `div` with `position:fixed; pointer-events:none;
z-index:2147483647`, appended to `document.body`, centered on the **burst
point**, and removed when its animation finishes.

**Burst point.** By the time a block succeeds, X has often re-rendered the
blocked post (or the profile header) and dropped the block button from the
page. A detached or hidden element measures as 0×0 at (0,0), which put the
burst in the window's top-left corner (seen on live x.com, Nov 2026). So:

- When the job starts (before step 1 of 8.2.6), record the button's on-screen
  center.
- On success, if the button is still in the page and has a non-zero size, use
  its current center (it may have moved if the owner scrolled). Otherwise use
  the center recorded at job start.
- If neither is available (the button was already gone when the job started),
  skip items 1–3.
- Item 4 runs only if the article is still in the page. If X already removed
  or replaced it, there's nothing left to collapse.

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
- **Grok button rendered after the caret:** the button is first placed before
  the caret wrapper, then moved in front of the Grok wrapper once it appears
  (8.2.4, 8.2.7 step 5).
- **Twitter UI Cleanup (8.3) off:** the Grok icon stays visible and the header
  shows `⊘ Grok ⋯`. That's one icon wider than with 8.3 on, and expected.
- **Author blocked from one place:** their other posts, and their profile
  header, lose the button on the next scan (the blocked-handles set, 8.2.3).

#### 8.2.10 Profile pages

On `https://x.com/<handle>` and its tabs (`/media`, `/with_replies`, …), the
profile header gets a block button when its user qualifies.

**Reading the user.** Start at the profile's `⋯` button (8.2.1) and walk up
the React fiber `.return` chain at most `MAX_FIBER_DEPTH` levels. The first
`memoizedProps.user` that has a string `screen_name` is the profile's user (it
was found about 9 levels up, with props `{ buttonStyle, promotedContent, user }`).
It has the same `following` and `blocking` fields as a post's user. The show
rule (8.2.3) decides whether the button is shown.

**Placement and look.** The `⋯` button is the first icon of the header's
button row, so the block button is inserted as a sibling directly **before**
it. That makes the block button the row's first icon, immediately left of
`⋯`. It is the same `.teb-btn` (same icon, ring, states, and animations,
8.2.5) with the extra class `.teb-profile`, which makes it match X's round
header buttons:

- 36×36 px, `margin: 0 8px 12px 0` (the same as X's header buttons), border
  `1px solid var(--teb-border, rgb(207,217,222))`.
- Idle icon color `var(--teb-fg, #0f1419)`, and the icon is 20×20 px.
- `--teb-fg` and `--teb-border` are set inline on the button from the `⋯`
  button's computed `color` and `border-top-color` on every `updateProfile()`,
  so the button follows X's light, dim, and dark themes.
- The idle hover style, `.teb-arming`, `.teb-working`, `.teb-cancel`, and
  `.teb-fail` override these exactly as on posts. The progress ring fits
  inside the border.

**`updateProfile()`**, idempotent:

1. Find the profile's `⋯` button. Let `btn` be the `.teb-btn.teb-profile` in
   its parent row.
2. Any other `.teb-btn.teb-profile` in the document that isn't `"working"`
   (for example one left over from the previous profile after in-app
   navigation) has its timer cleared and is removed.
3. No `⋯` button: stop.
4. Apply the show rule to the profile's user.
5. Qualifies and there's no `btn`: create one and insert it before `⋯`.
6. Qualifies and `btn` is idle: relabel it if the handle changed (X reused the
   header for another profile), and move it in front of `⋯` if it isn't
   directly there.
7. Doesn't qualify and `btn` exists and isn't `"working"`: clear its timer and
   remove it.

**Countdown and block.** The click, countdown, and cancel behavior is the same
as for posts (8.2.5). The job's root is the header row (the button's parent
when the countdown started) instead of an article, and its "caret" is that
row's `⋯` button. Everything else in 8.2.6 is unchanged, including the
handle check against the menu item's text. When the countdown ends, `fire()`
re-applies the show rule to the profile's user; if it no longer qualifies, it
resets the button and runs `updateProfile()` instead of blocking.

**On success:** add the handle to the blocked-handles set (8.2.3), play the
flash, shockwaves, and shards (8.2.8 items 1–3) centered on the burst point
(8.2.8), and remove the button. There is no post to jolt or collapse. X then shows its own
blocked state in the header. **On failure:** the same shake as on posts.

**Must not:**

- Call X's API, or make any network request itself.
- Block without a completed, uncancelled countdown.
- Block when the menu's Block item doesn't name the captured handle.
- Leave `teb-stealth` on `<html>`, or an X menu open, after a job.
- Throw into the page or log to the console.
- Hide, restyle, or move any of X's own elements (including the Grok icon).
- Touch posts other than to add, move, relabel, or remove its own button, and
  animate a post it just blocked.
- Touch the profile header other than to add, move, relabel, or remove its own
  button, or show a button on the owner's own profile.

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

1. On the Home feed, posts by accounts you don't follow show the slash icon as
   the first icon of the header's icon group. Posts by followed accounts and
   your own posts have no slash icon. (With 8.3 on, the group is `⊘ ⋯`, or
   just `⋯` on posts without the button.)
2. Hovering turns the icon red on a faint red circle.
3. Click once: the ring fills while the color goes yellow → orange → red, with
   a speeding pulse and no number. Click again within 1 s: the shrink/gray
   cancel animation plays, and DevTools → Network shows no `blocks/create.json`
   request.
4. Click once and wait: after 1 s, no menu or dialog is visible. You see the
   flash, two shockwaves, and the shard burst centered on the post's block
   button (never in the window's corner), and the post jolts, burns out,
   and collapses. Network shows `POST /i/api/1.1/blocks/create.json` with
   `user_id=<id_str>`.
5. Reload: the author's posts are gone or shown as blocked, and their profile
   shows "Blocked".
6. Start two countdowns about 200 ms apart: both authors get blocked, one after
   the other, with no stray menus.
7. After a block or a cancel, `<html>` has no `teb-stealth` class and there's
   no `#layers [role="menu"]` in the DOM.
8. **No extra space:** a post with a block button has the same gap between
   its header (name line) and its text as a post without one, and the same as
   when the feature is off. The button's center lines up with the `⋯`'s
   center.
   Scrolling a long feed stays smooth, and newly loaded posts get buttons. On
   every post, in the feed and on a `/status/…` page, the button sits in the
   header row as the first icon, never stacked above the `⋯`. In the console,
   this returns `0` (posts whose button isn't directly before their Grok
   wrapper):
   ```js
   [...document.querySelectorAll('article .teb-btn')].filter(b => {
     const g = b.closest('article').querySelector('button[aria-label="Grok actions"]');
     return g && b.nextElementSibling !== g.parentElement;
   }).length
   ```
9. In the DevTools console, `window.__BESTEST_TWITTER_EASY_BLOCK__` returns
   `{ id: "twitter-easy-block", revision: 6 }`. The console shows no errors
   whose source is `features/x.com/twitter-easy-block.js`.
10. Feature 8.1 still works on a profile's Media tab (both features coexist).
11. Switch this feature off in the popup and click **Reload tabs**: no block
    buttons appear, and the Grok icons are unchanged (hidden if 8.3 is on,
    visible if it's off). Switch it back on and reload: the buttons return.
12. **With 8.3 off:** switch Twitter UI Cleanup off and reload. Posts by
    accounts you don't follow show `⊘ Grok ⋯` in one row, including posts
    loaded while scrolling. Posts by followed accounts show `Grok ⋯`. Switch
    8.3 back on and reload: `⊘ ⋯`.
13. **Profile, not followed:** open the profile of an account you don't follow.
    A round block button is the first icon of the header's button row,
    directly left of `⋯`, the same size
    and border as `⋯`, aligned with it. Hover turns it red. A click and a second
    click within 1 s cancel it, with no `blocks/create.json` request.
14. **Profile, followed / own / blocked:** on an account you follow, on your
    own profile, and on an account you've already blocked, there's no button.
    Follow an account from its profile: the button disappears. Unfollow: it
    comes back.
15. **Profile, in-app navigation:** move from one profile to another by
    clicking links (no reload). There's only ever one profile button, and its
    label names the profile you're on.
16. **Profile, block** (on an account you're fine blocking): click once and
    wait. No menu or dialog shows, the burst plays at the button, the button
    disappears, X shows the account as blocked, and the account's posts lower
    on the page lose their block buttons. Unblock afterwards.

### 8.3 Twitter UI Cleanup (`twitter-ui-cleanup`)

- **Goal:** Hide the parts of X the owner doesn't use, **in every view**: all
  routes, every viewport width, and after every in-app navigation or
  re-render. Pages behind hidden links stay reachable by URL. The feature only
  hides elements. It never blocks requests or removes nodes.
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
| 15 | Grok "Explain this post" button | in each post's header, next to the `⋯` menu. This feature is the only one that hides it. Twitter Easy Block (8.2) puts its block button before it as the first icon, so with both on the header shows `⊘ ⋯`. |

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
  rule #15 doesn't hide it. This feature is the only one that hides the Grok
  icon: 8.2 never hides it, so switching 8.3 off brings the icon back
  (`⊘ Grok ⋯`).

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
10. **With Twitter Easy Block (8.2) on:** its block button is the first icon
    (`⊘ ⋯`), with no gap where Grok was, and blocking still works.
11. Switch this feature off in the popup and click **Reload tabs**: every
    hidden element is visible again, including the Grok icon in posts even
    while 8.2 is on (`⊘ Grok ⋯`). Switch it back on and reload: hidden again.

## 9. Install, update, remove

The project root (the folder containing `manifest.json`) is the extension. It
loads in Chrome as-is (constraint 2): there is no build step and no separate
copy to keep in sync.

### 9.1 Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the project root.
4. Pin the extension (puzzle-piece menu → pin) so its popup is one click away.
   All features start enabled.

**Switch a feature on or off:** open the popup, flip the feature's switch, then
click **Reload tabs** (or reload the site's tabs yourself).

### 9.2 Update after a change

1. After changing any file (or pulling new commits), click the reload icon on
   the extension's card in `chrome://extensions`. This also re-runs `sync()`
   (5.3), so new or renamed features get registered.
2. Reload every affected tab. Already-open tabs keep the old script until
   reloaded, and `document_start` features need a full reload, not in-app
   navigation.
3. Optional: check the feature's verification marker (its revision, section 6)
   to confirm the new code is running.

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

Current extension version: **0.4.3**

| Date | Version | Change |
|---|---|---|
| 2026-11-03 | 0.1.0 | Spec created. Feature `twitter-media-grid-restore` (revision 1) specified. Not yet implemented. |
| 2026-11-03 | 0.2.0 | Feature `twitter-easy-block` (revision 1) specified. Not yet implemented. |
| 2026-11-03 | 0.3.0 | Feature `twitter-ui-cleanup` (revision 1) specified. Per-feature on/off switches added (popup, service worker, `storage` + `scripting` permissions); features are now registered at runtime instead of in the manifest. Not yet implemented. |
| 2026-11-03 | 0.3.0 | First implementation of the shell and all three features. Clarified during the build: Easy Block re-checks the show rule when the countdown ends (8.2.5), and back-to-back block jobs keep X's popups hidden (8.2.6). Not yet verified on live x.com; the 8.3.5 open checks are still open. |
| 2026-11-09 | 0.3.1 | Fix: `twitter-easy-block` (revision 2) re-places an idle block button in front of the Grok wrapper when X renders Grok after the caret, so the button no longer stacks above `⋯` on scrolled-in feed posts and `/status/…` pages (8.2.4, 8.2.7, 8.2.9). Live check on 0.3.0 before the fix: 32 of 36 posts loaded while scrolling were misplaced. |
| 2026-11-09 | 0.4.0 | `twitter-easy-block` (revision 3): profile pages of accounts you don't follow get the block button directly left of the header's `⋯` (new 8.2.10). Handles blocked during the page session lose their buttons everywhere on the page (8.2.3). Minor bump because this adds behavior rather than fixing it. |
| 2026-11-09 | 0.4.1 | Grok "Explain this post" hiding moved entirely to `twitter-ui-cleanup` (revision 2; its CSS is unchanged, only its role). `twitter-easy-block` (revision 4) no longer hides Grok or touches any X element; it adds its button as the first icon of the post header's icon group (`⊘ Grok ⋯`, or `⊘ ⋯` with 8.3 on) and of the profile header's button row (8.2.4, 8.2.7, 8.2.10, 8.3.1 #15, 8.3.4). |
| 2026-11-09 | 0.4.1 | Spec only: removed the "Origin" field from the feature template (7) and from 8.1–8.3, and the matching sentence in constraint 11. No change to extension behavior. |
| 2026-11-09 | 0.4.2 | Fix: `twitter-easy-block` (revision 5) burst appeared in the window's top-left corner after a feed block, because X had already dropped the button from the page when the burst was measured. The burst point is now recorded when the job starts and used if the button is gone; the post animation is skipped if X already removed the post (8.2.8). |
| 2026-11-09 | 0.4.3 | Fix: `twitter-easy-block` (revision 6) post button no longer adds space between a post's header and its content. It keeps its 34 px circle but has `margin: -7px 0`, so it takes 20 px of layout height like X's own icons (8.2.5). Before, it stretched the header row by 14 px. |
| 2026-11-09 | 0.4.3 | Docs only: the project root is the extension's only source and is loaded directly (section 9 rewritten: 9.1 Install, 9.2 Update after a change). Added `README.md`, a short human guide (section 4). No change to extension behavior. |
