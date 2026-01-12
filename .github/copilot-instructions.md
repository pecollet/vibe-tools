# vibe-tools Copilot Instructions

## Overview
This repository contains standalone HTML-based data visualization and utility tools built with generative AI. Each tool is a self-contained single HTML file with embedded CSS and JavaScript, hosted on GitHub Pages.

## Architecture
- **Single-file tools**: Each tool (e.g., `plot_csv_metrics.html`) is completely self-contained with no external dependencies except CDN-hosted libraries
- **No build process**: Tools are edited directly as HTML files and served statically
- **CDN dependencies**: Uses libraries like Plotly.js, PapaParse via CDN for CSV parsing and visualization

## Key Patterns

### CSS Framework
- Dark theme with CSS custom properties (variables) for consistent styling
- Common variables: `--bg`, `--panel`, `--text`, `--muted`, `--accent`, `--border`
- Example from `plot_csv_metrics.html`:
  ```css
  :root { --bg:#0b1220; --panel:#101b32; --text:#e8eefc; --muted:#9bb0db; --accent:#7aa2ff; --border:rgba(255,255,255,.12); }
  ```

### File Handling
- Drag-and-drop file upload with visual feedback
- File input fallback for browsers without drag-drop support
- CSV parsing using PapaParse library
- Example pattern:
  ```javascript
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  ```

### Data Visualization
- Plotly.js for interactive charts (timelines, histograms, swimlanes)

### UI Components
- Card-based layout with `.card`, `.hd` (header), `.bd` (body) structure
- Consistent button styling with `.btn` class
- Pill elements for status/info display
- Responsive grid layouts using CSS Grid

## Development Workflow
- Edit HTML files directly in any text editor
- Test locally by opening files in browser (no server required)
- Deploy by committing to main branch (GitHub Pages auto-deploys)
- No testing framework; manual testing by opening in browser

## File Structure
- `*.html`: Individual tool files (self-contained)
- `README.md`: Tool catalog and descriptions with screenshots
- No subdirectories; flat structure for simplicity

## Code Style Conventions
- Inline `<style>` and `<script>` tags within HTML
- ES6+ JavaScript with arrow functions and destructuring
- CSS Grid/Flexbox for layouts
- Semantic HTML with accessibility considerations (alt text, proper headings)

## Common Libraries
- **Plotly.js**: Interactive charts and graphs
- **PapaParse**: CSV parsing and processing
- **No frameworks**: Vanilla JS/CSS for maximum portability. Absolutely no React.

## Examples
- For new tools: Copy structure from `plot_csv_metrics.html` and modify data processing logic
- File upload: See `dropZone` event handlers in any tool
- Plotting: Use `Plotly.newPlot()` with data arrays and layout objects

## CYPHER Queries
Some tools generate CYPHER queries for Neo4j. Use the following conventions:
- Pretty print the queries with indentation and line breaks.
- capitalise key words (MATCH, RETURN, WHERE, WITH, CALL, CREATE, MERGE, SET, DELETE)
- For queries writing data, use batches with `CALL { ... } IN TRANSATIONS OF 1000 ROWS` to avoid memory issues
- For queries writing nodes, also use concurrency with `CALL { ... } IN CONCURRENT TRANSATIONS OF 1000 ROWS`
- use CYPHER comments (`//`) to explain non-trivial parts of the queries