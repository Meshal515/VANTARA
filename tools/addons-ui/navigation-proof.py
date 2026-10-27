import functools,http.server,json,pathlib,sys,threading,time,os
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[2]/'apps/web'
OUT=pathlib.Path(os.environ.get('ADDONS_UI_EVIDENCE','addons-ui-evidence'))
OUT.mkdir(parents=True,exist_ok=True)
PHASE=sys.argv[1] if len(sys.argv)>1 else 'cycles'
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a): pass
 def do_GET(self):
  if self.path=='/__ui':
   css=['styles.css','v35/core.css','v35.css','v35/reader.css','v35/majlis.css','v35/social.css','v35/profile.css','v35/anime.css','v35/cinema.css','v35/server-sheet.css','v35/manga.css','v35/rafiq.css','v35/wide.css','v35/addons.css','v35/addons-v7.css','v35/together.css']
   body=('<html dir="rtl"><head><meta charset="utf-8">'+''.join('<link rel="stylesheet" href="/'+p+'">' for p in css)+'</head><body></body></html>').encode()
   self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(body)
  else: super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
proof={'phase':PHASE,'fixture':'actual shell.js mountV35 -> getAddonRuntime -> V7 manager -> source-mode; local anonymous sync and simulated source backend','authenticationTest':False,'sourcePlaybackTest':False,'javascriptErrors':[]}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':412,'height':915},device_scale_factor=1)
 page.on('pageerror',lambda error:proof['javascriptErrors'].append(str(error)))
 page.route('**/*',lambda route:route.continue_() if route.request.url.startswith('http://127.0.0.1:') else route.abort())
 try:
  page.goto(f'http://127.0.0.1:{server.server_port}/__ui')
  page.evaluate('''async()=>{
    window.__fixtureCalls=[];
    const addon={key:'fixture|source',name:'Fixture Source',version:'1.0.0',protocol:'remote',enabled:true,contentTypes:['manga'],capabilities:['home','search']};
    const adapter={home:async()=>{window.__fixtureCalls.push('home');return {mangas:[{id:'work-1',url:'/work-1',title:'Fixture Manga'}],hasNextPage:false}},search:async()=>({mangas:[],hasNextPage:false})};
    const addons={ready:Promise.resolve(),registry:{runtimeName:'pwa',list:()=>[addon],setProfile:()=>{},snapshot:()=>({release:()=>window.__fixtureCalls.push('release')})},adapter:()=>adapter,sources:{source:()=>adapter},reloadSources:async()=>{}};
    window.VantaraWeb={AddonFabric:{runtime:async()=>({getRuntime:()=>({addons})})}};
    const sync={user:null,rows:()=>[],row:()=>null,onChange:()=>()=>{},enqueue:()=>{},translation:async()=>({status:200,body:{rows:[]}}),latestSnapshots:async()=>({sources:[]}),presence:async()=>[],stats:async()=>({}),insights:async()=>({}),topWorks:async()=>[],pendingDevices:async()=>[],privacyCapability:async()=>({}),authorizationHeader:null};
    const {mountV35}=await import('/v35/shell.js');
    window.__proofShell=mountV35({sync,mount:node=>document.body.replaceChildren(node),go:async()=>{},friends:()=>[],presence:async()=>[],version:'browser-fixture',switchAccount:()=>{},openReader:()=>{}},{page:'home'});
  }''')
  page.wait_for_selector('#home.active')
  page.locator('[data-act="openDrawer"]').first.click()
  page.locator('.drawer-item').filter(has_text='الإضافات').click()
  page.wait_for_selector('#utility.active .v7-addon')
  page.locator('.v7-tab').filter(has_text='المثبتة').click()
  page.wait_for_selector('.v7-row')
  proof['beforeOpen']=page.locator('.v7-tab.active').inner_text()
  proof['outerBackBefore']=page.locator('#utility.active > .page-top [data-act="goBack"]:visible').count()
  proof['managerBackBefore']=page.locator('#utility.active .v7-back:visible').count()
  proof['singleOuterBack']=proof['outerBackBefore']==1 and proof['managerBackBefore']==0
  proof['utilityHeader']=page.locator('#utility.active').evaluate('(n)=>n.innerHTML.slice(0,1800)')
  page.screenshot(path=str(OUT/f'{PHASE}-installed.png'),full_page=True)
  page.locator('.v7-row .v7-simple-btn').filter(has_text='فتح').click()
  page.wait_for_selector('.addon-source .up-title')
  proof['sourceTitle']=page.locator('.addon-source .up-title').inner_text()
  page.screenshot(path=str(OUT/f'{PHASE}-source.png'),full_page=True)
  page.evaluate('window.__proofShell.handleBack()')
  page.wait_for_selector('#utility.active .v7-addon')
  proof['afterBack']=page.locator('.v7-tab.active').inner_text()
  proof['returnedToInstalled']=proof['afterBack'].strip().startswith('المثبتة')
  proof['fixtureCalls']=page.evaluate('window.__fixtureCalls')
  proof['visibleBackButtons']=page.locator('#utility.active button').evaluate_all("nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&/رجوع|الإضافات/.test(n.textContent)&&n.closest('.v7-mast,header,.utility-head,.page-head,.v35-utility-head')}).map(n=>({text:n.textContent,html:n.outerHTML}))")
  page.screenshot(path=str(OUT/f'{PHASE}-after-back.png'),full_page=True)
  if PHASE == 'cycles':
   cycle_start=time.monotonic()
   proof['cycles']=0
   proof['rootBackExitsManager']=True
   proof['observedBrowserPages']=1
   for cycle in range(1,31):
    page.evaluate('window.__proofShell.handleBack()')
    page.wait_for_selector('#home.active')
    assert page.locator('#utility.active').count()==0, 'Root back did not leave Addons'
    page.locator('[data-act="openDrawer"]').first.click()
    page.locator('.drawer-item').filter(has_text='الإضافات').click()
    page.wait_for_selector('#utility.active .v7-addon')
    assert page.locator('.v7-tab.active').inner_text().startswith('المثبتة'), 'Reopening manager lost Installed context'
    assert page.locator('#utility.active > .page-top [data-act="goBack"]:visible').count()==1, 'Missing/duplicate outer back'
    assert page.locator('#utility.active .v7-back:visible').count()==0, 'Duplicate manager back'
    page.locator('.v7-row .v7-simple-btn').filter(has_text='فتح').click()
    page.wait_for_selector('.addon-source .up-title')
    page.evaluate('window.__proofShell.handleBack()')
    page.wait_for_selector('#utility.active .v7-addon')
    assert page.locator('.v7-tab.active').inner_text().startswith('المثبتة'), 'Source back lost Installed context'
    assert len(browser.contexts[0].pages)==1, 'Unexpected browser popup'
    assert not proof['javascriptErrors'], 'Uncaught JavaScript error'
    page.wait_for_timeout(4200)
    proof['cycles']=cycle
    proof['elapsedSeconds']=round(time.monotonic()-cycle_start,2)
    if cycle%10==0: print(json.dumps({'cycle':cycle,'elapsedSeconds':proof['elapsedSeconds'],'javascriptErrors':proof['javascriptErrors']},ensure_ascii=False),flush=True)
   page.evaluate('window.__proofShell.handleBack()')
   page.wait_for_selector('#home.active')
   proof['rootBackFinalHome']=True
   proof['fixtureCalls']=page.evaluate('window.__fixtureCalls')
   proof['heapAfterCycles']=page.evaluate('performance.memory?.usedJSHeapSize ?? null')
   page.screenshot(path=str(OUT/f'{PHASE}-final-home.png'),full_page=True)
   assert proof['elapsedSeconds']>120, 'Expected more than two minutes of navigation'
  proof['passed']=proof['returnedToInstalled'] and proof['singleOuterBack'] and not proof['javascriptErrors']
 except Exception as error:
  proof['failure']=str(error);proof['passed']=False
  page.screenshot(path=str(OUT/f'{PHASE}-failure.png'),full_page=True)
 finally:
  (OUT/f'{PHASE}.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2))
  print(json.dumps(proof,ensure_ascii=False,indent=2))
  browser.close();server.shutdown()
sys.exit(0 if proof['passed'] else 1)
