import { $, avisarError } from './dom.ts';
import { cargarOpciones, crearPaleta } from './paleta.ts';
import { pintarSesion } from './sesion.ts';
import { ErrorSesion, llamar, supabase } from './supabase.ts';
import { LADOS, type Config, type Equipos } from '../../supabase/functions/partidos/dominio/marcador.ts';

const formulario = $<HTMLFormElement>('#formulario');
const irALogin = () => (location.href = `login.html?volver=${encodeURIComponent('nuevo.html' + location.search)}`);

async function iniciar() {
  if (!(await pintarSesion($('#sesion')))) return irALogin();
  const opciones = await cargarOpciones();

  // "Nuevo partido" desde un marcador: se parte de sus equipos y reglas.
  const desde = new URLSearchParams(location.search).get('desde');
  let previo: { config: Config; equipos: Equipos } | null = null;
  if (desde) {
    const { data } = await supabase.from('partidos').select('config, equipos').eq('id', Number(desde)).maybeSingle();
    previo = data;
  }
  const config = previo?.config ?? opciones.configPorDefecto;

  for (const lado of LADOS) {
    const elegido = previo?.equipos[lado].color ?? opciones.equiposPorDefecto[lado].color;
    const etiqueta = `Color del equipo ${lado}`;
    formulario.querySelector(`[data-lado="${lado}"] .paleta`)!.replaceWith(crearPaleta(`${lado}-color`, opciones.colores, elegido, etiqueta));
    const nombre = formulario.querySelector<HTMLInputElement>(`[name="${lado}-nombre"]`)!;
    nombre.placeholder = opciones.equiposPorDefecto[lado].nombre;
    if (previo) nombre.value = previo.equipos[lado].nombre;
  }
  for (const [campo, { min, max }] of Object.entries(opciones.limites)) {
    const input = formulario.querySelector<HTMLInputElement>(`[name="${campo}"]`)!;
    Object.assign(input, { min: String(min), max: String(max), value: String(config[campo as keyof Config]) });
  }
  formulario.querySelector<HTMLInputElement>('[name="diferenciaDos"]')!.checked = config.diferenciaDos;
  formulario.hidden = false;
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const datos = new FormData(formulario);
  const numero = (campo: string) => Number(datos.get(campo));
  const boton = formulario.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  boton.disabled = true;
  try {
    const { id } = await llamar<{ id: number }>('', {
      cuerpo: {
        equipos: Object.fromEntries(LADOS.map((lado) => [lado, {
          nombre: datos.get(`${lado}-nombre`),
          color: datos.get(`${lado}-color`),
        }])),
        config: {
          jugadores: numero('jugadores'),
          setsParaGanar: numero('setsParaGanar'),
          puntosPorSet: numero('puntosPorSet'),
          puntosUltimoSet: numero('puntosUltimoSet'),
          diferenciaDos: datos.get('diferenciaDos') === 'on',
        },
      },
    });
    location.href = `partido.html?id=${id}`;
  } catch (error) {
    if (error instanceof ErrorSesion) return irALogin();
    avisarError((error as Error).message);
    boton.disabled = false;
  }
});

iniciar().catch((error) => avisarError((error as Error).message));
