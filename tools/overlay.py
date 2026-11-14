"""Overlay each original crop (red) on its current redraw (blue) at the same 200 dpi scale, aligned on the ink
bounding box. Where both have ink the pixel is black, so a perfect match looks black and any mismatch shows colour."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import numpy as np, sys, glob, os
from PIL import Image
P=paths.P
def ink(path):
    a=np.asarray(Image.open(path).convert('L'),dtype=np.uint8); m=a<170
    ys,xs=np.nonzero(m)
    return m[ys.min():ys.max()+1, xs.min():xs.max()+1] if len(ys) else m
def overlay(k):
    a=ink(P+f'figures/{k}.png'); b=ink(P+f'tikz/png/{k}.png')
    # best translation (within 40 px) by FFT cross-correlation of the slightly blurred ink masks
    from scipy.signal import fftconvolve
    from scipy.ndimage import binary_dilation as bd
    pad=40; H=max(a.shape[0],b.shape[0])+2*pad; W=max(a.shape[1],b.shape[1])+2*pad
    A=np.zeros((H,W),bool); A[pad:pad+a.shape[0],pad:pad+a.shape[1]]=a
    Bs=np.zeros((H,W),bool); Bs[pad:pad+b.shape[0],pad:pad+b.shape[1]]=b
    c=fftconvolve(bd(A,iterations=2).astype(float), bd(Bs,iterations=2)[::-1,::-1].astype(float), mode='same')
    cy,cx=H//2,W//2; win=c[cy-pad:cy+pad+1, cx-pad:cx+pad+1]; dy,dx=np.unravel_index(np.argmax(win),win.shape); dy-=pad; dx-=pad
    B=np.roll(np.roll(Bs,dy,0),dx,1)
    out=np.full((H,W,3),255,np.uint8)
    out[A&~B]=(225,45,45); out[B&~A]=(40,90,230); out[A&B]=(20,20,20)
    Image.fromarray(out).save(P+f'tikz/overlay/{k}.png', optimize=True)
    # agreement score: share of the original's ink within 2px of redraw ink and vice versa
    from scipy.ndimage import binary_dilation
    Ad=binary_dilation(A,iterations=2); Bd=binary_dilation(B,iterations=2)
    return round(float((A&Bd).sum()/max(A.sum(),1)),3), round(float((B&Ad).sum()/max(B.sum(),1)),3), a.shape, b.shape, (int(dx),int(dy))
if __name__=='__main__':
    import json
    ids=sys.argv[1:] or [os.path.basename(f)[:-4] for f in glob.glob(paths.S + 'tikz/tex/*.tex')]
    sp=paths.S + 'tikz/overlay_scores.json'
    res=json.load(open(sp)) if os.path.exists(sp) else {}
    for k in ids:
        try: r=overlay(k); res[k]={'orig_covered':r[0],'redraw_covered':r[1],'orig_px':r[2],'redraw_px':r[3],'shift':r[4]}
        except Exception as e: res[k]={'error':str(e)}
    json.dump(res,open(paths.S + 'tikz/overlay_scores.json','w'),indent=1)
    for k in ids: print(k, res[k])
