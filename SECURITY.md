# Política de seguridad

## Reportar una vulnerabilidad

**No abras un issue público con detalles de la vulnerabilidad.**

Usa el **reporte privado de vulnerabilidades** de GitHub:
**Security → Report a vulnerability** (https://github.com/torrealex97-star/Growth-Ops-App/security/advisories/new).

Si el reporte privado no está disponible, contacta con el propietario del repo por un canal
privado y espera acuse de recibo antes de compartir detalles.

## Qué incluir en el reporte

- Descripción del problema y tipo (inyección, escalamiento entre tenants, fuga de datos, etc.).
- Pasos para reproducirlo (rutas, payloads, capturas).
- Impacto estimado y, si lo conoces, una propuesta de mitigación.

## Compromiso de respuesta

- **Acuse de recibo:** 72 horas.
- **Actualización de estado:** al menos cada 7 días hasta la resolución.
- **Divulgación coordinada:** el fix se publica y se acredita al reportero, salvo petición
  expresa de anonimato.

## Versiones soportadas

Solo se mantiene y parchea la rama `main` (que es la que corre en producción).

## Alcance: la herramienta vs los datos de los tenants

Este repositorio es el **código de la herramienta** multi-tenant. Por diseño:

- **Ningún dato de negocio de ningún tenant vive en este repo** (leads, ventas, clientes,
  documentos: todo en la base de datos del tenant, con RLS por subcuenta).
- **Ninguna credencial vive en el código** — solo en env vars del despliegue o cifradas por
  tenant en la base de datos (`integration_settings`, AES-256-GCM).
- El CI ejecuta **gitleaks con `--redact`** sobre el historial completo en cada push, y el
  reporte de secretos en un issue/PR está prohibido por la política de contribución.

Si crees haber encontrado **datos de un tenant expuestos** (en el repo, en la app o vía una
integración), trátalo como vulnerabilidad de máxima prioridad y repórtalo por el canal privado.
