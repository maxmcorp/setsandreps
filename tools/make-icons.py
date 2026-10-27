"""Draws the app icon: a barbell seen from the side, chalk bar and collars with a red and a
blue plate on each end. Writes icons/icon-180.png, icon-192.png and icon-512.png, and
icon-maskable-512.png with the barbell shrunk to fit inside the circle Android crops icons
to (the inner 80%)."""

from pathlib import Path

from PIL import Image, ImageDraw

FLOOR = (35, 36, 39)
CHALK = (239, 238, 232)
RED = (200, 34, 42)
BLUE = (31, 95, 191)
SCALE = 4  # drawn large, then scaled down for smooth edges


def icon(size, fit=1.0):
    s = size * SCALE
    image = Image.new('RGB', (s, s), FLOOR)
    draw = ImageDraw.Draw(image)
    c = s / 2
    u = s * 0.4 * fit  # half the barbell's length

    def box(x0, x1, half_height, colour, radius):
        """A rounded box from x0 to x1 (as fractions of u from the centre), half_height of u tall."""
        h = half_height * u
        for sign in (1, -1):
            a, b = sorted((c + sign * x0 * u, c + sign * x1 * u))
            draw.rounded_rectangle([a, c - h, b, c + h], radius=radius * u, fill=colour)

    bar = 0.035 * u
    draw.rounded_rectangle([c - u, c - bar, c + u, c + bar], radius=0.02 * u, fill=CHALK)
    box(0.40, 0.56, 0.58, RED, 0.05)  # the big plates
    box(0.58, 0.70, 0.42, BLUE, 0.05)  # the smaller plates
    box(0.72, 0.78, 0.12, CHALK, 0.02)  # the collars
    return image.resize((size, size), Image.LANCZOS)


out = Path(__file__).resolve().parent.parent / 'icons'
out.mkdir(exist_ok=True)
for size in (180, 192, 512):
    icon(size).save(out / f'icon-{size}.png', optimize=True)
    print(f'icons/icon-{size}.png')
icon(512, fit=0.8).save(out / 'icon-maskable-512.png', optimize=True)
print('icons/icon-maskable-512.png')
