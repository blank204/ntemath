# Image manifest — candidates, licences, and how to get the rest

---

## 0. WHAT IS ACTUALLY ON THE PAGE (added 2026-08-01)

One image ships, and it is §1's: **MODIS Terra true colour, James Bay,
2024-08-12**, at the exact demo bounding box. It is the page's full-bleed field,
graded to a duotone by `tools/img/grade_plate.py`, at
`web/public/img/james-bay-plate.{jpg,webp}` — 56 KB and 15 KB, against the
400 KB budget below. Credited on the page in the end-matter section, as data in
`web/src/rail/attribution.ts`, and held there by `web/tests/attribution.test.ts`:
an image in `public/img` with no credit fails the suite, and so does a credit
whose file has gone.

**Picking the date needed a sweep, not a guess.** Eleven frames were fetched
across five dates and two layers and scored for cloud fraction and swath gaps
before any of them were opened. Most were unusable: 2025-07-15 is 64% cloud,
2024-07-20 is 75%, and several `Bands721` frames came back with a hard diagonal
swath edge and a 20–30% black wedge where the pass missed the box. 2024-08-12
true colour came back at 0% cloud and no gap, and it is genuinely striking —
the coast, the lake stipple, and a river sediment plume.

**A trap worth writing down: the cloud score lies on false colour.** The scorer
looked for pixels that were bright *and desaturated*, which is what cloud looks
like in true colour. In `Bands721` cloud renders **cyan**, so a frame that is
almost entirely cloud scored 0.8% and ranked near the top. It was caught only by
opening it. If you re-run that sweep, either score false-colour frames for cyan
or do not trust the number — which is the same warning this file already opens
with, now with a measured example behind it.


Searched 2026-08-01. Every source here is keyless and permissively licensed;
nothing needs an account and nothing needs paying for.

**READ THIS FIRST: the candidates below were found by metadata — resolution,
licence, category — and have NOT been looked at.** Titles lie. Eyeball every
one before it goes on the page; that is a ten-minute job and skipping it is
exactly how the first visual pass went wrong.

Attribution goes in the existing block in `RunPanel`'s provenance panel and in
the site footer. CC BY and CC BY-SA both require credit; CC BY-SA additionally
requires that *modifications to the image itself* be shared alike, which is why
the preference order below puts public domain first.

---

## 1. The one that matters most: the real box, free, public domain

NASA GIBS serves a true-colour satellite frame of **the actual James Bay
demo box** at any size, no key, public domain. This beats any stock photo of
somewhere else, because it is the place the model is actually siting towers in.

```
https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot
  &LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor
  &CRS=EPSG:4326&TIME=2025-07-15
  &BBOX=51.0,-80.8,53.2,-76.2      # south,west,north,east — the region box
  &WIDTH=2400&HEIGHT=1150&FORMAT=image/jpeg
```

Verified HTTP 200, `image/jpeg`. Swap `LAYERS` for
`VIIRS_SNPP_CorrectedReflectance_TrueColor` (sharper), or for
`MODIS_Terra_CorrectedReflectance_Bands721` — the false-colour band
combination where **burn scars read dark red and smoke goes transparent**,
which is a genuinely striking image for the fire beats and is real data.

Change `TIME` to any date. A **cloud-free summer day** is what you want; try
2025-07-15, 2025-08-02, 2024-07-20 and keep the clearest. `WIDTH`/`HEIGHT`
must keep the box's 2.09:1 ratio or it stretches.

**This is the site's photographic layer and it costs nothing.** It is also the
only image on the page that can honestly be captioned "this is the region".

---

## 2. Candidates found (Wikimedia Commons, all commercially usable)

### Night lightning — the cold open

| px | licence | file |
|---|---|---|
| 6078×4052 | CC BY 4.0 | [Delaware Seashore Evening Storm](https://upload.wikimedia.org/wikipedia/commons/4/45/Delaware_Seashore_Evening_Storm_-_Flickr_-_aparlette.jpg) |
| 5681×3196 | CC BY 2.0 | [Port-la-Nouvelle overnight storm with lightning](https://upload.wikimedia.org/wikipedia/commons/c/c2/Port_and_lighthouse_overnight_storm_with_lightning_in_Port-la-Nouvelle.jpg) |
| 4096×3072 | CC BY-SA 4.0 | [Nighttime Thunderstorm and Cloud-to-Cloud Lightning (41802)](https://upload.wikimedia.org/wikipedia/commons/4/4e/Nighttime_Thunderstorm_and_Cloud-to-Cloud_Lightning_%2841802%29.jpg) |

Both of the top two are **coastal**, not boreal. At full-bleed with type over
them, and graded to the storm-blue world, the horizon is what reads, not the
biome — but check that before committing. The third is genuinely cloud-to-cloud,
which is fine visually and must never be captioned as an ignition source.

### Storm front — the wide plate

| px | licence | file |
|---|---|---|
| 12712×3215 | CC BY 2.0 | [One day after TS Colin](https://upload.wikimedia.org/wikipedia/commons/a/a8/One_day_after_TS_Colin%2C_this._%2826922631914%29.jpg) |
| 3071×2048 | Public domain | [Supercell thunderstorm in Kansas](https://upload.wikimedia.org/wikipedia/commons/f/f8/Supercell-thunderstorm-in-Kansas.jpg) |

The first is a 4:1 panorama — the natural full-bleed hero plate, and wide
enough to crop hard and still have pixels.

### Forest floor — the holdover beat

| px | licence | file |
|---|---|---|
| 6000×4000 | CC BY-SA 4.0 | [Sphagnum (peat bog)](https://upload.wikimedia.org/wikipedia/commons/3/3e/Sphagnum_%28peat_bog%29.jpg) |
| 6000×4000 | CC BY-SA 4.0 | [Tanner Moor 08](https://upload.wikimedia.org/wikipedia/commons/7/75/Liebenau_-_Tanner_Moor_-_08.jpg) |
| 6000×4000 | CC BY-SA 4.0 | [Tanner Moor 10](https://upload.wikimedia.org/wikipedia/commons/f/f6/Liebenau_-_Tanner_Moor_-_10.jpg) |

Sphagnum peat is exactly right for holdover — it is the material a stroke
smoulders in for days. `Category:Sphagnum` had 68 usable candidates; these are
just the largest three.

### Lattice mast — texture only

| px | licence | file |
|---|---|---|
| 8256×5504 | CC BY 4.0 | [Radio towers on Bear Hill, Waltham MA](https://upload.wikimedia.org/wikipedia/commons/e/e5/Radio_towers_on_Bear_Hill%2C_Waltham%2C_MA_September_2025.jpg) |
| 6960×4640 | CC BY 4.0 | [Transmission lines at sunset](https://upload.wikimedia.org/wikipedia/commons/5/5c/Transmission_Lines_at_Sunset.jpg) |

**Never captioned as Pyra hardware.** Silhouette or blurred background only.
The 3D tower is our tower; a photograph of somebody else's mast presented as
ours is the one thing this project has consistently refused to do.

### James Bay, on the ground

| px | licence | file |
|---|---|---|
| 4000×2672 | CC BY-SA 4.0 | [James Bay Road Hazard](https://upload.wikimedia.org/wikipedia/commons/2/27/James_Bay_Road_Hazard.jpg) |
| 2983×2637 | Public domain | [Ice on James Bay (MODIS 2019-12-20)](https://upload.wikimedia.org/wikipedia/commons/f/f1/Ice_on_James_Bay_%28MODIS_2019-12-20%29.jpg) |

---

## 3. Still missing, and how to finish the search

**Boreal aerial** and **burn scar** came back empty or wrong — the Quebec
aerial categories are full of suburbs, and `Category:Forest fires in Quebec`
has nothing large enough. Three routes, in order of likely yield:

1. **NASA Earth Observatory** — `https://images-api.nasa.gov/search?q=...`,
   verified working, public domain, and it is full of boreal fire and smoke
   imagery. Try `boreal fire smoke Canada`, `Quebec wildfires 2023`,
   `taiga lakes`. The 2023 Quebec fires are extremely well documented there and
   are *the* event this whole project points at.
2. **GIBS false colour** (§1) with `Bands721` on a 2023 fire date — a real burn
   scar over the real region, which no stock photo can match for honesty.
3. **Openverse** — `https://api.openverse.org/v1/images/?q=...&license_type=commercial`,
   keyless, aggregates Flickr. Better than Commons for landscape photography;
   worse metadata. Filter `width>=3000` client-side.

Commons search is fussy: `filetype:bitmap` plus three or more words returns
nothing. Prefer `generator=categorymembers` on a category (`Category:Taiga`,
`Category:Sphagnum`) over `generator=search` — that is what produced every
usable hit above.

---

## 4. Fetching them

```bash
mkdir -p web/public/img
# One example; the rest are in the tables above.
curl -L -A "PyraNTE/1.0" -o web/public/img/lightning-hero.jpg \
  "https://upload.wikimedia.org/wikipedia/commons/4/45/Delaware_Seashore_Evening_Storm_-_Flickr_-_aparlette.jpg"
```

Then: grade to the storm-blue world, crop to both 21:9 (site) and 2480×3508
(the ad), and export AVIF + WebP with a JPEG fallback. A 6000 px original must
not ship — target ~2400 px on the long edge for the full-bleed plates and
budget under 400 KB each, or the page will be slower than the model it runs.

Record every file's source URL, author and licence in the attribution block as
it is added. A photograph whose licence nobody wrote down is a photograph that
has to come off the page later.
