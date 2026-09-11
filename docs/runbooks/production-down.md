# Runbook: producción caída o gravemente degradada

Cubre: app inaccesible, login roto, un endpoint crítico (ventas/cobros/webhooks) devolviendo error sistemático, o un
deploy que rompió algo (deployment-regression, external-api-failure y login-failure viven aquí dentro en vez de en
archivos separados — su contenido real es una variante de este mismo flujo).

## 1. DETECT
- ¿Cómo te enteraste? (usuario reportando / tú lo viste / GitHub Actions falló)
- Confirma con una prueba directa (no solo "alguien dijo"): abre `/​<tenant>/login`, intenta entrar, mira `/​<tenant>/dashboard`.

## 2. TRIAGE
- ¿Afecta a **ambos tenants** (Evergreen y WDC) o solo a uno? → si es solo uno, revisa datos/config de ESE tenant
  antes de asumir que es un bug de código compartido.
- ¿Empezó justo después de un deploy? → `git log --oneline -5` en `main`, mira qué se desplegó.
- ¿Es Vercel (la app no responde) o Supabase (la app responde pero las queries fallan)? Prueba `curl -I` a la URL
  de la app; si responde pero con error 500, es más probable que sea Supabase/DB.

## 3. CONTAIN
- Si es un deploy roto: revertir ES la contención. No intentes "arreglarlo hacia adelante" bajo presión.
  ```
  vercel rollback   # o: re-ejecutar workflow_dispatch de deploy.yml sobre el commit anterior en main
  ```
- Si es una integración externa caída (Meta/Calendly/GHL/seQura/Anthropic): no hay kill switch genérico hoy — la
  contención es dejar que el cron/endpoint siga fallando (no bloquea el resto de la app, ver Reliability en
  `docs/PRODUCTION_READINESS.md`) mientras se investiga, salvo que esté generando coste/spam.

## 4. MITIGATE
- Con el rollback ya aplicado (o la causa identificada), aplica el fix mínimo necesario, no un refactor.
- Si es un dato corrupto puntual (una fila, no un bug de código), corregir el dato es más seguro que un hotfix de
  código bajo presión.

## 5. RECOVER
- Vuelve a desplegar (`workflow_dispatch` en `main`) y espera a que `ci.yml` esté verde antes.

## 6. VERIFY
- No basta con "ya no da error". Repite la prueba de DETECT con datos reales: login, dashboard, y la operación
  concreta que falló (crear venta, marcar cobro, etc.) en AMBOS tenants si el incidente los afectaba a los dos.

## 7. POSTMORTEM
- Solo para SEV0/SEV1 (ver `docs/PRODUCTION_READINESS.md` sección de severidades). Qué pasó, por qué no lo detectó
  nadie antes que el usuario, qué constraint/test/alerta lo habría evitado.
