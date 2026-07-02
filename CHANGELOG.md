# Changelog

Todas las notas importantes de MiraVault se documentan aqui por version.

## [0.4.2] - 2026-07-02

### Added

- Popup de episodio al hacer click en un capitulo, con nota, sinopsis, progreso, subtitulos y acciones.
- Metadata de episodio desde TVMaze con cache local.
- Acciones para abrir carpeta y enviar archivo/carpeta a la papelera desde el popup.
- Componente `BrandMark` con fallback SVG para evitar iconos rotos en la app instalada.

### Changed

- La seleccion de subtitulos ahora permite elegir `auto`, `sin subtitulos` o un subtitulo concreto.
- El logo de la titlebar y Ajustes se empaqueta como asset de Vite con fallback seguro.
- La ventana de Electron define icono explicitamente para mejorar barra de tareas/ventana en Windows.

### Fixed

- Logo roto en la app instalada cuando la ruta del PNG no resolvia bien.
- Selector de subtitulos que antes siempre dependia de modo automatico.

## [0.4.1] - 2026-07-02

### Added

- Instalador Windows NSIS generado para distribucion publica.
- Branding final inicial con icono, simbolo y banner de MiraVault.
- Sistema automatico de subtitulos: primero busca archivos locales y despues usa OpenSubtitles v3 via Stremio cuando hay IMDb ID.
- Bridge IPTV para preparar streams `rtp://`, `udp://` y `rtsp://` como HLS local cuando sea posible.

### Changed

- La app queda marcada como `0.4.1` en lugar de `0.4.1-beta`.
- VLC recibe subtitulos automaticamente al abrir peliculas o episodios.
- La metadata conserva `imdbId` para mejorar busqueda de subtitulos.

### Known Issues

- El instalador no esta firmado digitalmente, por lo que Windows SmartScreen puede mostrar aviso de editor desconocido.
- IPTV avanzado sigue dependiendo de FFmpeg/VLC y de la calidad real del stream origen.

## [0.4.1-beta] - 2026-07-01

### Added

- Selector de opciones de metadata desde la ficha de cada item.
- Overrides manuales persistentes para titulo, ano, caratula, sinopsis, generos, duracion, director, reparto y rating.
- Nuevas fuentes de metadata sin API key: iTunes Search API, AniList, Jikan y Gutendex.
- Base inicial de motor torrent interno con WebTorrent.
- IPC generico `torrent:*` para desacoplar la UI de qBittorrent.
- `ToDo.md` con roadmap dividido por versiones.

### Changed

- MiraVault cambia de enfoque portable a app con instalador Windows NSIS.
- qBittorrent queda como fallback externo avanzado.
- La pantalla de Descargas permite elegir entre WebTorrent interno y qBittorrent externo.
- Mejorado el matching de metadata para titulos repetidos, remakes y series/peliculas con el mismo nombre.
- La biblioteca intenta extraer el ano tambien desde la ruta/carpeta, no solo desde el nombre del archivo.

### Fixed

- Caratulas incorrectas en casos ambiguos como remakes o titulos cortos.
- Correcciones manuales que podian perderse al reescanear.
- Textos y configuracion heredados del modo portable.

### Known Issues

- WebTorrent esta integrado como base inicial, pero necesita pruebas reales con torrents pequenos y legales.
- El instalador NSIS necesita validacion en equipos limpios.
- La reproduccion IPTV integrada depende de codecs soportados por Chromium; VLC sigue siendo el fallback recomendado.

## [0.4.0-beta] - 2026-07-01

### Added

- Primera beta publica de MiraVault.
- Biblioteca local de series, peliculas y libros.
- Organizador de carpetas para detectar series, temporadas, episodios y residuos.
- Progreso de visionado con marcado visto/no visto.
- Integracion inicial con VLC como reproductor externo.
- IPTV con listas M3U/M3U8 y fallback a VLC.
- Integracion inicial con qBittorrent externo.
- Metadata sin API key usando TVMaze, Cinemeta/Stremio, Wikidata/Wikipedia y OpenLibrary.
- Temas visuales claros, oscuros y variantes.
- README inicial con instalacion, uso, roadmap y notas legales.

### Known Issues

- Version beta temprana, no estable.
- Sin binarios oficiales para usuario final.
- Packaging todavia pendiente de endurecer.
- La deteccion de metadata y organizacion es best-effort.
