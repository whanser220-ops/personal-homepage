# Afternoon room — inset water basin

The homepage uses a Blender-built cafe rendered by Three.js. The character is an alpha illustration inside a volumetric environment. Loading uses the page's plain background; no static illustration is displayed on refresh.

## Model

- `afternoon-room.blend`: editable source; texture images live in `textures/`.
- `../../public/assets/home-scene/afternoon-room.glb`: runtime model with the original four embedded WebP textures (character, warm paper atlas, brick and whitewashed wood).
- `../../scripts/build-home-scene.py`: complete deterministic scene builder.
- `../../scripts/build-inset-counter.py`: replaces the old counter and raised fruit tank with a real opening, four stone slab segments, a porcelain basin and a recessed glass observation window. No fruit geometry remains.
- `../../scripts/update-inset-counter-mcp.py`: incrementally updates the saved scene through Blender MCP without rebuilding the wall and foliage.
- `../../scripts/detail-cafe-scene.py`: preserves the original paper/brick/cabinet mapping and builds a blue enamel music player on the right-hand dry countertop.
- `../../scripts/update-cafe-details-mcp.py`: updates those details in the saved scene through Blender MCP.

Water level is 4.43, below the tabletop at 4.55; the basin floor is at 2.40 (world up). It is a horizontal pool, not a tilted billboard. The camera looks down slightly so the surface is visible. The original cups sit on the dry counter at the right.

## Water rendering

`src/lib/home-scene/createInsetWater.js` and `waterFields.js` implement a browser adaptation of the techniques discussed in the supplied article:

1. A locally generated, divergence-free flow map determines circulation.
2. Compact directional wave packets are baked into a tileable height/gradient texture. Three resolutions are advected by the flow map. Two phases crossfade so resetting UV advection does not visibly snap. The same field drives vertex displacement and surface normals.
3. Separate reflection and refraction render targets. A mirrored orthographic camera clips geometry below the surface; depth-tested refraction avoids sampling foreground counter pixels.
4. Fresnel reflectance controls reflection versus transmission. Scene depth and an absorption lookup texture control transmitted color, combined with a scattering approximation.
5. Small moving caustics on actual basin geometry, specular glints, and a restrained boundary meniscus. There are no fruit, large bubbles, decorative star sprites or freestanding glass walls above the counter.

This adapts the flow/displacement/shading approach to a quiet contained basin. It does not reproduce Naughty Dog's full water engine, offline river-fluid pipeline or ocean LOD system. The numeric maps are generated in code; no additional bitmap artwork is required.

### References

- User reference: [真实感水体渲染技术总结](https://zhuanlan.zhihu.com/p/95917609), sections 4.3.1, 4.5.1.1, 4.5.1.3 and 5.1.1.
- Primary presentation: [Rendering Rapids in Uncharted 4 — Carlos Gonzalez-Ochoa, SIGGRAPH 2016](https://advances.realtimerendering.com/s2016/).
- Primary presentation: [Water Technology of Uncharted — GDC 2012](https://www.gdcvault.com/play/1015517/Water-Technology-of).

## Rebuild

Open a dedicated Blender 5.2 session with the MCP addon listening on port 9876. The full builder replaces that Blender session's scene.

```powershell
# Full rebuild:
uv run --with mcp-for-blender python scripts/export-home-scene-mcp.py

# Counter-only update with afternoon-room.blend already open:
uv run --with mcp-for-blender python scripts/update-inset-counter-mcp.py

npm run build
```

Use `uv run --with mcp-for-blender python scripts/update-cafe-details-mcp.py` for a materials/player-only update. Export validation checks four essential textured materials, the water surface, the radio, and absence of fruit nodes. The incremental update resolves source textures and saves relative paths explicitly.

## Camera, paper and desktop music

The camera is fixed; there are no pointer-motion listeners or interpolated camera offsets. Resize alone adjusts the framing. Paper uses the original warm 4-by-4 atlas, with neutral scalar light/shade and no position-dependent tint that could split a sheet into yellow and white regions. Wall and counter textures and UV scales remain unchanged. The radio grille uses a fine procedural weave without introducing another image texture.

The Blender radio is real scene geometry, with accessible React controls projected onto its front. Its center is at world X=3.85 on the dry right slab, with matching controls. Portrait framing includes both basin and radio, and the settings panel opens inward. Click to start/pause the original Web Audio ambient melody. Settings expose volume and an optional local audio file; files are only read by an object URL in the browser, never uploaded. Audio is opt-in, pauses when the page is hidden, and is disposed on navigation.

## Transparent iced coffee

Only the tabletop espresso cup is replaced; the character's illustrated takeaway cup is unchanged. `scripts/build-iced-coffee.py` builds a genuinely open glass with a thick base, a closed liquid volume with a meniscus, and four beveled ice cubes. It is included in both full and incremental Blender MCP builds. The cup stands next to the radio at world (5.55, 4.56, 3.25); portrait framing includes its whole silhouette.

`src/lib/home-scene/createIcedCoffee.js` adapts the separate-layer technique from [关于星穹铁道调酒效果(分层液体瓶)的复刻尝试——RenderFeature版](https://zhuanlan.zhihu.com/p/696460056):

1. Render the scene background with its depth, preserving MSAA.
2. Render the yellow/white liquid and ice into independent color/depth targets, without blending their alpha into clear pixels first.
3. Ice uses RG for view-normal XY, B for highlight and A for opacity, avoiding integer bit-packing and its quantization problems.
4. Sample distorted background/liquid colors but retain original depths; sort the three layers per pixel from far to near and blend. Add a small ice/liquid intersection highlight.
5. Copy composite color and depth, then render the actual glass shell with Fresnel edge reflection, depth-guarded refraction, clear rim and base highlights.

Liquid and ice targets cover only the projected cup rectangle, capped at 512 pixels per axis. The scene background and composite use full resolution. Targets, proxy materials and shared geometry are disposed on navigation. The basin reflection uses simplified transparent drink proxies; the main-view drink uses the depth-sorted passes. As in the reference's nearest-layer approach, this is not full depth peeling for arbitrarily many overlapping transparent ice surfaces.

The liquid now has bounded vertex displacement for sloshing and a traveling yellow/white boundary. Top normals and highlights follow the deformation. Ice cubes bob and tilt by small amounts, with reflection proxies synchronized and capture bounds padded. Motion uses a clamped active-time clock, pauses with the page, and becomes static under reduced-motion preferences. The cup and camera stay fixed. This is a procedural contained-liquid approximation rather than a fluid solver. Ice opacity is at least 0.55; the glass has a visible pale-blue body, stronger Fresnel edges, broad reflection strips and brighter rim/base highlights.

Rendering pauses in hidden tabs and outside the viewport. Reduced-motion users get a static 3D scene. Offscreen passes use reduced resolution, and render targets and generated fields are disposed on navigation. The homepage still displays only the minimal welcome and the progressive exploration menu.
