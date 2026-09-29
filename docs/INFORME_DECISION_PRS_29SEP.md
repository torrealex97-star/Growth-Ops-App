# Informe de decisión de PRs abiertas — 29-sep

> Copia duradera de la decisión. El resumen corto vive en `docs/ACTIVE_HANDOFF.md` (sección
> «Informe de decisión de PRs abiertas»). Estado verificado a las ~07:00Z del 29-sep: `main` en
> `8a75094` (#289), artefacto de tipos SIN la tabla nueva (bloqueo activo).

## 1. 🔴 Bloqueo inmediato — desbloquea todo lo demás

**El artefacto de tipos de Supabase está desfasado y rompe el CI de todas las PR abiertas.**

- **Causa:** #289 (fusionada y verificada en producción) creó la tabla `stripe_price_map` en el
  esquema vivo, pero `lib/types/database-generated.ts` no se regeneró. El test «el artefacto de
  tipos generado está fresco respecto al esquema vivo» compara contra la BD real y falla.
- **Impacto:** Quality en rojo en #266 y #290 (runs `36530665685`, `36531366595`); afectará a #291
  y al próximo push a `main`. No es un fallo del contenido de esas PR.
- **Por qué no lo resolvió el agente:** `npm run tipos:bd` exige `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY`; el workspace Freebuff no las tiene (verificado con el generador y
  `freebuff-env list`).

**Acción (una de dos):**
1. Añadir las 2 claves a las Environment del workspace Freebuff → el agente regenera el artefacto,
   lo sube a `main` y fusiona #266/#290 sin más pasos; **o**
2. Quien ya tenga las claves (Alex en local, o Claude Code) ejecuta `npm run tipos:bd` y sube el
   artefacto. Un comando, un commit.

## 2. 🟢 #266 — dependabot (`@anthropic-ai/sdk` 0.36→0.128, `@supabase/ssr` 0.10→0.12)

- Rebase hecha (dependabot no puede pushear): merge de `main` en su rama, commit `619d2c9`.
- Probado en local: tsc 0 errores, lint 0, 1.166 unit + 783 métricas 0 fallos, build OK,
  0 vulnerabilidades.
- Riesgo API descartado: sin uso de `beta.*` ni de APIs cambiadas (solo `messages.create` y
  `createServerClient`).

**Decisión: fusionar.** No requiere criterio de negocio; solo espera al punto 1.

## 3. 🟡 #229 — ESLint 9 → 10

Diagnóstico corregido en la PR (el primer comentario atribuía el fallo a los peers: era erróneo).

- **Los peers directos SÍ aceptan 10:** `eslint-config-next@16.3.6` declara `eslint: >=9.0.0`;
  `@typescript-eslint@8.71.0` incluye `^10.0.0`.
- **Lo que rompe** (logs del run `36397775297`; 4 runs fallidos):
  1. `next lint` — el script `lint` del repo — no soporta ESLint 10.
  2. `eslint-plugin-react` (transitiva de `eslint-config-next`) crashea con 10:
     `contextOrFilename.getFilename is not a function`.
- **Dato decisivo:** las latest de los plugins transitivos tampoco soportan 10 —
  `eslint-plugin-react@7.37.5` (peers hasta `^9.7`), `eslint-plugin-import@2.32.0` (hasta `^9`).
  La cadena de `eslint-config-next` no está lista.

**Recomendación: cerrar la PR** y quedarse en ESLint 9.39.5. Coste cero, nada de seguridad en
juego; migrar hoy sería trabajo doble. Señal para reintentar: `eslint-plugin-react` declarando
`^10` en peers.

## 4. 🟠 #225 — money 25-sep (la decisión grande)

**Qué contiene** (9 commits, 34 ficheros):
1. **Gasto de ads solo de cuentas seleccionadas** — daily-funnel, brief, funnels y la capa de
   consulta del agente IA filtran por las cuentas de Integraciones; Data Health gana el control
   `campanasFueraDeSeleccion`.
2. **Esquema canónico de `custom_fields`** fijado por test + `allowImportingTsExtensions` en
   tsconfig.
3. **Nuevo vs recurrente canónico** — `lib/finance/nuevo-vs-recurrente.ts` con la brecha
   vendido-vs-cobrado a la vista.
4. **Desglose nuevo vs recurrente en comisiones futuras** (`commissions/future/route.ts` +
   `CommissionsTable`).
5. **Gráfico dual facturación vs cash** en unit-economics, con CAC solo de ventas cobradas.

**Obsolescencia medida, no estimada:**
- **647 commits por detrás** de `main` (base del 25-sep, 9 commits propios).
- **Los 34 ficheros que toca fueron todos modificados en `main` después de su base.** El merge no
  tiene conflictos textuales (merge-tree: 0 marcadores), pero eso solo significa que git no se
  queja — el riesgo real es **semántico**.
- **Solape con los arreglos de dinero de FASE A** (commits de `main` sobre cada fichero compartido
  desde la base de #225):
  - `app/api/[tenant]/evergreen/commissions/future/route.ts` — **14** (incluye el fail-closed
    `2d8e18c` hoy en producción)
  - `app/[tenant]/comisiones/page.tsx` — **13**
  - `lib/analytics.ts` — **13**
  - `lib/funnels/queries.ts` — **12**
  - `lib/unit-economics.ts` — **9**
  - `components/finanzas/FinanceCharts.tsx` — **8**
  - `lib/metrics/consulta.ts` — **8**
  - `lib/canonical/cash.ts` — **4** (alineación con el cash canónico documentado)
- La PR **es anterior a las tres reglas de dinero** de AGENTS.md («un hueco no es un cero», no
  inventar financieros, fail-closed): su lógica puede pisar esos arreglos o ser arrastrada por
  ellos sin que un CI verde lo distinga. El contenido es decisión de producto de Alex.

**Opciones:**

| Opción | Qué es | Coste | Lectura |
| --- | --- | --- | --- |
| **A. Sondar** | `update-branch` → CI completo (4 jobs) contra el `main` de hoy | ~10 min | Buena **sonda**, no camino a merge: aunque verde, el diff de dinero exige revisión humana por el solape |
| **B. Relevar** | Extraer unidad por unidad (ads-seleccionadas, nuevo-vs-recurrente, dual-chart…) y rehacer sobre `main` solo lo vigente | Horas | El resultado más limpio; permite descartar lo que FASE A ya cubrió |
| **C. Cerrar** | Cerrar la PR y anotar las ideas en `PENDIENTES.md` | 5 min | Razonable si los dashboards actuales ya responden a lo pedido |

**Solo Alex puede decidir:** qué unidades siguen siendo producto deseado (¿el dual
facturación-vs-cash tal cual? ¿el desglose en comisiones futuras?). Si responde «A», el agente
lanza el update-branch y trae el resultado del CI.

## 5. Estado y verificación

- **Hecho y verificado:** #289 fusionada (`8a75094`) y en producción (deploy success 06:03Z,
  incluye la tanda P2 `d252f75`); #285 fusionada; #266 rebaseada y probada en local; tablero y
  docs al día (#290); causa raíz de #229 diagnosticada con logs y corregida en comentario.
- **Cómo se verificó:** `gh pr checks` / `gh run view` sobre runs concretos (nunca el color de la
  lista), deployments API con status `success`, validación local real de #266 (tsc, lint,
  1.166+783 tests, build con heap ampliado), y el artefacto de `main` re-consultado con
  `git show` (0 apariciones de `stripe_price_map`).

## 6. Abierto para Alex

1. Las 2 claves de Supabase (o quién ejecuta `tipos:bd`) — **el desbloqueo total**.
2. Cerrar #229 (recomendado) o asumir la migración del lint.
3. A / B / C para #225.
4. #291 (UI del mapeo Price ID) sigue su curso con Alex; quedará bloqueada por el punto 1.
