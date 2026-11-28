#!/usr/bin/env python3
"""The A350 flight deck's walls, roof, floor, seats, side consoles and door, from a free model.

    python3 tools/build_a350_shell.py ~/Downloads/airbus_cockpit_interior.zip   (writes cockpits/A350-shell.bin)

The model: "Airbus Cockpit Interior" by davidolaleye1
(https://sketchfab.com/3d-models/airbus-cockpit-interior-06ca045e131b4cfdac76ddbd55ed3b4a), CC-BY-4.0: Sketchfab's
glTF download (a login there is needed for it). Only its shapes are taken, painted in the A350's own colours (no
textures, so none of its logos); left out are its window glass (the world shows through the openings), its glareshield
plate, buttons, screens, side-sticks and pedestal (src/cockpit3d.js has its own, working ones there), and the small
switches on its roof (the overhead panel is ours). The first officer's seat is the captain's, mirrored.

Its frame (x aft, y up, z left; 1 unit 1 m) goes into the cockpit's (src/cockpit3d.js: x right, y ahead, z up, from the
pilots' eye height in the middle of the deck), scaled by S: its glareshield lip, floor and roof then sit where the
A350 deck built there has them, with the captain's eye at its headrest.

The file: "A35S", version (u32), the triangle count (u32), then three corners each: position in mm 3 x i16, normal
3 x i8, colour 3 x u8 (sRGB).
"""
import io, json, math, os, struct, sys, zipfile

from PIL import Image

S = 0.85                      # (its units to metres in the cockpit)
XE, YE, ZC = 201.755, 1.238, -309.29  # (the eye's place aft and up, the deck's middle across)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cockpits', 'A350-shell.bin')

# the A350's colours (sRGB), as src/cockpit3d.js COL
LINING, FRAME, FLOOR, CONSOLE, SEAT, SEAT_DARK, METAL, DOOR = (
    0xc9ced3, 0x3b3f46, 0x2c2f35, 0x575c64, 0x3d434d, 0x23262b, 0x8a9099, 0xb7bcc2)
WINDOWS_Y = 0.70  # (its window frames: dark on its texture, from here up; the walls under the windows are lining)


def rgb(c):
    return ((c >> 16) & 255, (c >> 8) & 255, c & 255)


def main(src):
    z = zipfile.ZipFile(src)
    name = next(n for n in z.namelist() if n.endswith('.gltf'))
    base = os.path.dirname(name)
    g = json.loads(z.read(name))
    B = z.read(os.path.join(base, g['buffers'][0]['uri']) if base else g['buffers'][0]['uri'])
    texs = {}

    def tex(mat):
        if mat in texs:
            return texs[mat]
        m = next(x for x in g['materials'] if x.get('name') == mat)
        t = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        img = None
        if t is not None:
            uri = g['images'][g['textures'][t['index']]['source']]['uri']
            img = Image.open(io.BytesIO(z.read(os.path.join(base, uri) if base else uri))).convert('RGB')
        texs[mat] = img
        return img

    def mul(a, b):
        r = [0.0] * 16
        for c in range(4):
            for rr in range(4):
                r[c * 4 + rr] = sum(a[k * 4 + rr] * b[c * 4 + k] for k in range(4))
        return r

    def acc(i):
        a = g['accessors'][i]
        bv = g['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        comp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        fmt = {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B'}[a['componentType']]
        size = struct.calcsize(fmt)
        stride = bv.get('byteStride', size * comp)
        return [struct.unpack_from('<' + fmt * comp, B, off + k * stride) for k in range(a['count'])]

    meshes = {}

    def walk(ni, M):
        n = g['nodes'][ni]
        M2 = mul(M, n.get('matrix', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))
        if 'mesh' in n:
            for p in g['meshes'][n['mesh']]['primitives']:
                pos = acc(p['attributes']['POSITION'])
                nor = acc(p['attributes']['NORMAL'])
                uv = acc(p['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in p['attributes'] else [(0, 0)] * len(pos)
                idx = [i[0] for i in acc(p['indices'])]
                W = [(M2[0] * x + M2[4] * y + M2[8] * zz + M2[12], M2[1] * x + M2[5] * y + M2[9] * zz + M2[13],
                      M2[2] * x + M2[6] * y + M2[10] * zz + M2[14]) for (x, y, zz) in pos]
                N = []
                for (x, y, zz) in nor:
                    v = (M2[0] * x + M2[4] * y + M2[8] * zz, M2[1] * x + M2[5] * y + M2[9] * zz, M2[2] * x + M2[6] * y + M2[10] * zz)
                    l = math.sqrt(sum(c * c for c in v)) or 1
                    N.append(tuple(c / l for c in v))
                meshes[n.get('name', str(ni))] = {'v': W, 'n': N, 'uv': uv, 'i': idx, 'mat': g['materials'][p['material']]['name']}
        for c in n.get('children', []):
            walk(c, M2)

    for r in g['scenes'][0]['nodes']:
        walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

    def part(key):
        return next(m for k, m in meshes.items() if k.startswith(key))

    # its separate pieces (triangles joined by corners at the same place), each with its box
    def pieces(m):
        v, I = m['v'], m['i']
        weld, wid = {}, []
        for p in v:
            wid.append(weld.setdefault((round(p[0], 3), round(p[1], 3), round(p[2], 3)), len(weld)))
        par = list(range(len(weld)))

        def f(a):
            while par[a] != a:
                par[a] = par[par[a]]
                a = par[a]
            return a
        for t in range(0, len(I), 3):
            a = f(wid[I[t]])
            for k in (1, 2):
                par[f(wid[I[t + k]])] = a
        groups = {}
        for t in range(0, len(I), 3):
            groups.setdefault(f(wid[I[t]]), []).append(t)
        out = []
        for ts in groups.values():
            vs = [v[I[t + k]] for t in ts for k in range(3)]
            box = [min(p[j] for p in vs) for j in range(3)] + [max(p[j] for p in vs) for j in range(3)]
            out.append((ts, box))
        return out

    def texColour(m, ts):
        img = tex(m['mat'])
        if img is None:
            return (0.5, 0.5, 0.5)
        W, H = img.size
        acc_ = [0, 0, 0]
        for t in ts:
            u = sum(m['uv'][m['i'][t + k]][0] for k in range(3)) / 3
            vv = sum(m['uv'][m['i'][t + k]][1] for k in range(3)) / 3
            c = img.getpixel((int((u % 1) * (W - 1)), int((vv % 1) * (H - 1))))
            for j in range(3):
                acc_[j] += c[j] / 255
        return tuple(a / max(1, len(ts)) for a in acc_)

    tris = []  # [(corners [(pos, normal)] in its frame, colour, mirror)]

    def add(m, ts, colour, mirror=False):
        for t in ts:
            tris.append(([(m['v'][m['i'][t + k]], m['n'][m['i'][t + k]]) for k in range(3)], colour, mirror))

    # the walls, window frames and floor: the frames dark grey (dark on its texture, round the windows), the floor where
    # it faces up low down;
    # its side consoles; not its glareshield plate nor its pedestal
    shell = part('CockpitShell')
    img = tex(shell['mat'])
    for ts, b in pieces(shell):
        sx, sy, sz = b[3] - b[0], b[4] - b[1], b[5] - b[2]
        if b[3] < 201.0 and b[1] > 0.7:
            continue  # (its glareshield plate)
        if abs((b[2] + b[5]) / 2 - ZC) < 0.3 and sz < 1.0 and b[4] < 0.7:
            continue  # (its pedestal)
        if sy < 0.8 and b[4] < 0.7:
            add(shell, ts, CONSOLE)  # (the side consoles)
            continue
        for t in ts:
            c3 = [shell['v'][shell['i'][t + k]] for k in range(3)]
            n3 = [shell['n'][shell['i'][t + k]] for k in range(3)]
            ny = sum(n[1] for n in n3) / 3
            y = sum(p[1] for p in c3) / 3
            u = sum(shell['uv'][shell['i'][t + k]][0] for k in range(3)) / 3
            vv = sum(shell['uv'][shell['i'][t + k]][1] for k in range(3)) / 3
            W, H = img.size
            px = img.getpixel((int((u % 1) * (W - 1)), int((vv % 1) * (H - 1))))
            lum = (0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) / 255
            col = FLOOR if (y < -0.2 and abs(ny) > 0.7) else FRAME if lum < 0.12 and y > WINDOWS_Y else LINING
            tris.append(([(c3[k], n3[k]) for k in range(3)], col, False))

    # the roof: its shells, not the small switches on it
    roof = part('RoofUnwrap')
    for ts, b in pieces(roof):
        if max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) > 0.6:
            add(roof, ts, LINING)

    # the seats (the captain's, and mirrored for the first officer), the door and what is on the back wall; not its
    # side-sticks
    chair = part('Chair')
    for ts, b in pieces(chair):
        cx, cy, cz = (b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2
        if 201.0 < cx < 201.4 and b[4] < 0.6:
            continue  # (the side-sticks and their bits)
        seat = 201.3 < cx < 202.6 and b[1] > 0.2 and abs(cz - ZC) > 0.4
        if seat and cz < ZC:
            continue  # (the first officer's: the captain's mirrored instead)
        r, gg, bb = texColour(chair, ts)
        lum = 0.2126 * r + 0.7152 * gg + 0.0722 * bb
        if seat:
            col = SEAT_DARK if lum < 0.18 else METAL if abs(r - bb) < 0.06 and lum < 0.55 and (b[3] - b[0]) < 0.15 else SEAT
            add(chair, ts, col)
            add(chair, ts, col, mirror=True)
        else:
            add(chair, ts, SEAT_DARK if lum < 0.15 else DOOR if lum > 0.55 else CONSOLE)

    # into the cockpit's frame: x = -(z - ZC) S, y = -(x - XE) S, z = (y - YE) S (mirrored: x = -x, the corners turned)
    out = bytearray(b'A35S')
    out += struct.pack('<II', 1, len(tris))
    for corners, col, mirror in tris:
        cs = list(reversed(corners)) if mirror else corners
        for (p, n) in cs:
            x, y, zz = -(p[2] - ZC) * S, -(p[0] - XE) * S, (p[1] - YE) * S
            nx, ny, nz = -n[2], -n[0], n[1]
            if mirror:
                x, nx = -x, -nx
            out += struct.pack('<hhh', *(max(-32767, min(32767, round(c * 1000))) for c in (x, y, zz)))
            out += struct.pack('<bbb', *(max(-127, min(127, round(c * 127))) for c in (nx, ny, nz)))
            out += bytes(rgb(col))
    with open(OUT, 'wb') as f:
        f.write(out)
    print(f'{OUT}: {len(tris)} triangles, {len(out) // 1024} kB')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
