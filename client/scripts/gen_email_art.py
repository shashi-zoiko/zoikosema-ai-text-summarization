"""Generate the illustrated hero art used at the top of ZoikoSema meeting emails.

Flat-vector illustrations on a soft tinted circle with scattered confetti — the
"you're invited / starting soon / cancelled" hero graphics. Output transparent
PNGs into client/public/ so they are served at meet.zoikosema.com/<name>.png and
can be referenced from the transactional email HTML (email clients block SVG /
strip base64, so hosted PNG is the only reliable option).

Run:  python client/scripts/gen_email_art.py
Re-run after tweaking, then deploy the client so the assets go live.
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

CLIENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(CLIENT, "public")

SS = 3  # supersample factor for crisp anti-aliased edges
W, H = 300 * SS, 220 * SS  # displayed at 300x220

# Brand greens (invite / reminder) and a muted red (cancelled).
GREEN = (16, 185, 129)      # #10B981 primary
GREEN_D = (5, 122, 85)      # deep green
GREEN_L = (110, 231, 183)   # #6EE7B7
GREEN_XL = (167, 243, 208)  # #A7F3D0
MINT = (227, 243, 234)      # soft circle fill (invite/reminder)
WHITE = (255, 255, 255)
INK = (15, 61, 40)          # dark green ink for line detail

RED = (239, 68, 68)         # #EF4444
RED_D = (185, 28, 28)
RED_L = (252, 165, 165)
BLUSH = (253, 234, 234)     # soft red circle fill


def _new():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def _confetti(img, palette, seed):
    """Scatter small shapes (dots / diamonds / bars) around the hero circle."""
    d = ImageDraw.Draw(img)
    rnd = random.Random(seed)
    cx, cy = W / 2, H / 2
    ring_r = 78 * SS
    for _ in range(26):
        ang = rnd.uniform(0, 2 * math.pi)
        rad = ring_r + rnd.uniform(4 * SS, 34 * SS)
        x = cx + math.cos(ang) * rad
        y = cy + math.sin(ang) * rad * 0.82
        col = rnd.choice(palette)
        s = rnd.uniform(2.4, 5.6) * SS
        kind = rnd.random()
        if kind < 0.55:                       # dot
            d.ellipse([x - s, y - s, x + s, y + s], fill=col)
        elif kind < 0.8:                      # diamond
            d.polygon([(x, y - s * 1.3), (x + s, y), (x, y + s * 1.3), (x - s, y)], fill=col)
        else:                                 # short bar
            bw, bh = s * 2.6, s * 0.9
            d.rounded_rectangle([x - bw, y - bh, x + bw, y + bh], radius=bh, fill=col)


def _circle(img, fill):
    """Soft filled circle centred behind the hero glyph."""
    d = ImageDraw.Draw(img)
    r = 66 * SS
    cx, cy = W / 2, H / 2
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def _shadow(w, h, radius, cx, cy):
    """Return a soft drop-shadow layer for a rounded rect of size w×h at cx,cy."""
    lay = _new()
    d = ImageDraw.Draw(lay)
    d.rounded_rectangle(
        [cx - w / 2, cy - h / 2 + 6 * SS, cx + w / 2, cy + h / 2 + 6 * SS],
        radius=radius, fill=(6, 60, 40, 70),
    )
    return lay.filter(ImageFilter.GaussianBlur(7 * SS))


def _check_badge(img, cx, cy, r, ring, fill):
    d = ImageDraw.Draw(img)
    d.ellipse([cx - r - ring, cy - r - ring, cx + r + ring, cy + r + ring], fill=WHITE)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
    w = max(3, int(r * 0.28))
    d.line([(cx - r * 0.42, cy + r * 0.02), (cx - r * 0.08, cy + r * 0.36),
            (cx + r * 0.46, cy - r * 0.34)], fill=WHITE, width=w, joint="curve")


def make_invite():
    img = _new()
    _circle(img, MINT)
    _confetti(img, [GREEN, GREEN_L, GREEN_XL, GREEN_D], seed=11)

    cx, cy = W / 2, H / 2
    ew, eh = 108 * SS, 78 * SS
    rad = 12 * SS
    img.alpha_composite(_shadow(ew, eh, rad, cx, cy + 4 * SS))

    d = ImageDraw.Draw(img)
    left, top = cx - ew / 2, cy - eh / 2
    right, bot = cx + ew / 2, cy + eh / 2
    # Envelope body (white, faint green border).
    d.rounded_rectangle([left, top, right, bot], radius=rad, fill=WHITE, outline=GREEN_XL, width=SS)
    # Letter peeking above the top edge (white card + green text lines).
    lw, lh = ew * 0.66, eh * 0.5
    lx0, ly0 = cx - lw / 2, top - lh * 0.55
    d.rounded_rectangle([lx0, ly0, lx0 + lw, ly0 + lh], radius=6 * SS, fill=WHITE, outline=GREEN_XL, width=SS)
    for i, frac in enumerate((0.30, 0.5, 0.7)):
        ly = ly0 + lh * frac
        pad = lw * (0.16 if i < 2 else 0.16)
        d.rounded_rectangle([lx0 + pad, ly - 2 * SS, lx0 + lw - pad - (0 if i < 2 else lw * 0.3), ly + 2 * SS],
                            radius=2 * SS, fill=GREEN_L)
    # Envelope flap (open) — green triangle folding down from the top.
    d.polygon([(left, top), (right, top), (cx, cy + eh * 0.02)], fill=GREEN)
    d.polygon([(left, top), (cx, cy + eh * 0.02), (right, top)], outline=GREEN_D)
    # Bottom fold lines for depth.
    d.line([(left, bot), (cx, cy + eh * 0.06), (right, bot)], fill=GREEN_XL, width=SS)

    _check_badge(img, right - 6 * SS, bot - 4 * SS, 16 * SS, 4 * SS, GREEN)
    _save(img, "email-hero-invite.png")


def make_reminder():
    img = _new()
    _circle(img, MINT)
    _confetti(img, [GREEN, GREEN_L, GREEN_XL, GREEN_D], seed=23)

    cx, cy = W / 2, H / 2 + 3 * SS
    r = 46 * SS
    img.alpha_composite(_shadow(r * 2, r * 2, r, cx, cy + 2 * SS))
    d = ImageDraw.Draw(img)
    # Bells + feet.
    for bx in (-r * 0.62, r * 0.62):
        d.ellipse([cx + bx - 13 * SS, cy - r - 15 * SS, cx + bx + 13 * SS, cy - r + 11 * SS], fill=GREEN_D)
    d.line([(cx - r * 0.9, cy - r * 0.86), (cx - r * 1.18, cy - r * 1.12)], fill=GREEN_D, width=5 * SS)
    d.line([(cx + r * 0.9, cy - r * 0.86), (cx + r * 1.18, cy - r * 1.12)], fill=GREEN_D, width=5 * SS)
    # Clock body.
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN)
    d.ellipse([cx - r + 8 * SS, cy - r + 8 * SS, cx + r - 8 * SS, cy + r - 8 * SS], fill=WHITE)
    # Feet.
    for fx in (-r * 0.55, r * 0.55):
        d.line([(cx + fx, cy + r * 0.86), (cx + fx * 1.5, cy + r * 1.2)], fill=GREEN_D, width=6 * SS)
    # Hands.
    d.line([(cx, cy), (cx, cy - r * 0.5)], fill=GREEN_D, width=5 * SS)
    d.line([(cx, cy), (cx + r * 0.42, cy + r * 0.14)], fill=GREEN_D, width=5 * SS)
    d.ellipse([cx - 4 * SS, cy - 4 * SS, cx + 4 * SS, cy + 4 * SS], fill=GREEN_D)
    _save(img, "email-hero-reminder.png")


def make_cancelled():
    img = _new()
    _circle(img, BLUSH)
    _confetti(img, [RED, RED_L, (254, 202, 202), RED_D], seed=37)

    cx, cy = W / 2, H / 2
    r = 48 * SS
    img.alpha_composite(_shadow(r * 2, r * 2, r, cx, cy + 2 * SS))
    d = ImageDraw.Draw(img)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=RED)
    d.ellipse([cx - r + 9 * SS, cy - r + 9 * SS, cx + r - 9 * SS, cy + r - 9 * SS], fill=WHITE)
    d.ellipse([cx - r + 9 * SS, cy - r + 9 * SS, cx + r - 9 * SS, cy + r - 9 * SS], outline=RED, width=0)
    # Prohibition bar (diagonal) inside the white face.
    bw = 8 * SS
    ang = math.radians(45)
    dx, dy = math.cos(ang) * (r - 16 * SS), math.sin(ang) * (r - 16 * SS)
    d.line([(cx - dx, cy - dy), (cx + dx, cy + dy)], fill=RED, width=bw)
    _save(img, "email-hero-cancelled.png")


def _save(img, name):
    out = img.resize((W // SS, H // SS), Image.LANCZOS)
    path = os.path.join(PUBLIC, name)
    out.save(path, "PNG", optimize=True)
    print("wrote", path, out.size)


make_invite()
make_reminder()
make_cancelled()
print("done")
