const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Ventana
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),

  // Dialogos
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  selectMediaFiles: () => ipcRenderer.invoke('dialog:selectMediaFiles'),
  selectTorrentFiles: () => ipcRenderer.invoke('dialog:selectTorrentFiles'),
  openFolder: (p) => ipcRenderer.invoke('shell:openFolder', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  trashPath: (p) => ipcRenderer.invoke('media:trashPath', p),
  iptvFetchPlaylist: (url) => ipcRenderer.invoke('iptv:fetchPlaylist', url),
  iptvStartBridge: (url) => ipcRenderer.invoke('iptv:startBridge', url),
  iptvStopBridge: () => ipcRenderer.invoke('iptv:stopBridge'),
  iptvGetBridgeDebug: () => ipcRenderer.invoke('iptv:getBridgeDebug'),

  // Config
  getTheme: () => ipcRenderer.invoke('config:getTheme'),
  setTheme: (v) => ipcRenderer.invoke('config:setTheme', v),

  // Biblioteca local
  libraryList: () => ipcRenderer.invoke('library:list'),
  libraryGetItem: (id) => ipcRenderer.invoke('library:getItem', id),
  libraryGetSources: () => ipcRenderer.invoke('library:getSources'),
  libraryGetStats: () => ipcRenderer.invoke('library:getStats'),
  libraryImportPaths: (paths) => ipcRenderer.invoke('library:importPaths', paths),
  libraryRescan: () => ipcRenderer.invoke('library:rescan'),
  libraryRemoveItem: (id) => ipcRenderer.invoke('library:removeItem', id),
  libraryRemoveSource: (sourcePath) => ipcRenderer.invoke('library:removeSource', sourcePath),
  libraryClear: () => ipcRenderer.invoke('library:clear'),
  libraryUpdateMetadataOverride: (id, data) => ipcRenderer.invoke('library:updateMetadataOverride', { id, data }),
  libraryClearMetadataOverride: (id) => ipcRenderer.invoke('library:clearMetadataOverride', id),
  librarySearchMetadataOptions: (id) => ipcRenderer.invoke('library:searchMetadataOptions', id),
  libraryPreviewOrganizeSeriesFolder: (rootPath) => ipcRenderer.invoke('library:previewOrganizeSeriesFolder', rootPath),
  libraryOrganizeSeriesFolder: (rootPath) => ipcRenderer.invoke('library:organizeSeriesFolder', rootPath),

  // Progreso de visualizacion
  getWatchProgress: () => ipcRenderer.invoke('watch:getAll'),
  getProgress: (key) => ipcRenderer.invoke('watch:getProgress', key),
  updateWatchProgress: (key, data) => ipcRenderer.invoke('watch:update', { key, data }),
  markWatched: (key) => ipcRenderer.invoke('watch:markWatched', key),
  markUnwatched: (key) => ipcRenderer.invoke('watch:markUnwatched', key),
  clearWatchProgress: () => ipcRenderer.invoke('watch:clearAll'),
  onWatchProgressChanged: (callback) => {
    const listener = (_, payload) => callback(payload)
    ipcRenderer.on('watch:progressChanged', listener)
    return () => ipcRenderer.removeListener('watch:progressChanged', listener)
  },

  // Player
  playerOpen: (filePath, startTime, payload) => ipcRenderer.invoke('player:open', filePath, startTime, payload),
  subtitlesList: (payload) => ipcRenderer.invoke('subtitles:list', payload),
  subtitlesResolve: (payload) => ipcRenderer.invoke('subtitles:resolve', payload),
  episodeMetadata: (payload) => ipcRenderer.invoke('episode:metadata', payload),
  playerOpenTracked: (payload) => ipcRenderer.invoke('player:openTracked', payload),
  playerStopTracked: () => ipcRenderer.invoke('player:stopTracked'),
  playerCommandTracked: (payload) => ipcRenderer.invoke('player:commandTracked', payload),
  playerGetTrackedStatus: () => ipcRenderer.invoke('player:getTrackedStatus'),
  playerFindFile: (opts) => ipcRenderer.invoke('player:findFile', opts),
  playerSelectExe: () => ipcRenderer.invoke('player:selectExe'),
  playerGetConfig: () => ipcRenderer.invoke('player:getConfig'),
  playerSaveConfig: (cfg) => ipcRenderer.invoke('player:saveConfig', cfg),

  // Motor torrent generico
  torrentGetConfig: () => ipcRenderer.invoke('torrent:getConfig'),
  torrentSetConfig: (config) => ipcRenderer.invoke('torrent:setConfig', config),
  torrentEngineStatus: () => ipcRenderer.invoke('torrent:engineStatus'),
  torrentPing: () => ipcRenderer.invoke('torrent:ping'),
  torrentList: (filter) => ipcRenderer.invoke('torrent:list', filter),
  torrentTransferInfo: () => ipcRenderer.invoke('torrent:transferInfo'),
  torrentAdd: (payload) => ipcRenderer.invoke('torrent:add', payload),
  torrentPause: (id) => ipcRenderer.invoke('torrent:pause', id),
  torrentResume: (id) => ipcRenderer.invoke('torrent:resume', id),
  torrentDelete: (payload) => ipcRenderer.invoke('torrent:delete', payload),
  torrentOpenContent: (torrent) => ipcRenderer.invoke('torrent:openContent', torrent),
  torrentImportContent: (torrent) => ipcRenderer.invoke('torrent:importContent', torrent),

  // qBittorrent externo (compatibilidad)
  qbittorrentGetConfig: () => ipcRenderer.invoke('qbittorrent:getConfig'),
  qbittorrentSetConfig: (config) => ipcRenderer.invoke('qbittorrent:setConfig', config),
  qbittorrentEngineStatus: () => ipcRenderer.invoke('qbittorrent:engineStatus'),
  qbittorrentStartManaged: () => ipcRenderer.invoke('qbittorrent:startManaged'),
  qbittorrentStopManaged: () => ipcRenderer.invoke('qbittorrent:stopManaged'),
  qbittorrentPing: () => ipcRenderer.invoke('qbittorrent:ping'),
  qbittorrentList: (filter) => ipcRenderer.invoke('qbittorrent:list', filter),
  qbittorrentTransferInfo: () => ipcRenderer.invoke('qbittorrent:transferInfo'),
  qbittorrentAdd: (payload) => ipcRenderer.invoke('qbittorrent:add', payload),
  qbittorrentPause: (hash) => ipcRenderer.invoke('qbittorrent:pause', hash),
  qbittorrentResume: (hash) => ipcRenderer.invoke('qbittorrent:resume', hash),
  qbittorrentDelete: (payload) => ipcRenderer.invoke('qbittorrent:delete', payload),
  qbittorrentOpenContent: (torrent) => ipcRenderer.invoke('qbittorrent:openContent', torrent),
  qbittorrentImportContent: (torrent) => ipcRenderer.invoke('qbittorrent:importContent', torrent),
})
