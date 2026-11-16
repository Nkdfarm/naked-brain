#!/usr/bin/env python3
"""Syntax-check every inline <script> of index.html with Node (node --check). Used by CI; needs Node on the PATH."""
import os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
blocks = re.findall(r'<script>\n(.*?)</script>', html, re.S)
bad = 0
with tempfile.TemporaryDirectory() as d:
    for i, code in enumerate(blocks, 1):
        p = os.path.join(d, f'block{i}.js')
        open(p, 'w', encoding='utf-8').write(code)
        r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
        if r.returncode:
            bad += 1
            print(f'script block {i}: syntax error\n{r.stderr}')
print(f'{len(blocks)} script blocks, {bad} with errors')
sys.exit(1 if bad or not blocks else 0)
