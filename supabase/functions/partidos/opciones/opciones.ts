import { COLORES, CONFIG_POR_DEFECTO, EQUIPOS_POR_DEFECTO, LIMITES } from '../dominio/marcador.ts';

/** GET /partidos/opciones — catálogo para el formulario de nuevo partido. Público. */
export function verOpciones(): Response {
  return Response.json({
    colores: COLORES,
    configPorDefecto: CONFIG_POR_DEFECTO,
    equiposPorDefecto: EQUIPOS_POR_DEFECTO,
    limites: LIMITES,
  });
}
