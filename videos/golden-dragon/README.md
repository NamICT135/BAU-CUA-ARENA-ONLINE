# Golden dragon — five-second lobby loop

Single fixed-camera, silent 2.5D composition for the quick-play card. Original character pixels are preserved; movement is produced by bounded regional texture displacement, local illumination, smoke, water surges, and lightning. This is not a new 3D character rig or a generative image-to-video clip.

## Files

- `index.html`: 576 × 800, exactly 5 seconds, registered paused GSAP timeline.
- `dragon-renderer.js`: deterministic WebGL character/water surface and Canvas atmosphere.
- `assets/reference.png`: first user attachment, preserved unchanged.
- `assets/clean-water-plate.png`: built-in ImageGen cleanup. Only water and edge repair are sampled; its regenerated face is deliberately not used.
- `qa/contact-sheet.png`: start, buildup, peak, recovery, end.
- `qa/verification.json`: exact seam and reverse-seeking checks.
- `../../public/assets/hub/quick-play-dragon-loop.webm`: preferred VP9 delivery, 486,896 bytes.
- `../../public/assets/hub/quick-play-dragon-loop.mp4`: H.264 fallback, 3,108,561 bytes.
- `../../public/assets/hub/quick-play-dragon-poster.webp`: still fallback.

The source character is 259 × 359 pixels. It is suitable for the approximately 240-pixel desktop card; a larger video frame does not add real detail to that character.

## Reproduce

Use Node 22+ and FFmpeg/FFprobe on PATH. The project pins HyperFrames 0.8.76.

```sh
npm run check
npm run dev
npm run render -- --fps 30 --quality delivery --crf 17 --workers 1 --output ../../public/assets/hub/quick-play-dragon-loop.mp4
```

`scripts/verify-composition.cjs` additionally needs Playwright, Chrome, and Sharp. Start the repository Vite server on port 5179, or set `DRAGON_COMPOSITION_URL` to the local composition URL. This script checks pixel-identical 0/5-second frames, a near-identical final encoded-frame time, reproducible backward seeking, and visible peak movement. `NODE_PATH` can point to the Codex bundled Node packages.

## Web playback

The game serves encoded video, not the live shader. `src/dragon-video.js` prefers VP9 WebM when supported, reducing the video payload by 84.3%. An unsupported or failed WebM falls back to H.264 MP4; a final media error reveals the poster. The web app enters the hub directly and plays the five-second source at 2.5× speed, producing a two-second seamless cycle. It pauses when the hub, card, or browser document is hidden. The dragon card is explicitly marked as required motion, so it continues to play when the browser requests reduced motion; other decorative lobby animation remains reduced. Playback has no audio and never blocks the quick-play action. The production server supplies video MIME types and streams byte ranges for browser seeking. Existing other game-card art and game logic are retained.

Create the WebM derivative from the rendered MP4:

```sh
ffmpeg -i public/assets/hub/quick-play-dragon-loop.mp4 -an -c:v libvpx-vp9 -b:v 0 -crf 32 -deadline good -cpu-used 2 -row-mt 1 -threads 4 -g 150 -pix_fmt yuv420p -map_metadata -1 public/assets/hub/quick-play-dragon-loop.webm
```

Run that command from the repository root. Both delivery files are silent 576 × 800, 30 fps, 150-frame loops. The derivative retains an SSIM of 0.974642 against the MP4 and was visually reviewed at the actual card size.

## Verification

HyperFrames check: no errors or warnings. Lossless composition frames at 0 and 5 seconds are pixel-identical; reverse seeking is deterministic. Both encoded formats have 150 frames / 5.000 seconds and no audio. Lossy encoding introduces a small first/last-frame pixel difference, measured in `qa/video-verification.json` and `qa/webm-verification.json`; it does not change loop timing. WebM's seam difference at 240-pixel card width is 0.707 mean channel levels out of 255.

The real production build passes Chrome checks for desktop and landscape phone layouts, delayed loading, preferred WebM playback, failed-WebM MP4 fallback, reduced-motion no-download behavior, offscreen pause/resume, final-error poster fallback, and unobstructed quick-play clicks. The four-card row fits the existing arcade viewport on narrow screens. App production build and all 21 tests pass, including production MIME, HEAD, partial-range, suffix-range, and unsatisfiable-range behavior.

After `npm run build`, run `node videos/golden-dragon/scripts/verify-production.mjs` from the repository root with Playwright available. It starts and closes its own isolated production server. Run `scripts/verify-video.cjs --webm` for the compressed delivery check (requires Sharp and FFmpeg/FFprobe, optionally via `FFMPEG_BIN`). Safari and physical phones have not been tested.

## Asset preparation prompt

Built-in ImageGen edit of the first attachment:

> EDIT THIS EXACT IMAGE, DO NOT REDESIGN. Prepare this golden Asian dragon illustration for layered animation in a premium Vietnamese game card. Preserve the exact dragon face, eyes, open mouth, teeth, horns, whiskers, mane, golden scales, red lantern on viewer left and blue lantern on viewer right, the moon and dark background, exact original pose and camera composition. Remove ONLY the large SUNCA letters and all small logo/crown decorations in the lower water area, reconstructing believable continuous turquoise dark-blue water underneath. Remove the thin rounded outer card border, continuing the adjacent existing background into it. Keep the dragon geometry and position unchanged. No new dragon, no new horns or limbs, no invented face details, no text. Upscale cleanly if possible but absolute reference fidelity is more important than adding detail. Output a single clean portrait artwork with the original aspect ratio and same framing.

The result was inspected and restricted to water/edge repair to preserve the original character. No audio, stock media, or external video provider was used.
