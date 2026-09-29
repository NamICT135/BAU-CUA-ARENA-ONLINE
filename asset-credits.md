# Asset Credits & Motion Research Documentation

This document records the motion asset research, candidate evaluations, page-level licensing verification, and the motion strategy implemented for the **Bầu Cua Victory** Game Hub.

## 1. Candidate Motion Assets Researched (Lottie / Vector)

| Candidate Asset | Source URL | Page-Level License & Size | Evaluation & Technical Decision |
| :--- | :--- | :--- | :--- |
| **Dragon Animation** | [LottieFiles - Dragon](https://lottiefiles.com/free-animation/dragon-MQKdsTwtAl) | [Lottie Simple License](https://lottiefiles.com/page/license) (26.7 KB optimized dotLottie) | Evaluated for Chơi Nhanh card. Style is a modern stylized vector mascot that diverges from the Vietnamese imperial festival lacquer aesthetic established across the arena. Kept as reference; rejected in favor of project-generated original artwork with CSS motion to maintain art cohesion without adding external dotLottie runtime player dependencies. |
| **Lion Dance Animation** | [LottieFiles - Lunar New Year Lion Dance](https://lottiefiles.com/free-animation/lunar-new-year-lion-dance-QPzH27qlxL) | [Lottie Simple License](https://lottiefiles.com/page/license) (10.8 KB) | Evaluated for Bạn Bè card. Depicts a single cartoon lion character. Does not match the dual festive southern lion dance pair and luxury casino gold palette of the project. Rejected to avoid third-party runtime player dependencies and style clash. |
| **Phoenix Animation** | [LottieFiles - Phoenix](https://lottiefiles.com/free-animation/phoenix-DiowHl2M67) | [Lottie Simple License](https://lottiefiles.com/page/license) (216.1 KB optimized dotLottie) | Evaluated for Game Khác card. While dynamic, the payload (216 KB + player engine) is significantly heavier than pure CSS transforms, and its neon fantasy visual style conflicts with the imperial red/gold theme. |

### Licensing Context
- **Lottie Simple License** (`https://lottiefiles.com/page/license`): Grants a worldwide, non-exclusive, royalty-free license to use, download, modify, and distribute the animation in commercial and non-commercial products without attribution, subject to standard non-resale/redistribution as standalone stock restrictions.

## 2. Motion Implementation Strategy

As specified in the design guidelines (*"If no excellent licensed asset is found, keep the original artwork and create motion with CSS transforms, parallax, particles, light sweeps, and layered effects"*):

1. **Dragon Card (Chơi Nhanh)**:
   - Five-second silent HyperFrames video (`quick-play-dragon-loop.webm`, 487 KB), with H.264 MP4 and static poster fallbacks. The WebM is a local FFmpeg derivative of the rendered MP4.
   - User-provided dragon texture; built-in ImageGen cleanup used only for the water and outer edge repair.
   - Fixed camera, regional whisker/mane/lantern motion, eye light, smoke, outward water surges, metallic glints, and overhead lightning.
   - Pauses while hidden/offscreen and uses a still for reduced-motion preferences. Editable source and provenance: `videos/golden-dragon/`.
2. **Lion Dance Card (Bạn Bè)**:
   - Five-second silent HyperFrames loop (`friends-lion-loop.webm` with H.264 MP4 and WebP poster fallbacks).
   - User-supplied screen-recording frame supplies the lion pixels. No artwork or Spine package was extracted from the referenced third-party website.
   - Spine-style hierarchical cutout rig: rigid head parent, child jaw and eyebrow bones, independent mane halves and forearms. A generated underplate fills only the concealed gaps behind moving layers.
   - Three rigid Bầu Cua dice use the project's six existing symbol assets; deterministic gold rings, eye bloom, mist and coin bursts provide the power accents. Editable source: `videos/red-lion/`.
3. **Table Card (Chọn Bàn)**:
   - Hover and levitation perspective effect (`hub-table-hover`).
   - Floating lacquer bowl and dice tray.
4. **Phoenix Card (Game Khác)**:
   - Majestic wing breathing and fiery glow sweep (`hub-phoenix-wings`, `hub-phoenix-flare`).
   - Radial sun pulse accentuating the vermilion phoenix plumage.
5. **Background & Atmosphere**:
   - Parallax background subtle drift (`hub-bg-drift`).
   - Header logo gold shimmer sweep (`hub-logo-shimmer`).
   - Interactive canvas particle fireworks and golden dust that automatically pauses on `document.hidden` and respects `prefers-reduced-motion: reduce`.

## 3. Local Project Artwork Manifest

| Local Asset Path | Description | Provenance / Attribution |
| :--- | :--- | :--- |
| `public/assets/hub/hub-background.jpg` | Traditional Vietnamese festival palace interior | Project-generated original artwork |
| `public/assets/hub/quick-play-dragon.jpg` | Golden imperial dragon with jade orb | Project-generated original artwork |
| `public/assets/hub/play-with-friends-lions.jpg` | Festive Southern lion dance pair | Project-generated original artwork |
| `public/assets/hub/friends-lion-loop.webm` / `.mp4` | Rigged red lion card animation | Derived from a user-supplied screen-recording frame plus project Bầu Cua symbols; generated underplate is used only behind the separated rig layers |
| `public/assets/hub/choose-table-v1.jpg` | Lacquer table and luxury dice bowl | Project-generated original artwork |
| `public/assets/hub/other-games-phoenix-v1.jpg` | Vermilion fire phoenix rising | Project-generated original artwork |
| `public/assets/arena/logo1.png` | Bầu Cua Victory brand mark | Project asset |
| `public/assets/arena/*.png` | Gourd, Crab, Fish, Shrimp, Rooster, Deer symbols & dice faces | Project assets |
