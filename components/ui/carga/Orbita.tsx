'use client'

/**
 * La animación de carga. SVG + CSS, nada más.
 *
 * SIN WebGL, SIN shaders y SIN librería de animación a propósito: un loader que descarga medio mega y
 * ocupa la GPU para decir "espera" empeora exactamente lo que intenta disimular. Esto son dos arcos y
 * un punto girando sobre una órbita, en unos cientos de bytes, animados por el compositor (transform y
 * opacity) para no tocar el hilo principal.
 *
 * El color sale de la variable de marca del tenant (`--brand-600`), así que cada subcuenta ve el suyo
 * sin que este componente sepa nada de branding.
 *
 * `prefers-reduced-motion`: el giro se detiene y queda el aro estático. Se resuelve en CSS y no en JS
 * para que funcione también antes de la hidratación.
 */
export function Orbita({ tamano = 44 }: { tamano?: number }) {
  return (
    <>
      <svg
        className="goa-orbita"
        width={tamano}
        height={tamano}
        viewBox="0 0 44 44"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        {/* Aro de fondo: da forma incluso con la animación desactivada. */}
        <circle cx="22" cy="22" r="18" stroke="currentColor" strokeOpacity="0.14" strokeWidth="2" />
        {/* Arco que gira. strokeDasharray fijo: no se anima el dash (eso sí costaría CPU), se rota el grupo. */}
        <g className="goa-orbita-gira">
          <circle
            cx="22"
            cy="22"
            r="18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="30 83"
          />
        </g>
        <g className="goa-orbita-gira-lento">
          <circle cx="22" cy="4" r="2.5" fill="currentColor" />
        </g>
      </svg>
      <style jsx>{`
        .goa-orbita {
          color: var(--brand-600, #6366f1);
          transform-origin: center;
        }
        .goa-orbita-gira,
        .goa-orbita-gira-lento {
          transform-origin: 22px 22px;
          /* Solo transform: lo mueve el compositor, no el hilo principal. */
          will-change: transform;
        }
        .goa-orbita-gira {
          animation: goa-girar 1.1s linear infinite;
        }
        .goa-orbita-gira-lento {
          animation: goa-girar 2.6s linear infinite reverse;
        }
        @keyframes goa-girar {
          to {
            transform: rotate(360deg);
          }
        }
        /* Accesibilidad: sin movimiento, el aro se queda quieto y se sigue entendiendo qué pasa
           porque el texto de al lado lo dice. */
        @media (prefers-reduced-motion: reduce) {
          .goa-orbita-gira,
          .goa-orbita-gira-lento {
            animation: none;
          }
          .goa-orbita-gira {
            opacity: 0.55;
          }
        }
      `}</style>
    </>
  )
}
