# Prompt: auditoría y mejora integral de UX/UI (ejecutar DESPUÉS del prompt de arquitectura/métricas)

Este prompt debe ejecutarse después del refactor de métricas y arquitectura (ver
`PROMPT_ARQUITECTURA_PENDIENTE.md`), no antes — así el Dashboard y Finanzas se diseñan alrededor de
los datos definitivos y no hay que rediseñar dos veces.

---

Aquí Codex debe comportarse como Product Designer + Design Systems Lead + Frontend Staff Engineer,
inspeccionar primero y después implementar por pantallas sin convertirlo en un rediseño arbitrario.

Quiero que realices una auditoría y mejora integral del UX/UI de esta aplicación.

Esta tarea NO consiste simplemente en "hacerla más bonita".

Quiero mejorar:

* claridad;
* jerarquía;
* navegación;
* velocidad de uso;
* comprensión de métricas;
* consistencia;
* responsive;
* accesibilidad;
* percepción de calidad;
* reducción de errores;
* mantenibilidad del sistema visual.

Actúa simultáneamente como:

* Principal Product Designer
* Senior UX Designer
* Design Systems Lead
* Staff Frontend Engineer
* Data Visualization Designer
* Accessibility Specialist
* Mobile Product Designer
* Product Analyst

Lee primero:

AGENTS.md

ARCHITECTURE.md

DEVELOPMENT_RULES.md

docs/METRICS.md

y cualquier documentación relevante existente.

Después inspecciona la aplicación real.

NO empieces cambiando colores o componentes.

Primero entiende:

USERS
→ TASKS
→ INFORMATION
→ NAVIGATION
→ INTERACTIONS
→ DESIGN SYSTEM
→ RESPONSIVE
→ VISUAL DESIGN

---

## 1. OBJETIVO

Quiero que la aplicación termine sintiéndose como un producto profesional diseñado de forma
intencionada, no como una acumulación de pantallas creadas independientemente.

El resultado debe tener:

MENOS RUIDO

MENOS CLICS

MENOS INCONSISTENCIAS

MENOS DENSIDAD INNECESARIA

MENOS COMPONENTES DUPLICADOS

y:

MÁS CLARIDAD

MÁS JERARQUÍA

MÁS CONSISTENCIA

MEJOR MOBILE

MEJOR LEGIBILIDAD

MEJOR COMPRENSIÓN DE MÉTRICAS

MEJOR VELOCIDAD DE USO

---

## 2. AUDITORÍA READ-ONLY PRIMERO

Antes de modificar nada:

inspecciona todas las pantallas relevantes.

Crea un inventario de:

* páginas;
* layouts;
* sidebar;
* topbar;
* navegación mobile;
* cards;
* KPI cards;
* charts;
* tables;
* forms;
* buttons;
* inputs;
* selects;
* dropdowns;
* filters;
* tabs;
* modals;
* drawers;
* tooltips;
* badges;
* alerts;
* notifications;
* empty states;
* loading states;
* error states.

Clasifica problemas como:

CRITICAL

HIGH

MEDIUM

LOW

---

## 3. AUDITORÍA VISUAL

Busca inconsistencias en:

* spacing;
* alignment;
* typography;
* font weights;
* font sizes;
* line height;
* colors;
* borders;
* radii;
* shadows;
* icons;
* button sizes;
* card styles;
* table styles;
* form styles;
* chart styles;
* page widths.

No corrijas cada inconsistencia individualmente si existe una causa sistémica.

Corrige el sistema.

---

## 4. DESIGN SYSTEM

Determina qué sistema visual existe actualmente.

NO crees un segundo design system si ya existe uno sano.

Consolida lo existente.

Quiero una arquitectura conceptual:

DESIGN TOKENS
↓
PRIMITIVES
↓
SHARED COMPONENTS
↓
PRODUCT COMPONENTS
↓
PAGES

---

## 5. DESIGN TOKENS

Centraliza cuando corresponda:

* colors;
* spacing;
* typography;
* radii;
* shadows;
* borders;
* breakpoints;
* z-index;
* transitions.

Utiliza tokens semánticos.

Prefiere:

background

surface

foreground

muted

primary

accent

success

warning

danger

border

en lugar de colores hardcoded dispersos.

---

## 6. EVERGREEN + WDC

Evergreen y Women Digital Closer deben compartir el mismo Design System.

NO quiero dos implementaciones.

Arquitectura:

SHARED DESIGN SYSTEM
        ↓
SEMANTIC TOKENS
        ↓
TENANT THEME
     ↙       ↘
EVERGREEN    WDC

WDC debe mantener:

* nombre/logo WDC;
* acento rosa;
* identidad ligeramente diferenciada.

El resto del UX debe mantener paridad funcional.

---

## 7. WDC NO DEBE SER "TODO ROSA"

El rosa debe funcionar como identidad/acento.

Utilízalo con criterio en:

* estados activos;
* highlights;
* acciones principales;
* indicadores;
* selected navigation;
* pequeños elementos de marca.

No sacrifiques:

* contraste;
* legibilidad;
* accesibilidad;
* profesionalidad.

---

## 8. COMPONENTES COMPARTIDOS

Antes de crear cualquier componente visual:

BUSCA UNO EXISTENTE.

Especialmente:

Button

Input

Select

Checkbox

Radio

Switch

Card

KpiCard

Table

Modal

Drawer

Tabs

Tooltip

Badge

Alert

EmptyState

Skeleton

Pagination

DateRangePicker

FilterBar

No quiero 5 implementaciones ligeramente diferentes del mismo componente.

---

## 9. COMPONENT API

Los componentes compartidos deben tener APIs simples.

Evita componentes con decenas de props booleanas como:

compact
small
dense
special
dashboard
finance
pink
mobile

Si un componente necesita demasiadas excepciones:

revisa su diseño.

---

## 10. PAGE SHELL

Unifica estructura de páginas.

Conceptualmente:

PAGE
├── HEADER
│   ├── TITLE
│   ├── CONTEXT
│   └── PRIMARY ACTION
├── FILTERS
├── PRIMARY CONTENT
└── SECONDARY CONTENT

No fuerces esta estructura cuando no tenga sentido.

---

## 11. JERARQUÍA VISUAL

Cada pantalla debe dejar claro en pocos segundos:

1. ¿Dónde estoy?
2. ¿Qué estoy viendo?
3. ¿Qué es lo más importante?
4. ¿Qué puedo hacer?
5. ¿Dónde encuentro más detalle?

---

## 12. REDUCIR RUIDO

Busca:

* borders innecesarios;
* cards dentro de cards;
* demasiados backgrounds;
* demasiados badges;
* iconos decorativos;
* textos redundantes;
* títulos repetidos;
* CTAs secundarios demasiado visibles.

Simplifica.

---

## 13. EVITAR CARD EVERYTHING

No conviertas cada dato en una card.

Las cards deben agrupar información relacionada.

Cuando el contenido funciona mejor como:

* lista;
* sección;
* tabla;
* texto;
* gráfico;

usa esa estructura.

---

## 14. DENSIDAD

Define niveles razonables de densidad.

Dashboard:

más visual.

Finanzas:

más informativo.

Tablas:

más densas.

Mobile:

más selectivo.

No utilices el mismo layout para todo.

---

## 15. DASHBOARD PRINCIPAL

Rediseña el dashboard alrededor de decisiones.

Debe responder:

¿CÓMO VA EL NEGOCIO?

¿QUÉ HA CAMBIADO?

¿QUÉ NECESITA ATENCIÓN?

¿QUÉ DEBO HACER?

---

## 16. DASHBOARD — PRIMER NIVEL

El primer viewport no debe intentar mostrar todo.

Prioriza aproximadamente 4–6 KPIs realmente importantes, según los datos reales del negocio.

No elijas KPIs por estética.

---

## 17. KPI CARD CANÓNICA

Crea un patrón consistente para KPIs.

Conceptualmente:

Ingresos
42.350 €
↑ 8,4%
vs periodo comparable

Cuando corresponda puede incluir:

* label;
* value;
* trend;
* comparison;
* period;
* tooltip.

No añadas todos esos elementos si no aportan información.

---

## 18. KPI TOOLTIP

Para métricas no obvias:

el usuario debe poder descubrir:

* definición;
* fórmula conceptual;
* periodo;
* qué incluye;
* qué excluye.

Utiliza docs/METRICS.md como fuente de verdad.

La UI NO debe inventar otra definición.

---

## 19. MÉTRICAS CONFIABLES

Nunca mejores visualmente una métrica que todavía no esté validada.

Si existe duda sobre el cálculo:

DATA CORRECTNESS

tiene prioridad sobre:

VISUAL DESIGN.

---

## 20. COMPARACIONES

Las tendencias deben mostrar claramente contra qué se comparan.

Evita:

+14%

sin contexto.

Prefiere conceptualmente:

+14% vs periodo anterior comparable

cuando corresponda.

---

## 21. POSITIVO ≠ SIEMPRE VERDE

No asumas que subir siempre es positivo.

Ejemplo:

GASTOS ↑

puede ser negativo.

Define semántica según la métrica.

---

## 22. COLOR NO PUEDE SER LA ÚNICA SEÑAL

Utiliza también:

* icono;
* dirección;
* texto;
* label.

Especialmente para accesibilidad.

---

## 23. DASHBOARD — SEGUNDO NIVEL

Después de KPIs:

muestra evolución y contexto.

Prioriza pocos gráficos útiles.

No llenes el dashboard de visualizaciones.

---

## 24. DASHBOARD — TERCER NIVEL

Después:

información que requiere atención.

Por ejemplo, si existe realmente en el producto:

* pendientes;
* anomalías;
* elementos próximos;
* problemas;
* acciones necesarias.

No inventes alertas artificiales.

---

## 25. DIRECCIÓN

La antigua sección Dirección debe permanecer eliminada como silo si ya se decidió fusionarla.

No recrees Dirección indirectamente dentro del Dashboard como un enorme bloque.

Distribuye únicamente la información útil.

---

## 26. FINANZAS

Finanzas debe sentirse como una herramienta de análisis.

No como un segundo Dashboard duplicado.

Estructura conceptual:

FINANCIAL SUMMARY
↓
TRENDS
↓
INCOME / COSTS / PROFIT
↓
BREAKDOWN
↓
TRANSACTIONS / DETAIL

Adapta según datos reales.

---

## 27. DASHBOARD VS FINANZAS

Define responsabilidades.

DASHBOARD:

visión rápida + decisiones.

FINANZAS:

análisis + detalle.

Evita duplicar todos los gráficos en ambos lugares.

---

## 28. FILTRO TEMPORAL

Crea un patrón consistente para periodos.

Ejemplos según necesidades reales:

Hoy

7 días

30 días

Mes

Trimestre

Año

Personalizado

No muestres opciones que no tengan sentido.

---

## 29. FILTROS GLOBALES

Si un filtro afecta toda la pantalla:

hazlo visualmente evidente.

No permitas que unas cards usen un periodo y otras otro sin indicarlo.

---

## 30. FILTROS PERSISTENTES

Evalúa mantener filtros al:

* navegar;
* volver atrás;
* recargar;

solo cuando mejore la experiencia.

No mantengas filtros inesperadamente para siempre.

---

## 31. GRÁFICOS

Cada gráfico debe responder UNA pregunta.

Antes de conservarlo pregunta:

¿Qué decisión o comprensión proporciona?

Si no existe respuesta clara:

REMOVE

o

MERGE.

---

## 32. SELECCIÓN DE GRÁFICO

No uses gráficos por estética.

Conceptualmente:

TENDENCIA → line

COMPARACIÓN → bar

COMPOSICIÓN → stacked / equivalente

DISTRIBUCIÓN → formato apropiado

Evita pie/donut con demasiadas categorías.

---

## 33. ESCALAS

No manipules visualmente diferencias mediante escalas engañosas.

Comprueba:

* zero baseline cuando corresponda;
* escalas;
* unidades;
* ticks;
* rango temporal.

---

## 34. CHART TOOLTIPS

Unifica tooltips.

Formato consistente para:

* moneda;
* porcentajes;
* fechas;
* cantidades.

---

## 35. CHART LEGENDS

Evita leyendas enormes.

Usa labels directos cuando mejoren comprensión.

---

## 36. EMPTY CHART

Si no hay datos:

no muestres un gráfico vacío extraño.

Muestra un EmptyState adecuado.

---

## 37. TABLAS

Crea un sistema consistente para tablas.

Debe considerar:

* header;
* sorting;
* filtering;
* search;
* pagination;
* actions;
* empty;
* loading;
* error.

No todas las tablas necesitan todas las funciones.

---

## 38. COLUMNAS

Prioriza información.

No muestres columnas únicamente porque existen en DB.

Cada columna debe justificar su presencia.

---

## 39. ACCIONES DE FILA

Evita 5 botones visibles en cada fila.

Usa:

acción primaria clara

overflow menu

cuando corresponda.

---

## 40. MOBILE TABLES

No fuerces una tabla desktop completa dentro de 360px.

Para cada tabla decide entre:

RESPONSIVE TABLE

HORIZONTAL SCROLL

PRIORITY COLUMNS

CARD/LIST VIEW

DETAIL DRILL-DOWN

Escoge según la tarea.

---

## 41. NAVEGACIÓN DESKTOP

Audita la sidebar.

Debe contener únicamente destinos importantes.

Busca:

* secciones redundantes;
* nombres ambiguos;
* jerarquía excesiva;
* destinos poco utilizados.

---

## 42. ACTIVE STATE

Debe ser evidente dónde está el usuario.

No dependas de una diferencia de color casi imperceptible.

---

## 43. SIDEBAR

Evalúa:

* ancho;
* labels;
* iconografía;
* grupos;
* collapse;
* scrolling.

No añadas collapse si empeora descubribilidad sin aportar espacio útil.

---

## 44. TOPBAR

No conviertas la topbar en un almacén de controles.

Debe contener solo elementos globales relevantes.

---

## 45. BREADCRUMBS

Úsalos cuando la profundidad de navegación los justifique.

No pongas breadcrumbs decorativos en páginas de primer nivel.

---

## 46. MOBILE NAVIGATION

Diseña mobile como producto propio.

No:

DESKTOP SIDEBAR
→ HAMBURGER
→ DONE.

Analiza frecuencia de uso.

---

## 47. BOTTOM NAVIGATION

Evalúa bottom navigation si existen aproximadamente 3–5 destinos principales de alta frecuencia.

No la uses si la arquitectura del producto no lo justifica.

---

## 48. MOBILE SECONDARY NAV

Para opciones secundarias utiliza cuando corresponda:

* drawer;
* more;
* contextual menu;
* profile/settings area.

---

## 49. TOUCH TARGETS

Comprueba tamaños táctiles adecuados.

Especialmente:

* icon buttons;
* close buttons;
* pagination;
* filters;
* checkboxes;
* row actions.

---

## 50. MOBILE FILTERS

No pongas una fila infinita de selects.

Considera:

* filter drawer;
* bottom sheet;
* compact controls.

Debe ser fácil saber qué filtros están activos.

---

## 51. MOBILE DASHBOARD

En móvil:

prioriza.

No apiles automáticamente 25 cards.

Ordena contenido por importancia.

---

## 52. MOBILE KPI

Las cifras importantes deben seguir siendo legibles.

Evita:

* texto diminuto;
* números cortados;
* 4 cards estrechas en una fila.

---

## 53. MOBILE CHARTS

Comprueba:

* labels;
* tooltip;
* gestures;
* aspect ratio;
* overflow.

Reduce información secundaria si es necesario.

---

## 54. MOBILE MODALS

Evalúa cuándo un modal debería convertirse en:

drawer

o

bottom sheet.

No conviertas automáticamente todos.

---

## 55. FORMULARIOS

Los formularios deben minimizar esfuerzo.

Revisa:

* orden;
* agrupación;
* labels;
* defaults;
* validation;
* required fields;
* keyboard types;
* autofill;
* submit.

---

## 56. PLACEHOLDERS

Placeholder NO sustituye label.

---

## 57. VALIDACIÓN

Muestra errores cerca del campo.

No esperes al submit para errores que pueden detectarse razonablemente antes.

No molestes al usuario validando agresivamente mientras escribe.

---

## 58. SUBMIT

Previene double-submit.

Debe existir feedback:

PROCESSING

SUCCESS

ERROR.

---

## 59. ACCIONES DESTRUCTIVAS

Diseña confirmación proporcional al riesgo.

No uses confirm modal para cada acción trivial.

Para acciones destructivas importantes:

haz explícita la consecuencia.

---

## 60. TOASTS

No uses toast como única forma de comunicar información crítica.

Los mensajes importantes deben permanecer visibles cuando sea necesario.

---

## 61. LOADING

Evita spinners gigantes para toda la página cuando puede cargarse progresivamente.

---

## 62. SKELETONS

Los skeletons deben aproximar el layout final para evitar layout shift.

No abuses.

---

## 63. EMPTY STATES

Diseña estados vacíos útiles.

Conceptualmente:

No hay operaciones todavía.
Cuando registres la primera operación aparecerá aquí.
[Crear operación]

Adapta al producto real.

---

## 64. ERROR STATES

Diferencia:

NETWORK ERROR

PERMISSION ERROR

VALIDATION ERROR

NOT FOUND

SERVER ERROR

No muestres mensajes técnicos.

---

## 65. PARTIAL FAILURE

Si una sección secundaria falla:

mantén utilizable el resto de la pantalla cuando sea seguro.

---

## 66. STALE DATA

Si una métrica puede estar desactualizada:

indícalo cuando sea relevante.

---

## 67. TYPOGRAPHY

Define jerarquía consistente:

PAGE TITLE

SECTION TITLE

CARD TITLE

BODY

SECONDARY

CAPTION

METRIC VALUE

No uses tamaños arbitrarios por pantalla.

---

## 68. NÚMEROS

Para dashboards financieros:

evalúa usar números tabulares si la tipografía lo soporta.

Los valores deben alinearse correctamente.

---

## 69. FORMATO MONETARIO

Unifica:

1.234,56 €

o el formato definido para locale/producto.

No mezcles formatos.

---

## 70. FORMATO PORCENTUAL

Unifica precisión.

Evita mostrar:

12.348274%

si:

12,3%

es suficiente.

---

## 71. FECHAS

Unifica formatos.

No mezcles arbitrariamente:

12/09/26

September 12

2026-09-12

salvo contexto técnico.

---

## 72. MICROCOPY

Revisa labels y textos.

Prefiere lenguaje humano y específico.

Evita términos técnicos internos.

---

## 73. ICONOGRAFÍA

Usa una librería/sistema principal.

No mezcles múltiples estilos de iconos sin motivo.

---

## 74. ICON-ONLY BUTTONS

Deben tener:

* accessible label;
* tooltip cuando sea necesario.

---

## 75. COLOR SEMANTICS

Define significados consistentes.

SUCCESS

WARNING

DANGER

INFO

NEUTRAL

BRAND

No uses el mismo color para significados contradictorios.

---

## 76. DARK/LIGHT

No añadas dark mode únicamente porque sea popular.

Si ya existe:

audítalo.

Si no existe:

solo impleméntalo si existe una necesidad real.

---

## 77. ACCESSIBILITY

Valida:

* keyboard navigation;
* focus;
* contrast;
* labels;
* landmarks;
* heading hierarchy;
* forms;
* modals;
* dialogs;
* tables;
* screen reader semantics.

---

## 78. FOCUS

Nunca elimines focus outline sin reemplazo accesible.

---

## 79. KEYBOARD

Flujos principales deben poder utilizarse razonablemente mediante teclado en desktop.

---

## 80. REDUCED MOTION

Respeta preferencias de reduced motion si existen animaciones significativas.

---

## 81. ANIMACIONES

Las animaciones deben comunicar:

* transición;
* feedback;
* relación espacial.

No añadir movimiento decorativo que ralentice la experiencia.

---

## 82. MICROINTERACTIONS

Añade feedback discreto para:

* hover;
* press;
* selection;
* loading;
* save;
* expand/collapse.

Mantén tiempos rápidos.

---

## 83. SEARCH

Si existen suficientes entidades/páginas para justificarlo:

evalúa búsqueda global.

No la añadas si el producto es demasiado pequeño.

---

## 84. COMMAND PALETTE

Si los usuarios son frecuentes/power users:

evalúa command palette.

Ejemplos:

* navegar;
* buscar entidad;
* ejecutar acción común.

Solo si reduce fricción real.

---

## 85. QUICK ACTIONS

Identifica las 3–5 acciones más frecuentes.

Hazlas accesibles sin recorrer múltiples pantallas.

No llenes el dashboard de botones.

---

## 86. INFORMATION ARCHITECTURE

Crea un mapa final:

APP
├── Dashboard
├── ...
├── Finanzas
├── ...
└── Configuración

Basado en la aplicación real.

---

## 87. CLICK DEPTH

Para tareas frecuentes:

mide cuántos pasos/clics requiere actualmente.

Reduce cuando exista una alternativa clara.

No sacrifiques comprensión por ahorrar un clic.

---

## 88. RESPONSIVE BREAKPOINTS

No diseñes únicamente:

DESKTOP

y

MOBILE.

Comprueba también anchuras intermedias.

Especialmente tablets y laptops pequeñas.

---

## 89. VIEWPORT MATRIX

Como mínimo valida pantallas críticas en viewports representativos de:

MOBILE SMALL

MOBILE LARGE

TABLET

LAPTOP

DESKTOP

No necesitas probar cada dispositivo existente.

---

## 90. OVERFLOW

Busca automáticamente:

* horizontal overflow;
* clipped text;
* overlapping controls;
* fixed widths problemáticos;
* modals fuera de viewport.

---

## 91. LONG CONTENT

Prueba:

* nombres largos;
* números grandes;
* textos largos;
* tablas grandes.

No diseñes únicamente con datos perfectos.

---

## 92. LOCALIZATION RESILIENCE

Aunque actualmente exista un idioma principal:

evita layouts que se rompan si un label aumenta de longitud.

---

## 93. PERFORMANCE UX

Percepción de velocidad importa.

Prioriza:

* contenido crítico;
* respuesta inmediata a interacción;
* optimistic UI solo cuando sea seguro;
* progressive loading.

---

## 94. NO OPTIMISTIC UI EN TODO

Para acciones financieras o críticas:

no muestres éxito antes de confirmación si puede generar confusión o riesgo.

---

## 95. VISUAL REGRESSION

Evalúa configurar visual regression para pantallas críticas.

Prioridad:

* Dashboard desktop;
* Dashboard mobile;
* Finanzas;
* navegación;
* WDC;
* componentes base.

---

## 96. SCREENSHOT AUDIT

Genera capturas de las pantallas críticas antes de modificar.

Después genera capturas equivalentes.

Compara:

BEFORE

AFTER.

No evalúes únicamente el código.

---

## 97. NO DECLARAR "MEJOR UX" SIN EVIDENCIA

Para cada cambio significativo explica:

PROBLEM

UX IMPACT

CHANGE

EXPECTED BENEFIT

VERIFICATION

---

## 98. LIGHTHOUSE / ACCESSIBILITY

Ejecuta herramientas disponibles para detectar regresiones.

No persigas una puntuación perfecta sacrificando producto.

---

## 99. E2E VISUAL + FUNCIONAL

Después del rediseño:

comprueba que los elementos no solo se vean bien.

También deben funcionar.

---

## 100. SCREEN STATES MATRIX

Para cada pantalla crítica comprueba:

DEFAULT

LOADING

EMPTY

ERROR

PARTIAL ERROR

LONG CONTENT

MOBILE

DESKTOP

---

## 101. DESIGN DEBT

Crea un inventario de deuda visual restante.

Clasifica:

FIX_NOW

FIX_LATER

ACCEPTABLE

---

## 102. NO OVERDESIGN

No introduzcas:

* glassmorphism arbitrario;
* gradientes innecesarios;
* sombras excesivas;
* animaciones constantes;
* efectos visuales de moda;
* dashboards excesivamente decorativos.

El diseño debe sobrevivir varios años.

---

## 103. PROFESIONALIDAD

Prioriza una estética:

limpia

sobria

moderna

clara

precisa

consistente

No quiero una interfaz genérica de template ni una interfaz excesivamente "AI-generated".

---

## 104. DATA DENSITY

Una aplicación de negocio necesita densidad útil.

No conviertas todo en enormes espacios vacíos para parecer minimalista.

Busca equilibrio entre:

CLARITY

y

INFORMATION DENSITY.

---

## 105. DESIGN SYSTEM DOCUMENTATION

Documenta los patrones esenciales.

No hace falta crear un portal gigantesco.

Debe quedar claro:

* tokens;
* componentes;
* variantes;
* uso;
* tenant themes.

---

## 106. STORYBOOK

Evalúa Storybook o herramienta equivalente SOLO si el tamaño real del Design System lo justifica.

Si añade más mantenimiento que valor:

NOT_NEEDED.

No instalar por defecto.

---

## 107. REGLA PARA CLAUDE/CODEX

Actualiza AGENTS.md si es necesario para establecer:

ANTES DE CREAR UN COMPONENTE UI:

1. buscar componente existente;
2. buscar patrón existente;
3. usar tokens;
4. comprobar responsive;
5. comprobar estados;
6. comprobar accesibilidad.

No dupliques reglas existentes.

---

## 108. REGLA DE CONSISTENCIA

Una nueva feature debe parecer parte de la misma aplicación desde el primer día.

No debe introducir:

"su propio estilo".

---

## 109. AUDITORÍA EVERGREEN

Verifica completamente Evergreen:

DESKTOP

TABLET

MOBILE.

---

## 110. AUDITORÍA WDC

Haz la misma revisión sobre WDC.

No asumas que compartir componentes garantiza automáticamente que el branding y responsive
funcionan.

---

## 111. PARIDAD

Crea una matriz:

AREA             EVERGREEN     WDC
Dashboard        PASS          PASS
Finanzas         PASS          PASS
Navigation       PASS          PASS
Mobile           PASS          PASS
Forms            PASS          PASS
Tables           PASS          PASS
Metrics          PASS          PASS

Añade áreas reales necesarias.

---

## 112. DIFERENCIAS INTENCIONADAS

Documenta las diferencias de branding.

Todo lo demás debe clasificarse:

INTENTIONAL

BUG

LEGACY

UNKNOWN.

---

## 113. IMPLEMENTACIÓN POR LOTES

No hagas un mega-rediseño en un único cambio.

Orden recomendado:

PHASE 1
Design audit

PHASE 2
Tokens + foundations

PHASE 3
Shared components

PHASE 4
Navigation

PHASE 5
Dashboard

PHASE 6
Finance

PHASE 7
Remaining critical screens

PHASE 8
Mobile

PHASE 9
Accessibility

PHASE 10
Visual regression + cleanup

Después de cada fase:

TEST

SCREENSHOT

REVIEW

---

## 114. NO ROMPER FUNCIONALIDAD

Los cambios visuales no deben modificar accidentalmente:

* cálculos;
* permissions;
* queries;
* mutations;
* tenant isolation.

Si necesitas cambiar lógica:

trátalo como cambio funcional y prueba adecuadamente.

---

## 115. NO REESCRIBIR TODO

Preserva componentes sanos.

Refactoriza cuando exista evidencia de:

* duplicación;
* inconsistencia;
* mala API;
* accesibilidad;
* responsive roto;
* deuda significativa.

---

## 116. BEFORE / AFTER

Para pantallas críticas documenta:

BEFORE PROBLEM

AFTER SOLUTION

No necesito descripciones subjetivas como:

"ahora se ve más moderno".

Quiero mejoras concretas.

---

## 117. UX QUALITY GATE

Una pantalla nueva o modificada no puede considerarse terminada hasta comprobar:

DESIGN SYSTEM
↓
DESKTOP
↓
TABLET
↓
MOBILE
↓
LOADING
↓
EMPTY
↓
ERROR
↓
LONG CONTENT
↓
KEYBOARD
↓
ACCESSIBILITY
↓
FUNCTIONAL TEST
↓
VISUAL REVIEW

---

## 118. CRITERIO DE ÉXITO

El trabajo estará terminado cuando:

* exista una jerarquía visual coherente;
* navegación sea clara;
* Dashboard sea comprensible rápidamente;
* Finanzas permita análisis real;
* métricas sean fáciles de interpretar;
* mobile parezca diseñado intencionadamente;
* tablas funcionen en mobile;
* filtros sean consistentes;
* loading/empty/error estén diseñados;
* componentes compartidos sean realmente compartidos;
* no exista proliferación de variantes;
* Evergreen y WDC mantengan paridad;
* WDC tenga branding propio sin fork;
* accesibilidad haya mejorado;
* no existan regresiones funcionales conocidas.

---

## 119. REPORTE FINAL

Entrega:

UX/UI AUDIT

DESIGN SYSTEM CHANGES

NAVIGATION BEFORE/AFTER

DASHBOARD BEFORE/AFTER

FINANCE BEFORE/AFTER

MOBILE IMPROVEMENTS

COMPONENTS CONSOLIDATED

COMPONENTS REMOVED

ACCESSIBILITY IMPROVEMENTS

EVERGREEN/WDC PARITY

VISUAL REGRESSIONS CHECKED

REMAINING DESIGN DEBT

TEST RESULTS

SCREENSHOTS REVIEWED

Utiliza:

PASS

FAIL

NOT AVAILABLE

NOT APPLICABLE

cuando corresponda.

---

## 120. SEGUNDA PASADA VISUAL

Cuando termines:

NO pares.

Vuelve a recorrer visualmente todas las pantallas principales como si fueras un usuario nuevo.

Busca:

* inconsistencias introducidas;
* elementos desalineados;
* navegación confusa;
* información duplicada;
* responsive roto;
* textos truncados;
* acciones escondidas;
* componentes que todavía parecen pertenecer a otro sistema.

Corrige los problemas confirmados.

---

## 121. PASADA DE SIMPLIFICACIÓN

Después pregunta para cada pantalla:

¿Qué puedo eliminar sin reducir la capacidad del usuario para entender o completar su tarea?

Busca:

* cards innecesarias;
* labels redundantes;
* divisores;
* filtros;
* botones;
* iconos;
* texto;
* pasos.

Simplifica donde exista beneficio real.

---

## 122. PASADA DE VELOCIDAD DE USO

Después pregunta:

¿Cómo puede un usuario frecuente completar esta tarea más rápido?

Evalúa:

* menos navegación;
* defaults inteligentes;
* persistencia razonable;
* quick actions;
* keyboard;
* búsqueda;
* mejor agrupación.

---

## 123. PASADA MOBILE FINAL

Haz una última revisión exclusivamente móvil.

No evalúes mobile comparándolo con desktop.

Evalúalo como producto independiente.

Comprueba:

¿Puedo utilizar las funciones principales cómodamente con una mano?

¿La información importante aparece primero?

¿Los números se leen?

¿Los filtros son utilizables?

¿Las tablas funcionan?

¿Los modales funcionan?

¿Las acciones importantes son fáciles de encontrar?

---

## 124. PRINCIPIO FINAL

No quiero que el resultado simplemente tenga:

"mejor UI".

Quiero que la interfaz reduzca el esfuerzo mental necesario para utilizar el producto.

Cada decisión debe intentar mejorar:

CLARITY

SPEED

CONFIDENCE

CONSISTENCY

ACCESSIBILITY

El usuario debe entender rápidamente:

DÓNDE ESTÁ

QUÉ ESTÁ PASANDO

QUÉ SIGNIFICAN LOS DATOS

QUÉ REQUIERE SU ATENCIÓN

QUÉ PUEDE HACER A CONTINUACIÓN.

Empieza con una auditoría READ-ONLY y capturas de las pantallas actuales cuando las herramientas
disponibles lo permitan.

No modifiques nada hasta comprender el sistema visual existente.

Después implementa las mejoras por fases pequeñas, verificables y reversibles.

---

## 125. PROHIBIDO AI SLOP

El resultado NO debe parecer una interfaz generada automáticamente por IA.

Evita patrones visuales genéricos asociados a dashboards AI-generated cuando no estén
justificados:

* grid uniforme de cards idénticas;
* card dentro de card;
* exceso de bordes redondeados;
* radii exagerados;
* sombras decorativas;
* gradientes arbitrarios;
* glassmorphism;
* glow;
* iconos dentro de cuadrados de colores sin función;
* badges innecesarios;
* enormes títulos con poco contenido;
* exceso de espacio vacío;
* widgets colocados únicamente para rellenar;
* gráficos decorativos sin pregunta analítica;
* colores aleatorios para hacer la pantalla "más interesante";
* microcopy genérica;
* layouts excesivamente simétricos que ignoran la importancia de la información.

No diseñes una colección de componentes.

Diseña una herramienta de trabajo.

La composición debe responder a la importancia y relación de la información.

---

## 126. EVITAR EL "SAAS TEMPLATE LOOK"

No quiero que la aplicación parezca un template genérico de SaaS.

No copies automáticamente el patrón:

WELCOME BACK
↓
4 KPI CARDS
↓
3 RANDOM CHARTS
↓
RECENT ACTIVITY

La estructura debe derivarse de las preguntas reales que necesita responder el usuario.

Para cada panel pregunta:

¿QUÉ NECESITA SABER?

¿QUÉ NECESITA COMPARAR?

¿QUÉ CAMBIÓ?

¿QUÉ NECESITA SU ATENCIÓN?

¿QUÉ ACCIÓN PUEDE TOMAR?

---

## 127. DATA VISUALIZATION FIRST

Cuando un conjunto de datos se comprenda mejor visualmente que mediante números aislados,
utiliza una visualización adecuada.

No reduzcas toda la aplicación a KPI cards.

Considera cuando tenga sentido:

* line charts;
* smooth trend curves;
* area charts;
* bar charts;
* stacked bars;
* donut/pie charts;
* sparklines;
* progress indicators;
* comparison charts;
* distributions;
* cohort-like visualizations;
* funnels;
* heatmaps;
* scatter plots;

solo cuando los datos reales y la pregunta analítica lo justifiquen.

---

## 128. TENDENCIAS

Cuando una métrica cambia a lo largo del tiempo y la evolución sea importante:

prioriza mostrar la tendencia.

Por ejemplo:

INGRESOS
42.350 €
+8,4%
╭──────╮
│  ╭───╯
╰──╯

La representación exacta dependerá del dato.

Una cifra aislada responde:

"¿Cuánto?"

Una tendencia responde además:

"¿Cómo estamos llegando hasta aquí?"

Cuando esa segunda pregunta sea importante, muestra ambas.

---

## 129. SPARKLINES EN KPI

Evalúa pequeñas sparklines dentro o junto a KPIs cuando permitan entender rápidamente:

* dirección;
* volatilidad;
* aceleración;
* estabilidad.

No las añadas a todas las cards por decoración.

Una sparkline debe aportar información.

---

## 130. CURVAS Y LINE CHARTS

Para evolución temporal utiliza normalmente line charts o area charts cuando sean la
representación más clara.

Ejemplos:

* ingresos por día;
* ventas por semana;
* beneficio mensual;
* conversión;
* leads;
* operaciones;
* costes.

No uses barras para una serie temporal únicamente porque sea más fácil de implementar.

---

## 131. CURVAS SUAVIZADAS

Las curvas visualmente suavizadas pueden utilizarse cuando mejoren legibilidad.

Pero:

NO deben alterar la interpretación de los datos.

Los puntos reales siguen siendo los datos reales.

No utilices smoothing estadístico implícito que haga parecer que existen valores que
realmente no existen.

Diferencia entre:

VISUAL CURVE

y

STATISTICAL SMOOTHING.

---

## 132. AREA CHARTS

Utiliza area charts cuando ayuden a entender:

* volumen;
* acumulación;
* evolución.

Evita utilizarlos cuando el área visual pueda exagerar diferencias.

---

## 133. GRÁFICOS DE PASTEL / DONUT

Sí se pueden utilizar pie/donut charts.

Pero solo para:

PART-TO-WHOLE.

Ejemplos:

distribución de ingresos por categoría;

distribución de operaciones por estado;

composición de una cartera.

Úsalos cuando:

* las categorías suman un total significativo;
* existen pocas categorías;
* la comparación aproximada es suficiente.

---

## 134. CUÁNDO NO USAR PIE/DONUT

NO uses pie/donut para:

* tendencias;
* evolución temporal;
* muchas categorías;
* valores muy parecidos que necesitan comparación precisa;
* métricas que no forman un total.

Si hay demasiadas categorías:

prefiere bar chart.

---

## 135. DONUT CENTRAL VALUE

Cuando aporte valor, un donut puede mostrar en el centro:

TOTAL

o

MÉTRICA PRINCIPAL.

Pero no añadas texto central únicamente por estética.

---

## 136. BAR CHARTS

Utiliza barras cuando la pregunta sea:

"¿Cuál es mayor?"

"¿Cómo se comparan estas categorías?"

"¿Qué categoría aporta más?"

Especialmente útiles para:

* ranking;
* canales;
* vendedores;
* productos;
* categorías;
* periodos discretos.

---

## 137. STACKED BARS

Utiliza stacked bars cuando interese simultáneamente:

TOTAL

COMPOSICIÓN.

No uses demasiados segmentos.

---

## 138. FUNNELS

Si existe un proceso real de conversión:

LEAD
→ QUALIFIED
→ CALL
→ SALE

o equivalente:

evalúa una visualización funnel.

No inventes funnels porque visualmente quedan bien.

---

## 139. CONVERSION DROP-OFF

Cuando exista funnel:

destaca dónde se produce pérdida.

El gráfico debe ayudar a responder:

"¿Dónde estamos perdiendo conversiones?"

---

## 140. HEATMAPS

Evalúa heatmaps cuando permitan descubrir patrones por:

* día;
* hora;
* semana;
* categoría;
* intensidad.

Ejemplo:

conversión por día/hora.

Solo si existe suficiente volumen de datos.

---

## 141. SCATTER PLOTS

Evalúa scatter plots cuando interese una relación entre variables.

Por ejemplo:

inversión vs ingresos;

número de llamadas vs ventas;

ticket vs conversión.

No impliques causalidad únicamente porque exista correlación visual.

---

## 142. COMPARACIÓN DE PERIODOS

Cuando sea útil:

permite comparar visualmente:

CURRENT PERIOD

vs

PREVIOUS PERIOD.

Por ejemplo:

línea sólida = actual

línea secundaria = anterior.

Debe quedar perfectamente claro cuál es cuál.

---

## 143. BENCHMARKS / TARGETS

Si existe un objetivo real:

muéstralo.

Ejemplo:

──────── TARGET
    ╭────
╭───╯

Puede ser:

* objetivo mensual;
* presupuesto;
* target de conversión;
* forecast validado.

No inventes objetivos.

---

## 144. ACTUAL VS TARGET

Cuando exista target:

facilita comparar:

ACTUAL

TARGET

VARIANCE.

No obligues al usuario a calcular mentalmente la diferencia.

---

## 145. FORECASTS

Solo muestra forecast si existe una metodología real.

Diferencia visualmente:

HISTORICAL

vs

FORECAST.

Nunca presentes una predicción como dato observado.

---

## 146. GRANULARIDAD TEMPORAL

Adapta automáticamente o de forma controlada la granularidad.

Ejemplo conceptual:

7 DAYS
→ daily

3 MONTHS
→ daily/weekly

1 YEAR
→ weekly/monthly

MULTI-YEAR
→ monthly/quarterly

Evita gráficos con cientos de labels ilegibles.

---

## 147. ZOOM / DRILL-DOWN

Cuando un gráfico contenga suficiente información:

evalúa permitir:

click

hover

drill-down

para acceder al detalle.

Ejemplo:

clic en "Agosto"

→ movimientos de agosto.

No añadas interacción si no conduce a información útil.

---

## 148. TOOLTIP ANALÍTICO

Los tooltips pueden mostrar más que el valor.

Cuando corresponda:

DATE

VALUE

CHANGE

COMPARISON

CONTEXT.

Mantén el tooltip limpio.

---

## 149. PASTEL COLORS

Los colores pastel pueden utilizarse cuando encajen con el sistema visual.

Especialmente en:

* chart series;
* secondary categories;
* subtle backgrounds;
* segmentation;
* selected states suaves.

Pero deben proceder de una paleta definida.

No generar colores aleatorios por gráfico.

---

## 150. PALETA DE GRÁFICOS

Define chart tokens separados del branding cuando sea necesario.

Conceptualmente:

--chart-1
--chart-2
--chart-3
--chart-4
--chart-5
--chart-positive
--chart-negative
--chart-neutral
--chart-target

Evergreen y WDC pueden adaptar ligeramente la paleta manteniendo significado semántico.

---

## 151. ACCESIBILIDAD DE COLORES PASTEL

Pastel NO significa bajo contraste.

Los elementos informativos deben seguir siendo distinguibles.

No dependas únicamente del color.

Considera:

* line styles;
* labels;
* markers;
* patterns;
* icons;
* text.

---

## 152. COLOR CONSISTENCY

Una categoría debe conservar su significado visual cuando sea razonable.

No hagas:

Ventas = rosa en un gráfico

Ventas = azul en otro

Ventas = verde en otro

sin motivo.

---

## 153. COLORES SEMÁNTICOS VS SERIES

Diferencia:

SEMANTIC COLORS

de:

DATA SERIES COLORS.

Rojo/verde deben reservarse principalmente para significado cuando corresponda.

No conviertas cada gráfico en un semáforo.

---

## 154. VISUALIZACIONES NO DECORATIVAS

No añadas un gráfico solo porque queda un hueco.

Cada visualización debe responder una pregunta explícita.

Antes de crear un gráfico documenta internamente:

QUESTION

DATA

CHART TYPE

WHY THIS CHART

USER DECISION.

---

## 155. CHART SELECTION ALGORITHM

Selecciona el gráfico según la pregunta:

CHANGE OVER TIME
→ LINE / AREA
CATEGORY COMPARISON
→ BAR
PART OF WHOLE
→ DONUT / PIE / STACKED
RANKING
→ HORIZONTAL BAR
CONVERSION PROCESS
→ FUNNEL
RELATIONSHIP
→ SCATTER
INTENSITY ACROSS TWO DIMENSIONS
→ HEATMAP
SMALL KPI TREND
→ SPARKLINE

Esto es una guía.

Utiliza juicio de diseño.

---

## 156. NO 3D CHARTS

No utilizar:

* 3D pie;
* 3D bars;
* perspectiva;
* efectos volumétricos.

Priorizamos precisión visual.

---

## 157. NO CHART JUNK

Evita:

* grids excesivos;
* borders;
* sombras;
* gradients innecesarios;
* labels repetidos;
* leyendas gigantes;
* markers en cada punto si no son necesarios.

Los datos deben ser protagonistas.

---

## 158. NO ESCONDER DATOS IMPORTANTES

Minimalismo no significa ocultar información necesaria.

Una interfaz financiera puede ser densa si esa densidad es útil.

Prioriza:

INFORMATION DENSITY

VISUAL HIERARCHY.

---

## 159. DATA INK

Maximiza la proporción de elementos visuales que realmente comunican información.

Reduce decoración.

La interfaz debe parecer diseñada por alguien que entiende los datos, no por alguien que
está rellenando un dashboard.

---

## 160. DASHBOARD COMO NARRATIVA

Cuando los datos lo permitan, organiza Dashboard conceptualmente:

1. CURRENT STATE
   ¿Cómo estamos?
2. TREND
   ¿Cómo estamos evolucionando?
3. COMPARISON
   ¿Mejor o peor que antes?
4. COMPOSITION
   ¿De dónde viene el resultado?
5. ATTENTION
   ¿Qué requiere atención?
6. ACTION
   ¿Qué puedo hacer?

No es obligatorio que sean seis bloques visuales separados.

Es una jerarquía informativa.

---

## 161. FINANZAS COMO NARRATIVA

Finanzas debería permitir responder progresivamente:

¿Cuánto ingresamos?
↓
¿Cuánto gastamos?
↓
¿Cuál es el resultado?
↓
¿Cómo está evolucionando?
↓
¿Qué lo explica?
↓
¿Qué movimientos lo componen?

Utiliza visualizaciones diferentes según cada pregunta.

---

## 162. EVITAR DASHBOARD MONÓTONO

No utilices necesariamente el mismo tamaño de widget para todo.

La composición puede tener:

* KPI compacto;
* gráfico principal ancho;
* breakdown lateral;
* tabla detallada;
* insight contextual.

La jerarquía visual debe reflejar jerarquía informativa.

---

## 163. EDITORIAL LAYOUT

Piensa algunas pantallas como composición editorial:

PRIMARY INFORMATION

SECONDARY INFORMATION

DETAIL.

No como un grid automático de componentes.

---

## 164. HUMAN DESIGN REVIEW

Después de implementar cada pantalla importante, realiza una revisión visual específica
preguntando:

¿Parece una herramienta diseñada para este negocio?

¿O podría ser cualquier dashboard generado por IA?

Si pudiera pertenecer a cualquier SaaS sin cambiar nada:

el diseño todavía es demasiado genérico.

---

## 165. BUSINESS-SPECIFIC DESIGN

Busca oportunidades para que la interfaz represente los workflows, métricas y decisiones
reales del negocio.

No mediante decoración o branding excesivo.

Mediante:

* estructura;
* información;
* visualización;
* interacción;
* prioridades.

---

## 166. REGLA FINAL DE VISUALIZACIÓN

No quiero:

CARDS EVERYWHERE.

No quiero:

CHARTS EVERYWHERE.

Quiero:

THE RIGHT REPRESENTATION FOR THE RIGHT INFORMATION.

Una cifra puede ser texto.

Una tendencia puede ser una curva.

Una composición puede ser donut.

Una comparación puede ser barras.

Una evolución puede ser línea.

Un proceso puede ser funnel.

Un detalle puede ser tabla.

Una anomalía puede ser alerta.

Una acción puede ser botón.

Escoge la representación por significado, no por estética.

---

## 167. CRITERIO VISUAL FINAL

El resultado debe sentirse:

PROFESSIONAL

PURPOSEFUL

DATA-RICH

CALM

PRECISE

BUSINESS-SPECIFIC

HUMAN-DESIGNED

y NO:

GENERIC

TEMPLATE-LIKE

AI-SLOP

OVERDESIGNED

DECORATIVE

CARD-HEAVY.

La interfaz debe demostrar que comprende el negocio y sus datos.
