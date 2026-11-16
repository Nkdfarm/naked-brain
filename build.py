#!/usr/bin/env python3
"""Build Naked Brain's index.html from the pieces in src/ (Python 3, nothing to install).

    python build.py           write index.html
    python build.py --check   exit 1 if index.html is not what src/ builds (CI and release-brain.ps1 run this)

The phone still gets ONE index.html: the update check, the service worker and the release script all rely on it.
src/ exists so that people and agents work on files of a few hundred lines instead of one of 18,000.
- src/index.manifest lists the pieces in order; a line "= text" is one literal line (the <script> tags).
- Each piece starts with header lines ("//! ", "/*! ", "<!--! ") that say what it is; they are left out of the build.
- js/sop/* and js/cloud/* are parts of two closures (one function each), so a piece is not a module on its own:
  its header says which closure it belongs to. Names are shared across the pieces of a closure.
"""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
OUT = os.path.join(ROOT, 'index.html')
HEADERS = ('//! ', '/*! ', '<!--! ')


def read(path):
    with open(path, encoding='utf-8', newline='') as f:
        return f.read().replace('\r\n', '\n')


def build():
    out = []
    for n, line in enumerate(read(os.path.join(SRC, 'index.manifest')).split('\n'), 1):
        if not line or line.startswith('#'):
            continue
        if line.startswith('='):
            out.append(line[2:] + '\n')
            continue
        path = os.path.join(SRC, line)
        if not os.path.isfile(path):
            sys.exit(f'index.manifest line {n}: {line} does not exist')
        text = read(path)
        if not text.endswith('\n'):
            text += '\n'
        body = text.split('\n')
        while body and body[0].startswith(HEADERS):
            body.pop(0)
        out.append('\n'.join(body))
    return ''.join(out)


def main():
    built = build()
    if '--check' in sys.argv:
        current = read(OUT) if os.path.isfile(OUT) else ''
        if current != built:
            a, b = current.split('\n'), built.split('\n')
            first = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
            print(f'index.html is not what src/ builds (first difference at line {first + 1}). Run: python build.py')
            sys.exit(1)
        print('index.html matches src/')
        return
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(built)
    print(f'index.html built: {built.count(chr(10))} lines')


if __name__ == '__main__':
    main()
