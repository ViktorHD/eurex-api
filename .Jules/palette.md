## 2024-07-23 - Added ARIA labels to icon-only buttons
**Learning:** The application uses Feather Icons extensively for UI controls (close buttons, toggles, menus) without accessible text equivalents, making navigation difficult for screen readers.
**Action:** When adding new icon-only controls in this codebase, ensure `aria-label` attributes are consistently applied to provide clear context.
