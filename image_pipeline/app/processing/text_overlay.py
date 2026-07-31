"""Composites real, guaranteed-correctly-spelled text (headline/subheading/chips) onto a
generated image with Pillow, rather than trusting a diffusion model to render legible on-image
typography. FLUX Schnell reliably garbles/misspells rendered text in production ("$harda
University", "MEBA", "NAAAC Accrediited") - a fundamental limitation of fast diffusion models, not
a prompt-wording problem. So the image model now only composes clean photography/background (see
app.schemas.prompt.DEFAULT_NEGATIVE_PROMPT and app.prompts.templates), and every visible word on
the final asset is drawn here from a real font (Poppins, OFL-licensed, bundled in
app/assets/fonts/) - spelling is then just a string, not a pixel guess.

A dark scrim/panel is always drawn behind the text regardless of what the underlying photo looks
like, rather than trusting the model to have actually left a clean/dark zone there - the model's
composition instructions (see templates.py) are a hint to keep its main subject out of that zone,
not a guarantee this code depends on for legibility.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.schemas.prompt import OverlayText

_FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
_FONT_BOLD = _FONTS_DIR / "Poppins-Bold.ttf"
_FONT_SEMIBOLD = _FONTS_DIR / "Poppins-SemiBold.ttf"
_FONT_MEDIUM = _FONTS_DIR / "Poppins-Medium.ttf"

# Page types whose hero uses the left vertical dark-panel layout (mirrors the two-column
# composition asked of the image model for these types - see templates.py); everything else uses
# the bottom horizontal scrim-banner layout.
_PANEL_LAYOUT_PAGE_TYPES = {"specialization", "category"}

_PANEL_TOP = (22, 30, 52, 242)
_PANEL_BOTTOM = (10, 14, 28, 250)
_SCRIM_BOTTOM_ALPHA = 235
_WHITE = (255, 255, 255, 255)
_SUBTEXT = (205, 212, 226, 255)
_ACCENT = (240, 178, 66, 255)  # warm gold accent, matches the "premium" brief
# Chip fill is a near-solid dark navy (not a translucent tint of the photo/panel behind it) so
# contrast never depends on how bright or busy the underlying photograph happens to be.
_CHIP_BG = (9, 13, 26, 200)
_CHIP_BORDER = (240, 178, 66, 200)
_SHADOW = (0, 0, 0, 140)


def compose_overlay(image: Image.Image, overlay: OverlayText | None, *, role: str, page_type: str | None) -> Image.Image:
    if not overlay or not overlay.headline:
        return image

    base = image.convert("RGBA")
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    if page_type in _PANEL_LAYOUT_PAGE_TYPES and role == "hero":
        _draw_panel_layout(draw, base.size, overlay)
    else:
        _draw_banner_layout(draw, base.size, overlay)

    return Image.alpha_composite(base, layer).convert("RGB")


def _draw_banner_layout(draw: ImageDraw.ImageDraw, size: tuple[int, int], overlay: OverlayText) -> None:
    width, height = size
    # Eased (not linear) falloff, front-loaded (exponent < 1) so it's already well into dark by
    # the time it reaches the headline's y-position, not just near the very bottom edge - a
    # gentler, purely linear or back-loaded curve reads as washed-out/low-contrast behind text
    # sitting on a bright photograph.
    scrim_top = int(height * 0.38)
    for y in range(scrim_top, height):
        t = (y - scrim_top) / max(1, height - scrim_top)
        alpha = int(_SCRIM_BOTTOM_ALPHA * (t ** 0.6))
        draw.line([(0, y), (width, y)], fill=(6, 9, 20, alpha))

    pad_x = int(width * 0.055)
    text_width = width - 2 * pad_x
    cursor_y = height - int(height * 0.34)

    draw.rectangle([(pad_x, cursor_y), (pad_x + 56, cursor_y + 5)], fill=_ACCENT)
    cursor_y += 22

    cursor_y = _draw_wrapped_text(
        draw, overlay.headline, _FONT_BOLD, pad_x, cursor_y, text_width,
        start_size=62, min_size=34, fill=_WHITE, max_lines=2, shadow=True,
    )
    if overlay.subheading:
        cursor_y = _draw_wrapped_text(
            draw, overlay.subheading, _FONT_MEDIUM, pad_x, cursor_y + 10, text_width,
            start_size=27, min_size=18, fill=_SUBTEXT, max_lines=1,
        )
    if overlay.chips:
        _draw_chips_row(draw, overlay.chips, pad_x, cursor_y + 18, max_width=text_width)


def _draw_panel_layout(draw: ImageDraw.ImageDraw, size: tuple[int, int], overlay: OverlayText) -> None:
    width, height = size
    panel_w = int(width * 0.40)
    for y in range(height):
        t = y / max(1, height - 1)
        fill = tuple(int(_PANEL_TOP[i] + (_PANEL_BOTTOM[i] - _PANEL_TOP[i]) * t) for i in range(4))
        draw.line([(0, y), (panel_w, y)], fill=fill)
    # A thin accent seam along the panel's right edge, where it meets the photograph.
    draw.rectangle([(panel_w - 3, 0), (panel_w, height)], fill=(*_ACCENT[:3], 200))

    pad_x = int(panel_w * 0.13)
    text_width = panel_w - 2 * pad_x
    cursor_y = int(height * 0.27)

    draw.rectangle([(pad_x, cursor_y), (pad_x + 48, cursor_y + 5)], fill=_ACCENT)
    cursor_y += 26

    cursor_y = _draw_wrapped_text(
        draw, overlay.headline, _FONT_BOLD, pad_x, cursor_y, text_width,
        start_size=46, min_size=28, fill=_WHITE, max_lines=3, shadow=True,
    )
    if overlay.subheading:
        cursor_y = _draw_wrapped_text(
            draw, overlay.subheading, _FONT_MEDIUM, pad_x, cursor_y + 12, text_width,
            start_size=23, min_size=16, fill=_SUBTEXT, max_lines=2,
        )
    if overlay.chips:
        _draw_chips_stacked(draw, overlay.chips, pad_x, cursor_y + 24, max_width=text_width)


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if bbox[2] - bbox[0] <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _truncate_with_ellipsis(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> str:
    if draw.textbbox((0, 0), text, font=font)[2] <= max_width:
        return text
    truncated = text
    while truncated and draw.textbbox((0, 0), truncated + "…", font=font)[2] > max_width:
        truncated = truncated[:-1]
    return truncated.rstrip() + "…"


def _draw_wrapped_text(
    draw: ImageDraw.ImageDraw, text: str, font_path: Path, x: int, y: int, max_width: int, *,
    start_size: int, min_size: int, fill: tuple, max_lines: int, shadow: bool = False,
) -> int:
    size = start_size
    font = ImageFont.truetype(str(font_path), size)
    lines = _wrap_text(draw, text, font, max_width)
    while len(lines) > max_lines and size > min_size:
        size -= 2
        font = ImageFont.truetype(str(font_path), size)
        lines = _wrap_text(draw, text, font, max_width)

    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = _truncate_with_ellipsis(draw, lines[-1], font, max_width)

    line_height = int(size * 1.28)
    for line in lines:
        if shadow:
            draw.text((x + 2, y + 3), line, font=font, fill=_SHADOW)
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height
    return y


def _draw_chips_row(draw: ImageDraw.ImageDraw, chips: list[str], x: int, y: int, *, max_width: int) -> None:
    font = ImageFont.truetype(str(_FONT_SEMIBOLD), 21)
    pad_x, pad_y, gap = 18, 10, 14
    cursor_x = x
    for chip in chips[:4]:
        bbox = draw.textbbox((0, 0), chip, font=font)
        box_w, box_h = (bbox[2] - bbox[0]) + pad_x * 2, (bbox[3] - bbox[1]) + pad_y * 2
        if cursor_x + box_w > x + max_width:
            break
        draw.rounded_rectangle(
            [(cursor_x, y), (cursor_x + box_w, y + box_h)], radius=box_h // 2,
            fill=_CHIP_BG, outline=_CHIP_BORDER, width=1,
        )
        draw.text((cursor_x + pad_x, y + pad_y - bbox[1]), chip, font=font, fill=_ACCENT)
        cursor_x += box_w + gap


def _draw_chips_stacked(draw: ImageDraw.ImageDraw, chips: list[str], x: int, y: int, *, max_width: int) -> None:
    font = ImageFont.truetype(str(_FONT_SEMIBOLD), 19)
    pad_x, pad_y, gap = 16, 9, 12
    for chip in chips[:3]:
        bbox = draw.textbbox((0, 0), chip, font=font)
        box_w = min((bbox[2] - bbox[0]) + pad_x * 2, max_width)
        box_h = (bbox[3] - bbox[1]) + pad_y * 2
        draw.rounded_rectangle(
            [(x, y), (x + box_w, y + box_h)], radius=box_h // 2,
            fill=_CHIP_BG, outline=_CHIP_BORDER, width=1,
        )
        draw.text((x + pad_x, y + pad_y - bbox[1]), chip, font=font, fill=_WHITE)
        y += box_h + gap
