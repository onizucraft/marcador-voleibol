// Reglas del partido. Funciones puras: sin E/S, sin HTTP, sin base de datos.
// Un partido es una lista de eventos más un cursor; el estado se obtiene reproduciéndolos.
// Deshacer/rehacer solo mueven el cursor.

export type Lado = 'local' | 'visitante';
export const LADOS: readonly Lado[] = ['local', 'visitante'];
const otro = (lado: Lado): Lado => (lado === 'local' ? 'visitante' : 'local');

export interface Color {
  id: string;
  nombre: string;
  /** Color del equipo: panel, nombre, bordes. */
  hex: string;
  /** Color de los números sobre el panel. */
  texto: string;
}

// Colores de equipación por parejas: el principal y una alternativa más oscura para
// cuando los dos equipos visten del mismo color. Todos llevan texto blanco con contraste
// mínimo 4,5:1 (WCAG 1.4.3); lo comprueba un test. El selector los muestra en columnas,
// el principal encima de su alternativa, así que el orden importa.
export const COLORES: readonly Color[] = [
  { id: 'rojo', nombre: 'Rojo', hex: '#d32f2f', texto: '#ffffff' },
  { id: 'granate', nombre: 'Granate', hex: '#9b2226', texto: '#ffffff' },
  { id: 'naranja', nombre: 'Naranja', hex: '#c2410c', texto: '#ffffff' },
  { id: 'teja', nombre: 'Teja', hex: '#8f3510', texto: '#ffffff' },
  { id: 'verde', nombre: 'Verde', hex: '#2e7d32', texto: '#ffffff' },
  { id: 'verde_oscuro', nombre: 'Verde oscuro', hex: '#1d5e24', texto: '#ffffff' },
  { id: 'azul', nombre: 'Azul', hex: '#1d5fd1', texto: '#ffffff' },
  { id: 'marino', nombre: 'Azul marino', hex: '#26479f', texto: '#ffffff' },
  { id: 'morado', nombre: 'Morado', hex: '#8e24aa', texto: '#ffffff' },
  { id: 'morado_oscuro', nombre: 'Morado oscuro', hex: '#6a1f88', texto: '#ffffff' },
  { id: 'rosa', nombre: 'Rosa', hex: '#c2185b', texto: '#ffffff' },
  { id: 'frambuesa', nombre: 'Frambuesa', hex: '#8f1150', texto: '#ffffff' },
];

export interface Config {
  jugadores: number;
  setsParaGanar: number;
  puntosPorSet: number;
  puntosUltimoSet: number;
  diferenciaDos: boolean;
}

type CampoNumerico = Exclude<keyof Config, 'diferenciaDos'>;

export const CONFIG_POR_DEFECTO: Config = {
  jugadores: 6,
  setsParaGanar: 3,
  puntosPorSet: 25,
  puntosUltimoSet: 15,
  diferenciaDos: true,
};

export const LIMITES: Record<CampoNumerico, { min: number; max: number; etiqueta: string }> = {
  jugadores: { min: 1, max: 12, etiqueta: 'Jugadores por equipo' },
  setsParaGanar: { min: 1, max: 5, etiqueta: 'Sets para ganar' },
  puntosPorSet: { min: 1, max: 99, etiqueta: 'Puntos por set' },
  puntosUltimoSet: { min: 1, max: 99, etiqueta: 'Puntos del set de desempate' },
};

export interface Equipo {
  nombre: string;
  color: string;
  hex: string;
  texto: string;
}
export type Equipos = Record<Lado, Equipo>;

export const EQUIPOS_POR_DEFECTO: Record<Lado, { nombre: string; color: string }> = {
  local: { nombre: 'Local', color: 'rojo' },
  visitante: { nombre: 'Visitante', color: 'azul' },
};
const LONGITUD_MAXIMA_NOMBRE = 30;

export type TipoEvento = 'punto' | 'confirmar' | 'cambio_lado' | 'reset';
const TIPOS_EVENTO: readonly string[] = ['punto', 'confirmar', 'cambio_lado', 'reset'];

export interface Evento {
  tipo: TipoEvento;
  equipo?: Lado | null;
  valor?: number | null;
  en: string;
}

export class ErrorDominio extends Error {
  tipo: 'validacion' | 'conflicto';
  constructor(mensaje: string, tipo: 'validacion' | 'conflicto' = 'validacion') {
    super(mensaje);
    this.tipo = tipo;
  }
}

// deno-lint-ignore no-explicit-any
type Entrada = any;

export function validarNuevoPartido(entrada: Entrada): { config: Config; equipos: Equipos; programadoEn: string } {
  const config = { ...CONFIG_POR_DEFECTO };
  for (const campo of Object.keys(LIMITES) as CampoNumerico[]) {
    const { min, max, etiqueta } = LIMITES[campo];
    const valor = entrada?.config?.[campo] ?? CONFIG_POR_DEFECTO[campo];
    if (!Number.isInteger(valor) || valor < min || valor > max) {
      throw new ErrorDominio(`${etiqueta}: debe ser un número entero entre ${min} y ${max}`);
    }
    config[campo] = valor;
  }
  const diferenciaDos = entrada?.config?.diferenciaDos ?? CONFIG_POR_DEFECTO.diferenciaDos;
  if (typeof diferenciaDos !== 'boolean') throw new ErrorDominio('La diferencia de dos puntos debe ser sí o no');
  config.diferenciaDos = diferenciaDos;

  const equipos = {} as Equipos;
  for (const lado of LADOS) {
    equipos[lado] = validarEquipo(entrada?.equipos?.[lado], EQUIPOS_POR_DEFECTO[lado]);
  }
  comprobarColoresDistintos(equipos);
  return { config, equipos, programadoEn: validarProgramacion(entrada?.programadoEn) };
}

/** Lo que no venga (o venga vacío) se toma de `base`. */
function validarEquipo(datos: Entrada, base: { nombre: string; color: string } | Equipo): Equipo {
  const nombre = String(datos?.nombre ?? '').trim() || base.nombre;
  if (nombre.length > LONGITUD_MAXIMA_NOMBRE) {
    throw new ErrorDominio(`El nombre del equipo no puede superar ${LONGITUD_MAXIMA_NOMBRE} caracteres`);
  }
  const colorId = datos?.color ?? base.color;
  const color = COLORES.find((c) => c.id === colorId);
  if (!color && 'hex' in base && colorId === base.color) return { ...(base as Equipo), nombre };
  if (!color) throw new ErrorDominio(`Color no válido: ${colorId}`);
  return { nombre, color: color.id, hex: color.hex, texto: color.texto };
}

function comprobarColoresDistintos(equipos: Equipos) {
  if (equipos.local.color === equipos.visitante.color) {
    throw new ErrorDominio('Los dos equipos no pueden tener el mismo color: elige la versión oscura para uno de ellos');
  }
}

export interface Pendiente {
  tipo: 'set' | 'partido';
  ganador: Lado;
}

export interface Parcial {
  local: number;
  visitante: number;
  ganador: Lado;
}

interface Estado {
  puntos: Record<Lado, number>;
  sets: Record<Lado, number>;
  parciales: Parcial[];
  izquierda: Lado;
  pendiente: Pendiente | null;
  ganador: Lado | null;
  inicio: string | null;
  fin: string | null;
}

function estadoInicial(): Estado {
  return {
    puntos: { local: 0, visitante: 0 },
    sets: { local: 0, visitante: 0 },
    parciales: [],
    izquierda: 'local',
    pendiente: null,
    ganador: null,
    inicio: null,
    fin: null,
  };
}

const numeroDeSet = (sets: Record<Lado, number>) => sets.local + sets.visitante + 1;

function esSetDecisivo(sets: Record<Lado, number>, config: Config) {
  return config.setsParaGanar > 1 && numeroDeSet(sets) === 2 * config.setsParaGanar - 1;
}

function objetivoDelSet(sets: Record<Lado, number>, config: Config) {
  return esSetDecisivo(sets, config) ? config.puntosUltimoSet : config.puntosPorSet;
}

function evaluarFinDeSet(estado: Estado, config: Config): Pendiente | null {
  const objetivo = objetivoDelSet(estado.sets, config);
  for (const lado of LADOS) {
    const propios = estado.puntos[lado];
    const rivales = estado.puntos[otro(lado)];
    if (propios >= objetivo && (!config.diferenciaDos || propios - rivales >= 2)) {
      return { tipo: estado.sets[lado] + 1 >= config.setsParaGanar ? 'partido' : 'set', ganador: lado };
    }
  }
  return null;
}

/**
 * Aplica un evento y devuelve el estado nuevo. Lanza ErrorDominio si el evento
 * no es válido en ese momento, así que sirve para validar acciones nuevas y
 * para reproducir el historial.
 */
function aplicar(estado: Estado, evento: Evento, config: Config): Estado {
  const s = structuredClone(estado);
  switch (evento.tipo) {
    case 'punto': {
      if (s.ganador) throw new ErrorDominio('El partido ya ha terminado', 'conflicto');
      if (s.pendiente) throw new ErrorDominio('Hay que confirmar el final del set antes de seguir', 'conflicto');
      const equipo = evento.equipo;
      if (!equipo || !LADOS.includes(equipo)) throw new ErrorDominio('Equipo no válido');
      if (evento.valor !== 1 && evento.valor !== 2) throw new ErrorDominio('Un punto solo puede valer 1 o 2');
      s.puntos[equipo] += evento.valor;
      s.inicio ??= evento.en;
      s.pendiente = evaluarFinDeSet(s, config);
      return s;
    }
    case 'confirmar': {
      if (!s.pendiente) throw new ErrorDominio('No hay ningún set pendiente de confirmar', 'conflicto');
      const { tipo, ganador } = s.pendiente;
      s.parciales.push({ local: s.puntos.local, visitante: s.puntos.visitante, ganador });
      s.sets[ganador] += 1;
      s.puntos = { local: 0, visitante: 0 };
      s.pendiente = null;
      if (tipo === 'partido') {
        s.ganador = ganador;
        s.fin = evento.en;
      } else {
        s.izquierda = otro(s.izquierda);
      }
      return s;
    }
    case 'cambio_lado':
      s.izquierda = otro(s.izquierda);
      return s;
    case 'reset':
      return estadoInicial();
    default:
      throw new ErrorDominio(`Acción desconocida: ${evento.tipo}`);
  }
}

function describir(evento: Evento, anterior: Estado, equipos: Equipos): string {
  switch (evento.tipo) {
    case 'punto':
      // Un +2 es un único punto doble, no dos puntos.
      return `${evento.valor === 2 ? 'Punto doble' : 'Punto'} para ${equipos[evento.equipo!].nombre}`;
    case 'confirmar': {
      const { tipo, ganador } = anterior.pendiente!;
      const resultado = `${anterior.puntos.local}-${anterior.puntos.visitante}`;
      return tipo === 'partido'
        ? `Fin del partido: gana ${equipos[ganador].nombre} (${resultado})`
        : `Fin del set ${numeroDeSet(anterior.sets)}: gana ${equipos[ganador].nombre} (${resultado}) · cambio de lado`;
    }
    case 'cambio_lado':
      return 'Cambio de lado';
    case 'reset':
      return 'Marcador restablecido';
  }
}

export interface EntradaHistorial {
  descripcion: string;
  tipo: TipoEvento;
  equipo: Lado | null;
  /** El punto que cerró un set o el partido (ya confirmado): se muestra destacado. */
  cierre: 'set' | 'partido' | null;
  /** Texto del cierre ("X gana el set 2 · cambio de lado"), en su propia línea. */
  detalle: string | null;
  set: number;
  puntos: Record<Lado, number>;
  sets: Record<Lado, number>;
  en: string;
}

/** Todo lo que necesita el cliente para pintar el marcador. */
export interface Vista {
  config: Config;
  equipos: Equipos;
  izquierda: Lado;
  derecha: Lado;
  puntos: Record<Lado, number>;
  sets: Record<Lado, number>;
  parciales: Parcial[];
  setActual: number;
  objetivo: number;
  setDecisivo: boolean;
  pendiente: (Pendiente & { set: number }) | null;
  finalizado: boolean;
  ganador: Lado | null;
  inicio: string | null;
  fin: string | null;
  historial: EntradaHistorial[];
  puedeDeshacer: boolean;
  puedeRehacer: boolean;
}

/** Tonos según la paleta actual; si el color ya no existe se conserva el guardado. */
function conPaleta(equipos: Equipos): Equipos {
  const con = (e: Equipo): Equipo => {
    const c = COLORES.find((color) => color.id === e.color);
    // Colores retirados de la paleta: se respetan, con el texto que se lea sobre ellos.
    return c
      ? { nombre: e.nombre, color: e.color, hex: c.hex, texto: c.texto }
      : { nombre: e.nombre, color: e.color, hex: e.hex, texto: textoLegible(e.hex) };
  };
  return { local: con(equipos.local), visitante: con(equipos.visitante) };
}

function construirVista(config: Config, guardados: Equipos, aplicados: Evento[], totalEventos: number): Vista {
  const equipos = conPaleta(guardados);
  let estado = estadoInicial();
  const historial: EntradaHistorial[] = [];
  for (const evento of aplicados) {
    const anterior = estado;
    estado = aplicar(anterior, evento, config);
    // Confirmar el fin de set/partido no ocupa línea propia: se funde con el punto que lo
    // cerró, que queda con el resultado del set y los sets ya actualizados.
    const punto = evento.tipo === 'confirmar' ? historial.findLast((h) => h.tipo === 'punto') : undefined;
    if (punto) {
      const { tipo, ganador } = anterior.pendiente!;
      punto.cierre = tipo;
      punto.sets = { ...estado.sets };
      punto.detalle = tipo === 'partido'
        ? `${equipos[ganador].nombre} gana el partido ${estado.sets.local}-${estado.sets.visitante}`
        : `${equipos[ganador].nombre} gana el set ${numeroDeSet(anterior.sets)} · cambio de lado`;
      continue;
    }
    historial.push({
      descripcion: describir(evento, anterior, equipos),
      tipo: evento.tipo,
      equipo: evento.equipo ?? (evento.tipo === 'confirmar' ? anterior.pendiente!.ganador : null),
      cierre: null,
      detalle: null,
      set: numeroDeSet(anterior.sets),
      puntos: { ...estado.puntos },
      sets: { ...estado.sets },
      en: evento.en,
    });
  }
  const finalizado = estado.ganador !== null;
  return {
    config,
    equipos,
    izquierda: estado.izquierda,
    derecha: otro(estado.izquierda),
    puntos: estado.puntos,
    sets: estado.sets,
    parciales: estado.parciales,
    setActual: finalizado ? estado.parciales.length : numeroDeSet(estado.sets),
    objetivo: objetivoDelSet(estado.sets, config),
    setDecisivo: !finalizado && esSetDecisivo(estado.sets, config),
    pendiente: estado.pendiente && { ...estado.pendiente, set: numeroDeSet(estado.sets) },
    finalizado,
    ganador: estado.ganador,
    inicio: estado.inicio,
    fin: estado.fin,
    historial,
    puedeDeshacer: aplicados.length > 0,
    puedeRehacer: aplicados.length < totalEventos,
  };
}

export function vistaInicial(config: Config, equipos: Equipos): Vista {
  return construirVista(config, equipos, [], 0);
}

/** Vuelve a calcular la vista de un partido guardado con las reglas y la paleta actuales. */
export function recalcularVista(partido: PartidoGuardado): Vista {
  const { config, equipos, cursor, eventos } = partido;
  return construirVista(config, equipos, eventos.slice(0, cursor), eventos.length);
}

/** Contraste WCAG 2.x entre dos colores #rrggbb. */
export function contrasteWcag(a: string, b: string): number {
  const luminancia = (hex: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Blanco si cumple 4,5:1 sobre `fondo` (WCAG 1.4.3); si no, casi negro. */
export function textoLegible(fondo: string): string {
  return contrasteWcag(fondo, '#ffffff') >= 4.5 ? '#ffffff' : '#1a1a1a';
}

/** Partido tal y como está guardado: `eventos` incluye los deshechos (seq > cursor). */
export interface PartidoGuardado {
  config: Config;
  equipos: Equipos;
  cursor: number;
  eventos: Evento[];
}

export interface Cambio {
  cursor: number;
  total: number;
  /**
   * Eventos a guardar a partir de la posición `desde` (1-based), sustituyendo esa
   * posición y todas las siguientes. null en deshacer/rehacer, que solo mueven el cursor.
   */
  escribir: { desde: number; eventos: Evento[] } | null;
  vista: Vista;
}

const ACCIONES = ['deshacer', 'rehacer', 'quitar_punto', ...TIPOS_EVENTO];

export function resolverAccion(partido: PartidoGuardado, accion: Entrada, ahora: string): Cambio {
  const { config, equipos, cursor, eventos } = partido;
  const tipo = accion?.tipo;
  if (!ACCIONES.includes(tipo)) throw new ErrorDominio(`Acción desconocida: ${tipo}`);

  if (tipo === 'deshacer') {
    if (cursor === 0) throw new ErrorDominio('No hay nada que deshacer', 'conflicto');
    return conCursor(cursor - 1);
  }
  if (tipo === 'rehacer') {
    if (cursor >= eventos.length) throw new ErrorDominio('No hay nada que rehacer', 'conflicto');
    return conCursor(cursor + 1);
  }

  if (tipo === 'quitar_punto') return quitarPunto(partido, accion?.equipo);

  const evento: Evento =
    tipo === 'punto'
      ? { tipo, equipo: accion.equipo, valor: accion.valor ?? 1, en: ahora }
      : { tipo, en: ahora };
  // Una acción nueva descarta lo que se pudiera rehacer, como en cualquier editor.
  return reescribir(partido, cursor, [evento]);

  function conCursor(nuevo: number): Cambio {
    return {
      cursor: nuevo,
      total: eventos.length,
      escribir: null,
      vista: construirVista(config, equipos, eventos.slice(0, nuevo), eventos.length),
    };
  }
}

/**
 * Sustituye los eventos aplicados a partir del índice `indice` (0-based) por `nuevos`.
 * Lo que hubiera para rehacer se descarta.
 */
function reescribir(partido: PartidoGuardado, indice: number, nuevos: Evento[]): Cambio {
  const aplicados = [...partido.eventos.slice(0, indice), ...nuevos];
  const vista = construirVista(partido.config, partido.equipos, aplicados, aplicados.length);
  return { cursor: aplicados.length, total: aplicados.length, escribir: { desde: indice + 1, eventos: nuevos }, vista };
}

/**
 * Restar un punto es una corrección del histórico, no una jugada: el último punto de
 * ese equipo en el set actual pasa de +2 a +1, o desaparece si era +1. El historial
 * queda como si nunca se hubiera anotado, y por eso no se puede deshacer.
 */
function quitarPunto(partido: PartidoGuardado, equipo: Lado): Cambio {
  if (!LADOS.includes(equipo)) throw new ErrorDominio('Equipo no válido');
  const aplicados = partido.eventos.slice(0, partido.cursor);
  const inicioSet = aplicados.findLastIndex((e) => e.tipo === 'confirmar' || e.tipo === 'reset') + 1;
  const indice = aplicados.findLastIndex((e, i) => i >= inicioSet && e.tipo === 'punto' && e.equipo === equipo);
  if (indice < 0) {
    throw new ErrorDominio(`${partido.equipos[equipo].nombre} no tiene puntos que quitar en este set`, 'conflicto');
  }
  const punto = aplicados[indice];
  const posteriores = aplicados.slice(indice + 1);
  return reescribir(partido, indice, punto.valor === 2 ? [{ ...punto, valor: 1 }, ...posteriores] : posteriores);
}

// ---------- Edición de equipos ----------
// Como el reloj, va fuera del historial: deshacer un punto no debe deshacer un cambio de nombre.

export function editarEquipo(partido: PartidoGuardado, accion: Entrada): { equipos: Equipos; vista: Vista } {
  const lado = accion?.equipo;
  if (!LADOS.includes(lado)) throw new ErrorDominio('Equipo no válido');
  const equipos = { ...partido.equipos, [lado]: validarEquipo(accion, partido.equipos[lado as Lado]) };
  comprobarColoresDistintos(equipos);
  const { config, cursor, eventos } = partido;
  return { equipos, vista: construirVista(config, equipos, eventos.slice(0, cursor), eventos.length) };
}

// ---------- Reloj de juego ----------
// Va aparte del historial de eventos: deshacer/rehacer no deben tocar el tiempo.

export interface Reloj {
  /** Tiempo acumulado de los tramos ya pausados. */
  acumuladoMs: number;
  /** Instante en que arrancó el tramo actual; null si está parado. */
  iniciadoEn: string | null;
}

export const RELOJ_INICIAL: Reloj = { acumuladoMs: 0, iniciadoEn: null };
export const ACCIONES_RELOJ = ['iniciar_reloj', 'pausar_reloj'];

function pausar(reloj: Reloj, ahora: string): Reloj {
  if (!reloj.iniciadoEn) return reloj;
  const tramo = Math.max(0, Date.parse(ahora) - Date.parse(reloj.iniciadoEn));
  return { acumuladoMs: reloj.acumuladoMs + tramo, iniciadoEn: null };
}

export function accionDeReloj(reloj: Reloj, tipo: string, ahora: string, finalizado: boolean): Reloj {
  if (tipo === 'iniciar_reloj') {
    if (finalizado) throw new ErrorDominio('El partido ya ha terminado', 'conflicto');
    if (reloj.iniciadoEn) throw new ErrorDominio('El reloj ya está en marcha', 'conflicto');
    return { acumuladoMs: reloj.acumuladoMs, iniciadoEn: ahora };
  }
  if (tipo === 'pausar_reloj') {
    if (!reloj.iniciadoEn) throw new ErrorDominio('El reloj ya está parado', 'conflicto');
    return pausar(reloj, ahora);
  }
  throw new ErrorDominio(`Acción desconocida: ${tipo}`);
}

/** Al terminar el partido el reloj se para solo. */
export function relojTrasCambio(reloj: Reloj, vista: Vista, ahora: string): Reloj {
  return vista.finalizado ? pausar(reloj, ahora) : reloj;
}

// ---------- Programación: fecha prevista y comienzo real ----------

const PROGRAMACION_MINIMA = Date.parse('2000-01-01T00:00:00Z');
const PROGRAMACION_MAXIMA = Date.parse('2100-01-01T00:00:00Z');

/** Fecha y hora previstas del partido; obligatorias. Devuelve ISO en UTC. */
export function validarProgramacion(valor: unknown): string {
  return validarInstante(valor, 'Indica la fecha y hora previstas del partido', 'La fecha y hora previstas no son válidas');
}

function validarInstante(valor: unknown, siFalta: string, siInvalido: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') throw new ErrorDominio(siFalta);
  const instante = Date.parse(valor);
  if (Number.isNaN(instante) || instante < PROGRAMACION_MINIMA || instante >= PROGRAMACION_MAXIMA) {
    throw new ErrorDominio(siInvalido);
  }
  return new Date(instante).toISOString();
}

/**
 * Corrección de fechas por el admin: la prevista siempre; el comienzo real solo si el
 * partido ya ha comenzado (si no, aún no hay comienzo que corregir).
 */
export function validarCambioDeFechas(
  entrada: Entrada,
  actual: { programadoEn: string; comenzadoEn: string | null },
): { programadoEn: string; comenzadoEn: string | null } {
  const programadoEn = entrada?.programadoEn === undefined ? actual.programadoEn : validarProgramacion(entrada.programadoEn);
  if (entrada?.comenzadoEn === undefined) return { programadoEn, comenzadoEn: actual.comenzadoEn };
  if (!actual.comenzadoEn) throw new ErrorDominio('El partido aún no ha comenzado', 'conflicto');
  const comenzadoEn = validarInstante(entrada.comenzadoEn, 'Indica la fecha y hora de comienzo', 'La fecha y hora de comienzo no son válidas');
  return { programadoEn, comenzadoEn };
}

/** El partido comienza con el primer punto o el primer arranque del reloj, y ya no se borra. */
export function comienzoTras(comenzadoEn: string | null, tipoAccion: string, ahora: string): string | null {
  if (comenzadoEn) return comenzadoEn;
  return tipoAccion === 'punto' || tipoAccion === 'iniciar_reloj' ? ahora : null;
}

/** Columnas desnormalizadas para listar partidos sin cargar la vista entera. */
export function resumir(vista: Vista, comenzadoEn: string | null) {
  return {
    estado: vista.finalizado ? 'finalizado' : comenzadoEn ? 'en_juego' : 'programado',
    setsLocal: vista.sets.local,
    setsVisitante: vista.sets.visitante,
    ganador: vista.ganador,
  };
}
