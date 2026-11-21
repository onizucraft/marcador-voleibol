import type { PostgresApi } from '@supabase/server/middleware/postgres-admin';
import { ErrorHttp } from '../http.ts';

/**
 * POST /partidos/:id/eliminar — borra el partido y, en cascada, todos sus eventos.
 * Irreversible. Solo administrador. (POST y no DELETE: el CORS por defecto de
 * @supabase/server no admite DELETE desde otro origen como GitHub Pages).
 */
export async function eliminarPartido(db: PostgresApi, id: number): Promise<Response> {
  const filas = await db.query`delete from public.partidos where id = ${id} returning id`;
  if (filas.length === 0) throw new ErrorHttp(404, 'Partido no encontrado');
  return Response.json({ id, eliminado: true });
}
