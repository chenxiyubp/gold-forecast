"""Independently recompute each JS evaluation band from prefix-only raw OHLC.
Usage: python tests/check_forecast_independent.py history.json report.json
No third-party packages, network, or calls into the app's JS implementation.
"""
import json, math, sys
from datetime import date, datetime, timedelta, timezone
raw=json.load(open(sys.argv[1],encoding='utf-8'))['time']
report=json.load(open(sys.argv[2],encoding='utf-8'))
today=datetime.now(timezone(timedelta(hours=8))).date().isoformat()
valid={}
for row in raw:
    try:
        d=date.fromisoformat(row[0]).isoformat()
        o,c,l,h=map(float,row[1:5])
        if d<today and min(o,c,l,h)>0 and all(map(math.isfinite,(o,c,l,h))) and l<=min(o,c) and h>=max(o,c):
            valid[d]=(d,o,c,l,h)
    except (ValueError,TypeError,IndexError):
        pass
data=[valid[d] for d in sorted(valid)][-800:]
def band(prefix):
    tr=[max(r[4]-r[3],abs(r[4]-p[2]),abs(r[3]-p[2])) for p,r in zip(prefix,prefix[1:])]
    atr=[None]*14+[sum(tr[:14])/14]
    for value in tr[14:]: atr.append((atr[-1]*13+value)/14)
    scores=[]
    for i in range(len(prefix)-120,len(prefix)):
        r=prefix[i]
        scores.append(max(abs(r[4]-prefix[i-1][2]),abs(r[3]-prefix[i-1][2]))/atr[i-1])
    width=sorted(scores)[107]*atr[-1]
    return max(.01,math.floor((prefix[-1][2]-width)*100)/100),math.ceil((prefix[-1][2]+width)*100)/100
covered=0
for record in report['validation']['records']:
    i=next(i for i,r in enumerate(data) if r[0]==record['baseDate'])
    low,high=band(data[:i+1])
    assert abs(low-record['lower'])<1e-8 and abs(high-record['upper'])<1e-8
    actual=data[i+1]
    assert actual[0]==record['targetDate']
    covered+=actual[3]>=low and actual[4]<=high
n=len(report['validation']['records'])
assert abs(covered/n-report['validation']['model']['coverage'])<1e-12
print(f'Independent Python check: {n} prefix forecasts agree; full-range coverage {covered}/{n}.')
