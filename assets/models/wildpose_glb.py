"""Build a simplified WildPose rig (DJI Ronin gimbal + Livox Tele-15 + zoom-lens camera) as an articulated GLB.

Modelled from photos, not CAD. Units are metres, z up, the lens looks along +x (same convention as the robot GLBs).
Joint nodes (pan_joint, roll_joint, tilt_joint) have an identity rest transform; robots.js rotates them about the
axes written to wildpose.joints.json.
"""

import json
import sys
from pathlib import Path

import numpy as np
import trimesh
from trimesh.transformations import rotation_matrix, translation_matrix

SILVER = (0.80, 0.81, 0.82, 1)
FIN = (0.88, 0.89, 0.90, 1)
GLASS = (0.06, 0.07, 0.09, 1)
LENS = (0.05, 0.05, 0.055, 1)
GRIP = (0.10, 0.10, 0.11, 1)
GIMBAL = (0.09, 0.09, 0.10, 1)
RED = (0.78, 0.12, 0.18, 1)
PRINT = (0.90, 0.90, 0.88, 1)
ALU = (0.68, 0.69, 0.70, 1)
YELLOW = (0.95, 0.80, 0.15, 1)


def mat(rgba, metal=0.1, rough=0.55):
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=(np.asarray(rgba) * 255).astype(np.uint8), metallicFactor=metal, roughnessFactor=rough
    )


def box(lo, hi, rgba, **kw):
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    m = trimesh.creation.box(extents=hi - lo, transform=translation_matrix((lo + hi) / 2))
    m.visual = trimesh.visual.TextureVisuals(material=mat(rgba, **kw))
    return m


def cyl(center, axis, radius, length, rgba, sections=48, **kw):
    """Cylinder centred at `center` along 'x', 'y' or 'z'."""
    m = trimesh.creation.cylinder(radius=radius, height=length, sections=sections)
    if axis == "x":
        m.apply_transform(rotation_matrix(np.pi / 2, (0, 1, 0)))
    elif axis == "y":
        m.apply_transform(rotation_matrix(np.pi / 2, (1, 0, 0)))
    m.apply_translation(center)
    m.visual = trimesh.visual.TextureVisuals(material=mat(rgba, **kw))
    return m


def rod(a, b, radius, rgba):
    a, b = np.asarray(a, float), np.asarray(b, float)
    m = trimesh.creation.cylinder(radius=radius, segment=(a, b), sections=20)
    m.visual = trimesh.visual.TextureVisuals(material=mat(rgba))
    return m


# gimbal geometry
PAN = np.array([-0.18, 0.0, 0.0])   # pan axis (z) sits behind the payload, on top of the grip
ZR = 0.075                           # roll axis height
ROLL = np.array([-0.17, 0.0, ZR])    # roll axis (x)
TILT = np.array([0.0, 0.0, 0.13])    # tilt axis (y) passes through the payload
SIDE = 0.145                         # y of the tilt arm


def base_parts():
    p = [cyl((PAN[0], 0, -0.13), "z", 0.024, 0.19, GRIP, rough=0.8)]                  # grip
    p += [cyl((PAN[0], 0, -0.03), "z", 0.036, 0.045, GIMBAL, rough=0.4)]              # pan motor stator
    p += [cyl((PAN[0], 0, -0.205), "z", 0.02, 0.02, GIMBAL)]                         # tripod head
    for k in range(3):                                                               # tripod legs
        a = 2 * np.pi * k / 3 + np.pi / 6
        foot = (PAN[0] + 0.13 * np.cos(a), 0.13 * np.sin(a), -0.33)
        p += [rod((PAN[0], 0, -0.21), foot, 0.007, GIMBAL), cyl(foot, "z", 0.012, 0.006, GRIP)]
    # cable-tie and buttons on the grip
    p += [box((PAN[0] + 0.02, -0.008, -0.09), (PAN[0] + 0.028, 0.008, -0.06), RED)]
    return p


def pan_parts():
    x = PAN[0]
    p = [cyl((x, 0, -0.004), "z", 0.031, 0.008, GIMBAL, rough=0.4)]                   # pan rotor
    p += [box((x - 0.04, -0.022, 0.0), (x - 0.01, 0.022, ZR), GIMBAL)]            # upright arm
    p += [cyl((ROLL[0] - 0.022, 0, ZR), "x", 0.04, 0.04, GIMBAL, rough=0.4)]       # roll motor stator
    p += [cyl((ROLL[0] - 0.043, 0, ZR), "x", 0.009, 0.004, RED)]                     # motor cap
    return p


def roll_parts():
    x0, z = ROLL[0] + 0.012, ZR
    p = [cyl((ROLL[0] + 0.002, 0, z), "x", 0.034, 0.008, GIMBAL, rough=0.4)]          # roll rotor
    p += [box((x0, -0.02, z - 0.02), (x0 + 0.036, SIDE + 0.02, z + 0.02), GIMBAL)]  # the "RONIN" arm
    p += [box((x0 + 0.036, SIDE - 0.014, z - 0.014), (TILT[0] + 0.02, SIDE + 0.014, z + 0.014), GIMBAL)]  # forward slide
    p += [box((x0 + 0.004, -0.01, z - 0.0205), (x0 + 0.032, SIDE + 0.01, z - 0.0195), RED)]
    p += [box((x0 + 0.036, -0.004, z - 0.006), (x0 + 0.0365, SIDE - 0.02, z + 0.006), PRINT)]  # "RONIN" lettering band  # red stripe
    p += [box((TILT[0] - 0.016, SIDE - 0.014, z), (TILT[0] + 0.022, SIDE + 0.014, TILT[2]), GIMBAL)]  # vertical tilt arm
    p += [cyl((TILT[0], SIDE - 0.004, TILT[2]), "y", 0.038, 0.04, GIMBAL, rough=0.4)]  # tilt motor stator
    p += [cyl((TILT[0], SIDE + 0.017, TILT[2]), "y", 0.009, 0.004, RED)]
    return p


def payload_parts():
    """In the tilt frame: origin on the tilt axis."""
    p = []
    zp = -0.05  # top of the cheese plate
    p += [box((-0.10, -0.115, zp - 0.006), (0.085, 0.112, zp), ALU, metal=0.6, rough=0.4)]
    for i in range(6):  # slots in the plate
        x = -0.085 + i * 0.03
        p += [box((x, -0.10, zp - 0.0065), (x + 0.016, 0.098, zp + 0.0004), GIMBAL)]
    p += [box((-0.03, 0.112, zp - 0.006), (0.03, 0.117, 0.012), ALU, metal=0.6, rough=0.4)]  # side plate to tilt rotor
    p += [cyl((0, 0.122, 0), "y", 0.031, 0.008, GIMBAL, rough=0.4)]                          # tilt rotor

    # Livox Tele-15: ~141 (depth) x 112 (width) x 122 (height) mm
    lx0, lx1, ly0, ly1, lz0, lz1 = -0.085, 0.056, -0.005, 0.107, zp, zp + 0.122
    p += [box((lx0, ly0, lz0), (lx1, ly1, lz1), SILVER, metal=0.5, rough=0.35)]
    p += [box((lx1 - 0.002, ly0 + 0.014, lz0 + 0.022), (lx1 + 0.003, ly1 - 0.014, lz1 - 0.02), GLASS, metal=0.2, rough=0.1)]
    p += [box((lx1 - 0.004, ly0 + 0.010, lz0 + 0.018), (lx1 + 0.001, ly1 - 0.010, lz1 - 0.016), SILVER, metal=0.5, rough=0.35)]
    for i in range(7):  # cooling fins on the rear half (top and both sides)
        x = lx0 + 0.004 + i * 0.009
        p += [box((x, ly0 + 0.006, lz1), (x + 0.004, ly1 - 0.006, lz1 + 0.007), FIN, metal=0.4, rough=0.4)]
        p += [box((x, ly1, lz0 + 0.01), (x + 0.004, ly1 + 0.006, lz1 - 0.008), FIN, metal=0.4, rough=0.4)]
        p += [box((x, ly0 - 0.006, lz0 + 0.03), (x + 0.004, ly0, lz1 - 0.008), FIN, metal=0.4, rough=0.4)]
    p += [box((lx0 + 0.07, ly0 + 0.03, lz1), (lx0 + 0.095, ly0 + 0.06, lz1 + 0.001), YELLOW)]  # laser label
    # angle bracket on top
    p += [box((-0.005, ly1 - 0.05, lz1), (0.045, ly1, lz1 + 0.004), ALU, metal=0.6, rough=0.4)]
    p += [box((-0.005, ly1 - 0.004, lz1), (0.045, ly1, lz1 + 0.05), ALU, metal=0.6, rough=0.4)]
    p += [cyl((lx0 - 0.006, 0.05, lz0 + 0.03), "x", 0.008, 0.012, GIMBAL)]  # connector

    # zoom-lens camera, beside the Livox
    ay, az = -0.065, zp + 0.045
    p += [box((-0.09, ay - 0.032, zp), (-0.02, ay + 0.032, az + 0.03), PRINT, rough=0.8)]   # printed housing
    p += [box((-0.098, ay - 0.016, az - 0.016), (-0.09, ay + 0.016, az + 0.016), GIMBAL)]   # camera back / cable
    p += [cyl((0.035, ay, az), "x", 0.032, 0.11, LENS, rough=0.5)]                            # barrel
    for x, r, w in [(-0.008, 0.035, 0.012), (0.03, 0.036, 0.02), (0.07, 0.035, 0.012)]:      # rubber grip rings
        p += [cyl((x, ay, az), "x", r, w, GRIP, sections=24, rough=0.9)]
    p += [cyl((0.105, ay, az), "x", 0.039, 0.035, LENS, rough=0.5)]                          # front element
    p += [cyl((0.1225, ay, az), "x", 0.032, 0.002, GLASS, metal=0.6, rough=0.05)]             # glass
    p += [box((-0.015, ay - 0.012, az + 0.032), (0.025, ay + 0.012, az + 0.05), PRINT, rough=0.8)]  # motor bracket
    p += [cyl((0.005, ay, az + 0.066), "x", 0.016, 0.05, ALU, metal=0.6, rough=0.35)]        # focus motor
    p += [cyl((0.034, ay, az + 0.066), "x", 0.012, 0.008, PRINT)]
    p += [box((-0.06, ay - 0.035, zp - 0.006), (-0.03, ay + 0.035, zp), PRINT)]
    return p


def main(out: Path):
    s = trimesh.Scene()
    base = s.graph.base_frame
    n = [0]

    def node(parent, name, T):
        s.graph.update(frame_to=name, frame_from=parent, matrix=T)
        return name

    def add(parent, parts, offset):
        for m in parts:
            n[0] += 1
            m = m.copy()
            m.apply_transform(np.diag([1.0, -1.0, 1.0, 1.0]))  # photos: Livox on the right, lens on the left
            m.apply_translation(-offset)
            s.add_geometry(m, node_name=f"g{n[0]}", geom_name=f"g{n[0]}", parent_node_name=parent)

    root = node(base, "robot", np.eye(4))
    add(root, base_parts(), np.zeros(3))
    pan = node(node(root, "pan_joint__origin", translation_matrix(PAN)), "pan_joint", np.eye(4))
    add(pan, pan_parts(), PAN)
    roll = node(node(pan, "roll_joint__origin", translation_matrix(ROLL - PAN)), "roll_joint", np.eye(4))
    add(roll, roll_parts(), ROLL)
    tilt = node(node(roll, "tilt_joint__origin", translation_matrix(TILT - ROLL)), "tilt_joint", np.eye(4))
    add(tilt, payload_parts(), np.zeros(3))
    s.export(out)
    joints = {
        "pan_joint": {"axis": [0.0, 0.0, 1.0], "lower": -3.1416, "upper": 3.1416},
        "roll_joint": {"axis": [1.0, 0.0, 0.0], "lower": -0.6, "upper": 0.6},
        "tilt_joint": {"axis": [0.0, 1.0, 0.0], "lower": -1.0, "upper": 1.0},
    }
    out.with_suffix(".joints.json").write_text(json.dumps(joints, indent=1))
    faces = sum(len(g.faces) for g in s.geometry.values())
    print(f"{out.name}: {out.stat().st_size / 1e3:.0f} kB, {faces} faces")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
