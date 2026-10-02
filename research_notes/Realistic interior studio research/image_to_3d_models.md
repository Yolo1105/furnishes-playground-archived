# Image-to-3D models on fal.ai for single furniture pieces (GLB), as of 2 October 2026

Method note for the report writer: fal figures below were read from each endpoint's model page or its machine-readable `llms.txt` page on 2026-10-02. Pages were read through a summarising fetch tool, so quoted strings are as returned by that tool; prices and parameter names should be treated as accurate but re-checked on the live page before contract decisions. "Vendor claim" = stated by the model owner or by fal; "independent" = third party with no product in the comparison. Most 2026 comparison posts turned out to be vendor-authored; this is flagged per item.

## 1. Per model: version, fal endpoint, price incl. add-ons, generation time, formats, polygon controls

### Takeaway
fal lists about 24 image-to-3D endpoints; the realistic candidates fall into three price bands: cheap/fast ($0.07 to $0.375: TripoSR, Hunyuan Rapid, TRELLIS 2, Tripo H3.1 standard), mid ($0.40 to $0.825: Rodin v2.5, Hunyuan Pro with add-ons, Tripo H3.1 detailed, Hi3D v2.x) and premium ($1.00 to $9.10: Meshy 6/7.1, Tripo P2, Rodin + HighPack, Hi3D v3.0). Generation time is not published on fal's pages for most models; only TRELLIS.2 (3 to 60 s on H100) and Tripo H3.1 (about 40 s untextured, about 120 s textured) have primary-source timings.

### Cited Findings

**fal catalogue (what exists)**
- fal's image-to-3D category lists these endpoints: `hunyuan-3d/v3.1/pro/image-to-3d`, `trellis-2`, `tripo3d/h3.1/image-to-3d`, `trellis`, `hyper3d/rodin/v2.5`, `meshy/v7.1/image-to-3d` (marked new), `tripo3d/h3.1/multiview-to-3d`, `tripo3d/p2/image-to-3d` (marked new), `meshy/v7.1/multi-image-to-3d` (marked new), `hunyuan3d-v3/image-to-3d`, `sam-3/3d-objects`, `tripo3d/tripo/v2.5/image-to-3d`, `meshy/v6/image-to-3d`, `hyper3d/rodin`, `meshy/v7/image-to-3d`, `sam-3/3d-body`, `hyper3d/rodin/v2`, `trellis/multi`, `hunyuan3d/v2`, `hyper3d/rodin/v2.5/fast`, `hitem3d/hi3d/v3.0/image-to-3d`, `tripo3d/triposplat`, `hunyuan-3d/v3.1/rapid/image-to-3d`, `meshy/v6-preview/image-to-3d` — [fal explore, image-to-3d](https://fal.ai/explore/search?categories=image-to-3d)
- A web search summary reported "47 image-to-3D model results" on fal; only the 24 above were visible in the fetched page — [fal Image to 3D Model APIs](https://fal.ai/explore/image-to-3d-model-apis)
- ByteDance Seed3D was on fal (`fal-ai/bytedance/seed3d/image-to-3d`) but the endpoint is reported as deprecated/no longer supported (search-result summary, not confirmed by direct page fetch) — [fal Seed3D page](https://fal.ai/models/fal-ai/bytedance/seed3d/image-to-3d)

**Tencent Hunyuan3D v3.1 Pro — `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`**
- Price text: "Your request will cost $0.375 per generation. For $1.00, you can run this model 2 times. Enabling PBR materials adds $0.15. Using multi-view images adds $0.15. Custom face count adds $0.15." — [fal Hunyuan 3D Pro llms.txt](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d/llms.txt)
- Parameters: `input_image_url` (front view; 128 to 5000 px, max 8 MB, JPG/PNG/WEBP), optional `back_image_url`, `left_image_url`, `right_image_url`, plus v3.1-only `top_image_url`, `bottom_image_url`, `left_front_image_url`, `right_front_image_url`; `generate_type` "Normal" (textured) or "Geometry" (white model); `enable_pbr` default false ("metallic, roughness, normal textures"); `face_count` default 500000, range 40,000 to 1,500,000 — [fal Hunyuan 3D Pro llms.txt](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d/llms.txt)
- Output: `model_glb`, `thumbnail`, `model_urls` (GLB and OBJ), `seed` — [fal Hunyuan 3D Pro llms.txt](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d/llms.txt)
- Badges on the page: "Commercial use" and "Partner" — [fal Hunyuan 3D Pro page](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d)

**Tencent Hunyuan3D v3.1 Rapid — `fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d`**
- Price text: "Your request will cost $0.225 per generation. For $1.00, you can run this model 4 times. Base generation (text or image to 3D) costs $0.225. Enabling PBR materials adds $0.15." — [fal Hunyuan 3D Rapid llms.txt](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d/llms.txt)
- Only three parameters: `input_image_url` (tips: "simple background, single object, object >50% of frame"), `enable_pbr` (default false), `enable_geometry` (white model; OBJ not supported in that mode). No face-count control and no multi-view input — [fal Hunyuan 3D Rapid llms.txt](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d/llms.txt)
- Output: `model_glb`, `material_mtl`, `texture`, `thumbnail`, `model_urls` — [fal Hunyuan 3D Rapid llms.txt](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d/llms.txt)
- fal's family page describes Rapid as "Single front view input only" with "fixed polygon output", and Pro as accepting "up to 8 view angles" with polygon counts 40K to 1.5M — [fal Hunyuan 3D family page](https://fal.ai/hunyuan-3d)

**Microsoft TRELLIS 2 — `fal-ai/trellis-2`**
- Price text: "Your request will cost 0.25 $ for 512p resolution, 0.3 $ for 1024p resolution and 0.35 $ for 1536p resolution." — [fal Trellis 2 llms.txt](https://fal.ai/models/fal-ai/trellis-2/llms.txt)
- Key parameters: `resolution` 512 / 1024 (default) / 1536; `decimation_target` default 500000, range 5,000 to 2,000,000 ("Target number of vertices in the final mesh"); `texture_size` 1024 / 2048 (default) / 4096; `remesh` default true ("Rebuild the mesh topology for cleaner triangles"), `remesh_band`, `remesh_project`; per-stage guidance and step counts (structure, shape, texture stages each default 12 steps); UV-unwrap controls; `seed`. Single `image_url` only — [fal Trellis 2 llms.txt](https://fal.ai/models/fal-ai/trellis-2/llms.txt)
- Output: `model_glb` only — [fal Trellis 2 llms.txt](https://fal.ai/models/fal-ai/trellis-2/llms.txt)
- Vendor timing (Microsoft, on an NVIDIA H100): 512³ about 3 s (2 s shape + 1 s material), 1024³ about 17 s (10 s + 7 s), 1536³ about 60 s (35 s + 25 s); model has 4 billion parameters — [microsoft/TRELLIS.2 GitHub](https://github.com/microsoft/TRELLIS.2)

**Tripo H3.1 — `tripo3d/h3.1/image-to-3d` (multi-view sibling `tripo3d/h3.1/multiview-to-3d`)**
- Price text: "Your request will cost $0.20 (without textures), $0.30 (with standard textures), or $0.40 (with HD textures), plus an additional $0.20 for detailed geometry and $0.05 for quad mesh if selected." — [fal Tripo H3.1 llms.txt](https://fal.ai/models/tripo3d/h3.1/image-to-3d/llms.txt)
- Parameters: `face_limit` 1,000 to 2,000,000 (adaptive if unset); `texture` default true; `pbr` default true; `texture_quality` standard/detailed; `geometry_quality` standard/detailed; `texture_alignment` original_image/geometry; `auto_size` default false ("Auto-scale the model to real-world dimensions (meters)"); `orientation` default/align_image; `quad` default false (quad output "returns FBX format"); `model_seed`, `texture_seed` — [fal Tripo H3.1 llms.txt](https://fal.ai/models/tripo3d/h3.1/image-to-3d/llms.txt)
- Output: `model_mesh` (GLB or FBX), `model_urls` (incl. `pbr_model`), `rendered_image`, `task_id` — [fal Tripo H3.1 llms.txt](https://fal.ai/models/tripo3d/h3.1/image-to-3d/llms.txt)
- Vendor docs: version string v3.1-20260211; face count "Up to 2,000,000"; about 40 s without texture and about 120 s with texture; add-on credits on Tripo's own API: +20 detailed geometry, +5 quad, +10 smart low-poly, +20 generate-in-parts — [Tripo Developers, H3.1](https://developers.tripo3d.ai/en/models/v3-1)
- Third-party hands-on (GlobalGPT, a reseller of Tripo access, so not independent): three H3.1 runs took 139.4 to 143.4 s and produced 1.39 to 1.46 million triangles each, with one material and three embedded JPEG textures — [glbgpt Tripo H3.1 review, 9 Sep 2026](https://www.glbgpt.com/hub/tripo-h3-1-review)

**Tripo v2.5 — `tripo3d/tripo/v2.5/image-to-3d`**
- Price text: "Your request will cost $0.2 (without textures), $0.3 (with standard textures), or $0.4 (with HD textures), plus an additional $0.05 each for Style and quad options if selected." — [fal Tripo v2.5 llms.txt](https://fal.ai/models/tripo3d/tripo/v2.5/image-to-3d/llms.txt)
- Parameters: `face_limit`, `pbr` (default false), `texture` no/standard/HD, `auto_size`, `quad`, `texture_alignment`, `orientation`; outputs `model_mesh`, `base_model`, `pbr_model`, `rendered_image` — [fal Tripo v2.5 llms.txt](https://fal.ai/models/tripo3d/tripo/v2.5/image-to-3d/llms.txt)

**Tripo P2 (newer, marked "new" on fal) — `tripo3d/p2/image-to-3d`**
- Price text: "Each request costs $1.00 without textures, $1.10 with fast or standard textures, $1.20 with detailed textures, or $1.30 with extreme textures." — [fal Tripo P2 llms.txt](https://fal.ai/models/tripo3d/p2/image-to-3d/llms.txt)
- Parameters: `face_limit` 48 to 50,000; `texture`, `pbr` (default true); `texture_quality` fast/standard/detailed/extreme; `texture_version` v3.5-20260815 / v3.0-20250812 / v2.5-20250123; `delight` default true ("Remove baked-in lighting before texturing with v3.5"); `auto_size`; `export_uv`; `export_orientation` (+x, -x, -y, +y); `quad` — [fal Tripo P2 llms.txt](https://fal.ai/models/tripo3d/p2/image-to-3d/llms.txt)
- Trade press: Tripo P2.0 launched 21 September 2026 as a native quad-mesh model; triangle meshes up to 50,000 faces or quad meshes up to 25,000 faces — [VoxelMatters](https://www.voxelmatters.com/tripo-ai-launches-p2-0-model-to-generate-native-quad-meshes-for-production-pipelines/)

**TripoSR — `fal-ai/triposr`**
- Price text: "$0.07 per generations" — [fal TripoSR llms.txt](https://fal.ai/models/fal-ai/triposr/llms.txt)
- Parameters: `output_format` glb/obj; `do_remove_background` default true; `foreground_ratio` default 0.9; `mc_resolution` default 256, range 32 to 1024 ("Above 512 is not recommended"). No PBR, texture-size or face-count parameters. Output `model_mesh`, `timings` — [fal TripoSR llms.txt](https://fal.ai/models/fal-ai/triposr/llms.txt)

**Meshy 6 — `fal-ai/meshy/v6/image-to-3d`**
- Price text: "$0.8 per generations" — [fal Meshy 6 llms.txt](https://fal.ai/models/fal-ai/meshy/v6/image-to-3d/llms.txt)
- Parameters: `model_type` standard/lowpoly/smart-topology; `topology` quad/triangle; `target_polycount` default 30000, range 100 to 300,000; `symmetry_mode` off/auto/on; `should_remesh` default true; `should_texture` default true; `enable_pbr` default false; `texture_prompt`, `texture_image_url`; rigging/animation options. Output `model_glb`, `model_urls` (OBJ, USDZ, FBX, GLB), `texture_urls` — [fal Meshy 6 llms.txt](https://fal.ai/models/fal-ai/meshy/v6/image-to-3d/llms.txt)

**Meshy 7 — `fal-ai/meshy/v7/image-to-3d`**
- fal's page shows only a placeholder price, "$0 per compute seconds"; no real price could be confirmed — [fal Meshy 7 llms.txt](https://fal.ai/models/fal-ai/meshy/v7/image-to-3d/llms.txt)
- Same parameter set as Meshy 6 plus `geometry_resolution` standard/2k ("Meshy-7 supports standard and 2k") — [fal Meshy 7 llms.txt](https://fal.ai/models/fal-ai/meshy/v7/image-to-3d/llms.txt)
- Meshy's own API docs state `meshy-7` is deprecated in favour of `meshy-7.1` — [Meshy API docs, image-to-3d](https://docs.meshy.ai/en/api/image-to-3d)

**Meshy 7.1 — `fal-ai/meshy/v7.1/image-to-3d` (multi-view sibling `fal-ai/meshy/v7.1/multi-image-to-3d`, one to four views)**
- Price text: "A base model without textures costs $0.80. Adding textures brings the total to $1.20. Optional auto-rigging adds $0.20, and animation adds $0.12 per call. A textured model with auto-rigging and animation costs $1.52." — [fal Meshy 7.1 llms.txt](https://fal.ai/models/fal-ai/meshy/v7.1/image-to-3d/llms.txt)
- Parameters as Meshy 6/7 plus `geometry_resolution` standard/2k/4k ("4k available with Meshy-7.1"); `target_polycount` 100 to 300,000 (smart-topology max 15,000); `model_type: smart-topology` "uses Meshy-T2 for separated parts" — [fal Meshy 7.1 llms.txt](https://fal.ai/models/fal-ai/meshy/v7.1/image-to-3d/llms.txt)
- Meshy's own API additionally exposes `texture_resolution` 2k/4k/8k, `remove_lighting`, `auto_size`, `origin_at` (bottom/center), `image_enhancement`, and formats GLB, OBJ, FBX, USDZ, STL, 3MF. These were not present in the fal schema fetched — [Meshy API docs, image-to-3d](https://docs.meshy.ai/en/api/image-to-3d)
- Vendor blog states Meshy image-to-3D takes "roughly one" minute — [Meshy blog, Hi3D vs Meshy vs Tripo](https://www.meshy.ai/blog/hi3d-vs-meshy-vs-tripo)

**Hyper3D Rodin v2.5 — `fal-ai/hyper3d/rodin/v2.5` (fast variant `fal-ai/hyper3d/rodin/v2.5/fast`)**
- Price text: "Your request will cost $0.4 per generation. If HighPack is added to the addons, it will cost an additional $0.8 per generation." No per-tier price difference is stated — [fal Rodin v2.5 llms.txt](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/llms.txt)
- Parameters: `image_urls` (up to 5); `tier` Gen-2.5-Minimum / Extreme-Low / Low / Medium / High (default) / Extreme-High; `geometry_file_format` glb/usdz/fbx/obj/stl; `material` PBR/Shaded/All/None; `quality_mesh_option` Auto or "4K-2M Quad/Triangle options"; `texture_mode` legacy/extreme-low/low/medium/high; `hd_texture`; `texture_delight` ("Removes baked lighting/highlights from the generated textures"); `is_micro` (only with Extreme-High); `bbox_condition` ("Controlnet that controls the maximum sized of the generated model"); `use_original_alpha`; `addons` (HighPack); `preview_render`; `seed` 0 to 65535 — [fal Rodin v2.5 llms.txt](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/llms.txt)
- Vendor docs: tier descriptions (Low = "Clean assets and small hard-surface props", High = "Richer structure and smoother surfaces", Extreme-High adds a mesh with "up to 10M of faces"); textures 2K baseline, 4K via `uhd_texture`, 4K to 8K via HighPack; Extreme-High texture mode 6K baseline, 12K with HighPack; "Submit one to five images", first image used for material generation — [Hyper3D docs, Rodin Gen-2.5](https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5)

**Hitem3D / Hi3D — `hitem3d/hi3d/image-to-3d` (v1.5, v2.0, v2.1) and `hitem3d/hi3d/v3.0/image-to-3d`**
- Price text (v1.5 to v2.1): "Your request is billed at $0.02 per credit. Total cost is a sum of geometry, texture, and PBR credits, where geometry credits scale with resolution, texture is fixed at 10 credits, and PBR (v2.0 and above) is fixed at 5 credits. On v1.5, your request will cost $0.30 (512), $0.40 (1024), $0.60 (1536), or $0.80 (1536pro). On v2.0, it will cost $0.70 (1536) or $0.90 (1536pro). On v2.1, it will cost $0.50 (1536_fast) or $0.90 (1536pro)." — [fal Hi3D page](https://fal.ai/models/hitem3d/hi3d/image-to-3d)
- v1.5 to v2.1 parameters: `model` default "hitem3dv2.1"; `resolution` 512/1024/1536/1536pro/1536fast/1536profast; `enable_texture` default true; `enable_pbr` default true; `face_count` 100,000 to 2,000,000; `export_format` glb/obj/stl/fbx/usdz — [fal Hi3D llms.txt](https://fal.ai/models/hitem3d/hi3d/image-to-3d/llms.txt)
- v3.0: `resolution` "2048quality" (default, faster) or "2048master"; `face_count` 100,000 to 5,000,000; `shading` 0 to 1, default 0.5 ("De-shading strength"); typical costs "$2.10 (2048³quality) or $9.10 (2048³master)" — [fal Hi3D v3.0 llms.txt](https://fal.ai/models/hitem3d/hi3d/v3.0/image-to-3d/llms.txt)
- Vendor (Meshy) blog quotes Hi3D generation at "about two minutes" — [Meshy blog](https://www.meshy.ai/blog/hi3d-vs-meshy-vs-tripo)

### Inferences
- Maximum per-generation cost on fal by summing stated add-ons: Hunyuan Pro $0.375 + 0.15 + 0.15 + 0.15 = $0.825; Hunyuan Rapid with PBR $0.375; Tripo H3.1 with HD texture, detailed geometry and quad $0.65; Rodin v2.5 with HighPack $1.20; Meshy 7.1 textured $1.20.
- Preview-tier candidates by price and stated speed: TRELLIS 2 at 512 or 1024 ($0.25 to $0.30, seconds of GPU time by Microsoft's figures), Hunyuan Rapid ($0.225, or $0.375 with PBR), Tripo H3.1 standard ($0.30 textured). TripoSR is the cheapest ($0.07) but has no PBR or texture controls and is a 2024-generation model.
- Hero-tier candidates: Hunyuan Pro with PBR and multi-view, Tripo H3.1 with detailed geometry and HD texture, Rodin v2.5 High (optionally HighPack), Meshy 7.1, Hi3D v3.0. Hi3D v3.0 at $2.10 to $9.10 is roughly 3 to 14 times the cost of the others.
- Because Hunyuan Pro's default `face_count` is 500,000, the $0.15 "custom face count" charge probably applies only when the caller sets a non-default value; this was not stated on the page.
- A 500k to 1.5M-face GLB is heavy for a browser studio; whichever hero model is chosen, a face-count cap (Hunyuan `face_count` down to 40k, Tripo `face_limit`, TRELLIS `decimation_target`, Meshy `target_polycount` max 300k) or a post-decimation step will be needed.

### Gaps
- Generation time on fal specifically (queue + inference) was not published for any endpoint; no primary-source timing found for Hunyuan v3.1 Rapid or Pro, Rodin v2.5 tiers, Meshy 7.1, or Hi3D v3.0.
- Meshy 7 price on fal could not be confirmed (page shows a "$0 per compute seconds" placeholder).
- Whether Tripo H3.1 on fal charges extra for `pbr: true` is not stated in the price text.
- Rodin `quality_mesh_option` exact enum values (face counts per option) were truncated in the fetched schema.
- A search-result summary claimed Meshy 7 shipped 10 August 2026 with an "Ultra 4K" 4096³ mode and raw meshes up to 80 million triangles; the fetched Meshy page did not contain this, so it is unconfirmed.
- `hunyuan3d-v3/image-to-3d`, `sam-3/3d-objects`, `tripo3d/triposplat` (Gaussian splats, not meshes) and `fal-ai/pixal3d` were seen in listings but not examined.

## 2. Geometry quality: sharp edges, thin parts, hollow/occluded areas, watertightness, topology

### Takeaway
No model guarantees correct thin or occluded furniture structure from a single photo; the only furniture-specific quantitative benchmark found (Alibaba's Home3D paper, 100 pieces) puts Hunyuan3D-3.0 ahead of Tripo 3.0 on Chamfer distance and F1 but shows all general models miss rear legs and undersides. Topology control is best on Meshy (quad/tri, remesh, target polycount), Tripo (quad flag, P2 native quads) and Rodin (quad/triangle mesh options); TRELLIS 2 and Hunyuan output dense triangle meshes and rely on a separate retopology step.

### Cited Findings
- Independent of the fal vendors but self-interested (authors promote their own system): on a 100-case furniture benchmark with designer-authored ground truth, Hunyuan3D-3.0 scored CD 0.5218 ×10⁻³, EMD 5.360 ×10⁻², F1@0.01 0.5987; Tripo 3.0 scored CD 0.5646, EMD 5.175, F1 0.5860; Seed3D 1.0 scored CD 0.5446, EMD 5.215, F1 0.5784; Home3D 1.0 scored CD 0.4936, EMD 5.174, F1 0.6329 — [Home3D 1.0, arXiv 2606.27923v2, Alibaba/Taobao, 29 Jun 2026](https://arxiv.org/html/2606.27923v2)
- Same paper: its system "produces more complete object structure" in weakly observed regions "such as back supports, rear legs, inner chair frames, and underside connections", implying these are the typical failure regions for the general-purpose baselines — [Home3D 1.0](https://arxiv.org/html/2606.27923v2)
- TRELLIS.2 vendor limitation statement: "the generated raw meshes may occasionally contain small holes or minor topological discontinuities. For applications requiring strictly watertight geometry (e.g., 3D printing), we provide accompanying mesh post-processing scripts." — [microsoft/TRELLIS.2-4B model card](https://huggingface.co/microsoft/TRELLIS.2-4B)
- TRELLIS.2 vendor claim: the O-Voxel representation handles open surfaces, non-manifold geometry and internal enclosed structures — [microsoft/TRELLIS.2 GitHub](https://github.com/microsoft/TRELLIS.2)
- Third-party print test of TRELLIS 2 (fan site, low authority): a coffee mug from a photo came out with the handle interior filled solid — [trellis-2.com print test](https://trellis-2.com/blog/trellis-2-for-3d-printing-ai-mesh-quality-test)
- Vendor-adjacent 2025 test (ideate.xyz, sells texture tools; no version numbers given): on a prop with a hollow trigger guard, Meshy preserved the hollow while Tripo, Hunyuan and Rodin filled it; on a chair, "all five performed adequately" with Meshy best out of the box — [ideate.xyz comparison, 12 Apr 2025](https://ideate.xyz/blogs/posts/ai-3d-model-comparison-trellis-tripo-meshy-rodin-hunyuan)
- Competitor review (See3D, sells an alternative): Tripo "struggles with thin structures and tricky silhouettes from a single image", naming "spindly chair legs" (as summarised in search results; page not fetched directly) — [see3d.art Tripo review](https://see3d.art/blog/detail/Tripo-3D-AI-Review-What-It-s-Great-At-and-Not-b6180d62aa21/)
- Reseller hands-on of Tripo H3.1: advises to "inspect thin parts, holes, handles, reflective areas, logos, and texture seams"; 1.39 to 1.46 million triangles per asset with no guarantee of manifold or watertight geometry — [glbgpt Tripo H3.1 review](https://www.glbgpt.com/hub/tripo-h3-1-review)
- Vendor archviz test (Visiomake, sells its own tool; tested dining chair, table lamp, side table, decorative object from a single angle): Meshy "usually the easiest to repair for archviz props"; Rodin "visually strong but may still need cleanup" and strongest on curved and upholstered forms; Tripo topology "more variable, often denser or rougher"; Trellis "highly variable depending on setup". Ranking: Meshy, Rodin, Tripo, Trellis — [Visiomake, 4 Jun 2026](https://visiomake.com/en/blog/best-ai-image-to-3d-tools-2026-comparison-archviz)
- Vendor (Meshy) benchmark on a character figurine, six models: single-view surface-detail alignment Meshy 7 59.8%, Hi3D 2.1 55.2%, Tripo 3.1 51.7%; with four-view input Tripo led surface detail 62.8% vs 60.6% and Hi3D led proportion 86.5% vs 84.4% — [Meshy blog](https://www.meshy.ai/blog/hi3d-vs-meshy-vs-tripo)
- Vendor (Meshy) print-readiness claim: "97% slicer pass rate ... across 75 models in Bambu Studio, with 55% fully watertight straight out of export" — [Meshy blog](https://www.meshy.ai/blog/hi3d-vs-meshy-vs-tripo)
- Search-result summaries of other 2026 comparison posts (pages not fetched; one returned HTTP 403): "Hunyuan's hard-surface assets were most likely to need manual retopology"; Tripo "simplified finer mechanical detail"; Rodin "handled hard-surface detail impressively" in one post but is called weaker on furniture and machinery in a Neural4D (competitor) post — [marcellinusprevailer.com comparison](https://marcellinusprevailer.com/meshy-vs-tripo-rodin-hunyuan-3d-generator-2077dd4d4533); [Neural4D blog](https://blog.neural4d.com/comparisons/best-meshy-alternative-free-online/)
- Topology controls by model (fal schemas): Meshy `topology` quad/triangle, `should_remesh`, `target_polycount`, `model_type: smart-topology`; Tripo H3.1 `quad` (+$0.05, FBX output); Tripo P2 `quad` with `face_limit` up to 50,000; Rodin `quality_mesh_option` Quad or Triangle; TRELLIS 2 `remesh` (cleaner triangles) and `decimation_target`; Hunyuan Pro `face_count` only (triangles), with quad retopology via the separate smart-topology endpoint — [fal Meshy 7.1](https://fal.ai/models/fal-ai/meshy/v7.1/image-to-3d/llms.txt); [fal Tripo H3.1](https://fal.ai/models/tripo3d/h3.1/image-to-3d/llms.txt); [fal Tripo P2](https://fal.ai/models/tripo3d/p2/image-to-3d/llms.txt); [fal Rodin v2.5](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/llms.txt); [fal Trellis 2](https://fal.ai/models/fal-ai/trellis-2/llms.txt); [fal Hunyuan Smart Topology](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/smart-topology/llms.txt)
- Hi3D vendor positioning (as relayed by Meshy's blog): 2048³ voxel resolution with watertight-by-construction geometry — [Meshy blog](https://www.meshy.ai/blog/hi3d-vs-meshy-vs-tripo)

### Inferences
- For furniture with thin legs, slats and open frames, multi-view input (Hunyuan Pro up to 8 views, Tripo H3.1 multiview, Meshy 7.1 one to four views, Rodin up to 5 images) is the main available lever for occluded structure, since every single-view test reports guessed or missing hidden parts.
- The Home3D result is for Hunyuan3D-3.0 and Tripo 3.0, one version behind the 3.1 endpoints on fal; the relative ordering (Hunyuan slightly ahead on CD and F1, Tripo ahead on EMD) may not carry over.
- Evidence on "which model gives the sharpest furniture edges" is weak and conflicting: Meshy wins vendor-run and vendor-adjacent tests, Hunyuan wins the one academic furniture table, Hi3D v3.0 leads a small-sample community geometry vote (see section 5). A short in-house bake-off on 10 to 20 furniture photos is warranted before committing.

### Gaps
- No independent 2026 test was found that measures thin-part survival, edge sharpness or watertightness for Hunyuan v3.1, TRELLIS 2, Tripo H3.1, Meshy 7.1, Rodin v2.5 and Hi3D v3.0 on the same furniture set.
- No primary statement on watertightness was found for Hunyuan v3.1, Tripo H3.1 or Rodin v2.5 output.
- Whether TRELLIS 2's `remesh: true` on fal closes the small holes the model card describes is not documented.

## 3. Texture and material quality: true PBR maps, de-lighting, texture resolution

### Takeaway
All current hosted models can return PBR maps, but the map set differs: Hunyuan, Meshy and Hi3D document metallic, roughness and normal; TRELLIS 2 generates base colour, roughness, metallic and opacity natively (no normal map stated). Explicit de-lighting controls exist on Rodin v2.5 (`texture_delight`), Tripo P2 (`delight`), Hi3D v3.0 (`shading`) and Meshy's own API (`remove_lighting`); none is exposed on the fal schemas for Hunyuan v3.1, TRELLIS 2 or Tripo H3.1.

### Cited Findings
- Hunyuan v3.1 (Pro and Rapid): `enable_pbr` gives "metallic, roughness, normal textures"; default is off and costs +$0.15 — [fal Hunyuan Pro llms.txt](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d/llms.txt); [fal Hunyuan Rapid llms.txt](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d/llms.txt)
- TRELLIS.2 vendor claim: generates "Base Color, Roughness, Metallic, and Opacity" as native voxel attributes; fal exposes `texture_size` 1024/2048/4096 — [microsoft/TRELLIS.2 GitHub](https://github.com/microsoft/TRELLIS.2); [fal Trellis 2 llms.txt](https://fal.ai/models/fal-ai/trellis-2/llms.txt)
- Tripo H3.1: `pbr` default true; `texture_quality: detailed` "produces higher-resolution textures"; `texture_alignment` can prioritise the input image or the geometry — [fal Tripo H3.1 llms.txt](https://fal.ai/models/tripo3d/h3.1/image-to-3d/llms.txt)
- Tripo P2: `delight` default true ("Remove baked-in lighting before texturing with v3.5"), texture model v3.5-20260815, four texture quality levels — [fal Tripo P2 llms.txt](https://fal.ai/models/tripo3d/p2/image-to-3d/llms.txt)
- Meshy 6/7/7.1 on fal: `enable_pbr` "Generate PBR Maps (metallic, roughness, normal) in addition to base color", default false; `texture_image_url` and `texture_prompt` can guide texturing; `texture_urls` returned separately — [fal Meshy 7.1 llms.txt](https://fal.ai/models/fal-ai/meshy/v7.1/image-to-3d/llms.txt)
- Meshy's own API: `texture_resolution` 2k/4k/8k; `remove_lighting` "Removes highlights and shadows from the base color texture"; maps returned are base colour, metallic, normal, roughness (emission on Meshy 6 only) — [Meshy API docs](https://docs.meshy.ai/en/api/image-to-3d)
- Rodin v2.5: `material` PBR/Shaded/All/None; `texture_delight` "Removes baked lighting/highlights from the generated textures" (default false); `hd_texture` for enhanced post-processing; 2K textures baseline, 4K to 8K with HighPack, up to 12K in extreme-high texture mode with HighPack — [fal Rodin v2.5 llms.txt](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/llms.txt); [Hyper3D docs](https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5)
- Hi3D: `enable_pbr` default true (v2.0 and above); v3.0 adds `shading` "De-shading strength" 0 to 1, default 0.5 — [fal Hi3D v3.0 llms.txt](https://fal.ai/models/hitem3d/hi3d/v3.0/image-to-3d/llms.txt)
- TripoSR: no PBR or texture-resolution parameters in the schema — [fal TripoSR llms.txt](https://fal.ai/models/fal-ai/triposr/llms.txt)
- Furniture-specific finding (Alibaba paper): general models lose "high-frequency surface cues such as woven fabric, wood grain, and stitched or tufted patterns"; the authors avoid end-to-end PBR generation by retrieving pre-authored materials, and still list "material identity, fine texture detail, color consistency, and physically plausible roughness/metallic response" as open problems. Image-space scores: Hunyuan3D-3.0 CLIP-I 0.9370 / LPIPS 0.07465; Tripo 3.0 0.9324 / 0.07905 — [Home3D 1.0](https://arxiv.org/html/2606.27923v2)
- Vendor archviz test: "All tools struggle with reflective metals and translucent materials"; Rodin "generally strong visual textures, UV usability varies"; Tripo "acceptable for concept use, less consistent for final assets" — [Visiomake](https://visiomake.com/en/blog/best-ai-image-to-3d-tools-2026-comparison-archviz)
- 2025 vendor-adjacent test: "Tripo, Meshy, and Rodin produced the highest quality textures thanks to their post-processing pipelines" versus more basic textures from open-source models — [ideate.xyz](https://ideate.xyz/blogs/posts/ai-3d-model-comparison-trellis-tripo-meshy-rodin-hunyuan)
- Community blind-vote texture category (small samples): Seed3D v2.0 1,069 Elo (66 votes), Hi3D v3.0 1,059 (28 votes), Tripo AI v3.1 1,057 (36 votes) — [top3d.ai](https://www.top3d.ai/)

### Inferences
- For a realism-first studio that relights furniture in a room, de-lit albedo matters more than raw texture resolution; on fal today the documented de-lighting switches are on Rodin v2.5, Tripo P2 and Hi3D v3.0. Using Meshy's `remove_lighting` or 4k/8k textures may require calling Meshy's API directly instead of fal.
- TRELLIS 2's lack of a stated normal map and Hunyuan's PBR being off by default mean the preview tier will look flatter unless PBR is enabled (Hunyuan +$0.15).
- A separate material pass (section 7: part segmentation plus retexture or library-material assignment, as Home3D does) is likely to give more physically plausible wood, fabric and metal than any model's end-to-end PBR.

### Gaps
- Texture resolution of Hunyuan v3.1 output on fal is not documented on the fal pages.
- Whether Hunyuan v3.1 or Tripo H3.1 perform internal de-lighting without a switch could not be confirmed on a primary page.
- No independent measurement of PBR map accuracy (roughness/metallic vs ground truth) for these models was found.

## 4. Orientation and scale consistency; multi-view input

### Takeaway
Only Tripo and Meshy document real-world scale and orientation controls (`auto_size` in metres, `orientation`/`export_orientation`, `origin_at`); Rodin offers a bounding-box condition; Hunyuan, TRELLIS 2 and Hi3D document nothing, so the app should plan to normalise up-axis, front-axis, origin and scale itself. Multi-view input is supported by Hunyuan Pro (up to 8 views), Tripo H3.1 multiview, Meshy 7.1 multi-image (1 to 4) and Rodin (up to 5 images).

### Cited Findings
- Tripo H3.1 and v2.5: `auto_size` "Auto-scale the model to real-world dimensions (meters)", default false; `orientation: align_image` "auto-rotates to match the input image" — [fal Tripo H3.1 llms.txt](https://fal.ai/models/tripo3d/h3.1/image-to-3d/llms.txt)
- Tripo P2: `export_orientation` sets the forward axis (+x, -x, -y, +y); `auto_size` available — [fal Tripo P2 llms.txt](https://fal.ai/models/tripo3d/p2/image-to-3d/llms.txt)
- Meshy's own API: `auto_size` (AI-estimated real-world height) and `origin_at` bottom/center; not seen in the fal schema — [Meshy API docs](https://docs.meshy.ai/en/api/image-to-3d)
- Rodin v2.5: `bbox_condition` controls the maximum size of the generated model — [fal Rodin v2.5 llms.txt](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5/llms.txt)
- Hunyuan Pro multi-view: back, left, right, plus v3.1-only top, bottom, left-front 45° and right-front 45° views; multi-view adds $0.15. Rapid is single-view only — [fal Hunyuan Pro llms.txt](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d/llms.txt); [fal Hunyuan family page](https://fal.ai/hunyuan-3d)
- Tripo H3.1 "supports text prompts, single images, and multiview inputs natively"; fal lists `tripo3d/h3.1/multiview-to-3d` — [Tripo Developers, H3.1](https://developers.tripo3d.ai/en/models/v3-1); [fal explore](https://fal.ai/explore/search?categories=image-to-3d)
- Meshy 7.1 multi-image endpoint "generates textured 3D models from one to four views" — [fal explore](https://fal.ai/explore/search?categories=image-to-3d)
- Rodin: "Submit one to five images", first image used for material generation — [Hyper3D docs](https://docs.hyper3d.ai/en/api-specification/rodin-gen2-5)
- TRELLIS 2 on fal takes a single `image_url`; a multi-image endpoint exists only for the older TRELLIS (`trellis/multi`) — [fal Trellis 2 llms.txt](https://fal.ai/models/fal-ai/trellis-2/llms.txt); [fal explore](https://fal.ai/explore/search?categories=image-to-3d)
- Home3D paper trains a small network to predict canonical orientation because generated/collected assets are not consistently posed — [Home3D 1.0](https://arxiv.org/html/2606.27923v2)
- Vendor archviz test: Meshy scale "fair to good for furniture-scale assets"; Rodin "good visual proportion, still needs verification" — [Visiomake](https://visiomake.com/en/blog/best-ai-image-to-3d-tools-2026-comparison-archviz)

### Inferences
- GLB is Y-up by specification, but front-axis and yaw generally follow the input photo's camera angle; a three-quarter product photo will usually yield a model rotated relative to the room grid unless the model offers alignment (Tripo) or the app corrects it.
- Since the studio knows catalogue dimensions for real furniture, scaling the generated mesh's bounding box to known width/depth/height is more reliable than any model's `auto_size` estimate.

### Gaps
- No primary documentation of the canonical up/front axis convention for Hunyuan v3.1, TRELLIS 2, Rodin v2.5 or Hi3D output.
- No independent test of orientation or scale consistency across repeated generations was found.

## 5. Independent comparisons and benchmarks (2025-2026)

### Takeaway
Genuinely independent, furniture-specific evidence is thin: one academic furniture benchmark (Alibaba, previous model versions) and one community blind-vote arena with small vote counts per category. Most "2026 comparison" articles are published by vendors or resellers and disagree with each other.

### Cited Findings
- Academic furniture benchmark (authors have their own system): 100 furniture cases with designer ground truth; Hunyuan3D-3.0 best of the three commercial baselines on CD (0.5218) and F1 (0.5987), Tripo 3.0 best on EMD (5.175); Home3D 1.0 best overall — [Home3D 1.0, arXiv, 29 Jun 2026](https://arxiv.org/html/2606.27923v2)
- Community blind-vote arena top3d.ai (brands hidden until vote; live Elo). Geometry: Hi3D v3.0 1,066 (28 votes), Meshy 7.1 1,059 (30 votes), Hi3D v2.0 1,046 (34 votes). Texture: Seed3D v2.0 1,069 (66), Hi3D v3.0 1,059 (28), Tripo AI v3.1 1,057 (36). Low poly: Tripo P2.0 1,042 (17), Rodin Gen-2.5 1,017 (15). Segmentation: Tripo Segmentation v2.1 1,049 (11), Roblox CubePart 1,041 (8), Meshy 6 Auto Split 997 (8). Smart UV: Tripo Smart UV 1,050 (20), Hunyuan Semantic UV 950 (20) — [top3d.ai](https://www.top3d.ai/)
- Snapshot of the same arena's overall-quality board on 3 Aug 2026 as republished by Sloyd (a vendor ranked third in its own post; 186,939 total votes): Tripo AI v3.1 1042 (88.6% win rate), Hitem3D v2.0 1025, Sloyd AI v3 1015, N4D-2.5 1013, Triverse 3.0 1012, Rodin Gen 2.5 1009, Hitem3D v2.1 1005, Meshy 6 1004. Elo resets to 1000 each season — [Sloyd blog, 4 Aug 2026](https://www.sloyd.ai/blog/ai-3d-model-generator-rankings)
- 3D Arena (Hugging Face) methodology paper describing pairwise human-preference Elo for generative 3D — [3D Arena, arXiv 2506.18787](https://arxiv.org/html/2506.18787v1)
- Aggregator leaderboard (Pixazo; provenance unclear, older versions): Hunyuan3D-2.5 1325, TRELLIS 1290, Meshy 5 1280, Tripo 2.5 Pro 1265, Rodin Gen-2 1245; the same search summary cites another board with "Hunyuan 3D Pro" leading at 1451 mean Elo ahead of Rodin 2 and Meshy 6 Preview — [Pixazo leaderboard](https://www.pixazo.ai/leaderboard/ai-3d-model-generation)
- Vendor comparison (Meshy): Meshy 7 leads single-view geometry alignment on a figurine; loses to Hi3D and Tripo on some four-view rows; no furniture tested — [Meshy blog](https://www.meshy.ai/blog/hi3d-vs-meshy-vs-tripo)
- Vendor comparison (Visiomake, archviz furniture props): ranks Meshy, Rodin, Tripo, Trellis; speed ranking Tripo fastest, Rodin medium — [Visiomake, 4 Jun 2026](https://visiomake.com/en/blog/best-ai-image-to-3d-tools-2026-comparison-archviz)
- Vendor-adjacent 2025 comparison including a chair: all five (Trellis, Tripo, Meshy, Rodin, Hunyuan) adequate, Meshy best out of the box — [ideate.xyz, 12 Apr 2025](https://ideate.xyz/blogs/posts/ai-3d-model-comparison-trellis-tripo-meshy-rodin-hunyuan)

### Inferences
- Across sources the consistently top-ranked families in 2026 are Tripo 3.1, Hi3D (v2.x/v3.0), Meshy 7.x, Hunyuan 3.x and Rodin 2.5; TRELLIS 2 and TripoSR do not appear near the top of any 2026 human-preference board found, which fits their role as preview-tier options.
- top3d.ai category votes (8 to 66 votes per model) are too few to separate models whose Elo differs by 10 to 20 points.
- Seed3D v2.0 tops the community texture vote but is not currently usable through fal, per the deprecation note.

### Gaps
- No independent benchmark includes Hunyuan3D v3.1, TRELLIS 2 and Tripo H3.1 together on furniture.
- The marcellinusprevailer.com four-way comparison could not be read (HTTP 403); its findings above come only from a search summary.
- No YouTube or video benchmark was reviewed.
- The current Hugging Face 3D Arena leaderboard values were not retrieved directly.

## 6. Licence and territory limits

### Takeaway
The Tencent Hunyuan 3D community licence (for the open-weight 2.x releases) excludes the EU, UK and South Korea and sets a 1-million-MAU threshold, but Hunyuan3D v3.x is reported to be a closed, API-only product governed by service terms, and fal marks its v3.1 endpoints "Commercial use"/"Partner"; no fal or Tencent page was found that states whether territory limits apply to v3.1 output via fal, so this needs legal confirmation. TRELLIS.2 is MIT. Tripo, Meshy and Rodin grant commercial rights on paid/API use, with CC BY 4.0 and vendor ownership on free tiers.

### Cited Findings
- Tencent Hunyuan 3D 2.1 Community License (release date 13 June 2025): Territory is the "worldwide territory, excluding the territory of the European Union, United Kingdom and South Korea"; the licensee may not "use, reproduce, modify, distribute, or display the Tencent Hunyuan 3D 2.1 Works ... outside the Territory" — [Hunyuan3D-2.1 LICENSE](https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2.1/main/LICENSE)
- Same licence: services exceeding 1 million monthly active users need Tencent's approval (as summarised from the licence text); "Tencent claims no rights in Outputs You generate"; outputs may not be used to improve other AI models; when offered through hosted services the actual provider must be disclosed and Tencent non-affiliation stated — [Hunyuan3D-2.1 LICENSE](https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2.1/main/LICENSE)
- Tencent Cloud describes two separate channels, the open-source repository under the community licence and the hosted API "Tencent HY 3D Global": "they are different products operating under different terms"; the page states no territory exclusions or MAU thresholds for the API — [Tencent Cloud techpedia](https://www.tencentcloud.com/techpedia/148273?lang=en)
- Third-party API host (WaveSpeed) states v3.0/v3.1 appear to be commercial-only via Tencent Cloud API, and "For closed-API access via Tencent Cloud, the commercial-use terms are in the service agreement — review with legal before shipping" — [WaveSpeed blog, 9 Jun 2026](https://wavespeed.ai/blog/posts/hunyuan-3d-api/)
- fal's statement for its Hunyuan 3D endpoints: "Content generated through the fal.ai API can be used in commercial projects"; the v3.1 endpoints carry "Commercial use" and "Partner" badges — [fal Hunyuan 3D family page](https://fal.ai/hunyuan-3d); [fal Hunyuan Pro page](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d)
- TRELLIS.2 code and the TRELLIS.2-4B weights are MIT-licensed; the repo notes dependencies nvdiffrast and nvdiffrec are "governed by its own License" — [microsoft/TRELLIS.2 GitHub](https://github.com/microsoft/TRELLIS.2); [TRELLIS.2-4B model card](https://huggingface.co/microsoft/TRELLIS.2-4B)
- fal marks TRELLIS 2, Tripo H3.1, Rodin v2.5, Meshy 7.1 and Hi3D endpoints as "Commercial use" — [fal Trellis 2](https://fal.ai/models/fal-ai/trellis-2); [fal Tripo H3.1](https://fal.ai/models/tripo3d/h3.1/image-to-3d); [fal Rodin v2.5](https://fal.ai/models/fal-ai/hyper3d/rodin/v2.5); [fal Meshy 7.1](https://fal.ai/models/fal-ai/meshy/v7.1/image-to-3d); [fal Hi3D](https://fal.ai/models/hitem3d/hi3d/image-to-3d)
- Meshy: on paid plans users retain private ownership of generated assets; on the free plan assets are licensed CC BY 4.0 (commercial use allowed with credit to Meshy); API access requires a paid plan (search-result summary of Meshy help pages; pages not fetched directly) — [Meshy help: commercial use](https://help.meshy.ai/en/articles/9992001-can-i-use-my-generated-assets-for-commercial-projects); [Meshy help: ownership](https://help.meshy.ai/en/articles/10137554-what-is-the-ownership-of-the-generated-models)
- Tripo: paid users "have full rights to use, modify, distribute, and commercially exploit" generated models; free-plan models are public under CC BY 4.0 and Tripo retains rights in free users' outputs (ToS section 5.2.1); the API "includes commercial use for all generated assets" (search-result summary; the help page returned HTTP 403 on direct fetch) — [Tripo help: commercial use](https://www.tripo3d.ai/help/privacy-policy/how-to-use-tripo-models-commercially); [Tripo blog: commercial licence](https://www.tripo3d.ai/blog/ai-3d-commercial-use-license)
- Rodin: a third-party reseller page states "Commercial use is allowed on all generated models" (not a Hyper3D primary page) — [3D AI Studio, Rodin Gen-2.5](https://www.3daistudio.com/Models/Rodin-Gen-2-5)

### Inferences
- The EU/UK/South Korea exclusion and the 1M-MAU clause are terms of the community licence for self-hosted open weights (2.0/2.1). They would most plausibly bite on fal's older open-weight endpoint (`fal-ai/hunyuan3d/v2`) and on any self-hosting, not automatically on the v3.1 partner endpoints, which run under Tencent's commercial API terms relayed through fal. This is a reading of the sources, not a confirmed legal position.
- If the studio serves EU, UK or South Korean users, the low-risk choices on licence grounds are TRELLIS 2 (MIT) for preview and Tripo, Meshy or Rodin (paid API commercial rights) for hero, unless fal or Tencent confirms in writing that v3.1 via fal has no territory restriction.
- The community licence's ban on using outputs to train other models, and its AI-generated-content disclosure duty, would matter if the open weights were ever self-hosted.

### Gaps
- No primary page (fal terms, Tencent Cloud service agreement) was found stating whether Hunyuan3D v3.1 accessed through fal carries territory restrictions for end users in the EU, UK or South Korea. Needs a direct question to fal/Tencent.
- The exact wording of the 1-million-MAU clause was paraphrased by the fetch tool; quote from the LICENSE file before relying on it.
- WaveSpeed's claim that Hunyuan3D 2.5 is open-sourced was not verified and may be wrong; only 2.0 and 2.1 licence files were located.
- Hyper3D's own terms on output ownership, and Hi3D's, were not retrieved.
- fal's general terms of service were not reviewed for output-ownership or regional clauses.

## 7. Related services that improve a generated mesh (retopology, PBR/texture regeneration, part segmentation)

### Takeaway
fal hosts post-processing endpoints from the same vendors: Hunyuan Smart Topology ($0.75) and Part Splitter ($0.45), Meshy retexture, and fal's own PATINA PBR material generator; Tripo and Meshy offer segmentation, retopology and texturing mainly through their own APIs. Part splitting into separate material groups is available but constrained (Hunyuan Part takes FBX only, at most 30,000 faces).

### Cited Findings
- Hunyuan 3D Smart Topology, `fal-ai/hunyuan-3d/v3.1/smart-topology`: inputs `input_file_url` (GLB/OBJ, max 200 MB), `polygon_type` triangle/quadrilateral, `face_level` high/medium/low; outputs GLB and OBJ. "Your request will cost $0.75 per generation." — [fal Hunyuan Smart Topology llms.txt](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/smart-topology/llms.txt)
- Hunyuan 3D Part Splitter, `fal-ai/hunyuan-3d/v3.1/part`: "URL of FBX file to split into parts. ONLY FBX format supported. Max size: 100MB, face count ≤30,000."; returns a list of part files in FBX. "Your request will cost $0.45 per generation." — [fal Hunyuan Part llms.txt](https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/part/llms.txt)
- Meshy retexture on fal, `fal-ai/meshy/v5/retexture`: applies new textures to an existing 3D model from a text prompt or reference image, with PBR support — [fal Meshy v5 retexture](https://fal.ai/models/fal-ai/meshy/v5/retexture)
- Meshy on fal also covers text-to-3D, image-to-3D and multi-image-to-3D — [fal blog: Meshy on fal](https://blog.fal.ai/meshy-os/)
- Meshy generation-time options that reduce post-work: `model_type: smart-topology` (Meshy-T2, "separated parts", max 15,000 polys), `topology: quad`, `should_remesh`, `texture_image_url` — [fal Meshy 7.1 llms.txt](https://fal.ai/models/fal-ai/meshy/v7.1/image-to-3d/llms.txt)
- fal PATINA: generates BaseColor, Normal, Roughness, Metallic and Height maps from text or image (tileable PBR materials) — [fal blog: Introducing PATINA](https://blog.fal.ai/introducing-patina/)
- Tripo's own API has a mesh segmentation endpoint (POST /mesh/segment) with v1 geometry-based and v2 semantic-plus-geometry modes, and H3.1 add-ons for smart low-poly (+10 credits) and generate-in-parts (+20 credits) — [Tripo Developers: mesh segmentation](https://developers.tripo3d.ai/en/docs/mesh-segment); [Tripo Developers: H3.1](https://developers.tripo3d.ai/en/models/v3-1)
- Community votes on post-processing tools (very small samples): segmentation Tripo Segmentation v2.1 1,049 (11 votes) vs Meshy 6 Auto Split 997 (8 votes); UV unwrapping Tripo Smart UV 1,050 vs Hunyuan Semantic UV 950 (20 votes each) — [top3d.ai](https://www.top3d.ai/)
- Tencent Cloud's Hunyuan API prices smart topology, auto rigging, UV unfold and format conversion as separate services — [Tencent Cloud techpedia](https://www.tencentcloud.com/techpedia/148273?lang=en)
- TRELLIS.2 ships mesh post-processing scripts (hole filling) for watertight output when self-hosted — [TRELLIS.2-4B model card](https://huggingface.co/microsoft/TRELLIS.2-4B)
- Alibaba's furniture system assigns retrieved, pre-authored PBR materials per part instead of generating PBR maps end to end — [Home3D 1.0](https://arxiv.org/html/2606.27923v2)

### Inferences
- A hero pipeline of generate, then split into parts, then assign library or PATINA materials per part mirrors the Home3D approach and would let the studio's users recolour or re-upholster furniture; the Hunyuan Part limit of 30,000 faces and FBX-only input means a decimation and format-conversion step must sit before it.
- Hunyuan Pro + PBR + Smart Topology + Part totals about $1.73 per asset on fal ($0.375 + 0.15 + 0.75 + 0.45), comparable to or above a single Meshy 7.1 or Tripo P2 call that already yields clean topology.
- Tripo segmentation is not confirmed to exist as a fal endpoint; using it may require a direct Tripo API account.

### Gaps
- No full list of fal's 3D post-processing endpoints was retrieved (for example Tripo or Meshy remesh/segmentation endpoints on fal, or a TRELLIS 2 texturing endpoint); only the items above were confirmed.
- Whether Hunyuan Part output parts map to distinct material groups in one file, or only to separate FBX files, is not documented.
- Pricing for Meshy v5 retexture and PATINA on fal was not retrieved.
