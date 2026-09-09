#!/usr/bin/env python3
"""Minimal ffprobe stand-in: parses `ffmpeg -i` output and prints the JSON subset
(format.duration, streams[codec_type/codec_name/pix_fmt/width/height/sample_rate])."""
import json, re, subprocess, sys
args = sys.argv[1:]
path = args[-1] if args else None
if not path:
    sys.exit(2)
r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path], capture_output=True, text=True)
out = r.stderr
fmt = {}
m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", out)
if m:
    fmt["duration"] = f"{int(m.group(1))*3600 + int(m.group(2))*60 + float(m.group(3)):.6f}"
m = re.search(r"bitrate:\s*(\d+)\s*kb/s", out)
if m:
    fmt["bit_rate"] = str(int(m.group(1)) * 1000)
fmt["filename"] = path
streams = []
for line in out.splitlines():
    sm = re.search(r"Stream #\d+:(\d+).*?:\s*(Video|Audio):\s*([A-Za-z0-9_]+)(.*)$", line)
    if not sm:
        continue
    idx, kind, codec, rest = int(sm.group(1)), sm.group(2).lower(), sm.group(3), sm.group(4)
    st = {"index": idx, "codec_type": kind, "codec_name": codec}
    if kind == "video":
        pm = re.search(r",\s*([a-z0-9]+(?:le|be)?)(?:\([^)]*\))?\s*,\s*\d+x\d+", rest)
        if pm:
            st["pix_fmt"] = pm.group(1)
        wm = re.search(r"(\d{2,5})x(\d{2,5})", rest)
        if wm:
            st["width"], st["height"] = int(wm.group(1)), int(wm.group(2))
        fm = re.search(r"([\d.]+)\s*fps", rest)
        if fm:
            st["avg_frame_rate"] = fm.group(1)
    else:
        hm = re.search(r"(\d+)\s*Hz", rest)
        if hm:
            st["sample_rate"] = hm.group(1)
        cm = re.search(r"Hz,\s*([a-z0-9.()]+)", rest)
        if cm:
            st["channel_layout"] = cm.group(1)
    streams.append(st)
print(json.dumps({"format": fmt, "streams": streams}, indent=2))
