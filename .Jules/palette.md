
## 2024-05-30 - Add global focus-visible styles
**Learning:** The application uses `outline: none` for many interactive elements to remove default browser outlines, which unfortunately removes focus indicators for keyboard navigation. Adding a universal `:focus-visible` outline re-enables keyboard accessibility without negatively impacting the experience for mouse/touch users.
**Action:** Applied a global `:focus-visible` rule in `explorer/styles.css` utilizing the existing `var(--neon-green)` theme color to provide consistent and visible focus indicators.
