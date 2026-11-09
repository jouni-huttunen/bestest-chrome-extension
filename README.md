# Bestest Chrome Extension

A personal Chrome extension that tweaks websites to work the way I like. Each
tweak is a small, separate **feature** that you can switch on or off from the
extension's toolbar popup. Everything is plain JavaScript and CSS, with no
build step, no tracking, and no network requests of its own.

## What it does

All current features are for **x.com** (Twitter):

- **Twitter media grid restore**: a profile's **Media** tab shows the old
  compact grid of thumbnails instead of full post cards.
- **Twitter Easy Block**: posts and profiles of accounts you don't follow get
  a one-click block button. A click starts a 1-second countdown (click again
  to cancel), then the account is blocked through X's own menu, with a small
  explosion animation. Blocks are real, so use it with care.
- **Twitter UI Cleanup**: hides parts of X you may not use, such as
  Notifications, Chat, Grok, Premium, the Post button, trending and news
  panels, and the Grok "Explain this post" icon on posts.

Every feature starts switched on.

## Install

The extension isn't in the Chrome Web Store. You load this folder directly:

1. Download or clone this repository:
   ```
   git clone https://github.com/jouni-huttunen/bestest-chrome-extension
   ```
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the repository folder (the one with
   `manifest.json` in it).
5. Optional: pin the extension from the puzzle-piece menu so its popup is one
   click away.

Requires Chrome 111 or newer.

## Use

- Click the extension's toolbar icon to see the features grouped by site, each
  with an on/off switch.
- After flipping a switch, click **Reload tabs** in the popup (or reload the
  site's tabs yourself) for the change to take effect.

## Update

After pulling new changes (or editing any file), go to `chrome://extensions`,
click the reload icon on the extension's card, then reload your open x.com
tabs.

## Remove

Click **Remove** on the extension's card in `chrome://extensions`. Your on/off
settings are removed with it.

## For contributors

`SPEC.md` is the full specification and the source of truth for how every
feature behaves. Agent and contributor rules are in `AGENTS.md`. Testing is
manual, using each feature's Verification steps in `SPEC.md`.
