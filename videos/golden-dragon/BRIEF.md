---
workflow: general-video
flow: automation
storyboard: no
message: A majestic golden guardian unleashes a powerful five-second roar in the Bầu Cua lobby.
destination: web lobby quick-play card
aspect: portrait
language: vi
length: 5s
---

## Intent
User requests creation, with the stronger intensity of the initial prompt. One fixed-camera scene: charge 0–1s, build 1–2.5s, peak 2.5–3.5s, recover 3.5–4.5s, seamless return 4.5–5s. No sound, no text, no camera movement, no redesigned anatomy.

## Assets
Reference: first attachment (277c9a51). The second attachment is visual context only, not a morph target. Original pixels anchor the face. ImageGen removes lettering and border for a clean water/background plate; original character texture is preserved in the animation wherever possible.

## Decisions
Automated creation and local rendering are implied by the user's request to create the supplied complete specification. No publication. Use a deterministic layered 2.5D treatment, not claim generated volumetric character motion. Keep existing web game behavior and labels. Original source is low resolution; higher output resolution cannot restore original detail.

## Design
Golden dragon is the dominant subject. Warm red/amber lantern on the left, original blue lantern on the right, dark moonlit background, turquoise water. Localized bright eyes, metallic glints, smoky breath, outward surges, brief overhead lightning. No global exposure pulses. No fonts or text in the exported asset. Face remains readable at the actual card size.

## Motion
Adapt particle-burst for deterministic spray, center-outward-expansion for water impulses, and attack/sustain/release glow envelopes for eyes. Secondary follow-through in whiskers, mane, and lanterns. Every state is a pure function of loop time; exact t=0 and t=5 match.

## Deliverables
Editable HyperFrames composition, rendered 5-second WebM with MP4 fallback, clean poster, QA frames, and local web integration with muted inline playback. The web app now bypasses the former outer entry screen and opens directly in the hub. The source is played at 2.5× for a two-second loop. User explicitly requires the dragon animation to remain active in the lobby, including when the browser reports reduced motion; other decorative lobby motion still respects that preference. Delivery includes production video serving, byte ranges, and browser fallback verification.

The quick-play video fills the complete card with no black footer. “Chơi nhanh / Vào bàn ngay” is overlaid inside the water in a gold dimensional wordmark treatment inspired by the supplied SUN CÁ reference, with a two-second gradient sweep and restrained glow synchronized to the accelerated dragon loop.
