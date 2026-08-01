"""Strip a downloaded glTF down to geometry, for use under this site's own lighting.

Additive tooling, in `tools/` — repo-root Python is read-only.

WHY STRIP THE TEXTURES. Two reasons, and the second is the important one.

The cheap reason is weight: the five models this was built for arrive as 0.02 to
8.6 MB archives, of which the geometry is 20 KB to 900 KB. Everything else is
albedo/normal/roughness maps at a resolution nobody will see on a part that
renders 80 px tall behind a headline.

The real reason is that the page is one world. Each model comes from a different
author with a different grade — one baked under warm studio light, one under
daylight, one flat-shaded for PS1 nostalgia — and dropped in unaltered they read
as five clippings pasted together. The site has an environment map, a key, a rim
and a storm-blue palette; running every mesh through those is what makes an
assembled device look like one object. The geometry is what was worth having.

This does NOT relicense anything. These are CC-BY meshes and the obligation
travels with the geometry: every model must have an entry in
web/src/rail/attribution.ts, and web/tests/attribution.test.ts fails the build
if one does not.

Usage:
    python -m tools.model.strip_gltf <in.gltf> <out.gltf>
"""
from __future__ import annotations

import argparse
import json
import pathlib
import shutil

#: Material keys that point at a texture, and therefore at a file we drop.
TEXTURE_KEYS = (
    'baseColorTexture', 'metallicRoughnessTexture', 'normalTexture',
    'occlusionTexture', 'emissiveTexture', 'diffuseTexture',
    'specularGlossinessTexture',
)


def strip(doc: dict) -> dict:
    """Remove every texture reference, leaving named material slots behind."""
    doc.pop('images', None)
    doc.pop('textures', None)
    doc.pop('samplers', None)

    for i, mat in enumerate(doc.get('materials', []) or []):
        pbr = mat.get('pbrMetallicRoughness')
        if isinstance(pbr, dict):
            for k in TEXTURE_KEYS:
                pbr.pop(k, None)
        for k in TEXTURE_KEYS:
            mat.pop(k, None)
        # Extensions are where the specular-glossiness and transform texture
        # references hide; none of them survive without their images.
        mat.pop('extensions', None)
        # A name is how the renderer finds this slot again to assign one of the
        # site's own materials to it. Unnamed slots get a positional one.
        mat.setdefault('name', f'slot_{i}')

    # An extension declared but no longer used makes a strict loader refuse the
    # file, so drop the ones that only existed for textures.
    drop = {'KHR_texture_transform', 'KHR_materials_pbrSpecularGlossiness'}
    for key in ('extensionsUsed', 'extensionsRequired'):
        if key in doc:
            doc[key] = [e for e in doc[key] if e not in drop]
            if not doc[key]:
                doc.pop(key)
    return doc


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('source')
    ap.add_argument('out')
    args = ap.parse_args()

    src = pathlib.Path(args.source)
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    doc = strip(json.loads(src.read_text(encoding='utf-8')))
    # Separate .bin files travel with the document; copy each one next to it.
    #
    # NAMESPACED BY THE OUTPUT STEM. Every one of these exports ships its buffer
    # as `scene.bin`, so copying them under their own names put five different
    # models' geometry through one filename — each overwrote the last, and the
    # four that lost pointed at another model's vertices. It failed silently:
    # the files were all present and all the right size.
    for i, buf in enumerate(doc.get('buffers', []) or []):
        uri = buf.get('uri')
        if not uri or uri.startswith('data:'):
            continue
        name = f'{out.stem}{"" if i == 0 else f"_{i}"}.bin'
        shutil.copyfile(src.parent / uri, out.parent / name)
        buf['uri'] = name

    out.write_text(json.dumps(doc, separators=(',', ':')), encoding='utf-8')

    total = out.stat().st_size + sum(
        (out.parent / pathlib.Path(b['uri']).name).stat().st_size
        for b in doc.get('buffers', []) or [] if b.get('uri'))
    slots = [m.get('name') for m in doc.get('materials', []) or []]
    print(f'{out}  {total / 1024:.0f} KB total  slots={slots}')


if __name__ == '__main__':
    main()
