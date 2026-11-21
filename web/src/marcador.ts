import { $, avisarError, el, preguntar } from './dom.ts';
import { ahoraServidor, mantenerHoraSincronizada } from './hora.ts';
import { cargarOpciones, crearPaleta } from './paleta.ts';
import { pintarSesion } from './sesion.ts';
import { ErrorSesion, llamar, supabase } from './supabase.ts';
import type { Lado, Reloj, Vista } from '../../supabase/functions/partidos/dominio/marcador.ts';

// Esta página solo pinta la vista que calcula el servidor y le envía acciones.

const id = Number(new URLSearchParams(location.search).get('id'));
let vista: Vista | null = null;
let reloj: Reloj = { acumuladoMs: 0, iniciadoEn: null };
let programacion: Programacion = { programadoEn: '', comenzadoEn: null };
// Versión del partido que se está mostrando. Los avisos de Realtime y las respuestas pueden
// llegar desordenados; nunca se pinta algo más viejo que lo que ya hay en pantalla.
let versionMostrada = -1;

interface Programacion {
  programadoEn: string;
  comenzadoEn: string | null;
}
let admin = false;
let dialogoPendiente: { clave: number; cerrar: () => void } | null = null;
let cola: Promise<unknown> = Promise.resolve();

const nombreDe = (lado: Lado) => vista!.equipos[lado].nombre;
const colorDe = (v: Vista, lado: Lado) => v.equipos[lado].hex;
// Las vistas guardadas antes de existir `texto` no lo traen.
const textoDe = (v: Vista, lado: Lado) => v.equipos[lado].texto ?? '#ffffff';
const dosCifras = (n: number) => String(n).padStart(2, '0');
const hora = new Intl.DateTimeFormat('es-ES', { timeStyle: 'medium' });
const fechaPrevista = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const horaCorta = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

function pintar(version: number, nueva: Vista, nuevoReloj: Reloj, nuevaProgramacion: Programacion) {
  if (version < versionMostrada) return;
  versionMostrada = version;
  vista = nueva;
  reloj = nuevoReloj;
  programacion = nuevaProgramacion;
  const v = nueva;
  const bloqueado = !admin || v.finalizado || v.pendiente !== null;

  for (const [posicion, lado] of [['izq', v.izquierda], ['der', v.derecha]] as const) {
    const equipo = v.equipos[lado];
    const nombre = $(`#nombre-${posicion}`);
    nombre.textContent = equipo.nombre;
    if (admin) {
      nombre.setAttribute('role', 'button');
      nombre.tabIndex = 0;
      nombre.title = 'Cambiar nombre o color';
    }
    nombre.style.setProperty('--color', colorDe(v, lado));
    nombre.style.setProperty('--texto', textoDe(v, lado));

    const panel = $(`#panel-${posicion}`);
    panel.dataset.lado = lado;
    panel.style.setProperty('--color', equipo.hex);
    panel.style.setProperty('--texto', textoDe(v, lado));
    panel.classList.toggle('bloqueado', bloqueado);
    panel.setAttribute('aria-label', `Sumar punto a ${equipo.nombre}`);
    panel.querySelector('.lado-etiqueta')!.textContent = lado === 'local' ? 'Local' : 'Visitante';
    panel.querySelector('.puntos')!.textContent = dosCifras(v.puntos[lado]);
    panel.querySelector<HTMLButtonElement>('.mas-dos')!.disabled = bloqueado;
    panel.querySelector<HTMLButtonElement>('.menos-uno')!.disabled = !admin || v.puntos[lado] === 0;

    const sets = $(`#sets-${posicion}`);
    sets.textContent = String(v.sets[lado]);
    sets.style.setProperty('--color', equipo.hex);
    sets.style.setProperty('--texto', textoDe(v, lado));
  }

  const { config } = v;
  $('#info').textContent = [
    `${config.jugadores} jugadores`,
    `gana quien llegue a ${config.setsParaGanar} ${config.setsParaGanar === 1 ? 'set' : 'sets'}`,
    v.finalizado ? 'Partido terminado' : `Set ${v.setActual}${v.setDecisivo ? ' (desempate)' : ''} a ${v.objetivo} puntos`,
  ].join(' · ');
  document.title = `${v.equipos.local.nombre} ${v.sets.local}-${v.sets.visitante} ${v.equipos.visitante.nombre} · Marcador Ancora`;

  $<HTMLButtonElement>('[data-accion="deshacer"]').disabled = !v.puedeDeshacer;
  $<HTMLButtonElement>('[data-accion="rehacer"]').disabled = !v.puedeRehacer;
  $<HTMLAnchorElement>('#nuevo').href = `nuevo.html?desde=${id}`;

  pintarProgramacion();
  pintarEstado(v);
  pintarParciales(v);
  pintarHistorial(v);
  pintarReloj();
  avisarFinDeSet(v);
  $('.marcador').hidden = false;
}

function pintarProgramacion() {
  const partes = [`Previsto: ${fechaPrevista.format(new Date(programacion.programadoEn))}`];
  if (programacion.comenzadoEn) partes.push(`Comenzó: ${horaCorta.format(new Date(programacion.comenzadoEn))}`);
  $('#programacion').textContent = partes.join(' · ');
}

/** Valor para <input type="datetime-local"> en la hora local del dispositivo. */
function aLocal(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function editarProgramacion() {
  const previsto = el('input', { type: 'datetime-local', name: 'programadoEn', required: true });
  previsto.value = aLocal(programacion.programadoEn);
  // El comienzo real solo se corrige si el partido ya ha empezado.
  const comienzo = programacion.comenzadoEn ? el('input', { type: 'datetime-local', name: 'comenzadoEn', required: true }) : null;
  if (comienzo) comienzo.value = aLocal(programacion.comenzadoEn!);
  const formulario = el('form', { method: 'dialog', class: 'formulario' },
    el('h2', {}, 'Fecha y hora'),
    el('label', {}, 'Prevista', previsto),
    comienzo ? el('label', {}, 'Comienzo real', comienzo) : el('p', { class: 'vacio' }, 'El comienzo real se registra solo con el primer punto o al arrancar el reloj.'),
    el('div', { class: 'botones' },
      el('button', { type: 'button', class: 'boton', value: 'cancelar' }, 'Cancelar'),
      el('button', { type: 'submit', class: 'boton principal' }, 'Guardar'),
    ),
  );
  const dialogo = el('dialog', { class: 'dialogo' }, formulario);
  document.body.append(dialogo);
  formulario.querySelector('[value="cancelar"]')!.addEventListener('click', () => dialogo.close());
  formulario.addEventListener('submit', () => {
    accion({
      tipo: 'editar_programacion',
      programadoEn: new Date(previsto.value).toISOString(),
      ...(comienzo && { comenzadoEn: new Date(comienzo.value).toISOString() }),
    });
  });
  dialogo.addEventListener('close', () => dialogo.remove());
  dialogo.showModal();
}

/** Pantalla completa: solo nombres, puntos, sets y reloj, sin controles ni scroll. */
function alternarPresentacion(activar = !document.body.classList.contains('presentacion')) {
  document.body.classList.toggle('presentacion', activar);
  if (activar) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen();
}

function pintarEstado(v: Vista) {
  const estado = $('#estado');
  // Resultado (o fin pendiente de confirmar) con el color del ganador.
  const ganador = v.ganador ?? v.pendiente?.ganador;
  estado.classList.toggle('coloreado', Boolean(ganador));
  if (ganador) {
    estado.style.setProperty('--color', colorDe(v, ganador));
    estado.style.setProperty('--texto', textoDe(v, ganador));
  }
  if (v.finalizado) {
    const ganador = v.ganador!;
    // Resultados siempre en orden local-visitante.
    estado.replaceChildren(`🏆 ${nombreDe(ganador)} gana el partido ${v.sets.local}-${v.sets.visitante}`);
  } else if (v.pendiente) {
    const que = v.pendiente.tipo === 'partido' ? 'el partido' : `el set ${v.pendiente.set}`;
    const confirmar = el('button', { type: 'button', class: 'boton principal solo-admin' }, 'Confirmar');
    confirmar.addEventListener('click', () => accion({ tipo: 'confirmar' }));
    estado.replaceChildren(`${nombreDe(v.pendiente.ganador)} gana ${que}. Pendiente de confirmar.`, confirmar);
  }
  estado.hidden = !v.finalizado && !v.pendiente;
}

function pintarParciales(v: Vista) {
  $('#parciales').replaceChildren(...v.parciales.map((p, i) => {
    const item = el('li', {}, `Set ${i + 1}: `, el('strong', {}, `${p.local}-${p.visitante}`));
    // Con el color del equipo que ganó el set.
    item.style.setProperty('--color', colorDe(v, p.ganador));
    item.style.setProperty('--texto', textoDe(v, p.ganador));
    item.title = `Lo ganó ${nombreDe(p.ganador)}`;
    return item;
  }));
}

function pintarHistorial(v: Vista) {
  const lista = $('#lista-historial');
  if (v.historial.length === 0) return lista.replaceChildren(el('li', { class: 'vacio' }, 'Todavía no hay jugadas.'));

  // Del más reciente al más antiguo, con una cabecera al empezar cada set.
  const filas: HTMLElement[] = [];
  let setAnterior: number | null = null;
  for (const h of v.historial.toReversed()) {
    if (h.set !== setAnterior) {
      setAnterior = h.set;
      const parcial = v.parciales[h.set - 1];
      filas.push(el('li', { class: 'separador-set' },
        el('span', {}, parcial ? `Set ${h.set} · ${parcial.local}-${parcial.visitante}` : `Set ${h.set}`),
      ));
    }
    const item = el('li', {},
      el('span', { class: 'descripcion' }, h.descripcion, h.detalle && el('span', { class: 'detalle' }, h.detalle)),
      el('span', { class: 'marcador-parcial' }, `${h.puntos.local}-${h.puntos.visitante} (${h.sets.local}-${h.sets.visitante})`),
      el('time', { datetime: h.en }, hora.format(new Date(h.en))),
    );
    // Cada jugada con el color del equipo; el punto que cierra un set o el partido, marcado.
    if (h.equipo) {
      item.classList.add('de-equipo');
      item.style.setProperty('--color', colorDe(v, h.equipo));
      item.style.setProperty('--texto', textoDe(v, h.equipo));
    }
    if (h.cierre) item.classList.add('cierre');
    filas.push(item);
  }
  lista.replaceChildren(...filas);
}

function pintarReloj() {
  const enMarcha = reloj.iniciadoEn !== null;
  // Hora del servidor (corregida), no la del dispositivo: así todos ven el mismo tiempo.
  const tramo = enMarcha ? ahoraServidor() - new Date(reloj.iniciadoEn!).getTime() : 0;
  const segundos = Math.max(0, Math.floor((reloj.acumuladoMs + tramo) / 1000));

  $('#reloj').classList.toggle('parado', !enMarcha);
  const boton = $<HTMLButtonElement>('#boton-reloj');
  const texto = enMarcha ? 'Pausar el reloj' : 'Arrancar el reloj';
  boton.classList.toggle('en-marcha', enMarcha);
  boton.title = texto;
  boton.setAttribute('aria-label', texto);
  boton.disabled = !enMarcha && Boolean(vista?.finalizado);

  const h = Math.floor(segundos / 3600);
  const mmss = `${dosCifras(Math.floor((segundos % 3600) / 60))}:${dosCifras(segundos % 60)}`;
  $('#reloj').textContent = h > 0 ? `${h}:${mmss}` : mmss;
}

/** Al llegar a fin de set o de partido, pide confirmación (una vez por situación). */
function avisarFinDeSet(v: Vista) {
  const clave = v.pendiente ? v.historial.length : null;
  if (dialogoPendiente && dialogoPendiente.clave !== clave) {
    dialogoPendiente.cerrar();
    dialogoPendiente = null;
  }
  if (!admin || !v.pendiente || clave === null || dialogoPendiente) return;

  const ganador = nombreDe(v.pendiente.ganador);
  const resultado = `${v.puntos.local}-${v.puntos.visitante}`;
  const [titulo, texto] = v.pendiente.tipo === 'partido'
    ? ['Fin del partido', `${ganador} gana el último set ${resultado} y el partido. ¿Confirmas el final del partido?`]
    : [`Fin del set ${v.pendiente.set}`, `${ganador} gana el set ${resultado}. Al confirmar, los equipos cambiarán de lado.`];
  const { respuesta, cerrar } = preguntar(titulo, texto, [
    { texto: 'Deshacer último punto', valor: 'deshacer' },
    { texto: 'Confirmar', valor: 'confirmar', principal: true },
  ]);
  dialogoPendiente = { clave, cerrar };
  respuesta.then((elegida) => {
    if (elegida) accion({ tipo: elegida });
  });
}

/** Cambiar nombre o color de un equipo. No entra en deshacer/rehacer. */
async function editarEquipo(lado: Lado) {
  const { colores } = await cargarOpciones();
  const equipo = vista!.equipos[lado];
  const nombre = el('input', { name: 'nombre', maxlength: '30', required: true, autocomplete: 'off' });
  nombre.value = equipo.nombre;
  const formulario = el('form', { method: 'dialog', class: 'formulario' },
    el('h2', {}, `Editar equipo ${lado === 'local' ? 'local' : 'visitante'}`),
    el('label', {}, 'Nombre', nombre),
    crearPaleta('color', colores, equipo.color, 'Color del equipo'),
    el('div', { class: 'botones' },
      el('button', { type: 'button', class: 'boton', value: 'cancelar' }, 'Cancelar'),
      el('button', { type: 'submit', class: 'boton principal' }, 'Guardar'),
    ),
  );
  const dialogo = el('dialog', { class: 'dialogo' }, formulario);
  document.body.append(dialogo);
  formulario.querySelector('[value="cancelar"]')!.addEventListener('click', () => dialogo.close());
  formulario.addEventListener('submit', () => {
    const datos = new FormData(formulario);
    accion({ tipo: 'editar_equipo', equipo: lado, nombre: String(datos.get('nombre')), color: datos.get('color')?.toString() });
  });
  dialogo.addEventListener('close', () => dialogo.remove());
  dialogo.showModal();
  nombre.select();
}

/** Las acciones se envían en orden, una detrás de otra. */
function accion(datos: { tipo: string; equipo?: Lado; valor?: number; nombre?: string; color?: string; programadoEn?: string; comenzadoEn?: string }) {
  cola = cola.then(async () => {
    try {
      const respuesta = await llamar<{ version: number; vista: Vista; reloj: Reloj } & Programacion>(`/${id}/acciones`, { cuerpo: datos });
      pintar(respuesta.version, respuesta.vista, respuesta.reloj, respuesta);
    } catch (error) {
      if (error instanceof ErrorSesion) {
        location.href = `login.html?volver=${encodeURIComponent(`partido.html?id=${id}`)}`;
        return;
      }
      avisarError((error as Error).message);
    }
  });
}

async function cargar() {
  const { data, error } = await supabase
    .from('partidos')
    .select('version, vista, reloj, programado_en, comenzado_en')
    .eq('id', id)
    .maybeSingle();
  if (error) return avisarError('No se ha podido cargar el partido');
  if (!data) {
    document.body.replaceChildren(el('main', { class: 'contenido' }, el('p', {}, 'Este partido no existe. '), el('a', { href: './' }, 'Ver partidos')));
    return;
  }
  pintar(data.version, data.vista as Vista, data.reloj as Reloj, { programadoEn: data.programado_en, comenzadoEn: data.comenzado_en });
}

function conectarControles() {
  for (const posicion of ['izq', 'der']) {
    const panel = $(`#panel-${posicion}`);
    const sumar = (valor: number) => {
      if (!panel.classList.contains('bloqueado')) accion({ tipo: 'punto', equipo: panel.dataset.lado as Lado, valor });
    };
    panel.addEventListener('click', () => sumar(1));
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        sumar(1);
      }
    });
    panel.querySelector('.mas-dos')!.addEventListener('click', (e) => {
      e.stopPropagation();
      sumar(2);
    });
    panel.querySelector('.menos-uno')!.addEventListener('click', (e) => {
      e.stopPropagation();
      accion({ tipo: 'quitar_punto', equipo: panel.dataset.lado as Lado });
    });
  }
  for (const boton of document.querySelectorAll<HTMLButtonElement>('[data-accion]')) {
    boton.addEventListener('click', () => accion({ tipo: boton.dataset.accion! }));
  }
  $('#restablecer').addEventListener('click', async () => {
    const { respuesta } = preguntar('Restablecer marcador', 'Se pondrán a cero los puntos y los sets. Se puede deshacer.', [
      { texto: 'Cancelar', valor: '' },
      { texto: 'Restablecer', valor: 'reset', principal: true },
    ]);
    if (await respuesta) accion({ tipo: 'reset' });
  });
  // Tocar el nombre de un equipo abre su edición (solo admin).
  for (const posicion of ['izq', 'der']) {
    const nombre = $(`#nombre-${posicion}`);
    const editar = () => {
      const lado = $(`#panel-${posicion}`).dataset.lado as Lado | undefined;
      if (admin && lado && !document.body.classList.contains('presentacion')) {
        editarEquipo(lado).catch((error) => avisarError((error as Error).message));
      }
    };
    nombre.addEventListener('click', editar);
    nombre.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        editar();
      }
    });
  }
  $('#boton-reloj').addEventListener('click', () => {
    accion({ tipo: reloj.iniciadoEn ? 'pausar_reloj' : 'iniciar_reloj' });
  });
  $('#eliminar').addEventListener('click', async () => {
    const { respuesta } = preguntar(
      'Eliminar partido',
      `Se borrará el partido ${vista ? `${nombreDe('local')} - ${nombreDe('visitante')}` : ''} con todo su historial. No se puede deshacer.`,
      [
        { texto: 'Cancelar', valor: '' },
        { texto: 'Eliminar', valor: 'eliminar', peligro: true },
      ],
    );
    if (!(await respuesta)) return;
    try {
      await llamar(`/${id}/eliminar`);
      location.href = './';
    } catch (error) {
      if (error instanceof ErrorSesion) location.href = `login.html?volver=${encodeURIComponent(`partido.html?id=${id}`)}`;
      else avisarError((error as Error).message);
    }
  });
  $('#ver-historial').addEventListener('click', () => {
    const historial = $('#historial');
    historial.hidden = !historial.hidden;
    if (!historial.hidden) historial.scrollIntoView({ behavior: 'smooth' });
  });
  $('#editar-programacion').addEventListener('click', editarProgramacion);
  $('#pantalla-completa').addEventListener('click', () => alternarPresentacion(true));
  // Salir: Esc, el gesto de salir de pantalla completa del navegador o doble toque en el reloj.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) alternarPresentacion(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') alternarPresentacion(false);
  });
  $('#reloj').addEventListener('dblclick', () => alternarPresentacion(false));
}

async function iniciar() {
  if (!Number.isInteger(id) || id <= 0) return void (location.href = './');
  conectarControles();
  admin = await pintarSesion($('#sesion'));
  await cargar();
  setInterval(pintarReloj, 250);
  mantenerHoraSincronizada(pintarReloj);

  // En vivo: cada cambio del partido llega por Realtime. Al (re)conectar se recarga
  // por si se perdió algo mientras tanto.
  supabase
    .channel(`partido-${id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'partidos', filter: `id=eq.${id}` }, (cambio) => {
      const fila = cambio.new as {
        version?: number; vista?: Vista; reloj?: Reloj; programado_en?: string; comenzado_en?: string | null;
      };
      if (fila.version !== undefined && fila.vista && fila.reloj && fila.programado_en) {
        pintar(fila.version, fila.vista, fila.reloj, { programadoEn: fila.programado_en, comenzadoEn: fila.comenzado_en ?? null });
      } else cargar();
    })
    // Si lo eliminan mientras se está viendo. (Los DELETE de Realtime no admiten filtro.)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'partidos' }, (cambio) => {
      if (Number((cambio.old as { id?: number }).id) === id) cargar();
    })
    .subscribe((estado) => {
      if (estado === 'SUBSCRIBED') cargar();
    });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') cargar();
  });
}

iniciar().catch((error) => avisarError((error as Error).message));
