#!/usr/bin/env python3
# BD40 (backdrop lane, 2026-10-11): the tiles' facade shader (client/src/world/materials.js makeFacadeMaterial, TOWERFX on)
# ported to Unreal HLSL for the cell master /Game/R2BD/Cell/M_bd_tilefac_v<N> (tools/ue/bd_tilefac.py).
#
# The source is the program three.js compiles, dumped from a page (tools/ue/bd_tilefac_dump.js through tools/bshot.mjs
# --evalfile) and preprocessed with its own defines, so every flag the page resolves (WL11, FR26, BW28, TOWERFX, AAFIX...) is
# resolved the same way; the colour block (the facade's albedo, roughness, normal offsets, lit rooms), the damp-roughness
# block and the normal block are translated mechanically:
#   vecN -> floatN (a one-argument constructor becomes a cast), mix -> lerp, fract -> frac, mod -> GLSL's mod, inversesqrt
#   -> rsqrt, dFdy -> -ddy (GLSL's window y runs up), texture(t_x, uv) -> Texture2DSample(Tx, TxSampler, uv);
#   three.js's view space (x right, y up, z towards the viewer) is rebuilt from Unreal's (z away from it) through the view
#   matrices: vNormal, vViewPosition and (viewMatrix * vec4(d, 0)).xyz, (vec4(d, 0) * viewMatrix).xyz; world positions and
#   directions are three.js's (x east, y up, z south: Unreal's x, z, y over 100).
# What the renderer does itself is left to it: the page paints the sky's and the street's reflection on glass as emission
# (skyLook, sunDisc, the opposite walls); here those terms are zero and the glass's own mask (the windows' glassW, the curtain
# walls' kR) is handed out with the glass family's F0 and plate roughness, so Unreal's reflections do that work. The Times
# Square screens' light (tq32SP/SN/SC, a uniform array the records do not carry) is left out; the rest of TQ32 is kept.
#   python3 tools/ue/bd_tilefac_port.py <dir with fac_color.glsl, fac_normal.glsl> -> <dir>/bd_tilefac.hlsl
import os, re, sys

D = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))


def match_paren(s, i):
    """index of the ')' closing the '(' at s[i]"""
    d = 0
    for k in range(i, len(s)):
        c = s[k]
        if c == '(':
            d += 1
        elif c == ')':
            d -= 1
            if d == 0:
                return k
    raise ValueError('unbalanced at %d' % i)


def top_level_commas(a):
    d = 0
    n = 0
    for c in a:
        if c in '([':
            d += 1
        elif c in ')]':
            d -= 1
        elif c == ',' and d == 0:
            n += 1
    return n


def ctor_casts(s):
    """vecN(x) with one argument -> ((floatN)(x)); recursive on the argument"""
    out, i = [], 0
    pat = re.compile(r'\bvec([234])\s*\(')
    while True:
        m = pat.search(s, i)
        if not m:
            out.append(s[i:])
            break
        out.append(s[i:m.start()])
        j = m.end() - 1
        k = match_paren(s, j)
        inner = ctor_casts(s[j + 1:k])
        if top_level_commas(inner) == 0:
            out.append('((float%s)(%s))' % (m.group(1), inner))
        else:
            out.append('float%s(%s)' % (m.group(1), inner))
        i = k + 1
    return ''.join(out)


def view_forms(s):
    """(viewMatrix * vec4(X, 0.0)).xyz -> H.V3(X); (vec4(X, 0.0) * viewMatrix).xyz -> H.W3(X)"""
    for pat, fn in ((r'\(\s*viewMatrix\s*\*\s*vec4\s*\(', 'V3'), (r'\(\s*vec4\s*\(', 'W3')):
        out, i = [], 0
        rx = re.compile(pat)
        while True:
            m = rx.search(s, i)
            if not m:
                out.append(s[i:])
                break
            j = m.end() - 1            # the '(' of vec4(
            k = match_paren(s, j)
            inner = s[j + 1:k]
            rest = s[k + 1:]
            if fn == 'V3':
                m2 = re.match(r'\s*\)\s*\.xyz', rest)
            else:
                m2 = re.match(r'\s*\*\s*viewMatrix\s*\)\s*\.xyz', rest)
            parts = inner.rsplit(',', 1)
            if not m2 or len(parts) != 2 or parts[1].strip() not in ('0.0', '0'):
                out.append(s[i:m.end()])
                i = m.end()
                continue
            arg = parts[0] if top_level_commas(parts[0]) == 0 else 'vec3(%s)' % parts[0]
            out.append(s[i:m.start()] + 'H.%s(%s)' % (fn, arg))
            i = k + 1 + m2.end()
        s = ''.join(out)
    return s


HELPERS = ('hash12', 'vnoise', 'fbm', 'pcovI', 'pcov', 'wlh', 'wlsg', 'fresnelR', 'skyLook', 'sunDisc', 'gmod')
TEX = {'t_wA': 'TwA', 't_wB': 'TwB', 't_wC': 'TwC', 't_wS': 'TwS', 't_wP': 'TwP', 't_sgn': 'Tsgn', 't_brN': 'TbrN', 't_brR': 'TbrR'}


def translate(s):
    s = re.sub(r'^\s*if \(vHide > 0\.5\) discard;.*$', '', s, flags=re.M)
    s = view_forms(s)
    s = ctor_casts(s)
    s = re.sub(r'\bvec([234])\b', r'float\1', s)
    s = re.sub(r'\bbvec([234])\b', r'bool\1', s)
    s = re.sub(r'\bmix\s*\(', 'lerp(', s)
    s = re.sub(r'\bfract\s*\(', 'frac(', s)
    s = re.sub(r'\bmod\s*\(', 'gmod(', s)
    s = re.sub(r'\binversesqrt\s*\(', 'rsqrt(', s)
    s = re.sub(r'\bdFdx\s*\(', 'ddx(', s)
    s = re.sub(r'\bdFdy\s*\(', '-ddy(', s)
    s = re.sub(r'\btexture\s*\(\s*(t_\w+)\s*,', lambda m: 'Texture2DSample(%s, %sSampler,' % (TEX[m.group(1)], TEX[m.group(1)]), s)
    s = re.sub(r'\bmat3\b', 'float3x3', s)
    # (HLSL intrinsics a local would shadow)
    for w in ('lit',):
        s = re.sub(r'(?<![\w.])%s(?!\w)' % w, w + '_', s)
    for h in HELPERS:
        s = re.sub(r'(?<![\w.])%s\s*\(' % h, 'H.%s(' % h, s)
    return s


def strip_block(s, head):
    """drop the brace block that starts at the first line containing `head` (the if-statement and its body)"""
    i = s.find(head)
    if i < 0:
        raise SystemExit('not found: ' + head)
    j = s.index('{', i)
    d = 0
    for k in range(j, len(s)):
        if s[k] == '{':
            d += 1
        elif s[k] == '}':
            d -= 1
            if d == 0:
                return s[:i] + '/* (BD40: the Times Square screens\' light, not carried by the records) */' + s[k + 1:]
    raise SystemExit('unbalanced block ' + head)


def main():
    col = open(os.path.join(D, 'fac_color.glsl')).read()
    # the Times Square screens (uniform arrays the records do not carry): out
    col = strip_block(col, 'if (tqW > 0.002 && tq32SNum > 0)')
    # the glass's own mask for Unreal's reflections, where the page adds its painted mirror
    a = 'glassW *= 0.55 + 0.9 * hash12(vec2(cellUS * 5.3, cellV * 8.9 + cvar * 17.0));'
    assert col.count(a) == 1, 'windows glassW anchor'
    # (v126, 2026-10-31: the windows hand out the plate's roughness too, not only its F0: at the wall's 0.9 every punched and
    # ribbon window reflected the sky as a blur and the city's glass towers read near-black from the air)
    col = col.replace(a, a + '\n              UE_glass = max(UE_glass, glassW); UE_f0 = fGlass ? FAC_glassF.x : 0.075;'
                      '\n              FAC_rough = min(FAC_rough, mix(FAC_rough, fGlass ? FAC_glassF.y : 0.08, clamp(glassW, 0.0, 1.0)));')
    b = 'FAC_rough = min(FAC_rough, mix(0.9, FAC_glassF.y, kR));'
    assert col.count(b) == 1, 'curtain wall anchor'
    col = col.replace(b, b + '\n              UE_glass = max(UE_glass, kR); UE_f0 = FAC_glassF.x;')
    body = translate(col)
    nrm = translate(open(os.path.join(D, 'fac_normal.glsl')).read())
    # (three's mat3 of columns times a vector: the columns weighted by its components)
    nrm = nrm.replace('float3x3 tsn = float3x3(Tt / tl, Bt / bl, normal);', '')
    nrm = re.sub(r'float3 pn = tsn \* (normalize\(float3\(mapN\.xy \* 1\.3, max\(mapN\.z, 0\.4\)\)\));',
                 r'float3 pnK = \1; float3 pn = (Tt / tl) * pnK.x + (Bt / bl) * pnK.y + normal * pnK.z;', nrm)
    nrm = nrm.replace('st1.t', 'st1.y').replace('st0.t', 'st0.y').replace('st1.s', 'st1.x').replace('st0.s', 'st0.x')
    for k in ('viewMatrix', 'vec2', 'vec3', 'vec4', 'texture(', 'mat3', 'tsn'):
        for name, txt in (('colour', body), ('normal', nrm)):
            if re.search(r'\b%s' % re.escape(k), txt):
                raise SystemExit('untranslated %r left in the %s block' % (k, name))
    tpl = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bd_tilefac_frame.hlsl')).read()
    # GB43: the derivative fades through the frame's H.fwk (Unreal's 8 samples a pixel: the fades at a fraction of the width)
    body = body.replace('fwidth(', 'H.fwk('); nrm = nrm.replace('fwidth(', 'H.fwk(')
    out = tpl.replace('/*@COLOUR@*/', body).replace('/*@NORMAL@*/', nrm)
    dst = os.path.join(D, 'bd_tilefac.hlsl')
    open(dst, 'w').write(out)
    print('wrote', dst, len(out.split('\n')), 'lines')


if __name__ == '__main__':
    main()
