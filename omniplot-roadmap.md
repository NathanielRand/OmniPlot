---
board: OmniPlot Roadmap
---

## 📋 Backlog

### prod error on vectorize: Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at http://localhost:7878/api/status. (Reason: CORS request did not succeed). Status
<!-- status: backlog | created: 2026-06-11 -->

### Optional end cut for roll separation with adjustable gap distance from pattern edges shown on the canvas when toggled on as to where it will make its end cut.
<!-- status: backlog | created: 2026-06-10 -->
- Add optional end cut that cuts with enough force to cleanly cut both layers of the roll and fully separate the job from the master roll

### Agent connection serial port errors
<!-- status: backlog | created: 2026-06-10 -->
- Agent connection is throwing serial port errors — investigate root cause and surface a clear error state to the user

### Multiple USB connections — compress inactive UI
<!-- status: backlog | created: 2026-06-10 -->
- Multiple USB connections appeared simultaneously; unclear if same device or duplicates
- Compress the inactive connections box size to clearly differentiate active connected vs inactive methods

### Plotter emulator/simulator for offline testing
<!-- status: backlog | created: 2026-06-10 -->
- Create a local plotter emulator/simulator to verify bidirectional communication between plotter and agent
- Must cover all expected communication events with proper processing and response
- Needed for testing without physical equipment on-site

### Investors page
<!-- status: backlog | created: 2026-06-10 -->
- Build out an investors page

### Post-disconnect plotter tab state
<!-- status: backlog | created: 2026-06-10 -->
- After a USB connection method is disconnected, the agent option card/status on the plotter tab in Studio should display correctly — showing available connection methods as selectable since the user likely wants to switch

### Cutting services — order flow
<!-- status: backlog | created: 2026-06-10 -->
- Offer cutting services with simple user flow: select from DB of patterns or submit own, then place order
- We cut at shop and ship to customer in hardened tube — priced at material cost +
- Reference patterns: https://www.thetinteffect.com/precut-window-tint-kits/

### Offline mode
<!-- status: backlog | created: 2026-06-10 -->
- Add offline mode support

### Pattern flagging for inaccuracies
<!-- status: backlog | created: 2026-06-10 -->
- Add flagging/report system for all patterns (platform and community)
- Warn users when a pattern they select is flagged for review

### Custom material dimensions
<!-- status: backlog | created: 2026-06-10 -->
- Allow custom material selection for unique/irregular dimensions (e.g. non-standard roll sizes)

### Heat shrinkage buffer option
<!-- status: backlog | created: 2026-06-10 -->
- Add setting to apply an internal buffer inside each design's cut zone for heat shrinkage compensation
- Default ~1cm, user-adjustable

### Community pattern uploads — approval flow
<!-- status: backlog | created: 2026-06-10 -->
- Community-uploaded patterns must 1:1 match admin-added patterns in data completeness
- Community patterns show as "unverified" until approved by admin or community method
- Admin must approve/reject requests in under a few hours

### Fully custom pattern upload
<!-- status: backlog | created: 2026-06-10 -->
- Support fully custom pattern uploads for shapes, logos, icons, etc.
- Option to submit to community under a more fitting category than vehicles

### User vehicle pattern upload + community submission
<!-- status: backlog | created: 2026-06-10 -->
- Users can upload and use any vehicle pattern with option to submit to community
- On community submission, enforce all required data fields to match platform pattern standards

### Pattern request sourcing via admin/community
<!-- status: backlog | created: 2026-06-10 -->
- Verify/refactor: pattern requests should be sourced by admin or community members, not the requesting user
- Add upvote system for requests — flag low-quality designs

### 2D scanning tool data → pattern import
<!-- status: backlog | created: 2026-06-10 -->
- Allow users to upload output data from a 2D scanning tool and use it as a pattern

### Phone camera web-based 2D scanning tool
<!-- status: backlog | created: 2026-06-10 -->
- Turn user's phone camera into a web-based 2D scanning tool for capturing patterns

### optTolerance at 0.8 — that's the practical ceiling. Blurs at 2.2/1.8. If this overshoots and gentle curves start flattening, the safe retreat is optTolerance: 0.7 and blurs back to 2.0/1.5.
<!-- status: backlog | created: 2026-06-11 -->

### claude --resume 07dd12d1-130a-4227-b43c-a3fd6a80fc54
<!-- status: backlog | created: 2026-06-11 -->

## 🔄 In Progress

### Image → SVG with background removal
<!-- status: in-progress | created: 2026-06-10 -->
- Support any image type → remove background → convert to SVG
- Should inherit existing SVG upload functionality

### Vertical pattern placement preference
<!-- status: in-progress | created: 2026-06-10 -->
- Add preference to orient patterns vertically when the longest dimension fits within the roll width, reducing width consumption

## 🧪 Testing

### Selected connection persistence across navigation
<!-- status: testing | created: 2026-06-10 -->
- Verify the user's selected connection method persists across page navigation within the session

### USB direct connection persistence + probe prompt
<!-- status: testing | created: 2026-06-10 -->
- USB direct connection should persist between page navigation and show the probe prompt correctly

### Roll measurements display clarity
<!-- status: testing | created: 2026-06-10 -->
- Roll size display on the grid UI is confusing — currently shows e.g. "40 inches" in multiple places
- Increase text size for roll size and amount used; differentiate total vs consumed clearly

### Cutter manual/offline mode disclaimer
<!-- status: testing | created: 2026-06-10 -->
- Verify disclaimer is shown to user that cutter must be in manual/offline mode to receive jobs

### Plotter origin wizard — inherit roll size from properties tab
<!-- status: testing | created: 2026-06-10 -->
- Origin wizard/settings should pull the user-selected roll size from the Properties tab
- Currently mismatched — any cross-setting data like this must be synced to prevent conflicts

### Agent update detection & version sync
<!-- status: testing | created: 2026-06-10 -->
- Version mismatch prompt fires even when versions match exactly (v1.1.0 false positive)
- Old version (v1.0.1) not prompting update at all
- Previous agent state not being flushed properly; new state not persisting after recent connection persistence changes
- Verify user only needs to download the latest version, not each intermediate version
- Verify stale local agent install is detected and user is guided to remove it
- Agent connection state must be reactive, persistent, and dynamically cleanable

### Plotter connection method — session persistence + auto-reconnect
<!-- status: testing | created: 2026-06-10 -->
- Selected connection method must persist the entire session
- Should remember last used method across sessions and attempt auto-connect on return

### Test cut size — too large
<!-- status: testing | created: 2026-06-10 -->
- Test cut from plotter is way too large — must be 1-inch × 1-inch box with a smaller circle inside

### Job queue — subsequent patterns not cutting
<!-- status: testing | created: 2026-06-10 -->
- First pattern in a job completes, but subsequent patterns are skipped and the job jumps to final end cut
- Verify all patterns in the job queue are processed in order before the end cut
- Verify job recovery handles incomplete jobs correctly
- Add admin/user-visible logs for job completion status

### Origin alignment — plotter vs roll size
<!-- status: testing | created: 2026-06-10 -->
- 53" plotter and 40" roll may not be aligned on the correct origin; 13" difference may be placed on the wrong end
- Need a smart verification flow — possibly requiring user input or equipment feedback — to confirm all origins match
- Design an efficient and creative solution for origin validation

### B. Post-process bezier junctions (recommended) After potrace produces the path, analyze each junction between bezier segments. The exit tangent of segment N and the entry tangent of segment N+1 form a
<!-- status: testing | created: 2026-06-10 -->

## 📌 ✅ Done

### Zone assignment visibility across upload, dialog, studio, and edit
<!-- status: done | created: 2026-06-11 -->
- Mirror add dialog now shows actual zone names (e.g. "Front Door Left" / "Front Door Right") instead of generic "As uploaded" / "Mirrored"
- SvgPathInput mirror preview panels accept `mirrorOrigLabel`/`mirrorFlipLabel` props — upload and edit pages pass the computed zone labels
- Studio already shows zone-based labels via `pattern.name`; My Patterns cards already show `compactZones()`

### Multi-pattern vectorization from single upload image
<!-- status: done | created: 2026-06-11 -->
- After vectorizing a raster image with multiple contours, SvgPathInput shows "Split into N patterns →" button alongside the multi-subpath warning
- Clicking it calls `onMultiExtract(paths)` with individually normalized 0–100 paths (one per contour)
- Upload page enters multi-mode: slot cards with SVG preview, zone selector, width/height fields; each slot can be skipped
- Submitting creates one `UserPattern` per active slot; success screen shows count

### Mirror pair preview in pattern uploader
<!-- status: done | created: 2026-06-11 -->
- When both sides of a mirror pair are selected as zones, SvgPathInput shows a two-panel preview: "As uploaded" (original) and "Mirrored" (matrix(-1 0 0 1 100 0) flip)
- `hasMirrorPair` derived in upload and edit pages drives the `showMirror` prop

### Mirror pair add dialog in /library
<!-- status: done | created: 2026-06-11 -->
- Clicking Add on a My Patterns card with mirror zones opens a dialog with both sides pre-checked
- User can uncheck one side before confirming; flipped copy is added with `flippedH: true` (flows through to HPGL cut)

### Vehicle make/model search dropdowns
<!-- status: done | created: 2026-06-10 -->
- Make and model fields on upload and edit forms are now searchable comboboxes
- Filters existing vehicles from the store as you type; "Add …" option at bottom normalizes to title case
- On blur, snaps to exact existing casing so the dupe-check derived resolves correctly

### Test cut guide accuracy (1" × 1" box + circle)
<!-- status: backlog | created: 2026-06-10 -->
- Confirm the "Send a test job" step in setup does NOT use a 500-unit cut
- Verify only the 1-inch × 1-inch box with circle test cut is used throughout all docs and UI
- Audit `/agent`, `/studio/agent` pages for consistency; guide on `/agent` should be multi-row (too clustered on all devices)

### smoothing pass on corners and flat edges (where you would expect line connecting corners to be more straight)
<!-- status: backlog | created: 2026-06-11 -->

### Lost precision on new method upload cornering
<!-- status: backlog | created: 2026-06-10 -->
- Precision regression on cornering observed after recent method upload changes — identify and fix

### Pattern accuracy — window curvature
<!-- status: backlog | created: 2026-06-10 -->
- Current patterns are inaccurate — window curvature is not being taken into consideration
- Audit and fix all window patterns to account for curvature

### test
<!-- status: backlog | created: 2026-06-10 -->

