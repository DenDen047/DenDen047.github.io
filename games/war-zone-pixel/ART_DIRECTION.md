# WARZONE: CHRONOFRONT — Art Direction

## World

**1947. The war ended everywhere except the Hourglass Front.**

An experimental “chronocore” shattered beneath an old forest and folded several
eras into the same battlefield. Four armies now fight over the fracture:
dieselpunk infantry and armour, a displaced samurai order, field engineers who
have learned to trap temporal echoes, and creatures born where time no longer
moves in one direction.

The visual world mixes worn 1940s field equipment, brass chronotech and haunted
forest folklore. The result should feel like one setting, not a collection of
unrelated military and fantasy pieces.

## Design pillars

1. **Readable before detailed** — Classes, teams and hazards must be legible at
   gameplay size and while moving.
2. **One material language** — Canvas, oxidised steel, dark wood, brass and pale
   anomaly light recur across characters, props and UI.
3. **Backgrounds recede** — Ground and scenery use lower saturation and contrast.
   Characters, pickups, muzzle flashes and threats receive the brightest values.
4. **Colour plus shape** — Team colour is reinforced by a rim, badge and marker;
   no essential team information relies on colour alone.
5. **Crisp pixels, modern feedback** — Nearest-neighbour art, pixel-snapped
   camera positions and restrained screen shake coexist with readable HUD motion.

## Reference findings

- Valve’s *Illustrative Rendering in Team Fortress 2* validates classes in
  silhouette, omits high-frequency detail and uses rim emphasis for readability.
  <https://www.teamfortress.com/publications/ill/ill.pdf>
- Riot’s VALORANT rendering notes separate characters from environments using
  friend-or-foe rim lighting and preserve gameplay-relevant clarity at distance.
  <https://www.riotgames.com/en/news/valorant-shaders-and-gameplay-clarity>
- Unity’s pixel-perfect guidance recommends a low reference resolution,
  nearest-neighbour upscaling and pixel snapping so pixels stay uniform.
  <https://unity.com/blog/games/2d-pixel-perfect-how-to-set-up-your-unity-project-for-retro-8-bits-games>
- Lazy Bear Games’ pixel-art guide keeps consistent material palettes and dark,
  opaque outlines across objects.
  <https://www.gamedeveloper.com/production/punch-club-s-guide-to-pixel-art>
- Game Accessibility Guidelines warns against conveying essential information
  using a fixed colour alone.
  <https://gameaccessibilityguidelines.com/splatoon-colour-lock/>

## Pixel language

- Native sprite feel: 24–32 px character logic, enlarged to a 68–81 px gameplay
  silhouette with `imageSmoothingEnabled = false`. The silhouette, not an
  enlarged source preview, is the acceptance test.
- Outline: 2–3 source pixels, near-black green (`#151a16`), never pure black.
- Shading: one shadow and one highlight per material; no smooth gradients inside
  world sprites.
- Light: upper-left key light; shadows shift cool rather than simply to black.
- Silhouettes:
  - **Rifleman** — compact oval helmet, forward rifle, balanced rectangle.
  - **Ronin** — crescent helmet, wide shoulder plates, long katana diagonal.
  - **Sapper** — narrow hood, asymmetric satchel, coil and shovel.
  - **Gunner** — broad square torso, oversized shoulder launcher.
- Humanoid and animal art is a screen-upright billboard: it only flips left/right.
  Weapons rotate independently toward the true aim direction. This prevents a
  face, helmet or legs from ever appearing upside down.
- Top-down mechanical objects such as turrets may rotate because they have no
  semantic “up”; buildings and scenery never rotate.

## Screen-first scale contract

- A normal soldier occupies about 72 px of screen height; heavy and ronin
  silhouettes receive a small class-specific size increase.
- The weapon is a separate, high-contrast directional layer. Body pose communicates
  class; weapon angle communicates aim.
- Names and health bars sit outside the enlarged silhouette, never over the face.
- Ground tiles use only 3–5 broad colour regions per tile. Their contrast is
  reduced in the renderer so units, hazards and pickups remain the first read.
- Common props target 32–96 px on screen and use one unmistakable contour:
  square crate, low sandbag, round mine, X-shaped hedgehog, upright target.
- Readability is checked on the complete 1500×773 and 375×667 game views, not by
  judging source images in isolation.

## Master palette

| Role | Colour |
| --- | --- |
| Ink | `#151a16` |
| Deep smoke | `#252a24` |
| Field smoke | `#353a31` |
| Mud | `#514b37` |
| Canvas | `#8c8666` |
| Parchment | `#e3d8b4` |
| Brass shadow | `#8f6a2e` |
| Brass light | `#d5ac4a` |
| Anomaly cyan | `#69ddd3` |
| Danger ember | `#f29a4a` |
| Blood signal | `#da5447` |

Team accents remain blue, red, green and violet, but are applied as small high
contrast trims rather than repainting every material.

## Stage keys

- **Training Yard** — desaturated concrete, white chalk markings, clean targets.
- **Ash Front** — olive mud, ruined concrete, timber crates and burnt steel.
- **Glasswood** — blue-grey soil, cyan chronolight, brass time relics.
- **Black Briar** — near-black green, pale eyes, red hunt warnings.

## UI

- Dark field-radio panels with square clipped corners, brass focus borders and a
  faint scanline texture.
- Japanese copy stays highly readable; pixel styling comes from spacing, borders,
  iconography and colour, not from forcing a tiny decorative font.
- Menu cards show generated class portraits so selection is visual, not just text.
- Combat HUD keeps the existing information hierarchy and controls.

## Generated asset prompt family

All revision-two sprites use the built-in image generator and this shared ending:

> Original ultra-simple 16-bit pixel art made for actual 24–32 px gameplay size;
> chunky silhouette; no facial features or micro-detail; 5–7 colours; dark
> 2-pixel outline; screen-upright right-facing subject; one iconic shape per
> class or prop; isolated on a perfectly flat solid `#ff00ff` chroma-key
> background; no cast shadow, text, logo, watermark, gradients or extra objects.

Ground generation uses the same material palette but removes the chroma key:

> Seamless low-information 64×64 terrain tile; 3–5 large colour regions; no
> individual pebbles, grass blades, text, objects, highlights or focal point.
