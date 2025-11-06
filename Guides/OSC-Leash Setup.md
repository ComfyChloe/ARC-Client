# OSC‑Leash: Unity Prefab Setup Guide (Avatar Side Only)

This guide walks you through adding the OSC‑Leash Unity prefab to your VRChat avatar and wiring the avatar parameters that the desktop app reads. You do not need to touch the desktop app; your job is only the Unity/avatar side.

> What the system does (high level):
> - Your avatar exposes PhysBone and directional parameters over OSC.
> - The desktop app listens to those parameters and, when you grab the leash PhysBone, sends VRChat movement inputs (/input/Vertical, /input/Horizontal, /input/Run) based on your leash pull direction and stretch.


## Requirements

- VRChat SDK 3.0 avatar project
- PhysBones enabled on the avatar
- Expression Parameters asset attached to the avatar descriptor
- Unity version supported by your current VRChat SDK
- The prefab from this repo: `OSCLeash/Unity/OSCLeash.prefab`


## Parameter names used by the desktop app (defaults)

These names are read by the app (from its default config) and must exist on your avatar. You can change them, but then your operator must update the app’s config to match.

- PhysBone prefix (leash name): `Leash`
    - Auto-exposed by VRChat when a PhysBone is named: 
        - `/avatar/parameters/Leash_IsGrabbed` (bool)
        - `/avatar/parameters/Leash_Stretch` (float 0..1+)
- Directional floats (you create these on your avatar):
    - `Leash_Z+`, `Leash_Z-`  (forward/back)
    - `Leash_X+`, `Leash_X-`  (right/left)
    - `Leash_Y+`, `Leash_Y-`  (up/down)

Expected ranges: each directional parameter should be 0.0 to 1.0. The app combines +/- per axis to compute direction and scales by stretch and strength.

Axis convention (avatar local space):
- Z+: forward, Z-: backward
- X+: right, X-: left
- Y+: up, Y-: down


## Step 1 — Import and place the prefab

1. Copy `OSCLeash/Unity/OSCLeash.prefab` into your project (or add the repo folder to your project).
2. Drag the prefab into your avatar hierarchy:
     - Prefer under the avatar root (same level as the armature) or near the chest/head depending on your design.
     - Keep transforms clean (scale = 1, rotation = 0 unless your setup requires otherwise).

Tip: If the prefab includes reference slots (e.g., anchor objects, visual gizmos), assign them per the prefab readme/comments. If no readme is included, parent the prefab so that its local axes match your avatar’s forward/right/up.


## Step 2 — Configure the PhysBone used as the “leash”

1. Add or locate a PhysBone chain that you intend to grab (e.g., a dangling object, handle, or helper bone).
2. In the PhysBone component:
     - Set “Parameter” (or “Parameter Prefix” depending on your SDK UI) to `Leash`. This is what produces `Leash_IsGrabbed` and `Leash_Stretch` automatically over OSC.
     - Enable grabbing on that PhysBone (Allow Grabbing = On).
     - Ensure the chain is reachable in-game so you can actually grab it.
3. Optional: Tune PhysBone settings so it stretches and responds naturally.

Result: When testing in VRChat, grabbing that bone will toggle `/avatar/parameters/Leash_IsGrabbed` and update `/avatar/parameters/Leash_Stretch`.


## Step 3 — Add Expression Parameters (the six directional floats)

Add six float parameters to your avatar’s Expression Parameters (VRCExpressionParameters asset attached to the Avatar Descriptor):

| Name       | Type  | Default | Saved | Networked |
|------------|-------|---------|-------|-----------|
| Leash_Z+   | Float | 0       | Off   | Off       |
| Leash_Z-   | Float | 0       | Off   | Off       |
| Leash_X+   | Float | 0       | Off   | Off       |
| Leash_X-   | Float | 0       | Off   | Off       |
| Leash_Y+   | Float | 0       | Off   | Off       |
| Leash_Y-   | Float | 0       | Off   | Off       |

Notes:
- These don’t need to be networked or saved; they are runtime control signals for the desktop app.
- Keep names exactly as listed unless you coordinate a config change with the desktop app operator.


## Step 4 — Drive the directional parameters (Animator or included controller)

You must make the six directional floats reflect how the leash is being pulled, normalized 0..1 per direction. There are two common approaches:

- Using the included controller (if provided with the prefab):
    - Assign the provided Animator Controller to a dedicated FX layer.
    - Ensure the parameters match exactly (names above).
    - The controller should output values based on local leash handle offset/angle.

- DIY Animator logic:
    - Track a “leash handle” object’s local offset relative to an anchor (e.g., neck/chest).
    - Convert local offset to +/- components per axis:
        - Z+: max(0,  z), Z-: max(0, -z)
        - X+: max(0,  x), X-: max(0, -x)
        - Y+: max(0,  y), Y-: max(0, -y)
    - Normalize each value into 0..1 based on your max pull distance/angle.
    - Write these to the six Animator float parameters via your controller logic.

Tips:
- Use Constraints (Parent/Position) or follow targets to compute pull direction.
- Use Animation Parameters Driver or StateBehaviours to set floats.
- Keep values smooth; the app polls frequently when the leash is grabbed.


## Step 5 — Test in VRChat

1. Load the avatar in a private world.
2. Open your usual OSC/parameters inspector (e.g., VRChat OSC debug window or any OSC monitor) and verify:
     - `Leash_IsGrabbed` toggles when you grab/release the leash PhysBone.
     - `Leash_Stretch` increases as you pull farther.
     - The six floats change as you move the leash in different directions (each stays in 0..1).
3. With the desktop app running, grab the leash and gently pull:
     - Small pull should start “walk” (the app uses `WalkDeadzone` ~0.15 by default).
     - Larger pull should switch to “run” (the app uses `RunDeadzone` ~0.70 by default).
     - Up/down (Y) pull may reduce/stop movement depending on `UpDownDeadzone` and `UpDownCompensation` (app-side defaults).


## Customizing names (optional)

If you change names on the avatar side, the desktop app must be told to use the same names:
- PhysBone parameter prefix → becomes `[Name]_IsGrabbed` and `[Name]_Stretch`
- Directional parameters → six float names must match exactly

Coordinate with your operator so they update the app’s OSC‑Leash config to your names. The app’s default config uses:
- Leash name: `Leash`
- Directional params: `Leash_Z+`, `Leash_Z-`, `Leash_X+`, `Leash_X-`, `Leash_Y+`, `Leash_Y-`


## Troubleshooting

- Grab doesn’t start movement:
    - Confirm the PhysBone’s Parameter/Prefix is `Leash` (or whatever the app is configured for).
    - Verify `/avatar/parameters/Leash_IsGrabbed` flips to 1 when you grab.
- Stretch stays 0:
    - The PhysBone may not be stretching (limits/ stiffness too high) or the chain isn’t moving. Tune the PhysBone.
- Directional values not changing:
    - Ensure the six float parameters exist in Expression Parameters and are driven by your Animator logic.
    - Check that values are 0..1 and reflect the leash’s local pull direction.
- Movement stops when pulling up/down:
    - This is expected if your app operator uses `UpDownDeadzone` (default 0.5). Reduce vertical pull while testing, or ask the operator to adjust.
- Wrong axes:
    - Ensure your leash handle’s local axes match the avatar’s local axes. Re‑orient the prefab or swap axes in your controller logic.


## Reference (how the app listens)

From the app’s default behavior:
- Listens for:
    - `/avatar/parameters/Leash_IsGrabbed` (bool)
    - `/avatar/parameters/Leash_Stretch` (float)
    - `/avatar/parameters/Leash_Z+`, `Leash_Z-`, `Leash_X+`, `Leash_X-`, `Leash_Y+`, `Leash_Y-` (floats 0..1)
- Sends to VRChat while grabbed:
    - `/input/Vertical` (float -1..1)
    - `/input/Horizontal` (float -1..1)
    - `/input/Run` (int 0/1)

Keep your avatar parameters clean and responsive; the rest is handled by the app.

---

If you need an example controller or want your parameters renamed, coordinate with the app operator so the desktop config matches your avatar’s final names.
