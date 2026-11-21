import type { PostgresApi } from '@supabase/server/middleware/postgres-admin';
import {
  ACCIONES_RELOJ,
  accionDeReloj,
  editarEquipo,
  relojTrasCambio,
  resolverAccion,
  resumir,
  type Cambio,
  type Equipos,
  type Evento,
  type PartidoGuardado,
  type Reloj,
  type Vista,
} from '../dominio/marcador.ts';
import { ErrorHttp, leerJson } from '../http.ts';

const REINTENTOS = 3;

/**
 * POST /partidos/:id/acciones — punto, +2, confirmar, cambio de lado, restablecer,
 * deshacer, rehacer, iniciar y pausar el reloj, y editar nombre/color de un equipo.
 * Solo administrador.
 *
 * Lee el partido, resuelve la acción en el dominio y guarda con control optimista
 * (columna `version`). Si otro administrador ha escrito entre medias, reintenta
 * sobre el estado nuevo.
 */
export async function ejecutarAccion(req: Request, db: PostgresApi, id: number): Promise<Response> {
  const accion = (await leerJson(req)) as { tipo?: string } | null;
  for (let intento = 0; intento < REINTENTOS; intento++) {
    const partido = await cargar(db, id);
    if (!partido) throw new ErrorHttp(404, 'Partido no encontrado');
    const ahora = new Date().toISOString();

    if (ACCIONES_RELOJ.includes(accion?.tipo ?? '')) {
      const reloj = accionDeReloj(partido.reloj, accion!.tipo!, ahora, partido.vista.finalizado);
      if (await guardarReloj(db, id, partido.version, reloj)) {
        return Response.json({ id, vista: partido.vista, reloj });
      }
      continue;
    }

    if (accion?.tipo === 'editar_equipo') {
      const { equipos, vista } = editarEquipo(partido, accion);
      if (await guardarEquipos(db, id, partido.version, equipos, vista)) {
        return Response.json({ id, vista, reloj: partido.reloj });
      }
      continue;
    }

    const cambio = resolverAccion(partido, accion, ahora);
    const reloj = relojTrasCambio(partido.reloj, cambio.vista, ahora);
    if (await guardar(db, id, partido.version, cambio, reloj)) {
      return Response.json({ id, vista: cambio.vista, reloj });
    }
  }
  throw new ErrorHttp(409, 'El marcador ha cambiado mientras se guardaba; vuelve a intentarlo');
}

type PartidoCargado = PartidoGuardado & { version: number; reloj: Reloj; vista: Vista };

async function cargar(db: PostgresApi, id: number): Promise<PartidoCargado | null> {
  // Una sola consulta: partido y eventos salen de la misma instantánea.
  const [fila]: (Omit<PartidoCargado, 'eventos'> & { eventos: Evento[] })[] = await db.query`
    select p.config, p.equipos, p.cursor, p.version, p.reloj, p.vista,
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
  return { ...fila, eventos: fila.eventos.map((e) => ({ ...e, en: new Date(e.en).toISOString() })) };
}

async function guardarReloj(db: PostgresApi, id: number, version: number, reloj: Reloj): Promise<boolean> {
  const filas = await db.query`
    update public.partidos set reloj = ${JSON.stringify(reloj)}::jsonb, version = version + 1
     where id = ${id} and version = ${version}
    returning id`;
  return filas.length === 1;
}

async function guardarEquipos(db: PostgresApi, id: number, version: number, equipos: Equipos, vista: Vista) {
  const filas = await db.query`
    update public.partidos
       set equipos = ${JSON.stringify(equipos)}::jsonb, vista = ${JSON.stringify(vista)}::jsonb, version = version + 1
     where id = ${id} and version = ${version}
    returning id`;
  return filas.length === 1;
}

/**
 * Escribe el cambio en una única sentencia (atómica). Devuelve false si la versión ya no coincide.
 * Los eventos se sustituyen desde la posición `desde`: un punto nuevo reescribe solo esa
 * posición; una corrección del histórico reescribe desde el punto corregido en adelante.
 */
async function guardar(db: PostgresApi, id: number, version: number, cambio: Cambio, reloj: Reloj): Promise<boolean> {
  const r = resumir(cambio.vista);
  const vista = JSON.stringify(cambio.vista);
  const relojJson = JSON.stringify(reloj);

  if (!cambio.escribir) {
    const filas = await db.query`
      update public.partidos
         set cursor = ${cambio.cursor}, total = ${cambio.total}, version = version + 1,
             vista = ${vista}::jsonb, reloj = ${relojJson}::jsonb,
             estado = ${r.estado}, sets_local = ${r.setsLocal}, sets_visitante = ${r.setsVisitante}, ganador = ${r.ganador}
       where id = ${id} and version = ${version}
      returning id`;
    return filas.length === 1;
  }

  const { desde, eventos } = cambio.escribir;
  const nuevos = JSON.stringify(eventos.map(({ tipo, equipo, valor, en }) => ({ tipo, equipo: equipo ?? null, valor: valor ?? null, en })));
  // La PK de eventos es DEFERRABLE: borrar e insertar las mismas posiciones en la misma
  // sentencia es válido porque la unicidad se comprueba al final.
  const filas = await db.query`
    with actualizado as (
      update public.partidos
         set cursor = ${cambio.cursor}, total = ${cambio.total}, version = version + 1,
             vista = ${vista}::jsonb, reloj = ${relojJson}::jsonb,
             estado = ${r.estado}, sets_local = ${r.setsLocal}, sets_visitante = ${r.setsVisitante}, ganador = ${r.ganador}
       where id = ${id} and version = ${version}
      returning id
    ), descartados as (
      delete from public.eventos
       where partido_id in (select id from actualizado) and seq >= ${desde}
    ), insertados as (
      insert into public.eventos (partido_id, seq, tipo, equipo, valor, creado_en)
      select a.id, ${desde} + e.n - 1, e.tipo, e.equipo, e.valor, e.en
        from actualizado a,
             rows from (jsonb_to_recordset(${nuevos}::jsonb) as (tipo text, equipo text, valor smallint, en timestamptz))
               with ordinality as e(tipo, equipo, valor, en, n)
    )
    select id from actualizado`;
  return filas.length === 1;
}
