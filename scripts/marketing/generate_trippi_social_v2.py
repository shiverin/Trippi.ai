#!/usr/bin/env python3
"""Generate the Trippi Troppa social launch v2 asset pack."""

from __future__ import annotations

import json
import math
import random
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
MASCOT = ROOT / "docs/marketing/mascot/trippi-troppa-simple-transparent.png"
OUT = ROOT / "docs/marketing/social-launch-assets-v2"
REVIEW_RENDERER = (
    Path.home()
    / ".codex/plugins/cache/openai-curated-remote/creative-production/0.1.23/scripts/review_renderer.py"
)

FONT_DISPLAY = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
FONT_BODY = "/System/Library/Fonts/Avenir Next.ttc"
FONT_CONDENSED = "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf"
FONT_MONO = "/System/Library/Fonts/SFNSMono.ttf"

INK = "#15130f"
CREAM = "#fff3df"
LIME = "#d7ff3f"
BLUE = "#2f58ff"
CORAL = "#ff6b4a"
TEAL = "#00b8a8"
PINK = "#ff4fd8"
YELLOW = "#ffd84a"
WHITE = "#fffaf0"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def text_size(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.ImageFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=fnt, stroke_width=0)
    return box[2] - box[0], box[3] - box[1]


def fit_font(path: str, text: str, max_width: int, size: int, min_size: int = 24) -> ImageFont.FreeTypeFont:
    probe = Image.new("RGB", (10, 10))
    draw = ImageDraw.Draw(probe)
    while size >= min_size:
        fnt = font(path, size)
        if text_size(draw, text, fnt)[0] <= max_width:
            return fnt
        size -= 2
    return font(path, min_size)


def wrap_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    fnt: ImageFont.ImageFont,
    max_width: int,
) -> list[str]:
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
    line_gap: int = 8,
    anchor: str = "la",
    stroke_width: int = 0,
    stroke_fill: str | None = None,
) -> int:
    lines = wrap_lines(draw, text, fnt, max_width)
    x, y = xy
    for line in lines:
        w, h = text_size(draw, line, fnt)
        if anchor == "ma":
            tx = x - w // 2
        elif anchor == "ra":
            tx = x - w
        else:
            tx = x
        draw.text(
            (tx, y),
            line,
            font=fnt,
            fill=fill,
            stroke_width=stroke_width,
            stroke_fill=stroke_fill,
        )
        y += h + line_gap
    return y


def draw_center(
    draw: ImageDraw.ImageDraw,
    y: int,
    text: str,
    fnt: ImageFont.ImageFont,
    width: int,
    fill: str,
    stroke_width: int = 0,
    stroke_fill: str | None = None,
) -> int:
    w, h = text_size(draw, text, fnt)
    draw.text(
        ((width - w) // 2, y),
        text,
        font=fnt,
        fill=fill,
        stroke_width=stroke_width,
        stroke_fill=stroke_fill,
    )
    return y + h


def rounded_panel(
    img: Image.Image,
    box: tuple[int, int, int, int],
    fill: str,
    outline: str = INK,
    width: int = 6,
    radius: int = 36,
    shadow: bool = True,
) -> None:
    draw = ImageDraw.Draw(img)
    if shadow:
        sx = Image.new("RGBA", img.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(sx)
        sd.rounded_rectangle((box[0] + 14, box[1] + 16, box[2] + 14, box[3] + 16), radius, fill=(0, 0, 0, 55))
        sx = sx.filter(ImageFilter.GaussianBlur(10))
        img.alpha_composite(sx)
    draw.rounded_rectangle(box, radius, fill=fill, outline=outline, width=width)


def bg(size: tuple[int, int], color: str) -> Image.Image:
    img = Image.new("RGBA", size, color)
    draw = ImageDraw.Draw(img)
    rng = random.Random(42 + size[0] + size[1])
    for _ in range(180):
        x = rng.randint(0, size[0])
        y = rng.randint(0, size[1])
        alpha = rng.randint(10, 28)
        draw.point((x, y), fill=(0, 0, 0, alpha))
    return img


def paste_mascot(
    img: Image.Image,
    center: tuple[int, int],
    max_size: int,
    rotate: float = 0,
    shadow: bool = True,
) -> tuple[int, int, int, int]:
    mascot = Image.open(MASCOT).convert("RGBA")
    bbox = mascot.getchannel("A").getbbox()
    mascot = mascot.crop(bbox)
    mascot.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    if rotate:
        mascot = mascot.rotate(rotate, expand=True, resample=Image.Resampling.BICUBIC)
    x = int(center[0] - mascot.width / 2)
    y = int(center[1] - mascot.height / 2)
    if shadow:
        alpha = mascot.getchannel("A")
        shadow_img = Image.new("RGBA", mascot.size, (20, 18, 12, 120))
        shadow_img.putalpha(alpha.filter(ImageFilter.GaussianBlur(12)))
        img.alpha_composite(shadow_img, (x + 18, y + 24))
    img.alpha_composite(mascot, (x, y))
    return (x, y, x + mascot.width, y + mascot.height)


def pill(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, fill: str, ink: str = INK) -> None:
    draw.rounded_rectangle(box, (box[3] - box[1]) // 2, fill=fill, outline=ink, width=5)
    fnt = font(FONT_BODY, 36)
    w, h = text_size(draw, text, fnt)
    draw.text((box[0] + (box[2] - box[0] - w) // 2, box[1] + (box[3] - box[1] - h) // 2 - 2), text, font=fnt, fill=ink)


def diagonal_stripes(draw: ImageDraw.ImageDraw, size: tuple[int, int], color: str, step: int = 72, width: int = 14) -> None:
    w, h = size
    for x in range(-h, w + h, step):
        draw.line((x, h, x + h, 0), fill=color, width=width)


def export(img: Image.Image, name: str, items: list[dict[str, object]], title: str, category: str) -> None:
    path = OUT / name
    img.convert("RGB").save(path, quality=95)
    items.append(
        {
            "id": path.stem,
            "title": title,
            "category": category,
            "src": path.name,
            "href": path.name,
            "output": path.name,
        }
    )


def profile_avatar(items: list[dict[str, object]]) -> None:
    img = bg((1080, 1080), BLUE)
    draw = ImageDraw.Draw(img)
    draw.ellipse((-210, 645, 540, 1385), fill=LIME, outline=INK, width=8)
    draw.ellipse((650, -155, 1260, 455), fill=PINK, outline=INK, width=8)
    draw.ellipse((116, 116, 964, 964), fill=CREAM, outline=WHITE, width=20)
    draw.ellipse((178, 178, 902, 902), outline=INK, width=10)
    paste_mascot(img, (540, 560), 760, rotate=-2)
    export(img, "profile-avatar.png", items, "Profile avatar", "profile")


def reel_plan_smarter(items: list[dict[str, object]]) -> None:
    img = bg((1080, 1920), INK)
    draw = ImageDraw.Draw(img)
    diagonal_stripes(draw, img.size, "#26231d", 92, 18)
    draw.rectangle((0, 0, 1080, 132), fill=LIME)
    pill(draw, (58, 46, 384, 116), "LAUNCHING SOON", LIME)
    draw.text((780, 52), "trippi.lol", font=font(FONT_BODY, 42), fill=INK)
    y = 250
    for word, color in [("PLAN", CREAM), ("SMARTER.", LIME)]:
        fnt = fit_font(FONT_DISPLAY, word, 940, 230)
        y = draw_center(draw, y, word, fnt, 1080, color, stroke_width=2, stroke_fill=INK)
        y += 18
    draw_wrapped(draw, (540, 790), "Less confusion. More fun.", font(FONT_BODY, 64), 850, WHITE, anchor="ma")
    draw.arc((90, 1010, 990, 1700), 198, 335, fill=CORAL, width=22)
    paste_mascot(img, (540, 1380), 730, rotate=2)
    draw.text((66, 1770), "trippi.ai, your Trippi, our Troppa.", font=font(FONT_BODY, 41), fill=CREAM)
    export(img, "reel-01-plan-smarter.png", items, "Reel cover: Plan smarter", "reels")


def reel_group_chat(items: list[dict[str, object]]) -> None:
    img = bg((1080, 1920), CREAM)
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, 1080, 190), fill=BLUE)
    draw.text((62, 54), "GROUP CHAT", font=font(FONT_DISPLAY, 72), fill=WHITE)
    draw.text((62, 126), "CHAOS", font=font(FONT_DISPLAY, 72), fill=LIME, stroke_width=2, stroke_fill=INK)
    bubbles = [
        ((88, 290, 620, 410), "dates??", WHITE),
        ((270, 455, 968, 590), "wait who booked the hotel", LIME),
        ((82, 640, 730, 775), "i made a spreadsheet", WHITE),
        ((396, 822, 972, 955), "pls no spreadsheet", YELLOW),
        ((80, 1025, 648, 1160), "Trippi can plan it.", PINK),
    ]
    for box, text, fill in bubbles:
        rounded_panel(img, box, fill, radius=48, width=5, shadow=True)
        fnt = fit_font(FONT_BODY, text, box[2] - box[0] - 70, 50, 32)
        draw.text((box[0] + 34, box[1] + 34), text, font=fnt, fill=INK)
    paste_mascot(img, (690, 1450), 690, rotate=-7)
    draw.text((64, 1716), "LESS CONFUSION.", font=font(FONT_DISPLAY, 72), fill=INK)
    draw.text((64, 1792), "MORE FUN.", font=font(FONT_DISPLAY, 72), fill=CORAL, stroke_width=2, stroke_fill=INK)
    export(img, "reel-02-group-chat-chaos.png", items, "Reel cover: Group chat chaos", "reels")


def reel_comment_city(items: list[dict[str, object]]) -> None:
    img = bg((1080, 1920), BLUE)
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, 1080, 1920), outline=INK, width=22)
    draw.ellipse((720, -120, 1330, 490), fill=LIME, outline=INK, width=8)
    draw.ellipse((-250, 1170, 690, 2170), fill=CORAL, outline=INK, width=8)
    draw.text((66, 96), "COMMENT", font=font(FONT_DISPLAY, 116), fill=CREAM, stroke_width=4, stroke_fill=INK)
    draw.text((66, 226), "A CITY.", font=font(FONT_DISPLAY, 158), fill=LIME, stroke_width=5, stroke_fill=INK)
    rounded_panel(img, (78, 488, 1002, 762), CREAM, radius=58, width=7)
    draw_wrapped(draw, (130, 548), "Trippi Troppa builds the first trip draft.", font(FONT_BODY, 62), 800, INK, line_gap=10)
    for i, city in enumerate(["Tokyo", "Lisbon", "Mexico City"]):
        y = 870 + i * 124
        x = 104 + i * 48
        rounded_panel(img, (x, y, x + 610, y + 86), WHITE if i != 1 else LIME, radius=43, width=4, shadow=True)
        draw.text((x + 38, y + 20), f"@you  {city}", font=font(FONT_BODY, 38), fill=INK)
    paste_mascot(img, (740, 1470), 610, rotate=7)
    draw.text((66, 1762), "PLAN SMARTER.", font=font(FONT_DISPLAY, 78), fill=CREAM, stroke_width=3, stroke_fill=INK)
    export(img, "reel-03-comment-city.png", items, "Reel cover: Comment a city", "reels")


def reel_trip_energy(items: list[dict[str, object]]) -> None:
    img = bg((1080, 1920), CREAM)
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, 1080, 420), fill=INK)
    draw.rectangle((0, 420, 1080, 780), fill=PINK)
    draw.rectangle((0, 780, 1080, 1160), fill=LIME)
    draw.rectangle((0, 1160, 1080, 1540), fill=CORAL)
    draw.rectangle((54, 74, 1026, 1846), outline=INK, width=12)
    draw.text((84, 104), "YOUR TRIP", font=font(FONT_DISPLAY, 82), fill=CREAM)
    draw.text((84, 190), "ENERGY", font=font(FONT_DISPLAY, 150), fill=LIME, stroke_width=4, stroke_fill=INK)
    stats = [("74%", "VIBES", CREAM, 362), ("18%", "CHAOS", CORAL, 210), ("8%", "SPREADSHEET", WHITE, 98)]
    y = 510
    for pct, label, color, bar in stats:
        draw.text((100, y), pct, font=font(FONT_DISPLAY, 82), fill=INK)
        draw.text((300, y + 20), label, font=font(FONT_BODY, 45), fill=INK)
        draw.rounded_rectangle((100, y + 100, 100 + bar * 2, y + 152), 26, fill=color, outline=INK, width=5)
        y += 230
    rounded_panel(img, (92, 1248, 718, 1518), WHITE, radius=44, width=6)
    draw_wrapped(draw, (130, 1302), "Share when the group finally agrees on dates.", font(FONT_BODY, 48), 540, INK)
    paste_mascot(img, (790, 1422), 460, rotate=-3)
    draw.text((86, 1686), "trippi.ai", font=font(FONT_DISPLAY, 84), fill=INK)
    draw.text((86, 1772), "your Trippi, our Troppa.", font=font(FONT_BODY, 48), fill=INK)
    export(img, "reel-04-trip-energy.png", items, "Reel cover: Trip energy", "reels")


def ig_your_trippi(items: list[dict[str, object]]) -> None:
    img = bg((1080, 1080), CREAM)
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, 1080, 170), fill=INK)
    draw.text((62, 42), "TRIPPI.AI", font=font(FONT_DISPLAY, 80), fill=LIME)
    paste_mascot(img, (540, 540), 600, rotate=0)
    draw.text((78, 825), "your Trippi,", font=font(FONT_DISPLAY, 76), fill=INK)
    draw.text((78, 910), "our Troppa.", font=font(FONT_DISPLAY, 86), fill=CORAL, stroke_width=2, stroke_fill=INK)
    export(img, "ig-01-your-trippi.png", items, "IG square: Your Trippi", "instagram")


def ig_less_confusion(items: list[dict[str, object]]) -> None:
    img = bg((1080, 1080), WHITE)
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, 540, 1080), fill=CREAM)
    draw.rectangle((540, 0, 1080, 1080), fill=LIME)
    draw.text((56, 70), "BEFORE", font=font(FONT_CONDENSED, 74), fill=INK)
    draw.text((596, 70), "AFTER", font=font(FONT_CONDENSED, 74), fill=INK)
    for i, txt in enumerate(["13 tabs", "3 opinions", "no plan"]):
        rounded_panel(img, (66, 188 + i * 144, 474, 292 + i * 144), WHITE, radius=34, width=4)
        draw.text((104, 218 + i * 144), txt, font=font(FONT_BODY, 42), fill=INK)
    rounded_panel(img, (590, 195, 1014, 620), WHITE, radius=52, width=5)
    draw_wrapped(draw, (636, 250), "one smart trip draft", font(FONT_BODY, 62), 350, INK)
    paste_mascot(img, (785, 800), 360, rotate=-5)
    draw.text((78, 870), "LESS CONFUSION", font=font(FONT_DISPLAY, 64), fill=INK)
    draw.text((78, 950), "MORE FUN", font=font(FONT_DISPLAY, 74), fill=CORAL, stroke_width=2, stroke_fill=INK)
    export(img, "ig-02-less-confusion.png", items, "IG square: Less confusion", "instagram")


def ig_waitlist(items: list[dict[str, object]]) -> None:
    img = bg((1080, 1080), BLUE)
    draw = ImageDraw.Draw(img)
    draw.ellipse((700, -200, 1260, 360), fill=PINK, outline=INK, width=7)
    draw.ellipse((-180, 700, 380, 1260), fill=LIME, outline=INK, width=7)
    rounded_panel(img, (82, 112, 998, 768), CREAM, radius=64, width=8)
    draw_wrapped(draw, (130, 190), "Trippi is warming up.", font(FONT_DISPLAY, 92), 760, INK, line_gap=14)
    draw_wrapped(draw, (132, 458), "AI trip planning with less confusion and more fun.", font(FONT_BODY, 46), 760, INK, line_gap=12)
    paste_mascot(img, (772, 760), 390, rotate=6)
    pill(draw, (118, 840, 602, 930), "LAUNCHING SOON", LIME)
    draw.text((124, 956), "trippi.lol", font=font(FONT_BODY, 48), fill=WHITE)
    export(img, "ig-03-waitlist.png", items, "IG square: Waitlist", "instagram")


def feed_plan(items: list[dict[str, object]]) -> None:
    img = bg((1080, 1350), CREAM)
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, 1080, 192), fill=INK)
    draw.text((60, 50), "PLAN SMARTER.", font=font(FONT_DISPLAY, 88), fill=LIME)
    rounded_panel(img, (72, 286, 1008, 810), WHITE, radius=58, width=7)
    draw_wrapped(draw, (132, 356), "Turn travel chaos into an actual plan.", font(FONT_DISPLAY, 76), 780, INK, line_gap=12)
    paste_mascot(img, (690, 990), 500, rotate=-4)
    draw.text((72, 1118), "Trippi.ai, your Trippi, our Troppa.", font=font(FONT_BODY, 45), fill=INK)
    draw.text((72, 1190), "trippi.lol", font=font(FONT_DISPLAY, 72), fill=CORAL, stroke_width=2, stroke_fill=INK)
    export(img, "feed-01-plan-smarter.png", items, "Feed portrait: Plan smarter", "feed")


def carousel(items: list[dict[str, object]]) -> None:
    slides = [
        ("carousel-01-chaos.png", CREAM, "Planning a trip should not feel like a group project.", "01", None),
        ("carousel-02-drop-details.png", BLUE, "Drop the city, dates, budget, and vibe.", "02", LIME),
        ("carousel-03-draft.png", LIME, "Trippi turns the chaos into a first draft.", "03", CORAL),
        ("carousel-04-troppa.png", INK, "your Trippi, our Troppa.", "04", CREAM),
    ]
    for filename, color, headline, number, accent in slides:
        img = bg((1080, 1350), color)
        draw = ImageDraw.Draw(img)
        if color == INK:
            ink = CREAM
            secondary = LIME
        else:
            ink = INK
            secondary = accent or CORAL
        draw.text((62, 56), number, font=font(FONT_MONO, 52), fill=secondary)
        draw.line((62, 130, 1018, 130), fill=ink, width=5)
        draw_wrapped(draw, (68, 210), headline, font(FONT_DISPLAY, 86), 930, ink, line_gap=12)
        if filename.endswith("chaos.png"):
            for i, txt in enumerate(["budget?", "where stay?", "who is driving?"]):
                rounded_panel(img, (112 + i * 36, 740 + i * 112, 700 + i * 62, 830 + i * 112), WHITE, radius=36, width=4)
                draw.text((150 + i * 36, 762 + i * 112), txt, font=font(FONT_BODY, 40), fill=INK)
        elif filename.endswith("drop-details.png"):
            for i, txt in enumerate(["city", "dates", "vibe", "budget"]):
                pill(draw, (110, 720 + i * 100, 480 + i * 60, 790 + i * 100), txt, CREAM if i % 2 else LIME)
        elif filename.endswith("draft.png"):
            rounded_panel(img, (110, 700, 970, 990), WHITE, radius=42, width=5)
            draw.text((152, 750), "Day 1", font=font(FONT_DISPLAY, 58), fill=INK)
            draw.text((152, 830), "coffee -> market -> sunset", font=font(FONT_BODY, 44), fill=INK)
            draw.text((152, 900), "no spreadsheet needed", font=font(FONT_BODY, 44), fill=CORAL)
        elif filename.endswith("troppa.png"):
            draw.text((66, 720), "TRIPPI", font=font(FONT_DISPLAY, 116), fill=LIME)
            draw.text((66, 838), "TROPPA", font=font(FONT_DISPLAY, 116), fill=CORAL, stroke_width=3, stroke_fill=INK)
        paste_mascot(img, (795, 1060), 350 if color != INK else 420, rotate=5)
        export(img, filename, items, f"Carousel: {headline[:34]}", "carousel")


def build_gif() -> None:
    frames: list[Image.Image] = []
    base_colors = [INK, BLUE, CORAL, LIME, CREAM]
    captions = ["PLAN", "SMARTER", "LESS CONFUSION", "MORE FUN", "TRIPPI"]
    for i in range(18):
        img = bg((1080, 1920), base_colors[(i // 4) % len(base_colors)])
        draw = ImageDraw.Draw(img)
        text = captions[(i // 4) % len(captions)]
        ink = CREAM if base_colors[(i // 4) % len(base_colors)] == INK else INK
        fnt = fit_font(FONT_DISPLAY, text, 940, 160)
        draw_center(draw, 210, text, fnt, 1080, ink, stroke_width=3, stroke_fill=INK if ink != INK else CREAM)
        offset = int(math.sin(i / 17 * math.tau) * 45)
        paste_mascot(img, (540, 1040 + offset), 760, rotate=math.sin(i / 17 * math.tau) * 5)
        draw.text((80, 1710), "trippi.ai, your Trippi, our Troppa.", font=font(FONT_BODY, 45), fill=ink)
        frames.append(img.convert("P", palette=Image.Palette.ADAPTIVE))
    frames[0].save(
        OUT / "trippi-troppa-launch-loop.gif",
        save_all=True,
        append_images=frames[1:],
        duration=100,
        loop=0,
        optimize=True,
    )


def write_docs(items: list[dict[str, object]]) -> None:
    captions = """# Trippi Social Launch V2 Captions

## Bio
Trippi.ai, your Trippi, our Troppa.
Plan smarter.
Less confusion. More fun.

Link: https://www.trippi.lol/?utm_source=social&utm_medium=bio&utm_campaign=prelaunch

## Pinned Post 1
Trippi.ai, your Trippi, our Troppa.

Plan smarter. Less confusion. More fun.

Launching soon at trippi.lol.

#tripplanner #aitravel #travelplanning #startup #grouptrip

## Pinned Post 2
Group chat arguing about dates, budget, hotels, and vibes?

Trippi Troppa is entering the chat.

#grouptrip #travelapp #aitravel #tripplanning

## Pinned Post 3
Comment a city and Trippi Troppa will turn it into a first trip draft.

Less confusion. More fun.

#travelideas #citybreak #aitravel #tripplanner

## TikTok/Reels Shot List
1. Open with the cover asset for 0.5s.
2. Screen record fast taps through Trippi planning a trip.
3. Cut to group chat pain text.
4. End on mascot plus "Plan smarter. trippi.lol".
"""
    (OUT / "captions.md").write_text(captions, encoding="utf-8")

    style = """# Trippi Social Launch V2 Style System

This version borrows proven campaign mechanics without copying another brand's trade dress:

- Mascot-as-creator: Trippi Troppa behaves like a character, not a logo.
- Shareable stat cards: trip-energy formats make people tag friends.
- High-contrast launch type: one hook per asset, readable in the first second.
- Comment-native prompts: every post gives the audience something easy to reply with.

Core lines:

- trippi.ai, your Trippi, our Troppa.
- Plan smarter.
- Less confusion. More fun.

Palette:

- Ink: #15130f
- Cream: #fff3df
- Lime: #d7ff3f
- Blue: #2f58ff
- Coral: #ff6b4a
- Teal: #00b8a8
- Pink: #ff4fd8
"""
    (OUT / "style-system.md").write_text(style, encoding="utf-8")

    manifest = {
        "campaign": "Trippi Troppa social launch v2",
        "createdBy": "scripts/marketing/generate_trippi_social_v2.py",
        "mascotSource": str(MASCOT),
        "positioning": [
            "Mascot-led travel planning character",
            "Group-chat chaos relief",
            "Shareable trip-energy meme format",
            "Launching soon prelaunch CTA",
        ],
        "items": items,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    review_manifest = []
    for i, item in enumerate(items, start=1):
        if item["src"].endswith(".png"):
            review_manifest.append({**item, "index": i})
    (OUT / "review-manifest.json").write_text(json.dumps(review_manifest, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    shutil.copyfile(MASCOT, OUT / "trippi-troppa-approved-transparent.png")

    items: list[dict[str, object]] = []
    profile_avatar(items)
    reel_plan_smarter(items)
    reel_group_chat(items)
    reel_comment_city(items)
    reel_trip_energy(items)
    ig_your_trippi(items)
    ig_less_confusion(items)
    ig_waitlist(items)
    feed_plan(items)
    carousel(items)
    build_gif()
    items.append(
        {
            "id": "trippi-troppa-launch-loop",
            "title": "Animated launch loop",
            "category": "animation",
            "src": "trippi-troppa-launch-loop.gif",
            "href": "trippi-troppa-launch-loop.gif",
            "output": "trippi-troppa-launch-loop.gif",
        }
    )
    write_docs(items)


if __name__ == "__main__":
    main()
