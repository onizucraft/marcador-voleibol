import type { PostgresApi } from '@supabase/server/middleware/postgres-admin';
import { recalcularVista } from '../dominio/marcador.ts';
import { cargarPartido } from '../repositorio.ts';

/**
 * POST /partidos/recalcular — vuelve a calcular la vista guardada de todos los partidos
 * con las reglas y la paleta actuales (p. ej. tras cambiar el formato del historial).
 * Solo con la clave secreta del proyecto. No toca eventos, puntos ni reloj.
 */
export async function recalcularTodo(db: PostgresApi): Promise<Response> {
  const ids: { id: string }[] = await db.query`select id from public.partidos order by id`;
  let recalculados = 0;
  for (const { id } of ids) {
    const partido = await cargarPartido(db, Number(id));
    if (!partido) continue;
    const vista = recalcularVista(partido);
    const filas = await db.query`
      update public.partidos
         set vista = ${JSON.stringify(vista)}::jsonb, equipos = ${JSON.stringify(vista.equipos)}::jsonb,
             version = version + 1
       where id = ${Number(id)} and version = ${partido.version}
      returning id`;
    recalculados += filas.length;
  }
  return Response.json({ partidos: ids.length, recalculados });
}
