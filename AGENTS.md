# Agent rules

This is a personal Chrome extension (Manifest V3) that is only ever installed
via **Load unpacked**. Read `SPEC.md` before making any change.

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
- `release/` is the owner's **production release**. Rebuild it with
  `.\build-release.ps1` **only when the owner explicitly asks for a new
  release**. Never rebuild it as part of a feature, fix, or other change,
  even a finished and tested one, and never edit it by hand. On a release,
  also add a `Released <version> to release/.` changelog line (`SPEC.md` 9.1).
- To test unreleased changes, the owner loads the project root unpacked as a
  separate development copy (`SPEC.md` 9.3).
