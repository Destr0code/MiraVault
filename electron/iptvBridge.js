const fs = require('fs')
const path = require('path')
const http = require('http')
const { spawn, spawnSync } = require('child_process')
const { app } = require('electron')
const { getVlcPath } = require('./mpvPlayer')

let activeBridge = null
let lastDebug = null
let activeStartPromise = null
let activeStartUrl = ''

function debugEnabled() {
  return process.env.MIRAVAULT_IPTV_DEBUG === '1'
}

function nowIso() {
  return new Date().toISOString()
}

function pushDebug(message, data = null) {
  const line = `[iptv-bridge ${nowIso()}] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`
  if (!lastDebug) lastDebug = { lines: [] }
  lastDebug.lines.push(line)
  lastDebug.lines = lastDebug.lines.slice(-400)
  if (debugEnabled()) console.log(line)
}

function buildErrorMessage(error, details) {
  const text = `${error?.message || ''}\n${details || ''}`.toLowerCase()
  if (text.includes('option not found')) return 'FFmpeg no reconoce una opcion usada por el bridge IPTV. Revisa la version de FFmpeg instalada.'
  if (text.includes('immediate exit requested') || text.includes('exiting')) return 'El proceso del bridge IPTV se cerro antes de generar video.'
  if (text.includes('could not find codec') || text.includes('unknown decoder')) return 'El codec del canal no se puede convertir con el FFmpeg instalado.'
  if (text.includes('non-existing pps') || text.includes('corrupt decoded frame')) return 'El canal llega con video H.264 incompleto o corrupto. Se ha intentado recuperar, pero no se pudo generar HLS estable.'
  return error?.message || 'No se pudo preparar el bridge IPTV.'
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isBridgeUrl(value) {
  return /^(rtp|udp|rtsp):\/\//i.test(String(value || '').trim())
}

function safeRemove(targetPath) {
  if (debugEnabled()) {
    pushDebug('keeping temp output for debug', { targetPath })
    return
  }
  try {
    if (targetPath && fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true })
  } catch {
    // Temp cleanup is best-effort.
  }
}

function findExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue
    if (fs.existsSync(candidate)) return candidate
    const result = spawnSync('where.exe', [candidate], { encoding: 'utf8', windowsHide: true })
    const found = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    if (found && fs.existsSync(found)) return found
  }
  return ''
}

function getFfmpegPath() {
  return findExecutable([
    'ffmpeg.exe',
    'ffmpeg',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(process.env.USERPROFILE || '', 'scoop', 'shims', 'ffmpeg.exe')
  ])
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.m3u8') return 'application/vnd.apple.mpegurl'
  if (ext === '.ts') return 'video/mp2t'
  return 'application/octet-stream'
}

function startStaticServer(rootPath) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
      const relativePath = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, '')) || 'index.m3u8'
      const fullPath = path.resolve(rootPath, relativePath)

      if (!fullPath.startsWith(path.resolve(rootPath))) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }

      fs.readFile(fullPath, (error, data) => {
        if (error) {
          res.writeHead(404, {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store'
          })
          res.end('Not found')
          return
        }

        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'Content-Type': contentTypeFor(fullPath)
        })
        res.end(data)
      })
    })

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port })
    })
  })
}

async function waitForPlaylist(indexPath, outputDir, timeoutMs = 180000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, 'utf8')
      const segmentCount = fs.readdirSync(outputDir).filter((fileName) => /^segment-\d+\.ts$/i.test(fileName)).length
      if (content.includes('#EXTM3U') && content.includes('.ts') && segmentCount >= 3) return true
    }
    await delay(350)
  }
  throw new Error('No se pudo preparar el canal IPTV en 3 minutos. Puede que el stream no emita video, que la red multicast no llegue bien o que FFmpeg/VLC no pueda convertirlo.')
}

async function stopBridge(options = {}) {
  const { clearPending = true } = options
  if (clearPending) {
    activeStartPromise = null
    activeStartUrl = ''
  }
  const bridge = activeBridge
  activeBridge = null
  if (!bridge) return { ok: true }
  pushDebug('stopping bridge', { engine: bridge.engine, inputUrl: bridge.inputUrl, outputDir: bridge.outputDir })

  try {
    bridge.server?.close?.()
  } catch {
    // Ignore server close races.
  }

  try {
    if (bridge.process && !bridge.process.killed) bridge.process.kill()
  } catch {
    // Ignore process close races.
  }

  try {
    bridge.logStream?.end?.()
  } catch {
    // Ignore log close races.
  }

  safeRemove(bridge.outputDir)
  return { ok: true }
}

async function startBridge(url) {
  const inputUrl = String(url || '').trim()
  if (activeStartPromise && activeStartUrl === inputUrl) {
    pushDebug('reusing pending bridge start', { inputUrl })
    return activeStartPromise
  }

  if (activeBridge?.inputUrl === inputUrl && activeBridge?.hlsUrl && activeBridge?.ready) {
    pushDebug('reusing active bridge', { inputUrl, hlsUrl: activeBridge.hlsUrl, engine: activeBridge.engine })
    return {
      ok: true,
      hlsUrl: activeBridge.hlsUrl,
      inputUrl,
      engine: activeBridge.engine,
      outputDir: activeBridge.outputDir,
      logPath: activeBridge.logPath
    }
  }

  activeStartUrl = inputUrl
  activeStartPromise = startBridgeInternal(inputUrl).finally(() => {
    activeStartPromise = null
    activeStartUrl = ''
  })
  return activeStartPromise
}

async function startBridgeInternal(inputUrl) {
  lastDebug = { lines: [], startedAt: Date.now(), inputUrl }
  pushDebug('start requested', { inputUrl })
  if (!isBridgeUrl(inputUrl)) return { ok: false, error: 'Este canal no necesita bridge IPTV.' }

  const ffmpegPath = getFfmpegPath()
  const vlcPath = await getVlcPath()
  pushDebug('executables detected', { ffmpegPath, vlcPath })
  if (!ffmpegPath && !vlcPath) return { ok: false, error: 'No se encontro FFmpeg ni VLC para preparar el bridge IPTV.' }

  await stopBridge({ clearPending: false })

  const baseTemp = app?.getPath ? app.getPath('temp') : process.cwd()
  const outputDir = fs.mkdtempSync(path.join(baseTemp, 'miravault-iptv-'))
  const indexPath = path.join(outputDir, 'index.m3u8')
  const segmentPattern = path.join(outputDir, 'segment-########.ts')
  const vlcIndexPath = indexPath.replace(/\\/g, '/')
  const vlcSegmentPattern = segmentPattern.replace(/\\/g, '/')
  const { server, port } = await startStaticServer(outputDir)
  const hlsUrl = `http://127.0.0.1:${port}/index.m3u8`
  const logPath = path.join(outputDir, 'bridge.log')
  const logStream = fs.createWriteStream(logPath, { flags: 'a' })
  pushDebug('output prepared', { outputDir, indexPath, hlsUrl, logPath })

  const engine = ffmpegPath ? 'ffmpeg' : 'vlc'
  const executable = ffmpegPath || vlcPath
  const args = ffmpegPath
    ? [
      '-hide_banner',
      '-loglevel',
      debugEnabled() ? 'verbose' : 'warning',
      ...(debugEnabled() ? ['-stats'] : ['-nostats']),
      '-fflags',
      '+genpts+discardcorrupt',
      '-i',
      inputUrl,
      '-map',
      '0:v:0?',
      '-map',
      '0:a:0?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'zerolatency',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '25',
      '-g',
      '50',
      '-sc_threshold',
      '0',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
      '-f',
      'hls',
      '-hls_time',
      '2',
      '-hls_list_size',
      '6',
      '-hls_flags',
      'delete_segments+append_list+omit_endlist',
      '-hls_segment_filename',
      path.join(outputDir, 'segment-%08d.ts'),
      indexPath
    ]
    : [
      '-I',
      'dummy',
      '--dummy-quiet',
      '--no-video-title-show',
      '--no-qt-privacy-ask',
      '--no-qt-updates-notif',
      '--avcodec-hw=none',
      '--network-caching=3000',
      '--live-caching=3000',
      '--sout',
      `#transcode{vcodec=h264,vb=2500,acodec=mp4a,ab=128,channels=2,samplerate=44100,scodec=none}:std{access=livehttp{seglen=2,delsegs=true,numsegs=6,index=${vlcIndexPath},index-url=segment-########.ts},mux=ts{use-key-frames},dst=${vlcSegmentPattern}}`,
      '--sout-keep',
      inputUrl
    ]
  pushDebug('spawning bridge process', { engine, executable, args })

  const child = spawn(executable, args, {
    detached: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString()
    logStream.write(text)
    for (const line of text.split(/\r?\n/).filter(Boolean)) pushDebug(`stdout ${line}`)
  })
  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString()
    logStream.write(text)
    for (const line of text.split(/\r?\n/).filter(Boolean)) pushDebug(`stderr ${line}`)
  })
  child.once('error', (error) => {
    pushDebug('bridge process error', { message: error.message })
  })

  activeBridge = {
    process: child,
    server,
    outputDir,
    inputUrl,
    hlsUrl,
    engine,
    logPath,
    logStream,
    ready: false
  }

  child.once('exit', () => {
    pushDebug('bridge process exited', { engine, inputUrl })
    if (activeBridge?.process === child) {
      const bridge = activeBridge
      activeBridge = null
      try {
        bridge.server?.close?.()
      } catch {
        // Ignore server close races.
      }
      try {
        bridge.logStream?.end?.()
      } catch {
        // Ignore log close races.
      }
      safeRemove(bridge.outputDir)
    }
  })

  try {
    await waitForPlaylist(indexPath, outputDir)
    if (activeBridge?.process === child) activeBridge.ready = true
    pushDebug('playlist ready', {
      indexPath,
      files: fs.readdirSync(outputDir).slice(0, 20)
    })
    return { ok: true, hlsUrl, inputUrl, engine, outputDir, logPath }
  } catch (error) {
    const details = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(-2000) : ''
    const message = buildErrorMessage(error, details)
    pushDebug('bridge failed', {
      message: error.message,
      outputDir,
      logPath,
      files: fs.existsSync(outputDir) ? fs.readdirSync(outputDir).slice(0, 20) : []
    })
    await stopBridge()
    return { ok: false, error: message, details, outputDir, logPath, debug: lastDebug }
  }
}

function getDebug() {
  const bridge = activeBridge
  return {
    active: Boolean(bridge),
    bridge: bridge ? {
      engine: bridge.engine,
      inputUrl: bridge.inputUrl,
      hlsUrl: bridge.hlsUrl,
      outputDir: bridge.outputDir,
      logPath: bridge.logPath
    } : null,
    debug: lastDebug
  }
}

module.exports = {
  isBridgeUrl,
  startBridge,
  stopBridge,
  getDebug
}
