import { can, type Permission } from "@/lib/auth/roles"
import type { Role } from "@/lib/db/schema"

/*
 * Contenido de la sección Ayuda del panel (/app/ayuda): cómo se usa cada
 * pantalla, paso a paso y sin jerga. Cada tema lleva el permiso de la pantalla
 * que explica, así a un profesional no le mostramos cómo pagar el plan.
 * Si cambia una pantalla, revisá su tema acá.
 */

export type HelpTopic = {
  /** Ancla dentro de la página (/app/ayuda#id). */
  id: string
  title: string
  /** Para qué sirve, en una frase. */
  summary: string
  /** Pantalla a la que lleva el botón "Ir a …". */
  href?: string
  hrefLabel?: string
  permission?: Permission
  steps: string[]
  tips?: string[]
}

export type HelpQuestion = { question: string; answer: string; permission?: Permission }

/** Lo primero que hay que hacer para que el bot empiece a dar turnos. */
export const gettingStarted: { title: string; detail: string; href: string; permission?: Permission }[] = [
  {
    title: "Cargá tus servicios",
    detail: "Nombre, duración y precio de lo que ofrecés.",
    href: "/app/servicios",
    permission: "manageServices",
  },
  {
    title: "Sumá a tu equipo y sus horarios",
    detail: "Cada profesional es una columna de la agenda.",
    href: "/app/equipo",
    permission: "manageTeam",
  },
  {
    title: "Revisá las reglas de reserva",
    detail: "Anticipación, cancelaciones y seña.",
    href: "/app/configuracion",
    permission: "manageBusinessSettings",
  },
  {
    title: "Probá el bot en el chat de prueba",
    detail: "Hablale como si fueras un cliente.",
    href: "/app/bot",
    permission: "manageBot",
  },
  {
    title: "Conectá tu WhatsApp",
    detail: "Desde ahí el bot empieza a responder a tus clientes.",
    href: "/app/configuracion#whatsapp",
    permission: "manageConnections",
  },
]

export const helpTopics: HelpTopic[] = [
  {
    id: "agenda",
    title: "Agenda",
    summary: "Todos los turnos del negocio, los que reserva el bot y los que cargás vos.",
    href: "/app/agenda",
    hrefLabel: "Ir a la agenda",
    steps: [
      "Elegí la vista arriba: Día (una columna por profesional), Semana o Lista. Con las flechas pasás de día o de semana, y con “Hoy” volvés al día de hoy.",
      "Para dar un turno a mano tocá “Nuevo turno”, o tocá un hueco libre de la agenda. Buscá al cliente por nombre o teléfono (o cargalo nuevo), elegí servicio, profesional y día, y tocá uno de los horarios libres.",
      "Tocá un turno para ver el detalle: cliente, servicio, precio, seña y el historial de cambios.",
      "Cuando el cliente se va, marcalo como “Atendido”. Si no vino, “No vino”: queda anotado en su ficha.",
      "Para cambiarlo de día u hora tocá “Reprogramar”; para cancelarlo, “Cancelar turno” (podés poner el motivo). Si el cliente tiene WhatsApp, le avisamos solos.",
      "Para vacaciones, almuerzos o feriados tocá “Bloquear”: elegí si es para un profesional o para todo el negocio, desde y hasta cuándo. Nadie puede reservar en un horario bloqueado.",
    ],
    tips: [
      "Los colores muestran el estado del turno, y el ícono de la moneda indica que tiene seña.",
      "La agenda se actualiza sola cada 20 segundos, así ves enseguida lo que reserva el bot.",
      "Si sos profesional, ves solo tu columna y tus turnos.",
    ],
  },
  {
    id: "conversaciones",
    title: "Conversaciones",
    summary: "Los chats de WhatsApp con tus clientes, respondidos por el bot o por tu equipo.",
    href: "/app/conversaciones",
    hrefLabel: "Ir a Conversaciones",
    steps: [
      "Acá ves cada chat con lo que escribió el cliente y lo que contestó el bot.",
      "Usá el filtro “Necesitan una persona” para ver los chats que el bot pasó al equipo: un reclamo, un pedido especial o algo que no supo responder.",
      "Tocá “Tomar conversación” para atenderla vos. Desde ese momento el bot deja de responder en ese chat y escribís desde el cuadro de abajo. Si escribís sin tomarla, la conversación pasa a estar a tu cargo igual.",
      "Cuando terminás, tocá “Devolver al bot” para que vuelva a responder él.",
      "Debajo de cada respuesta del bot podés marcar “Bien” o “Mal”. Con “Mal” anotás qué tendría que haber dicho; esas notas aparecen en la pantalla Bot para mejorarlo.",
    ],
    tips: [
      "Cuando el bot pasa un chat a una persona te llega un aviso, también por WhatsApp al dueño.",
      "WhatsApp solo deja escribir libremente dentro de las 24 horas desde el último mensaje del cliente.",
    ],
  },
  {
    id: "clientes",
    title: "Clientes",
    summary: "La ficha de cada cliente: visitas, gasto, inasistencias y notas.",
    href: "/app/clientes",
    hrefLabel: "Ir a Clientes",
    steps: [
      "Los clientes se crean solos cuando escriben por WhatsApp o cuando les das un turno. También podés cargar uno con “Nuevo cliente”.",
      "Buscá por nombre o teléfono y tocá un cliente para abrir su ficha.",
      "En la ficha ves sus próximos turnos, el historial, cuánto gastó, cuántas veces faltó y su conversación.",
      "Tocá “Editar” para agregar notas: preferencias, alergias o lo que te sirva recordar.",
    ],
    tips: ["La ficha completa viene con los planes Pro y Equipo."],
  },
  {
    id: "servicios",
    title: "Servicios",
    summary: "Lo que ofrecés: es lo que el bot cotiza y reserva.",
    href: "/app/servicios",
    hrefLabel: "Ir a Servicios",
    permission: "manageServices",
    steps: [
      "Tocá “Nuevo servicio” y cargá nombre, duración y precio. La descripción es opcional, pero el bot la usa para explicar el servicio.",
      "Elegí quién lo hace. Un servicio que nadie hace no se puede reservar.",
      "Si querés cobrar seña por ese servicio, cargala ahí (necesitás Mercado Pago conectado).",
      "“Cada cuántas semanas vuelve” es opcional: sirve para que el bot le proponga un turno al cliente cuando se está pasando (por ejemplo, 5 semanas para un corte).",
      "Si un servicio ya tiene turnos y lo borrás, lo pausamos en lugar de borrarlo, para no perder el historial.",
    ],
  },
  {
    id: "equipo",
    title: "Equipo",
    summary: "Quién atiende, en qué horario y quién puede entrar al panel.",
    href: "/app/equipo",
    hrefLabel: "Ir a Equipo",
    permission: "manageTeam",
    steps: [
      "Tocá “Nuevo profesional” por cada persona que atiende. Cada uno es una columna de la agenda.",
      "Elegí qué servicios hace, su color en la agenda y su horario de la semana. Un día puede tener varios tramos, por ejemplo de 9 a 13 y de 15 a 20.",
      "Para que alguien entre al panel, tocá “Invitar a alguien”, poné su email y elegí el rol. Le llega un correo para entrar con su cuenta de Google; la invitación vence en 7 días.",
      "Roles: Admin puede todo menos facturación, borrar el negocio y transferirlo. Profesional ve y gestiona solo su agenda y sus clientes.",
      "Si alguien deja de trabajar con vos, tocá “Quitar acceso”: se le cierra la sesión al instante.",
    ],
    tips: ["El plan Básico es para un profesional; para sumar más necesitás Pro o Equipo."],
  },
  {
    id: "bot",
    title: "Bot y chat de prueba",
    summary: "Cómo habla tu asistente, qué responde y un chat para probarlo antes de WhatsApp.",
    href: "/app/bot",
    hrefLabel: "Ir a Bot",
    permission: "manageBot",
    steps: [
      "Ponele nombre al asistente y elegí el tono: informal (de vos) o formal (de usted).",
      "Escribí el mensaje de bienvenida. El bot lo usa como base para saludar en el primer mensaje.",
      "Cargá tus preguntas frecuentes con su respuesta (por ejemplo, “¿Aceptan tarjeta?”). El bot responde con eso y no inventa.",
      "Elegí cuándo responde: siempre (las 24 horas) o solo en horario de atención, con un mensaje para fuera de horario.",
      "Probalo en el chat de prueba: escribile como si fueras un cliente (“Quiero un turno para mañana”). Debajo de cada respuesta ves qué consultó. Ojo: los turnos que reserve quedan en la agenda de verdad, borralos después.",
      "En “Mensajes automáticos” activás el pedido de reseña en Google después del servicio (pegá el enlace de tu Perfil de Empresa) y la reactivación de clientes que hace tiempo no vienen.",
      "En “Respuestas a mejorar” ves las respuestas que tu equipo marcó como “Mal” y lo que tendrían que haber dicho.",
    ],
    tips: [
      "El bot nunca inventa precios ni horarios: los saca de tus servicios, tu equipo y tu agenda.",
      "Si el cliente se enoja, reclama o pide hablar con una persona, el bot pasa el chat al equipo.",
    ],
  },
  {
    id: "catalogo",
    title: "Catálogo",
    summary: "Para inmobiliarias y tiendas: el bot aprende tus publicaciones y las manda con foto.",
    href: "/app/catalogo",
    hrefLabel: "Ir a Catálogo",
    permission: "manageCatalog",
    steps: [
      "Pegá la dirección de la página de tu web donde están tus propiedades o productos (por ejemplo, el listado de propiedades) y agregala.",
      "Responbot lee la página y las fichas. En unos minutos aparecen las publicaciones con título, precio, zona y fotos.",
      "Tocá una publicación para corregirla o cargá una a mano con “Nueva publicación”. Si una ya no se ofrece, sacala.",
      "Con “Volver a leer” actualizás lo que cambió en tu web. También se actualiza sola todos los días.",
      "Cuando un cliente pregunta (“¿tenés casas en alquiler en Pocitos?”), el bot busca en el catálogo y le manda las fichas con foto y link.",
    ],
    tips: [
      "Instagram y MercadoLibre no dejan leer sus páginas desde afuera: para esas va a haber que conectar la cuenta (próximamente).",
    ],
  },
  {
    id: "whatsapp",
    title: "Conectar WhatsApp",
    summary: "El número de tu negocio, para que el bot responda a tus clientes.",
    href: "/app/configuracion#whatsapp",
    hrefLabel: "Ir a Conexiones",
    permission: "manageConnections",
    steps: [
      "Andá a Configuración → Conexiones → WhatsApp y tocá “Conectar WhatsApp”.",
      "Se abre una ventana de Meta (la empresa de WhatsApp). Entrá con tu Facebook, elegí o creá tu cuenta de WhatsApp Business y el número del negocio.",
      "Al volver, el estado dice “Conectado”. Desde ese momento el bot responde los mensajes que llegan a ese número.",
      "Abajo vas a ver las plantillas de mensajes (recordatorios y avisos). Meta las revisa; cuando dicen “Aprobada” ya se pueden mandar.",
      "Si el estado dice “Hay que reconectar”, tocá “Volver a conectar” y repetí los pasos.",
    ],
    tips: [
      "Usá un número que no esté en la app común de WhatsApp en un celular, o pasalo a WhatsApp Business antes.",
      "Probá primero el bot en el chat de prueba, así sale a responder bien desde el primer día.",
    ],
  },
  {
    id: "mercadopago",
    title: "Señas con Mercado Pago",
    summary: "Cobrar una seña para asegurar el turno.",
    href: "/app/configuracion#mercadopago",
    hrefLabel: "Ir a Conexiones",
    permission: "manageConnections",
    steps: [
      "Andá a Configuración → Conexiones → Mercado Pago y tocá “Conectar Mercado Pago”. Entrá con la cuenta donde querés recibir la plata.",
      "En Configuración → Reglas de reserva activá la seña y elegí el monto: fijo o un porcentaje. También podés ponerla por servicio.",
      "Cuando alguien reserva, el bot le manda el link de pago. El turno queda retenido unos minutos; si no paga a tiempo, el horario se libera solo.",
      "En la agenda, el detalle del turno muestra si la seña está pendiente o pagada. Podés reenviar o copiar el link.",
      "Si el cliente cancela con tiempo según tu política, desde el detalle del turno tocás “Devolver seña”.",
    ],
    tips: ["Al marcar el turno como atendido, la seña se descuenta del precio."],
  },
  {
    id: "configuracion",
    title: "Configuración y reglas de reserva",
    summary: "Los datos del negocio y las reglas que siguen el bot y la agenda.",
    href: "/app/configuracion",
    hrefLabel: "Ir a Configuración",
    permission: "manageBusinessSettings",
    steps: [
      "En Negocio cargás nombre, tipo de negocio, dirección, zona horaria y moneda. El bot usa la dirección para decir dónde queda.",
      "En Reglas de reserva definís con cuánta anticipación mínima se puede reservar, hasta cuántos días hacia adelante, el descanso entre turnos, hasta cuántas horas antes se puede cancelar y si se cobra seña.",
      "En Conexiones están WhatsApp y Mercado Pago (ver arriba).",
    ],
  },
  {
    id: "notificaciones",
    title: "Notificaciones",
    summary: "Los avisos de reservas, cancelaciones y chats que necesitan a una persona.",
    href: "/app/notificaciones",
    hrefLabel: "Ir a Notificaciones",
    steps: [
      "En la bandeja ves los avisos del negocio. El número al lado de Notificaciones es lo que no leíste.",
      "En “Cómo te avisamos” elegís, para cada tipo de aviso, si te llega al panel, como notificación en el celular, por WhatsApp o por correo.",
      "Configurá las horas de silencio (por defecto de 22 a 8): en ese horario no te molestamos, salvo que un cliente necesite a una persona.",
    ],
    tips: [
      "Para recibir avisos en el celular, instalá el panel: en el navegador del celular, “Agregar a la pantalla de inicio”, y aceptá las notificaciones.",
    ],
  },
  {
    id: "estadisticas",
    title: "Estadísticas",
    summary: "Cómo viene el mes: turnos, ingresos, inasistencias y horarios más pedidos.",
    href: "/app/estadisticas",
    hrefLabel: "Ir a Estadísticas",
    permission: "viewStats",
    steps: [
      "Arriba ves los turnos del mes, lo cobrado, las inasistencias y cuántos turnos tomó el bot fuera de horario.",
      "Con las flechas pasás a meses anteriores y comparás.",
      "Las barras muestran los horarios y días más pedidos: sirven para decidir cuándo abrir o sumar gente.",
    ],
    tips: [
      "Los ingresos salen del precio de cada turno marcado como atendido, así que conviene marcarlos.",
      "Las estadísticas vienen con los planes Pro y Equipo.",
    ],
  },
  {
    id: "facturacion",
    title: "Plan y facturación",
    summary: "Tu plan, cuánto usaste este mes y tus pagos.",
    href: "/app/facturacion",
    hrefLabel: "Ir a Facturación",
    permission: "manageBilling",
    steps: [
      "Empezás con 14 días de prueba con todo incluido. El aviso de arriba del panel te dice cuántos días te quedan.",
      "En Facturación elegís el plan (Básico, Pro o Equipo) y pagás con tarjeta. Lo podés cambiar cuando quieras.",
      "En “Uso de este mes” ves cuántas conversaciones de WhatsApp, mensajes con plantilla y profesionales activos llevás contra el límite del plan.",
      "Desde ahí también cambiás la tarjeta, ves tus facturas o cancelás.",
    ],
    tips: [
      "Si un pago falla, tenés 7 días de gracia para actualizar la tarjeta antes de que el panel quede en solo lectura.",
    ],
  },
]

export const faq: HelpQuestion[] = [
  {
    question: "¿El bot puede reservar dos personas en el mismo horario?",
    answer: "No. La agenda rechaza cualquier turno que se superponga, aunque lleguen dos pedidos al mismo tiempo.",
  },
  {
    question: "¿Qué pasa si el bot no sabe responder algo?",
    answer:
      "Dice que lo consulta y pasa el chat a tu equipo. Te llega un aviso y la conversación aparece con el filtro “Necesitan una persona”.",
  },
  {
    question: "¿Entiende audios y fotos?",
    answer: "Sí. Los audios los transcribe y las fotos las describe (por ejemplo, un diseño de uñas que manda el cliente).",
  },
  {
    question: "¿Les avisa a los clientes antes del turno?",
    answer:
      "Sí. Les manda un recordatorio 24 horas antes con botones para confirmar, reprogramar o cancelar, y otro corto 2 horas antes con la dirección.",
  },
  {
    question: "¿Qué es la lista de espera?",
    answer:
      "Si no hay lugar, el bot anota al cliente. Cuando se libera un horario ese día, avisa a los anotados y el primero que confirma se lo queda.",
  },
  {
    question: "¿Puedo atender un chat yo y después devolvérselo al bot?",
    answer: "Sí: “Tomar conversación” para atenderlo vos y “Devolver al bot” cuando termines.",
  },
  {
    question: "¿Tengo varios locales, cómo cambio de uno a otro?",
    answer: "Con el selector de negocio arriba en la barra lateral (en el celular, en “Más”).",
  },
  {
    question: "No puedo entrar con Google, ¿qué hago?",
    answer: "En la pantalla de ingreso tocá “Recibir un enlace de acceso” y te mandamos un enlace a tu correo.",
  },
]

/** Lo que este rol puede ver de la ayuda. */
export function helpFor(role: Role) {
  const allowed = <T extends { permission?: Permission }>(item: T) => !item.permission || can(role, item.permission)
  return {
    gettingStarted: gettingStarted.filter(allowed),
    topics: helpTopics.filter(allowed),
    faq: faq.filter(allowed),
  }
}
