"""One-time provenance capture of public TMDB pages; application live data uses API v3.
No authentication, bypass, or private credential. Low concurrency (one request).
"""
import urllib.request, re, html, json, time, pathlib
root=pathlib.Path(__file__).resolve().parents[1]
movies=[157336,693134,438631,27205,335984,155,680,550,278,13,120,121,122,603,424,497,129,19995,105,11,299534,299536,324857,569094,76341,872585,346698,545611,496243,1124,862,354912,508943,2062,539,194,264660,2649,76203,359940]
series=[66732,1396,1399,100088,94997,100095,84773,42009,2316,82856,60625,87108]
def fetch(url):
 req=urllib.request.Request(url,headers={'User-Agent':'SNAS-local-concept/0.1 (public metadata reference)'})
 with urllib.request.urlopen(req,timeout=20) as r:return r.read().decode()
def clean(v):return html.unescape(re.sub('<[^>]+>',' ',v)).strip()
def get(s,p):
 m=re.search(p,s,re.S);return m.group(1) if m else ''
def minutes(s):
 h=get(s,r'(\d+)h');m=get(s,r'(\d+)m');return int(h or 0)*60+int(m or 0) or None
out=[];sources=[]
for kind,ids in [('movie',movies),('tv',series)]:
 for ident in ids:
  url=f'https://www.themoviedb.org/{kind}/{ident}'
  try:
   s=fetch(url);name=html.unescape(get(s,r'<meta property="og:title" content="([^"]*)"'))
   images=re.findall(r'<meta property="og:image" content="([^"]*)"',s)
   if not name:raise ValueError('missing title')
   year=get(s,r'class="tag release_date">\((\d{4})\)') or get(s,r'<title>.*?\((\d{4})\)')
   genres=[clean(x) for x in re.findall(r'<a href="/genre/[^"<]+">(.*?)</a>',get(s,r'<span class="genres">(.*?)</span>'))]
   runtime=minutes(clean(get(s,r'<span class="runtime">(.*?)</span>')))
   cast=[html.unescape(x) for x in re.findall(r'class="profile w-full"[^>]+alt="([^"]+)"',s)][:8]
   director=clean(get(s,r'<li class="profile">\s*<p><a[^>]*>(.*?)</a></p>\s*<p class="character">Director')) or None
   seasons=sorted(set(int(x) for x in re.findall(r'/season/(\d+)',s) if int(x)>0)) if kind=='tv' else []
   path=lambda n:('/'+images[n].split('/')[-1]) if len(images)>n else None
   overview=html.unescape(get(s,r'<meta property="og:description" content="([^"]*)"'))
   # Rounded public chart percentages are not precise API vote averages: deliberately omit rating.
   out.append(dict(id=ident,kind=kind,title=name,year=year,overview=overview,poster=path(0),backdrop=path(1),genres=genres,rating=None,runtime=runtime,cast=cast,director=director,seasons=max(seasons) if seasons else None))
   sources.append(url);print(kind,ident,name,flush=True)
  except Exception as e:print('FAILED',url,str(e),flush=True)
  time.sleep(.1)
(root/'src/catalog/demo-records.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
episodes={}
for ident in [66732,1396,100088,82856]:
 for season in [1,2]:
  url=f'https://www.themoviedb.org/tv/{ident}/season/{season}'
  try:
   s=fetch(url);blocks=re.split(r'<span class="episode_number">',s)[1:];eps=[]
   for b in blocks:
    number=int(get(b,r'^(\d+)'))
    title=clean(get(b,r'<h3><a[^>]*>(.*?)</a>'))
    # TV public pages use provider hex IDs; deterministic UI ids never presented as API numeric ids.
    stills=re.findall(r'src="https://media.themoviedb.org/t/p/[^/]+/([^"/]+)"',b)
    eps.append(dict(id=ident*10000+season*100+number,season=season,number=number,title=title,overview=clean(get(b,r'<div class="overview">\s*<p>(.*?)</p>')),runtime=minutes(clean(get(b,r'<span class="runtime">(.*?)</span>'))),still=None))
   episodes[f'{ident}:{season}']=eps;sources.append(url)
  except Exception as e:print('FAILED SEASON',url,str(e))
(root/'src/catalog/demo-episodes.json').write_text(json.dumps(episodes,ensure_ascii=False,indent=2))
(root/'src/catalog/SOURCES.md').write_text('# Genuine demo catalog provenance\n\nCaptured public TMDB title and season records on 2026-10-13 for this noncommercial local concept. The app uses the documented authenticated API in live mode. No private key or access restriction was used. Poster/backdrop paths and titles are from these pages; ratings deliberately omitted because public charts round vote averages. Missing metadata remains absent. Demo episode IDs are deterministic local identifiers; episode names, descriptions and durations are genuine. Demo is a curated snapshot, not current popularity.\n\n'+'\n'.join('- '+u for u in sources)+'\n\nTMDB terms: https://www.themoviedb.org/api-terms-of-use ; attribution: https://developer.themoviedb.org/docs/faq\n')
