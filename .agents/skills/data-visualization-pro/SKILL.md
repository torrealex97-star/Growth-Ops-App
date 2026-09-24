---
name: data-visualization-pro
description: "Comprehensive data visualization skill covering visual execution and technical implementation. Includes perceptual foundations, chart selection, layout algorithms, and library guidance. Triggers on: charts, graphs, dashboards, 'visualize', 'plot', data presentation, D3, Recharts, Victory."
version: 1.0.0
---

# Data Visualization (Pro)

Visualization is communication. Every visual element must serve understanding.

## Critical Rules

🚨 **Use established algorithms.** Graph layout, tree layout, spatial indexing—these problems are solved. Check dagre, d3-force, ELK.js before implementing anything custom.

🚨 **Choose encodings by perceptual accuracy.** Position beats length beats angle beats area beats color. Prefer bar charts over pie charts over bubble charts.

🚨 **Never rely on color alone.** 8% of men are colorblind. Use shape, pattern, or labels as backup encoding.

🚨 **Match rendering to scale.** SVG for <1000 elements, Canvas for 1000-10000, WebGL for >10000.

---

## 1. Visual Encoding

### Marks & Channels

**Marks** are geometric primitives representing data:

- Points (scatter plots, dot plots)
- Lines (line charts, network edges)
- Areas (bar charts, area charts, maps)

**Channels** are visual properties applied to marks:

- Position (x, y coordinates)
- Size (length, area, volume)
- Color (hue, saturation, lightness)
- Shape (circle, square, triangle)
- Orientation (angle, slope)

### Cleveland & McGill Hierarchy (1984)

Visual encodings ranked by perceptual accuracy:

1. **Position along common scale** (most accurate)
2. Position on non-aligned scales
3. Length
4. Angle/slope
5. Area
6. Volume
7. **Color saturation/hue** (least accurate)

**Implication:** Bar charts (position) > pie charts (angle) > bubble charts (area)

### Preattentive Attributes

Properties processed in <250ms without conscious effort:

- Color (hue, saturation)
- Form (orientation, length, width, size, shape)
- Spatial position
- Motion

Use preattentive attributes for the most important data—they "pop out" automatically.

### Channel Effectiveness by Data Type

| Data Type    | Best Channels                 |
| ------------ | ----------------------------- |
| Quantitative | Position, length, angle, area |
| Ordinal      | Position, density, saturation |
| Categorical  | Shape, hue, spatial region    |

---

## 2. Interaction Design

### Shneiderman's Mantra (1996)

"Overview first, zoom and filter, then details on demand"

1. **Overview** — Show entire dataset, establish context
2. **Zoom & Filter** — Reduce complexity, focus on subset
3. **Details on Demand** — Tooltips, click-to-expand, drill-down

### Interaction Patterns

| Pattern              | Use Case                                    |
| -------------------- | ------------------------------------------- |
| Brushing & linking   | Cross-highlighting across coordinated views |
| Focus + context      | Fisheye, detail-on-demand panels            |
| Direct manipulation  | Drag nodes, resize elements, reorder        |
| Animated transitions | Help users track changes between states     |
| Pan & zoom           | Navigate large visualizations               |
| Filtering            | Reduce complexity                           |
| Selection            | Highlight specific data points              |

---

## 3. Chart Selection

### By Question Type

| Question                        | Chart Type              | Why                                |
| ------------------------------- | ----------------------- | ---------------------------------- |
| How do values compare?          | Bar chart               | Position encoding is most accurate |
| How has this changed over time? | Line chart              | Shows trends, handles many points  |
| What's the distribution?        | Histogram, box plot     | Shows spread, outliers, shape      |
| What's the relationship?        | Scatter plot            | Reveals correlation, clusters      |
| What's the part-to-whole?       | Stacked bar, treemap    | Shows composition                  |
| What are the connections?       | Network graph, Sankey   | Shows relationships, flows         |
| What's the hierarchy?           | Tree, sunburst, treemap | Shows parent-child structure       |
| Where is it?                    | Choropleth, symbol map  | Geographic context                 |

### By Data Volume

| Volume     | Approach                               |
| ---------- | -------------------------------------- |
| <20 points | Simple charts, direct labeling         |
| 20-500     | Standard visualization                 |
| 500-5000   | Consider aggregation, filtering        |
| 5000+      | Aggregation mandatory, or Canvas/WebGL |

### Common Anti-Patterns

- ❌ Pie charts with >5 slices
- ❌ 3D charts without strong justification
- ❌ Dual-axis with unrelated scales (misleading)
- ❌ Non-zero baselines for bar charts (distorts perception)
- ❌ Truncated axes without clear indication

---

## 4. Color

### Palette Types

| Type        | Use Case                     | Examples                    |
| ----------- | ---------------------------- | --------------------------- |
| Sequential  | Low to high values           | Blues, Greens, Viridis      |
| Diverging   | Values diverge from midpoint | RdBu, BrBG, Spectral        |
| Categorical | Distinct categories          | Set2, Tableau10, Category10 |

### Colorblind Safety

- 8% of men, 0.5% of women have color vision deficiency
- **Never rely on color alone** — use shape, pattern, labels
- Safe sequential: viridis, cividis, plasma
- Safe categorical: ColorBrewer's colorblind-safe options
- Test with: Coblis, Sim Daltonism, Chrome DevTools

### Perceptual Uniformity

- **Avoid rainbow colormaps** (jet) — perceptual steps are uneven
- Use viridis, parula, cividis for sequential data
- These ensure equal perceptual distance between values

### Color Guidelines

- 4.5:1 contrast ratio for text (WCAG AA)
- 3:1 contrast for UI components
- Max 7-10 distinct categorical colors
- Use saturation/lightness variation for emphasis

---

## 5. Layout Algorithms

🚨 **Before implementing ANY layout algorithm, check if a library exists.**

| Problem                 | Algorithm                   | Libraries              |
| ----------------------- | --------------------------- | ---------------------- |
| Layered/DAG graphs      | Sugiyama (1981)             | dagre, ELK.js          |
| Force-directed networks | Fruchterman-Reingold (1991) | d3-force, Cytoscape.js |
| Tree layouts            | Reingold-Tilford (1981)     | d3-hierarchy           |
| Treemaps                | Squarified (2000)           | d3-hierarchy, ECharts  |
| Circle packing          | Wang (2006)                 | d3-hierarchy           |
| Sankey diagrams         | —                           | d3-sankey              |
| Chord diagrams          | —                           | d3-chord               |

### When to Use Each Layout

| Layout           | Best For                                            |
| ---------------- | --------------------------------------------------- |
| Sugiyama (dagre) | Flowcharts, dependency graphs, DAGs with direction  |
| Force-directed   | Social networks, organic relationships, exploration |
| Tree             | Hierarchies with single parent per node             |
| Treemap          | Hierarchies with quantitative values                |
| Circular         | Emphasizing central nodes, ring structures          |
| Matrix           | Dense graphs where edges would overlap              |

**These problems are solved. Never implement from scratch.**

---

## 6. Rendering & Performance

### Rendering Technology Thresholds

```
<1000 elements    → SVG (DOM events, ARIA, CSS)
1000-10000        → Canvas (batch rendering, manual hit testing)
>10000            → WebGL (GPU, Sigma.js, deck.gl)
```

### Performance Patterns

| Pattern          | When To Use                                  |
| ---------------- | -------------------------------------------- |
| Web Workers      | Layout computation (never block main thread) |
| Spatial indexing | Hit detection with quadtree/R-tree           |
| Viewport culling | Only render visible elements                 |
| Debouncing       | Expensive interactions                       |
| Virtualization   | Long lists of chart components               |
| Aggregation      | Too many data points                         |

### Anti-Patterns

- ❌ 5000 SVG nodes
- ❌ Layout computation on main thread
- ❌ Hit testing without spatial indexing
- ❌ Rendering off-screen elements
- ❌ Animating thousands of elements individually

---

## 7. Libraries

### Charting

| Library         | Best For                   | Notes                       |
| --------------- | -------------------------- | --------------------------- |
| D3.js           | Custom, highly interactive | Low-level, maximum control  |
| Observable Plot | Quick exploration          | D3 team, excellent defaults |
| Recharts        | React integration          | Declarative, composable     |
| Victory         | React integration          | Animation support           |
| ECharts         | Feature-rich dashboards    | Mobile, large datasets      |
| Vega-Lite       | Grammar of graphics        | Declarative JSON spec       |

### When to Use D3 vs Higher-Level Libraries

**Use D3 when:** you need complete control, novel visualizations, or custom optimizations.
**Use higher-level libraries when:** standard chart types suffice, speed matters, team is less experienced with D3.

---

## 8. Composition & Layout

### Project Composition (Dashboard Level)

- **Visual hierarchy** — guide the eye to what matters first
- **Grid systems** — align elements for coherence
- **Grouping** — related visualizations together
- **White space** — breathing room
- **Reading flow** — Z/F-pattern for Western audiences

### Chart Composition

| Element      | Guidelines                                     |
| ------------ | ---------------------------------------------- |
| Title        | Clear, descriptive; top-left or centered above |
| Subtitle     | Context, smaller, below title                  |
| Axes         | Labeled with units; meaningful intervals       |
| Legend       | Embedded when possible                         |
| Aspect ratio | ~16:9 for time series (45° banking)            |
| Margins      | Enough for labels; consistent across charts    |

---

## 9. Annotation

### Annotation Types

| Type            | Purpose                       |
| --------------- | ----------------------------- |
| Title           | The "what"                    |
| Subtitle        | Context, data source          |
| Caption         | The "so what" — takeaway      |
| Axis labels     | Variable names and units      |
| Legend          | Decode color/shape/size       |
| Callouts        | Highlight specific points     |
| Reference lines | Benchmarks, targets, averages |

### Best Practices

- **Annotate the insight** — "Sales peaked in Q3" not just "Sales over time"
- **Callouts sparingly** — 1-3 key points maximum
- **Direct labeling** over separate legends
- **Provide context** — benchmarks, targets

### Text Hierarchy

1. Title (largest, boldest)
2. Subtitle/caption
3. Axis titles
4. Tick labels
5. Annotations
6. Source (smallest)

---

## 10. Accessibility

### WCAG

- **AA minimum**: 4.5:1 text, 3:1 UI components
- No information by color alone

### Keyboard & Screen Readers

- Tab through interactive elements
- `role="img"` + `aria-labelledby` on SVGs
- Provide text alternatives and data tables

### Alternative Representations

- **Data tables** as fallback for all charts
- Text summaries describing key insights

---

## 11. Anti-Patterns Summary

| Anti-Pattern        | Why It's Wrong          | What to Do        |
| ------------------- | ----------------------- | ----------------- |
| 3D charts           | Distorts perception     | Use 2D            |
| Pie >5 slices       | Hard to compare         | Bar chart         |
| Dual unrelated axes | Misleading correlation  | Separate charts   |
| Non-zero baseline   | Exaggerates differences | Start at zero     |
| Rainbow colormap    | Perceptually uneven     | Viridis           |
| Color-only encoding | Excludes colorblind     | Shape/pattern     |
| Chart junk          | Distracts               | Remove decoration |

---

## 12. Academic Foundations

| Resource                  | Type  | Focus                       |
| ------------------------- | ----- | --------------------------- |
| Cleveland & McGill (1984) | Paper | Visual encoding hierarchy   |
| Shneiderman (1996)        | Paper | Overview-zoom-filter mantra |
| ColorBrewer               | Tool  | Accessible palettes         |
| From Data to Viz          | Tool  | Chart selection tree        |
| Munzner, Kirk, Tufte      | Books | Theory and practice         |

---

## Summary

🚨 **Before implementing visualization:**

1. **What question are you answering?** → Select chart type
2. **What's your data volume?** → Select rendering technology
3. **Is there an established algorithm?** → Use the library
4. **Is it accessible?** → Color, keyboard, screen reader
5. **Does it follow perceptual best practices?** → Encoding hierarchy
