---
name: sales-engineering
description: >-
  Sistema completo de Sales Engineering & Commercial Operations para negocios
  high-ticket: prospección y cualificación, ejecución del cierre, matriz de
  objeciones, post-llamada, reclutamiento/onboarding, control de marco y
  metrología (KPIs + unit economics). CONSULTAR SIEMPRE antes de codificar o
  modificar flujos de ventas, CRM, agents de IA comerciales, secuencias SMS,
  dashboards de KPIs o landing pages de captación.
version: 1.0.0
globs:
  - 'app/**/crm/**'
  - 'app/**/ventas/**'
  - 'app/**/comisiones/**'
  - 'app/**/colaboradores/**'
  - 'app/**/finanzas/**'
  - 'lib/commissions/**'
  - 'lib/finance/**'
  - 'src/prompts/**'
  - 'docs/rag_sales_knowledge_schema.json'
---

# SKILL: SALES ENGINEERING & COMMERCIAL OPERATIONS (HIGH-TICKET OS)

Conocimiento canónico del motor comercial de la plataforma. Cualquier trabajo de
código que toque ventas, CRM, agents de IA, tracking, comisiones, dashboards de
KPIs o embudos DEBE leer primero la sección correspondiente de este documento.

**Arquitectura en este repositorio:**

| Pieza                              | Ubicación                                  | Uso                                            |
| ---------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| System Prompt del agente comercial | `src/prompts/sales_agent_system_prompt.ts` | Importable por la ruta de IA de la app         |
| Esquema de metadatos RAG           | `docs/rag_sales_knowledge_schema.json`     | Indexación de KPIs y scripts en base vectorial |
| Mapeo KPI → implementación         | §7 (tabla final)                           | Dónde vive cada métrica en la app              |

---

## MÓDULO 1: FASE PRE-LLAMADA (PROSPECCIÓN, CUALIFICACIÓN Y PRE-FRAMING)

- **Speed to Lead (< 5 Minutos):** Primer contacto inbound en <5 min desde el registro. Lista Priority 1 (P1) procesa con doble llamada (double dial).
- **Densidad de Contacto (Touch Density = 10 Intentos):** Promedio de 10 intentos secuenciales para prospectos que no responden.
- **Estructura de Listas CRM:**
  - **Priority 1 (P1 - Inbound Sets):** Doble llamada inmediata (<5 min).
  - **Priority 2 (P2 - No-Shows y Cancelaciones):** Re-agendamiento por alta intención previa.
  - **Priority 3 (P3 - No Answers / Reintentos):** Reintentos en diferentes bloques horarios.
  - **Priority 4 (P4 - Pipeline Antiguo / Reactivación):** Leads de >30-60 días activados por The Cleaner.
- **Scoring Predictivo (Grados 1 al 4):**
  - **Grado 1 (DQ):** Descalificado. Cancelar cita e indicar Opt-Out.
  - **Grado 2 (Setter / Triage):** Incierto. Enviar a Setter para llamada de filtro (Triage Call).
  - **Grado 3 (Closer):** Apto. Agendar en Closer. Double Booking si Show Rate es <65%.
  - **Grado 4 (Closer VIP):** ICP Perfecto. Single Booking en slot exclusivo.
- **Formulario Pre-Llamada (3 Preguntas Clave):**
  1. **Urgencia:** "¿Cuándo estás listo para avanzar y solucionar esto?" (Target: Inmediato).
  2. **Autoridad:** "¿Necesitas la aprobación de un socio o pareja para tomar la decisión?" (Target: Decisiones independientes).
  3. **Capacidad Financiera:** "¿Cuentas con capital o liquidez disponible para invertir en resolver esto hoy?" (Target: Sí).
- **Rolling 2-Day Window:** Mostrar disponibilidad máxima para las próximas 24-48 horas.
- **Protocolo LNS (Lead Nurture Specialist):**
  - **Inmediato:** "Hola [Nombre], soy [LNS] de [Empresa]. Vi en tu aplicación que indicaste '[Cita textual de problema]'. Estoy entusiasmado de que [Closer] hable contigo sobre cómo alcanzar [Meta]. ¿Podrías responder 'Sí' para confirmar?"
  - **24h Antes:** "Hola [Nombre], ¿cuánto tiempo llevas intentando solucionar [Problema]?"
  - **8h Antes:** "Terminando de preparar la llamada hoy. ¿Qué punto específico quieres asegurar que cubramos?"
  - **1h Antes:** "Terminando la preparación. ¡Nos vemos en una hora!"
  - **15m Antes:** "Te dejo por aquí el enlace directo a Zoom: [Link]"
- **Página de Confirmación con Doble Video:** Video 1 (Logística / How Video - 90s) + Video 2 (Preparación / VSL Why Video).
- **Call Notes Pre-Llamada:** Ficha con Propietario, Industria, Años, Ingresos, Margen, Canal Captación, Constraint Label y Objeciones Anticipadas.

## MÓDULO 2: FASE EN LA LLAMADA (EJECUCIÓN DEL CIERRE - KILL MODE)

- **Tonalidad y Control Paralingüístico:** 150-170 PPM, enunciación nítida y Pausa de 8 Segundos Post-Cierre (silencio absoluto tras pedir la venta).
- **Apertura y Disparo de Marco (30-60s):**

  > "[PROSPECTO]?... Hola, habla [NOMBRE] de [EMPRESA], en una línea grabada... ¿Cómo va todo? Excelente. Tenemos 20 minutos reservados hoy, así que ¿te parece bien si vamos directo al grano? Perfecto. La idea es revisar las métricas de tu negocio para ver si somos un buen encaje... Y si es así, te muestro cómo funciona [PRODUCTO]... Y si las cosas tienen sentido, te explico cómo dar el paso. Si no, sin problema. ¿Te parece bien?"

- **Descubrimiento Profundo NEPQ & Pain Cycle (9 Pasos):**
  1. Situación Actual → 2. Situación Deseada → 3. Obstáculo (Pain) → 4. Razón Profunda → 5. Pull Teeth → 6. Recapitulativo → 7. Etiquetado → 8. Confirmación → 9. Acumulación (Stacking Pain).
  - **Connecting:** "¿Qué fue lo que te llevó a buscar una solución hoy en lugar de seguir posponiéndolo?"
  - **Situation:** "¿Cuánto estás facturando hoy y cuántos clientes nuevos generas al mes?"
  - **Problem Awareness:** "¿Qué es lo que está haciendo que sientas que no puedes escalar al siguiente nivel?"
  - **GPCT:** Meta en 6 meses (Goal), Plan actual (Plan), Desafío operativo (Challenge), Cuándo resolverlo (Timeline).
  - **Consequence / Urgency:** "Si sigues obteniendo estos mismos resultados los próximos 6 meses... ¿qué impacto va a tener en tu negocio y vida?"
  - **Guion Stacking Pain:** "Para asegurar que entendí bien... Intentaste X, invertiste Y, no funcionó y ahora tienes dudas. Por ende, el problema real es Z... ¿es correcto?"
- **Presentación en Diálogo (3 Columnas & Stacking Offer):**

  Estructura: Problema del Cliente → Solución (Feature) → Tranquilidad (Assurance) → Beneficio Transformacional.

  Transición: "Dado que tus principales cuellos de botella son [P1] y [P2], me encantaría mostrarte cómo lo resolvemos. ¿Te parece bien si te explico los detalles?"

- **Revelación de Precio:**

  > "Para poner todo esto en marcha, la inversión es de $5,000. ¿Prefieres Visa, MasterCard o transferencia?" → SILENCIO ABSOLUTO (8+ Segundos).

- **Algoritmo de Bucle de Objeciones (Objection Looping):**
  1. **Confirmar Valor:** "Dejando la inversión de lado, ¿crees que este programa es lo que necesitas para llegar a [Meta]?"
  2. **Aislar Objeción:** "Aparte de [Objeción reflejo], ¿cuál es el obstáculo principal?"
  3. **Ciclo Looping:** Acknowledge (Validar con "Y", nunca "Pero") + Address (Reencuadrar) + Ask (Pedir cierre).

## MÓDULO 3: MATRIZ DE OBJECIONES Y GUIONES TEXTUALES DE CIERRE

- **Tiempo / Prioridad:** "Totalmente comprensible... Y esa es probablemente la mejor razón para entrar hoy. Te ayudaremos a liberar tiempo desde la semana 1. ¿Cómo suena eso?"
- **Dinero / Valor:** "Entiendo que se sienta como mucho dinero... Y es bueno que sea así. Que sea una inversión significativa garantiza que lo vas a ejecutar. ¿Listos para avanzar?"
- **Recursos / Liquidez:** "Nadie tiene el dinero guardado esperando este momento. Si sabes que esto soluciona tu negocio de raíz, ¿eres lo suficientemente recursivo para conseguir el capital hoy?"
- **Competencia:** "Conoces la regla: Bueno, Rápido y Barato; solo puedes elegir dos. Nosotros lo hacemos bien y rápido. La opción barata sale más cara al final. ¿Avanzamos?"
- **Descuentos:** "Uhh... podríamos hacerlo por más dinero (jaja). Si reduzco el precio, reduzco el soporte que garantiza tu resultado. ¿Prefieres tarjetas o transferencia?"
- **Pareja / Socio:** "Entiendo. ¿Y si tu pareja te dice que no? Si me dices que lo harías de todos modos, ¡avancemos! Si dices que no, ¿qué parte crees que no aprobaría? No necesitas su permiso, necesitas su apoyo."
- **Incertidumbre:** "¿Sabías que 'decidir' viene del latín 'decadere', que significa cortar opciones? Al no tomar la decisión hoy, estás decidiendo quedarte donde estás. En una escala del 1 al 10, ¿dónde te encuentras?"
- **Evaluación de Riesgo:** "Sopesemos las opciones. Opción 1: Lo haces y consigues el resultado. Opción 2: No lo haces y garantizas quedarte igual. Opción 3: Lo haces, no funciona y te devuelvo tu dinero. ¿Cuál opción te acerca a tu meta?"
- **Sin Tarjeta a la Mano (ID Trick):** "Abre tu app bancaria en el teléfono, ve a estados de cuenta y ahí verás el número de cuenta. Yo voy buscando el código de transferencia mientras lo haces."
- **Apertura Setter:** "Hola [Nombre], vi que agendaste para el [Día/Hora]... Se me acaba de liberar un espacio ahora mismo... ¿Sería una locura si hacemos la llamada de una vez y nos ahorramos la espera?"
- **Outbound SMS Sequence:** SMS 1 (Lead Magnet) → SMS 2 (Pregunta Cuello de Botella) → SMS 3 (Indagar especificidad) → SMS 4 (Envío de PDF de valor).

## MÓDULO 4: FASE POST-LLAMADA (REFORZAMIENTO Y RETENCIÓN)

- **Inmunización (The Handshake):** Video personalizado del CSM/CEO tras el pago para eliminar el buyer's remorse.
- **Extracción de Referidos en Caliente:** Pedir introducciones directas inmediatamente después de cerrar el pago.
- **Regla BAMFAM (Book A Meeting From A Meeting):** Agendar fecha y hora exacta en calendario antes de finalizar una llamada no cerrada.
- **Value-Driven Follow-Up:** Toque 1 (Video Selfie de valor), Toque 2 (Caso de estudio específico), Toque 3 (Escasez real).
- **Sequence "Going Negative":** "Hola [Nombre], te busqué sobre la estrategia para corregir [Problema]. Como no he tenido respuesta, asumiré que solucionar esto ya no es una prioridad para ti. Si las cosas cambian, me avisas. ¡Un saludo!"
- **EOD Checklist del Closer:** Registro CRM, notas de citas, procesar opt-outs, envío de peor llamada (Gametape) e Inbox Zero.

## MÓDULO 5: RECLUTAMIENTO, ONBOARDING Y RAMP-UP (SALES LEADERSHIP OS)

- **Roberge Framework (5 Atributos):** Coachability (Evaluación con roleplay y feedback inmediato), Curiosity, Prior Success, Intelligence, Work Ethic.
- **Referidos Forzados (Forced Referrals):** Sesión de 20 min con el nuevo hire para filtrar 15-20 contactos clave de su LinkedIn e iniciar introducciones en caliente.
- **Onboarding 14 Días (4 Fases):** Fase I (Días 1-2: Memorización con Marcador Negro / Blackout Method), Fase II (Días 3-5: Tonalidad y Recaps), Fase III (Días 6-10: Bucle de Objeciones), Fase IV (Días 11-14: Shadowing y Citas Live).
- **Ramp-Up Gamificado por Puntos:** Acumular 250 de 300 puntos en el Mes 1. $500 Bonus Rule si alcanza la meta; si logra 249 pts no cobra el bono.
- **Reglas de Desvinculación:** Regla de 50 llamadas (si Close Rate es <10% tras 50 llamadas live) y Regla de 4 Semanas (4 semanas seguidas en el 10% inferior del equipo).

## MÓDULO 6: CONTROL DE MARCO AVANZADO (FRAME CONTROL MASTERY)

- **Marco Pastor y Oveja:** El closer (Pastor) guía con liderazgo y responsabilidad al prospecto (Oveja) atrapado en excusas de regreso al marco de la verdad.
- **Las 5 Dimensiones de Verdad vs Falsedad:** Claridad (Especificidad vs Vaguedad), Enfoque (Realidad cruda vs Positivismo falso), Culpabilidad (Responsabilidad vs Terceros), Línea de Tiempo (Presente activo vs Pasado/Futuro) y Coherencia (Datos e identidad vs Historias).
- **Tácticas de Desarme:** Uso de lenguaje neutral ("evaluar encaje") e interrupción de patrón por sonido de papel arrugado en outbound.
- **Regla de las 2 Ventas:** Venta #1 (El Método/Vehículo) → Venta #2 (El Producto/Oferta). Jamás dar precio sin cerrar la Venta #1.
- **Quemar Puentes Pre-Cierre:** Desarmar alternativas en el descubrimiento para erradicar la opción de "hacerlo solo" antes de revelar el precio.
- **Las 10 Reglas de Oro de Hormozi:** Validar con "Y", pedir permiso de coach ("Can I put my coach hat on?"), apilar cierres, las observaciones no son objeciones, NUNCA cambiar el precio en caliente, Kind vs Nice, y guardar silencio absoluto tras el SÍ.

## MÓDULO 7: ARQUITECTURA DE MÉTROLOGÍA, KPIS Y UNIT ECONOMICS

- **Offers per Slot (KPI Primario Ops):** (Total Ofertas Presentadas en el Día) / (Total Slots Disponibles en Calendario). Target: 3+ ofertas/día por closer.
- **CPTQO (Métrica Norte Ad Tracking):** (Gasto Total Publicidad) / (MQLs Inbound Grado 3/4 + Sets Cualificados de Setters). Debe ser <= CPMQL.
- **Show Rate %:** (Llamadas Asistidas Live / Citas Agendadas) * 100. Benchmarks: 55-65% bueno, >65% elite.
- **Confirmation Rate %:** (Citas Confirmadas / Agendadas) * 100. Target: >50-70%.
- **Offers Made %:** (Ofertas / Llamadas Live) * 100. Target: >80%.
- **Close Rate %:** (Ventas / Llamadas Live) * 100. Target: 25-35% en frío.
- **CPMQL:** B2C ($100-$350), B2B ($300-$600).
- **PIF Rate % (Paid in Full):** (Ventas Contado / Cierres Totales) * 100. Target: >60%.
- **Cash Collected Ratio:** (Efectivo Real Ingresado / Facturación Contratada) * 100. Target: >70%.
- **Customer Retention Rate (CRR %):** ((Clientes Final - Nuevos) / Clientes Inicio) * 100. Churn Target: <5% mensual.
- **Gross Profit Margin %:** ((Ingresos - COGS) / Ingresos) * 100.
- **Unit Economics Outbound:** Ticket mínimo $15,000 USD, LTV Target $40,000 USD. Ecuación: 100 Dials → 2 Citas Asistidas → 1 Cierre.
- **Salarios y OTE Tiers:**
  - **BDR Junior:** OTE ~$40k
  - **Setter:** OTE $55k-$70k
  - **Closer:** OTE $120k-$220k+
  - **Promotion Tiers:** Sales Associate ($40k base/$40k var), Senior Sales Associate ($40k base/$50k var), Principal Sales Associate ($40k base/$60k var)

---

## APÉNDICE A: MAPEO DE LA SKILL A LA IMPLEMENTACIÓN EN ESTE REPO

Al codificar, estos son los anclajes existentes donde vive (o debe vivir) cada
concepto del sistema comercial:

| Concepto de la Skill                 | Implementación en el repo                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Listas CRM P1-P4, scoring 1-4        | CRM (`app/[tenant]/crm`) — prioridad y grado como campos del lead; P1 exige doble llamada |
| Speed to Lead < 5 min                | Eventos de registro → tarea CRM inmediata; el agente puede sugerir el double dial         |
| Formulario pre-llamada (3 preguntas) | Campos del lead/contacto (urgencia, autoridad, capacidad) usados por el scoring           |
| Grados 3/4 para CPTQO                | `contact_attributions` + métricas de campañas (altas por campaña, vista admin)            |
| KPIs del §7                          | Dashboards de métricas y vista de comisiones; helpers de formato de `@/lib/utils`         |
| Base neta de comisiones              | `lib/commissions` (fee de pasarela real o del plan) — ver `feesForCollections`            |
| Ledger por lanes                     | `commissions.participant_type` (`setter` / `closer` / `collaborator`)                     |
| Agente de IA comercial               | `src/prompts/sales_agent_system_prompt.ts` + ruta de IA de la app                         |
| Índice RAG de scripts/KPIs           | `docs/rag_sales_knowledge_schema.json`                                                    |

## APÉNDICE B: REGLAS DE ORO PARA EL AGENTE/CÓDIGO

1. Nunca revelar el precio antes de la Venta #1 (Regla de las 2 Ventas, §6).
2. Toda validación usa "Y", nunca "Pero" (§2 y §6).
3. Las respuestas del agente que sugieran scripts DEBEN citar la categoría RAG
   (`objection_handling`, `pain_cycle`, `kpis`, `frame_control`, `hiring`) de la
   que provienen (ver `docs/rag_sales_knowledge_schema.json`).
4. Los KPIs se calculan con las fórmulas del §7 sin redefiniciones locales: si
   una métrica ya existe en la app, reutilízala; si no, añádela al catálogo del
   esquema RAG antes de implementarla.
5. Toda comunicación con leads respeta las ventanas del protocolo LNS (§1) y la
   secuencia Going Negative solo después de los 3 toques de Value-Driven
   Follow-Up (§4).
