"""Find tick marks drawn twice (a short segment lying on another short collinear segment), e.g. minor ticks under major ticks."""
import sys,glob,os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); import overlap_segs as O  # overlap_segs.py
from collections import defaultdict
def find(svg,tol=0.05):
    B=defaultdict(list); out=[]
    for s in O.segs(svg):
        for ax in (0,1):
            o=1-ax
            if abs(s[0][ax]-s[1][ax])<1e-3:
                l=abs(s[0][o]-s[1][o])
                if 0<l<12: B[(ax,round(s[0][ax]/tol))].append((min(s[0][o],s[1][o]),max(s[0][o],s[1][o]),s))
    for (ax,k),L in B.items():
        L=L+B.get((ax,k+1),[])
        for i in range(len(L)):
            for j in range(i+1,len(L)):
                a,b=L[i],L[j]; ov=min(a[1],b[1])-max(a[0],b[0])
                if ov>0.2: out.append(('V' if ax==0 else 'H',round(k*tol,2),round(a[1]-a[0],1),round(b[1]-b[0],1)))
    return out
if __name__=='__main__':
    for f in sorted(glob.glob(sys.argv[1])):
        h=find(open(f).read())
        if h: print(os.path.basename(f),len(h),h[:4])
