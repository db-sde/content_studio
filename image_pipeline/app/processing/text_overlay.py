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

_PANEL_FILL = (13, 20, 38, 235)  # near-opaque navy
_SCRIM_BOTTOM_ALPHA = 205
_WHITE = (255, 255, 255, 255)
_SUBTEXT = (215, 220, 230, 255)
_CHIP_BG = (255, 255, 255, 38)
_CHIP_TEXT = (245, 200, 90, 255)  # warm gold accent, matches the "premium" brief


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
    scrim_top = int(height * 0.55)
    for y in range(scrim_top, height):
        alpha = int(_SCRIM_BOTTOM_ALPHA * (y - scrim_top) / max(1, height - scrim_top))
        draw.line([(0, y), (width, y)], fill=(8, 12, 24, alpha))

    pad_x = int(width * 0.05)
    text_width = width - 2 * pad_x
    cursor_y = height - int(height * 0.32)

    cursor_y = _draw_wrapped_text(
        draw, overlay.headline, _FONT_BOLD, pad_x, cursor_y, text_width,
        start_size=54, min_size=30, fill=_WHITE, max_lines=2,
    )
    if overlay.subheading:
        cursor_y = _draw_wrapped_text(
            draw, overlay.subheading, _FONT_MEDIUM, pad_x, cursor_y + 8, text_width,
            start_size=26, min_size=18, fill=_SUBTEXT, max_lines=1,
        )
    if overlay.chips:
        _draw_chips_row(draw, overlay.chips, pad_x, cursor_y + 14, max_width=text_width)


def _draw_panel_layout(draw: ImageDraw.ImageDraw, size: tuple[int, int], overlay: OverlayText) -> None:
    width, height = size
    panel_w = int(width * 0.40)
    draw.rectangle([(0, 0), (panel_w, height)], fill=_PANEL_FILL)

    pad_x = int(panel_w * 0.12)
    text_width = panel_w - 2 * pad_x
    cursor_y = int(height * 0.30)

    cursor_y = _draw_wrapped_text(
        draw, overlay.headline, _FONT_BOLD, pad_x, cursor_y, text_width,
        start_size=42, min_size=26, fill=_WHITE, max_lines=3,
    )
    if overlay.subheading:
        cursor_y = _draw_wrapped_text(
            draw, overlay.subheading, _FONT_MEDIUM, pad_x, cursor_y + 10, text_width,
            start_size=22, min_size=16, fill=_SUBTEXT, max_lines=2,
        )
    if overlay.chips:
        _draw_chips_stacked(draw, overlay.chips, pad_x, cursor_y + 20, max_width=text_width)


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
    start_size: int, min_size: int, fill: tuple, max_lines: int,
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

    line_height = int(size * 1.3)
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height
    return y


def _draw_chips_row(draw: ImageDraw.ImageDraw, chips: list[str], x: int, y: int, *, max_width: int) -> None:
    font = ImageFont.truetype(str(_FONT_SEMIBOLD), 20)
    pad_x, pad_y, gap = 16, 8, 12
    cursor_x = x
    for chip in chips[:4]:
        bbox = draw.textbbox((0, 0), chip, font=font)
        box_w, box_h = (bbox[2] - bbox[0]) + pad_x * 2, (bbox[3] - bbox[1]) + pad_y * 2
        if cursor_x + box_w > x + max_width:
            break
        draw.rounded_rectangle([(cursor_x, y), (cursor_x + box_w, y + box_h)], radius=box_h // 2, fill=_CHIP_BG)
        draw.text((cursor_x + pad_x, y + pad_y - bbox[1]), chip, font=font, fill=_WHITE)
        cursor_x += box_w + gap


def _draw_chips_stacked(draw: ImageDraw.ImageDraw, chips: list[str], x: int, y: int, *, max_width: int) -> None:
    font = ImageFont.truetype(str(_FONT_SEMIBOLD), 18)
    pad_x, pad_y, gap = 14, 7, 10
    for chip in chips[:3]:
        bbox = draw.textbbox((0, 0), chip, font=font)
        box_w = min((bbox[2] - bbox[0]) + pad_x * 2, max_width)
        box_h = (bbox[3] - bbox[1]) + pad_y * 2
        draw.rounded_rectangle([(x, y), (x + box_w, y + box_h)], radius=box_h // 2, fill=_CHIP_BG)
        draw.text((x + pad_x, y + pad_y - bbox[1]), chip, font=font, fill=_CHIP_TEXT)
        y += box_h + gap
