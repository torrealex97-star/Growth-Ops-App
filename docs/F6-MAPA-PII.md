# F6 — Mapa de PII

Fase: **F6**, adelantada tras F-1 por la Enmienda 1 de `docs/plan/00-constitucion.md`.
Prerrequisito del prompt de fase (`docs/plan/09-fases-f5-f9.md` §F6): _"Mapa de PII: inventario de
tablas, storage, vectores, raw, logs y proveedores externos"_, antes de escribir `erase_person`.

Fecha: 2026-09-21. Método: consultas de solo lectura a `pg_catalog` y `storage` del proyecto
`rgcbveflosqgxrcqlqzv`. No se modificó nada. **Este documento no contiene ningún dato personal**:
solo nombres de tabla y columna y recuentos agregados.

## 1. Lo que hay que borrar, y dónde está

`contacts` es el hogar declarado de la PII (`docs/plan/02-seguridad-privacidad.md` §5). El criterio
del inventario es el que hace o rompe `erase_person`: **¿la fila se puede alcanzar desde un
`contact_id`?** Si no, el borrado la deja atrás en silencio.

### 1.1 Alcanzable por `contact_id` — `erase_person` puede borrarlo

| Store                  | Columnas con PII                                                                                     | Filas con dato                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `contacts`             | `full_name`, `email`, `phone`, `first_name`, `last_name`, `instagram`, `notes`, y los `*_normalized` | **620** de 972 con email o teléfono        |
| `appointments`         | **`transcript`**, `notes`, `transcript_drive_url`                                                    | **107 transcripciones reales de llamadas** |
| `contact_notes`        | `note`                                                                                               | 0                                          |
| `activities`           | `notes`                                                                                              | 1                                          |
| `contact_attributions` | `utm_content`, `first_/last_utm_content`                                                             | 0                                          |
| `sales`                | `access_email`, `notes`                                                                              | 28 ventas                                  |
| `stripe_customers`     | `email`, `name`                                                                                      | **28**                                     |
| `contracts`            | `body_snapshot`, `notes`                                                                             | 0                                          |
| `csm_events`, `drops`  | `notes`                                                                                              | 0                                          |

`appointments.transcript` es el store más pesado en PII del sistema: 107 transcripciones de llamadas
con personas reales, dentro de una tabla de negocio central. Está correctamente vinculado, así que
no es un hueco — pero sí es el que más cuidado exige al borrar, porque el texto libre no se
anonimiza recortando una columna.

### 1.2 NO alcanzable por `contact_id` — el hueco real de F6

| Store                     | Columna         | Filas con dato | Consecuencia                                                                           |
| ------------------------- | --------------- | -------------- | -------------------------------------------------------------------------------------- |
| **`fathom_match_review`** | `invitee_email` | **177**        | `erase_person` no lo encuentra: 177 emails de personas reales sobrevivirían al borrado |

Es el **único** hueco con datos hoy. El resto de tablas con PII de terceros y sin `contact_id` están
vacías, lo que permite cerrarlas por diseño antes de que se pueblen:

| Store                         | Columna                      | Filas                     | Acción antes de que se pueble                                  |
| ----------------------------- | ---------------------------- | ------------------------- | -------------------------------------------------------------- |
| `stripe_payments`             | `customer_email`             | 69 filas, **0 con email** | Dejarla sin poblar, o añadir `contact_id`                      |
| `vsl_sessions`                | `lead_email`                 | 0                         | Añadir `contact_id` al identificar                             |
| `sequra_delinquent_customers` | `customer_email`             | 0                         | Añadir `contact_id`                                            |
| `email_messages`              | `to_email`, `reply_to_email` | 1                         | Añadir `contact_id`                                            |
| `ig_comments`                 | `username`                   | 0                         | `handle_only`, vía `contact_identities` (F7)                   |
| `call_recordings`             | `notes`                      | 0                         | Tiene `appointment_id`; verificar la cadena hasta `contact_id` |

### 1.3 PII del equipo, no de contactos

`users` guarda `full_name`, `email`, `personal_email`, `phone`, `address` y `dni` (4 filas, `dni`
vacío). **No entra en `erase_person`**, que es un comando por `contact_id`: el borrado de una
persona del equipo es un procedimiento distinto, con otra base legal y otra retención. Queda
anotado para que nadie lo confunda ni lo dé por cubierto.

## 2. Storage

| Bucket                | Público | Objetos |
| --------------------- | ------- | ------- |
| `contratos`           | no      | 0       |
| `facturas`            | no      | 0       |
| `grabaciones`         | no      | 0       |
| `ig-competitor-reels` | **sí**  | 2       |

Los tres buckets con PII potencial están **vacíos**, así que `erase_person` nace sin deuda de
ficheros. El único poblado es público y contiene reels de competidores: no es PII de contactos, pero
conviene no meter nada de personas ahí precisamente porque es público.

## 3. Vectores y RAG

`knowledge_chunks` (180 filas) contiene **solo skills de plataforma** — guiones, fórmulas y
frameworks—, no transcripciones ni mensajes de clientes. Verificado: `source` documenta el fichero
canónico de origen y la ruta `ai/knowledge` es de solo lectura.

La columna `content` es texto libre, así que el riesgo no es el contenido de hoy sino el de mañana.
La Enmienda 2 de la constitución ya congela la ingesta con PII hasta cerrar F6; este mapa es la
evidencia de que a día de hoy la línea no se ha cruzado.

## 4. Raw y eventos

- `raw_events`: 4 filas. Guarda payloads completos de proveedor, que **sí** pueden contener PII.
  `erase_person` debe alcanzarlos y la retención debe estar decidida antes de cerrar la fase.
- `canonical_events`: 4 filas. La regla es que `properties` no lleve PII ni cuerpos de mensaje; al
  borrar, se anula `contact_id` y el hecho permanece.
- `audit_logs`: 54 filas. Debe conservar el hecho del borrado con identificador no reversible, nunca
  la PII borrada.

## 5. Proveedores externos

`erase_person` no puede borrar en sistemas de terceros; debe **generar la lista de borrados aguas
abajo** y no declararse completo hasta registrar su estado. Los que hoy tienen datos de personas:

| Proveedor           | Qué tiene                                                 |
| ------------------- | --------------------------------------------------------- |
| GHL                 | Contactos y agendas: es la fuente que alimenta el webhook |
| Stripe              | 28 clientes con email y nombre                            |
| Fathom              | Grabaciones y transcripciones de llamadas                 |
| Calendly            | Invitados de las reservas                                 |
| Resend              | Registro de envíos de email                               |
| Gemini (embeddings) | Egreso de texto al vectorizar. Hoy solo skills, no PII    |

## 6. Qué se deduce para `erase_person`

1. **El alcance real es pequeño**: 620 contactos con email o teléfono, 107 transcripciones, 28
   clientes de Stripe. No es un borrado masivo, es un borrado preciso.
2. **Hay un único hueco con datos**: `fathom_match_review` y sus 177 emails sin `contact_id`.
   Vincularlos es un prerrequisito, no un extra — sin eso, el informe de borrado mentiría.
3. **Storage y vectores nacen limpios**, lo que permite dejar la puerta cerrada en vez de limpiar
   después.
4. **`appointments.transcript` es el store delicado**: texto libre con personas reales dentro de una
   tabla central. Anonimizar no es recortar una columna.
5. **`users` es un procedimiento aparte**, no parte de este comando.

## 7. Decisiones que bloquean el cierre de F6

El prompt de la fase lo dice explícitamente: _"La retención de raw y transcripciones debe estar
decidida antes de cerrar la fase"_. Son decisiones de negocio y base legal, no técnicas:

| Decisión                                     | Por qué bloquea                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Retención de `raw_events`                    | Determina si `erase_person` borra o anonimiza el payload, y con qué excepción registrada                |
| Retención de transcripciones de llamadas     | Son las 107 de `appointments.transcript`; la base legal decide si se conservan tras el borrado          |
| Qué hechos financieros se conservan y cuánto | Ventas, cobros y facturas pueden tener obligación legal de persistir; el plazo exacto lo fija un asesor |

Sin ellas, `erase_person` se puede **implementar y probar** —el comando, la idempotencia, el informe
por store— pero no se puede **graduar**, porque su política de retención estaría sin definir.
