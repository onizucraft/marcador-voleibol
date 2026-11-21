// Reglas del partido. Funciones puras: sin E/S, sin HTTP, sin base de datos.
// Un partido es una lista de eventos más un cursor; el estado se obtiene reproduciéndolos.
// Deshacer/rehacer solo mueven el cursor.

export type Lado = 'local' | 'visitante';
export const LADOS: readonly Lado[] = ['local', 'visitante'];
const otro = (lado: Lado): Lado => (lado === 'local' ? 'visitante' : 'local');

export interface Color {
  id: string;
  nombre: string;
  /** Relleno del panel del equipo. */
  hex: string;
  /** Color de los números sobre el relleno. */
  texto: string;
  /** Color del nombre del equipo sobre el fondo oscuro de la página. */
  tinta: string;
}

// Colores de equipación bien separados entre sí (y los claros, con números oscuros).
export const COLORES: readonly Color[] = [
  { id: 'rojo', nombre: 'Rojo', hex: '#e53935', texto: '#ffffff', tinta: '#ef5350' },
  { id: 'naranja', nombre: 'Naranja', hex: '#f57c00', texto: '#ffffff', tinta: '#fb8c00' },
  { id: 'amarillo', nombre: 'Amarillo', hex: '#fdd835', texto: '#1a1a1a', tinta: '#fdd835' },
  { id: 'verde', nombre: 'Verde', hex: '#2e7d32', texto: '#ffffff', tinta: '#4caf50' },
  { id: 'celeste', nombre: 'Celeste', hex: '#4fc3f7', texto: '#0d2233', tinta: '#4fc3f7' },
  { id: 'azul', nombre: 'Azul', hex: '#1e4fd8', texto: '#ffffff', tinta: '#5c8dff' },
  { id: 'morado', nombre: 'Morado', hex: '#8e24aa', texto: '#ffffff', tinta: '#ba68c8' },
  { id: 'rosa', nombre: 'Rosa', hex: '#ec407a', texto: '#ffffff', tinta: '#f06292' },
  { id: 'blanco', nombre: 'Blanco', hex: '#f5f5f5', texto: '#1a1a1a', tinta: '#f5f5f5' },
  { id: 'negro', nombre: 'Negro', hex: '#111111', texto: '#ffffff', tinta: '#bdbdbd' },
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
  tinta: string;
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

export function validarNuevoPartido(entrada: Entrada): { config: Config; equipos: Equipos } {
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
  return { config, equipos };
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
  return { nombre, color: color.id, hex: color.hex, texto: color.texto, tinta: color.tinta };
}

function comprobarColoresDistintos(equipos: Equipos) {
  if (equipos.local.color === equipos.visitante.color) {
    throw new ErrorDominio('Los dos equipos no pueden tener el mismo color');
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
      return `Punto para ${equipos[evento.equipo!].nombre}${evento.valor === 2 ? ' (+2)' : ''}`;
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
    return c ? { ...e, hex: c.hex, texto: c.texto, tinta: c.tinta } : { ...e, texto: e.texto ?? '#ffffff', tinta: e.tinta ?? e.hex };
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
    historial.push({
      descripcion: describir(evento, anterior, equipos),
      tipo: evento.tipo,
      equipo: evento.equipo ?? null,
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

/** Columnas desnormalizadas para listar partidos sin cargar la vista entera. */
export function resumir(vista: Vista) {
  return {
    estado: vista.finalizado ? 'finalizado' : 'en_juego',
    setsLocal: vista.sets.local,
    setsVisitante: vista.sets.visitante,
    ganador: vista.ganador,
  };
}
