"""Generate the ZoikoSema Open Graph image + favicon set with Pillow.

Source of truth for the logo is client/src/assets/zoikosema-icon.png (1024x1024
RGBA, transparent corners — the rounded app icon with the white+blue "S").

Run from anywhere:  python client/scripts/gen_social_assets.py
Outputs (og-image.png + favicon set) land in client/public/. Re-run after
changing the logo or the card layout, then rebuild the client.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

# client/ root, resolved relative to this file so the script is portable.
CLIENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_SRC = os.path.join(CLIENT, "src/assets/zoikosema-icon.png")
PUBLIC = os.path.join(CLIENT, "public")

FONTS = r"C:/Windows/Fonts"
F_BOLD = os.path.join(FONTS, "segoeuib.ttf")
F_REG = os.path.join(FONTS, "segoeui.ttf")
F_SEMI = os.path.join(FONTS, "seguisb.ttf")  # Segoe UI Semibold

NAVY = (26, 34, 62)         # title — near-black navy
GRAY = (100, 109, 125)      # tagline / subtitle
BLUE = (42, 107, 221)       # brand blue (#2a6bdd)
WHITE = (255, 255, 255)
PILL = (241, 244, 250)      # url chip background
CIRCLE = (231, 238, 252)    # light-blue feature icon disc
DIVIDER = (233, 236, 243)
DOTS = (224, 231, 245)      # decorative dot grid

icon = Image.open(ICON_SRC).convert("RGBA")


def _text_w(draw, text, font):
    b = draw.textbbox((0, 0), text, font=font)
    return b[2] - b[0]


# --- minimal line icons (brand blue), drawn centered on (cx, cy) ------------

def _ic_video(d, cx, cy, c, w=5):
    d.rounded_rectangle([cx - 22, cy - 14, cx + 6, cy + 14], radius=6, outline=c, width=w)
    # lens / prism on the right
    d.line([(cx + 9, cy - 9), (cx + 22, cy - 15), (cx + 22, cy + 15), (cx + 9, cy + 9)],
           fill=c, width=w, joint="curve")


def _ic_monitor(d, cx, cy, c, w=5):
    d.rounded_rectangle([cx - 22, cy - 16, cx + 22, cy + 8], radius=5, outline=c, width=w)
    d.line([cx, cy + 8, cx, cy + 17], fill=c, width=w)
    d.line([cx - 11, cy + 18, cx + 11, cy + 18], fill=c, width=w)


def _ic_chat(d, cx, cy, c, w=5):
    d.rounded_rectangle([cx - 22, cy - 16, cx + 22, cy + 8], radius=10, outline=c, width=w)
    d.polygon([(cx - 14, cy + 5), (cx - 14, cy + 20), (cx - 1, cy + 6)], fill=c)
    for dx in (-9, 0, 9):
        d.ellipse([cx + dx - 2.6, cy - 7, cx + dx + 2.6, cy - 2], fill=c)


def _ic_sparkle(d, cx, cy, c, w=5):
    def star(ox, oy, ro, ri):
        pts = []
        for k in range(8):
            ang = math.radians(90 - k * 45)
            r = ro if k % 2 == 0 else ri
            pts.append((ox + r * math.cos(ang), oy - r * math.sin(ang)))
        d.line(pts + [pts[0]], fill=c, width=w, joint="curve")
    star(cx - 3, cy + 2, 19, 6)
    star(cx + 15, cy - 14, 8, 2.6)


def _globe(d, cx, cy, c, w=3, r=11):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=c, width=w)
    d.ellipse([cx - r * 0.45, cy - r, cx + r * 0.45, cy + r], outline=c, width=max(2, w - 1))
    d.line([cx - r, cy, cx + r, cy], fill=c, width=max(2, w - 1))


# Each feature: (icon drawer, [label lines]).
FEATURES = [
    (_ic_video, ["HD Video & Audio"]),
    (_ic_monitor, ["Screen Share"]),
    (_ic_chat, ["Team Chat"]),
    (_ic_sparkle, ["AI Meeting", "Summaries"]),
]


def make_og():
    # Full-bleed white card — content fills the whole frame, no outer background.
    W, H = 1200, 630
    cy1 = H
    img = Image.new("RGB", (W, H), WHITE)
    draw = ImageDraw.Draw(img)

    # Decorative dot grid, top-right.
    for r in range(4):
        for cc in range(6):
            dx = W - 150 + cc * 22
            dy = 60 + r * 22
            draw.ellipse([dx - 2.5, dy - 2.5, dx + 2.5, dy + 2.5], fill=DOTS)

    # Logo — left.
    isize = 150
    ic = icon.resize((isize, isize), Image.LANCZOS)
    ix, iy = 100, 100
    img.paste(ic, (ix, iy), ic)

    title_font = ImageFont.truetype(F_BOLD, 56)
    tag_font = ImageFont.truetype(F_REG, 26)
    url_font = ImageFont.truetype(F_SEMI, 25)

    tx = ix + isize + 40
    draw.text((tx, 116), "Zoiko Sema Meet", font=title_font, fill=NAVY)
    draw.text((tx + 2, 190), "Secure real-time meetings by Zoiko Sema", font=tag_font, fill=GRAY)

    # URL pill: globe glyph + address on a soft grey chip.
    url = "meet.zoikosema.com"
    uw = _text_w(draw, url, url_font)
    pill_h = 48
    pad_l, gap, pad_r = 22, 14, 24
    globe_d = 22
    pill_w = pad_l + globe_d + gap + uw + pad_r
    py = 236
    px = tx
    draw.rounded_rectangle([px, py, px + pill_w, py + pill_h], radius=pill_h // 2, fill=PILL)
    gcx = px + pad_l + globe_d // 2
    gcy = py + pill_h // 2
    _globe(draw, gcx, gcy, BLUE)
    draw.text((px + pad_l + globe_d + gap, py + (pill_h - 34) // 2), url, font=url_font, fill=BLUE)

    # Divider between header and features.
    draw.line([100, 320, W - 100, 320], fill=DIVIDER, width=2)

    # Feature row — four discs with line icons + centred labels.
    lab_font = ImageFont.truetype(F_SEMI, 22)
    n = len(FEATURES)
    left, right = 100, W - 100
    span = (right - left) / n
    icon_cy = 392
    disc_r = 37
    for i, (drawer, lines) in enumerate(FEATURES):
        cx = int(left + span * (i + 0.5))
        draw.ellipse([cx - disc_r, icon_cy - disc_r, cx + disc_r, icon_cy + disc_r], fill=CIRCLE)
        drawer(draw, cx, icon_cy, BLUE)
        ly = icon_cy + disc_r + 17
        for line in lines:
            lw = _text_w(draw, line, lab_font)
            draw.text((cx - lw // 2, ly), line, font=lab_font, fill=NAVY)
            ly += 29

    # Footer: wordmark left, "Join meeting" CTA right, on a hairline rule.
    fy = 518
    draw.line([100, fy, W - 100, fy], fill=DIVIDER, width=2)
    fcy = (fy + cy1) // 2

    wm_font = ImageFont.truetype(F_BOLD, 30)
    tm_font = ImageFont.truetype(F_SEMI, 16)
    wx = 100
    draw.text((wx, fcy - 19), "Zoiko", font=wm_font, fill=NAVY)
    zw = _text_w(draw, "Zoiko", wm_font)
    draw.text((wx + zw, fcy - 19), "Sema", font=wm_font, fill=BLUE)
    sw = _text_w(draw, "Sema", wm_font)
    draw.text((wx + zw + sw + 3, fcy - 20), "™", font=tm_font, fill=GRAY)

    cta_font = ImageFont.truetype(F_SEMI, 26)
    cta = "Join meeting  →"
    cw = _text_w(draw, cta, cta_font)
    draw.text((right - cw, fcy - 16), cta, font=cta_font, fill=BLUE)

    out = os.path.join(PUBLIC, "og-image.png")
    img.save(out, "PNG", optimize=True)
    print("wrote", out, img.size)


def make_favicons():
    # PNG icons straight from the transparent rounded app icon.
    sizes = {
        "apple-touch-icon.png": 180,
        "icon-192.png": 192,
        "icon-512.png": 512,
        "favicon-32.png": 32,
        "favicon-64.png": 64,
    }
    for name, s in sizes.items():
        im = icon.resize((s, s), Image.LANCZOS)
        if name == "apple-touch-icon.png":
            # Apple touch icons are shown on a tile; flatten onto white so the
            # transparent corners don't render black on some launchers.
            bg = Image.new("RGBA", (s, s), WHITE + (255,))
            bg.paste(im, (0, 0), im)
            im = bg.convert("RGB")
        im.save(os.path.join(PUBLIC, name))
        print("wrote", name, s)

    # Multi-resolution .ico
    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
    icon.save(os.path.join(PUBLIC, "favicon.ico"), sizes=ico_sizes)
    print("wrote favicon.ico", ico_sizes)


make_og()
make_favicons()
print("done")
