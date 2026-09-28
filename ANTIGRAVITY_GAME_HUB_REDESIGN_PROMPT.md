# Antigravity Prompt — Animated Bầu Cua Game Hub Redesign

Copy the **Implementation Prompt** below into Antigravity. This specification is written for the current repository and must be implemented without replacing the existing game logic.

---

## Implementation Prompt

You are a senior game UI/UX designer and a senior vanilla web-game engineer.

Redesign the post-login home hub of the existing **Bầu Cua Victory** project. The target is an original Vietnamese festival/casino game hub inspired by the visual energy and layered animation language of:

- Reference website: `https://web.sunwin.villas/`
- User-provided screenshot: four large menu cards in one horizontal row and a five-action bottom navigation rail.

Use the reference only for visual rhythm, depth, lighting, card animation, and information hierarchy. Do not copy SUNWIN branding, logos, source code, text, characters, or proprietary image assets.

### 1. Repository facts and constraints

The existing project uses:

- Vite.
- Vanilla HTML, CSS, and JavaScript.
- Socket.IO client/server logic.
- Existing files such as `index.html`, `src/main.js`, `src/style.css`, and `src/arena.css`.
- Existing Bầu Cua artwork under `public/assets/arena/`.

Before editing:

1. Inspect the current DOM structure, lobby flow, room creation/joining logic, game-state transitions, Socket.IO events, overlays, and existing assets.
2. Identify which current actions can be safely reused for each new hub card.
3. List the files you intend to modify.
4. Preserve all existing IDs, event contracts, server payloads, room state, betting logic, history, sound, fullscreen, settings, chat, and accessibility behavior unless a change is explicitly required below.

Do not migrate the project to React, Vue, Tailwind, or another framework. Do not add a large animation dependency when CSS animations, the Web Animations API, and small canvas effects are sufficient.

### 2. Required screen architecture

Create a dedicated post-login/main-hub view shown before the user enters the betting arena. It must contain:

1. Existing player/profile and balance information where appropriate.
2. Four large primary action cards in this exact order:
   - `Chơi nhanh`
   - `Chơi với bạn`
   - `Chọn bàn`
   - `Game khác`
3. A fixed ornamental bottom action rail containing, from left to right:
   - `Thêm bạn`
   - `Nhận quà`
   - `Giải đấu`
   - `Cảnh báo`
   - `Live Chat`

The desktop and landscape layout must keep all four cards in one centered row. On constrained widths, scale the stage proportionally first. Use a 2×2 grid only when four readable cards cannot fit without overlap. The project currently favors landscape orientation; preserve its rotate-device behavior.

### 3. Visual direction

Replace the cold blue sci-fi lobby treatment with an original premium Vietnamese festival style:

- Background: deep burgundy, oxblood, black-red, dark lacquered wood, and subtle temple architecture.
- Primary metallic accents: antique gold, warm champagne gold, and bronze.
- Supporting colors: ivory, ember orange, jade accents, and small magenta highlights.
- Lighting: warm center glow, dark vignette at the edges, moving dust, soft smoke, sparks, and occasional lens glints.
- Materials: polished metal, lacquer, engraved borders, glass highlights, and layered paper-cut cloud motifs.
- Typography: continue using the existing `Be Vietnam Pro` for readable Vietnamese labels. The existing display face may be retained for decorative headings if it remains legible.
- Keep the product clearly branded as Bầu Cua Victory. Do not display SUNWIN names or logos.

Use design tokens rather than scattering raw values throughout components. Suggested starting tokens:

```css
:root {
  --hub-bg-0: #120302;
  --hub-bg-1: #2a0705;
  --hub-surface: rgba(47, 10, 13, 0.90);
  --hub-surface-strong: #3d0c0b;
  --hub-gold-light: #fff0ad;
  --hub-gold: #e9b949;
  --hub-gold-dark: #8b4d16;
  --hub-crimson: #a71920;
  --hub-magenta: #a52aa7;
  --hub-ivory: #fff6dc;
  --hub-muted: #d8c69b;
  --hub-danger: #ef3e43;
  --hub-focus: #fff3a0;
}
```

Adjust tokens after testing real contrast. Normal-size text must retain at least 4.5:1 contrast. Functional icon boundaries and focus indicators must retain at least 3:1 contrast.

### 4. Four animated feature cards

The cards must feel like animated game posters, not ordinary dashboard tiles. Every card needs:

- A 4:5 or similar portrait composition.
- A multi-layer gold frame with rounded corners.
- A dark translucent top gloss.
- Character/object artwork occupying the upper 65–75%.
- The Vietnamese label anchored at the bottom and always readable.
- A subtle floor shadow.
- A clear hover/focus/pressed state.
- A semantic `<button>` or equivalent accessible control, not a clickable generic `<div>`.
- A minimum 48×48 px interactive target even after responsive scaling.

Do not make all four loops peak at the same time. Offset their timelines by 300–900 ms so the hub feels alive instead of mechanically synchronized.

#### Card 1 — Chơi nhanh / Golden Dragon

Artwork:

- A frontal golden dragon bust.
- Two floating energy pearls, one red-gold and one blue-jade.
- White-blue cloud or mist at the base.
- A warm circular aura behind the head.

Idle loop, approximately 3–4 seconds:

- Scale the dragon from about 0.98 to 1.025 and back to simulate breathing.
- Move the head forward and backward by only a few pixels.
- Pulse light from the horns down across the face.
- Add a short eye/mouth flash at the loop climax.
- Let whiskers lag slightly behind the head motion.
- Orbit the two pearls on small opposite elliptical paths.
- Move mist laterally across the lower foreground.
- Add a few controlled star glints; do not create constant visual noise.

Functional behavior:

- Use the existing quick-entry capability if one exists.
- If the server only supports room creation, reuse that safe flow as the initial Quick Play behavior.
- Do not invent a matchmaking endpoint.
- Show a loading/connecting state and prevent duplicate activation.

#### Card 2 — Chơi với bạn / Twin Festival Lions

Artwork:

- Two original red-white-gold lion-dance mascots representing friends.
- A shared bowl/tray and existing Bầu Cua dice in front.
- Coins and ribbon accents behind them.

Idle loop, approximately 3–4 seconds:

- Alternate the two lions' head bobs rather than moving them together.
- Add small ear, mane, and tassel follow-through.
- Briefly open a mouth or flash the eyes at the motion climax.
- Reuse existing Bầu Cua dice images as independent layers: toss, rotate, and land them back in the tray.
- Orbit several coins on two elliptical paths.
- Emit a small gold flash when the dice land.

Functional behavior:

- Open the existing create/join friend-room flow.
- Reuse current nickname, room-code, validation, Socket.IO, status, and error handling.
- Do not duplicate or rewrite the room protocol.
- Keep room codes copyable and readable.

#### Card 3 — Chọn bàn / Golden Bầu Cua Table

Artwork:

- A premium gold-edged Bầu Cua table or tray viewed from a slightly elevated angle.
- Existing Bầu Cua symbols/dice positioned above the table.
- Seat lights or table slots indicating availability.
- Gold rays and small sparks behind the table.

Idle loop, approximately 3.5–5 seconds:

- Sweep a soft light across the table rim.
- Float the Bầu Cua dice slightly, then settle them.
- Illuminate available table/seat markers in a slow sequence.
- Rotate a thin gold ring below the table.
- Add restrained coin and sparkle particles.

Functional behavior:

- Open a table/room-selection panel if a real room-list source exists.
- Each table item should expose table name/code, player count, capacity, status, and join action.
- If the backend does not expose a table list, create the UI adapter and an honest empty/unavailable state. Do not fabricate live tables, player counts, or network responses.

#### Card 4 — Game khác / Fire Phoenix

Artwork:

- An original golden-orange phoenix in front of a deep red sun.
- Layered wings with ember edges.
- A long fire trail and glowing tail feathers.

Idle loop, approximately 4–5 seconds:

1. The phoenix enters or leans from one side with wings partially closed.
2. Wings transition through mid-spread to full-spread poses.
3. The sun aura brightens behind the phoenix.
4. The outer feathers partially dissolve into embers.
5. Embers gather back into the bird before the loop restarts.

The artwork must remain inside the card frame. Fire may overlap the title area briefly, but the label must never become unreadable for more than 400 ms.

Functional behavior:

- Open the existing game-selection route or modal if it exists.
- Otherwise show an original, polished `Sắp ra mắt` panel without fake playable games.

### 5. Card interaction behavior

- Hover/focus: card rises 4–6 px, border glow increases, artwork moves forward by 2–3%, and a single highlight sweeps across the frame.
- Press: card compresses to about 0.985 scale for 80–120 ms without shifting surrounding layout.
- Keyboard: Tab focuses cards in their visual order; Enter and Space activate them.
- Focus ring: clearly visible gold/ivory ring outside the frame.
- Loading: keep label visible, add an inline loader, set `aria-busy="true"`, and block repeat actions.
- Disabled/unavailable: lower saturation and display an explicit message; never leave a button looking active but nonfunctional.

### 6. Bottom navigation remapping

Build a five-action ornamental bottom rail. Preserve the current center `Giải đấu` feature if it exists and keep the two right-side features exactly as requested.

#### Left item 1 — Thêm bạn

This replaces `Crypto`.

- Use a consistent SVG person-plus icon, not an emoji.
- Label: `Thêm bạn`.
- Open an add-friend panel or reuse an existing player-invite system.
- If no friend backend exists, create a clear integration boundary and an honest unavailable/coming-soon state. Do not create fake friends.

#### Left item 2 — Nhận quà

This replaces `Idol`.

- Use a consistent SVG gift icon with a small play/video badge.
- Label: `Nhận quà`.
- Purpose: watch a rewarded advertisement and receive an in-game reward.
- Show a numeric badge only when a real reward is available; never hardcode a fake count.
- Optional cooldown text must come from actual state, not a decorative timer.

Required rewarded-ad state machine:

```text
idle -> loading_ad -> playing_ad -> completed -> granting_reward -> success
                    -> cancelled
                    -> error
success -> cooldown -> idle
```

Rules:

- Grant a reward only after a trusted ad-completion callback or server confirmation.
- Never grant a reward merely because the modal was opened or a timer elapsed.
- Prevent duplicate completion events and repeated rapid clicks.
- Keep the reward amount and cooldown server-authoritative when a backend exists.
- If no ad SDK is configured, implement an adapter interface and show a disabled explanatory state in production.
- A development-only mock may exist behind an explicit dev flag; it must never run silently in production.
- Respect mute/sound settings and return focus to the reward button when the ad/modal closes.

#### Center item — Giải đấu

- Preserve the existing tournament behavior, badge, timer, alert marker, and routing.
- It remains the visual center and may be 15–25% larger than the four side actions.
- Do not replace it with a download-app button.

#### Right item 1 — Cảnh báo

- Preserve its current behavior, data, and label.
- Keep it on the right side of the center tournament item.
- Retain its live/status badge if backed by real state.

#### Right item 2 — Live Chat

- Preserve existing chat behavior and place it at the far-right edge.
- Keep unread counts data-driven.
- Retain accessible labels, keyboard focus, sanitization, rate limiting, and any Socket.IO events already in use.

### 7. Animation implementation requirements

Use layered animation rather than scaling one flattened screenshot:

- `character` layer.
- `foreground props` layer.
- `glow/aura` layer.
- `particle` layer.
- `mist/fire` layer.
- `label/frame` layer, which must stay stable for readability.

Preferred implementation for the current stack:

- CSS transforms and opacity for predictable loops.
- Web Animations API for timeline offsets or state-driven sequences.
- A small canvas only for bounded particles if DOM particles are insufficient.
- Use `requestAnimationFrame` only when needed and cancel it when the view unmounts/hides.
- Do not animate layout properties such as width, height, top, or left every frame.
- Use `transform`, `opacity`, and sprite background positions.
- Cap active particle counts and reuse particle nodes.
- Pause nonessential animation when `document.hidden` is true.
- Pause card loops when the hub is not visible.

Do not add GSAP, Spine, Lottie, or a WebGL engine unless the repository already contains it or there is a measured reason that native browser APIs cannot meet the requirement. If a new dependency is truly necessary, explain the bundle-size and maintenance cost before adding it.

### 8. Reduced motion and animation priority

Because four cards animate simultaneously, control attention carefully:

- At rest, each card has one dominant animation and up to two subtle supporting effects.
- Do not run maximum-intensity effects continuously.
- Stagger climax moments so only one card is visually dominant at a time.
- On hover/focus, increase only the selected card's intensity and reduce nearby particle intensity slightly.
- Under `prefers-reduced-motion: reduce`, disable parallax, sprite flapping, orbiting, tossing, and repeated scaling. Render stable final poses with a very slow opacity/glow change or no motion.
- Provide a user-facing animation toggle in settings if the existing settings panel can host it cleanly.

### 9. Responsive requirements

Validate at minimum:

- 1920×1080 desktop.
- 1440×900 laptop.
- 1024×768 tablet landscape.
- 844×390 phone landscape.
- 667×375 small phone landscape.

Requirements:

- Respect safe-area insets.
- Keep the bottom rail above the gesture/home area.
- Never allow cards to overlap the bottom rail.
- Avoid horizontal page scrolling.
- Keep all labels at least 12 px after scaling; prefer 14–18 px depending on viewport.
- Maintain touch targets of at least 48×48 CSS pixels.
- Crop decorative artwork before shrinking functional controls below safe sizes.
- If the viewport is portrait, retain the existing rotate-device prompt instead of forcing a broken compressed hub.

### 10. Performance budget

- Target 60 FPS on desktop and mid-range landscape mobile devices.
- Keep initial interaction available before all decorative animation assets finish loading.
- Display stable poster/fallback artwork while animated layers preload.
- Use WebP/AVIF for opaque backgrounds and optimized transparent WebP/PNG where alpha is needed.
- Reserve card and image dimensions to prevent layout shift.
- Lazy-load secondary artwork for unopened panels.
- Avoid autoplay video loops for the four cards.
- Do not decode all high-resolution frames on the main thread at once.
- Ensure cleanup of timers, animation frames, observers, and event listeners.

### 11. Asset policy

First reuse suitable existing assets from `public/assets/arena/`, especially:

- Existing logo artwork.
- Existing Bầu Cua symbol and dice artwork.
- Existing clean betting-table artwork when it fits the new table card.
- Existing audio controls and functional icons when stylistically consistent.

Do not stretch low-resolution images or reuse unrelated art merely to avoid requesting a new asset. Use the paths specified in the Asset Rendering Pack below for missing hero artwork. Until those assets are supplied, implement stable placeholders with correct dimensions and preserve the intended layer structure.

Do not use copyrighted SUNWIN assets or screenshots as production assets.

### 12. Accessibility and UI quality

- Use real buttons and semantic landmarks.
- All icon-only controls require an accessible name.
- Decorative images must use empty alt text and `aria-hidden="true"` where appropriate.
- Visible Vietnamese labels must not be replaced by accessibility-only text.
- Do not use emoji as structural icons.
- Preserve visible keyboard focus.
- Do not rely on color alone for disabled, warning, unread, or selected states.
- Tooltips must not be the only way to understand an action.
- Modal panels must trap focus, close with Escape, restore focus, and use a readable scrim.
- Status and reward feedback should use existing live regions or suitable `aria-live` handling without repeated announcements from looping animations.

### 13. Implementation sequence

1. Audit existing flow and assets.
2. Present a concise file-level implementation plan.
3. Add the post-login hub markup while preserving existing IDs/contracts.
4. Implement responsive layout and design tokens.
5. Implement the four card animation systems with fallback posters.
6. Wire each card to real existing actions or honest integration adapters.
7. Remap the bottom navigation exactly as specified.
8. Implement the rewarded-ad state machine without fake rewards.
9. Add reduced-motion, focus, loading, disabled, and error states.
10. Run existing tests plus build and browser checks.
11. Fix console errors and animation cleanup issues.

### 14. Acceptance criteria

The work is complete only when:

- The hub contains exactly four main cards in the requested order.
- The four cards are visibly animated and have distinct motion identities.
- `Crypto` has been replaced by `Thêm bạn`.
- `Idol` has been replaced by `Nhận quà` with a safe rewarded-ad flow.
- `Giải đấu` remains the center action.
- `Cảnh báo` and `Live Chat` remain on the right and retain their current behavior.
- Existing Bầu Cua gameplay, room state, Socket.IO events, betting, chat, history, settings, sound, and fullscreen behavior still work.
- No fake rooms, fake friend data, fake reward counts, or fake ad completion is presented as real.
- The design works on the listed landscape sizes.
- Keyboard focus and reduced-motion behavior are verified.
- There are no new console errors, broken network calls, duplicated listeners, or uncleaned animation loops.
- The final result contains no SUNWIN branding or copied proprietary assets.

At completion, report:

1. Files changed.
2. Existing logic reused for each card.
3. Missing backend integrations, if any.
4. Missing artwork still using placeholders.
5. Build/test results.
6. Responsive and reduced-motion checks performed.

---

## Asset Rendering Pack

Render only the assets Antigravity confirms are missing after its asset audit. Do not render text, labels, logos, buttons, borders, or full UI screenshots inside the character artwork. UI text and frames must remain HTML/CSS so they stay responsive and accessible.

### Shared art direction for all rendered assets

Append the following visual direction to every asset prompt:

```text
Original premium Vietnamese Lunar New Year game art, cinematic 3D illustration with polished hand-painted detail, deep crimson and antique-gold palette, warm rim lighting, strong readable silhouette, luxurious lacquer and engraved-metal materials, high contrast designed for a mobile game card, no brand logo, no words, no letters, no numbers, no watermark, no casino brand references, no UI frame, no button, no cropped head, no duplicate limbs, production-quality game asset.
```

### Asset A — Main hub background

Suggested file: `public/assets/hub/hub-background.webp`

Target: 1920×1080, opaque landscape image.

```text
A wide 16:9 empty ceremonial hall for a premium Vietnamese Bầu Cua game lobby, symmetrical dark red lacquer architecture, subtle carved cloud patterns, distant columns and hanging lantern silhouettes, a soft golden spotlight centered on an empty floor, dark vignette around all edges, faint red mist, tiny warm dust motes and restrained ember particles, plenty of uncluttered negative space in the middle for four tall menu cards, a darker clean strip along the bottom for navigation, no people, no animals, no cards, no table, no interface, no text. Original premium Vietnamese Lunar New Year game art, cinematic 3D illustration with polished hand-painted detail, deep crimson and antique-gold palette, warm rim lighting, luxurious lacquer materials, no logo, no words, no watermark.
```

### Asset B — Quick Play golden dragon

Suggested file: `public/assets/hub/quick-play-dragon.png`

Target: transparent PNG/WebP, portrait-safe composition, at least 1400×1800.

```text
An original majestic Vietnamese-inspired golden dragon bust viewed almost front-on, fierce but welcoming expression, long symmetrical horns, flowing whiskers with clear separation from the face, layered gold scales, glowing amber eyes, mouth slightly open, upper body forming a compact vertical S-curve, designed as the central hero of a tall 4:5 mobile game card, full head horns whiskers and upper torso visible, clean transparent background, no aura, no orb, no smoke, no particles, no platform, no frame, no text. Original premium Vietnamese Lunar New Year game art, cinematic 3D illustration with polished hand-painted detail, deep crimson and antique-gold palette, warm rim lighting, strong readable silhouette, no logo, no watermark.
```

### Asset C — Play With Friends twin lions

Suggested file: `public/assets/hub/play-with-friends-lions.png`

Target: transparent PNG/WebP, portrait-safe composition, at least 1600×1800.

```text
Two original Vietnamese lion-dance mascots posed together as cheerful friends, one slightly taller red-white-gold lion and one smaller crimson-jade-gold lion, expressive faces, open friendly mouths, bright eyes, detailed fur curls, ears and tassels clearly separated for animation, both leaning toward a shared center while leaving clean space below for a dice tray, full heads and upper bodies visible, balanced portrait composition for a tall 4:5 mobile game card, transparent background, no dice, no coins, no platform, no UI frame, no text. Original premium Vietnamese Lunar New Year game art, cinematic 3D illustration with polished hand-painted detail, deep crimson and antique-gold palette, warm rim lighting, strong readable silhouettes, no logo, no watermark.
```

### Asset D — Choose Table centerpiece

Render this only if the existing `main-betting-table-clean.png` cannot be adapted.

Suggested file: `public/assets/hub/choose-table-centerpiece.png`

Target: transparent PNG/WebP, at least 1600×1400.

```text
A premium oval Bầu Cua game table viewed from a slightly elevated front angle, dark red lacquer and deep jade felt, ornate antique-gold rim, six subtle empty betting positions inspired by the traditional Bầu Cua symbols but containing no written labels, three blank ivory dice hovering just above a central gold tray, elegant radial light rays behind the table, compact centered composition for a tall mobile game card, transparent background, no people, no chairs extending outside the composition, no coins, no text, no UI frame. Original premium Vietnamese Lunar New Year game art, cinematic 3D illustration with polished hand-painted detail, deep crimson jade and antique-gold palette, warm rim lighting, no logo, no watermark.
```

Use the project's existing Bầu Cua symbol textures on the dice in code or during final compositing so the symbol identity remains consistent with the game.

### Asset E — Fire phoenix sprite sheet

Suggested file: `public/assets/hub/other-games-phoenix-sheet.png`

Target: transparent PNG sprite sheet, four equal horizontal cells, preferably 4096×1536. Each cell must use the same phoenix identity, camera, scale, color, and anchor point.

```text
A four-frame horizontal sprite sheet of one identical original golden-orange phoenix for a premium mobile game card, transparent background and four equal cells with generous padding. Frame 1: side-facing phoenix with wings mostly closed. Frame 2: wings half open. Frame 3: wings fully spread in a powerful upward arc. Frame 4: wings returning toward half closed with the outer tail feathers breaking into a few glowing embers. Keep the phoenix body center, head position, scale, camera angle, feather design and color identity consistent across all four cells. Long elegant fire tail contained inside each cell, no frame overlap, no red sun, no smoke background, no text, no UI, no labels. Original premium Vietnamese Lunar New Year game art, cinematic 3D illustration with polished hand-painted detail, gold orange crimson fire palette, warm rim lighting, strong readable silhouette, no logo, no watermark.
```

If the image model cannot keep the four frames consistent, render the four poses separately with the same seed/reference image and filenames:

- `phoenix-01-closed.png`
- `phoenix-02-mid.png`
- `phoenix-03-open.png`
- `phoenix-04-embers.png`

### Asset F — Optional foreground cloud strip

Suggested file: `public/assets/hub/card-cloud-strip.png`

Target: transparent PNG/WebP, wide 2048×512.

```text
A seamless horizontal foreground strip of stylized white-blue ceremonial clouds and very soft mist, delicate pale-gold edge highlights, transparent background, low vertical profile, designed to drift slowly across the bottom quarter of a premium game card, no animals, no objects, no symbols, no text, no frame, no watermark.
```

### Asset preparation requirements

After receiving the renders, Antigravity must:

1. Remove empty padding only when it does not break the intended anchor point.
2. Export optimized production derivatives while preserving the original source files.
3. Use explicit width/height or aspect-ratio declarations to prevent layout shift.
4. Create static poster states for failed loading and reduced motion.
5. Keep glow, orbs, coins, sparks, dice, mist, and the red sun as separate code-controlled layers whenever possible.
6. Never bake Vietnamese labels into the rendered art.

