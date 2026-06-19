import { BrowserPod } from '@leaningtech/browserpod'
import { buildZip } from './zip.js'

// SLOTH's source lives one level up (sloth/), not on npm, so we ship it into
// the Pod rather than installing it. Vite's `?raw` suffix inlines each file's
// text at build time, keeping the source on disk authoritative.
import slothJs from '../sloth.js?raw'
import wrapJs from '../lib/wrap.js?raw'
import themesJs from '../lib/themes.js?raw'
import bigHeadersJs from '../lib/big-headers.js?raw'
import graphJs from '../lib/graph.js?raw'
import editorJs from '../lib/editor.js?raw'
import controlsJs from '../lib/controls.js?raw'
import slideHtmlJs from '../lib/slide-html.js?raw'
import presentServerJs from '../lib/present-server.js?raw'
import projectJs from '../lib/project.js?raw'
import goghThemesJs from '../lib/gogh-themes.js?raw'

// Two linked demo decks so wikilinks and the graph have real edges.
import introMd from '../decks/intro.md?raw'
import featuresMd from '../decks/features.md?raw'

// The sloth ASCII art shown as the home-screen header.
import asciiArt from '../ascii-art.txt?raw'

// SLOTH's runtime dependency tree, pre-built into ../pod-modules by
// scripts/build-pod-modules.mjs. Globbing it as raw text lets us write a ready
// node_modules into the Pod, so there is no `npm install` step and no runtime
// dependency on the npm registry. Keys look like '../pod-modules/charm/...';
// values are { default: '<file text>' }.
const POD_MODULES = import.meta.glob('../pod-modules/**/*', {
  query: '?raw',
  import: 'default',
  eager: true
})

// A minimal package.json so `node sloth.js` has a project root. No deps here:
// they are shipped directly as node_modules below.
const PKG = {
  name: 'sloth-pod',
  version: '2.0.0',
  private: true,
  bin: { sloth: './sloth.js' }
}

// A starter theme.json so the configurator (`c` in the app) has something to
// edit and persist. It overrides the built-in "default" and adds a custom one.
const THEME_JSON = {
  default: {
    heading: 'cyan', accent: 'yellow', link: 'blue', code: 'green',
    quote: 'magenta', bar: 'inverse', dim: 'grey', big: 'cyan'
  },
  ocean: {
    heading: 'blue', accent: 'cyan', link: 'cyan', code: 'green',
    quote: 'blue', bar: 'inverse', dim: 'grey', big: 'blue'
  }
}

const FILES = {
  '/project/sloth.js': slothJs,
  '/project/lib/wrap.js': wrapJs,
  '/project/lib/themes.js': themesJs,
  '/project/lib/big-headers.js': bigHeadersJs,
  '/project/lib/graph.js': graphJs,
  '/project/lib/editor.js': editorJs,
  '/project/lib/controls.js': controlsJs,
  '/project/lib/slide-html.js': slideHtmlJs,
  '/project/lib/project.js': projectJs,
  '/project/lib/gogh-themes.js': goghThemesJs,
  '/project/present-server.js': presentServerJs,
  '/project/intro.md': introMd,
  '/project/features.md': featuresMd,
  '/project/sloth-art.txt': asciiArt,
  '/project/theme.json': JSON.stringify(THEME_JSON, null, 2),
  '/project/package.json': JSON.stringify(PKG, null, 2)
}

async function writeFile (pod, path, contents) {
  const f = await pod.createFile(path, 'utf-8')
  await f.write(contents)
  await f.close()
}

// Create every directory on the way to a file path (BrowserPod's createFile
// does not create missing parents). Tracks what it has made so each dir is
// only created once across many files.
const madeDirs = new Set(['/project'])
async function ensureDir (pod, dir) {
  if (madeDirs.has(dir)) return
  await pod.createDirectory(dir, { recursive: true })
  madeDirs.add(dir)
}

function dirname (p) {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

// Map a glob key like '../pod-modules/charm/index.js' to its Pod destination
// '/project/node_modules/charm/index.js'. Tolerant of how different Vite
// versions spell the key (../pod-modules, /pod-modules, ./pod-modules).
function podModulePath (globKey) {
  const rel = globKey.replace(/^.*?pod-modules\//, '')
  return '/project/node_modules/' + rel
}

// A hidden file input lives in the DOM purely so we can open the browser's
// native file dialog. There is no visible upload UI on the page: uploading is
// a menu item inside SLOTH (see the onOpen handshake below).
const fileInput = document.querySelector('#file-input')

// Boot the Pod. VITE_BP_APIKEY is defined in .env.
const pod = await BrowserPod.boot({ apiKey: import.meta.env.VITE_BP_APIKEY })

// Lay down the source tree, decks, and starter theme.
await pod.createDirectory('/project/lib', { recursive: true })
for (const [path, contents] of Object.entries(FILES)) {
  await writeFile(pod, path, contents)
}

// Ship the pre-built dependency tree into /project/node_modules. This replaces
// `npm install` entirely: everything SLOTH needs is written before it runs.
for (const [globKey, contents] of Object.entries(POD_MODULES)) {
  const dest = podModulePath(globKey)
  await ensureDir(pod, dirname(dest))
  await writeFile(pod, dest, contents)
}

// Upload handshake. SLOTH's "Upload" menu item runs `xdg-open sloth:upload`
// inside the Pod; BrowserPod fires onOpen on the page with that string. We open
// the browser's native file dialog, write the chosen file into /project, and
// record its name in /project/.sloth-upload, which SLOTH polls for and opens.
const UPLOAD_SENTINEL = 'sloth:upload'
const UPLOAD_RESULT = '/project/.sloth-upload'
const DOWNLOAD_SENTINEL = 'sloth:download-starter'

pod.onOpen((urlOrPath) => {
  if (urlOrPath === UPLOAD_SENTINEL) { if (fileInput) fileInput.click(); return }
  if (urlOrPath === DOWNLOAD_SENTINEL) { downloadStarterProject(); return }
})

// The empty SLOTH project structure a user fills in, then uploads back. Folders
// carry a .gitkeep so they survive zipping; a sample deck, config, and README
// show the convention and directives.
function downloadStarterProject () {
  const README = [
    '# SLOTH project',
    '',
    'Lay out your talk in these folders, then zip and upload it to SLOTH.',
    '',
    '- content/       your .md decks (slides separated by a line of ---)',
    '- media/         images, video, audio  -> ![](media/photo.png)',
    '- attachments/   downloadable files     -> <!-- attach: attachments/notes.pdf -->',
    '- snippets/      runnable code          -> <!-- run-snippet: snippets/demo.js -->',
    '- repositories/  full apps on a portal  -> <!-- run-repo: repositories/app npm start -->',
    '- config/        sloth.json, theme.json, controls.json',
    '- data/          survey results, written locally (nothing leaves your browser)',
    '',
    'Other directives: <!-- cat: snippets/demo.js --> shows a file live on a slide.',
    'Bare names resolve against the matching folder, so ![](photo.png) finds media/photo.png.',
    ''
  ].join('\n')

  const INTRO = [
    '%title: My SLOTH deck',
    '%author: ',
    '',
    '# My deck',
    '',
    'Welcome. Replace this with your talk.',
    '',
    '---',
    '',
    '## A slide with an image',
    '',
    '![](media/example.png)',
    '',
    '---',
    '',
    '## A runnable snippet',
    '',
    '<!-- run-snippet: snippets/hello.js -->',
    '',
    'Press r while presenting to run it.',
    ''
  ].join('\n')

  const HELLO = "console.log('hello from a SLOTH snippet')\n"

  const CONFIG = JSON.stringify({ theme: 'default', notes: false }, null, 2) + '\n'

  const folders = ['content', 'media', 'attachments', 'snippets', 'repositories', 'config', 'data']
  const entries = []
  for (const f of folders) entries.push({ name: 'sloth-project/' + f + '/.gitkeep', data: '' })
  entries.push({ name: 'sloth-project/README.md', data: README })
  entries.push({ name: 'sloth-project/content/intro.md', data: INTRO })
  entries.push({ name: 'sloth-project/snippets/hello.js', data: HELLO })
  entries.push({ name: 'sloth-project/config/sloth.json', data: CONFIG })

  const blob = buildZip(entries)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'sloth-project.zip'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

if (fileInput) {
  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || [])
    fileInput.value = '' // allow re-selecting the same file later
    if (!files.length) return
    // First file is the one SLOTH will open; write all chosen files in.
    let first = null
    for (const file of files) {
      const safe = file.name.replace(/[^\w.\- ]/g, '_')
      const text = await file.text()
      await writeFile(pod, '/project/' + safe, text)
      if (!first) first = safe
    }
    // Tell SLOTH which deck to open.
    await writeFile(pod, UPLOAD_RESULT, first)
  })
}

// Portal handshake. When a runnable block starts a server inside the Pod,
// BrowserPod fires onPortal on the page with the shareable URL. We do two
// things: open the URL in a side panel (an iframe next to the terminal), and
// write it to a file SLOTH's run pane polls and displays.
const PORTAL_RESULT = '/project/.sloth-portal'
const portalPanel = document.querySelector('#portal')
const portalFrame = document.querySelector('#portal-frame')
const portalUrl = document.querySelector('#portal-url')
const portalClose = document.querySelector('#portal-close')

function openPortalPanel (url) {
  if (!portalPanel) return
  if (portalFrame) portalFrame.src = url
  if (portalUrl) { portalUrl.textContent = url; portalUrl.href = url }
  document.body.classList.add('split') // shrink the terminal to make room
}

function closePortalPanel () {
  document.body.classList.remove('split')
  if (portalFrame) portalFrame.src = 'about:blank'
}

if (portalClose) portalClose.addEventListener('click', closePortalPanel)

pod.onPortal(({ url }) => {
  openPortalPanel(url)
  writeFile(pod, PORTAL_RESULT, url)
})

// Create the visible terminal.
const terminal = await pod.createDefaultTerminal(document.querySelector('#console'))

// No install step: node_modules was written above, so SLOTH is ready to run.

// Run SLOTH as the only thing the user ever sees. It opens on its start menu.
// If it ever exits, relaunch it, so the user never falls through to a shell.
;(async () => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await pod.run('node', ['sloth.js'], {
      echo: false,
      terminal,
      cwd: '/project'
    })
  }
})()
