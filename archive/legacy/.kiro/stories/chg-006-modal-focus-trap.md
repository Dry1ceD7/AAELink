---
source_finding: CHG-006
pillar: "🟠 Changes Required"
severity: P1
slug: chg-006-modal-focus-trap
created_at: 2026-05-26
audit_run: docs/audit-2026-05-26.md
---

# Story: Install focus trap on every dialog (WCAG 2.1.2)

- **Status:** Draft
- **Roadmap milestone:** v0.0.59-alpha
- **Size:** M

## Context
27 of 28 `aria-modal="true"` dialogs lack focus trapping. Tab from inside escapes to page DOM; shift-tab from first focusable element escapes upward. WCAG 2.1.2 fails.

## Scope
- Add `useFocusTrap()` hook to `app/components/primitives/Modal.tsx`.
- Migrate the 27 ad-hoc dialogs to import the primitive.
- Add Playwright + axe-core E2E spec at `e2e/a11y/modals.spec.ts`.

## Acceptance criteria
1. Every modal in the rebuilt list passes axe-core "focus trap" rule.
2. Tab cycles within the modal; shift-tab from first element wraps to last.
3. Esc closes the modal and returns focus to the trigger element.
4. Four gates pass.

## References
- `docs/audit-2026-05-26.md` § Required Changes — CHG-006
- WCAG 2.1.2: No Keyboard Trap; conversely, modal MUST trap focus.
