"""git-qa のアイコン（DESIGN.md の決定）。

角丸の四角（md-business / dbboard と同じ家族の形）に、**端末の枠の中のチェック**。
この道具の芯は「端末の画面を人が見て保証する」ことなので、枠＝画面を入れる。
色は #0F768E — 家族の藍（#5B5BD6 / #4F46E5）と Dock で見分けが付くもの。
"""
import math, struct, zlib, sys

SIZE = 1024
BG = (0x0F, 0x76, 0x8E)

def rrect(px, py, x0, y0, x1, y1, r):
    cx = min(max(px, x0 + r), x1 - r); cy = min(max(py, y0 + r), y1 - r)
    return math.hypot(px - cx, py - cy) - r

def seg(px, py, ax, ay, bx, by):
    vx, vy = bx-ax, by-ay; wx, wy = px-ax, py-ay
    t = max(0.0, min(1.0, (wx*vx + wy*vy) / (vx*vx + vy*vy)))
    return math.hypot(wx - t*vx, wy - t*vy)

def cover(d):
    return min(1.0, max(0.0, 0.5 - d/1.5))

pad = SIZE*0.09
r = SIZE*0.22
fw, fh = SIZE*0.34, SIZE*0.54
fx0, fy0 = (SIZE-fw)/2, (SIZE-fh)/2
stroke = SIZE*0.045

rows = []
for y in range(SIZE):
    row = bytearray(); py = y+0.5
    for x in range(SIZE):
        px = x+0.5
        a_bg = cover(rrect(px, py, pad, pad, SIZE-pad, SIZE-pad, r))
        frame = abs(rrect(px, py, fx0, fy0, fx0+fw, fy0+fh, SIZE*0.07)) - stroke/2
        chk = min(seg(px,py, SIZE*0.415, SIZE*0.50, SIZE*0.475, SIZE*0.565),
                  seg(px,py, SIZE*0.475, SIZE*0.565, SIZE*0.60, SIZE*0.40)) - SIZE*0.035
        a_m = cover(min(frame, chk)) * a_bg
        row += bytes((int(BG[0]*(1-a_m)+255*a_m), int(BG[1]*(1-a_m)+255*a_m),
                      int(BG[2]*(1-a_m)+255*a_m), int(a_bg*255)))
    rows.append(row)

raw = b''.join(b'\x00' + bytes(r_) for r_ in rows)
def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))
open(sys.argv[1],'wb').write(b'\x89PNG\r\n\x1a\n'
    + chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
    + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
print('描いた')
