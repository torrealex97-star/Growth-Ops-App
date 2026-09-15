'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { VslConfig } from '@/lib/vsl/types'
import { formatNumber } from '@/lib/utils'

export interface VslPlayerVideo {
  slug: string
  source_url: string | null
  poster_url: string | null
  duration_seconds: number
  config: VslConfig
}

const BEAT_MS = 3000

function getAnonId(): string {
  try {
    const k = 'tcc_vsl_anon'
    let id = localStorage.getItem(k)
    if (!id) {
      id = String(
        (crypto as any)?.randomUUID?.() ??
          `a_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`
      )
      localStorage.setItem(k, id)
    }
    return id
  } catch {
    return `a_${Date.now().toString(36)}`
  }
}

// Posición guardada por vídeo (para ofrecer "continuar / reiniciar" al volver)
const posKey = (slug: string) => `tcc_vsl_pos_${slug}`
function savePos(slug: string, pos: number, dur: number) {
  try {
    localStorage.setItem(posKey(slug), JSON.stringify({ pos, dur }))
  } catch {
    // Se ignora a propósito: en ventana privada o con las cookies de sitio bloqueadas, localStorage
    // LANZA al escribir. Recordar por dónde iba el vídeo es una comodidad, no un requisito: si no se
    // puede guardar, el vídeo empieza desde el principio y no pasa nada más.
  }
}
function clearPos(slug: string) {
  try {
    localStorage.removeItem(posKey(slug))
  } catch {
    // Mismo motivo que en savePos: si no se pudo escribir, tampoco hay nada que borrar.
  }
}
function readPos(slug: string, fallbackDur: number): number | null {
  try {
    const raw = localStorage.getItem(posKey(slug))
    if (!raw) return null
    const s = JSON.parse(raw)
    const d = s.dur || fallbackDur || 0
    // Ofrecer reanudar solo si vio >15s y no estaba prácticamente al final
    if (s.pos && s.pos >= 15 && (!d || s.pos < d * 0.95)) return s.pos
    return null
  } catch {
    return null
  }
}

// Curva de "barra acelerada": el ancho mostrado va por delante del tiempo real
// (avanza rápido al principio y se arrastra al final -> sensación de "queda poco").
function warp(realPct: number): number {
  const f = Math.max(0, Math.min(1, realPct / 100))
  return Math.round(Math.pow(f, 0.7) * 100)
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function fmtNum(n: number): string {
  return formatNumber(Math.max(0, Math.floor(n)))
}

export function VslPlayer({ video, embed = false }: { video: VslPlayerVideo; embed?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const sessionRef = useRef<string | null>(null)
  const watchedRef = useRef<Set<number>>(new Set())
  const pendingRef = useRef<Set<number>>(new Set())
  const maxReachedRef = useRef(0)
  const playSentRef = useRef(false)
  const hasPlayedRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const [muted, setMuted] = useState(video.config.muted ?? true)
  const [playing, setPlaying] = useState(false)
  const [pct, setPct] = useState(0)
  const [ready, setReady] = useState(false)
  const [firstFrame, setFirstFrame] = useState(false) // ¿ya se pintó el 1er frame? (evita el "negro")
  const [isFs, setIsFs] = useState(false)
  const [resumeSec, setResumeSec] = useState<number | null>(null) // posición para ofrecer "continuar"
  const wantResumeRef = useRef(false) // bloquea el autoplay hasta que el usuario elija
  const [sp, setSp] = useState<{ watching: number; watched: number } | null>(null) // prueba social
  const [showExitHook, setShowExitHook] = useState(false) // overlay "no te vayas"
  const exitShownRef = useRef(0) // veces mostrado (máx 2/sesión)

  const cfg = video.config
  const src = video.source_url || ''
  const isHls = src.toLowerCase().includes('.m3u8')

  // ---- ¿Ya estaba viendo el vídeo? -> ofrecer continuar / reiniciar ---------
  useEffect(() => {
    const saved = readPos(video.slug, video.duration_seconds)
    if (saved != null) {
      wantResumeRef.current = true // no autoplay hasta que el usuario elija
      setResumeSec(saved)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Prueba social: "viendo ahora" / "ya lo vieron" -----------------------
  useEffect(() => {
    const mode = cfg.socialProof
    if (!mode || mode === 'off') return

    if (mode === 'real') {
      let alive = true
      const pull = () => {
        fetch(`/api/vsl/live/${video.slug}`)
          .then((r) => r.json())
          .then((d) => {
            if (alive) setSp({ watching: Number(d.watching) || 0, watched: Number(d.watched) || 0 })
          })
          .catch(() => {})
      }
      pull()
      const id = setInterval(pull, 10_000)
      return () => {
        alive = false
        clearInterval(id)
      }
    }

    // mode === 'fake': número inventado con deriva suave (no salta feo al recargar)
    const min = Math.max(1, Math.floor(cfg.spViewersMin))
    const max = Math.max(min, Math.floor(cfg.spViewersMax))
    const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1))
    let watching = rnd(min, max)
    let watched = Math.max(0, Math.floor(cfg.spWatchedBase)) + rnd(0, 40)
    setSp({ watching, watched })
    const id = setInterval(() => {
      watching = Math.min(max, Math.max(min, watching + rnd(-1, 1)))
      if (Math.random() < 0.5) watched += rnd(1, 2) // "ya lo vieron" solo sube
      setSp({ watching, watched })
    }, 5_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.socialProof, video.slug])

  // ---- Envío de latidos -----------------------------------------------------
  const sendBeat = useCallback(
    (event: string) => {
      const el = videoRef.current
      if (!el || !sessionRef.current) return
      const seconds = Array.from(pendingRef.current)
      pendingRef.current = new Set()
      if (event === 'beat' && seconds.length === 0) return
      const payload = JSON.stringify({
        sessionId: sessionRef.current,
        seconds,
        position: el.currentTime,
        duration: el.duration || video.duration_seconds || 0,
        event,
      })
      const url = '/api/vsl/track'
      // sendBeacon para no perder datos al cerrar la pestaña
      if (event === 'ended' || event === 'unload') {
        navigator.sendBeacon?.(url, new Blob([payload], { type: 'application/json' }))
      } else {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {})
      }
    },
    [video.duration_seconds]
  )

  // ---- Crear sesión + cargar fuente (HLS) -----------------------------------
  useEffect(() => {
    const el = videoRef.current
    if (!el || !src) return
    let hls: any = null
    let cancelled = false

    // Fuente: HLS.js si es .m3u8 y el navegador no lo soporta nativo; si no, src directo.
    if (isHls && !el.canPlayType('application/vnd.apple.mpegurl')) {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return
        if (Hls.isSupported()) {
          hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 30 })
          hls.loadSource(src)
          hls.attachMedia(el)
        } else {
          el.src = src
        }
      })
    } else {
      el.src = src
    }

    // Crea la sesión de tracking
    const anonId = getAnonId()
    fetch('/api/vsl/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: video.slug, anonId, referrer: document.referrer || null }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.sessionId) {
          sessionRef.current = d.sessionId
          // avisa al parent de que ya hay sesión (para identify diferido) e incluye el anonId,
          // para que loader.js pueda enganchar el visionado ANÓNIMO a una cita de Calendly
          // (lo pasa como salesforce_uuid en el enlace, aunque el lead no haga optin).
          try {
            window.parent?.postMessage({ __tccvsl: 'ready', slug: video.slug, anonId }, '*')
          } catch {
            // Se ignora a propósito: el reproductor va en un iframe de otro dominio y `window.parent`
            // puede no existir (abierto directo) o rechazar el mensaje. Es una señal opcional para la
            // landing; sin ella el vídeo funciona igual.
          }
          // Si el autoplay ya arrancó antes de tener sesión, registra el 'play' ahora
          // (si no, se perdería y el play rate saldría 0).
          if (hasPlayedRef.current && !playSentRef.current) {
            playSentRef.current = true
            sendBeat('play')
          }
        }
      })
      .catch(() => {})

    setReady(true)
    return () => {
      cancelled = true
      if (hls) hls.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  // ---- Latidos periódicos + al cerrar ---------------------------------------
  useEffect(() => {
    const id = setInterval(() => {
      // Red de seguridad: si el 'play' no se llegó a enviar, envíalo en cuanto haya sesión.
      if (sessionRef.current && hasPlayedRef.current && !playSentRef.current) {
        playSentRef.current = true
        sendBeat('play')
      }
      sendBeat('beat')
    }, BEAT_MS)
    const onHide = () => sendBeat('unload')
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') sendBeat('unload')
    })
    return () => {
      clearInterval(id)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onHide)
    }
  }, [sendBeat])

  // ---- identify() desde la landing (parent) ---------------------------------
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data
      if (!d || d.__tccvsl !== 'identify') return
      if (!sessionRef.current) return
      fetch('/api/vsl/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionRef.current, email: d.email, name: d.name }),
      }).catch(() => {})
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  // ---- Gancho de recuperación (idea 6): "espera, no te vayas" ----------------
  const maybeShowExitHook = useCallback(() => {
    const el = videoRef.current
    if (!cfg.exitHook || !el) return
    if (!hasPlayedRef.current || el.currentTime < 8 || el.ended) return // no al inicio ni al final
    if (wantResumeRef.current) return // no encima del selector "continuar"
    if (exitShownRef.current >= 2) return // máx 2 veces por sesión
    exitShownRef.current += 1
    setShowExitHook(true)
  }, [cfg.exitHook])

  const dismissExitHook = () => {
    setShowExitHook(false)
    const el = videoRef.current
    if (el && el.paused) el.play().catch(() => {})
  }

  // Intención de salida en escritorio: el ratón se va por arriba (hacia cerrar/pestañas)
  useEffect(() => {
    if (!cfg.exitHook) return
    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) maybeShowExitHook()
    }
    document.addEventListener('mouseout', onLeave)
    return () => document.removeEventListener('mouseout', onLeave)
  }, [cfg.exitHook, maybeShowExitHook])

  // ---- Eventos del <video> --------------------------------------------------
  const onTimeUpdate = () => {
    const el = videoRef.current
    if (!el) return
    const d = el.duration || video.duration_seconds || 0
    if (d > 0) setPct(Math.min(100, (el.currentTime / d) * 100))
    if (!el.paused && !el.seeking) {
      const sec = Math.floor(el.currentTime)
      if (!watchedRef.current.has(sec)) {
        watchedRef.current.add(sec)
        pendingRef.current.add(sec)
        // Persiste la posición (1x/seg) para poder ofrecer "continuar" al volver
        savePos(video.slug, el.currentTime, d)
      }
      if (el.currentTime > maxReachedRef.current) maxReachedRef.current = el.currentTime
    }
    // progreso al parent (útil para píxeles en Fase 3)
    if (d > 0) {
      try {
        window.parent?.postMessage(
          { __tccvsl: 'progress', slug: video.slug, percent: Math.round((el.currentTime / d) * 100) },
          '*'
        )
      } catch {
        // Igual que el mensaje de 'ready': la landing es de otro dominio y puede no estar escuchando.
      }
    }
  }

  const onSeeking = () => {
    const el = videoRef.current
    if (!el || !cfg.lockSeek) return
    // Permite rebobinar, impide adelantar más allá de lo ya visto.
    if (el.currentTime > maxReachedRef.current + 0.6) el.currentTime = maxReachedRef.current
  }

  const onPlaying = () => setFirstFrame(true) // ya hay imagen real: retiramos el póster de encima

  const onPlay = () => {
    setPlaying(true)
    hasPlayedRef.current = true
    // Solo se envía si ya hay sesión; si no, se enviará en el callback de creación de sesión.
    if (sessionRef.current && !playSentRef.current) {
      playSentRef.current = true
      sendBeat('play')
    }
  }
  const onPause = () => {
    setPlaying(false)
    sendBeat('beat')
    maybeShowExitHook()
  }
  const onEnded = () => {
    setPlaying(false)
    sendBeat('ended')
    clearPos(video.slug) // ya lo terminó: la próxima vez empieza de cero
    if (cfg.loop) {
      const el = videoRef.current
      if (el) {
        maxReachedRef.current = 0 // vuelve a bloquear el adelanto en la nueva vuelta
        el.currentTime = 0
        el.play()
          .then(() => setPlaying(true))
          .catch(() => {})
      }
    }
  }

  // ---- Autoplay: intenta CON sonido y, si el navegador lo bloquea, mute + overlay
  useEffect(() => {
    const el = videoRef.current
    if (!el || !ready || !cfg.autoplay || wantResumeRef.current) return

    const startMuted = () => {
      el.muted = true
      setMuted(true)
      el.play().catch(() => {})
    }

    // Muchos VSL "autoreproducen con audio": solo funciona si el navegador lo permite
    // (Safari, visitantes recurrentes con Media Engagement alto, etc.). Chrome suele
    // bloquearlo -> caemos al modo mute + overlay "toca para activar el sonido" (como ahora).
    if (cfg.tryAudioAutoplay) {
      el.muted = false
      el.play()
        .then(() => {
          setMuted(false)
        }) // sonó con audio: no hace falta overlay
        .catch(startMuted) // bloqueado por el navegador: fallback silencioso
    } else {
      startMuted()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // ---- Continuar / reiniciar tras haber visto antes -------------------------
  const resumeFrom = (sec: number) => {
    const el = videoRef.current
    wantResumeRef.current = false
    setResumeSec(null)
    if (!el) return
    maxReachedRef.current = sec // permite el salto pese a lockSeek (ya lo había visto)
    try {
      el.currentTime = sec
    } catch {
      // Se ignora a propósito: asignar currentTime LANZA si el medio aún no tiene metadatos
      // cargados (readyState 0). El usuario vuelve a pulsar y entonces sí salta; tratarlo como
      // error solo produciría un aviso por algo que se arregla solo.
    }
    el.muted = muted
    el.play().catch(() => {})
  }
  const restartFromStart = () => {
    const el = videoRef.current
    wantResumeRef.current = false
    setResumeSec(null)
    clearPos(video.slug)
    if (!el) return
    maxReachedRef.current = 0
    try {
      el.currentTime = 0
    } catch {
      // Se ignora a propósito: asignar currentTime LANZA si el medio aún no tiene metadatos
      // cargados (readyState 0). El usuario vuelve a pulsar y entonces sí salta; tratarlo como
      // error solo produciría un aviso por algo que se arregla solo.
    }
    el.muted = muted
    el.play().catch(() => {})
  }

  const togglePlay = () => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) el.play().catch(() => {})
    else el.pause()
  }

  const unmute = () => {
    const el = videoRef.current
    if (!el) return
    el.muted = false
    setMuted(false)
    // La carátula "parece" que se reproduce (autoplay muted), pero al activar el sonido
    // volvemos al inicio para que el hook se escuche desde el segundo 0.
    if (cfg.restartOnUnmute) {
      maxReachedRef.current = 0
      try {
        el.currentTime = 0
      } catch {
        // Se ignora a propósito: asignar currentTime LANZA si el medio aún no tiene metadatos
        // cargados (readyState 0). El usuario vuelve a pulsar y entonces sí salta; tratarlo como
        // error solo produciría un aviso por algo que se arregla solo.
      }
    }
    el.play().catch(() => {})
  }

  const toggleFullscreen = () => {
    const cont = containerRef.current
    const el = videoRef.current as any
    const doc = document as any
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      ;(document.exitFullscreen || doc.webkitExitFullscreen)?.call(document)
      return
    }
    if (cont?.requestFullscreen) cont.requestFullscreen().catch(() => {})
    else if ((cont as any)?.webkitRequestFullscreen) (cont as any).webkitRequestFullscreen()
    else if (el?.webkitEnterFullscreen) el.webkitEnterFullscreen() // iOS Safari (solo el <video>)
  }

  useEffect(() => {
    const onFs = () => setIsFs(!!(document.fullscreenElement || (document as any).webkitFullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    document.addEventListener('webkitfullscreenchange', onFs)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      document.removeEventListener('webkitfullscreenchange', onFs)
    }
  }, [])

  const seekBar = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = videoRef.current
    if (!el || cfg.lockSeek) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const d = el.duration || video.duration_seconds || 0
    if (d > 0) el.currentTime = ratio * d
  }

  if (!src) {
    return (
      <div className="flex aspect-video w-full items-center justify-center bg-black text-sm text-foreground/60">
        Este vídeo aún no tiene fuente configurada.
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden bg-black"
      style={{
        aspectRatio: isFs ? undefined : '16 / 9',
        maxHeight: embed && !isFs ? '100vh' : undefined,
        height: isFs ? '100%' : undefined,
      }}
    >
      <video
        ref={videoRef}
        poster={video.poster_url || undefined}
        playsInline
        preload="auto"
        className="h-full w-full object-contain"
        onClick={togglePlay}
        onTimeUpdate={onTimeUpdate}
        onSeeking={onSeeking}
        onPlay={onPlay}
        onPlaying={onPlaying}
        onPause={onPause}
        onEnded={onEnded}
      />

      {/* Póster por encima del <video> hasta que se pinta el 1er frame real:
          evita el ~1,5s en negro mientras el navegador bufferea al arrancar. */}
      {!firstFrame && video.poster_url && (
        <div
          className="pointer-events-none absolute inset-0 bg-black bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url("${video.poster_url}")` }}
        />
      )}

      {/* Prueba social: "viendo ahora" / "ya lo vieron" (esquina superior izquierda) */}
      {sp && (cfg.socialProof === 'fake' || cfg.socialProof === 'real') && (
        <div className="pointer-events-none absolute left-2.5 top-2.5 z-20 flex flex-col gap-1">
          {sp.watching > 0 && (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              {fmtNum(sp.watching)} viendo ahora
            </span>
          )}
          {sp.watched > 0 && (
            <span className="inline-flex w-fit items-center rounded-full bg-black/45 px-2.5 py-1 text-[10px] text-white/85 backdrop-blur-sm">
              {fmtNum(sp.watched)} ya lo han visto
            </span>
          )}
        </div>
      )}

      {/* Gancho de recuperación (idea 6): "espera, no te vayas" */}
      {showExitHook && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/80 px-6 text-center text-white backdrop-blur-sm">
          <p className="max-w-md text-lg font-semibold leading-snug">{cfg.exitHookText}</p>
          <button
            onClick={dismissExitHook}
            className="flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-110"
            style={{ backgroundColor: cfg.primaryColor }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
            Seguir viendo
          </button>
        </div>
      )}

      {/* Overlay: ya estaba viendo el vídeo -> continuar o reiniciar */}
      {resumeSec !== null && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/70 px-6 text-center text-white backdrop-blur-sm">
          <p className="text-base font-semibold">Estabas viendo este vídeo</p>
          <p className="-mt-2 text-sm text-white/70">Lo dejaste en el minuto {fmtTime(resumeSec)}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => resumeFrom(resumeSec)}
              className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:brightness-110"
              style={{ backgroundColor: cfg.primaryColor }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                <path d="M8 5v14l11-7z" />
              </svg>
              Continuar
            </button>
            <button
              onClick={restartFromStart}
              className="flex items-center gap-2 rounded-full border border-white/30 bg-white/5 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/15"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Empezar de nuevo
            </button>
          </div>
        </div>
      )}

      {/* Overlay para activar sonido (autoplay muted) */}
      {muted && resumeSec === null && (
        <button
          onClick={unmute}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/25 text-foreground transition hover:bg-black/35"
        >
          <span
            className="flex h-16 w-16 items-center justify-center rounded-full shadow-lg"
            style={{ backgroundColor: cfg.primaryColor }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="white">
              <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 00-2.5-4.03v8.06A4.5 4.5 0 0016.5 12z" />
            </svg>
          </span>
          <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-medium">Toca para activar el sonido</span>
        </button>
      )}

      {/* Botón play central cuando está pausado y con sonido */}
      {!playing && !muted && resumeSec === null && !showExitHook && (
        <button onClick={togglePlay} className="absolute inset-0 flex items-center justify-center bg-black/20">
          <span
            className="flex h-16 w-16 items-center justify-center rounded-full shadow-lg"
            style={{ backgroundColor: cfg.primaryColor }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </button>
      )}

      {/* Botón de pantalla completa (esquina inferior derecha, por encima de overlays) */}
      <button
        onClick={toggleFullscreen}
        aria-label="Pantalla completa"
        className="absolute bottom-2.5 right-2.5 z-20 flex h-9 w-9 items-center justify-center rounded-md bg-black/45 text-foreground opacity-80 transition hover:bg-black/65 hover:opacity-100"
      >
        {isFs ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
          </svg>
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        )}
      </button>

      {/* Barra de progreso (azul). Con fakeProgress va "acelerada": el ancho
          mostrado va por delante del tiempo real para dar sensación de que queda poco. */}
      {cfg.showBar && (
        <div
          onClick={seekBar}
          className="absolute bottom-0 left-0 right-0 h-1.5 bg-white/20"
          style={{ cursor: cfg.lockSeek ? 'default' : 'pointer' }}
        >
          <div
            className="h-full transition-[width] duration-150 ease-linear"
            style={{ width: `${cfg.fakeProgress ? warp(pct) : pct}%`, backgroundColor: cfg.barColor }}
          />
        </div>
      )}
    </div>
  )
}
