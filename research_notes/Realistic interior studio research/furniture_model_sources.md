# Sources of realistic furniture 3D models that can legally ship inside a commercial three.js web app (as of October 2026)

Notes on method and reading these notes:
- Research date: 2 October 2026. Anything older is dated inline.
- Licence clauses are **paraphrased closely, not quoted verbatim** (one short quote only); follow the link for the exact wording. "Licence text says" items are in *Cited Findings*; my reading of what that means for a three.js app that sends GLB files to the browser is in *Inferences*. None of this is legal advice.
- The architectural fact that drives every licence reading: in a three.js app the model file (GLB/glTF, an open standard format) is downloaded to the end user's browser and can be saved from the network tab. Many stock licences permit "use in an app" only if the asset is in a proprietary/non-extractable form, so the same licence that is fine for a compiled Unity game can be a problem for a plain-GLB web app.
- Source-quality flags: [P] = primary source fetched directly; [S] = search-result summary of a primary page (page itself blocked or not fetched, so wording is less certain); [2] = secondary/aggregator source.

## Key Question 1: Free CC0 / permissive libraries and research datasets

### Takeaway
Only a handful of free sources are both commercially redistributable and realistic: Poly Haven (CC0, ~146 furniture models), Amazon Berkeley Objects (CC BY 4.0, 7,953 artist-made PBR GLBs, mostly home/furniture products), CC0/CC-BY items on Sketchfab and their Objaverse mirror (large but uneven quality and provenance), plus small CC0 sets (ShareTextures, Smithsonian, Kenney low-poly). The furniture-specific research datasets that look most attractive (3D-FUTURE, HSSD, IKEA assembly dataset) are research-only or non-commercial and cannot be shipped.

### Cited Findings

**Poly Haven (CC0)**
- [P] Licence page says all assets are CC0: usable for any purpose including commercial work, no attribution required, and may be redistributed, including inside a product that is sold. — [Poly Haven licence](https://polyhaven.com/license)
- [P] The Poly Haven public API listing for models in the "furniture" category returned 146 assets on 2 Oct 2026; rough split (approximate, counted by an automated summary of the JSON): seating 50+, tables 40+, shelves/storage 25+, beds ~5, carts ~3, misc (mirrors, screens etc.) 5+. Style skews vintage, worn, gothic and rustic, with some recent Chinese-style and industrial pieces. — [Poly Haven API, furniture models](https://api.polyhaven.com/assets?type=models&categories=furniture); browse view at [Poly Haven furniture](https://polyhaven.com/models/furniture)

**Amazon Berkeley Objects (ABO) (CC BY 4.0)**
- [P] ABO is licensed CC BY 4.0; attribution must credit Amazon.com for the data (and the dataset page asks for the CVPR 2022 paper to be cited), with a link to the licence and indication of changes; no endorsement may be implied. — [ABO dataset page](https://amazon-berkeley-objects.s3.amazonaws.com/index.html)
- [P] 147,702 product listings; 3D models for 7,900+ products delivered as glTF 2.0 `.glb` files with 4K PBR texture maps. — [ABO dataset page](https://amazon-berkeley-objects.s3.amazonaws.com/index.html)
- [S] The paper gives the exact count as 7,953 artist-designed meshes across 63 product categories with 3D models; six classes overlapping ShapeNet (chairs, sofas, tables, lamps etc.) account for 4,170 of the 7,953. Product metadata includes dimensions, material, colour and weight per listing. (Paper dated 2021/CVPR 2022.) — [ABO paper, arXiv 2110.06199](https://arxiv.org/abs/2110.06199); [CVPR 2022 PDF](https://openaccess.thecvf.com/content/CVPR2022/papers/Collins_ABO_Dataset_and_Benchmarks_for_Real-World_3D_Object_Understanding_CVPR_2022_paper.pdf); [AWS Open Data registry entry](https://registry.opendata.aws/amazon-berkeley-objects/)

**Objaverse 1.0 / Objaverse-XL (mixed per-object licences)**
- [P] Objaverse 1.0 (~800K objects, all sourced from Sketchfab): the dataset as a whole is ODC-By 1.0, but each object keeps its own licence: CC BY 4.0 ≈ 721K, CC BY-NC-SA ≈ 52K, CC BY-NC ≈ 25K, CC BY-SA ≈ 16K, CC0 ≈ 3.5K. Licence is in each object's metadata. — [Objaverse on Hugging Face](https://huggingface.co/datasets/allenai/objaverse)
- [S] Objaverse-XL (10M+ objects, 2023) aggregates GitHub, Thingiverse (~3.5M, mostly CC licences, mostly untextured print meshes), Sketchfab and Smithsonian (2.4K, CC0); licence varies per object and per source. — [Objaverse-XL paper](https://arxiv.org/html/2307.05663v1); [objaverse-xl GitHub](https://github.com/allenai/objaverse-xl)
- [S] "Furniture" is among the frequently used tags in Objaverse, but no furniture count is published. — [Objaverse CVPR 2023 paper](https://openaccess.thecvf.com/content/CVPR2023/papers/Deitke_Objaverse_A_Universe_of_Annotated_3D_Objects_CVPR_2023_paper.pdf)

**Sketchfab CC0 / CC-BY (free downloads)**
- [S] Sketchfab auto-converts every downloadable model to glTF (and offers an optimised GLB with 1K textures); a Download API returns temporary glTF/USDZ links and search can be filtered by licence. — [Sketchfab download API](https://sketchfab.com/developers/download-api/downloading-models); [Sketchfab GLB export blog](https://sketchfab.com/blogs/community/new-optimized-export-format-glb-1k-textures/)
- [S] Platform status: the Sketchfab Store closed when Fab launched (22 Oct 2024); CC0, CC BY-SA, CC BY-NC and CC BY-ND models could not migrate to Fab because Fab only supports CC BY and its Standard licence; free content stayed downloadable on Sketchfab. — [Sketchfab (Wikipedia)](https://en.wikipedia.org/wiki/Sketchfab); [Sketchfab migration blog](https://sketchfab.com/blogs/community/fab-publishing-portal-open-for-sketchfab-migration/)
- [2] In August 2026 Epic sold Sketchfab (and ArtStation) to KitBash (KitBash3D / Greyscalegorilla); Sketchfab's publishing, viewer and community move to KitBash, Epic keeps Fab; parties said no immediate changes to access or pricing. — [Digital Production, 12 Aug 2026](https://digitalproduction.com/2026/08/12/kitbash-buys-artstation-and-sketchfab/); [80.lv](https://80.lv/articles/artstation-and-sketchfab-have-been-acquired-by-kitbash); [Epic help notice](https://www.epicgames.com/help/c-34406160/c-34044796/kitbash-ziskava-artstation-a-sketchfab-a16255633)

**Smithsonian Open Access (CC0)**
- [2] Smithsonian released ~2,000+ 3D models as CC0 (Feb 2020), downloadable as OBJ and glTF; usable commercially without attribution. Includes some Cooper Hewitt design-museum furniture (e.g. a side chair), but the collection is museum artefacts, not a furniture catalogue. Sketchfab profile shows 172 models. — [CG Channel, Mar 2020](https://www.cgchannel.com/2020/03/get-2000-free-3d-models-from-the-smithsonian-collection/); [Smithsonian Open Access FAQ](https://www.si.edu/openaccess/faq); [Smithsonian on Sketchfab](https://sketchfab.com/Smithsonian)

**Kenney (CC0, stylised low-poly)**
- [S] Kenney Furniture Kit: ~140 CC0 low-poly furniture/building pieces in FBX/OBJ/glTF (sources vary: 116–140). Not realistic. — [Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit); [Poly Pizza mirror](https://poly.pizza/bundle/Furniture-Kit-NoG1sEUD1z)

**Google Scanned Objects (CC BY 4.0)**
- [S] 1,030 scanned household items, CC BY 4.0, ~13 GB, built for robotics simulation (SDF/OBJ on Gazebo Fuel). Items are small graspable household goods (toys, kitchenware, shoes, boxes), not furniture. (Paper 2022.) — [GSO paper, arXiv 2204.11918](https://arxiv.org/abs/2204.11918)

**3D-FUTURE (Alibaba) (research-only)**
- [S] 9,992 (the paper's headline figure) high-quality textured furniture models, provided via Alibaba Topping Homestyler. (2020/2021.) — [3D-FUTURE paper, IJCV](https://link.springer.com/article/10.1007/s11263-021-01534-z); [hyper.ai dataset card](https://hyper.ai/en/datasets/20084)
- [P] The licence agreement grants a revocable, non-transferable licence for "scientific research purpose only"; it forbids commercialising the data or using it to provide external services, and forbids distributing it to any third party. — [3D-FUTURE Data Sets Use License Agreement](https://terms.aliyun.com/legal-agreement/terms/suit_bu1_ali_cloud/suit_bu1_ali_cloud202004171628_60052.html)

**IKEA 3D Assembly Dataset (CC BY-NC-SA 4.0)**
- [P] Only 5 products (LACK side table, two EKET cabinets, BEKVÄM step stool, DALFRED bar stool) in glTF/GLB and OBJ; CC BY-NC-SA 4.0 for research on furniture assembly; IKEA expressly reserves design/copyright/IP in its products. — [IKEA3DAssemblyDataset on GitHub](https://github.com/IKEA/IKEA3DAssemblyDataset)

**HSSD-200 (Habitat Synthetic Scenes) (CC BY-NC 4.0)**
- [S] 211 houses with 18,656 objects across 466 categories, authored by professional artists to match real branded furniture, built in the Floorplanner tool; released CC BY-NC 4.0 (non-commercial). (2023.) — [HSSD project page](https://3dlg-hcvc.github.io/hssd/); [HSSD paper](https://arxiv.org/abs/2306.11290)

**Other CC0 sources**
- [2] ShareTextures: 150+ CC0 models including furniture and scanned props (Sept 2023 figure). — [BlenderNation, Sept 2023](https://www.blendernation.com/2023/09/21/free-cc0-3d-models-by-sharetextures/)
- [S] ambientCG: CC0 library, mainly 2,000+ PBR materials and HDRIs, with some models. — [ambientCG](https://ambientcg.com/)
- [S] BlenderKit has a CC0 subset alongside its Royalty Free licence; CC0 items may be reused for any purpose. — [BlenderKit licences](https://www.blendkit.com/docs/licenses/)
- [2, unverified provenance] Newer sites advertise large free GLB furniture sets (e.g. "FurniMesh" 14,200+ GLB furniture models; Mixos 376 CC0 GLBs; image3d.io CC0 furniture). I did not verify who made these models, whether they are AI-generated, or the licence terms. — [FurniMesh](https://furnimesh.com/library/format/glb/); [Mixos](https://www.mixos.io/free-models); [image3d.io](https://image3d.io/models/furniture/)

### Inferences
- Shippable-today free pool (my estimate, not a published figure): Poly Haven ~146 + ShareTextures (some fraction of 150) + ABO's several thousand furniture/home items gives a realistic seed of a few thousand models, dominated by ABO. ABO is the single most valuable free source: artist-made, PBR, already GLB, real products with listed dimensions, and CC BY 4.0 permits commercial redistribution with attribution (an in-app credits/licences page naming Amazon.com and the licence, plus a note that models were optimised, is the practical compliance step).
- ABO caveats: models are Amazon private-label/catalogue products (mid-market styling, many near-duplicate variants), textures are 4K (must be down-res'd/KTX2-compressed for web), and the CC BY licence covers the dataset's copyright, not any design/trademark rights in product names; drop brand names from the UI to be safe.
- Poly Haven is the cleanest licence (CC0, no attribution) and highest fidelity, but small and stylistically narrow (worn/vintage), so it is decor seasoning rather than a catalogue backbone. Its models are film-quality and need decimation for web.
- Objaverse/Sketchfab CC-BY is the largest pool numerically (~88% of Objaverse 1.0 is CC BY), but: (a) every model needs individual attribution to its uploader; (b) quality, scale and PBR correctness are inconsistent (scans, low-poly, stylised); (c) provenance risk is real, since uploaders can and do post ripped or branded-design models under CC licences they have no right to grant. A commercial app should hand-curate from identifiable authors rather than bulk-ingest. Objaverse itself adds nothing legally beyond the original Sketchfab licences.
- Sketchfab's future as a CC source is uncertain after the August 2026 KitBash acquisition; anything to be used should be downloaded with its licence metadata archived at download time (CC licences are irrevocable for copies already obtained).
- 3D-FUTURE, HSSD and the IKEA dataset are unusable in a commercial product on their face (research-only / NC / NC-SA). They are still useful internally as style and category references, but 3D-FUTURE's "no distribution, no external services" clause makes even indirect use risky.
- Google Scanned Objects and Smithsonian are licence-clean but nearly irrelevant for furniture; GSO could supply small tabletop clutter (CC BY).
- Kenney is licence-clean but stylised low-poly; only relevant as placeholders.

### Gaps
- Per-category 3D-model counts for ABO (how many chairs, sofas, tables, lamps, beds, rugs) were not retrieved; the paper PDF was too large to fetch. The listings metadata (`product_type`) can be counted directly after download.
- Whether ABO GLBs are consistently authored at real-world metric scale was not confirmed from the dataset page (dimensions exist as listing metadata; needs a spot check).
- No published count of CC0/CC-BY downloadable models in Sketchfab's "Furniture & Home" category; requires querying the Sketchfab API.
- Exact total Poly Haven model count and the sub-category split are approximate (derived from an automated read of the API JSON).
- Smithsonian's own 3d.si.edu count of furniture items not verified.
- Provenance and licence of FurniMesh / Mixos / image3d.io not verified; treat as unknown until checked.

## Key Question 2: Paid marketplaces and packs — what the standard licences say about delivering models to a browser client

### Takeaway
Most paid stock licences allow use "in an app/game" only if end users cannot extract the model, and several are explicit that open formats such as glTF delivered to a client do not qualify (TurboSquid), or that room-design software is a prohibited use (Poliigon), or that interactive use is not a listed permitted use at all (Design Connected). No mainstream marketplace's standard licence cleanly covers serving plain GLB files from a three.js app; the workable routes are obfuscated/custom-format delivery plus a careful per-marketplace reading, a negotiated enterprise licence, or buying from individual artists under a custom licence.

### Cited Findings

**TurboSquid (Shutterstock)**
- [P] The licence allows 3D models to be incorporated into games, virtual worlds, simulations and mobile/desktop/web applications, but requires that models be contained in proprietary formats that cannot be opened in publicly available software or frameworks or extracted without reverse engineering, and that they stay inside the interactive experience. — [TurboSquid 3D Model License](https://blog.turbosquid.com/turbosquid-3d-model-license/)
- [P] On WebGL specifically: WebGL exports from Unity, Unreal and Lumberyard are permitted; other open formats are prohibited; an exception allows WebGL use if the application converts content from the DCC format into a JavaScript/other non-standard format, subject to protective guidelines. — [TurboSquid 3D Model License](https://blog.turbosquid.com/turbosquid-3d-model-license/)
- [P] Redistribution to third parties is prohibited except in the form of a permitted "Creation". Models marked "Editorial Uses Only" (typically branded products) cannot be used commercially unless you own the depicted IP. — [TurboSquid 3D Model License](https://blog.turbosquid.com/turbosquid-3d-model-license/)
- [P] Licence tiers change indemnification and privacy, not usage rights: Standard (included, indemnity up to $10k), Small Business (+$149 per model, up to $250k), Enterprise (+$299 per model, up to $1M, waiver of injunctive relief). — [TurboSquid licence tiers](https://blog.turbosquid.com/turbosquid-license-tiers/)
- [S] Typical furniture pricing: individual sofas/chairs roughly $5–$59, collections up to ~$249; 46,000+ sofa models listed (free and paid). — [TurboSquid sofa category](https://www.turbosquid.com/3d-model/sofa)

**CGTrader**
- [P] Royalty Free licence (s.21A): products may be used in a game/app if contained in a proprietary format and displayed during play; if used in software products the buyer must take all commercially reasonable measures to prevent end users accessing the product (examples given: proprietary formats, encryption, password-protected databases); for virtual worlds/applications/platforms the product must not be downloadable by users in the form it was downloaded from CGTrader. — [CGTrader Terms](https://www.cgtrader.com/pages/terms-and-conditions)
- [P] Other licence types exist per listing: Editorial (s.22, no commercial use), Custom licence (s.23A, seller-defined restrictions by industry, size, use case) and "Royalty Free, No AI" (s.21B). — [CGTrader Terms](https://www.cgtrader.com/pages/terms-and-conditions)

**Fab (Epic) and Sketchfab Standard**
- [S] Fab Standard License: a Project incorporating content may be distributed to end users (e.g. software applications/games to the public); content in object-code form may be distributed only as an inseparable part of a Project, and end users may use it solely as incorporated in the Project; standalone redistribution is prohibited. (fab.com/eula returned 403 to my fetch; wording is from search-result extracts of that page.) — [Fab Standard License](https://www.fab.com/eula)
- [P] Fab offers three licence types: CC BY (free listings only), Standard (free or paid) and legacy UE Marketplace. Standard has two price tiers: Personal (buyer has not exceeded $100,000 gross revenue in the last 12 months) and Professional (above that). — [Fab licences and pricing](https://dev.epicgames.com/documentation/fab/licenses-and-pricing-in-fab)
- [P] Sketchfab Standard licence (legacy store): prohibits making the licensed material available as a stand-alone file or in any way that lets third parties use, download, extract or access it as a stand-alone file; also prohibits distributing works whose primary value is the model itself. Editorial licence bars commercial use. — [Sketchfab licences](https://sketchfab.com/licenses)

**Poliigon**
- [P] Poliigon's licensing help says assets cannot be used in design software or games where users have direct or indirect access to the assets for designing rooms, buildings, levels or scenes; assets cannot be shared or redistributed even if modified; the Enterprise licence can be customised to include otherwise restricted use cases (contact sales). — [Poliigon asset use and licensing](https://help.poliigon.com/en/articles/8749749-asset-use-licensing); [Poliigon terms](https://www.poliigon.com/terms)

**Design Connected**
- [P] EULA grants a perpetual, non-transferable licence for enumerated "Permitted Uses" (CG visualisation, advertising, film/video, print); interactive software, games or configurators are not listed. It prohibits incorporating content in any product that makes it available such that a person can extract, access or reproduce it as an electronic file, and prohibits sublicensing or transfer. No extended licence is described in the standard EULA. — [Design Connected General Terms of Use / EULA](https://www.designconnected.com/page/view/eula)
- [S] Design Connected also sells through TurboSquid (where TurboSquid's licence and tiers apply), and has brand-specific catalogues (IKEA, Herman Miller, Muuto, West Elm). — [Design Connected on TurboSquid](https://www.turbosquid.com/Search/Artists/Designconnected); [DC brand catalogue: Muuto](https://www.designconnected.com/catalog/brand/Muuto)

**Dimensiva**
- [P] Licence allows use in private or commercial projects, but content cannot be sold, distributed or redistributed in original or other format, and modified versions remain derivatives that cannot be distributed. Real-time/app/web use is not addressed explicitly. — [Dimensiva licence](https://dimensiva.com/license/)
- [S] Pricing is subscription-based: roughly €49–56 for one month up to €289–398 for one year (tier-dependent), unlimited downloads, 100+ new PRO models per month; free tier with free models. — [Dimensiva pricing](https://dimensiva.com/pricing/)

**3dsky**
- [S] PRO models cost about $7 each (minimum order $14); site rules forbid any action that passes models on to third parties, including building shared libraries. The terms page I tried returned 404; the rules page fetched does not state permitted end uses. Models are primarily 3ds Max + V-Ray/Corona archviz assets. — [3dsky FAQ: buying models](https://3dsky.org/faq/category/10001/show); [3dsky rules](https://3dsky.org/faq/175/show)

**Evermotion**
- [S] EULA allows products to be used as part of a game if in a proprietary format and displayed during play, with a credit that models come from Evermotion; it forbids including products in asset libraries, repositories or datasets accessible to third parties. (Page returned 403 to direct fetch; from search extract.) — [Evermotion EULA](https://evermotion.org/shop/page/5/eula)

**KitBash3D**
- [P] Licence tiers by company size (Individual; Small Business 2–50 employees; Enterprise 51+; subscription "Teams" for 2+). Assets must be incorporated into larger works with substantial additional content; raw assets cannot be resold or redistributed; subscription assets may not be used for AI/ML. Kits are mostly environment/architecture sets rather than furniture catalogues. — [KitBash3D: which licence do I need](https://help.kitbash3d.com/en/articles/6449682-how-do-i-know-which-license-i-need)

**BlenderKit**
- [P] Two licences: Royalty Free (commercial use without credit; no resale of the asset in the same form, e.g. as a 3D model, asset pack or game level on a marketplace, even if modified) and CC0. — [BlenderKit licences](https://www.blendkit.com/docs/licenses/)
- [2] A secondary summary states that Royalty Free assets used in games must not be extractable. — [note.com licence summary](https://note.com/yoruturusi_3312/n/n1c843b8547cd?hl=en)
- [2] ~48,000 assets are free (Sept 2025); Full Plan subscription reported at around $9/month (date of that figure unclear). Assets are .blend files and need export/bake to glTF. — [CG Channel, Sept 2025](https://www.cgchannel.com/2025/09/get-over-48000-free-3d-models-materials-and-hdris-from-blenderkit/); [BlenderKit pricing](https://www.blenderkit.com/plans/pricing/)

### Inferences
- Interpretation (not legal advice): delivering a plain `.glb` over HTTP to a browser is the paradigm case of an "open format" that can be "opened in a publicly available framework" (three.js, Blender, Windows 3D Viewer). On the licence text, that conflicts with TurboSquid's proprietary-format requirement, CGTrader's "commercially reasonable measures" requirement, Sketchfab Standard's no-extractable-file clause, Design Connected's no-extraction clause, and Evermotion's proprietary-format condition.
- TurboSquid's WebGL exception points to the compliant engineering pattern: convert assets at build time into a non-standard container (custom binary layout, encrypted/obfuscated chunks, Draco/meshopt + KTX2 with a custom wrapper and a runtime-only decoder key) so the file fetched by the browser is not directly importable. This is obfuscation rather than security, but the licence language targets "cannot be opened... without reverse engineering" and "commercially reasonable measures", not perfect DRM. Whether a given scheme satisfies a marketplace is ultimately their call; get it confirmed in writing for a library-scale purchase.
- A room planner is also at risk under the "primary value" tests (Sketchfab Standard clause; Poliigon's explicit ban on room-design software). A product whose core feature is letting users place the purchased models is closer to "redistributing a model library with a viewer" than a game that uses props incidentally. Poliigon is a clear no without an enterprise deal; Design Connected and Dimensiva need a negotiated licence; TurboSquid/CGTrader are arguable but should be confirmed.
- Fab Standard is the most app-friendly wording found (distribution to end users as an inseparable part of a Project is expressly permitted), but "inseparable/object code" again suggests non-extractable packaging, and Fab's catalogue is game-prop oriented with Unreal-format bias. Fab CC BY listings are freely redistributable with attribution.
- TurboSquid's higher tiers ($149/$299 per model) buy indemnity, not web-delivery rights; they do not fix the open-format issue.
- Cost scale (my arithmetic from cited prices): 500 stock furniture models at $10–$40 each is roughly $5k–$20k on TurboSquid/CGTrader at Standard tier, before conversion work (most are high-poly V-Ray/Corona archviz assets needing retopology, UV/bake to PBR and glTF export, which can cost more than the purchase). 3dsky at ~$7/model is cheapest per model but is the least suitable licence/format-wise.
- Archviz libraries (3dsky, Design Connected, Dimensiva, Evermotion) are the best source of on-trend, real-designer furniture, but they are also the ones whose licences are narrowest and whose models depict real branded designs (design-right/trademark exposure independent of the model licence).

### Gaps
- Could not fetch the full Fab EULA (403) or Evermotion EULA (403); clause wording above comes from search extracts and should be re-read directly before relying on it.
- 3dsky's actual licence agreement text was not located (terms URL 404); permitted end uses unconfirmed.
- CGTrader typical furniture prices and catalogue counts per category not collected.
- KitBash3D kit prices and full EULA PDF text on interactive/app use not retrieved.
- BlenderKit's licensing FAQ (the page that addresses games/extraction directly) was not fetched; the extraction requirement is from a secondary source.
- No marketplace publishes a price for a "web redistribution" extended licence; all are "contact us". No evidence found of what such deals cost.
- Poliigon's model count for furniture and its Enterprise pricing not found.

## Key Question 3: Furniture-manufacturer, retailer and platform models

### Takeaway
Brands and their content platforms do publish 3D models, but almost always for planning/specification by designers or for embedding the brand's own viewer, not for a third party to rehost in its own product; using them requires a direct agreement with each brand or platform. The realistic routes are affiliate/partner programmes (historically Wayfair's 3D API), configurator-platform SDKs (Roomle, pCon/OFML), or bilateral brand partnerships, not downloading from brand sites or 3D Warehouse.

### Cited Findings
- [P] Herman Miller publishes product models for planning: Revit families, DWG, SIF and GLB downloads from its 3D configurator, plus renderings. The FAQ page states no redistribution or third-party software terms; contact is the CAD support team. — [Herman Miller 3D models FAQ](https://www.hermanmiller.com/resources/3d-models-and-planning-tools/faq/); [Herman Miller product models](https://www.hermanmiller.com/resources/3d-models-and-planning-tools/product-models/system/seating/)
- [S] Vitra distributes planning data through OFML/pCon (registration required, takes a few days) and its own configuration system downloads. — [Vitra Configuration System downloads](https://vcs.vitra.com/downloads/); [Vitra website terms](https://www.vitra.com/en-us/website-terms-of-use)
- [2] CAD Forum's catalogue of Vitra blocks states the blocks are for personal or company design use only and that distributing catalogue content elsewhere is prohibited (this is the third-party catalogue's wording, not Vitra's own licence). — [CAD Forum Vitra catalogue](https://www.cadforum.cz/catalog_en/?vyr=Vitra)
- [S] Muuto, HAY, West Elm, IKEA and Herman Miller models found on TurboSquid, CGTrader, 3dsky and Design Connected are third-party recreations sold under those marketplaces' licences, not brand-issued licences. — [Design Connected: Muuto](https://www.designconnected.com/catalog/brand/Muuto); [Design Connected: IKEA](https://www.designconnected.com/catalog/brand/IKEA); [TurboSquid: Muuto](https://www.turbosquid.com/3d-model/muuto)
- [2] IKEA: more than 10,000 IKEA products are 3D-enabled (GLB-based viewer; integrated into Google Search in April 2023). IKEA Kreativ (launched June 2022 in the US) offers 50+ 3D showrooms and room scanning, limited to IKEA products. — [9to5Google, Apr 2023](https://9to5google.com/2023/04/17/ikea-3d-google/); [Ingka newsroom on IKEA Kreativ](https://www.ingka.com/newsroom/ikea-launches-new-ai-powered-experience-empowering-customers-to-create-lifelike-room-designs/)
- [2] Unofficial scripts/extensions can save the GLBs from IKEA product pages; the developer of the best-known one points to IKEA's terms of use and recommends personal use only. IKEA's only openly licensed 3D data (the assembly dataset) is NC and reserves IKEA's design IP. — [3Druck on IKEA model downloader](https://3druck.com/en/programs/ikea-3d-model-downloader-open-source-script-saves-furniture-models-as-glb-files-59158436/); [IKEA-3D-Model-Download-Button](https://github.com/apinanaivot/IKEA-3D-Model-Download-Button); [IKEA3DAssemblyDataset](https://github.com/IKEA/IKEA3DAssemblyDataset)
- [P] Wayfair opened a 3D Model API to developers in October 2016 (~10,000 products then; FBX/Unity bundles), with tiered access, an enterprise licence agreement on request, and an affiliate model where apps send purchases to Wayfair. — [Wayfair 3D Model API (Oct 2016)](https://www.aboutwayfair.com/tech-innovation/wayfairs-3d-model-api); [Wayfair investor release, 2016](https://investor.wayfair.com/news/news-details/2016/Wayfair-Opens-3D-Model-API-to-Developer-Community/default.aspx)
- [S] A later Wayfair notice says product-information endpoints were deprecated, models are now served only as GLB/OBJ, and new OBJ generation has stopped in favour of GLB. (Date of notice not established.) — [Wayfair realtime models page](https://www.aboutwayfair.com/realtime-models)
- [2] West Elm / Pottery Barn / Williams-Sonoma room planner runs on Outward, the 3D platform Williams-Sonoma acquired in 2017; it is an in-house asset pipeline, not an open library. — [Home Textiles Today on Design Crew Room Planner](https://www.hometextilestoday.com/industry-news/williams-sonoma-debuts-design-crew-room-planner/)
- [P] SketchUp 3D Warehouse: models may be used in commercial "Combined Works" (e.g. an architect's deliverable), but the Terms FAQ treats incorporating models into a website for members' use as impermissible aggregation, and bars transferring models as standalone items or building competing model libraries. — [3D Warehouse Terms of Use FAQ](https://help.sketchup.com/en/3d-warehouse/3d-warehouse-terms-use-faq); [3D Warehouse ToS](https://3dwarehouse.sketchup.com/tos)
- [S] BIMobject hosts manufacturer BIM objects; manufacturers retain rights in their content, and BIMobject's user terms restrict access to its own interfaces. Content is BIM-format (Revit/IFC etc.), aimed at specification. — [BIMobject Terms of Service (EULA)](https://business.bimobject.com/terms-of-service-eula); [BIMobject Cloud](https://info.bimobject.com/solutions/bimobject-cloud)
- [2] pCon.planner (EasternGraphics) uses the OFML data standard commissioned by the German office-furniture association in 1998; manufacturer OFML catalogues are distributed to registered users. — [pCon.planner (Wikipedia)](https://en.wikipedia.org/wiki/PCon.planner)
- [S] Roomle's Rubens configurator can be integrated into third-party applications via iframe embed or SDK and REST API, and imports IDM and OFML manufacturer data. — [Roomle Rubens docs](https://docs.roomle.com/rubens); [Roomle IDM importer](https://www.roomle.com/en/blog/idm-importer); [Roomle furniture](https://www.roomle.com/en/industries/furniture)
- [2] Cylindo, Threekit and Intiaro are 3D visualisation/configuration vendors serving furniture brands and retailers (they create and host the brand's 3D assets and viewers). — [Cylindo vs Intiaro](https://www.cylindo.com/cylindo-vs-intiaro/); [Salsita: furniture configurator software 2026](https://salsita.ai/blog/top-10-best-furniture-configurator-software-of-2026)
- [S] Precedent that brand-matched catalogues are commercially built: Roomstyler's and RoomSketcher's libraries include models of branded products (IKEA, Crate and Barrel, West Elm, Pottery Barn etc.), and HSSD's objects were authored in Floorplanner to match real brands. — [RoomSketcher furniture library](https://www.roomsketcher.com/features/pro-features/more-furniture/); [HSSD project page](https://3dlg-hcvc.github.io/hssd/)

### Inferences
- No brand or platform reviewed offers an open licence that lets a third-party app rehost its models. Brand downloads exist to get products specified; the assets belong to the brand, and scraping product-page GLBs (IKEA, Wayfair, etc.) would be a terms-of-use and copyright problem.
- 3D Warehouse is effectively excluded for a room-planner library: the aggregation prohibition describes this use case almost exactly.
- The models in Cylindo/Threekit/Intiaro are owned by each brand client; these vendors are a channel to brands (and potential integration partners), not a content source one can license in bulk. Any syndication would be brand-by-brand.
- The commercially proven pattern for real-product content is partnership: the planner gets the brand's GLBs (or builds them) in exchange for product placement/affiliate links. Wayfair's API was the clearest historic example; its current availability to new developers is unverified.
- Roomle/pCon are B2B routes with real manufacturer catalogues, but the data is tied to their runtimes (OFML/IDM configurators, Rubens SDK) and to contract-office furniture; integrating means embedding their viewer or licensing their SDK, not loading files into a custom three.js scene.
- Even with a clean model licence, modelling a recognisable branded design (e.g. an Eames lounge chair) and naming it carries trademark and design-right exposure; marketplaces flag such models "editorial". Generic, unbranded designs avoid this.

### Gaps
- Did not find explicit licence text for Herman Miller, Vitra, Muuto or HAY 3D downloads; their terms for third-party app use are unconfirmed (likely governed by general website terms).
- Current status, eligibility and licence terms of Wayfair's 3D model API in 2026 not verified.
- BIMobject's exact EULA clauses on redistribution not retrieved.
- No public pricing or content-licensing terms found for Roomle, pCon, Cylindo, Threekit or Intiaro for third-party catalogue access.
- Number of products in IKEA Kreativ specifically (as opposed to IKEA's 10,000+ 3D-enabled products overall) not found.

## Key Question 4: Commissioning custom models — cost and turnaround (2025–2026)

### Takeaway
A web/AR-ready PBR furniture model costs roughly $100–$500 from freelancers or studios for typical pieces, with offshore freelancers at $30–$80 and premium or complex pieces at $600–$3,500+; turnaround is about 3–7 days per model, and batches of 20+ earn 15–30% discounts. Commissioned work is the only route that gives clean, fully owned rights for plain-GLB delivery.

### Cited Findings
- [P, vendor blog, dated 19 May 2026] Per-model price by complexity: simple stool/side table $50–$150; dining chair $100–$250; sofa or bed frame $200–$500; modular systems/storage $300–$900; complex sectionals/outdoor sets $600–$1,500; luxury pieces $1,000–$3,500+. — [Orbe3D: 3D furniture modeling costs 2026](https://www.orbe3d.com/3d-furniture-modeling-costs/)
- [P, same source] By provider: offshore freelancer $30–$80/model (variable quality, high risk); mid-level freelancer $100–$300; specialised studio $200–$800 (consistent quality); enterprise/branded $500–$3,000+. Hourly: offshore $15–$35, Eastern Europe $35–$65, Western $75–$150, premium agencies $120–$250. — [Orbe3D](https://www.orbe3d.com/3d-furniture-modeling-costs/)
- [P, same source] Turnaround 3–7 days standard; 24–48 h rush adds 30–50%; batch orders of 20+ get 15–30% off; each additional material variant adds 20–40%; AR/real-time optimisation adds 30–50% over a base (offline-render) model; rework items: re-texturing $80–$200, AR conversion $100–$300, dimension corrections $50–$150. — [Orbe3D](https://www.orbe3d.com/3d-furniture-modeling-costs/)
- [S] Related search extract from the same vendor family: PBR texturing (base colour, roughness, normal) typically adds $50–$150 and 2–4 days; mid-tier pieces 4–6 days, premium 10–20 days. — [Orbe3D: furniture rendering pricing models](https://orbe3d.com/furniture-rendering-pricing-models/)
- [2] Coohom advertises a custom modelling service for its platform customers. — [Coohom custom modeling](https://www.coohom.com/case/custom-modeling)

### Inferences
- Budget arithmetic from the cited ranges (my calculation): 300 generic models at a blended $150–$300 with a 20% batch discount is roughly $36k–$72k; 1,000 models roughly $120k–$240k. Offshore rates could cut this by half or more at higher QA cost.
- The pricing source is a modelling studio with a commercial interest; treat figures as indicative mid-market rates rather than a neutral survey. They are consistent with long-standing marketplace freelance rates.
- Commissioning with a work-for-hire/IP-assignment contract removes the extraction problem entirely: owned models can be shipped as plain GLB, variant-swapped, and reused for AI features. It also lets the team enforce one spec (metric scale, origin at floor centre, triangle budget, texel density, KTX2, material slot naming), which matters more for a planner than raw fidelity.
- A hybrid is likely cheapest: seed with ABO/Poly Haven, then commission the hero categories (sofas, beds, dining sets) and gaps.

### Gaps
- No neutral (non-vendor) 2025–2026 survey of per-model commissioning prices found; Fiverr/Upwork and game-outsourcing guides were surfaced but not read.
- No sourced data on per-model cost when optimising purchased archviz models to web-ready GLB (retopo + bake), beyond the "AR conversion $100–$300" line.
- AI text/image-to-3D generation (Meshy, etc.) as a lower-cost alternative was out of scope and not researched; licence and quality status unknown here.

## Key Question 5: How many models do comparable room planners ship?

### Takeaway
Consumer planners range from about 5,000–10,000 items (Planner 5D) to 100,000+ (Homestyler, Roomstyler) and several hundred thousand to "over a million" for platforms fed by manufacturer and user uploads (Floorplanner, Coohom). Headline numbers are marketing claims that mix furniture with materials, decor, variants and user-uploaded content.

### Cited Findings
- [2] Planner 5D: review sites in 2026 report about 5,000 items in the free tier (described as half the catalogue) and 8,000 to 10,000+ in paid tiers. — [ToolChase Planner 5D review 2026](https://toolchase.com/tool/planner-5d/); [SaaSworthy Planner 5D](https://www.saasworthy.com/product/planner-5d)
- [P] Homestyler: its model library page claims over 100,000 3D models and 2D textures across furniture, lamps, accessories. — [Homestyler model library](https://www.homestyler.com/modelLibrary)
- [P/S] Coohom: marketing copy claims over one million ready 3D models, while one of its own article titles cites 45,000 3D models (conflicting figures from the same vendor, probably different scopes or dates). — [Coohom: vast library of 3D models](https://www.coohom.com/article/vast-library-of-3d-models); [Coohom 3D models](https://www.coohom.com/3d-models)
- [2] Roomstyler: 120,000+ items, described as models of real branded products. — [SourceForge Roomstyler listing](https://sourceforge.net/software/product/Roomstyler/)
- [S] Floorplanner: library of over 260,000 3D models, including brand/manufacturer items and generic decor. — [Floorplanner](https://floorplanner.com/)
- [S] RoomSketcher: "thousands" of furniture and material items, including brand-name furniture. — [RoomSketcher furniture library](https://www.roomsketcher.com/features/pro-features/more-furniture/)
- [2] IKEA: 10,000+ products 3D-enabled (2023); Kreativ limited to IKEA range with 50+ showrooms. — [9to5Google, Apr 2023](https://9to5google.com/2023/04/17/ikea-3d-google/); [Ingka newsroom](https://www.ingka.com/newsroom/ikea-launches-new-ai-powered-experience-empowering-customers-to-create-lifelike-room-designs/)
- [S] Reference point for scene realism at small scale: HSSD's 211 fully furnished houses use 18,656 objects in 466 categories. — [HSSD project page](https://3dlg-hcvc.github.io/hssd/)

### Inferences
- A credible launch catalogue does not need six figures. Planner 5D, the closest consumer comparable, operates with roughly 5k–10k items; a curated library of a few hundred to ~1,000 well-made models with material/colour variants (which multiply perceived catalogue size cheaply) is a defensible MVP. This threshold is my judgement, not a sourced benchmark.
- The 100k+ libraries are fed by retail-catalogue pipelines (Homestyler/3D-FUTURE come from Alibaba's furniture ecosystem; Coohom from manufacturer uploads; Roomstyler/Floorplanner from brand recreations and user uploads). They are not achievable through stock purchase or commissioning and are not the right yardstick for a seed library.
- Coverage breadth matters more than count: HSSD needed 466 categories to furnish realistic homes, suggesting the seed should span seating, tables, beds, storage, lighting, rugs, curtains, plants, wall art, kitchen/bath fixtures, appliances and small decor, with depth concentrated in the high-visibility categories.

### Gaps
- No primary, audited model counts for Planner 5D (figures are from review aggregators) or a per-category breakdown for any competitor.
- Coohom's "one million" vs "45,000" discrepancy unresolved.
- How competitors license their catalogues (in-house, manufacturer-supplied, user-uploaded) is not publicly documented beyond the fragments above.
- IKEA Kreativ's in-tool catalogue size not found.
