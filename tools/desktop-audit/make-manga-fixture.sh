#!/usr/bin/env bash
# fixture مؤلف لقسم المانجا من بيانات AniList العامة بشكل استجابة /v1/updates (لا حساب ولا بيانات مستخدم).
set -euo pipefail
mkdir -p shots
curl -s -m 30 https://graphql.anilist.co -H 'content-type: application/json' \
  -d '{"query":"{Page(perPage:40){media(type:MANGA,sort:POPULARITY_DESC,isAdult:false){id title{romaji english} coverImage{extraLarge}}}}"}' -o shots/anilist-manga.json
python3 - <<'PY'
import json,time
d=json.load(open('shots/anilist-manga.json'))['data']['Page']['media'];now=int(time.time()*1000)
ev=[{'id':str(1000-i),'section':'manga','work':'ext:'+(m['title']['english'] or m['title']['romaji']).lower(),'title':m['title']['english'] or m['title']['romaji'],'kind':'chapter','number':100+i,'at':now-i*3600000,'publishedAt':now-i*3600000,'firstSeenAt':now-i*3600000,'cover':m['coverImage']['extraLarge'],'sources':[{'s':'fixture','u':'/work/'+str(m['id'])}]} for i,m in enumerate(d)]
json.dump({'events':ev,'next':None,'snapshotAt':now},open('shots/manga-updates.json','w'),ensure_ascii=False)
print(len(ev),'events → shots/manga-updates.json')
PY
