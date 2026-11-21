import { $, avisarError, el } from './dom.ts';
import { pintarSesion } from './sesion.ts';
import { supabase } from './supabase.ts';
import type { Equipos, Lado } from '../../supabase/functions/partidos/dominio/marcador.ts';

interface FilaPartido {
  id: number;
  programado_en: string;
  comenzado_en: string | null;
  equipos: Equipos;
  estado: 'programado' | 'en_juego' | 'finalizado';
  sets_local: number;
  sets_visitante: number;
  ganador: Lado | null;
}

const formatoFecha = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const ETIQUETAS = { programado: 'Previsto', en_juego: 'En juego', finalizado: 'Finalizado' };

function tarjeta(p: FilaPartido) {
  const equipo = (lado: Lado, sets: number) => {
    const fila = el('div', { class: `equipo${p.ganador === lado ? ' ganador' : ''}` },
      el('span', { class: 'muestra' }),
      el('span', { class: 'equipo-nombre' }, p.equipos[lado].nombre),
      el('span', { class: 'sets' }, String(sets)),
    );
    fila.style.setProperty('--color', p.equipos[lado].hex);
    return fila;
  };
  return el('a', { class: 'tarjeta partido', href: `partido.html?id=${p.id}` },
    el('div', { class: 'meta' },
      el('time', { datetime: p.programado_en, title: 'Fecha y hora previstas' }, formatoFecha.format(new Date(p.programado_en))),
      el('span', { class: `etiqueta-estado ${p.estado}` }, ETIQUETAS[p.estado]),
    ),
    equipo('local', p.sets_local),
    equipo('visitante', p.sets_visitante),
  );
}

function pintarLista(contenedor: HTMLElement, partidos: FilaPartido[], vacio: string) {
  contenedor.replaceChildren(...(partidos.length ? partidos.map(tarjeta) : [el('p', { class: 'vacio' }, vacio)]));
}

async function cargar() {
  const { data, error } = await supabase
    .from('partidos')
    .select('id, programado_en, comenzado_en, equipos, estado, sets_local, sets_visitante, ganador')
    .order('programado_en', { ascending: false })
    .limit(200);
  if (error) return avisarError('No se han podido cargar los partidos');
  const partidos = data as FilaPartido[];
  pintarLista($('#en-juego'), partidos.filter((p) => p.estado === 'en_juego'), 'No hay ningún partido en juego.');
  // Los próximos, del más cercano al más lejano.
  pintarLista($('#proximos'), partidos.filter((p) => p.estado === 'programado').reverse(), 'No hay partidos previstos.');
  pintarLista($('#anteriores'), partidos.filter((p) => p.estado === 'finalizado'), 'Todavía no hay partidos terminados.');
}

pintarSesion($('#sesion'));
cargar();
supabase
  .channel('listado')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'partidos' }, () => cargar())
  .subscribe();
