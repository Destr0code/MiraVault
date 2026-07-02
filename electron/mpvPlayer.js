const fs = require('fs')
const path = require('path')
const net = require('net')
const http = require('http')
const { spawn } = require('child_process')
const { app } = require('electron')
const { getStore } = require('./storeHelper')
const { updateProgress, markWatched } = require('./tracker')
const { resolveSubtitle } = require('./subtitles')

let session = null

async function getVlcPath() {
  const store = await getStore()
  const configuredPath = store.get('playerPath', '')
  const configuredName = String(store.get('playerName', '') || '').toLowerCase()
  const configuredBase = path.basename(configuredPath || '').toLowerCase()

  if (configuredPath && fs.existsSync(configuredPath) && (configuredBase.includes('vlc') || configuredName.includes('vlc'))) {
    return configuredPath
  }

  const systemPath = 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe'
  if (fs.existsSync(systemPath)) return systemPath

  return ''
}

// Backward-compatible export name used by main.js/status UI.
const getMpvPath = getVlcPath

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

function vlcRequest(targetSession, command, params = {}) {
  const query = new URLSearchParams(params)
  if (command) query.set('command', command)
  const pathName = `/requests/status.json${query.toString() ? `?${query.toString()}` : ''}`
  const auth = Buffer.from(`:${targetSession.password}`).toString('base64')

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: targetSession.port,
      path: pathName,
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`
      },
      timeout: 2500
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`VLC HTTP ${res.statusCode}`))
          return
        }

        try {
          resolve(body ? JSON.parse(body) : {})
        } catch (error) {
          reject(error)
        }
      })
    })

    req.on('timeout', () => {
      req.destroy(new Error('VLC no respondio a tiempo.'))
    })
    req.on('error', reject)
    req.end()
  })
}

async function waitForVlc(targetSession, timeoutMs = 7000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await vlcRequest(targetSession)
      return true
    } catch {
      await delay(180)
    }
  }
  throw new Error('No se pudo conectar con VLC.')
}

async function saveSnapshotFor(targetSession, forceWatched = false) {
  if (!targetSession?.progressKey || !targetSession.last) return

  const { currentTime, duration } = targetSession.last
  const nearEnd = duration > 0 && currentTime >= duration - 60
  let result

  if (forceWatched || (nearEnd && duration > 90)) {
    result = await markWatched(targetSession.progressKey)
  } else {
    result = await updateProgress(targetSession.progressKey, {
      watched: false,
      currentTime: Math.floor(currentTime || 0),
      duration: Math.floor(duration || 0)
    })
  }

  targetSession.notifyWindow?.webContents?.send('watch:progressChanged', {
    key: targetSession.progressKey,
    progress: result
  })
}

async function saveSnapshot(forceWatched = false) {
  return saveSnapshotFor(session, forceWatched)
}

async function stopTrackedPlayback() {
  const current = session
  session = null

  if (!current) return true
  if (current.interval) clearInterval(current.interval)
  await saveSnapshotFor(current, false).catch(() => {})

  try {
    await vlcRequest(current, 'pl_stop')
  } catch {
    // VLC may already be closed.
  }

  if (current.process && !current.process.killed) current.process.kill()
  return true
}

async function openTrackedPlayback(payload = {}, notifyWindow = null) {
  const vlcPath = await getVlcPath()
  if (!vlcPath) {
    return {
      ok: false,
      fallback: true,
      error: 'VLC no esta configurado. Instala VLC o seleccionalo en Ajustes.'
    }
  }

  const filePath = payload.filePath || ''
  const progressKey = payload.progressKey || ''
  if (!filePath || !progressKey) return { ok: false, error: 'Falta archivo o clave de progreso.' }

  await stopTrackedPlayback()

  const port = await getFreePort()
  const password = `miravault-${process.pid}-${Date.now()}`
  const startTime = Math.max(0, Math.floor(Number(payload.startTime) || 0))
  const subtitleResult = await resolveSubtitle(payload).catch((error) => ({ ok: false, error: error.message, subtitle: null }))
  const args = [
    '--extraintf=http',
    '--http-host=127.0.0.1',
    `--http-port=${port}`,
    `--http-password=${password}`,
    '--no-qt-privacy-ask',
    '--no-qt-updates-notif',
    '--play-and-exit',
    '--started-from-file'
  ]

  if (startTime > 0) args.push(`--start-time=${startTime}`)
  if (subtitleResult?.subtitle?.path && fs.existsSync(subtitleResult.subtitle.path)) {
    args.push(`--sub-file=${subtitleResult.subtitle.path}`)
  }
  args.push(filePath)

  let child
  const initialSession = { port, password }

  try {
    child = spawn(vlcPath, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: false
    })

    child.unref()
    await waitForVlc(initialSession)
  } catch (error) {
    if (child && !child.killed) child.kill()
    return { ok: false, fallback: true, error: error.message }
  }

  session = {
    process: child,
    port,
    password,
    progressKey,
    payload,
    notifyWindow,
    last: { currentTime: startTime, duration: 0 },
    interval: null
  }

  session.interval = setInterval(async () => {
    try {
      const status = await vlcRequest(session)
      session.last = {
        currentTime: Number(status.time) || 0,
        duration: Number(status.length) || 0
      }
      await saveSnapshot(false)
    } catch {
      // VLC may be closing; final snapshot is handled by exit/close.
    }
  }, 1500)

  child.once('exit', async () => {
    if (session?.process === child) {
      if (session.interval) clearInterval(session.interval)
      await delay(50)
      await saveSnapshot(false).catch(() => {})
      session = null
    }
  })

  if (app?.on) {
    app.once('before-quit', () => {
      stopTrackedPlayback().catch(() => {})
    })
  }

  return {
    ok: true,
    mode: 'vlc-external',
    executable: vlcPath,
    subtitle: subtitleResult?.subtitle || null,
    subtitleError: subtitleResult?.ok === false ? subtitleResult.error : ''
  }
}

async function commandTrackedPlayback(action, value) {
  if (!session) return { ok: false, error: 'VLC no esta activo.' }

  try {
    if (action === 'togglePause') await vlcRequest(session, 'pl_pause')
    else if (action === 'pause') await vlcRequest(session, 'pl_forcepause')
    else if (action === 'resume') await vlcRequest(session, 'pl_forceresume')
    else if (action === 'seekRelative') {
      const amount = Number(value) || 0
      await vlcRequest(session, 'seek', { val: amount > 0 ? `+${amount}` : String(amount) })
    } else if (action === 'quit') {
      const current = session
      session = null
      if (current.interval) clearInterval(current.interval)
      await saveSnapshotFor(current, false).catch(() => {})
      await vlcRequest(current, 'pl_stop')
      if (current.process && !current.process.killed) current.process.kill()
    } else {
      return { ok: false, error: 'Comando VLC no soportado.' }
    }

    return { ok: true, last: session?.last || null }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

module.exports = {
  openTrackedPlayback,
  stopTrackedPlayback,
  commandTrackedPlayback,
  getMpvPath,
  getVlcPath
}
