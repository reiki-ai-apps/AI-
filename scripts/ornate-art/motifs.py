"""Figures, objects and typography for the ornate poster generator.

Everything is drawn procedurally with Pillow: an ink-silhouette girl in a
frilled dress and striped stockings, wonderland props (cheshire cat, rabbit,
pocket watch, teacup, key, cards, moon, crown, mushroom, top hat, umbrella)
and layered typography (serif titles, vertical Japanese, tiny book text).
"""
import math, random
from PIL import Image, ImageDraw, ImageFont

FONTS = {
    "serif":   "/usr/share/fonts/truetype/freefont/FreeSerif.ttf",
    "italic":  "/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf",
    "bold":    "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf",
    "jp":      "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "mono":    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
}
def font(kind, size):
    try: return ImageFont.truetype(FONTS[kind], int(max(6, size)))
    except Exception: return ImageFont.load_default()

TITLES = ["Wonderland", "ALICE", "Curiouser & curiouser", "Off with her head", "Tea Party", "Down the Rabbit-Hole",
          "We're all mad here", "Drink me", "Eat me", "Who are you?", "Looking-Glass", "Queen of Hearts", "The White Rabbit"]
JP = ["不思議の国", "午後三時のお茶会", "白兎を追って", "首をはねよ", "鏡の国", "私を飲んで", "遅刻だ遅刻だ", "ハートの女王", "帽子屋", "夢の終わり", "誰なの、あなた", "時計は止まったまま"]
SMALL = ["Ch. III", "No. 07", "VOL. XIII", "act 2 / scene 4", "N 35°41′ E 139°41′", "3:00 P.M.", "1865", "MMXXVI", "pg. 112", "ed. 2nd"]
BOOK = ("Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: "
        "once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, "
        "'and what is the use of a book,' thought Alice 'without pictures or conversations?' So she was considering in her own mind "
        "(as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain "
        "would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her. "
        "There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself, "
        "'Oh dear! Oh dear! I shall be late!' but when the Rabbit actually took a watch out of its waistcoat-pocket, and looked at it, "
        "and then hurried on, Alice started to her feet, for it flashed across her mind that she had never before seen a rabbit with "
        "either a waistcoat-pocket, or a watch to take out of it, and burning with curiosity, she ran across the field after it.")

def halo_composite(base, layer, paper, radius):
    """Paste `layer` onto `base` with a paper-coloured outline so motifs read on busy ground."""
    from PIL import ImageFilter
    a = layer.split()[3].filter(ImageFilter.MaxFilter(int(radius)*2+1))
    halo = Image.new("RGBA", layer.size, paper[:3] + (0,)); halo.putalpha(a)
    base.alpha_composite(halo); base.alpha_composite(layer)

def _rot(pts, cx, cy, a):
    ca, sa = math.cos(a), math.sin(a)
    return [(cx + (x-cx)*ca - (y-cy)*sa, cy + (x-cx)*sa + (y-cy)*ca) for x, y in pts]

# ------------------------------------------------------------------ figure
def draw_girl(img, x, y, h, ink, paper, accent, accent2, rng, flip=False, prop="umbrella"):
    """Ink silhouette girl. (x, y) = feet centre, h = total height."""
    d = ImageDraw.Draw(img)
    u = h/100.0  # unit
    sx = -1 if flip else 1
    def P(px, py): return (x + px*u*sx, y - py*u)
    def poly(pts, fill, outline=None, w=1): d.polygon([P(*p) for p in pts], fill=fill, outline=outline, width=w)
    def ell(px, py, rx, ry, fill, outline=None, w=1):
        (ax, ay) = P(px, py); d.ellipse([ax-rx*u, ay-ry*u, ax+rx*u, ay+ry*u], fill=fill, outline=outline, width=w)

    # hair: bob around the head + two long strands falling to the waist
    ell(0, 85, 9, 9.5, ink)
    poly([(-8, 84), (-4, 84), (-6, 62), (-11, 56), (-13, 66)], ink)
    poly([(8, 84), (4, 84), (7, 60), (12, 54), (14, 66)], ink)
    # skirt (A-line) with scalloped hem
    skirt = [(-7, 58), (7, 58), (22, 24), (-22, 24)]
    poly(skirt, ink)
    for i in range(-5, 6):  # frill scallops along the hem
        ell(i*4.2, 24, 2.6, 2.4, ink)
        ell(i*4.2, 24.5, 1.4, 1.2, paper)
    # apron (paper-coloured panel with lace edge)
    apron = [(-4, 56), (4, 56), (13, 27), (-13, 27)]
    poly(apron, paper)
    for i in range(-3, 4): ell(i*4, 26.5, 1.8, 1.6, paper)
    # apron ornament: tiny colored dots
    for i in range(-2, 3): ell(i*3, 40, 0.9, 0.9, accent)
    # bodice
    poly([(-7, 72), (7, 72), (8, 58), (-8, 58)], ink)
    # puffed sleeves
    ell(-11, 68, 5.5, 5, ink); ell(11, 68, 5.5, 5, ink)
    ell(-11, 68, 2.2, 2, paper); ell(11, 68, 2.2, 2, paper)
    # collar
    poly([(-4, 74), (4, 74), (0, 70)], paper)
    # arms
    poly([(-13, 66), (-10, 66), (-14, 46), (-17, 47)], ink)         # left arm down
    poly([(11, 66), (14, 66), (24, 76), (22, 79)], ink)             # right arm raised (holds prop)
    # legs with stripes
    for lx in (-4, 4):
        poly([(lx-2.2, 25), (lx+2.2, 25), (lx+2.6, 4), (lx-2.6, 4)], ink)
        for k in range(6):  # stripe bands (paper / accent alternating)
            yy = 6 + k*3.2
            poly([(lx-2.4, yy), (lx+2.4, yy), (lx+2.4, yy+1.4), (lx-2.4, yy+1.4)], paper if k % 2 == 0 else accent2)
    # shoes (mary janes with platform)
    for lx in (-4, 4):
        ell(lx + 0.8*sx, 2.5, 4.2, 2.6, ink); ell(lx + 0.8*sx, 1.0, 4.6, 1.2, ink); ell(lx + 0.8*sx, 3.5, 1.0, 0.7, accent)
    # head (paper face with one eye + fringe)
    ell(0.8*sx, 82.5, 6.0, 6.6, paper)                       # face
    poly([(-7, 88), (7, 88), (6, 84), (2, 86), (-2, 83), (-6, 85)], ink)   # fringe
    ell(2.5*sx, 82, 0.9, 1.2, ink)                           # eye
    ell(3.6*sx, 80, 0.6, 0.4, accent)                        # blush
    # ribbon / bow on head
    ell(-5*sx, 92, 3.2, 2.2, accent); ell(-9*sx, 91, 3.2, 2.2, accent); ell(-7*sx, 91.5, 1.1, 1.1, ink)
    # prop in raised hand
    px, py = 25, 78
    if prop == "umbrella":
        poly([(px-14, py+2), (px+14, py+2), (px, py+16)], accent)
        for i in range(-2, 3): ell(px + i*6, py+2, 3.4, 2.2, accent); ell(px + i*6, py+2.6, 2.0, 1.2, paper)
        poly([(px-0.5, py+16), (px+0.5, py+16), (px+0.5, py-8), (px-0.5, py-8)], ink)
        ell(px, py+17, 1.2, 1.2, ink)
    elif prop == "key":
        ell(px, py+8, 4, 4, None, ink, 3); poly([(px-0.8, py+4), (px+0.8, py+4), (px+0.8, py-10), (px-0.8, py-10)], ink)
        poly([(px, py-8), (px+4, py-8), (px+4, py-6), (px, py-6)], ink); poly([(px, py-4), (px+3, py-4), (px+3, py-2.5), (px, py-2.5)], ink)
    elif prop == "teacup":
        poly([(px-6, py+6), (px+6, py+6), (px+4, py-2), (px-4, py-2)], paper, ink, 3)
        ell(px+7, py+2, 3, 3, None, ink, 3); poly([(px-8, py-3), (px+8, py-3), (px+8, py-5), (px-8, py-5)], ink)
    elif prop == "balloon":
        ell(px+2, py+14, 8, 10, accent2, ink, 2); d.line([P(px+2, py+4), P(px, py-2)], fill=ink, width=2)
        ell(px+2, py+14, 2, 3, paper)

# ------------------------------------------------------------------ props
def cheshire(img, x, y, s, ink, paper, accent, rng):
    d = ImageDraw.Draw(img)
    d.ellipse([x-s, y-s*0.7, x+s, y+s*0.7], fill=accent, outline=ink, width=max(1, int(s*0.04)))
    # ears
    d.polygon([(x-s*0.8, y-s*0.5), (x-s*0.55, y-s*1.15), (x-s*0.25, y-s*0.62)], fill=accent, outline=ink)
    d.polygon([(x+s*0.8, y-s*0.5), (x+s*0.55, y-s*1.15), (x+s*0.25, y-s*0.62)], fill=accent, outline=ink)
    # grin
    d.chord([x-s*0.8, y-s*0.3, x+s*0.8, y+s*0.55], 10, 170, fill=paper, outline=ink, width=max(1, int(s*0.03)))
    n = 11
    for i in range(n):
        tx = x - s*0.72 + i*(s*1.44/n)
        d.polygon([(tx, y+s*0.05), (tx+s*0.11, y+s*0.05), (tx+s*0.055, y+s*0.3)], fill=paper, outline=ink)
    d.line([(x-s*0.8, y+s*0.05), (x+s*0.8, y+s*0.05)], fill=ink, width=max(1, int(s*0.03)))
    # eyes
    for ex in (x-s*0.4, x+s*0.4):
        d.ellipse([ex-s*0.17, y-s*0.45, ex+s*0.17, y-s*0.18], fill=paper, outline=ink)
        d.ellipse([ex-s*0.07, y-s*0.38, ex+s*0.07, y-s*0.24], fill=ink)
    # stripes
    for i in range(-3, 4):
        d.arc([x-s+abs(i)*s*0.1, y-s*0.7, x+s-abs(i)*s*0.1, y+s*0.7], 200+i*8, 230+i*8, fill=ink, width=max(1, int(s*0.05)))

def rabbit(img, x, y, s, ink, paper, accent):
    d = ImageDraw.Draw(img)
    d.ellipse([x-s*0.5, y-s*0.2, x+s*0.5, y+s*0.9], fill=paper, outline=ink, width=2)     # body
    d.ellipse([x-s*0.35, y-s*0.6, x+s*0.35, y], fill=paper, outline=ink, width=2)         # head
    for ex, tilt in ((x-s*0.18, -0.15), (x+s*0.18, 0.15)):
        pts = [(ex-s*0.1, y-s*0.5), (ex+s*0.1, y-s*0.5), (ex+s*0.06+tilt*s, y-s*1.3), (ex-s*0.06+tilt*s, y-s*1.3)]
        d.polygon(pts, fill=paper, outline=ink, width=2)
        d.polygon([(px + (ex-px)*0.5, py + ((y-s*0.5)-py)*0.5) for px, py in pts], fill=accent)
    d.ellipse([x-s*0.06, y-s*0.35, x+s*0.06, y-s*0.23], fill=accent)  # pink eye
    d.rectangle([x-s*0.3, y+s*0.1, x+s*0.3, y+s*0.5], fill=accent, outline=ink)  # waistcoat
    pocket_watch(img, x+s*0.45, y+s*0.55, s*0.28, ink, paper, accent)

def pocket_watch(img, x, y, r, ink, paper, accent):
    d = ImageDraw.Draw(img)
    d.ellipse([x-r, y-r, x+r, y+r], fill=paper, outline=ink, width=max(2, int(r*0.08)))
    d.ellipse([x-r*0.88, y-r*0.88, x+r*0.88, y+r*0.88], outline=ink, width=1)
    for i in range(60):
        a = 2*math.pi*i/60; L = r*0.12 if i % 5 == 0 else r*0.05
        d.line([(x+(r*0.85-L)*math.cos(a), y+(r*0.85-L)*math.sin(a)), (x+r*0.85*math.cos(a), y+r*0.85*math.sin(a))], fill=ink, width=2 if i % 5 == 0 else 1)
    f = font("serif", r*0.28)
    for i, t in enumerate(["XII", "III", "VI", "IX"]):
        a = -math.pi/2 + i*math.pi/2
        d.text((x+r*0.62*math.cos(a), y+r*0.62*math.sin(a)), t, fill=ink, font=f, anchor="mm")
    d.line([(x, y), (x+r*0.5*math.cos(-1.0), y+r*0.5*math.sin(-1.0))], fill=ink, width=max(2, int(r*0.06)))
    d.line([(x, y), (x+r*0.75*math.cos(0.6), y+r*0.75*math.sin(0.6))], fill=accent, width=max(2, int(r*0.04)))
    d.ellipse([x-r*0.06, y-r*0.06, x+r*0.06, y+r*0.06], fill=ink)
    d.rectangle([x-r*0.12, y-r*1.18, x+r*0.12, y-r*0.95], fill=ink)      # crown
    d.ellipse([x-r*0.2, y-r*1.45, x+r*0.2, y-r*1.1], outline=ink, width=3)  # bow
    # chain
    cx, cy = x+r*0.15, y-r*1.4
    for i in range(12):
        cx += r*0.22; cy -= r*0.12*math.sin(i*0.9)
        d.ellipse([cx-r*0.08, cy-r*0.08, cx+r*0.08, cy+r*0.08], outline=ink, width=2)

def teacup(img, x, y, s, ink, paper, accent):
    d = ImageDraw.Draw(img)
    d.polygon([(x-s, y), (x+s, y), (x+s*0.7, y+s*0.9), (x-s*0.7, y+s*0.9)], fill=paper, outline=ink, width=2)
    d.ellipse([x-s, y-s*0.2, x+s, y+s*0.2], fill=paper, outline=ink, width=2)
    d.arc([x+s*0.8, y+s*0.1, x+s*1.5, y+s*0.7], -90, 90, fill=ink, width=3)
    d.ellipse([x-s*1.5, y+s*0.75, x+s*1.5, y+s*1.1], outline=ink, width=2)
    for i in range(5): d.ellipse([x-s*0.7+i*s*0.35, y+s*0.4, x-s*0.55+i*s*0.35, y+s*0.55], fill=accent)
    for i in range(3):  # steam
        d.arc([x-s*0.3+i*s*0.3, y-s*1.0, x+i*s*0.3, y-s*0.3], 0, 180, fill=ink, width=1)

def playing_card(img, x, y, s, ink, paper, accent, rot=0.0, suit="heart"):
    L = Image.new("RGBA", (int(s*1.4)+4, int(s*2)+4), (0, 0, 0, 0)); d = ImageDraw.Draw(L)
    d.rounded_rectangle([2, 2, s*1.4, s*2], radius=s*0.12, fill=paper, outline=ink, width=2)
    cx, cy = s*0.7, s*1.0
    if suit == "heart":
        d.ellipse([cx-s*0.36, cy-s*0.35, cx, cy+0.02*s], fill=accent); d.ellipse([cx, cy-s*0.35, cx+s*0.36, cy+0.02*s], fill=accent)
        d.polygon([(cx-s*0.36, cy-s*0.12), (cx+s*0.36, cy-s*0.12), (cx, cy+s*0.4)], fill=accent)
    else:
        d.polygon([(cx, cy-s*0.4), (cx+s*0.35, cy), (cx, cy+s*0.4), (cx-s*0.35, cy)], fill=ink)
    f = font("bold", s*0.32); d.text((s*0.16, s*0.1), "Q", fill=ink, font=f); d.text((s*1.22, s*1.6), "Q", fill=ink, font=f, anchor="rs")
    L = L.rotate(math.degrees(rot), resample=Image.BICUBIC, expand=True)
    img.alpha_composite(L, (int(x-L.width/2), int(y-L.height/2)))

def crescent(img, x, y, r, ink, paper):
    d = ImageDraw.Draw(img); d.ellipse([x-r, y-r, x+r, y+r], fill=ink); d.ellipse([x-r*0.55, y-r*1.05, x+r*1.05, y+r*0.55], fill=paper)

def crown(img, x, y, s, ink, accent):
    d = ImageDraw.Draw(img)
    d.polygon([(x-s, y+s*0.5), (x+s, y+s*0.5), (x+s, y-s*0.1), (x+s*0.55, y+s*0.15), (x, y-s*0.7), (x-s*0.55, y+s*0.15), (x-s, y-s*0.1)], fill=accent, outline=ink, width=2)
    for px in (x-s, x, x+s): d.ellipse([px-s*0.12, y-s*0.8-(s*0.0 if px != x else s*0.05), px+s*0.12, y-s*0.56], fill=ink)

def mushroom(img, x, y, s, ink, paper, accent):
    d = ImageDraw.Draw(img)
    d.polygon([(x-s*0.3, y), (x+s*0.3, y), (x+s*0.25, y+s*0.9), (x-s*0.25, y+s*0.9)], fill=paper, outline=ink, width=2)
    d.chord([x-s, y-s*0.8, x+s, y+s*0.3], 180, 360, fill=accent, outline=ink, width=2)
    for i in range(5): d.ellipse([x-s*0.7+i*s*0.35, y-s*0.5+(i%2)*s*0.15, x-s*0.5+i*s*0.35, y-s*0.3+(i%2)*s*0.15], fill=paper)

def top_hat(img, x, y, s, ink, accent):
    d = ImageDraw.Draw(img)
    d.rectangle([x-s*0.6, y-s*1.2, x+s*0.6, y], fill=ink); d.ellipse([x-s, y-s*0.15, x+s, y+s*0.15], fill=ink)
    d.rectangle([x-s*0.6, y-s*0.4, x+s*0.6, y-s*0.2], fill=accent)
    f = font("mono", s*0.18); d.text((x, y-s*0.75), "10/6", fill=accent, font=f, anchor="mm")

def eye(img, x, y, s, ink, paper, accent):
    d = ImageDraw.Draw(img)
    d.polygon([(x-s, y), (x-s*0.5, y-s*0.5), (x, y-s*0.6), (x+s*0.5, y-s*0.5), (x+s, y), (x+s*0.5, y+s*0.5), (x, y+s*0.6), (x-s*0.5, y+s*0.5)], fill=paper, outline=ink, width=2)
    d.ellipse([x-s*0.4, y-s*0.4, x+s*0.4, y+s*0.4], fill=accent, outline=ink); d.ellipse([x-s*0.18, y-s*0.18, x+s*0.18, y+s*0.18], fill=ink)
    d.ellipse([x-s*0.1, y-s*0.3, x+s*0.02, y-s*0.18], fill=paper)

def prop(kind, img, x, y, s, ink, paper, accent, accent2, rng):
    if kind == "cheshire": cheshire(img, x, y, s, ink, paper, accent, rng)
    elif kind == "rabbit": rabbit(img, x, y, s, ink, paper, accent)
    elif kind == "watch": pocket_watch(img, x, y, s, ink, paper, accent)
    elif kind == "teacup": teacup(img, x, y, s*0.8, ink, paper, accent)
    elif kind == "card": playing_card(img, x, y, s, ink, paper, accent, rot=rng.uniform(-0.5, 0.5), suit=rng.choice(["heart", "spade"]))
    elif kind == "moon": crescent(img, x, y, s, ink, paper)
    elif kind == "crown": crown(img, x, y, s*0.8, ink, accent)
    elif kind == "mushroom": mushroom(img, x, y, s, ink, paper, accent)
    elif kind == "hat": top_hat(img, x, y, s, ink, accent)
    elif kind == "eye": eye(img, x, y, s, ink, paper, accent)
PROPS = ["cheshire", "rabbit", "watch", "teacup", "card", "moon", "crown", "mushroom", "hat", "eye"]

# ------------------------------------------------------------------ typography
def draw_text_rot(img, x, y, text, f, fill, angle=0.0, anchor="mm"):
    if abs(angle) < 1e-3:
        ImageDraw.Draw(img).text((x, y), text, fill=fill, font=f, anchor=anchor); return
    bb = f.getbbox(text); w, h = bb[2]-bb[0]+8, bb[3]-bb[1]+8
    L = Image.new("RGBA", (w, h), (0, 0, 0, 0)); ImageDraw.Draw(L).text((4-bb[0], 4-bb[1]), text, fill=fill, font=f)
    L = L.rotate(math.degrees(angle), resample=Image.BICUBIC, expand=True)
    img.alpha_composite(L, (int(x-L.width/2), int(y-L.height/2)))

def vertical_jp(img, x, y, text, f, fill, gap=1.05):
    d = ImageDraw.Draw(img); size = f.size
    for i, ch in enumerate(text):
        d.text((x, y + i*size*gap), ch, fill=fill, font=f, anchor="mm")

def book_text(img, x, y, w, size, fill, lines=14, start=0):
    d = ImageDraw.Draw(img); f = font("serif", size)
    words = BOOK.split(); i = start % len(words); row = 0
    while row < lines:
        line = ""
        while i < len(words) and d.textlength(line + words[i] + " ", font=f) < w:
            line += words[i] + " "; i += 1
        if i >= len(words): i = 0
        d.text((x, y + row*size*1.35), line.strip(), fill=fill, font=f); row += 1

def typography_layer(img, W, H, ink, accent, rng, dark):
    """Layered type: hero serif title, vertical JP, small labels, letters as ornaments, book paragraph."""
    d = ImageDraw.Draw(img)
    # hero title (outline + ghost fill)
    title = rng.choice(TITLES)
    f = font(rng.choice(["italic", "serif", "bold"]), W*rng.uniform(0.09, 0.14))
    tx, ty = W*0.5, H*rng.choice([0.07, 0.93, 0.5])
    ang = rng.choice([0, 0, 0, -math.pi/2])
    if ang: tx, ty = W*rng.choice([0.08, 0.92]), H*0.5
    ghost = accent + (90,)
    draw_text_rot(img, tx+3, ty+3, title, f, ghost, ang)
    draw_text_rot(img, tx, ty, title, f, ink + (235,), ang)
    # vertical Japanese
    fj = font("jp", W*rng.uniform(0.035, 0.05))
    for _ in range(rng.randint(1, 2)):
        vertical_jp(img, W*rng.choice([0.06, 0.94, 0.12, 0.88]), H*rng.uniform(0.1, 0.4), rng.choice(JP), fj, ink + (230,))
    # small labels (mono / serif)
    for _ in range(rng.randint(4, 8)):
        fs = font(rng.choice(["mono", "italic"]), W*rng.uniform(0.014, 0.022))
        draw_text_rot(img, rng.uniform(W*0.05, W*0.95), rng.uniform(H*0.05, H*0.95), rng.choice(SMALL), fs, ink + (200,), rng.choice([0, 0, math.pi/2, -math.pi/2]))
    # letters as ornaments
    fl = font("serif", W*rng.uniform(0.05, 0.09))
    for ch in rng.sample("ABCDEFGHJKLMNPQRSTUVWXYZ&?!※☆", rng.randint(3, 7)):
        col = (accent + (150,)) if rng.random() < 0.5 else ink + (120,)
        draw_text_rot(img, rng.uniform(W*0.05, W*0.95), rng.uniform(H*0.05, H*0.95), ch, fl, col, rng.uniform(-0.6, 0.6))
    # book paragraph block
    book_text(img, W*rng.choice([0.05, 0.6]), H*rng.uniform(0.55, 0.85), W*0.34, W*0.011, ink + (190,), lines=rng.randint(10, 18), start=rng.randint(0, 120))
