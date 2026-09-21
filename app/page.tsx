'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveTenantBranding } from '@/lib/tenant-branding'
import { Loader2 } from 'lucide-react'
import './panel.css'

interface TenantOption {
  slug: string
  name: string
  settings: unknown
}

// Selector de subcuenta. NO enumera todas las subcuentas del sistema: si estuviéramos
// autenticados, RLS solo devuelve las subcuentas a las que pertenecemos (policy
// tenants_select_member); si no lo estamos, no se lista NINGUNA — conocer los nombres de
// otros clientes no es información pública, así que anónimamente se muestra solo el
// formulario de acceso directo.
//
// Estética "terminal cinematográfico": video full-bleed + scrim, con las tipografías
// del shell. Cada tarjeta de subcuenta lleva el color de su tenant
// (resolveTenantBranding — la misma fuente de verdad que pinta el login y el shell).
export default function HomePage() {
  const [tenants, setTenants] = useState<TenantOption[] | null>(null)
  const [autenticado, setAutenticado] = useState<boolean | null>(null)
  const [slug, setSlug] = useState('')
  // Atajo a la última subcuenta usada EN ESTE NAVEGADOR. Escribir el identificador a mano es la
  // fuente de errores que dejó a alguien fuera por una `s` de más, pero listar las subcuentas del
  // sistema sin sesión sigue estando prohibido (§42, `tests/tenant-no-enumeration.test.mjs`): eso
  // revelaría los nombres de los clientes. El historial del propio usuario no revela nada ajeno.
  const [ultima, setUltima] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    try {
      setUltima(localStorage.getItem('gop:ultima-subcuenta'))
    } catch {
      // Sin almacenamiento disponible no hay atajo; el acceso directo sigue funcionando.
    }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setAutenticado(!!data.user))
  }, [])

  useEffect(() => {
    if (autenticado === null) return
    const supabase = createClient()
    supabase
      .from('tenants')
      .select('slug, name, settings')
      .eq('status', 'active')
      .order('name')
      .then(({ data }) => setTenants(data ?? []))
  }, [autenticado])

  // Acceso directo sin sesión: el usuario escribe el identificador de su subcuenta y
  // saltamos a su login. NO revela subcuentas (misma privacidad que antes) — solo
  // transporta al espacio privado indicado, igual que escribir la URL a mano.
  const accesoDirecto = (e: React.FormEvent) => {
    e.preventDefault()
    const s = slug.trim().toLowerCase().replace(/\s+/g, '-')
    if (s) router.push(`/${s}/login`)
  }

  return (
    <main className="go-hero">
      {/* Medio: video cinematográfico full-bleed. Con prefers-reduced-motion el CSS oculta el
          video y muestra el póster como fondo — cero animación. */}
      <div className="go-hero__media" aria-hidden>
        <video
          className="go-hero__video"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster="/panel/hero-poster.png"
          src="/panel/hero.mp4"
        />
      </div>
      {/* Scrim doble: horizontal (la zona del panel se oscurece para el texto) y vertical
          (arranque y cierre de la escena). Espejo exacto del scrim ECHOID. */}
      <div className="go-hero__scrim" aria-hidden />

      {/* Fila 1 — cabecera. Logo (display del shell) + enlace directo de acceso. */}
      <header className="go-nav">
        <Link href="/" className="go-nav__logo">
          GROWTH OPS
        </Link>
        <nav className="go-nav__cluster">
          <Link href="#acceso" className="go-nav__link">
            Subcuentas
          </Link>
          <Link href="#acceso" className="go-nav__cta">
            Acceder
          </Link>
        </nav>
      </header>

      {/* Fila 2 — cuerpo: panel a la derecha (columna única: chip, display, formulario). */}
      <div className="go-hero__body" id="acceso">
        <section className="go-panel">
          <span className="go-chip">[ Panel de acceso ]</span>
          <h1 className="go-display">Growth Ops</h1>
          <p className="go-tagline">Elige tu subcuenta para entrar al sistema.</p>

          {tenants === null && (
            <div className="go-form" aria-live="polite">
              <Loader2 className="go-loader" aria-label="Cargando subcuentas" />
            </div>
          )}

          {tenants !== null && tenants.length === 0 && !autenticado && (
            <>
              {ultima && (
                <div className="go-direct__reciente">
                  <p className="go-direct__label">Última subcuenta usada en este dispositivo</p>
                  <button type="button" className="go-direct__btn" onClick={() => router.push(`/${ultima}/login`)}>
                    Entrar en {ultima} →
                  </button>
                </div>
              )}

              <form className="go-form" onSubmit={accesoDirecto}>
                <label className="go-direct__label" htmlFor="tenant-slug">
                  Dirección de tu subcuenta
                </label>
                <div className="go-direct">
                  <input
                    id="tenant-slug"
                    className="go-direct__input"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="mi-empresa"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button type="submit" className="go-direct__btn" disabled={!slug.trim()}>
                    Entrar →
                  </button>
                </div>
                <p className="go-direct__hint">
                  Introduce el identificador de tu subcuenta — te lo compartió tu administrador. También puedes entrar
                  desde el enlace directo.
                </p>
              </form>
            </>
          )}

          {tenants !== null && tenants.length === 0 && autenticado && (
            <p className="go-empty">No tienes subcuentas asignadas todavía. Pide acceso a tu administrador.</p>
          )}

          {tenants !== null && tenants.length > 0 && (
            <div className="go-form">
              {tenants.map((t) => {
                const branding = resolveTenantBranding(t.settings)
                return (
                  <Link key={t.slug} href={`/${t.slug}/login`} className="go-tile" data-accent={branding.accent}>
                    <span className="go-tile__top">
                      <span className="go-tile__name">{branding.name}</span>
                      <span className="go-tile__slug">/{t.slug}</span>
                    </span>
                    <span className="go-tile__row">
                      <span className="go-tile__hint">Iniciar sesión</span>
                      <span aria-hidden className="go-tile__arrow">
                        →
                      </span>
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {/* Fila 3 — pie legal. */}
      <footer className="go-legal">
        Growth Ops · Acceso privado del equipo. Cada subcuenta opera como un negocio independiente dentro de la
        plataforma.
      </footer>
    </main>
  )
}
