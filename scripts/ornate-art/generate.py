#!/usr/bin/env python3
"""Ornate maximalist poster generator (zero-cost, procedural).

Produces vertical, mirror-symmetric compositions: stacked mandalas, lace
rings, radiating needles, rainbow ribbons, glitch bars, confetti and
chromatic aberration, on a white or black ground.

Usage:
  python3 generate.py --count 8 --out ./out            # 1080x1350 (4:5)
  python3 generate.py --count 4 --size 1080x1920       # vertical video
  python3 generate.py --seed 42 --bg black
"""
import argparse, math, os, random, colorsys
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import numpy as np

# Palette sampled from the reference aesthetic: coral / cyan / gold / navy / magenta / mint
PALETTES = {
    "carnival": ["#ff5a4e", "#ff9f43", "#ffd93d", "#3ddc97", "#2ec4ff", "#4a5cff", "#c84dff", "#ff4fa3", "#0f1f4d", "#ffffff"],
    "aurora":   ["#ff7aa2", "#ffb26b", "#fff275", "#8ff0c8", "#6bd0ff", "#7f8cff", "#d78bff", "#ff8fd1", "#12203f", "#ffffff"],
    "lacquer":  ["#e63946", "#f4a261", "#e9c46a", "#2a9d8f", "#3a86ff", "#3d348b", "#b5179e", "#ff5d8f", "#0b0f2a", "#fff8e7"],
}

def hex2rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def rainbow(t, s=0.85, v=1.0):
    r, g, b = colorsys.hsv_to_rgb(t % 1.0, s, v); return (int(r*255), int(g*255), int(b*255))

class Gen:
    def __init__(self, w, h, seed, bg, palette, ss=2):
        self.rng = random.Random(seed); self.seed = seed
        self.ss = ss; self.W, self.H = w*ss, h*ss; self.outw, self.outh = w, h
        self.dark = (bg == "black")
        self.bgc = (6, 6, 10) if self.dark else (250, 248, 244)
        self.pal = [hex2rgb(c) for c in PALETTES[palette]]
        self.ink = (245, 240, 232) if self.dark else (20, 18, 28)

    def c(self, alpha=255):
        return self.rng.choice(self.pal[:8]) + (alpha,)

    def layer(self):
        return Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))

    # ---------- primitives ----------
    def needles(self, img, cx, cy, r0, r1, n, width=1, alpha=200, jitter=0.3):
        d = ImageDraw.Draw(img)
        for i in range(n):
            a = 2*math.pi*i/n + self.rng.uniform(-jitter, jitter)/n
            rr = r1 * self.rng.uniform(0.35, 1.0)
            col = self.c(alpha) if self.rng.random() < 0.6 else self.ink + (alpha,)
            d.line([(cx+r0*math.cos(a), cy+r0*math.sin(a)), (cx+rr*math.cos(a), cy+rr*math.sin(a))], fill=col, width=width)

    def petal_ring(self, img, cx, cy, r, n, size, col, rot=0.0, shape="petal", outline=False):
        d = ImageDraw.Draw(img)
        kw = ({"outline": col, "width": max(1, self.ss//2)} if outline else {"fill": col})
        for i in range(n):
            a = 2*math.pi*i/n + rot
            px, py = cx + r*math.cos(a), cy + r*math.sin(a)
            if shape == "petal":
                pts = []
                for t in np.linspace(0, 2*math.pi, 24):
                    rr = size*(0.25 + 0.75*abs(math.cos(t)))**1.2
                    pts.append((px + rr*math.cos(t + a), py + rr*math.sin(t + a)))
                d.polygon(pts, **kw)
            elif shape == "dot":
                d.ellipse([px-size, py-size, px+size, py+size], **kw)
            elif shape == "tri":
                pts = [(px + size*math.cos(a + k*2.094), py + size*math.sin(a + k*2.094)) for k in range(3)]
                d.polygon(pts, **kw)
            elif shape == "diamond":
                pts = [(px + size*math.cos(a + k*math.pi/2)*(1 if k % 2 == 0 else 0.45),
                        py + size*math.sin(a + k*math.pi/2)*(1 if k % 2 == 0 else 0.45)) for k in range(4)]
                d.polygon(pts, **kw)

    def mandala(self, img, cx, cy, R):
        d = ImageDraw.Draw(img)
        rings = max(6, min(16, int(R / (self.W*0.022))))  # finer rings on big mandalas
        sub = self.rng.sample(self.pal[:8], 3)  # restricted palette per mandala
        pick = lambda a=255: self.rng.choice(sub) + (a,)
        # bullseye core
        core = R*self.rng.uniform(0.12, 0.25)
        for k in range(6, 0, -1):
            rr = core*k/6
            col = pick() if k % 2 else self.ink + (255,)
            d.ellipse([cx-rr, cy-rr, cx+rr, cy+rr], fill=col)
        for k in range(1, 5):  # fine concentric hairlines
            rr = core*(1 + 0.12*k)
            d.ellipse([cx-rr, cy-rr, cx+rr, cy+rr], outline=self.ink + (200,), width=max(1, self.ss//2))
        for i in range(rings):
            r = core + (R-core)*(i+1)/rings
            n = self.rng.choice([24, 32, 36, 48, 60, 72]) if r > self.W*0.12 else self.rng.choice([12, 16, 18, 24, 32])
            shape = self.rng.choice(["petal", "dot", "tri", "diamond", "petal"])
            size = min((R/rings)*self.rng.uniform(0.3, 0.6), (2*math.pi*r/n)*0.55)
            col = pick(self.rng.randint(200, 255))
            rot = self.rng.uniform(0, math.pi)
            self.petal_ring(img, cx, cy, r, n, size, col, rot=rot, shape=shape)
            self.petal_ring(img, cx, cy, r, n, size, self.ink + (230,), rot=rot, shape=shape, outline=True)
            if self.rng.random() < 0.6:
                self.petal_ring(img, cx, cy, r, n, size*0.45, self.ink + (255,), rot=self.rng.uniform(0, math.pi), shape="dot")
            # thin outline ring
            w = max(1, int(self.ss*self.rng.choice([0.5, 0.5, 1])))
            d.ellipse([cx-r, cy-r, cx+r, cy+r], outline=self.ink + (170,), width=w)
            if self.rng.random() < 0.5:  # dotted hairline ring between rings
                rr = r + (R/rings)*0.5
                for j in range(n*3):
                    a = 2*math.pi*j/(n*3)
                    d.point((cx+rr*math.cos(a), cy+rr*math.sin(a)), fill=self.ink + (255,))
        # outer needles (fine)
        self.needles(img, cx, cy, R, R*self.rng.uniform(1.1, 1.5), self.rng.randint(60, 160), width=max(1, self.ss//2), alpha=150)

    def lace_ring(self, img, cx, cy, r, n=64, depth=3):
        d = ImageDraw.Draw(img)
        for i in range(n):
            a0, a1 = 2*math.pi*i/n, 2*math.pi*(i+1)/n
            for k in range(depth):
                rr = r*(1 + 0.08*k)
                sz = r*0.09*(1 - 0.2*k)
                mx, my = cx + rr*math.cos((a0+a1)/2), cy + rr*math.sin((a0+a1)/2)
                d.arc([mx-sz, my-sz, mx+sz, my+sz], 0, 360, fill=self.ink + (180,), width=self.ss)
                if k == 0:
                    d.ellipse([mx-sz*0.35, my-sz*0.35, mx+sz*0.35, my+sz*0.35], fill=self.c())

    def ribbon(self, img, pts, width, bands=7):
        """Rainbow ribbon along a bezier path (stacked hue offsets)."""
        d = ImageDraw.Draw(img)
        # sample bezier
        def bez(t, p):
            n = len(p)-1
            x = sum(math.comb(n, k)*(1-t)**(n-k)*t**k*p[k][0] for k in range(n+1))
            y = sum(math.comb(n, k)*(1-t)**(n-k)*t**k*p[k][1] for k in range(n+1))
            return x, y
        samples = [bez(t, pts) for t in np.linspace(0, 1, 160)]
        # normals
        for b in range(bands):
            off = (b - bands/2) * width/bands
            hue = b/bands
            poly = []
            for i in range(len(samples)-1):
                (x0, y0), (x1, y1) = samples[i], samples[i+1]
                dx, dy = x1-x0, y1-y0; L = math.hypot(dx, dy) or 1
                nx, ny = -dy/L, dx/L
                poly.append((x0+nx*off, y0+ny*off))
            for i in range(len(samples)-2, -1, -1):
                (x0, y0), (x1, y1) = samples[i], samples[i+1]
                dx, dy = x1-x0, y1-y0; L = math.hypot(dx, dy) or 1
                nx, ny = -dy/L, dx/L
                poly.append((x0+nx*(off+width/bands+1), y0+ny*(off+width/bands+1)))
            d.polygon(poly, fill=rainbow(hue, 0.55, 1.0) + (225,))

    def confetti(self, img, cx, cy, spread, n):
        d = ImageDraw.Draw(img)
        for _ in range(n):
            a = self.rng.uniform(0, 2*math.pi); r = abs(self.rng.gauss(0, spread))
            x, y = cx + r*math.cos(a), cy + r*math.sin(a)*1.6
            s = self.ss*self.rng.uniform(1.2, 5)*max(0.3, 1 - r/(spread*2.2))
            col = self.c(self.rng.randint(150, 255)) if self.rng.random() < 0.7 else self.ink + (200,)
            k = self.rng.random()
            if k < 0.35:
                d.polygon([(x, y-s), (x+s, y), (x, y+s), (x-s, y)], fill=col)
            elif k < 0.6:
                d.line([(x-s, y), (x+s, y)], fill=col, width=self.ss); d.line([(x, y-s), (x, y+s)], fill=col, width=self.ss)
            elif k < 0.8:
                d.ellipse([x-s*0.5, y-s*0.5, x+s*0.5, y+s*0.5], fill=col)
            else:
                d.polygon([(x, y-s), (x+s*0.9, y+s*0.6), (x-s*0.9, y+s*0.6)], fill=col)

    def vertical_rails(self, img):
        d = ImageDraw.Draw(img)
        n = self.rng.randint(6, 16)
        for _ in range(n):
            x = self.W/2 + self.rng.gauss(0, self.W*0.22)
            col = self.c(self.rng.randint(120, 230))
            w = self.ss*self.rng.choice([1, 1, 2, 3, 6])
            y0 = self.rng.uniform(0, self.H*0.4); y1 = self.rng.uniform(self.H*0.6, self.H)
            d.line([(x, y0), (x, y1)], fill=col, width=w)
            # tick marks
            for y in np.arange(y0, y1, self.ss*self.rng.randint(18, 60)):
                d.line([(x-self.ss*4, y), (x+self.ss*4, y)], fill=self.ink + (160,), width=self.ss)

    def text_block(self, img):
        """Tiny 'fake typography' texture like a page of a storybook."""
        d = ImageDraw.Draw(img)
        x0 = self.rng.choice([self.W*0.06, self.W*0.62]); y0 = self.rng.uniform(self.H*0.55, self.H*0.8)
        for row in range(self.rng.randint(10, 22)):
            y = y0 + row*self.ss*7
            x = x0
            while x < x0 + self.W*0.3:
                wlen = self.ss*self.rng.randint(4, 22)
                d.line([(x, y), (x+wlen, y)], fill=self.ink + (150,), width=max(1, self.ss//2))
                x += wlen + self.ss*4

    def vine(self, img, x, y, ang, length, depth, width):
        """Recursive ink branch with tiny berries -> filigree."""
        if depth == 0 or length < self.ss*3: return
        d = ImageDraw.Draw(img)
        pts = [(x, y)]; cx, cy, a = x, y, ang
        segs = 6
        for i in range(segs):
            a += self.rng.uniform(-0.35, 0.35)
            cx += length/segs*math.cos(a); cy += length/segs*math.sin(a); pts.append((cx, cy))
        d.line(pts, fill=self.ink + (220,), width=max(1, int(width)), joint="curve")
        if self.rng.random() < 0.5:
            s_ = self.ss*self.rng.uniform(1.5, 4)
            d.ellipse([cx-s_, cy-s_, cx+s_, cy+s_], fill=self.c())
        for _ in range(self.rng.randint(1, 3)):
            t = self.rng.randint(1, segs); bx, by = pts[t]
            self.vine(img, bx, by, a + self.rng.choice([-1, 1])*self.rng.uniform(0.5, 1.3), length*self.rng.uniform(0.45, 0.7), depth-1, width*0.7)

    # ---------- post ----------
    def glitch(self, im):
        arr = np.array(im)
        h, w, _ = arr.shape
        for _ in range(self.rng.randint(3, 8)):
            y = self.rng.randint(0, h-1); bh = self.rng.randint(self.ss*1, self.ss*14)
            dx = self.rng.randint(-w//30, w//30)
            arr[y:y+bh] = np.roll(arr[y:y+bh], dx, axis=1)
        # chromatic aberration on a band region
        for _ in range(self.rng.randint(1, 3)):
            y = self.rng.randint(0, h-1); bh = self.rng.randint(self.ss*30, self.ss*140)
            sh = self.rng.randint(self.ss*1, self.ss*5)
            band = arr[y:y+bh].copy()
            band[..., 0] = np.roll(band[..., 0], sh, axis=1)
            band[..., 2] = np.roll(band[..., 2], -sh, axis=1)
            arr[y:y+bh] = band
        return Image.fromarray(arr)

    def paper(self, im):
        noise = np.random.default_rng(self.seed).normal(0, 6 if self.dark else 5, (self.outh, self.outw, 1))
        arr = np.clip(np.array(im).astype(np.int16) + noise, 0, 255).astype(np.uint8)
        return Image.fromarray(arr)

    # ---------- composition ----------
    def render(self):
        base = Image.new("RGBA", (self.W, self.H), self.bgc + (255,))
        cx = self.W/2

        # 0. faint sunburst behind everything
        L = self.layer(); self.needles(L, cx, self.H*self.rng.uniform(0.3, 0.6), 0, self.W*0.9, 220, width=max(1, self.ss//2), alpha=45)
        base.alpha_composite(L)

        # 1. vertical rails + fake text
        L = self.layer(); self.vertical_rails(L); self.text_block(L)
        base.alpha_composite(L)

        # 2. stacked mandalas along axis (drawn on half, mirrored)
        half = self.layer()
        n_m = self.rng.randint(3, 5)
        ys = np.linspace(self.H*0.16, self.H*0.86, n_m) + np.array([self.rng.gauss(0, self.H*0.02) for _ in range(n_m)])
        hero = self.rng.randrange(n_m)
        for i, y in enumerate(ys):
            R = self.W*(self.rng.uniform(0.30, 0.40) if i == hero else self.rng.uniform(0.10, 0.20))
            self.mandala(half, cx, y, R)
            if self.rng.random() < 0.7:
                self.lace_ring(half, cx, y, R*1.12, n=self.rng.choice([48, 64, 96]))
        # satellite mandalas
        for _ in range(self.rng.randint(3, 7)):
            self.mandala(half, cx + self.rng.uniform(self.W*0.18, self.W*0.42), self.rng.uniform(self.H*0.05, self.H*0.95), self.W*self.rng.uniform(0.05, 0.12))
        # ink vines sprouting from the mandalas
        for y in ys:
            for _ in range(self.rng.randint(4, 9)):
                ang = self.rng.uniform(-math.pi, math.pi)
                self.vine(half, cx + self.rng.uniform(0, self.W*0.15)*math.cos(ang), y + self.rng.uniform(0, self.W*0.15)*math.sin(ang), ang, self.W*self.rng.uniform(0.12, 0.28), 4, self.ss*1.2)
        # mirror: keep left half and flip
        left = half.crop((0, 0, self.W//2, self.H))
        mirrored = Image.new("RGBA", (self.W, self.H)); mirrored.paste(left, (0, 0)); mirrored.paste(left.transpose(Image.FLIP_LEFT_RIGHT), (self.W - self.W//2, 0))
        base.alpha_composite(mirrored)

        # 3. central "egg / moon" focal
        if self.rng.random() < 0.75:
            L = self.layer(); d = ImageDraw.Draw(L)
            ey = self.H*self.rng.uniform(0.2, 0.5); er = self.W*self.rng.uniform(0.16, 0.26)
            egg = self.ink + (255,) if not self.dark else (232, 226, 218, 255)
            d.ellipse([cx-er, ey-er*1.3, cx+er, ey+er*1.3], fill=(self.bgc if self.dark else (236, 232, 226)) + (255,), outline=self.ink + (255,), width=self.ss*2)
            self.mandala(L, cx, ey, er*0.7)
            base.alpha_composite(L)

        # 4. rainbow ribbons
        L = self.layer()
        for _ in range(self.rng.randint(2, 4)):
            pts = [(self.rng.uniform(-self.W*0.1, self.W*1.1), self.rng.uniform(0, self.H)) for _ in range(4)]
            self.ribbon(L, pts, self.W*self.rng.uniform(0.012, 0.03), bands=self.rng.choice([6, 7, 9]))
        base.alpha_composite(L)

        # 5. confetti explosion + fine needles on top
        L = self.layer()
        for y in ys:
            self.confetti(L, cx, y, self.W*0.25, self.rng.randint(400, 900))
        self.confetti(L, cx, self.H/2, self.W*0.45, 1500)
        self.needles(L, cx, ys[hero], self.W*0.05, self.W*0.6, 140, width=max(1, self.ss//2), alpha=110)
        base.alpha_composite(L)

        # 6. glitch, downsample, paper grain
        im = self.glitch(base.convert("RGB"))
        im = im.resize((self.outw, self.outh), Image.LANCZOS)
        im = self.paper(im)
        return im

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=4)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--size", default="1080x1350")
    ap.add_argument("--bg", default="mix", choices=["white", "black", "mix"])
    ap.add_argument("--palette", default="mix", choices=list(PALETTES) + ["mix"])
    ap.add_argument("--out", default="out")
    ap.add_argument("--ss", type=int, default=2, help="supersampling factor")
    a = ap.parse_args()
    w, h = map(int, a.size.lower().split("x"))
    os.makedirs(a.out, exist_ok=True)
    master = random.Random(a.seed)
    for i in range(a.count):
        seed = master.randint(0, 10**9) if a.seed is None or a.count > 1 else a.seed
        bg = master.choice(["white", "black"]) if a.bg == "mix" else a.bg
        pal = master.choice(list(PALETTES)) if a.palette == "mix" else a.palette
        im = Gen(w, h, seed, bg, pal, ss=a.ss).render()
        path = os.path.join(a.out, f"ornate_{bg}_{pal}_{seed}.png")
        im.save(path, optimize=True); print(path)

if __name__ == "__main__":
    main()
