REGLAS PERMANENTES DE DESARROLLO
Este repositorio utiliza agentes de IA como Claude Code y Codex para desarrollo.
Estas reglas son OBLIGATORIAS para cualquier agente o desarrollador que modifique el proyecto.
La aplicación utiliza principalmente:

* Vercel
* Supabase
* PostgreSQL
* Supabase Auth / Storage / Realtime / Edge Functions cuando corresponda
* El framework frontend/backend definido actualmente en el repositorio

Tu responsabilidad NO es únicamente completar la tarea solicitada.
También debes preservar:
arquitectura + integridad de datos + seguridad + rendimiento + simplicidad + mantenibilidad.
1. REGLA PRINCIPAL
Antes de escribir código:
ENTIENDE → BUSCA → REUTILIZA → MODIFICA → PRUEBA → REVISA
Nunca:
PROMPT → CÓDIGO INMEDIATO
Antes de implementar una feature o solucionar un bug, inspecciona primero las partes relacionadas del repositorio.
2. NO ROMPAS LO QUE FUNCIONA
Realiza el cambio mínimo necesario para solucionar correctamente el problema.
No aproveches una tarea pequeña para hacer un refactor masivo no solicitado.
No cambies arquitectura estable únicamente por preferencias personales.
Un cambio arquitectónico debe mejorar de forma demostrable al menos uno de:

* seguridad;
* integridad;
* rendimiento;
* simplicidad;
* fiabilidad;
* mantenibilidad;
* coste.

3. BUSCA ANTES DE CREAR
ANTES de crear:

* componente;
* hook;
* helper;
* service;
* repository;
* función;
* endpoint;
* server action;
* tipo;
* schema;
* tabla;
* columna;
* RPC;
* Edge Function;

busca si ya existe algo equivalente.
No crees:
`createProject`
si ya existe:
`saveProject`
con la misma responsabilidad.
Extiende o reutiliza la implementación canónica cuando corresponda.
4. EVITA DUPLICACIONES
Existe una sola implementación canónica para cada operación empresarial importante.
Evita duplicar:

* validación;
* autorización;
* queries;
* transformaciones;
* constantes;
* enums;
* tipos;
* lógica de negocio;
* tratamiento de errores.

Si encuentras dos implementaciones equivalentes durante una modificación:
evalúa consolidarlas si puede hacerse con bajo riesgo.
5. GOLDEN PATH
Para operaciones relevantes utiliza conceptualmente:
UI
↓
SERVER BOUNDARY
↓
VALIDATION
↓
AUTHENTICATION
↓
AUTHORIZATION
↓
BUSINESS LOGIC
↓
DATA ACCESS
↓
SUPABASE / POSTGRESQL
↓
CACHE INVALIDATION
↓
RESPONSE
No todas las operaciones necesitan todas las capas.
NO construyas abstracciones vacías simplemente para cumplir este diagrama.
6. COMPONENTES UI
Los componentes visuales deben centrarse principalmente en:

* presentación;
* interacción;
* estado estrictamente visual.

Evita introducir lógica empresarial compleja directamente en componentes.
Evita consultas Supabase dispersas por componentes si el proyecto ya dispone de una capa canónica para acceso a datos.
7. UNA SOLA FUENTE DE VERDAD
Antes de guardar información pregunta:
¿Dónde vive oficialmente este dato?
Evita mantener el mismo dato independientemente en:

* React state;
* context;
* global store;
* localStorage;
* Supabase;
* Auth metadata;
* URL;

sin una razón explícita.
Los valores derivados deben calcularse cuando sea razonable en lugar de almacenarse duplicados.
8. SUPABASE
Supabase/PostgreSQL constituye la fuente de verdad para datos persistentes salvo decisión arquitectónica explícita diferente.
No confíes en el frontend para proteger información.
Revisa siempre:

* RLS;
* ownership;
* foreign keys;
* constraints;
* índices;
* transacciones;
* autorización.

9. RLS OBLIGATORIO
Toda tabla nueva accesible mediante Supabase debe evaluar explícitamente Row Level Security.
No asumir:
"nadie consultará esta tabla directamente".
Para cada tabla determina:

* SELECT;
* INSERT;
* UPDATE;
* DELETE.

Comprueba especialmente aislamiento entre usuarios, equipos y organizaciones.
10. AUTORIZACIÓN
Ocultar un botón NO es autorización.
La autorización real debe aplicarse en:
SERVER
y/o:
DATABASE / RLS.
Nunca confíes únicamente en:
`userId`
`organizationId`
`projectId`
recibidos desde cliente.
Verifica ownership/permisos.
11. SERVICE ROLE
Nunca expongas:
`SUPABASE_SERVICE_ROLE_KEY`
al navegador.
Nunca coloques secretos en variables públicas.
Todo uso de service role debe estar justificado y limitado a servidor.
12. VARIABLES DE ENTORNO
Antes de crear una nueva variable:
busca si ya existe una equivalente.
Mantén `.env.example` actualizado.
Nunca escribas valores secretos reales en:

* código;
* documentación;
* tests;
* logs;
* commits.

13. DATABASE SCHEMA
Todo cambio estructural debe realizarse mediante migración reproducible.
No dependas exclusivamente de cambios manuales realizados desde Supabase Dashboard.
Incluye mediante migraciones cuando corresponda:

* tablas;
* columnas;
* constraints;
* índices;
* funciones;
* triggers;
* RLS;
* policies.

14. INTEGRIDAD DE DATOS
No confíes únicamente en TypeScript o validaciones frontend para reglas críticas.
Cuando corresponda utiliza PostgreSQL:

* NOT NULL;
* FOREIGN KEY;
* UNIQUE;
* CHECK;
* tipos apropiados.

Una base de datos debería intentar impedir estados imposibles.
15. OPERACIONES MULTI-STEP
Antes de implementar:
A
→ B
→ C
→ D
pregunta:
¿Qué sucede si C falla?
Si quedarían datos parcialmente modificados, considera una transacción.
Las operaciones empresariales críticas deben ser atómicas cuando sea necesario.
16. CONCURRENCIA
Antes de implementar escrituras importantes pregunta:
¿Qué sucede si esta operación ocurre dos veces simultáneamente?
Evalúa:

* UNIQUE constraints;
* transactions;
* locking;
* idempotency;
* optimistic concurrency;
* upsert.

No intentes resolver race conditions únicamente deshabilitando un botón.
17. IDEMPOTENCIA
Webhooks, pagos, jobs, imports y operaciones susceptibles de reintentos deben diseñarse considerando duplicados.
El mismo evento recibido dos veces no debería provocar dos efectos empresariales cuando solo corresponde uno.
18. ESTADOS
Para entidades con ciclos importantes evita transiciones arbitrarias.
Ejemplo:
`draft → pending → approved → completed`
Valida las transiciones cuando tengan consecuencias empresariales.
19. TYPESCRIPT
No utilices `any` para escapar del sistema de tipos.
Evita:

* `as any`;
* casts inseguros;
* `@ts-ignore`;
* `@ts-expect-error` injustificado.

Soluciona la causa real.
Los tipos deben representar los datos reales.
20. VALIDACIÓN
Nunca confíes en input externo.
Valida:

* forms;
* API bodies;
* query params;
* route params;
* webhooks;
* archivos;
* respuestas externas cuando corresponda.

Frontend validation = UX.
Server validation = seguridad.
Database constraints = integridad.
Son responsabilidades diferentes.
21. ERRORES
Nunca ignores silenciosamente errores.
Evita:

```text
catch (e) {}

```

y equivalentes.
Distingue:

* validation error;
* authentication error;
* authorization error;
* not found;
* conflict;
* external service error;
* unexpected error.

El usuario recibe un mensaje útil.
Los logs reciben contexto técnico seguro.
22. NO EXPONGAS INFORMACIÓN INTERNA
No envíes innecesariamente al navegador:

* stack traces;
* SQL;
* secretos;
* tokens;
* configuración interna;
* datos de otros usuarios;
* información sensible.

23. REQUESTS
Antes de añadir una llamada de red pregunta:
¿Ya tenemos este dato?
Evita:

* fetching duplicado;
* waterfalls;
* polling innecesario;
* N+1;
* llamadas secuenciales independientes.

Paraleliza operaciones independientes cuando sea seguro.
24. QUERIES
No utilices `SELECT *` por comodidad cuando solo necesitas pocos campos.
Evita descargar grandes conjuntos de datos para filtrarlos posteriormente en navegador.
Cuando sea posible:
FILTER
SORT
PAGINATE
en PostgreSQL.
25. ÍNDICES
No añadas índices indiscriminadamente.
Añade índices basándote en queries reales.
Evalúa especialmente columnas utilizadas frecuentemente en:

* WHERE;
* JOIN;
* ORDER BY;
* foreign keys;
* filtros multi-tenant.

26. CACHÉ
Toda escritura debe responder:
¿Qué datos cacheados quedan obsoletos?
Después de:
INSERT
UPDATE
DELETE
invalida/revalida lo necesario.
No introduzcas caché si no existe un beneficio razonable.
27. PERFORMANCE
No optimices prematuramente.
Pero tampoco introduzcas ineficiencias evidentes.
Vigila:

* bundle size;
* renders;
* requests;
* queries;
* payload;
* imágenes;
* llamadas externas;
* server execution;
* loops sobre datasets grandes.

Cuando hagas una optimización significativa intenta medir antes/después.
28. DEPENDENCIAS
Antes de instalar una librería pregunta:

1. ¿Ya existe una dependencia que resuelve esto?
2. ¿Puede resolverse claramente con pocas líneas?
3. ¿La dependencia está mantenida?
4. ¿Es compatible con el stack actual?

No aumentes dependencias sin necesidad.
Para librerías, SDKs y APIs consulta documentación oficial actual antes de introducir cambios importantes.
29. NO SOBREARQUITECTES
No introduzcas automáticamente:

* microservices;
* CQRS;
* event sourcing;
* repositories;
* factories;
* adapters;
* buses;
* dependency injection compleja;

si el problema no lo necesita.
Una función clara es mejor que cinco capas vacías.
30. CÓDIGO MUERTO
Cuando reemplaces funcionalidad, comprueba si la implementación anterior quedó sin consumidores.
Elimina código confirmado como muerto.
Pero nunca elimines algo simplemente porque "parece no usarse".
Busca referencias primero.
31. COMPATIBILIDAD
Antes de modificar:

* schema;
* API;
* tipos compartidos;
* nombres;
* estados;
* rutas;

busca todos sus consumidores.
Considera despliegues donde temporalmente frontend y backend puedan ejecutar versiones diferentes.
32. TESTS
Todo bug importante debería, cuando sea razonable, producir un test de regresión.
Prioridad:

1. seguridad;
2. permisos;
3. lógica empresarial;
4. operaciones de datos;
5. bugs reales;
6. flujos críticos.

No escribas tests que únicamente reproduzcan detalles internos irrelevantes.
33. BUG FIXING
Cuando recibas un bug:
NO pongas inmediatamente un parche.
Primero:
REPRODUCE
↓
TRACE
↓
ROOT CAUSE
↓
TEST
↓
FIX
↓
REGRESSION TEST
Soluciona la causa raíz.
34. UX
Toda acción debe contemplar:
IDLE
LOADING
SUCCESS
ERROR
Evita:

* doble submit;
* loading infinito;
* botones aparentemente rotos;
* errores invisibles;
* pérdida accidental de formularios.

35. OBSERVABILIDAD
Las operaciones importantes deberían poder diagnosticarse.
Cuando corresponda registra:

* operación;
* resultado;
* duración;
* error;
* request/correlation ID.

Nunca registres:

* passwords;
* tokens;
* cookies sensibles;
* API secrets;
* service role keys.

36. EXTERNAL APIs
Toda integración externa debe considerar:
TIMEOUT
ERROR
RETRY
RATE LIMIT
DUPLICATE RESPONSE
INVALID RESPONSE
No asumas disponibilidad del 100%.
37. VERCEL
Recuerda que las funciones serverless no deben depender de memoria local persistente.
No asumas que dos requests llegarán a la misma instancia.
Comprueba compatibilidad de runtime antes de utilizar APIs específicas de Node/Edge.
38. FEATURE FLAGS
Para funcionalidades nuevas de alto riesgo considera rollout progresivo.
Una feature problemática debería poder desactivarse sin desmontar media aplicación cuando sea razonable.
39. BACKWARDS COMPATIBILITY
Para cambios importantes de base de datos utiliza preferentemente:
EXPAND
↓
MIGRATE
↓
SWITCH
↓
CONTRACT
en lugar de cambios destructivos instantáneos.
40. ARCHITECTURE DECISIONS
Si introduces una decisión arquitectónica importante, documenta un ADR en:
`docs/adr/`
Explica:
CONTEXT
DECISION
ALTERNATIVES
CONSEQUENCES
No documentes decisiones triviales.
41. DOCUMENTACIÓN
Si un cambio modifica significativamente:

* arquitectura;
* base de datos;
* seguridad;
* flujo de desarrollo;

actualiza:
`ARCHITECTURE.md`
`DATABASE.md`
`SECURITY.md`
`DEVELOPMENT_RULES.md`
cuando corresponda.
La documentación debe describir el sistema actual.
42. PROTOCOLO ANTES DE MODIFICAR
Para cada tarea significativa realiza internamente:
TASK
¿Qué pide realmente el usuario?
EXISTING IMPLEMENTATION
¿Cómo funciona ahora?
DEPENDENCIES
¿Qué depende de ello?
ROOT CAUSE
Si es bug, ¿cuál es la causa?
MINIMAL SOLUTION
¿Cuál es el cambio correcto más pequeño?
RISKS
¿Qué podría romperse?
Después implementa.
No necesitas mostrar todo este razonamiento al usuario.
43. PROTOCOLO DESPUÉS DE MODIFICAR
Ejecuta las comprobaciones disponibles en el proyecto:
FORMAT
↓
LINT
↓
TYPECHECK
↓
TEST
↓
BUILD
Añade pruebas adicionales relevantes cuando corresponda.
No declares una tarea terminada si existe un fallo relacionado con tus cambios.
44. SELF-REVIEW OBLIGATORIO
Antes de finalizar cualquier tarea significativa revisa TU PROPIO CAMBIO como si fueras otro Staff Engineer.
Busca:

* bug;
* race condition;
* permiso incorrecto;
* query innecesaria;
* duplicación;
* código muerto;
* estado duplicado;
* missing error handling;
* missing cache invalidation;
* regresión;
* complejidad innecesaria.

Corrige los problemas encontrados antes de finalizar.
45. ADVERSARIAL CHECK
Para cambios críticos pregunta:
¿Qué ocurre si el usuario hace esto dos veces?
¿Qué ocurre con dos usuarios simultáneos?
¿Qué ocurre si pierde conexión?
¿Qué ocurre si Supabase falla?
¿Qué ocurre si una API tarda?
¿Qué ocurre si el request se reintenta?
¿Qué ocurre si la sesión expira?
¿Qué ocurre si intenta acceder a un ID ajeno?
¿Qué ocurre si llega input malicioso?
¿Qué ocurre si una operación termina a mitad?
46. REGLA ESPECIAL PARA VIBE CODING
Nunca añadas código simplemente para hacer desaparecer un error.
Ejemplos prohibidos:

* añadir `any` porque TypeScript protesta;
* añadir otro `useEffect` para sincronizar estados;
* añadir timeout para esconder una race condition;
* duplicar una función porque modificar la original resulta difícil;
* desactivar lint;
* ignorar una promise;
* capturar y descartar una excepción;
* desactivar RLS;
* utilizar service role para evitar solucionar permisos;
* eliminar un constraint para que un INSERT funcione.

Investiga la causa.
47. REGLA DE SIMPLIFICACIÓN
Después de implementar una solución pregunta:
¿Puedo conseguir exactamente el mismo resultado con menos estado, menos código o menos capas sin perder claridad?
Si sí:
simplifica.
Pero no conviertas código legible en código críptico únicamente para reducir líneas.
48. REGLA DE BOY SCOUT
Cuando trabajes en un área:
déjala ligeramente mejor de lo que estaba,
pero únicamente mediante mejoras:

* evidentes;
* pequeñas;
* seguras;
* relacionadas.

No conviertas esto en permiso para refactorizar todo el repositorio.
49. NO MODIFICAR PRODUCCIÓN DESTRUCTIVAMENTE
Nunca ejecutes automáticamente sobre producción:
DROP TABLE
DROP COLUMN
TRUNCATE
DELETE masivo
migraciones destructivas
cambios irreversibles
sin autorización explícita y estrategia de backup/rollback.
50. DEFINITION OF DONE
Una tarea NO está terminada porque:
"el código está escrito".
Está terminada cuando:

* comportamiento solicitado funciona;
* arquitectura existente sigue siendo coherente;
* datos permanecen íntegros;
* permisos siguen siendo correctos;
* errores están controlados;
* no introdujiste duplicación evitable;
* no introdujiste requests innecesarios;
* no dejaste código anterior muerto;
* tipos son correctos;
* tests relevantes pasan;
* lint/typecheck pasan;
* build pasa;
* documentación se actualizó cuando era necesario.

PROTOCOLO PARA NUEVAS FEATURES
Cada vez que recibas:
"Implementa X"
haz internamente:
DISCOVER
↓
DESIGN
↓
CHECK EXISTING PATTERNS
↓
IMPLEMENT
↓
SECURITY REVIEW
↓
DATA REVIEW
↓
PERFORMANCE REVIEW
↓
TEST
↓
BUILD
↓
SELF-REVIEW
Solo después considera terminada la feature.
PROTOCOLO PARA BUGS
Cada vez que recibas:
"Arregla X"
haz:
REPRODUCE
↓
TRACE END-TO-END
↓
IDENTIFY ROOT CAUSE
↓
CHECK RELATED CODE
↓
CREATE REGRESSION TEST
↓
FIX ROOT CAUSE
↓
TEST
↓
CHECK SIDE EFFECTS
↓
BUILD
↓
SELF-REVIEW
PROTOCOLO PARA CAMBIOS DE BASE DE DATOS
Haz:
UNDERSTAND CURRENT SCHEMA
↓
CHECK DATA
↓
CHECK CONSUMERS
↓
DESIGN MIGRATION
↓
CHECK RLS
↓
CHECK INDEXES
↓
CHECK BACKWARDS COMPATIBILITY
↓
DEFINE ROLLBACK
↓
MIGRATE
↓
TEST
PROTOCOLO PARA CAMBIOS DE AUTH/PERMISOS
Haz:
IDENTIFY ACTOR
↓
IDENTIFY RESOURCE
↓
IDENTIFY ACTION
↓
VERIFY OWNERSHIP
↓
SERVER AUTHORIZATION
↓
RLS
↓
NEGATIVE TEST
↓
CROSS-USER TEST
↓
CROSS-ORGANIZATION TEST
Prueba especialmente que un usuario NO pueda hacer lo que no debería.
PROTOCOLO PARA PERFORMANCE
Nunca digas:
"ahora es más rápido"
sin evidencia cuando pueda medirse.
Compara:
BEFORE
vs
AFTER
para:

* requests;
* queries;
* latency;
* payload;
* render;
* bundle;
* procesamiento.

PRINCIPIO FINAL
La prioridad NO es generar más código.
La prioridad es mantener un sistema:
SIMPLE
COHERENTE
SEGURO
RÁPIDO
PREDECIBLE
TESTEABLE
OBSERVABLE
MANTENIBLE
Si una solución necesita mucha complejidad para resolver un problema sencillo:
detente y busca una solución más simple.
Si existen dudas entre:
SOLUCIÓN INGENIOSA
y
SOLUCIÓN ABURRIDA Y CLARA
prefiere normalmente:
SOLUCIÓN ABURRIDA Y CLARA.
