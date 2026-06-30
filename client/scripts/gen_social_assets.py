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
BLUE = (42, 107, 221)      # brand blue (#2a6bdd) for the website line
WHITE = (255, 255, 255)

icon = Image.open(ICON_SRC).convert("RGBA")


def center_text(draw, cy, text, font, fill, y_is_top=True):
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (1200 - w) // 2 - bbox[0]
    y = cy if y_is_top else cy - h // 2
    draw.text((x, y), text, font=font, fill=fill)
    return w, h


def make_og():
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), WHITE)

    # Centered app icon, generous whitespace above.
    isize = 232
    ic = icon.resize((isize, isize), Image.LANCZOS)
    ix = (W - isize) // 2
    iy = 92
    img.paste(ic, (ix, iy), ic)

    draw = ImageDraw.Draw(img)

    title_font = ImageFont.truetype(F_BOLD, 66)
    tag_font = ImageFont.truetype(F_REG, 31)
    url_font = ImageFont.truetype(F_BOLD, 30)

    # ZoikoSema
    center_text(draw, iy + isize + 28, "ZoikoSema", title_font, NAVY)
    # Tagline
    center_text(draw, iy + isize + 122, "Meetings, Chat, Webinars in one workspace", tag_font, GRAY)

    # Website with a small link glyph drawn to the left.
    url = "meet.zoikosema.com"
    bbox = draw.textbbox((0, 0), url, font=url_font)
    uw = bbox[2] - bbox[0]
    glyph_w = 40
    gap = 14
    total = glyph_w + gap + uw
    start_x = (W - total) // 2
    uy = iy + isize + 188
    # link glyph: two overlapping rounded "chain" capsules
    gy = uy + 8
    lw = 6
    draw.rounded_rectangle([start_x, gy + 4, start_x + 24, gy + 22], radius=9, outline=BLUE, width=lw)
    draw.rounded_rectangle([start_x + 14, gy + 4, start_x + 38, gy + 22], radius=9, outline=BLUE, width=lw)
    draw.text((start_x + glyph_w + gap - bbox[0], uy), url, font=url_font, fill=BLUE)

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
