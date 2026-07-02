const fs = require('fs')
const path = require('path')
const { app } = require('electron')
const { getStore } = require('./storeHelper')

const REPO_API_URL = 'https://api.github.com/repos/hrl-code/MiraVault/releases/latest'
const CHANGELOG_NAME = 'CHANGELOG.md'

function getCurrentVersion() {
  return app.getVersion()
}

function getChangelogPath() {
  return path.join(app.getAppPath(), CHANGELOG_NAME)
}

function compareVersions(left, right) {
  const a = String(left || '0').replace(/^v/i, '').split(/[.-]/).map((part) => Number(part) || 0)
  const b = String(right || '0').replace(/^v/i, '').split(/[.-]/).map((part) => Number(part) || 0)
  const length = Math.max(a.length, b.length)

  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1
    if ((a[index] || 0) < (b[index] || 0)) return -1
  }

  return 0
}

function parseVersionChangelog(version) {
  try {
    const changelogPath = getChangelogPath()
    if (!fs.existsSync(changelogPath)) return null

    const content = fs.readFileSync(changelogPath, 'utf8')
    const escapedVersion = String(version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const versionRegex = new RegExp(`## \\[${escapedVersion}\\][\\s\\S]*?(?=\\n## \\[|$)`, 'i')
    const match = content.match(versionRegex)
    if (!match) return null

    const section = match[0]
    const title = `Novedades de MiraVault ${version}`
    const highlights = []

    section.split('\n').forEach((line) => {
      const item = line.match(/^- (.+)$/)
      if (item && highlights.length < 7) highlights.push(item[1].trim())
    })

    return {
      title,
      highlights,
      raw: section.trim()
    }
  } catch {
    return null
  }
}

async function getVersionNotice() {
  const version = getCurrentVersion()
  const store = await getStore()
  const seenKey = `versionNoticeSeen.${version}`

  if (store.get(seenKey, false)) {
    return { show: false, version }
  }

  const changelog = parseVersionChangelog(version)

  return {
    show: true,
    version,
    title: changelog?.title || `MiraVault ${version}`,
    highlights: changelog?.highlights?.length ? changelog.highlights : [
      'Nueva version instalada correctamente.',
      'Se han aplicado mejoras de estabilidad y pulido general.'
    ],
    extra: 'Consejo: revisa Ajustes despues de actualizar si has cambiado rutas, reproductor o fuentes de contenido.',
    raw: changelog?.raw || ''
  }
}

async function markVersionNoticeSeen(version = getCurrentVersion()) {
  const store = await getStore()
  store.set(`versionNoticeSeen.${version}`, true)
  return true
}

async function checkForUpdates() {
  const currentVersion = getCurrentVersion()
  const store = await getStore()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 7000)

  try {
    const response = await fetch(REPO_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `MiraVault/${currentVersion}`
      },
      signal: controller.signal
    })

    if (!response.ok) {
      return { ok: false, currentVersion, error: `GitHub respondio ${response.status}` }
    }

    const release = await response.json()
    const latestVersion = String(release.tag_name || '').replace(/^v/i, '')
    const installerAsset = Array.isArray(release.assets)
      ? release.assets.find((asset) => /setup.*\.exe$/i.test(asset.name || '')) || release.assets[0]
      : null
    const isNewer = latestVersion ? compareVersions(currentVersion, latestVersion) < 0 : false
    const dismissedVersion = store.get('dismissedUpdateVersion', '')

    return {
      ok: true,
      hasUpdate: isNewer && dismissedVersion !== latestVersion,
      dismissed: isNewer && dismissedVersion === latestVersion,
      currentVersion,
      latestVersion,
      name: release.name || release.tag_name || '',
      body: release.body || '',
      url: release.html_url || 'https://github.com/hrl-code/MiraVault/releases',
      assetUrl: installerAsset?.browser_download_url || release.html_url || 'https://github.com/hrl-code/MiraVault/releases'
    }
  } catch (error) {
    return {
      ok: false,
      currentVersion,
      error: error.name === 'AbortError' ? 'La comprobacion de actualizaciones tardo demasiado.' : (error.message || 'No se pudo comprobar GitHub.')
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function dismissUpdateVersion(version) {
  if (!version) return false
  const store = await getStore()
  store.set('dismissedUpdateVersion', String(version))
  return true
}

module.exports = {
  checkForUpdates,
  compareVersions,
  dismissUpdateVersion,
  getVersionNotice,
  markVersionNoticeSeen
}
