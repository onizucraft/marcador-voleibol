import type { PostgresApi } from '@supabase/server/middleware/postgres-admin';
import {
  ACCIONES_RELOJ,
  accionDeReloj,
  comienzoTras,
  editarEquipo,
  relojTrasCambio,
  resolverAccion,
  resumir,
  validarProgramacion,
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
 * deshacer, rehacer, quitar punto, iniciar y pausar el reloj, editar nombre/color de un
 * equipo y cambiar la fecha y hora previstas. Solo administrador.
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
    const tipo = accion?.tipo ?? '';
    const comenzadoEn = comienzoTras(partido.comenzadoEn, tipo, ahora);
    const respuesta = (cambios: Partial<Respuesta>) =>
      Response.json({
        id,
        // Versión que acaba de quedar guardada: el cliente descarta avisos de Realtime más viejos.
        version: partido.version + 1,
        vista: partido.vista,
        reloj: partido.reloj,
        programadoEn: partido.programadoEn,
        comenzadoEn,
        ...cambios,
      });

    if (ACCIONES_RELOJ.includes(tipo)) {
      const reloj = accionDeReloj(partido.reloj, tipo, ahora, partido.vista.finalizado);
      const { estado } = resumir(partido.vista, comenzadoEn);
      if (await guardarReloj(db, id, partido.version, reloj, comenzadoEn, estado)) return respuesta({ reloj });
      continue;
    }

    if (tipo === 'editar_equipo') {
      const { equipos, vista } = editarEquipo(partido, accion);
      if (await guardarEquipos(db, id, partido.version, equipos, vista)) return respuesta({ vista });
      continue;
    }

    if (tipo === 'editar_programacion') {
      const programadoEn = validarProgramacion((accion as { programadoEn?: unknown }).programadoEn);
      if (await guardarProgramacion(db, id, partido.version, programadoEn)) return respuesta({ programadoEn });
      continue;
    }

    const cambio = resolverAccion(partido, accion, ahora);
    const reloj = relojTrasCambio(partido.reloj, cambio.vista, ahora);
    if (await guardar(db, id, partido.version, cambio, reloj, comenzadoEn)) {
      return respuesta({ vista: cambio.vista, reloj });
    }
  }
  throw new ErrorHttp(409, 'El marcador ha cambiado mientras se guardaba; vuelve a intentarlo');
}

interface Respuesta {
  vista: Vista;
  reloj: Reloj;
  programadoEn: string;
  comenzadoEn: string | null;
}

type PartidoCargado = PartidoGuardado & {
  version: number;
  reloj: Reloj;
  vista: Vista;
  programadoEn: string;
  comenzadoEn: string | null;
};

async function cargar(db: PostgresApi, id: number): Promise<PartidoCargado | null> {
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

async function guardarReloj(
  db: PostgresApi, id: number, version: number, reloj: Reloj, comenzadoEn: string | null, estado: string,
): Promise<boolean> {
  const filas = await db.query`
    update public.partidos
       set reloj = ${JSON.stringify(reloj)}::jsonb, comenzado_en = ${comenzadoEn}::timestamptz, estado = ${estado},
           version = version + 1
     where id = ${id} and version = ${version}
    returning id`;
  return filas.length === 1;
}

async function guardarProgramacion(db: PostgresApi, id: number, version: number, programadoEn: string) {
  const filas = await db.query`
    update public.partidos set programado_en = ${programadoEn}::timestamptz, version = version + 1
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
async function guardar(
  db: PostgresApi, id: number, version: number, cambio: Cambio, reloj: Reloj, comenzadoEn: string | null,
): Promise<boolean> {
  const r = resumir(cambio.vista, comenzadoEn);
  const vista = JSON.stringify(cambio.vista);
  const relojJson = JSON.stringify(reloj);

  if (!cambio.escribir) {
    const filas = await db.query`
      update public.partidos
         set cursor = ${cambio.cursor}, total = ${cambio.total}, version = version + 1,
             vista = ${vista}::jsonb, reloj = ${relojJson}::jsonb, comenzado_en = ${comenzadoEn}::timestamptz,
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
             vista = ${vista}::jsonb, reloj = ${relojJson}::jsonb, comenzado_en = ${comenzadoEn}::timestamptz,
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
