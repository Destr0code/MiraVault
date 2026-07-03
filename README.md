![MiraVault](media/MiraVault_banner_logo.png)

# MiraVault

**Local-first media hub for Windows.**

MiraVault is an open-source desktop app for organizing, exploring, and watching your local media library. It helps you manage series, movies, IPTV, playback progress, metadata, subtitles, and downloads from one clean interface.

[Download for Windows](https://github.com/hrl-code/MiraVault/releases) | [Changelog](CHANGELOG.md) | [Privacy](PRIVACY.md) | [Issues](https://github.com/hrl-code/MiraVault/issues)

![Version](https://img.shields.io/badge/version-0.4.3-blue)
![Platform](https://img.shields.io/badge/platform-Windows-0b7285)
![Status](https://img.shields.io/badge/status-beta-orange)
![License](https://img.shields.io/badge/license-open--source-brightgreen)

## What Is MiraVault?

MiraVault is a personal media vault for people who keep their own files on local drives, external disks, NAS folders, or download folders.

It is designed to be **local-first**:

- No account required.
- No central user database.
- No bundled media content.
- No IPTV lists, trackers, torrents, or providers included.
- Your files, paths, watch progress, and settings stay on your machine.

> Current status: **beta**. MiraVault is usable and installable, but it is still evolving before a stable `1.0` release.

## Download

Windows installers are published on the GitHub Releases page:

**[Download the latest MiraVault release](https://github.com/hrl-code/MiraVault/releases/latest)**

Windows may show a SmartScreen warning while releases are not fully code-signed. MiraVault intends to use the **SignPath Foundation** for code signing of Windows installer releases when available.

## Features

- Visual library for local series and movies.
- Automatic watch progress and watched/unwatched status.
- Continue watching from the last saved position.
- Series organizer with season and episode detection.
- Folder cleanup preview before moving files.
- Metadata enrichment without private API keys.
- Covers, synopsis, ratings, cast, episode data, and fallback sources.
- VLC integration for robust playback of MKV, HEVC/H.265, subtitles, audio tracks, and IPTV streams.
- IPTV support from M3U/M3U8 playlists.
- Internal IPTV playback when Chromium supports the stream.
- VLC fallback for streams that need stronger codec support.
- Subtitle search and local subtitle handling.
- Torrents/downloads section with early WebTorrent support and optional qBittorrent fallback.
- Multiple visual themes.
- GitHub update notices and version changelog popup.

## Why MiraVault?

Most media apps either expect a server, an account, a cloud service, or a very specific library structure. MiraVault focuses on a simpler goal:

**Take the media files you already have and make them easier to organize, browse, play, and continue watching.**

It is not trying to replace professional media servers like Plex or Jellyfin. It is a desktop-first alternative for users who want direct control over folders, files, players, and local data.

## Quick Start

1. Install MiraVault from [Releases](https://github.com/hrl-code/MiraVault/releases/latest).
2. Open `Folders`.
3. Select your media/library folders.
4. Use the organizer preview before applying changes.
5. Open `Library` to browse detected series and movies.
6. Open an item and play it with VLC or the available internal player.

For best playback compatibility, install VLC in the default path:

```text
C:\Program Files\VideoLAN\VLC\vlc.exe
```

You can also configure a custom VLC path from the app settings.

## Library Organizer

MiraVault can scan a folder and propose changes for series organization.

It tries to detect:

- Series title.
- Season number.
- Episode number.
- Video quality.
- Language hints.
- Completed video files.
- Subtitles.
- Residual files such as `.txt` and `.url`.
- Archive files such as `.rar`, which are reported as warnings instead of being moved automatically.

The organizer is best-effort. Very unusual filenames or mixed folders can require manual cleanup.

## IPTV

MiraVault can load IPTV playlists from:

- M3U/M3U8 URLs.
- Manually pasted M3U content.

Some IPTV streams use formats, codecs, DRM, multicast protocols, or network setups that Chromium cannot play directly. In those cases, VLC is the recommended fallback.

## Torrents And Downloads

MiraVault includes an early downloads section.

The long-term goal is:

- Simple internal WebTorrent support.
- Optional qBittorrent integration for advanced users.
- User-configured external sources such as RSS, Torznab, JSON endpoints, or local folders.
- Import completed downloads into the local library.
- Keep incomplete downloads separated from the media library.

This area is still experimental and should be treated as beta functionality.

MiraVault does not ship with torrent providers or indexes. Any external source must be configured manually by the user.

## Metadata

MiraVault enriches local files using public metadata sources where possible. It does not require private API keys.

Current/fallback sources may include:

- TVmaze.
- Cinemeta/Stremio metadata.
- Wikidata/Wikipedia.
- OpenLibrary.
- OpenSubtitles/Stremio subtitle routes.

Metadata is cached locally to reduce repeated requests and improve rescans.

## Privacy

MiraVault is built around local-first usage. It does not require accounts and does not intentionally collect analytics.

Read the full policy here:

[PRIVACY.md](PRIVACY.md)

## Legal Notice

MiraVault does not provide copyrighted content, IPTV lists, torrent indexes, trackers, or media providers.

Use MiraVault only with content you own, content you created, public-domain content, or content for which you have legal access rights.

## Development

### Requirements

- Windows 10/11.
- Node.js 20 or newer.
- npm.
- VLC recommended for playback.
- Git.

### Install

```powershell
git clone https://github.com/hrl-code/MiraVault.git
cd MiraVault
npm install
```

### Run In Development

```powershell
npm run dev
```

MiraVault uses Vite on port `5173` and opens Electron automatically when the dev server is ready.

### Build Windows Installer

```powershell
npm run build:installer
```

Build output is generated in:

```text
dist-electron/
```

### GitHub Actions

The repository includes a Windows build workflow:

```text
.github/workflows/build-windows.yml
```

It can be launched manually from GitHub Actions or automatically by pushing a tag:

```powershell
git tag v0.4.4
git push origin v0.4.4
```

Tagged builds publish installer artifacts to GitHub Releases.

## Project Structure

```text
electron/        Electron main process, IPC, library, metadata, playback, IPTV, torrents
src/             React interface
src/pages/       Main application screens
src/components/  Shared UI and layout components
src/store/       Zustand stores
src/config/      Shared configuration, themes, constants
public/          Public app assets
media/           Branding assets
```

## Tech Stack

- Electron.
- React 19.
- Vite.
- Tailwind CSS.
- Zustand.
- better-sqlite3.
- electron-store.
- hls.js.
- WebTorrent.
- Electron Builder.

## Roadmap

### 0.5.x

- Improve internal WebTorrent support.
- Make torrent state, errors, and queue handling clearer.
- Improve library import for completed downloads.
- Refine the organizer preview and cleanup rules.
- Add better empty states and recovery messages.

### 0.6.x

- Improve IPTV favorites, groups, history, and fallback flows.
- Improve metadata matching for movies and series with duplicate names.
- Add more robust cover/manual metadata correction flows.
- Improve installer and release automation.
- Prepare signed Windows builds.

### 0.7.x - 0.9.x

- Improve performance with large libraries.
- Add automated tests and release checks.
- Improve accessibility and keyboard navigation.
- Stabilize architecture before `1.0`.

### 1.0

- Stable Windows installer.
- Reliable library, playback, progress, IPTV, metadata, and downloads flow.
- Clear documentation for installation, configuration, troubleshooting, and privacy.

## Contributing

Feedback, bug reports, and ideas are welcome.

Use GitHub Issues:

https://github.com/hrl-code/MiraVault/issues

If you want to contribute code, please open an issue first for larger changes so the direction can be discussed before implementation.
