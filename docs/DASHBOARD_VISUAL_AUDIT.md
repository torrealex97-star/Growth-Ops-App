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
