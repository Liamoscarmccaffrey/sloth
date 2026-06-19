// Audience server for SLOTH's Present mode.
//
// SLOTH spawns this (node present-server.js) inside the Pod. It serves a single
// audience page that shows the current slide, and pushes slide changes over an
// SSE stream so the audience view follows the presenter live. Calling listen()
// makes BrowserPod fire onPortal on the page, which opens the audience URL in
// the side panel.
//
// State lives in two files in the same directory, written by SLOTH:
//   present-slides.json : { clean: [html,...], terminal: [html,...] }  (once)
//   present-state.json  : { index: <n>, style: 'clean'|'terminal', rev: <n> }
//
// The server watches present-state.json and pushes {index, style} on change.
// No third-party dependencies: only Node's http/fs.

var http = require('http')
var fs = require('fs')
var path = require('path')

var dir = process.cwd()
var SLIDES = path.join(dir, 'present-slides.json')
var STATE = path.join(dir, 'present-state.json')
var PORT = parseInt(process.env.SLOTH_PRESENT_PORT || '8088', 10)

function readJson (p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch (e) { return fallback }
}

function currentState () {
  return readJson(STATE, { index: 0, style: 'clean', rev: 0 })
}

var clients = [] // open SSE responses

function broadcast () {
  var st = currentState()
  var payload = 'data: ' + JSON.stringify(st) + '\n\n'
  clients.forEach(function (res) { try { res.write(payload) } catch (e) {} })
}

// Watch the state file; on any change, push to all SSE clients. fs.watch can be
// flaky across platforms, so also poll the rev as a backstop.
var lastRev = -1
function checkState () {
  var st = currentState()
  if (st.rev !== lastRev) { lastRev = st.rev; broadcast() }
}
try { fs.watch(dir, function (ev, name) { if (name === 'present-state.json') checkState() }) } catch (e) {}
setInterval(checkState, 500)

var PAGE = function () {
  var slides = readJson(SLIDES, { clean: [], terminal: [] })
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>SLOTH</title>' +
    '<style>' +
    'html,body{margin:0;height:100%;background:#111;color:#eee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;}' +
    '#wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:5vmin;box-sizing:border-box;}' +
    '.slide{max-width:1100px;width:100%;}' +
    '.slide h1{font-size:clamp(2rem,7vw,5rem);margin:0 0 .4em;}' +
    '.slide h2{font-size:clamp(1.5rem,5vw,3.2rem);margin:0 0 .5em;}' +
    '.slide p,.slide li{font-size:clamp(1.1rem,2.6vw,2rem);line-height:1.5;}' +
    '.slide pre{background:#000;padding:1em;border-radius:.4em;overflow:auto;font-size:clamp(.9rem,2vw,1.4rem);}' +
    '.slide blockquote{border-left:.3em solid #555;margin:0;padding-left:.8em;color:#bbb;font-style:italic;}' +
    '.slide.center{text-align:center;}' +
    '.term{white-space:pre;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:clamp(.7rem,1.6vw,1.2rem);line-height:1.1;}' +
    '#count{position:fixed;bottom:1rem;right:1.2rem;color:#666;font-size:.9rem;}' +
    '</style></head><body>' +
    '<div id="wrap"><div id="slide" class="slide"></div></div>' +
    '<div id="count"></div>' +
    '<script>' +
    'var SLIDES=' + JSON.stringify(slides) + ';' +
    'var el=document.getElementById("slide");var cnt=document.getElementById("count");' +
    'function render(st){var set=SLIDES[st.style]||SLIDES.clean||[];' +
    'var html=set[st.index]||"";el.className="slide"+(st.style==="terminal"?" ":"");' +
    'if(st.style==="terminal"){el.innerHTML=\'<div class="term">\'+html+\'</div>\';}else{el.innerHTML=html;}' +
    'cnt.textContent=(st.index+1)+" / "+set.length;}' +
    'var lastRev=-1;' +
    'function apply(st){if(st&&st.rev!==lastRev){lastRev=st.rev;render(st);}}' +
    // SSE for instant updates when the portal proxy passes the stream through,
    'try{var es=new EventSource("/events");es.onmessage=function(e){try{apply(JSON.parse(e.data));}catch(_){}};}catch(_){}' +
    // plus a polling fallback so it updates even if the proxy buffers SSE.
    'function poll(){fetch("/state?t="+Date.now(),{cache:"no-store"}).then(function(r){return r.json();}).then(apply).catch(function(){});}' +
    'poll();setInterval(poll,500);' +
    '</script></body></html>'
}

var server = http.createServer(function (req, res) {
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write('retry: 1000\n\n')
    res.write('data: ' + JSON.stringify(currentState()) + '\n\n')
    clients.push(res)
    req.on('close', function () {
      var i = clients.indexOf(res)
      if (i !== -1) clients.splice(i, 1)
    })
    return
  }
  if (req.url.indexOf('/state') === 0) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    })
    res.end(JSON.stringify(currentState()))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(PAGE())
})

server.listen(PORT, function () {
  console.log('audience server on ' + PORT)
})
