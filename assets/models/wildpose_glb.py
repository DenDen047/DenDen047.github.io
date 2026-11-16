"""Build the WildPose rig as an articulated GLB with CadQuery.

The rig is a DJI RS 3 Pro gimbal carrying a Livox Tele-15 lidar and a Ximea camera with a motorised Navitar
16-160 mm zoom lens (parts list from the WildPose paper). The gimbal is drawn to the proportions of the
side view in DJI's user manual (scaled so the depth is the 195 mm of the spec sheet), the lidar is Livox's
published STEP model, and the camera side follows photos of the rig.

Units are millimetres here and metres in the GLB. z is up, the lens looks along +x, +y is the left side.
The origin is where the pan, roll and tilt axes meet. Joint nodes (pan_joint, roll_joint, tilt_joint) have an
identity rest transform; robots.js rotates them about the axes written to wildpose.joints.json.

Usage: python wildpose_glb.py <Tele-15_shell_FOV_3D.stp> <out.glb>
Needs cadquery, trimesh and numpy (conda-forge; cadquery wants Python 3.11).
(the STEP file is "Tele-15 3D Model and FOV Shape" from https://www.livoxtech.com/tele-15/downloads)
"""

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import cadquery as cq
import numpy as np
import trimesh

# name: (rgb, metallic, roughness)
MATERIALS = {
    "carbon": ((0.065, 0.065, 0.07), 0.3, 0.36),
    "black_alu": ((0.10, 0.10, 0.11), 0.55, 0.42),
    "motor": ((0.08, 0.08, 0.085), 0.5, 0.3),
    "gloss": ((0.035, 0.035, 0.04), 0.4, 0.14),
    "rubber": ((0.055, 0.055, 0.055), 0.0, 0.95),
    "red": ((0.80, 0.10, 0.14), 0.1, 0.5),
    "print": ((0.80, 0.80, 0.78), 0.0, 0.6),
    "silver": ((0.80, 0.81, 0.82), 0.55, 0.35),
    "glass": ((0.05, 0.06, 0.09), 0.3, 0.08),
    "screen": ((0.10, 0.17, 0.27), 0.2, 0.1),
    "lens_glass": ((0.11, 0.07, 0.17), 0.8, 0.05),
    "lens": ((0.045, 0.045, 0.05), 0.3, 0.45),
    "pla": ((0.76, 0.76, 0.74), 0.0, 0.8),
    "alu": ((0.72, 0.73, 0.74), 0.7, 0.38),
    "steel": ((0.62, 0.63, 0.64), 0.85, 0.3),
    "dark_steel": ((0.30, 0.31, 0.33), 0.6, 0.5),
    "camera": ((0.13, 0.14, 0.16), 0.6, 0.4),
    "label": ((0.93, 0.78, 0.16), 0.0, 0.6),
}

V = cq.Vector


def vec(*a):
    return np.array(a, float)


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


# ---- gimbal geometry (mm) ----
THETA = math.radians(32)                              # the RS 3 Pro roll axis is tilted up, not horizontal
A = vec(math.cos(THETA), 0, math.sin(THETA))          # roll axis
U = vec(-math.sin(THETA), 0, math.cos(THETA))         # perpendicular to it, pointing up
CR = -135 * A                                         # centre of the roll motor
YT = -118.0                                           # y of the roll arm's fore-aft run, tilt motor side
LIVOX_Y = (-92.0, 20.0)                               # Livox Tele-15 is 112 wide
PLATE_TOP = -47.0
LY, LZ = 66.0, -2.0                                   # lens axis


# ---- shape helpers ----
def frame(shape, o, x, y):
    """Move a shape built at the origin so that its local x, y point along `x`, `y` and its origin sits at `o`."""
    x, y = unit(x), unit(y)
    plane = cq.Plane(origin=tuple(map(float, o)), xDir=tuple(x), normal=tuple(np.cross(x, y)))
    return shape.moved(cq.Location(plane))


def along(shape, p0, d):
    """Place a shape built along local +z so that z points along `d`, starting at `p0`."""
    d = unit(d)
    ref = vec(1, 0, 0) if abs(d[0]) < 0.9 else vec(0, 1, 0)
    x = unit(np.cross(ref, d))
    return frame(shape, p0, x, np.cross(d, x))


def cyl(p0, p1, r, fillet=0.0):
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    w = cq.Workplane("XY").circle(r).extrude(float(np.linalg.norm(p1 - p0)))
    if fillet:
        w = w.edges().fillet(fillet)
    return along(w.val(), p0, p1 - p0)


def tube(p0, p1, ro, ri):
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    w = cq.Workplane("XY").circle(ro).circle(ri).extrude(float(np.linalg.norm(p1 - p0)))
    return along(w.val(), p0, p1 - p0)


def rbox(lo, hi, rv=0.0, re=0.0, axis="Z"):
    """Box from lo to hi; edges parallel to `axis` get radius rv, the remaining edges re."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    w = cq.Workplane("XY").box(*(hi - lo))
    if rv:
        w = w.edges(f"|{axis}").fillet(rv)
    if re:
        try:
            w = w.faces(f"|{axis}").edges().fillet(re) if rv else w.edges().fillet(re)
        except Exception:
            pass
    return w.val().translate(V(*((lo + hi) / 2)))


def sweep(points, w, h, xdir, bend=0.0, corner=3.0):
    """Sweep a rounded w x h rectangle along a polyline whose corners are rounded with radius `bend`.

    `w` is measured along `xdir` at the start of the path.
    """
    pts = [np.asarray(p, float) for p in points]
    path = cq.Wire.makePolygon([V(*p) for p in pts], close=False)
    if bend:
        path = path.fillet(bend)
    plane = cq.Plane(origin=tuple(pts[0]), xDir=tuple(unit(xdir)), normal=tuple(unit(pts[1] - pts[0])))
    sketch = cq.Sketch().rect(w, h).vertices().fillet(corner)
    return cq.Workplane(plane).placeSketch(sketch).sweep(path).val()


def text(s, size, o, x, y, depth=0.5):
    """Raised lettering centred at `o`, reading along `x` with `y` up; it rises along x cross y."""
    w = cq.Workplane("XY").text(s, size, depth, font="Arial", kind="bold", halign="center", valign="center")
    return frame(cq.Compound.makeCompound(w.vals()), o, x, y)


def revolve_x(profile, o):
    """Revolve an (x, radius) profile about the x axis through `o`."""
    w = cq.Workplane("XY").polyline(profile).close().revolve(360, (0, 0, 0), (1, 0, 0))
    return w.val().translate(V(*o))


def stadium(c1, r1, c2, r2, n=40):
    """Outline (in a 2D plane) of a belt wrapped around two circles."""
    c1, c2 = np.asarray(c1, float), np.asarray(c2, float)
    d = c2 - c1
    phi, dist = math.atan2(d[1], d[0]), np.linalg.norm(d)
    al = math.acos((r1 - r2) / dist)
    big = np.linspace(phi + al, phi + 2 * math.pi - al, n)
    small = np.linspace(phi - al, phi + al, n // 3)
    pts = [c1 + r1 * vec(math.cos(t), math.sin(t)) for t in big]
    pts += [c2 + r2 * vec(math.cos(t), math.sin(t)) for t in small]
    return [tuple(p) for p in pts]


# ---- links: each returns a list of (material, shape) ----
def handle():
    p = [("motor", cyl((0, 0, -162), (0, 0, -143.8), 25, 1.5))]                       # pan motor
    p += [("black_alu", rbox((-25, -23, -218), (25, 23, -160), 9, 2))]               # control section
    p += [("black_alu", cyl((0, 0, -300), (0, 0, -216), 23, 2.5))]                   # BG30 grip
    p += [("rubber", tube((0, 0, -288), (0, 0, -224), 23.6, 22))]
    p += [("gloss", rbox((-25.7, -14.5, -193), (-24.5, 14.5, -164), 0, 0))]          # touchscreen glass
    p += [("screen", rbox((-26.0, -11.5, -190), (-25.4, 11.5, -167), 0, 0))]
    p += [("motor", cyl((-24.5, 8, -204), (-26.3, 8, -204), 6.6))]                   # joystick
    p += [("rubber", cyl((-26, 8, -204), (-30.5, 8, -204), 4.4, 1))]
    p += [("motor", cyl((-24.5, -8, -200), (-26.2, -8, -200), 3))]                   # M button
    p += [("red", cyl((-24.5, -5, -210), (-26.4, -5, -210), 3.6))]                   # camera control button
    p += [("motor", cyl((-8, -22.5, -197), (-8, -24.4, -197), 3))]                   # power button
    p += [("red", rbox((-6, -24.6, -187), (0, -22.5, -177), 0, 0))]                  # gimbal mode switch
    for s in (1, -1):                                                                # RSA / NATO ports
        lo, hi = sorted((s * 22.5, s * 25.4))
        p += [("motor", rbox((-9, lo, -185), (11, hi, -163), 2, 0, "Y"))]
        for z in (-168, -180):
            p += [("steel", cyl((1, s * 25, z), (1, s * 26, z), 2.2))]
    p += [("motor", cyl((22, -7, -181), (22, 7, -181), 10, 1.5))]                    # front dial
    p += [("rubber", rbox((23, -4, -201), (29.5, 4, -191), 1.5, 0, "Y"))]            # trigger
    p += [("print", text("RONIN", 8.5, (-2, 22.6, -262), (0, 0, -1), (-1, 0, 0), 0.9))]
    for i in range(4):                                                               # battery level LEDs
        p += [("print", rbox((-23.6, -7 + i * 4, -294), (-22.5, -5 + i * 4, -292), 0, 0))]
    # extended grip / tripod
    p += [("black_alu", cyl((0, 0, -313), (0, 0, -300), 15.5, 2))]
    for deg in (180, 60, -60):
        leg = rbox((8, -11.5, -6), (118, 11.5, 5), 10, 2)
        pad = rbox((98, -9, -9), (115, 9, -5.5), 3, 0)
        for mat, s in (("black_alu", leg), ("rubber", pad)):
            s = s.rotate(V(0, 0, 0), V(0, 1, 0), 7).translate(V(0, 0, -307)).rotate(V(0, 0, 0), V(0, 0, 1), deg)
            p += [(mat, s)]
    return p


def pan_link():
    p = [("motor", cyl((0, 0, -143), (0, 0, -139.5), 24))]                           # pan rotor
    p += [("black_alu", rbox((-24, -19, -139.5), (34, 19, -123.5), 4, 1.5))]         # pan axis clamp
    p += [("motor", rbox((4, 18.5, -137), (26, 22.5, -128), 1.5, 0, "Y"))]           # pan lock lever
    p += [("red", cyl((15, 22, -132.5), (15, 23.2, -132.5), 2))]
    arm = [(40, 0, -131.5), (-78, 0, -131.5), CR - 22 * A - 23 * U]
    p += [("carbon", sweep(arm, 28, 12, (0, 1, 0), bend=28, corner=3.5))]
    for s in (1, -1):
        p += [("print", text("RS3 PRO", 6.2, (-50, s * 13.8, -131.5), (-s, 0, 0), (0, 0, 1)))]
        lo, hi = sorted((s * 13.8, s * 14.25))
        p += [("red", rbox((-76, lo, -127.0), (-27, hi, -126.3)))]
    p += [("motor", cyl(CR - 27 * A, CR + 5 * A, 29, 4))]                            # roll motor
    p += [("gloss", cyl(CR - 27.8 * A, CR - 27 * A, 21))]
    p += [("red", rbox(CR + 2 * A + vec(-3, -30.3, -3), CR + 2 * A + vec(3, -28.4, 3)))]  # roll lock
    return p


def roll_link():
    p = [("motor", cyl(CR + 5.8 * A, CR + 12 * A, 27))]                              # roll rotor
    p += [("carbon", cyl(CR + 12 * A, CR + 25.5 * A, 27, 3))]
    s0 = CR + 19 * A
    arm = [s0 + vec(0, 8, 0), s0 + vec(0, YT, 0), vec(0, YT, 0) - 10 * A]
    p += [("carbon", sweep(arm, 28, 13, U, bend=40, corner=4))]
    back = s0 - 6.3 * A
    p += [("print", text("RONIN", 13.5, back + vec(0, -52, 0) + 1.5 * U, (0, -1, 0), U, 0.6))]
    stripe = cq.Workplane("XY").box(74, 0.8, 0.5).val()
    p += [("red", frame(stripe, back + vec(0, -52, 0) - 10.5 * U - 0.2 * A, (0, -1, 0), U))]
    p += [("motor", cyl((0, -144, 0), (0, -113, 0), 26, 4))]                         # tilt motor
    p += [("gloss", cyl((0, -144.8, 0), (0, -144, 0), 19))]
    p += [("red", rbox((-3, -140, 25.5), (3, -134, 27.5)))]                          # tilt lock
    return p


def payload(livox_step):
    p = [("motor", cyl((0, -112.2, 0), (0, -105, 0), 24))]                           # tilt rotor
    p += [("black_alu", rbox((-12, -105, -97), (12, -95.5, 27), 2, 0, "Y"))]         # vertical tilt arm
    for z in (-30, -60):
        p += [("steel", cyl((0, -95.5, z), (0, -94.6, z), 2.4))]
    p += [("black_alu", rbox((-21, -105, -97), (21, 40, -85), 2.5, 1, "Y"))]         # camera mounting plate
    p += [("black_alu", rbox((-34, -23, -85), (70, 23, -76), 3, 1))]                 # lower quick-release plate
    p += [("motor", cyl((8, 23, -80.5), (8, 35, -80.5), 5.5, 1))]                    # its clamp knob
    p += [("motor", rbox((-16, 23, -84), (-3, 27, -78), 1, 0, "Y"))]
    p += [("alu", rbox((-28, -36, -76), (34, 36, -53.5), 0, 1))]                     # spacer block

    # perforated base plate
    x0, x1, y0, y1 = -82.0, 54.0, -93.0, 132.0
    plate = cq.Workplane("XY").box(x1 - x0, y1 - y0, 6.5).edges("|Z").fillet(4)
    holes = [(x - (x0 + x1) / 2, y - (y0 + y1) / 2) for x in np.arange(x0 + 8, x1 - 4, 20)
             for y in np.arange(y0 + 12.5, y1 - 4, 20)]
    plate = plate.faces(">Z").workplane().pushPoints(holes).hole(5.5)
    p += [("alu", plate.val().translate(V((x0 + x1) / 2, (y0 + y1) / 2, PLATE_TOP - 3.25)))]

    # Livox Tele-15 from the manufacturer's STEP file: x = width, y = height, +z = rear
    solids = sorted(cq.importers.importStep(str(livox_step)).solids().vals(), key=lambda s: -s.Volume())
    window = cq.Workplane("XY").box(77.6, 63.5, 0.5).val().translate(V(0, 2.05, -60.75))
    socket = [s for s in solids[1:] if s.BoundingBox().zmax < 70]   # leaves out the cable and the FOV shape
    for material, shapes in (("silver", solids[:1]), ("glass", [window]), ("gloss", socket)):
        for shape in shapes:
            p += [(material, frame(shape, (-14, sum(LIVOX_Y) / 2, PLATE_TOP + 40), (0, -1, 0), (0, 0, 1)))]
    top = PLATE_TOP + 94.3
    p += [("dark_steel", rbox((-25, -92, top), (40, -56, top + 3)))]                 # angle bracket on top
    p += [("dark_steel", rbox((-25, -92, top), (40, -89, top + 38)))]

    # motorised zoom lens (Navitar 16-160 mm) and camera (Ximea MQ022CG-CM)
    prof = [(-54, 0), (-54, 14), (-48, 14), (-48, 21), (-34, 21), (-34, 27), (-6, 27), (-6, 30), (22, 30),
            (22, 33), (46, 33), (60, 42), (106, 42), (106, 43.5), (112, 43.5), (112, 40), (104, 37.5), (104, 0)]
    p += [("lens", revolve_x(prof, (0, LY, LZ)))]
    p += [("lens_glass", cyl((103.4, LY, LZ), (104.4, LY, LZ), 37.6))]
    p += [("print", tube((110.6, LY, LZ), (111.2, LY, LZ), 40.6, 39.9))]
    drives = [(-20, 27, 90), (8, 30, 30), (34, 33, -30)]   # ring position x, lens radius there, motor angle
    for x, r, deg in drives:
        my, mz = LY + 60 * math.cos(math.radians(deg)), LZ + 60 * math.sin(math.radians(deg))
        p += [("pla", tube((x - 4, LY, LZ), (x + 4, LY, LZ), r + 4, r))]             # printed ring on the lens
        outer = cq.Workplane("YZ").polyline(stadium((LY, LZ), r + 5.4, (my, mz), 7.9)).close().extrude(6)
        inner = cq.Workplane("YZ").polyline(stadium((LY, LZ), r + 4.1, (my, mz), 6.6)).close().extrude(6)
        p += [("rubber", outer.cut(inner).val().translate(V(x - 3, 0, 0)))]          # timing belt
        p += [("alu", cyl((x - 4, my, mz), (x + 4, my, mz), 6.5))]                   # pulley and its flanges
        for xf in (x - 4.8, x + 3.8):
            p += [("alu", cyl((xf, my, mz), (xf + 1, my, mz), 8.6))]
        p += [("steel", cyl((x - 9, my, mz), (x + 6, my, mz), 2))]
        p += [("steel", cyl((x - 29, my, mz), (x - 9, my, mz), 12.5, 1))]            # gearbox
        p += [("dark_steel", cyl((x - 60, my, mz), (x - 29.5, my, mz), 12.2, 1))]    # motor can
        p += [("gloss", cyl((x - 70, my, mz), (x - 60.5, my, mz), 11, 1))]           # encoder cap
        # printed mount: a collar round the lens, a rib out to the motor, and a foot on the plate
        rl = 27 if x < 0 else 33 if x > 20 else 30
        xa, xb = x - 16, x - 10
        m = cyl((xa, LY, LZ), (xb, LY, LZ), rl + 9)
        m = m.fuse(cyl((xa, my, mz), (xb, my, mz), 16.5))
        d = vec(my - LY, mz - LZ)
        rib = cq.Workplane("XY").box(float(np.linalg.norm(d)), 22, 6).val()
        m = m.fuse(frame(rib, ((xa + xb) / 2, (LY + my) / 2, (LZ + mz) / 2), (0, d[0], d[1]), (0, -d[1], d[0])))
        m = m.fuse(rbox((xa, LY - 27, PLATE_TOP), (xb, LY + 27, LZ)))
        m = m.cut(cyl((xa - 1, LY, LZ), (xb + 1, LY, LZ), rl + 0.4))
        p += [("pla", m.clean())]
    p += [("camera", rbox((-80, LY - 13, LZ - 13), (-54, LY + 13, LZ + 13), 1.5, 0, "X"))]
    p += [("steel", rbox((-83.5, LY - 6, LZ - 3.5), (-80, LY + 6, LZ + 3.5)))]
    cradle = rbox((-82, LY - 22, PLATE_TOP), (-50, LY + 22, LZ + 19), 3, 0, "X")
    cradle = cradle.cut(rbox((-83, LY - 13.4, LZ - 13.4), (-49, LY + 13.4, LZ + 40)))
    p += [("pla", cradle)]
    return p


def tessellate(shape, tol, ang):
    verts, tris = shape.tessellate(tol, ang)
    return trimesh.Trimesh(np.array([v.toTuple() for v in verts]), np.array(tris), process=False)


def main(livox_step: Path, out: Path):
    origins = {"pan_joint": vec(0, 0, -140), "roll_joint": CR, "tilt_joint": vec(0, 0, 0)}
    links = [
        ("robot", None, vec(0, 0, 0), handle()),
        ("pan_joint", "robot", origins["pan_joint"], pan_link()),
        ("roll_joint", "pan_joint", origins["roll_joint"], roll_link()),
        ("tilt_joint", "roll_joint", origins["tilt_joint"], payload(livox_step)),
    ]
    scene = trimesh.Scene()
    faces = 0
    for name, parent, origin, parts in links:
        if parent is None:
            scene.graph.update(frame_to=name, frame_from=scene.graph.base_frame, matrix=np.eye(4))
        else:
            parent_origin = next(o for n, _, o, _ in links if n == parent)
            T = np.eye(4)
            T[:3, 3] = (origin - parent_origin) / 1000
            scene.graph.update(frame_to=f"{name}__origin", frame_from=parent, matrix=T)
            scene.graph.update(frame_to=name, frame_from=f"{name}__origin", matrix=np.eye(4))
        by_mat = defaultdict(list)
        for material, shape in parts:
            coarse = material == "silver"   # the Livox STEP is full of small fillets
            by_mat[material].append(tessellate(shape, 0.5 if coarse else 0.15, 1.0 if coarse else 0.4))
        for material, meshes in by_mat.items():
            m = trimesh.util.concatenate(meshes)
            m.vertices = (m.vertices - origin) / 1000
            m.merge_vertices()
            rgb, metal, rough = MATERIALS[material]
            m.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
                baseColorFactor=[*(int(c * 255) for c in rgb), 255], metallicFactor=metal, roughnessFactor=rough))
            key = f"{name}_{material}"
            scene.add_geometry(m, node_name=key, geom_name=key, parent_node_name=name)
            faces += len(m.faces)
    scene.export(out)
    joints = {
        "pan_joint": {"axis": [0.0, 0.0, 1.0], "lower": -3.1416, "upper": 3.1416},
        "roll_joint": {"axis": [round(float(a), 4) for a in A], "lower": -0.6, "upper": 0.6},
        "tilt_joint": {"axis": [0.0, 1.0, 0.0], "lower": -1.0, "upper": 1.0},
    }
    out.with_suffix(".joints.json").write_text(json.dumps(joints, indent=1))
    print(f"{out.name}: {out.stat().st_size / 1e3:.0f} kB, {faces} faces")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
