import type { PostgresApi } from '@supabase/server/middleware/postgres-admin';
import type { Evento, PartidoGuardado, Reloj, Vista } from './dominio/marcador.ts';

// Lectura de un partido completo, común a los casos de uso que lo reescriben.

export type PartidoCargado = PartidoGuardado & {
  version: number;
  reloj: Reloj;
  vista: Vista;
  programadoEn: string;
  comenzadoEn: string | null;
};

export async function cargarPartido(db: PostgresApi, id: number): Promise<PartidoCargado | null> {
  // Una sola consulta: partido y eventos salen de la misma instantánea.
  const [fila]: (Omit<PartidoCargado, 'eventos'> & { eventos: Evento[] })[] = await db.query`
    select p.config, p.equipos, p.cursor, p.version, p.reloj, p.vista,
           to_json(p.programado_en) #>> '{}' as "programadoEn",
           to_json(p.comenzado_en) #>> '{}' as "comenzadoEn",
           coalesce((
             select json_agg(json_build_object(
                      'tipo', e.tipo, 'equipo', e.equipo, 'valor', e.valor, 'en', e.creado_en
                    ) order by e.seq)
             from public.eventos e
             where e.partido_id = p.id and e.seq <= p.total
           ), '[]'::json) as eventos
    from public.partidos p
    where p.id = ${id}`;
  if (!fila) return null;
  const iso = (valor: string | null) => (valor ? new Date(valor).toISOString() : null);
  return {
    ...fila,
    programadoEn: iso(fila.programadoEn)!,
    comenzadoEn: iso(fila.comenzadoEn),
    eventos: fila.eventos.map((e) => ({ ...e, en: iso(e.en)! })),
  };
}

