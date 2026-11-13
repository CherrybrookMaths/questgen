"""Make a scanned/printed crop transparent: black ink with alpha = darkness, so it sits on any page colour
(and can be inverted for dark mode). Keeps grey levels (shading) as partial transparency."""
from PIL import Image, ImageOps
import numpy as np
def to_alpha(src, dst):
    g = np.asarray(Image.open(src).convert('L'), dtype=np.float32)
    a = np.clip((255 - g) * 1.08, 0, 255)          # paper white -> fully transparent
    a[a < 10] = 0                                     # drop faint scan noise
    out = np.zeros(g.shape + (2,), dtype=np.uint8); out[..., 1] = a.astype(np.uint8)
    Image.fromarray(out, 'LA').save(dst, optimize=True)
if __name__ == '__main__':
    import sys; to_alpha(sys.argv[1], sys.argv[2])
