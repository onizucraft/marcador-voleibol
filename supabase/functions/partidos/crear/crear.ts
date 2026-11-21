import type { PostgresApi } from '@supabase/server/middleware/postgres-admin';
import { resumir, validarNuevoPartido, vistaInicial } from '../dominio/marcador.ts';
import { leerJson } from '../http.ts';

/** POST /partidos — crea un partido. Solo administrador. */
export async function crearPartido(req: Request, db: PostgresApi): Promise<Response> {
  const { config, equipos } = validarNuevoPartido(await leerJson(req));
  const vista = vistaInicial(config, equipos);
  const r = resumir(vista);
  const [fila]: { id: string }[] = await db.query`
    insert into public.partidos (config, equipos, vista, estado, sets_local, sets_visitante, ganador)
    values (${JSON.stringify(config)}::jsonb, ${JSON.stringify(equipos)}::jsonb, ${JSON.stringify(vista)}::jsonb,
            ${r.estado}, ${r.setsLocal}, ${r.setsVisitante}, ${r.ganador})
    returning id`;
  return Response.json({ id: Number(fila.id), vista }, { status: 201 });
}
