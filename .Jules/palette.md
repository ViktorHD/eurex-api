## 2025-01-20 - Ensure implicit form labels are explicitly linked
**Learning:** When using drawers/modals for secondary settings, standalone `<label>` and `<input>` elements without `for`/`id` linking break screen reader context and make clicking labels to focus inputs impossible, significantly harming mobile UX.
**Action:** Always link form labels to their inputs using `for="inputId"`, and provide `aria-label`s for inputs that intentionally lack visible text labels (like search bars and code editors).
