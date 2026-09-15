// Frase diaria del equipo — pool curado y rotativo (mismo día = misma frase para todos, refuerza
// que el equipo "lee lo mismo" cada mañana). Sin llamada a IA en vivo: control total del tono de
// marca y cero coste/latencia. Rotación determinista por día del año, sin estado en BD.

const DAILY_QUOTES: string[] = [
  'Hoy no compites contra tu compañero, compites contra el que eras ayer.',
  'Un "no" de hoy es información, no un veredicto. Sigue.',
  'El equipo gana cuando cada uno suma su mejor versión, no una versión perfecta.',
  'La energía se contagia antes que las palabras. Entra fuerte.',
  'Detrás de cada meta hay una familia que celebra contigo cuando la cumples.',
  'La constancia vence al talento cuando el talento no es constante.',
  'Cada llamada es una oportunidad de cambiar el día de alguien, empezando por el tuyo.',
  'Ganar en equipo pesa el doble que ganar solo.',
  'Tu actitud de hoy es el único resultado que controlas al 100%.',
  'No necesitas sentirte listo, necesitas empezar.',
  'El que ayuda a su compañero también se está ayudando a sí mismo.',
  'La disciplina de hoy es la libertad de mañana.',
  'Celebra lo pequeño: los grandes resultados están hechos de eso.',
  'Nadie recuerda el objeción difícil, todos recuerdan cómo la resolviste.',
  'Tu familia no necesita que seas perfecto, necesita que estés presente y en paz.',
  'La mejor versión de ti aparece cuando decides mostrarla, no cuando la sientes.',
  'Un equipo que se anima entre sí gana más que uno que solo se compara.',
  'El foco de hoy: menos ruido, más acción.',
  'Cada "sí" que llega hoy es el resultado de todos los "no" que no te frenaron.',
  'Energía arriba: lo que transmites hoy, lo recibes multiplicado.',
  'La confianza se entrena igual que un músculo: con repetición.',
  'Trabajar en equipo es prestar tu fuerza en los días que al otro le falta.',
  'Hoy es un buen día para superar tu propio récord, no el de nadie más.',
  'Lo que haces con constancia termina pareciendo talento.',
  'El cliente no compra el producto, compra la energía con la que se lo cuentas.',
  'Cuida cómo hablas de tu día: tus palabras deciden tu ánimo antes que al revés.',
  'Un equipo fuerte no evita las caídas, se levanta más rápido.',
  'La gratitud de hoy multiplica la motivación de mañana.',
  'Nadie llega arriba solo. Reconoce a quien te ayudó a llegar hasta aquí.',
  'La mejor forma de motivar al equipo es ser el primero en dar el ejemplo.',
  'Vinimos a sumar, no a compararnos. Aporta lo tuyo hoy.',
  'El descanso también es parte del trabajo bien hecho. Cuídate para poder dar el 100%.',
  'La familia que te espera en casa es la razón, no la distracción.',
  'Si hoy cuesta, es porque estás construyendo algo que vale la pena.',
  'Cada objeción resuelta con calma es una prueba de que estás creciendo.',
  'Ser winner no es no fallar nunca, es no dejar de intentarlo.',
  'Comparte hoy una buena noticia con tu equipo: la alegría también se entrena.',
  'La actitud contagiosa de un compañero puede salvar el día de todo el equipo.',
  'Haz de hoy un día que tu yo de dentro de un año agradezca.',
  'El primer "sí" del día abre la puerta a todos los demás.',
  'No hay mal día que resista una buena conversación con tu equipo.',
  'Tu ritmo de hoy construye tu resultado del mes.',
  'La humildad para pedir ayuda es tan fuerte como la disciplina para trabajar solo.',
  'Cada meta cumplida en equipo es una historia que contar en casa esta noche.',
  'El cansancio se cura con descanso; la desmotivación se cura con propósito. Recuerda el tuyo.',
  'Enfócate en lo que sí puedes controlar: tu esfuerzo, tu actitud, tu constancia.',
  'Un equipo que celebra las victorias de los demás nunca deja de ganar.',
  'Hoy, sé la energía que quieres encontrar en los demás.',
  'El éxito de largo plazo se construye con la disciplina de los días aburridos.',
  'Cuando dudes de ti, recuerda por qué empezaste y por quién lo haces.',
  'La generosidad con el conocimiento hace crecer a todo el equipo, no solo a quien lo comparte.',
  'Ríe hoy con tu equipo: los mejores resultados salen de ambientes ligeros, no tensos.',
  'Cada cliente feliz es la prueba de que tu trabajo mejora vidas reales.',
  'Lo que hoy parece un obstáculo, en un mes será una anécdota de cómo creciste.',
  'La familia y el equipo se parecen: crecen cuando todos se sostienen mutuamente.',
  'Empieza el día agradeciendo algo pequeño, y verás cómo cambia todo lo demás.',
  'No busques motivación perfecta, busca disciplina imperfecta pero constante.',
  'El respeto al tiempo del cliente es respeto por tu propio tiempo también.',
  'Hoy alguien del equipo necesita tu energía más de lo que crees. Dásela.',
  'Ganar hoy es simplemente hacer lo correcto, otra vez, con ganas.',
]

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  const diff = date.getTime() - start.getTime()
  return Math.floor(diff / 86_400_000)
}

// Misma frase para todo el equipo el mismo día natural (zona España, mercado principal).
export function getDailyQuote(date: Date = new Date()): string {
  const madridDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  const madridDate = new Date(`${madridDateStr}T00:00:00Z`)
  const idx = dayOfYear(madridDate) % DAILY_QUOTES.length
  return DAILY_QUOTES[idx]
}
