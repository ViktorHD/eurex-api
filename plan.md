1. **Understand Color Palette & Typography**
   - Eurex primarily uses `#201751` (navy blue), `#00ce7d` (neon green), white, and light grays.
   - Typography should lean towards a clean, modern sans-serif like Material Design's Roboto, or Inter (already used in `index.html`).

2. **Update Global Variables in `styles.css`**
   - Update `styles.css` root variables to define Material Design-like backgrounds, surfaces, and elevations while preserving the Eurex core colors.
   - Adjust `--bg-main`, `--bg-panel`, `--border-color` for better contrast.

3. **Improve Layout & Spacing (Material Design Philosophy)**
   - Add subtle shadows (`box-shadow`) to panels to create elevation.
   - Increase padding for better touch targets and readability.
   - Make buttons more pronounced with Material-style ripples or hover effects (subtle background changes, box shadows).

4. **Enhance Specific Components**
   - **Result Table:**
     - Remove the clunky borders and replace them with a clean, border-bottom design for rows (Material table style).
     - Add hover effects on table rows.
     - Better spacing in headers (`th`) and cells (`td`).
     - Modernize the column filters input design.
   - **Action Bar & Headers:**
     - Clean up inputs and buttons to have Material-like borders, rounded corners (e.g., `4px` or `8px`), and appropriate focus states.
   - **Nav & Tabs:**
     - Make the left nav icons cleaner.
     - Redesign the tabs to look more like Material Design tabs (with a prominent bottom border indicator for the active state).
   - **Panes:**
     - Add subtle border-radius to inner elements to modernize them without making them completely round.

5. **Pre-commit Checks**
   - Complete pre-commit steps to make sure proper testing, verifications, reviews and reflections are done.

6. **Submit**
   - Submit the branch with an appropriate message.
