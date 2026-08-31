# Figure vendor (Female / Male)

Quaternius **Universal Base / Superhero** pair, CC0. Two clay humanoids, one shared
UE-style humanoid rig. Not Mixamo. Not KayKit Knight.

- **Author:** Quaternius (https://quaternius.com)
- **License:** [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) — see `LICENSE.txt`
- **Mesh source:** Superhero Female / Male FullBody glTF from
  [jamesonBradfield/Quaternius_IK_Rigged_with_animations](https://codeberg.org/jamesonBradfield/Quaternius_IK_Rigged_with_animations)
  (`addons/quaternius_ik_rigged/Godot - UE/`). That addon redistributes Quaternius
  CC0 Superhero bases.
- **Upstream pack:** [Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) (August 2025)
- **Fetched:** 2026-08-31
- **Why these files:** E9 / E18 Dummy must ship on public `origin`. A Female + Male
  pair with the same bone names lets poses and Idle/Walk/Run transfer. Mixamo X/Y
  Bot cannot be redistributed as raw GLBs.

## What we kept

Texture PNGs were dropped (Dummy is `applyClay` grayscale). Each GLB is
gltf+bin packed locally. Idle / Walk / Run are procedural tracks remapped onto
the shared bone aliases (the mesh files have no clips).

- `Female.glb` — ~1.0 MB
- `Male.glb` — ~0.74 MB

## Pose UI aliases

UE mannequin names stay on the GLB (`pelvis`, `spine_01`, `upperarm_l`, …).
The pose dropdown uses stable Figure names. See `DUMMY_BONE_ALIASES` in
`src/lib/dummyCharacter.ts`.
