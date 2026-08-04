#!/usr/bin/env python3
"""Generate the storybook-sticker Trippi social launch asset pack."""

from __future__ import annotations

import json
import math
import random
import shutil
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/marketing/mascot/trippi-troppa-storybook-sticker-sheet.png"
OUT = ROOT / "docs/marketing/social-launch-assets-storybook"
STICKERS = OUT / "stickers"

FONT_HEAD = "/System/Library/Fonts/MarkerFelt.ttc"
FONT_BODY = "/System/Library/Fonts/Avenir Next.ttc"
FONT_SERIF = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
FONT_LABEL = "/System/Library/Fonts/Supplemental/Futura.ttc"

INK = "#6f4b2c"
DEEP = "#4e3321"
PAPER = "#ebe5d9"
CREAM = "#fff7e8"
SAGE = "#a9b887"
SAGE_DARK = "#7f8f65"
PEACH = "#f4ad75"
ORANGE = "#df7d46"
HONEY = "#f3c45c"
BLUE = "#a6b9b4"
ROSE = "#eaa18f"
WHITE = "#fffdf6"


STICKER_BOXES = {
    "suitcase": (42, 104, 420, 414),
    "balloon": (465, 28, 760, 450),
    "map": (862, 102, 1190, 412),
    "plane": (42, 456, 455, 740),
    "backpack": (475, 548, 713, 820),
    "sleeping": (745, 500, 1210, 775),
    "passport": (28, 855, 300, 1190),
    "globe": (350, 850, 690, 1188),
    "wand": (685, 812, 935, 1175),
    "train": (870, 810, 1222, 1206),
}


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.truetype(FONT_BODY, size)


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def fit_font(path: str, text: str, max_width: int, size: int, min_size: int = 26) -> ImageFont.FreeTypeFont:
    probe = Image.new("RGB", (10, 10))
    draw = ImageDraw.Draw(probe)
    while size >= min_size:
        fnt = font(path, size)
        if text_size(draw, text, fnt)[0] <= max_width:
            return fnt
        size -= 2
    return font(path, min_size)


def wrap_lines(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont, max_width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        current = ""
        for word in paragraph.split():
            trial = word if not current else f"{current} {word}"
            if text_size(draw, trial, fnt)[0] <= max_width:
                current = trial
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
    return lines


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    fnt: ImageFont.ImageFont,
    max_width: int,
    fill: str,
    line_gap: int = 10,
    center: bool = False,
) -> int:
    x, y = xy
    for line in wrap_lines(draw, text, fnt, max_width):
        w, h = text_size(draw, line, fnt)
        tx = x - w // 2 if center else x
        draw.text((tx, y), line, font=fnt, fill=fill)
        y += h + line_gap
    return y


def draw_center(draw: ImageDraw.ImageDraw, y: int, text: str, fnt: ImageFont.ImageFont, width: int, fill: str) -> int:
    w, h = text_size(draw, text, fnt)
    draw.text(((width - w) // 2, y), text, font=fnt, fill=fill)
    return y + h


def star_points(cx: float, cy: float, r1: float, r2: float) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for i in range(10):
        angle = -math.pi / 2 + i * math.pi / 5
        radius = r1 if i % 2 == 0 else r2
        pts.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    return pts


def paper_bg(size: tuple[int, int], base: str = PAPER, seed: int = 1) -> Image.Image:
    img = Image.new("RGBA", size, base)
    draw = ImageDraw.Draw(img)
    rng = random.Random(seed + size[0] * 7 + size[1])
    for _ in range(int(size[0] * size[1] / 8500)):
        x = rng.randint(0, size[0] - 1)
        y = rng.randint(0, size[1] - 1)
        alpha = rng.randint(8, 26)
        draw.point((x, y), fill=(95, 72, 45, alpha))
    for _ in range(42):
        x = rng.randint(24, size[0] - 24)
        y = rng.randint(24, size[1] - 24)
        r = rng.randint(8, 20)
        color = rng.choice([HONEY, CREAM, SAGE, "#f7d98b", "#fffaf0"])
        draw.polygon(star_points(x, y, r, max(3, r // 2)), fill=color, outline="#c69b4f")
    for _ in range(52):
        x = rng.randint(20, size[0] - 20)
        y = rng.randint(20, size[1] - 20)
        draw.ellipse((x, y, x + 5, y + 5), fill="#fffaf0")
    return img


def panel(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    fill: str = CREAM,
    outline: str = INK,
    width: int = 4,
    radius: int = 34,
) -> None:
    draw.rounded_rectangle(box, radius, fill=fill, outline=outline, width=width)


def sticker_mask(crop: Image.Image) -> Image.Image:
    rgb = np.asarray(crop.convert("RGB")).astype(np.int16)
    edge = np.concatenate([rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3), rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)])
    bg = np.median(edge, axis=0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    bright = rgb.mean(axis=2)
    bg_bright = bg.mean()
    raw = (dist > 22) | (sat > 28) | (bright > bg_bright + 19)
    raw = Image.fromarray((raw * 255).astype("uint8"), "L")
    raw = raw.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.MinFilter(7))
    arr = np.asarray(raw) > 0
    h, w = arr.shape
    seen = np.zeros_like(arr, dtype=bool)
    best: list[tuple[int, int]] = []
    for sy in range(h):
        for sx in range(w):
            if not arr[sy, sx] or seen[sy, sx]:
                continue
            q: deque[tuple[int, int]] = deque([(sx, sy)])
            seen[sy, sx] = True
            comp: list[tuple[int, int]] = []
            while q:
                x, y = q.popleft()
                comp.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and arr[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((nx, ny))
            if len(comp) > len(best):
                best = comp
    keep = np.zeros_like(arr, dtype=np.uint8)
    for x, y in best:
        keep[y, x] = 255
    alpha = Image.fromarray(keep, "L").filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(1.4))
    return alpha


def extract_stickers() -> dict[str, Path]:
    STICKERS.mkdir(parents=True, exist_ok=True)
    sheet = Image.open(SOURCE).convert("RGBA")
    paths: dict[str, Path] = {}
    for name, box in STICKER_BOXES.items():
        crop = sheet.crop(box)
        alpha = sticker_mask(crop)
        sticker = crop.copy()
        sticker.putalpha(alpha)
        bbox = alpha.getbbox()
        if bbox:
            sticker = sticker.crop(bbox)
        path = STICKERS / f"{name}.png"
        sticker.save(path)
        paths[name] = path
    return paths


def paste_sticker(
    img: Image.Image,
    paths: dict[str, Path],
    name: str,
    center: tuple[int, int],
    max_size: int,
    rotate: float = 0,
    opacity: float = 1,
) -> None:
    sticker = Image.open(paths[name]).convert("RGBA")
    scale = max_size / max(sticker.width, sticker.height)
    sticker = sticker.resize(
        (max(1, int(sticker.width * scale)), max(1, int(sticker.height * scale))),
        Image.Resampling.LANCZOS,
    )
    if rotate:
        sticker = sticker.rotate(rotate, expand=True, resample=Image.Resampling.BICUBIC)
    if opacity < 1:
        a = sticker.getchannel("A").point(lambda v: int(v * opacity))
        sticker.putalpha(a)
    x = int(center[0] - sticker.width / 2)
    y = int(center[1] - sticker.height / 2)
    img.alpha_composite(sticker, (x, y))


def export(img: Image.Image, name: str, items: list[dict[str, object]], title: str, category: str) -> None:
    path = OUT / name
    img.convert("RGB").save(path, quality=95)
    items.append({"id": path.stem, "title": title, "category": category, "src": path.name, "href": path.name, "output": path.name})


def profile(paths: dict[str, Path], items: list[dict[str, object]]) -> None:
    img = paper_bg((1080, 1080), "#e7dfd0", 10)
    draw = ImageDraw.Draw(img)
    draw.ellipse((90, 90, 990, 990), fill=CREAM, outline=INK, width=8)
    draw.ellipse((155, 155, 925, 925), fill="#f4eadb", outline="#d7c3a7", width=4)
    paste_sticker(img, paths, "suitcase", (540, 548), 790, rotate=-1)
    export(img, "profile-avatar.png", items, "Profile avatar", "profile")


def reel_launch(paths: dict[str, Path], items: list[dict[str, object]]) -> None:
    img = paper_bg((1080, 1920), PAPER, 20)
    draw = ImageDraw.Draw(img)
    draw.text((74, 108), "trippi.ai", font=font(FONT_LABEL, 64), fill=DEEP)
    draw_wrapped(draw, (80, 240), "Plan smarter.", font(FONT_HEAD, 164), 900, DEEP, line_gap=8)
    draw_wrapped(draw, (84, 612), "Less confusion. More fun.", font(FONT_BODY, 66), 850, INK, line_gap=8)
    panel(draw, (78, 800, 1002, 1000), CREAM, INK, 5, 48)
    draw_wrapped(draw, (124, 850), "Launching soon at trippi.lol", font(FONT_BODY, 56), 820, DEEP)
    paste_sticker(img, paths, "balloon", (285, 1290), 560, rotate=-6)
    paste_sticker(img, paths, "train", (760, 1390), 600, rotate=3)
    draw.text((84, 1780), "your Trippi, our Troppa.", font=font(FONT_BODY, 48), fill=DEEP)
    export(img, "reel-01-launching-soon.png", items, "Reel cover: Launching soon", "reels")


def reel_group(paths: dict[str, Path], items: list[dict[str, object]]) -> None:
    img = paper_bg((1080, 1920), "#f0e8dc", 30)
    draw = ImageDraw.Draw(img)
    draw_wrapped(draw, (86, 120), "The group chat can rest now.", font(FONT_HEAD, 120), 890, DEEP, line_gap=4)
    bubbles = [
        ((98, 555, 642, 670), "dates?", CREAM),
        ((310, 720, 940, 845), "budget check", "#dfe8d1"),
        ((100, 905, 780, 1040), "no spreadsheet needed", CREAM),
    ]
    for box, text, fill in bubbles:
        panel(draw, box, fill, INK, 4, 34)
        draw.text((box[0] + 38, box[1] + 28), text, font=font(FONT_BODY, 46), fill=DEEP)
    paste_sticker(img, paths, "plane", (310, 1330), 620, rotate=-8)
    paste_sticker(img, paths, "map", (770, 1320), 560, rotate=7)
    panel(draw, (84, 1660, 996, 1812), "#fff4d8", INK, 4, 42)
    draw_center(draw, 1698, "Plan smarter with Trippi.", font(FONT_BODY, 56), 1080, DEEP)
    export(img, "reel-02-group-chat.png", items, "Reel cover: Group chat", "reels")


def reel_comment(paths: dict[str, Path], items: list[dict[str, object]]) -> None:
    img = paper_bg((1080, 1920), "#e8e3d8", 40)
    draw = ImageDraw.Draw(img)
    draw_wrapped(draw, (80, 112), "Comment a city.", font(FONT_HEAD, 148), 900, DEEP, line_gap=0)
    draw_wrapped(draw, (86, 450), "Troppa packs the first trip draft.", font(FONT_BODY, 62), 860, INK)
    for i, city in enumerate(["Tokyo", "Lisbon", "Mexico City"]):
        y = 675 + i * 132
        panel(draw, (108 + i * 36, y, 710 + i * 50, y + 92), CREAM if i != 1 else "#e5ecd3", INK, 4, 34)
        draw.text((148 + i * 36, y + 24), city, font=font(FONT_BODY, 42), fill=DEEP)
    paste_sticker(img, paths, "wand", (735, 1235), 610, rotate=3)
    paste_sticker(img, paths, "globe", (365, 1435), 560, rotate=-4)
    draw.text((88, 1782), "Less confusion. More fun.", font=font(FONT_BODY, 48), fill=DEEP)
    export(img, "reel-03-comment-city.png", items, "Reel cover: Comment a city", "reels")


def reel_trip_energy(paths: dict[str, Path], items: list[dict[str, object]]) -> None:
    img = paper_bg((1080, 1920), "#eee7dc", 50)
    draw = ImageDraw.Draw(img)
    panel(draw, (72, 96, 1008, 1720), CREAM, INK, 6, 58)
    draw.text((122, 160), "trip energy", font=font(FONT_LABEL, 56), fill=SAGE_DARK)
    draw_wrapped(draw, (126, 260), "soft launch, hard itinerary.", font(FONT_HEAD, 112), 820, DEEP, line_gap=6)
    stats = [("cozy planning", 0.82, SAGE), ("group chaos", 0.18, ROSE), ("fun level", 0.94, HONEY)]
    y = 690
    for label, value, color in stats:
        draw.text((130, y), label, font=font(FONT_BODY, 44), fill=DEEP)
        draw.rounded_rectangle((130, y + 64, 880, y + 112), 24, fill="#ead9c4", outline=INK, width=3)
        draw.rounded_rectangle((130, y + 64, int(130 + 750 * value), y + 112), 24, fill=color, outline=INK, width=3)
        y += 185
    paste_sticker(img, paths, "sleeping", (690, 1370), 640, rotate=2)
    draw.text((122, 1600), "trippi.lol", font=font(FONT_BODY, 48), fill=DEEP)
    export(img, "reel-04-trip-energy.png", items, "Reel cover: Trip energy", "reels")


def ig_squares(paths: dict[str, Path], items: list[dict[str, object]]) -> None:
    specs = [
        ("ig-01-your-trippi.png", "your Trippi,\nour Troppa.", "map", "balloon", "#e9e1d4"),
        ("ig-02-plan-smarter.png", "Plan smarter.\nPack happier.", "suitcase", "passport", "#efe7d9"),
        ("ig-03-launch-soon.png", "Launching soon\nat trippi.lol", "train", "wand", "#e8e0d2"),
    ]
    for filename, headline, main, side, base in specs:
        img = paper_bg((1080, 1080), base, len(filename))
        draw = ImageDraw.Draw(img)
        draw_wrapped(draw, (78, 84), headline, font(FONT_HEAD, 96), 780, DEEP, line_gap=2)
        paste_sticker(img, paths, main, (590, 640), 650, rotate=-3)
        paste_sticker(img, paths, side, (205, 820), 300, rotate=8, opacity=0.95)
        draw.text((78, 970), "trippi.ai", font=font(FONT_BODY, 38), fill=SAGE_DARK)
        export(img, filename, items, f"IG square: {headline.splitlines()[0]}", "instagram")


def stories(paths: dict[str, Path], items: list[dict[str, object]]) -> None:
    specs = [
        ("story-01-countdown.png", "soft launching soon", "Join the first travelers.", "balloon", "train"),
        ("story-02-question.png", "Where should Troppa go?", "Reply with a city.", "wand", "globe"),
    ]
    for filename, headline, sub, main, side in specs:
        img = paper_bg((1080, 1920), "#eee6da", len(filename) + 100)
        draw = ImageDraw.Draw(img)
        draw_wrapped(draw, (84, 140), headline, font(FONT_HEAD, 128), 880, DEEP, line_gap=4)
        draw_wrapped(draw, (90, 482), sub, font(FONT_BODY, 64), 830, INK)
        panel(draw, (90, 710, 990, 880), CREAM, INK, 4, 44)
        draw_center(draw, 758, "trippi.lol", font(FONT_BODY, 58), 1080, DEEP)
        paste_sticker(img, paths, main, (560, 1240), 720, rotate=-3)
        paste_sticker(img, paths, side, (815, 1610), 360, rotate=7)
        export(img, filename, items, f"Story: {headline}", "stories")


def carousel(paths: dict[str, Path], items: list[dict[str, object]]) -> None:
    slides = [
        ("carousel-01.png", "Trip planning should feel lighter.", "suitcase"),
        ("carousel-02.png", "Drop the city, dates, budget, and vibe.", "map"),
        ("carousel-03.png", "Trippi turns it into a first draft.", "globe"),
        ("carousel-04.png", "your Trippi, our Troppa.", "train"),
    ]
    for idx, (filename, headline, sticker) in enumerate(slides, start=1):
        img = paper_bg((1080, 1350), "#eee7dc", 200 + idx)
        draw = ImageDraw.Draw(img)
        draw.text((74, 56), f"0{idx}", font=font(FONT_LABEL, 42), fill=SAGE_DARK)
        draw.line((74, 120, 1006, 120), fill="#d0bea5", width=4)
        draw_wrapped(draw, (78, 205), headline, font(FONT_HEAD, 90), 900, DEEP, line_gap=4)
        paste_sticker(img, paths, sticker, (595, 865), 660, rotate=(-3 + idx * 2))
        draw.text((78, 1232), "trippi.lol", font=font(FONT_BODY, 42), fill=DEEP)
        export(img, filename, items, f"Carousel {idx}: {headline[:28]}", "carousel")


def banner(paths: dict[str, Path], items: list[dict[str, object]]) -> None:
    img = paper_bg((1500, 500), "#ece4d8", 333)
    draw = ImageDraw.Draw(img)
    draw.text((70, 66), "trippi.ai", font=font(FONT_LABEL, 58), fill=SAGE_DARK)
    draw_wrapped(draw, (72, 154), "your Trippi, our Troppa.", font(FONT_HEAD, 76), 760, DEEP)
    draw.text((78, 360), "Plan smarter. Less confusion. More fun.", font=font(FONT_BODY, 36), fill=INK)
    paste_sticker(img, paths, "plane", (1040, 262), 430, rotate=-4)
    paste_sticker(img, paths, "balloon", (1310, 220), 330, rotate=5)
    export(img, "social-banner.png", items, "Social banner", "banner")


def gif_loop(paths: dict[str, Path]) -> None:
    frames = []
    stickers = ["suitcase", "balloon", "map", "train"]
    for i in range(20):
        img = paper_bg((1080, 1920), "#eee6da", 500 + i)
        draw = ImageDraw.Draw(img)
        draw_wrapped(draw, (88, 130), "Plan smarter.", font(FONT_HEAD, 138), 850, DEEP)
        draw.text((92, 430), "trippi.ai, your Trippi, our Troppa.", font=font(FONT_BODY, 48), fill=INK)
        main = stickers[(i // 5) % len(stickers)]
        offset = int(math.sin(i / 20 * math.tau) * 40)
        paste_sticker(img, paths, main, (540, 1120 + offset), 760, rotate=math.sin(i / 20 * math.tau) * 5)
        frames.append(img.convert("P", palette=Image.Palette.ADAPTIVE))
    frames[0].save(OUT / "trippi-storybook-launch-loop.gif", save_all=True, append_images=frames[1:], duration=120, loop=0, optimize=True)


def write_docs(items: list[dict[str, object]]) -> None:
    captions = """# Trippi Storybook Social Launch Captions

## Bio
trippi.ai, your Trippi, our Troppa.
Plan smarter.
Less confusion. More fun.

Link: https://www.trippi.lol/?utm_source=social&utm_medium=bio&utm_campaign=prelaunch

## Pinned Post 1
trippi.ai, your Trippi, our Troppa.

Plan smarter. Less confusion. More fun.

Launching soon at trippi.lol.

#aitravel #tripplanner #travelplanning #grouptrip #startup

## Pinned Post 2
The group chat can rest now.

Trippi turns city, dates, budget, and vibe into a first trip draft.

#grouptrip #travelapp #aitravel #tripplanning

## Pinned Post 3
Comment a city and Troppa will pack the first draft.

Soft launch soon. trippi.lol

#travelideas #citybreak #aitravel #tripplanner

## Profile Names
Instagram/TikTok display name: Trippi | AI Trip Planner
Preferred handle: trippi.lol
Fallback handles: trippi_ai, trytrippi, trippiai
"""
    (OUT / "captions.md").write_text(captions, encoding="utf-8")
    style = """# Trippi Storybook Social Style

Use this pack instead of the older bright campaign assets.

Creative direction:
- Storybook sticker pack, not loud tech launch.
- Warm gray paper, cream cards, sage travel props, honey stars.
- Trippi Troppa should feel collectible, sleepy, kind, and a little odd.
- Hooks stay short and friendly.

Core lines:
- trippi.ai, your Trippi, our Troppa.
- Plan smarter.
- Less confusion. More fun.
"""
    (OUT / "style-system.md").write_text(style, encoding="utf-8")
    (OUT / "manifest.json").write_text(json.dumps({"campaign": "Trippi storybook social launch", "source": str(SOURCE), "items": items}, indent=2) + "\n", encoding="utf-8")
    review = [{**item, "index": i} for i, item in enumerate(items, 1) if str(item["src"]).endswith(".png")]
    (OUT / "review-manifest.json").write_text(json.dumps(review, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    shutil.copyfile(SOURCE, OUT / "source-storybook-sticker-sheet.png")
    paths = extract_stickers()
    items: list[dict[str, object]] = []
    profile(paths, items)
    reel_launch(paths, items)
    reel_group(paths, items)
    reel_comment(paths, items)
    reel_trip_energy(paths, items)
    ig_squares(paths, items)
    stories(paths, items)
    carousel(paths, items)
    banner(paths, items)
    gif_loop(paths)
    items.append({"id": "trippi-storybook-launch-loop", "title": "Animated launch loop", "category": "animation", "src": "trippi-storybook-launch-loop.gif", "href": "trippi-storybook-launch-loop.gif", "output": "trippi-storybook-launch-loop.gif"})
    write_docs(items)


if __name__ == "__main__":
    main()
