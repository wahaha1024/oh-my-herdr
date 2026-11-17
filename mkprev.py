import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
TPL = os.path.join(HERE, "preview.svg")

LIGHT_PAL = ["#a84a50", "#8a5619", "#7d640c", "#357041", "#34618f", "#5f5399", "#805083"]
DARK_PAL = ["#f08a8a", "#f2a46a", "#e8c76a", "#7ecf86", "#6fb3ea", "#9a8ce6", "#c98ae6"]

# 模板里用到的浅色值 -> 语义槽
SEM = {
    "#e8f0ec": "bg",
    "#e1eae4": "chrome",
    "#d9e3dc": "selected",
    "#afcdd0": "border",
    "#2b333e": "fg",
    "#5f6b67": "muted",
    "#646c73": "dim",
    "#8a979f": "dim",
    "#126e82": "accent",
    "#1a6840": "done",
    "#66462a": "working",
    "#b78b26": "ansi3",
    "#f7faf8": "ink",
    "#a84a50": "s0",
    "#8a5619": "s1",
    "#357041": "s3",
    "#34618f": "s4",
}


def table(theme, dark):
    c = theme["colors"]
    pal = DARK_PAL if dark else LIGHT_PAL
    return {
        "bg": theme["background"],
        "chrome": c["chrome"],
        "selected": c["selected"],
        "border": c["border"],
        "fg": theme["foreground"],
        "muted": c["muted"],
        "dim": c["dim"],
        "accent": c["accent"],
        "done": c["done"],
        "working": c["working"],
        "ansi3": theme["ansi"][3],
        "ink": c["accent_foreground"] if dark else "#f7faf8",
        "s0": pal[0],
        "s1": pal[1],
        "s3": pal[3],
        "s4": pal[4],
    }


def convert(svg, tab, known):
    def repl(m):
        six = "#" + m.group(1).lower()
        alpha = m.group(2) or ""
        sem = SEM.get(six)
        if sem is None:
            known.add(six)
            return m.group(0)
        return tab[sem] + alpha

    return re.sub(r"#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?", repl, svg)


def render(svg_path, png_path):
    html = os.path.join(HERE, "_r.html")
    with open(html, "w", encoding="utf-8") as f:
        f.write(
            '<html><head><style>html,body{margin:0;padding:0}img{display:block}</style>'
            '</head><body><img src="%s" width="1200" height="715"></body></html>'
            % os.path.basename(svg_path)
        )
    shot = os.path.join(HERE, "_shot.png")
    subprocess.run(
        [EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars",
         "--force-device-scale-factor=1", "--window-size=1200,900",
         "--screenshot=" + shot, "file:///" + html.replace("\\", "/")],
        check=True, capture_output=True,
    )
    ps = (
        "Add-Type -AssemblyName System.Drawing;"
        "$b=[System.Drawing.Bitmap]::FromFile('%s');"
        "$r=New-Object System.Drawing.Rectangle(0,0,1200,715);"
        "$c=$b.Clone($r,$b.PixelFormat);"
        "$c.Save('%s',[System.Drawing.Imaging.ImageFormat]::Png);"
        "$c.Dispose();$b.Dispose()" % (shot, png_path)
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True, capture_output=True)
    for p in (html, shot):
        try:
            os.remove(p)
        except OSError:
            pass


tpl = open(TPL, encoding="utf-8").read()
unknown = set()

for name, theme_file, dark, out in [
    ("light", "themes/qingci.json", False, "preview.png"),
    ("dark", "themes/xuanmo.json", True, "preview-dark.png"),
]:
    theme = json.load(open(os.path.join(HERE, theme_file), encoding="utf-8"))
    svg = convert(tpl, table(theme, dark), unknown)
    svg_path = os.path.join(HERE, "_%s.svg" % name)
    open(svg_path, "w", encoding="utf-8").write(svg)
    render(svg_path, os.path.join(HERE, out))
    os.remove(svg_path)
    print("wrote", out, os.path.getsize(os.path.join(HERE, out)), "bytes")

if unknown:
    print("unmapped colours:", ", ".join(sorted(unknown)))
