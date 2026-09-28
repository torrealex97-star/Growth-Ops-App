# Auditoría visual de Growth Ops — 2026-09-15

Referencia: dashboard oscuro suave y embudo horizontal continuo aprobado en el chat.
Ámbito: presentación; mantener métricas, filtros, permisos y branding de cada tenant.

| Área                        | Diferencia detectada                                            | Corrección                                                                                      |
| --------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Dashboard                   | Funnel enterrado y demasiadas filas antes de la evolución       | Funnel al principio; comisiones laterales; cuatro KPI principales debajo                        |
| Métricas / Ventas / Ranking | Etapas independientes y comportamiento móvil con scroll lateral | ConnectedFunnel compartido; silueta continua en panel ancho y etapas apiladas en panel estrecho |
| KPI compartidos             | Iconos grises sin relación visual con la referencia             | Acento suave del tenant en círculos, manteniendo tipografía y valores                           |
| Finanzas                    | Hueco grande debajo del desglose de gastos                      | Evolución como panel principal y desglose, devoluciones y neto en la columna lateral            |
| Campañas                    | Nombres de campaña aún demasiado largos en los ejes             | Etiquetas visuales abreviadas, sin recortar los datos del gráfico                               |
| Localhost                   | Caché de Next incompleta: error 500                             | Regeneración de caché y reinicio del servidor de desarrollo                                     |

## Verificación

- Inspección visual autenticada con datos de WDC; revisión del funnel móvil a 390px.
- quality: formato, lint y TypeScript correctos; 343 pruebas generales y 648 de métricas pasan.
- No se añadieron metas, series o datos ficticios para reproducir partes de la imagen que no existen en la app.
- Las siluetas de funnel son esquemáticas; cantidades y conversiones mantienen los valores existentes.
- VSL, Actividad y Proyección siguen sujetos a sus estados vacíos actuales: la revisión poblada requiere datos existentes en esas vistas.
- El usuario autorizó la publicación tras superar el gate local. La fusión sigue condicionada a CI y revisión de Preview.

## Revisión transversal — 28 septiembre, antes del cierre de PR #278

Se inspeccionaron visualmente versiones local y producción; no confundir esas observaciones con la verificación del último código. Plan ejecutable y limitaciones en `ACTIVE_HANDOFF.md`, sección «Relevo prioritario». No hay modificación de datos de negocio.

| Pantalla inspeccionada    | Hallazgo                                                        | Estado del lote                                                    |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| Embudo de ventas, ranking | Reservas contadas como cierres; ratios de hechos independientes | Corrección canónica, pendiente revalidación visual tras despliegue |
| Tendencias                | Comparación entre mitades del mismo periodo                     | Helper probado: total completo y comparación explícita             |
| Meta campañas             | Alcance no aditivo y comparación anterior falsa                 | Corregido; endpoint local requiere configuración servidor          |
| Atribución                | Histórico y periodo mezclados; cobertura y población            | Pendiente, refactorización experimental excluida                   |
| Resumen financiero        | Cobros internos y consolidado con distinta cobertura            | Conciliación existente; claridad visual pendiente                  |
| P&L y gastos              | Alcance de libro interno y gastos registrados poco claro        | Etiquetas y resultado firmado corregidos                           |
| Cohortes financieras      | Ventanas inmaduras coloreadas como resultados malos             | Madurez y elegibilidad corregidas, regresiones añadidas            |
| Proyección y morosidad    | Sin planes cargados; cero no demuestra cobertura completa       | Pendiente aviso de cobertura y validación funcional                |
| VSL                       | Sin visionados mostraba tasas cero y ausencia de caídas         | Corregido estado sin muestra; VSL carga en producción              |
| Funnels                   | Reservas, deduplicación y conversiones sin cohorte              | Recuentos compartidos y tasas/pérdidas bloqueadas                  |
| Instagram                 | Suma de reach de reels no es alcance único del periodo          | Pendiente definición/etiqueta y pestañas secundarias               |
| Colaboradores             | «Facturación (cash)», reservas y signo de comisión              | Etiquetas/eligibilidad corregidas; paginación pendiente            |
| Comisiones                | Creación y liquidación no son la misma fecha                    | Pendiente armonizar alcance visible, sin alterar datos             |
| Analítica general         | Salud máxima con cobertura baja y cash no consolidado           | Prioridad alta pendiente; NO certificada como consistente          |
| Contenido                 | Tabla editorial vacía explícita                                 | Inspeccionada; no requiere inventar KPIs                           |

Pendiente completar comprobación visual final de Actividad, dashboard principal, Ventas/registro y Cobros/conciliación, además de móvil tras build. Clientes no se redefine sin el usuario.
