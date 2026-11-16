# ملخص قياس الرئيسيات (homes.cjs): سطر لكل مقاس/شريط
import json, sys, glob
for f in sorted(glob.glob(f'shots/homes/{sys.argv[1]}-*.json')):
    d = json.load(open(f))
    print(d['size'], d['rail'])
    for k, v in d['homes'].items():
        h = v['hero'] or {}
        print(f"   {k:6} rows={len(v['rows'])} hero={h.get('box')} visible={h.get('visible')}% pos={h.get('pos')} play1st={v['playInFirstScreen']} lineup={v['lineup'] and (v['lineup']['rows'], v['lineup']['overflow'])} top10={v['top10']} maxGap={v['maxGap']} overflowX={v['overflowX']}")
    print('   CLS', [s.get('cls') for s in d['switches']], 'errors', d['errors'][:2])
