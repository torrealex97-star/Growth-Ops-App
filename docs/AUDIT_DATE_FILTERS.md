# Auditoría de Filtros de Fecha — Growth Ops

> Fecha: 2026-09-17 | Estado: En progreso

---

## 1. INVENTARIO DE FILTROS TEMPORALES

### Componente central: `lib/filters/period.ts`

- **PeriodPreset**: 14 presets (all, today, yesterday, day, week, month, quarter, year, 3d, 7d, 30d, 90d, ytd, launch, custom)
- **getPeriodRange()**: Calcula rango Date | null para cada preset
- **inPeriod()**: Filtra un timestamp dentro de un rango
- **PERIOD_PRESETS_BAR**: Opciones para PeriodFilterBar
- **PERIOD_PRESETS_STANDARD**: Opciones para Selectores estándar

### Componente UI: `components/os/PeriodFilterBar.tsx`

- Selector de preset + fechas custom + filtro rol/persona + export
- Usado en: dashboard, agendas, gastos, csm-events

### Páginas con filtro temporal (19 archivos):

| Página | Default actual | ¿Correcto? | Componente |
|---|---|---|---|
| dashboard | `'30d'` | ❌ Debería ser `'month'` | State propio |
| crm/agendas | `'all'` | ❌ | PeriodFilterBar |
| csm-events | `'all'` | ❌ | PeriodFilterBar |
| ventas/registro | `'all'` | ❌ | Select propio |
| ventas/pagos | `'all'` | ❌ | Select propio |
| finanzas/cobros/cobros | `'all'` | ❌ | Select propio |
| finanzas/cobros/devoluciones | `'all'` | ❌ | Select propio |
| finanzas/gastos-facturas/gastos | `'month'` | ✅ | PeriodFilterBar |
| comisiones | `'all'` | ❌ | Select propio |
| unit-economics | `'all'` | ❌ | PeriodFilterBar |
| analitica/embudo | `'all'` | ❌ | State propio |
| analitica/ranking | `'all'` | ❌ | State propio |
| marketing/adquisicion/campanas | URL params | ⚠️ | State propio |
| marketing/adquisicion/atribucion | `'all'` | ❌ | State propio |
| marketing/afiliados/afiliados | `'month'` | ✅ | State propio |
| students | `'all'` | ❌ | State propio |
| drops | `'all'` | ❌ | State propio |
| InstallmentsMorosidadView | `'all'` | ❌ | State propio |
| KPIReportPanel | `'all'` | ❌ | State propio |

**RESUMEN**: 15 de 19 vistas usan `'all'` como default. Solo 2 usan `'month'`.

---

## 2. PROBLEMAS ENCONTRADOS

### 2.1 Default inconsistente
- **Bug**: 15 páginas abren con "Todo el periodo" en vez de "Mes actual"
- **Impacto**: El usuario ve datos históricos completos al abrir, no la situación actual
- **Fix**: Cambiar todos los defaults a `'month'`

### 2.2 Selectores duplicados en agendas
- **Bug**: crm/agendas tiene PeriodFilterBar (global) Y un date picker local (tabla)
- **Impacto**: Dos controles temporales que pueden discrepar
- **Fix**: Unificar — la tabla debe heredar el rango del PeriodFilterBar

### 2.3 Datos que ignoran el filtro
- **Bug**: En dashboard, cuando `periodPreset === 'all'`, se muestran colecciones/contactos sin filtrar
- **Código problemático**: Línea 339 `if (member === 'all' && periodPreset === 'all') return collections`
- **Fix**: Siempre filtrar por rango, nunca bypass

### 2.4 Sin pixel/tracking propio
- **Estado**: La BD tiene `tracking_sites` con `public_key gop_pk_*`, pero no existe el pixel JS
- **Impacto**: Data Health no recibe eventos first-party
- **Fix**: Crear px.js y la ruta de ingesta

---

## 3. PATRÓN FINAL

### Default global
```typescript
export const DEFAULT_PERIOD: PeriodPreset = 'month'
```

### Componente único
`PeriodFilterBar` ya es el componente correcto. Todas las páginas deben usarlo.

### Semántica de fecha por dashboard
- **Dashboard**: leads por `first_seen_at`, agendas por `appointment_datetime`, ventas por `sale_date`
- **Agendas**: `appointment_datetime`
- **Ventas**: `sale_date`
- **Marketing**: `date` (campaign_daily)
- **Funnel**: etapa-specific (cada stage tiene su columna)

---

## 4. PIXEL/TRACKING

### Lo que existe
- `tracking_sites` table con `public_key`, `domain`, `allowlist`
- `raw_events`, `canonical_events`, `analytics_touchpoints` tables
- `contact_attributions` table (first/last touch)
- API endpoint `/api/[tenant]/evergreen/tracking/events`
- `DataHealthPanel` en settings

### Lo que falta
- `px.js` — el script que se instala en landing pages
- Ruta pública de ingesta (sin auth, solo validación por public_key)
- Sampling de eventos
- Reporte en Data Health de "último evento recibido"

---

## 5. CAMBIOS IMPLEMENTADOS

(Se documentan aquí conforme se van haciendo)
