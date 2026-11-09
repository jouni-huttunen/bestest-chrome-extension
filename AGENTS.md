# Agent rules

This is a personal Chrome extension (Manifest V3) that is only ever installed
via **Load unpacked**, directly from the project root. The project root is the
extension's only source. Read `SPEC.md` before making any change.

- `SPEC.md` is the source of truth. Any change that adds, alters, or removes
  behavior updates `SPEC.md` in the same change: the feature's section, the
  feature registry, the manifest block and version, and the changelog.
  `features/registry.js` must always match the registry table.
- New feature requests: write or refine the spec section first, then implement.
- Keep `SPEC.md` self-contained: never link to an external repo, gist, or page
  as a source of requirements, since links can disappear. Write the relevant
  behavior into the spec instead.
- If code and `SPEC.md` disagree, ask the owner which one is right. Do not
  silently "fix" either one.
- Hard constraints (details in `SPEC.md` section 3): plain JavaScript, no build
  step or npm, no third-party code, no permissions beyond those the spec names
  and justifies, each feature in its own file(s) with one entry in
  `features/registry.js`, every feature has a popup on/off switch (on by
  default), features fail closed and never throw into the page.
- Testing is manual via each feature's Verification steps in `SPEC.md`.
  After a change, the owner clicks reload on the extension's card in
  `chrome://extensions` and reloads affected tabs (`SPEC.md` 9.2).
- `README.md` is a short guide for people. Keep it in line with `SPEC.md`
  when purpose, features, or installation change.
