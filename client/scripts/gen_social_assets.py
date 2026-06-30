"""Generate the ZoikoSema Open Graph image + favicon set with Pillow.

Source of truth for the logo is client/src/assets/zoikosema-icon.png (1024x1024
RGBA, transparent corners — the rounded app icon with the white+blue "S").

Run from anywhere:  python client/scripts/gen_social_assets.py
Outputs (og-image.png + favicon set) land in client/public/. Re-run after
changing the logo or the card layout, then rebuild the client.
"""
import os
from PIL import Image, ImageDraw, ImageFont

# client/ root, resolved relative to this file so the script is portable.
CLIENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_SRC = os.path.join(CLIENT, "src/assets/zoikosema-icon.png")
PUBLIC = os.path.join(CLIENT, "public")

FONTS = r"C:/Windows/Fonts"
F_BOLD = os.path.join(FONTS, "segoeuib.ttf")
F_REG = os.path.join(FONTS, "segoeui.ttf")
F_SEMI = os.path.join(FONTS, "segoeuib.ttf")  # Segoe has no semibold ttf; bold is fine

NAVY = (27, 37, 82)        # title — dark navy
GRAY = (90, 100, 114)      # tagline
BLUE = (42, 107, 221)      # brand blue (#2a6bdd)
WHITE = (255, 255, 255)
BEIGE = (240, 234, 224)    # warm background, like the marketing card
CARD_BORDER = (228, 221, 210)
FOOTER = (24, 32, 64)      # dark navy footer bar
FOOTER_TXT = (203, 210, 224)

icon = Image.open(ICON_SRC).convert("RGBA")


def _text_w(draw, text, font):
    b = draw.textbbox((0, 0), text, font=font)
    return b[2] - b[0]


# --- minimal line icons (brand blue), drawn centered on (cx, cy) ------------

def _ic_people(d, cx, cy, c, w=5):
    d.ellipse([cx - 20, cy - 18, cx - 4, cy - 2], outline=c, width=w)      # head L
    d.arc([cx - 28, cy - 2, cx + 4, cy + 28], 180, 360, fill=c, width=w)    # body L
    d.ellipse([cx + 4, cy - 16, cx + 18, cy - 2], outline=c, width=w)       # head R
    d.arc([cx - 2, cy - 1, cx + 26, cy + 26], 200, 340, fill=c, width=w)    # body R


def _ic_monitor(d, cx, cy, c, w=5):
    d.rounded_rectangle([cx - 24, cy - 18, cx + 24, cy + 8], radius=5, outline=c, width=w)
    d.line([cx - 9, cy + 8, cx - 13, cy + 20], fill=c, width=w)
    d.line([cx + 9, cy + 8, cx + 13, cy + 20], fill=c, width=w)
    d.line([cx - 16, cy + 20, cx + 16, cy + 20], fill=c, width=w)
    # download arrow inside
    d.line([cx, cy - 12, cx, cy + 1], fill=c, width=w)
    d.line([cx - 7, cy - 6, cx, cy + 2], fill=c, width=w)
    d.line([cx + 7, cy - 6, cx, cy + 2], fill=c, width=w)


def _ic_chat(d, cx, cy, c, w=5):
    d.rounded_rectangle([cx - 24, cy - 18, cx + 24, cy + 8], radius=9, outline=c, width=w)
    d.polygon([(cx - 16, cy + 6), (cx - 16, cy + 20), (cx - 2, cy + 6)], fill=c)
    for dx in (-9, 0, 9):
        d.ellipse([cx + dx - 2, cy - 7, cx + dx + 2, cy - 3], fill=c)


def _ic_calendar(d, cx, cy, c, w=5):
    d.rounded_rectangle([cx - 22, cy - 14, cx + 22, cy + 18], radius=5, outline=c, width=w)
    d.line([cx - 22, cy - 3, cx + 22, cy - 3], fill=c, width=w)
    d.line([cx - 11, cy - 22, cx - 11, cy - 10], fill=c, width=w)
    d.line([cx + 11, cy - 22, cx + 11, cy - 10], fill=c, width=w)
    for ddx in (-11, 0, 11):
        d.ellipse([cx + ddx - 2, cy + 6, cx + ddx + 2, cy + 10], fill=c)


def _ic_shield(d, cx, cy, c, w=5):
    pts = [(cx, cy - 20), (cx + 18, cy - 12), (cx + 18, cy + 3),
           (cx, cy + 21), (cx - 18, cy + 3), (cx - 18, cy - 12), (cx, cy - 20)]
    d.line(pts, fill=c, width=w, joint="curve")
    d.rounded_rectangle([cx - 7, cy - 1, cx + 7, cy + 11], radius=2, outline=c, width=4)
    d.arc([cx - 5, cy - 9, cx + 5, cy + 3], 180, 360, fill=c, width=4)


FEATURES = [
    (_ic_people, "HD Video", "Meetings"),
    (_ic_monitor, "Screen", "Sharing"),
    (_ic_chat, "Team", "Chat"),
    (_ic_calendar, "Schedule", "Meetings"),
    (_ic_shield, "Secure", "by Design"),
]


def make_og():
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BEIGE)
    draw = ImageDraw.Draw(img)

    # White rounded content card on the warm background.
    m = 34
    draw.rounded_rectangle([m, m, W - m, H - m], radius=34, fill=WHITE, outline=CARD_BORDER, width=2)

    # Logo — left.
    isize = 196
    ic = icon.resize((isize, isize), Image.LANCZOS)
    ix, iy = 84, 78
    img.paste(ic, (ix, iy), ic)

    title_font = ImageFont.truetype(F_BOLD, 60)
    tag_font = ImageFont.truetype(F_REG, 28)
    url_font = ImageFont.truetype(F_BOLD, 28)

    tx = ix + isize + 44
    draw.text((tx, 104), "ZoikoSema", font=title_font, fill=NAVY)
    draw.text((tx, 182), "Meetings, Chat, Webinars in one workspace", font=tag_font, fill=GRAY)

    # Website with a small "link" glyph.
    uy = 232
    gx = tx
    draw.rounded_rectangle([gx, uy + 6, gx + 24, uy + 24], radius=9, outline=BLUE, width=6)
    draw.rounded_rectangle([gx + 14, uy + 6, gx + 38, uy + 24], radius=9, outline=BLUE, width=6)
    draw.text((gx + 52, uy), "meet.zoikosema.com", font=url_font, fill=BLUE)

    # Feature row — five evenly spaced columns with divider lines.
    lab_font = ImageFont.truetype(F_BOLD, 21)
    sub_font = ImageFont.truetype(F_REG, 18)
    n = len(FEATURES)
    left, right = 86, W - 86
    span = (right - left) / n
    icon_cy = 360
    for i, (drawer, lab, sub) in enumerate(FEATURES):
        cx = int(left + span * (i + 0.5))
        if i:  # divider before all but the first
            dx = int(left + span * i)
            draw.line([dx, icon_cy - 26, dx, icon_cy + 78], fill=CARD_BORDER, width=2)
        drawer(draw, cx, icon_cy, BLUE)
        lw = _text_w(draw, lab, lab_font)
        draw.text((cx - lw // 2, icon_cy + 34), lab, font=lab_font, fill=NAVY)
        sw = _text_w(draw, sub, sub_font)
        draw.text((cx - sw // 2, icon_cy + 62), sub, font=sub_font, fill=GRAY)

    # Dark footer bar (rounded bottom corners only).
    fy = 506
    draw.rounded_rectangle([m, fy, W - m, H - m], radius=34,
                           corners=(False, False, True, True), fill=FOOTER)
    fcy = (fy + H - m) // 2
    # Wordmark: "Zoiko" white + "Sema" blue.
    wm_font = ImageFont.truetype(F_BOLD, 32)
    wx = 86
    draw.text((wx, fcy - 20), "Zoiko", font=wm_font, fill=WHITE)
    zw = _text_w(draw, "Zoiko", wm_font)
    draw.text((wx + zw, fcy - 20), "Sema", font=wm_font, fill=BLUE)
    # Right-aligned strapline.
    strap_font = ImageFont.truetype(F_REG, 22)
    strap = "AI-Powered  •  Secure  •  Collaboration"
    sw = _text_w(draw, strap, strap_font)
    draw.text((W - 86 - sw, fcy - 14), strap, font=strap_font, fill=FOOTER_TXT)

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
