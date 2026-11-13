import re,sys,glob,os
from collections import defaultdict
num=r'-?\d+(?:\.\d+)?'
def segs(svg):
    out=[]
    for m in re.finditer(r'<path ([^>]*)/>',svg):
        a=m.group(1)
        if 'fill="none"' not in a: continue
        d=re.search(r' d="([^"]*)"',a).group(1)
        dash='stroke-dasharray' in a
        t=re.search(r'transform="matrix\(([^)]*)\)"',a)
        M=[float(x) for x in t.group(1).split(',')] if t else [1,0,0,1,0,0]
        sw=re.search(r'stroke-width="([^"]*)"',a); sw=float(sw.group(1)) if sw else 1
        col=re.search(r'stroke="([^"]*)"',a).group(1) if 'stroke="' in a else ''
        tok=re.findall(r'[MLCZ]|'+num,d)
        i=0;cur=None;pts=[]
        while i<len(tok):
            c=tok[i]
            if c=='M': cur=(float(tok[i+1]),float(tok[i+2]));i+=3
            elif c=='L':
                p=(float(tok[i+1]),float(tok[i+2]))
                ap=lambda q:(M[0]*q[0]+M[2]*q[1]+M[4],M[1]*q[0]+M[3]*q[1]+M[5])
                out.append((ap(cur),ap(p),dash,sw,col)); cur=p;i+=3
            elif c=='C': cur=(float(tok[i+5]),float(tok[i+6]));i+=7
            else: i+=1
    return out
def find(svg,tol=0.05):
    S=segs(svg); hits=[]
    V=defaultdict(list);H=defaultdict(list)
    for s in S:
        (x1,y1),(x2,y2)=s[0],s[1]
        if abs(x1-x2)<1e-3 and abs(y1-y2)>1e-3: V[round(x1/tol)].append((min(y1,y2),max(y1,y2),s))
        elif abs(y1-y2)<1e-3 and abs(x1-x2)>1e-3: H[round(y1/tol)].append((min(x1,x2),max(x1,x2),s))
    for D,kind in ((V,'V'),(H,'H')):
        keys=sorted(D)
        for k in keys:
            L=D[k]+D.get(k+1,[])
            for i in range(len(L)):
                for j in range(i+1,len(L)):
                    a,b=L[i],L[j]
                    ov=min(a[1],b[1])-max(a[0],b[0])
                    if ov>0.3 and a[2] is not b[2]: hits.append((kind,round(k*tol,2),round(ov,2),a[2][2],b[2][2],a[2][3],b[2][3]))
    return hits
if __name__=='__main__':
    for f in sorted(glob.glob(sys.argv[1])):
        h=find(open(f).read())
        if h: print(os.path.basename(f),len(h),h[:3])
