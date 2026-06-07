# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.15.3 create --template minimal --types ts --install npm OmniPlot
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

---

## Trace Image Algorithm (`src/lib/utils/trace.ts`)

Converts a raster PNG/JPG of a window/PPF template into a closed SVG path.

### Pipeline (v4)

1. **Otsu threshold** — binarize RGBA image to foreground mask
2. **Moore contour tracing** — extract closed pixel boundary (~1–2 px staircase)
3. **Light Gaussian smooth** (σ=1.5) — damp staircase noise while keeping corner coords within ~0.5 px of true geometry
4. **`detectCornersFromCurvature`** — Menger curvature on light-smooth contour; threshold = `mean + 1.5σ`; NMS within `minSpacingFrac=6%` of contour length
5. **`normalizePts`** — map pixel contour to 0–100 path-unit space (preserves aspect ratio, 3 px margin)
6. **`refineCornerPositions`** (`maxMove=0.5`) — PCA line-fit + parametric intersection snap; bounded to 0.5 units so it only corrects genuine sub-pixel notch artifacts (Moore produces a ~0.5 px notch at true corners); snaps > 0.5 are rejected
7. **`buildPathFromCorners`** — Schneider cubic bezier fitting per span, G1 tangent continuity at smooth junctions, tolerance 2.0 px in path units
8. **Hausdorff gate** — if max deviation ≤ 2.0 path-units, return; otherwise retry with tighter tolerance (fallback pass)

### Current metrics (fixture: `src/lib/utils/__fixtures__/car-window-ref.png`, 152×109 px)

| Metric | Value |
|---|---|
| IoU vs truth mask | 98.4% |
| Hausdorff deviation | 1.308 path-units |
| Corners detected | 4 (structural transitions only) |
| Bezier segments | 11 C commands |
| Tests | 63/63 passing |

### Known limitations / next improvement areas

- **Single test fixture** — the committed fixture is a clean synthetic shape. Real photos introduce JPEG noise, anti-aliasing, and gradual tonal transitions that stress the threshold and contour steps. More real-world test images are needed to push the algorithm further.
- **`mean + 1.5σ` threshold** — susceptible to outlier inflation on shapes with one dramatically sharper corner among several gentler ones. `median + 3×MAD` was tested but collapses to ~0 on mostly-flat contours (straight sides dominate the κ distribution, making median ≈ MAD ≈ 0). A robust alternative (e.g. trimmed mean, or percentile-based floor) is needed.
- **`refineCornerPositions` rarely fires** — with `maxMove=0.5`, no corner on the current fixture qualifies (smallest actual snap distance was 1.1 units). The Moore notch artifact is real (~0.5 px) but the line-fit intersection still overshoots on curved-edge windows. A better approach might be direct subpixel gradient-following rather than PCA intersection.
- **Segment count** — 11 bezier segments for a 4-corner window is reasonable but not minimal. Reducing segments without losing shape fidelity (especially the A-pillar inflection) requires better span-level curvature estimation.
