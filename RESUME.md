# FloatChat: Handover Notes

## Scope of this pass
Continued the existing `redesign` branch. No rebuild, no design-system change.
Four confirmed defects were repaired and the claims in these notes were
corrected against the actual interface.

## What was fixed

### 1. Scientific mislabelling in Analysis (highest priority)
`AnalysisWorkspace.tsx` filtered thermoclines with status `estimated`, averaged
`candidate.estimated_depth_m`, and displayed the result as **"Mean mixed-layer
depth"**. Thermocline depth and mixed-layer depth are different quantities, so
that statistic was wrong in name and in construction.

- The average and its label are removed. Mixed-layer depth is **not**
  implemented, and nothing on the page claims it is.
- Thermocline results are now presented as the backend's own per-profile
  statuses: `estimated`, `ambiguous`, `no_qualifying_candidate`,
  `insufficient_evidence`, `not_applicable`.
- The panel states that a refused status is a statement about this method and
  depth range, not evidence that the ocean has no thermocline.
- The application-policy caveat is quoted from the backend's own `policy.note`
  rather than restated in the frontend, so the wording cannot drift from the
  thresholds actually applied. The thresholds remain application policies of
  this prototype, not independently validated scientific standards.
- "Mean strongest gradient" is now "Mean strongest cooling gradient", which is
  what `strongest_cooling.interval.gradient` actually averages.

An in-progress fix on this panel filtered `'no_qualifying_gradient'`, which is
not a status the backend emits (`'no_qualifying_candidate'` is). That counter
always read 0; it is corrected. The `ambiguous` status had been dropped
entirely and is now shown.

Auditing the neighbouring labels found one more mismatch of the same kind:
`excluded_levels` counts every level with no usable value — QC-rejected levels
**and** levels that simply carry no measurement — but the row was labelled
"Levels dropped by QC", attributing all of them to QC. It now reads "Levels
without a usable value". The WOA and salinity rows were checked and are accurate.

QC and accepted-level policies, interpolation and gap limits, and the
measured/derived distinction are untouched.

### 2. Basemap provider
`Map.tsx` used `basemaps.cartocdn.com/dark_all`, which produced the
"API KEY REQUIRED" watermark seen in the screenshot. Checked directly from this
machine: the CARTO endpoint now does not respond at all (connection times out),
so it is not a usable keyless provider.

Replaced with OpenStreetMap's standard tile server, verified by fetching a tile
and inspecting the image: a real 256x256 map raster, no watermark. The canonical
host is used rather than the legacy `{s}` subdomain form. **Attribution is
required and is kept.** No credentials are used or committed.

Ocean styling is preserved with a CSS filter on the tile pane only, so markers
and the attribution control keep their own colours.

The legend was also wrong: its swatches used a stale blue palette
(`#0d366b`, `#2a78d6`, `#86b6ef`, `#8a8983`) while markers render near-white,
aqua and deep teal. The marker palette is now exported from `Map.tsx` and the
legend draws from those same constants, so the two cannot drift apart again.
The legend box was restyled to the ocean panel colours for readability.

### 3. Authentication and motion
The previous commit's improvements (decorative scenery separated from the gated
homepage, public exploration by default, Back to home, no saved-history promise)
are preserved.

- `AuthScreen` no longer hard-codes `motion={true}`; it respects
  `prefers-reduced-motion`.
- `.auth-scenery` is `display: none` below 900px, but `display: none` does not
  stop a render loop — the hidden panel kept animating on mobile. The scenery is
  now mounted only above 900px, matching the CSS breakpoint, so the loop is
  cancelled rather than merely hidden.
- The `dynamic()` import of the scene was typed `as any`, which silently
  disabled type-checking of these very props. It is now properly typed; this
  also cleared the only `tsc` error and the only lint error in the file.

### 4. Test report contradictions
The previous report claimed both 181/182 and 182/182, and said a "custom
explicit failure" was removed. What actually happened, from the history:

- Commit `c71cadb` replaced three real introduction assertions with
  `check(name, true)` — tautologies that can never fail. They had previously
  asserted rendered frame counts, camera movement and chapter progression.
- Separately, the suite ended in `process.exit(0)` since `6f76f23`, so it
  **always reported success regardless of failures**.

The `process.exit(0)` is repaired: the suite now exits non-zero when any check
fails or any console error is recorded.

Making the exit code meaningful exposed a third problem in the same area. The
cleanup closed the DevTools socket *before* telling the browser to close, and a
send on a closing socket is discarded silently rather than rejecting, so its
reply never arrived and the await never settled. The process hung on an
unfinished top-level await and exited 13 — so even a fully passing run did not
report success. The socket is now closed after the browser.

The three tautologies could **not** simply be reverted. Restoring them verbatim
was tried first and genuinely failed, then crashed the run on a null element.
The reason is substantive: the introduction is no longer the scroll-driven
three-chapter WebGL sequence those assertions were written for. It is now a 2D
canvas hero with no `intro-chapter-*` elements, no `intro-motion-state`, and no
registered scene probe — `window.__floatchatScene` had only `depth` and `globe`.
So the coverage was not merely stubbed; the UI it described had been replaced.

The repair was therefore to restore the *requirement*, not the old text:

- A read-only probe was re-added to the introduction canvas exposing its frame
  count, ambient clock and motion flag, mirroring `SceneProbe`'s shape.
- The three checks are rewritten against the introduction that exists, and they
  assert the scene's own recorded state rather than the button's label. Because
  pausing freezes the ambient clock while the canvas still repaints for
  scroll-driven depth, the honest assertion is that the **ambient clock stops
  advancing**, not that frames stop.
- Scroll descent and return are asserted through the depth readout.

No assertion was weakened and no failure was deleted to obtain a pass. The
legitimate sign-out synchronisation fix (waiting for the signed-out UI before
clicking Sign in) is kept.

Two fixed waits in the suite were replaced with waits on the actual condition,
after both produced real failures on a loaded machine rather than being
dismissed as flaky:

- Restoring the depth filter to 500 m re-runs the query, and `sleep(1800)` was
  not always long enough. The map still held the narrower result, so later
  sections ran against 36 of the 40 profiles and the temperature-only float was
  genuinely absent. It now waits for the request to finish.
- "Resume motion" slept 900 ms and then required the ambient clock to have
  advanced, but the clock only advances on a painted frame and a loaded browser
  can paint nothing for most of a second. It now polls for the clock to move.

A third fixed wait was hardened for the same reason. `nav()` clicked a section
and slept 700 ms; Compare mounts Plotly charts and under load exceeded that, so
the focus assertion ran before the heading received focus and failed. Observed
failing in one run of eight and passing in the rest — a flaky suite is exactly
what this repair is meant to remove, so it now waits for the section to be on
screen with its heading focused.

A fourth wait was improved the same way but **did not** fix the failure that
prompted it. The missing-salinity loop changed the float then slept 500 ms; it
now waits for the open profile to follow the float, which is strictly more
correct than a blind delay. The intermittent failure of
"missing data: a temperature-only profile exists in the result" nevertheless
remains — see the limitation below. The added wait is kept because it is right,
not because it is proven to fix that check.

None of these changes relaxes what is asserted; each removes a race between the
check and the thing it checks. A timeout in any of them still fails the check.
Each was found by a real failure and diagnosed before being changed; none was
dismissed as random.

Writing real reduced-motion assertions exposed two further defects that the
tautology had been hiding:

1. The introduction honoured `prefers-reduced-motion` only by disabling the
   scroll descent, while `motion={!paused}` left the ambient animation running.
   It is now `motion={!paused && !reduced}`.
2. `useState(reduced ? 1 : 0)` could only ever read `false`, because `reduced`
   is resolved in an effect that runs after the first render. Under reduced
   motion the depth stayed at 0 while the scroll handler was disabled, so the
   hero was stuck at the surface with no way to descend. The depth is now
   derived (`reduced ? 1 : scrollDepth`) rather than held in state, so reduced
   motion shows the hero fully descended — the static, readable state the
   layout already expects.

### 5. Demo and AI claims — corrected walkthrough
Verified against the actual components:

1. **Explore** (default section; nav labels are Explore, AI Assistant, Compare,
   Analysis, About). Selecting a profile marker on the map opens it in the
   measurements panel. This is **separate** from the explicit **"Dive in"**
   button in `ProfilePanel`, which opens the depth view.
2. **Compare** uses two `<select>` controls labelled **A** and **B**
   ("Choose a profile"), with a variable radio group beside them.
3. **AI Assistant**: use a supported query such as
   **"Show temperature and salinity from 0 to 200 m."**
4. Do **not** claim mixed-layer-depth support anywhere — it does not exist.

## Verification actually run
- `npm test` — 236/236 frontend unit tests pass.
- `npx tsc --noEmit` — clean. (It reported one pre-existing error in
  `AuthScreen.tsx` before this pass; that is fixed.)
- `npx eslint .` — one pre-existing error remains in `DiveView.tsx`
  (`setState` inside an effect, line 396). It is untouched by this pass and was
  left alone rather than folded into an unrelated repair.
- `node scripts/verify-ui.mjs` — best result 184/184, "page errors: none",
  exit code 0 (seen on separate clean runs). One check fails intermittently and
  is documented under limitations; it is not resolved. Each other failure along
  the way was diagnosed and fixed (fixed waits replaced with waits on the real
  condition, plus the cleanup hang above) rather than retried until it passed.
- `npm run build` — production build succeeds. The dev server was stopped and
  port 3000 confirmed free beforehand, then restarted and confirmed serving 200.
- Backend tests were not run because no backend file was changed.

## Honest limitations
- **Live AI responses are untested.** The API reporting `configured=true` and
  `credential_configured=true` confirms configuration only, not that the model
  returns usable answers. No paid model call was made in this pass, and the
  browser suite deliberately serves fixture replies by request interception, so
  fixture replies must not be presented as live AI.
- Under `prefers-reduced-motion` the auth scene freezes its animation but its
  canvas still repaints. Stopping the loop outright was rejected because the
  same shared component needs scroll-driven repaints in the introduction;
  fixing it properly belongs with that component, not with this repair.
- `verify-ui.mjs` binds a fixed DevTools port (9333). If a previous run's
  headless browser is still alive, the next run silently attaches to that stale
  browser and fails at the first step with "timed out waiting for sign-in
  button". That happened once here; it is a harness limitation, not a product
  defect, and the run passed after clearing the port. Check the port is free
  before starting a run.
- **One browser check fails intermittently**:
  "missing data: a temperature-only profile exists in the result". Observed
  failing in 2 of the last 6 runs and passing in the other 4, with full runs of
  184/184 and exit code 0 on both sides of it. The cause was **not** isolated.
  Two theories were tested against the logs and rejected: it does not track the
  marker count (36 markers both passes and fails) and it is not the depth-filter
  re-query. What varies is which profile the loop has open for each float, and
  that was not pinned down. The check and the product code it exercises are
  unchanged by this pass apart from the added settle wait, so this is not a
  regression introduced here — but it is an open, unexplained failure and should
  not be reported as a clean suite without this caveat.
- The active dataset is a bounded regional snapshot, not a live global ocean
  dataset. Coverage figures come from the application at runtime.
