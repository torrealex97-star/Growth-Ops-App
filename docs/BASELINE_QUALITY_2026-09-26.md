# Baseline de calidad — 2026-09-26

## Alcance y concurrencia

Baseline capturado sobre el árbol actual de la revisión, rama `fix/money-path-silent-writes`, commit `9453e67`. El checkout estaba limpio al iniciar esta pasada. No se cambió código de aplicación ni se corrigieron hallazgos durante la medición.

La rama conserva la PR abierta con fixes P1; por tanto, este baseline describe ese HEAD, no `main` sin los fixes. `main` no se actualizó ni se hizo merge.

## Resultados

| Gate | Resultado | Evidencia / limitación |
| --- | --- | --- |
| Format | **PASS local** | `npm run format:check` — todos los ficheros comprobados cumplen Prettier. |
| Lint | **PASS local, warnings** | `npm run lint` termina correctamente. Next avisa que `next lint` está deprecated. 5 warnings preexistentes: cuatro usos de `<img>` (`instagram/competencia`, dos en `instagram`, `instagram/reels`) y una dependencia `load` ausente en `ContactsAllView.tsx`. No se cambiaron en esta pasada. |
| Typecheck | **PASS local** | `NODE_OPTIONS=--max-old-space-size=4096 npm run typecheck` — `tsc --noEmit` sin errores. El heap ampliado es necesario en este entorno. |
| Tests unitarios | **PASS local** | `npm test` — 928 passed, 0 failed, 3 skipped (931 totales). |
| Tests de métricas | **PASS local** | `npm run test:metrics` — 740 passed, 0 failed, 0 skipped. |
| Build | **PASS en CI; local no concluyente** | El comando local `npm run build` se inició, pero la llamada de terminal alcanzó su deadline antes de devolver resultado; no se cuenta como PASS local. El run de CI del HEAD de la PR terminó Build en 2m55s. |
| Knip / dead code | **PASS en CI; local bloqueado por recursos** | `npm run dead-code` local falló antes del análisis por `RangeError: Array buffer allocation failed` en `oxc-parser`, con Node `v22.23.2`. El reintento con heap ampliado no devolvió resultado antes del deadline. El job CI de calidad que incluye `npm run dead-code` pasó en el SHA de la PR. El script es informativo (`--no-exit-code`), pero aquí ni siquiera produjo inventario utilizable. |
| Gitleaks | **PASS en CI; no disponible localmente** | `gitleaks` no está instalado en este entorno. El check `Secretos (gitleaks, historial completo)` del run CI final pasó. |
| Smoke E2E | **PASS en CI; no repetido localmente** | Smoke E2E (Playwright) del run CI final pasó en 4m46s. Requiere credenciales/tenant QA y no se ejecutó otra vez localmente en esta pasada. |
| Aislamiento / RLS | **Unitarias PASS; verificación contra esquema vivo BLOCKED/SKIPPED** | Las pruebas estáticas/de aislamiento incluidas en `npm test` pasaron como parte de los 928 tests. `freebuff-env list` no muestra claves disponibles; las pruebas que consultan OpenAPI/esquema Supabase vivo se saltan sin `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. Supabase Preview apareció como `skipping` en CI; no equivale a una verificación nueva de policies en staging. |
| Vercel Preview | **Build/deploy del run: omitido por ignore command** | El check de Vercel informó `Canceled by Ignored Build Step`; no se trata como fallo, pero tampoco como despliegue verificado. |

## Resultado CI asociado al HEAD de la PR

El run final registrado para la PR cerró con:

- Format · Lint · Typecheck · Dead code · Unit tests: **PASS** (1m47s).
- Secretos (gitleaks, historial completo): **PASS** (8s).
- Build: **PASS** (2m55s).
- Smoke E2E (Playwright): **PASS** (4m46s).
- Supabase Preview: **SKIPPED**.
- Vercel: build ignorado por configuración (`Canceled by Ignored Build Step`), no constituye evidencia de deploy.

## Advertencias y baseline preexistente

- Los 5 warnings de ESLint son existentes y no bloquean el script.
- Node local observado por Knip: `v22.23.2`, mientras CI fija Node 24; el fallo de memoria local no debe atribuirse a un hallazgo de dead code ni tratarse como regresión de aplicación.
- Tres skips de `npm test` son parte del resultado canónico actual; sin credenciales no puede afirmarse que el esquema vivo o las políticas RLS se hayan revalidado en esta máquina.
- Build, Knip y gitleaks tienen evidencia verde en CI, pero no todos terminaron localmente. Se distinguen explícitamente ambas fuentes.
- No se ejecutó `npm audit`: no es un gate configurado en `package.json` ni en el workflow observado. La revisión de dependencias sigue pendiente como actividad separada, no como fallo de este baseline.

## Conclusión

Los gates locales ejecutables con datos disponibles (format, lint, typecheck, unit y métricas) pasan. CI aporta evidencia verde para build, Knip, gitleaks y Smoke E2E en el SHA de la PR. Queda pendiente una comprobación con credenciales QA/Supabase para que las pruebas vivas de esquema/RLS no se salten, y el entorno local no tiene recursos/runtime suficientes para dar por concluyentes Knip y build fuera de CI.
