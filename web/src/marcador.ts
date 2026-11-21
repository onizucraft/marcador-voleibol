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
let admin = false;
let dialogoPendiente: { clave: number; cerrar: () => void } | null = null;
let cola: Promise<unknown> = Promise.resolve();

const nombreDe = (lado: Lado) => vista!.equipos[lado].nombre;
const dosCifras = (n: number) => String(n).padStart(2, '0');
const hora = new Intl.DateTimeFormat('es-ES', { timeStyle: 'medium' });

function pintar(nueva: Vista, nuevoReloj: Reloj) {
  vista = nueva;
  reloj = nuevoReloj;
  const v = nueva;
  const bloqueado = !admin || v.finalizado || v.pendiente !== null;

  for (const [posicion, lado] of [['izq', v.izquierda], ['der', v.derecha]] as const) {
    const equipo = v.equipos[lado];
    const nombre = $(`#nombre-${posicion}`);
    nombre.textContent = equipo.nombre;
    nombre.style.setProperty('--color', equipo.hex);

    const panel = $(`#panel-${posicion}`);
    panel.dataset.lado = lado;
    panel.style.setProperty('--color', equipo.hex);
    panel.classList.toggle('bloqueado', bloqueado);
    panel.setAttribute('aria-label', `Sumar punto a ${equipo.nombre}`);
    panel.querySelector('.lado-etiqueta')!.textContent = lado === 'local' ? 'Local' : 'Visitante';
    panel.querySelector('.puntos')!.textContent = dosCifras(v.puntos[lado]);
    panel.querySelector<HTMLButtonElement>('.mas-dos')!.disabled = bloqueado;

    const sets = $(`#sets-${posicion}`);
    sets.textContent = String(v.sets[lado]);
    sets.style.setProperty('--color', equipo.hex);
  }

  const { config } = v;
  $('#info').textContent = [
    `${config.jugadores} jugadores`,
    `gana quien llegue a ${config.setsParaGanar} ${config.setsParaGanar === 1 ? 'set' : 'sets'}`,
    v.finalizado ? 'Partido terminado' : `Set ${v.setActual}${v.setDecisivo ? ' (desempate)' : ''} a ${v.objetivo} puntos`,
  ].join(' · ');
  document.title = `${v.equipos.local.nombre} ${v.sets.local}-${v.sets.visitante} ${v.equipos.visitante.nombre} · Marcador`;

  $<HTMLButtonElement>('[data-accion="deshacer"]').disabled = !v.puedeDeshacer;
  $<HTMLButtonElement>('[data-accion="rehacer"]').disabled = !v.puedeRehacer;
  $<HTMLAnchorElement>('#nuevo').href = `nuevo.html?desde=${id}`;

  pintarEstado(v);
  pintarParciales(v);
  pintarHistorial(v);
  pintarReloj();
  avisarFinDeSet(v);
  $('.marcador').hidden = false;
}

function pintarEstado(v: Vista) {
  const estado = $('#estado');
  if (v.finalizado) {
    const ganador = v.ganador!;
    const perdedor = ganador === 'local' ? 'visitante' : 'local';
    estado.replaceChildren(`🏆 ${nombreDe(ganador)} gana el partido ${v.sets[ganador]}-${v.sets[perdedor]}`);
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
    item.style.setProperty('--color', v.equipos[p.ganador].hex);
    return item;
  }));
}

function pintarHistorial(v: Vista) {
  $('#lista-historial').replaceChildren(...v.historial.toReversed().map((h) => {
    const item = el('li', {},
      el('span', { class: 'set' }, `Set ${h.set}`),
      el('span', { class: 'descripcion' }, h.descripcion),
      el('span', { class: 'marcador-parcial' }, `${h.puntos.local}-${h.puntos.visitante} (${h.sets.local}-${h.sets.visitante})`),
      el('time', { datetime: h.en }, hora.format(new Date(h.en))),
    );
    if (h.equipo) item.style.setProperty('--color', v.equipos[h.equipo].hex);
    return item;
  }));
  if (v.historial.length === 0) $('#lista-historial').replaceChildren(el('li', { class: 'vacio' }, 'Todavía no hay jugadas.'));
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
  const resultado = `${v.puntos[v.pendiente.ganador]}-${v.puntos[v.pendiente.ganador === 'local' ? 'visitante' : 'local']}`;
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
    accion({ tipo: 'editar_equipo', equipo: lado, nombre: String(datos.get('nombre')), color: String(datos.get('color')) });
  });
  dialogo.addEventListener('close', () => dialogo.remove());
  dialogo.showModal();
  nombre.select();
}

/** Las acciones se envían en orden, una detrás de otra. */
function accion(datos: { tipo: string; equipo?: Lado; valor?: number; nombre?: string; color?: string }) {
  cola = cola.then(async () => {
    try {
      const respuesta = await llamar<{ vista: Vista; reloj: Reloj }>(`/${id}/acciones`, { cuerpo: datos });
      pintar(respuesta.vista, respuesta.reloj);
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
  const { data, error } = await supabase.from('partidos').select('vista, reloj').eq('id', id).maybeSingle();
  if (error) return avisarError('No se ha podido cargar el partido');
  if (!data) {
    document.body.replaceChildren(el('main', { class: 'contenido' }, el('p', {}, 'Este partido no existe. '), el('a', { href: './' }, 'Ver partidos')));
    return;
  }
  pintar(data.vista as Vista, data.reloj as Reloj);
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
  for (const boton of document.querySelectorAll<HTMLButtonElement>('.editar-equipo')) {
    boton.addEventListener('click', () => {
      const lado = $(`#panel-${boton.dataset.posicion}`).dataset.lado as Lado | undefined;
      if (lado) editarEquipo(lado).catch((error) => avisarError((error as Error).message));
    });
  }
  $('#boton-reloj').addEventListener('click', () => {
    accion({ tipo: reloj.iniciadoEn ? 'pausar_reloj' : 'iniciar_reloj' });
  });
  $('#ver-historial').addEventListener('click', () => {
    const historial = $('#historial');
    historial.hidden = !historial.hidden;
    if (!historial.hidden) historial.scrollIntoView({ behavior: 'smooth' });
  });
  $('#pantalla-completa').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => avisarError('El navegador no permite pantalla completa'));
  });
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
      const fila = cambio.new as { vista?: Vista; reloj?: Reloj };
      if (fila.vista && fila.reloj) pintar(fila.vista, fila.reloj);
      else cargar();
    })
    .subscribe((estado) => {
      if (estado === 'SUBSCRIBED') cargar();
    });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') cargar();
  });
}

iniciar().catch((error) => avisarError((error as Error).message));
