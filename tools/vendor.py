#!/usr/bin/env python3
"""Self-hosted copies of the page's outside code and fonts (hardening action 3, owner 14 Nov: "no more importing for a while
until we iron these out"). The review page loads NOTHING from public CDNs: MathJax, its Termes font data, html-to-image,
jsPDF, docx, mathml2omml and the web fonts are served from site/vendor/, published next to review.html.

  site/vendor/                         the vendored files (published; see tools/vendor_manifest.json for the exact list)
    mathjax-4.1.3/                     tex-svg-nofont.js, a11y/assistive-mml.js, input/tex/extensions/*.js, ui/*.js, LICENSE.txt
    mathjax-termes-font-4.1.3/         svg.js + svg/dynamic/*.js (every dynamic chunk of the font), LICENSE.txt
    html-to-image-1.11.11/  jspdf-2.5.1/  docx-9.0.2/  mathml2omml-0.5.0/     the one file each that the page loads, LICENSE.txt
    fonts/fonts.css + fonts/*.woff2    Inter 400-700, Fraunces (opsz) 500-600, IBM Plex Mono 400/500, Tinos 400/700 + italics;
                                       every unicode-range subset that Google Fonts serves; OFL licences in fonts/LICENSE-*.txt
  tools/vendor_manifest.json           path, bytes and sha256 of every vendored file + a ready "files" map for the publish

Usage:
  python3 tools/vendor.py --check                        verify site/vendor/ against the manifest (exit 1 on any mismatch)
  python3 tools/vendor.py --fetch [--nm DIR] [--fonts DIR]
        rebuild site/vendor/ from npm copies and rewrite the manifest. --nm: a node_modules folder holding mathjax@4.1.3,
        @mathjax/mathjax-termes-font@4.1.3, html-to-image@1.11.11, jspdf@2.5.1, docx@9.0.2, mathml2omml@0.5.0.
        --fonts: a folder holding the unpacked npm tarballs fontsource-inter-5.3.0/, fontsource-variable-fraunces-5.3.0/,
        fontsource-ibm-plex-mono-5.3.0/, fontsource-tinos-5.3.0/ (npm pack @fontsource/inter@5 @fontsource-variable/fraunces@5
        @fontsource/ibm-plex-mono@5 @fontsource/tinos@5, then untar each into a folder named after its tarball).
        Only needed to change a library version; the vendored files themselves are the source of truth.
tools/build_page.py calls check() on every build and refuses a page that points at a vendor file the manifest does not list.
"""
import hashlib, json, os, pathlib, re, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'
VENDOR = SITE / 'vendor'
MANIFEST = ROOT / 'tools' / 'vendor_manifest.json'
MAX_FILES, MAX_BYTES = 255, 64 * 1024 * 1024          # artifact limits per publish
OK_EXT = {'.js', '.css', '.woff2', '.txt'}

# (destination under site/vendor/, source package dir under --nm, file globs inside the package)
NPM = [
    ('mathjax-4.1.3', 'mathjax', ['tex-svg-nofont.js', 'a11y/assistive-mml.js', 'input/tex/extensions/*.js', 'ui/*.js']),
    ('mathjax-termes-font-4.1.3', '@mathjax/mathjax-termes-font', ['svg.js', 'svg/dynamic/*.js']),
    ('html-to-image-1.11.11', 'html-to-image', ['dist/html-to-image.js']),
    ('jspdf-2.5.1', 'jspdf', ['dist/jspdf.umd.min.js']),
    ('docx-9.0.2', 'docx', ['build/index.umd.js']),
    ('mathml2omml-0.5.0', 'mathml2omml', ['dist/index.js']),
]
LICENSES = {'mathjax-4.1.3': 'mathjax/LICENSE', 'mathjax-termes-font-4.1.3': 'mathjax/LICENSE',   # the font package ships no LICENSE file; it is Apache-2.0 like MathJax
            'html-to-image-1.11.11': 'html-to-image/LICENSE', 'jspdf-2.5.1': 'jspdf/LICENSE', 'docx-9.0.2': 'docx/LICENSE',
            'mathml2omml-0.5.0': 'mathml2omml/LICENSE'}
VERSIONS = {'mathjax': '4.1.3', '@mathjax/mathjax-termes-font': '4.1.3', 'html-to-image': '1.11.11', 'jspdf': '2.5.1', 'docx': '9.0.2',
            'mathml2omml': '0.5.0'}
# The same faces the page used to request from Google Fonts:
#   Inter:wght@400;500;600;700  Fraunces:opsz,wght@9..144,500;9..144,600  IBM+Plex+Mono:wght@400;500  Tinos:ital,wght@0,400;0,700;1,400;1,700
FONTS = [  # (family name the CSS uses, fontsource folder, fontsource css files, family name inside those css files, weight override)
    ('Inter', 'fontsource-inter-5.3.0', ['400.css', '500.css', '600.css', '700.css'], 'Inter', None),
    ('Fraunces', 'fontsource-variable-fraunces-5.3.0', ['opsz.css'], 'Fraunces Variable', '500 600'),
    ('IBM Plex Mono', 'fontsource-ibm-plex-mono-5.3.0', ['400.css', '500.css'], 'IBM Plex Mono', None),
    ('Tinos', 'fontsource-tinos-5.3.0', ['400.css', '400-italic.css', '700.css', '700-italic.css'], 'Tinos', None),
]


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def fetch(nm, fonts):
    nm, fonts = pathlib.Path(nm), pathlib.Path(fonts)
    for pkg, ver in VERSIONS.items():
        got = json.loads((nm / pkg / 'package.json').read_text())['version']
        assert got == ver, f'{pkg}: need {ver}, found {got}'
    if VENDOR.exists():
        shutil.rmtree(VENDOR)
    src_of = {}
    for dest, pkg, globs in NPM:
        for g in globs:
            hits = sorted((nm / pkg).glob(g))
            assert hits, f'{pkg}/{g}: no files'
            for f in hits:
                out = VENDOR / dest / f.relative_to(nm / pkg)
                out.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(f, out)
                src_of[out] = f'{pkg}@{VERSIONS[pkg]}/{f.relative_to(nm / pkg)}'
        out = VENDOR / dest / 'LICENSE.txt'; shutil.copyfile(nm / LICENSES[dest], out); src_of[out] = LICENSES[dest]
    # fonts: copy the woff2 files the @font-face rules use and write one stylesheet
    fd = VENDOR / 'fonts'; fd.mkdir(parents=True)
    css = ['/* Self-hosted web fonts (tools/vendor.py). Same families, weights, styles and unicode-range subsets the page used to\n'
           '   request from fonts.googleapis.com; files from the fontsource npm packages (SIL Open Font License, see LICENSE-*.txt). */\n']
    for fam, pkgdir, files, srcfam, wt in FONTS:
        base = fonts / pkgdir / 'package'
        lic = fd / f'LICENSE-{pkgdir}.txt'; shutil.copyfile(base / 'LICENSE', lic); src_of[lic] = f'{pkgdir}/LICENSE'
        for cf in files:
            for blk in re.findall(r'(/\*[^*]*\*/\s*@font-face\s*\{[^}]*\})', (base / cf).read_text()):
                urls = re.findall(r'url\(\./files/([^)]+\.woff2)\)', blk)
                assert len(urls) == 1, blk
                fn = urls[0]; shutil.copyfile(base / 'files' / fn, fd / fn); src_of[fd / fn] = f'{pkgdir}/files/{fn}'
                fmt = "format('woff2-variations')" if 'woff2-variations' in blk else "format('woff2')"
                blk = re.sub(r'src:[^;]*;', f"src: url({fn}) {fmt};", blk)              # woff2 only (every browser that runs the page has it)
                blk = blk.replace(f"font-family: '{srcfam}'", f"font-family: '{fam}'")
                if wt:
                    blk = re.sub(r'font-weight: [^;]*;', f'font-weight: {wt};', blk)
                css.append(blk + '\n')
    (fd / 'fonts.css').write_text('\n'.join(css))
    src_of[fd / 'fonts.css'] = 'generated by tools/vendor.py from the fontsource css'
    files = sorted(p for p in VENDOR.rglob('*') if p.is_file())
    # the artifact publish refuses files containing a raw U+FFFD; docx's UMD build returns it as a string literal
    for p in files:
        if p.suffix == '.js':
            t = p.read_text(encoding='utf8')
            if '\ufffd' in t:
                p.write_text(t.replace('"\ufffd"', '"\\ufffd"'), encoding='utf8')
                assert '\ufffd' not in p.read_text(encoding='utf8'), f'raw U+FFFD left in {p}'
    man = {'note': 'Generated by tools/vendor.py --fetch. Publish every file below with review.html: pass "files" as the publish files map '
                   '(published path -> source path relative to /home/claude/pilot).',
           'count': len(files), 'bytes': sum(p.stat().st_size for p in files),
           'files': {str(p.relative_to(SITE)): str(p.relative_to(ROOT)) for p in files},
           'detail': [{'path': str(p.relative_to(SITE)), 'bytes': p.stat().st_size, 'sha256': sha(p), 'from': src_of.get(p, '')} for p in files]}
    MANIFEST.write_text(json.dumps(man, indent=1) + '\n')
    print(f'vendored {man["count"]} files, {man["bytes"]:,} bytes into {VENDOR}; manifest {MANIFEST}')


def check(quiet=False):
    """Return a list of problems (empty = OK)."""
    errs = []
    if not MANIFEST.exists():
        return [f'{MANIFEST} missing: run tools/vendor.py --fetch']
    man = json.loads(MANIFEST.read_text())
    want = {d['path']: d for d in man['detail']}
    have = {str(p.relative_to(SITE)) for p in VENDOR.rglob('*') if p.is_file()} if VENDOR.exists() else set()
    for k, d in want.items():
        p = SITE / k
        if not p.exists():
            errs.append(f'missing {k}')
        elif p.stat().st_size != d['bytes'] or sha(p) != d['sha256']:
            errs.append(f'changed {k} (sha256 differs from the manifest)')
        if pathlib.Path(k).suffix not in OK_EXT:
            errs.append(f'not a plain web type: {k}')
        if man['files'].get(k) != 'site/' + k:
            errs.append(f'files map entry wrong for {k}')
    for k in sorted(have - set(want)):
        errs.append(f'extra file not in the manifest: {k}')
    if len(want) > MAX_FILES - 1 or man['bytes'] > MAX_BYTES:
        errs.append(f'over the artifact publish limits: {len(want)} files, {man["bytes"]:,} bytes')
    if not quiet:
        print(('vendor OK: ' if not errs else 'VENDOR PROBLEMS: ') + f'{len(want)} files, {man["bytes"]:,} bytes in site/vendor/')
        for e in errs[:30]:
            print('  ' + e)
    return errs


def manifest_paths():
    return set(json.loads(MANIFEST.read_text())['files']) if MANIFEST.exists() else set()


if __name__ == '__main__':
    a = sys.argv[1:]
    if '--fetch' in a:
        D = '/tmp/claude-0/-home-claude/800fc37d-9da1-531b-8789-51723586bf26/scratchpad/'
        nm = a[a.index('--nm') + 1] if '--nm' in a else D + 'pdflib/node_modules'
        fo = a[a.index('--fonts') + 1] if '--fonts' in a else D + 'hardening/vendor/fontpkgs'
        fetch(nm, fo)
    sys.exit(1 if check() else 0)
