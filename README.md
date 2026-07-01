# MiraVault

**Version actual: `0.4.1-beta`**

MiraVault es una app de escritorio para organizar, explorar y reproducir una biblioteca multimedia local. Nacio como un gestor de torrents, pero ahora apunta a ser un centro personal para series, peliculas, IPTV, descargas y progreso de visionado.

> Estado: beta temprana. La app es instalable y ejecutable en desarrollo, pero todavia no debe considerarse una version estable `1.0`.

## Que hace

- Muestra una biblioteca visual de series y peliculas locales con tarjetas, caratulas, calidad, idioma y progreso.
- Ordena carpetas de series detectando temporadas, episodios, archivos incompletos y residuos comunes.
- Guarda automaticamente el punto de visionado y permite continuar desde donde lo dejaste.
- Marca episodios como vistos cuando se completan o quedan cerca del final.
- Usa VLC como reproductor externo recomendado para MKV, HEVC/H.265, subtitulos y audio multicanal.
- Permite cargar IPTV desde listas M3U/M3U8 y reproducir dentro de la app cuando Chromium lo soporte.
- Incluye fallback a VLC para streams IPTV o videos que el reproductor integrado no pueda manejar.
- Integra una seccion de Torrents con WebTorrent interno inicial y qBittorrent externo como fallback avanzado.
- Enriquece la biblioteca con metadatos sin API key usando multiples proveedores publicos.
- Incluye temas claros, oscuros y variantes visuales desde Configuracion.

## Version

Esta release es **`0.4.1-beta`**.

Consulta [CHANGELOG.md](CHANGELOG.md) para ver los cambios por version.

Significa:

- La base de la app ya existe y se puede clonar, instalar y ejecutar.
- La biblioteca local, el progreso, IPTV, temas, metadata avanzada y la base inicial de WebTorrent estan integrados.
- Aun puede haber cambios grandes de arquitectura, interfaz y flujo de torrents antes de `1.0`.
- No se incluyen binarios de VLC ni qBittorrent en el repositorio.
- No se incluyen proveedores de contenido, listas IPTV, trackers ni torrents.

## Requisitos

- Windows 10/11.
- Node.js 20 o superior recomendado.
- npm.
- VLC recomendado para reproduccion robusta.
- qBittorrent opcional si prefieres usar un cliente externo en la seccion de Torrents.

## Instalacion para desarrollo

```powershell
git clone https://github.com/hrl-code/MiraVault.git
cd MiraVault
npm install
```

## Ejecutar en modo desarrollo

```powershell
npm run dev
```

La app usa Vite en el puerto `5173` y Electron se abre automaticamente cuando el servidor esta listo.

## Build

```powershell
npm run build
```

Scripts disponibles:

- `npm run dev`: inicia Vite y Electron.
- `npm run build`: compila Vite y genera instalador NSIS para Windows.
- `npm run build:installer`: genera instalador NSIS para Windows.
- `npm run preview`: previsualiza el build web de Vite.

Nota: MiraVault ya no apunta a ser portable. El objetivo principal es una app con instalador para poder usar rutas estables, integraciones del sistema y futuras funciones mas avanzadas.

## Uso basico

1. Abre `Carpetas`.
2. Selecciona o revisa la carpeta de biblioteca.
3. Mete tus archivos de series o peliculas dentro de las carpetas correspondientes.
4. Usa `Ordenar` para que MiraVault reescanee y coloque episodios por serie, temporada y capitulo.
5. Entra en `Biblioteca` para ver las tarjetas detectadas.
6. Abre una serie, episodio o pelicula para reproducir y guardar progreso automaticamente.

## Biblioteca y organizador

El organizador intenta detectar archivos de video terminados, series, temporadas y episodios usando nombres de archivo y carpetas. Tambien intenta separar archivos residuales o incompletos para evitar que aparezcan como contenido real.

La deteccion es best-effort: los nombres muy raros, archivos sin temporada/capitulo o carpetas mezcladas pueden requerir ajustes manuales.

## Reproductor y progreso

MiraVault prioriza VLC como reproductor externo porque ofrece mejor compatibilidad con:

- MKV.
- HEVC/H.265.
- Audio multicanal.
- Subtitulos.
- IPTV y streams poco compatibles.

La app guarda automaticamente el punto donde dejaste un episodio. Si quedas cerca del final, puede marcarse como visto.

Para que VLC se detecte automaticamente:

- Instala VLC en `C:\Program Files\VideoLAN\VLC\vlc.exe`, o
- Selecciona manualmente la ruta del ejecutable desde Configuracion.

## IPTV

La seccion `IPTV` permite:

- Cargar listas desde URL M3U/M3U8.
- Pegar contenido M3U manualmente.
- Filtrar por grupo o buscar canales.
- Reproducir canales dentro de la app cuando el formato sea compatible.
- Abrir canales en VLC cuando Chromium no pueda reproducir el stream.

Algunos canales IPTV usan formatos, codecs o protecciones que Chromium no reproduce bien. En esos casos VLC suele ser la opcion mas fiable.

## Torrents

La seccion `Torrents` incluye una base inicial de WebTorrent interno y mantiene qBittorrent externo como fallback avanzado:

- Conexion a qBittorrent externo mediante Web UI.
- Envio de magnets o archivos `.torrent`.
- Seguimiento de progreso, velocidad, ETA y estado.
- Importacion del contenido terminado a la biblioteca local.
- Ruta de descarga sugerida segun series existentes cuando sea posible.

Objetivo del motor WebTorrent:

- Descargar magnets y archivos `.torrent` sin depender de una instalacion externa.
- Mantener qBittorrent como modo avanzado/opcional.
- Integrar progreso, cola, pausa, reanudar, eliminar e importacion a biblioteca desde la misma pantalla.
- Evitar binarios nativos complejos y facilitar el desarrollo open source.

Para usar qBittorrent externo:

1. Activa la Web UI de qBittorrent.
2. Configura URL, usuario y contrasena en MiraVault.
3. Comprueba la conexion desde la seccion `Torrents`.

El modo qBittorrent interno con binarios externos queda aparcado. La ruta prevista para motor interno sera WebTorrent.

## Roadmap WebTorrent

### Fase 1: base del motor interno

- Instalar `webtorrent` como dependencia del proceso principal de Electron.
- Crear una capa comun `electron/torrentEngine.js` con interfaz unica para motores torrent.
- Mantener qBittorrent como motor `external-qbittorrent`.
- Anadir WebTorrent como motor `internal-webtorrent`.
- Guardar configuracion del motor activo en `electron-store`.
- Exponer IPC estable para `add`, `list`, `pause`, `resume`, `remove`, `selectFiles` e `importCompleted`.

### Fase 2: descargas basicas

- Permitir anadir magnet links.
- Permitir anadir archivos `.torrent` desde selector de archivos.
- Descargar en una carpeta configurable.
- Mostrar progreso, velocidad, peers, ratio, tiempo estimado y estado.
- Persistir una cola basica para restaurar torrents al reiniciar la app.
- Evitar duplicados por info hash.

### Fase 3: integracion con biblioteca

- Detectar si el torrent parece serie, pelicula o contenido mixto.
- Sugerir ruta de descarga segun series ya existentes en la biblioteca.
- Al completarse, permitir importar automaticamente a `Biblioteca`.
- Ejecutar el organizador solo sobre contenido finalizado.
- Separar temporales/incompletos para que no aparezcan como episodios o peliculas.

### Fase 4: control de archivos

- Mostrar archivos internos del torrent antes o durante la descarga.
- Permitir seleccionar que archivos descargar.
- Priorizar archivos de video frente a samples, nfo, txt, imagenes o residuos.
- Ignorar archivos irrelevantes al importar.
- Preparar reproduccion parcial solo si es suficientemente estable.

### Fase 5: experiencia de usuario

- Redisenar la pantalla `Torrents` para elegir motor: WebTorrent interno o qBittorrent externo.
- Anadir diagnostico claro del motor activo.
- Mostrar errores recuperables: sin peers, tracker caido, magnet sin metadata, ruta no disponible.
- Anadir acciones rapidas: abrir carpeta, importar a biblioteca, copiar magnet, eliminar descarga.
- Anadir avisos legales y de privacidad en la pantalla de torrents.

### Fase 6: estabilizacion

- Probar torrents grandes, multiples descargas y reinicios de app.
- Medir consumo de memoria y CPU.
- Revisar comportamiento con trackers publicos y torrents con pocos peers.
- Documentar limitaciones frente a qBittorrent.
- Mantener qBittorrent como fallback para usuarios avanzados.

## Plan de implementacion WebTorrent

### Objetivo tecnico

El objetivo no es sustituir qBittorrent como cliente profesional, sino ofrecer un motor interno suficiente para descargas multimedia comunes sin instalar software externo. qBittorrent debe seguir disponible como fallback avanzado.

Arquitectura prevista:

```text
src/pages/Downloads.jsx
        |
        v
window.electronAPI.torrent*
        |
        v
electron/torrentEngine.js
        |
        +-- electron/torrentWebtorrent.js
        |
        +-- electron/qbittorrent.js
```

### Contrato comun del motor

Todos los motores torrent deberian exponer la misma interfaz interna:

```text
getStatus()
getConfig()
setConfig(config)
add(payload)
list(filter)
pause(id)
resume(id)
remove({ id, deleteFiles })
openContent(item)
importContent(item)
selectFiles(id, files)
shutdown()
```

El frontend no deberia saber si el motor activo es WebTorrent o qBittorrent. Solo debe consumir una API comun.

### Modelo minimo de descarga

Cada descarga deberia normalizarse a este formato:

```text
{
  id,
  engine,
  name,
  state,
  progress,
  downloadSpeed,
  uploadSpeed,
  size,
  downloaded,
  eta,
  peers,
  savePath,
  files,
  createdAt,
  completedAt,
  error
}
```

Estados minimos:

- `metadata`: esperando metadata del magnet.
- `downloading`: descargando.
- `paused`: pausado.
- `completed`: terminado.
- `error`: fallo recuperable o definitivo.
- `removed`: eliminado de la cola local.

### Orden de trabajo recomendado

1. Crear `electron/torrentEngine.js` como fachada comun.
2. Mover la integracion qBittorrent actual detras de esa fachada sin cambiar la UI.
3. Instalar `webtorrent` y crear `electron/torrentWebtorrent.js`.
4. Implementar `add`, `list`, `pause`, `resume` y `remove` para WebTorrent.
5. Persistir cola minima en `electron-store`.
6. Restaurar torrents activos al iniciar la app.
7. Adaptar `src/pages/Downloads.jsx` para mostrar selector de motor.
8. Anadir soporte para archivos `.torrent` ademas de magnet links.
9. Anadir importacion a biblioteca cuando una descarga este completada.
10. Pulir errores, diagnostico y mensajes para usuario.

### Criterios de aceptacion de la primera version

- Se puede elegir WebTorrent como motor interno desde la app.
- Se puede pegar un magnet y empezar la descarga.
- Se puede anadir un archivo `.torrent`.
- La descarga muestra progreso, velocidad, peers y estado.
- Pausar, reanudar y eliminar funcionan sin cerrar la app.
- Al reiniciar MiraVault, la cola se recupera de forma razonable.
- Una descarga completada puede abrirse en carpeta.
- Una descarga completada puede importarse a Biblioteca.
- qBittorrent externo sigue funcionando como antes.

### Riesgos a vigilar

- WebTorrent puede tardar en obtener metadata si hay pocos peers.
- Algunos torrents publicos pueden comportarse peor que en qBittorrent/libtorrent.
- La seleccion parcial de archivos puede requerir pruebas cuidadosas.
- Restaurar torrents tras reinicio debe evitar duplicados y estados falsos.
- Torrents muy grandes pueden aumentar consumo de memoria o disco temporal.
- Hay que impedir que archivos incompletos entren en Biblioteca.

### Decision de producto

La prioridad debe ser una experiencia simple:

- Por defecto: WebTorrent interno cuando este estable.
- Avanzado: qBittorrent externo para usuarios que quieran mas control.
- No bloquear la app si el motor torrent falla.
- No mezclar descargas incompletas con la biblioteca.
- No prometer compatibilidad total con todos los torrents.

## Metadatos sin API key

MiraVault no necesita claves privadas para enriquecer la biblioteca. Usa proveedores publicos:

- TVmaze para series.
- Cinemeta/Stremio para peliculas y fallback de series.
- Wikidata/Wikipedia como fallback general.
- OpenLibrary para libros.

Los resultados se guardan en cache local para reducir peticiones y mejorar la velocidad de reescaneos.

## Temas

Los temas se cambian desde `Configuracion > Apariencia`.

Incluye temas oscuros, claros y variantes visuales como:

- Oscuro.
- Claro.
- Dark Blue.
- Deep Ocean.
- Noir Gold.
- Arctic.
- Rosewood.
- Cyberpunk.

## Estructura del proyecto

```text
electron/        Proceso principal, IPC, biblioteca, qBittorrent, reproductor y metadata
src/             Interfaz React
src/pages/       Pantallas principales
src/components/  Componentes compartidos
src/store/       Estado Zustand
src/config/      Configuracion compartida, como temas
public/          Recursos publicos e iconos
```

## Stack tecnico

- Electron.
- React 19.
- Vite.
- Tailwind CSS.
- Zustand.
- better-sqlite3.
- electron-store.
- hls.js.

## Limitaciones conocidas en `0.4.1-beta`

- No hay binarios oficiales publicados todavia para usuario final.
- El instalador puede necesitar ajustes por equipo hasta estabilizar packaging.
- La reproduccion IPTV integrada depende de los codecs soportados por Chromium.
- VLC es la opcion recomendada para codecs complejos.
- La deteccion de series y peliculas es best-effort y puede fallar con nombres poco estandar.
- El motor interno WebTorrent existe, pero todavia necesita pruebas reales con torrents pequenos y legales antes de considerarlo estable.
- qBittorrent externo sigue siendo el fallback recomendado hasta WebTorrent.
- La interfaz y los flujos aun pueden cambiar antes de `1.0`.

## Roadmap

### `0.5.x`

- Anadir primera version del motor interno WebTorrent.
- Permitir magnets y archivos `.torrent` sin depender de qBittorrent.
- Mantener qBittorrent externo como fallback avanzado.
- Mejorar estados vacios, errores y mensajes de recuperacion.
- Mejorar el organizador con mas reglas de deteccion y vista previa mas clara.

### `0.6.x`

- Integrar descargas completadas con la biblioteca local.
- Anadir seleccion/prioridad de archivos dentro de torrents.
- Publicar instalador Windows de forma mas estable.
- Mejorar metadata, caratulas y cache local.
- Mejorar IPTV: favoritos, grupos, historial y fallback mas claro.

### `0.7.x` - `0.9.x`

- Endurecer rendimiento en bibliotecas grandes.
- Estabilizar WebTorrent con multiples descargas, reinicios y torrents grandes.
- Documentar diferencias entre WebTorrent interno y qBittorrent externo.
- Mejorar accesibilidad y navegacion por teclado.
- Preparar pruebas automatizadas y checks de release.
- Congelar arquitectura previa a `1.0`.

### `1.0`

- Build estable para usuario final.
- Flujo de biblioteca, reproduccion, progreso, IPTV y descargas suficientemente estable.
- Documentacion completa de instalacion, configuracion y solucion de problemas.
- Politica clara de compatibilidad y actualizaciones.

## Notas legales

MiraVault es un organizador y reproductor de contenido local. No proporciona contenido, listas IPTV, trackers, torrents ni proveedores. Usa la app solo con contenido propio o contenido para el que tengas derechos de acceso.
