<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->

## Code conventions

- All code identifiers (function/type/variable names), error messages, log output, test function names, and test assertion messages MUST be in English. Chinese test names and error strings in older code are legacy — do not add new ones, and convert them to English when you touch the surrounding code.
- Code comments may be written in Chinese.
- User-facing UI copy follows the i18n system (`apps/mobile/src/i18n/`), not this rule.
