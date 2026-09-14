#!/usr/bin/env python3
"""Render docs/assets/*.gif demos from REAL tool output.

Runs the actual CLI (dist/cli.js) and the actual MCP server session
(scripts/mcp_session.mjs) against demo-project/, captures stdout,
and renders each scenario as an animated terminal GIF.

Usage:
    pnpm build                     # make sure dist/ exists
    python scripts/render_demo.py  # renders every demo in DEMOS
"""
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, "dist", "cli.js")
OUT_DIR = os.path.join(ROOT, "docs", "assets")

W, H = 1400, 780
CHROME = 38
STATUS = 26
PAD = 14
FPS = 30
FONT_SIZE = 15

# VS Code dark palette — same DNA as the --ui dashboard
BG = (30, 30, 30)          # #1e1e1e
CHROME_BG = (37, 37, 38)   # #252526
STATUS_BG = (0, 127, 212)  # #007fd4
BORDER = (60, 60, 60)      # #3c3c3c
FG = (212, 212, 212)       # #d4d4d4
DIM = (128, 128, 128)      # #808080
GREEN = (137, 209, 133)    # #89d185
BLUE = (79, 193, 255)      # #4fc1ff
PURPLE = (197, 134, 192)   # #c586c0
AMBER = (215, 186, 125)    # #d7ba7d
RED = (244, 135, 113)      # #f48771
PROMPT_FG = (78, 201, 176) # #4ec9b0 teal

FONT_PATH = r"C:\Windows\Fonts\CascadiaMono.ttf"
if not os.path.exists(FONT_PATH):
    FONT_PATH = r"C:\Windows\Fonts\consola.ttf"
if not os.path.exists(FONT_PATH):
    FONT_PATH = r"C:\Windows\Fonts\cour.ttf"

font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
line_h = font.getbbox("Mg")[3] + 7
char_w = font.getlength("M")
MAX_COLS = int((W - 2 * PAD) // char_w)
MAX_ROWS = int((H - CHROME - STATUS - 2 * PAD) // line_h)

DEMO_ABS = os.path.join(ROOT, "demo-project")
DISPLAY_PATH = "~/demo-petstore"

# name → { prompt, title, steps: [(shown_command, argv_for_node, cwd)] }
# Shown commands are the real published ones; argv runs the same binary.
DEMOS = {
    "demo": {
        "prompt": "demo-petstore $ ",
        "title": "codebase-chat — demo-petstore",
        "steps": [
            ("npx codebase-chat --index", [CLI, "--index"], DEMO_ABS),
            ("npx codebase-chat --stats", [CLI, "--stats"], DEMO_ABS),
            ("npx codebase-chat --search 'jwt token' --lang en",
             [CLI, "--search", "jwt token", "--lang", "en"], DEMO_ABS),
            ("npx codebase-chat --health --lang en",
             [CLI, "--health", "--lang", "en"], DEMO_ABS),
            ("npx codebase-chat --ask 'is there a hardcoded secret?' --lang en",
             [CLI, "--ask", "is there a hardcoded secret?", "--lang", "en"], DEMO_ABS),
        ],
    },
    "demo-fr": {
        "prompt": "demo-petstore $ ",
        "title": "codebase-chat — mode français",
        "steps": [
            ("npx codebase-chat --file login --lang fr",
             [CLI, "--file", "login", "--lang", "fr"], DEMO_ABS),
            ("npx codebase-chat --ask 'comment est gérée l authentification ?'",
             [CLI, "--ask", "comment est gérée l'authentification ?", "--lang", "fr"], DEMO_ABS),
        ],
    },
    "demo-mcp": {
        "prompt": "mcp-client $ ",
        "title": "codebase-chat-mcp — real stdio session",
        "steps": [
            ("npx codebase-chat-mcp", [os.path.join(ROOT, "scripts", "mcp_session.mjs")], ROOT),
        ],
    },
    # session: a driver script that runs REAL commands and prints a transcript
    # ($ command + real output lines). Replayed with typing animation.
    "demo-power": {
        "prompt": "demo-petstore $ ",
        "title": "codebase-chat — diff-aware review + live watch",
        "session": os.path.join(ROOT, "scripts", "power_session.mjs"),
    },
    # real MCP conversation on a real 400+ file codebase — every tool call is
    # a live stdio JSON-RPC call; "Assistant ›" is the host model answering
    # with the cited context (promptOnly mode — what an IDE actually does).
    "demo-conv": {
        "prompt": "",
        "title": "codebase-chat — real MCP session on a 422-file codebase",
        "session": os.path.join(ROOT, "scripts", "conv_session.mjs"),
    },
}


def run_real(argv, cache_dir, cwd):
    env = dict(os.environ, CODEBASE_CACHE_DIR=cache_dir,
               DEEPSEEK_API_KEY="", OPENAI_API_KEY="")
    proc = subprocess.run(
        ["node", *argv],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    lines = (proc.stdout + proc.stderr).splitlines()
    # never leak local absolute paths or the real folder name into the public GIF
    return [l.replace(DEMO_ABS, DISPLAY_PATH)
             .replace(ROOT, "~/codebase-chat")
             .replace("demo-project", "demo-petstore") for l in lines]


def color_for(line, is_cmd):
    if is_cmd:
        return PROMPT_FG
    if line.startswith("→"):
        return BLUE
    if line.startswith("←"):
        return GREEN
    if line.startswith("--- ") and "[source:" in line:
        return BLUE
    if line.startswith(("Project:", "Cache:", "Projet :")):
        return DIM
    if line.startswith(("Files:", "Tokens:", "Terms:", "Chunks:", "Fichiers", "Jetons")):
        return GREEN
    if line.startswith("Reading"):
        return DIM
    if line.startswith(("Indexed", "Indexing", "Indexation")):
        return AMBER
    if line.startswith(("Diff scope", "Scope:", "Périmètre")):
        return AMBER
    if line.startswith(("Changed:", "Watch mode", "Mode watch")):
        return GREEN
    if line.lstrip().startswith(("walk:", "index:", "static pass:", "retrieval:", "assembled:", "indexing")):
        return DIM
    if line.lstrip().startswith("done in"):
        return GREEN
    if "Health score" in line and ("(E)" in line or "(D)" in line or "(F)" in line):
        return RED
    if line.startswith("- `"):
        return (255, 170, 160)
    if line.startswith("## "):
        return (230, 237, 243)
    if "circular" in line.lower() or "circulaire" in line.lower():
        return RED
    if line.startswith("You ›"):
        return PROMPT_FG
    if line.startswith("Assistant ›"):
        return PURPLE
    if line.startswith("  [source:"):
        return BLUE
    if "Health score" in line or "codebase_" in line:
        return AMBER
    if line.startswith("$ "):
        return PROMPT_FG
    if line.startswith("--- Stats ---"):
        return PURPLE
    if line.startswith(("Answer in", "Réponds", "Reponds", "Répondre")):
        return AMBER
    if "secret" in line.lower() or "FIXME" in line or "TODO" in line:
        return RED
    return FG


def wrap(line):
    if len(line) <= MAX_COLS:
        return [line]
    return [line[i:i + MAX_COLS] for i in range(0, len(line), MAX_COLS)]


def render(screen_lines, title):
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, W, CHROME], fill=CHROME_BG)
    draw.line([0, CHROME, W, CHROME], fill=BORDER)
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        x = PAD + i * 22
        draw.ellipse([x, CHROME // 2 - 6, x + 12, CHROME // 2 + 6], fill=c)
    tw = draw.textlength(title, font=font)
    draw.text(((W - tw) / 2, (CHROME - line_h) / 2 + 2), title, font=font, fill=DIM)

    visible = screen_lines[-MAX_ROWS:]
    y = CHROME + PAD
    for text, color in visible:
        draw.text((PAD, y), text, font=font, fill=color)
        y += line_h

    # Status bar — same signature as the --ui dashboard
    sy = H - STATUS
    draw.rectangle([0, sy, W, H], fill=STATUS_BG)
    left = "◆ codebase-chat"
    right = "local — no upload"
    ty = sy + (STATUS - line_h) / 2 + 3
    draw.text((PAD, ty), left, font=font, fill=(255, 255, 255))
    rw = draw.textlength(right, font=font)
    draw.text((W - rw - PAD, ty), right, font=font, fill=(255, 255, 255))
    return img


def render_demo(name, spec, cache_dir):
    frames = []
    durations = []
    screen = []
    prompt = spec["prompt"]
    title = spec["title"]

    def push(line, color):
        for w in wrap(line):
            screen.append((w, color))

    def snap(n=1, dur=None):
        frame = render(screen, title)
        for _ in range(n):
            frames.append(frame)
            durations.append(dur or int(1000 / FPS))

    if "session" in spec:
        # replay a real recorded session: "$ ..." lines get typing animation
        for line in run_real([spec["session"]], cache_dir, ROOT):
            if line.startswith(("$ ", "You ›")):
                for i in range(1, len(line) + 1):
                    frames.append(render(screen + [(line[:i] + "▌", PROMPT_FG)], title))
                    durations.append(18)
                push(line, PROMPT_FG)
                snap(6, 40)
            else:
                push(line, color_for(line, False))
                snap(1, 45)
        snap(FPS * 6, 33)
    else:
        for shown_cmd, argv, cwd in spec["steps"]:
            typed = ""
            for ch in shown_cmd:
                typed += ch
                line_screen = screen[:-1] + [(prompt + typed + "▌", PROMPT_FG)] if screen and screen[-1][0].startswith(prompt) else screen + [(prompt + typed + "▌", PROMPT_FG)]
                frames.append(render(line_screen, title))
                durations.append(18)
            push(prompt + shown_cmd, PROMPT_FG)
            snap(6, 40)

            out_lines = run_real(argv, cache_dir, cwd)
            burst = 1 if len(out_lines) < 40 else 4
            for i in range(0, len(out_lines), burst):
                for line in out_lines[i:i + burst]:
                    push(line, color_for(line, False))
                snap(1, 33)
            snap(FPS * 2, 33)

    snap(FPS * 6, 33)

    out_path = os.path.join(OUT_DIR, f"{name}.gif")
    os.makedirs(OUT_DIR, exist_ok=True)
    qframes = [f.quantize(colors=64) for f in frames]
    qframes[0].save(
        out_path,
        save_all=True,
        append_images=qframes[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )
    print(f"wrote {out_path} — {len(frames)} frames, {os.path.getsize(out_path)//1024} KB")


def main():
    only = os.sys.argv[1:] or None
    for name, spec in DEMOS.items():
        if only and name not in only:
            continue
        # fresh cache dir → the demo shows real indexing work
        cache_dir = tempfile.mkdtemp(prefix="codebase-demo-cache-")
        try:
            render_demo(name, spec, cache_dir)
        finally:
            shutil.rmtree(cache_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
