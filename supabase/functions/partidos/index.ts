// Edge Function `partidos`: toda la lógica del marcador.
//
//   GET  /partidos/opciones          público   catálogo de colores y configuración
//   GET  /partidos/hora              público   hora del servidor (sincroniza el reloj de juego)
//   POST /partidos                   admin     crear partido
//   POST /partidos/:id/acciones      admin     punto, +2, confirmar, cambio de lado, restablecer, deshacer, rehacer,
//                                              reloj (iniciar/pausar) y editar equipo
//
// Las lecturas del público no pasan por aquí: leen `partidos.vista` vía PostgREST/Realtime.

import '@supabase/functions-js/edge-runtime.d.ts';
import 'pg';
import { pipeline } from '@supabase/middleware';
import { withSupabase } from '@supabase/server';
import { withPostgresAdminClient, type PostgresApi } from '@supabase/server/middleware/postgres-admin';
import { ejecutarAccion } from './acciones/acciones.ts';
import { crearPartido } from './crear/crear.ts';
import { verHora } from './hora/hora.ts';
import { ErrorHttp, respuestaDeError } from './http.ts';
import { verOpciones } from './opciones/opciones.ts';

type Params = Record<string, string>;

interface Ruta {
  metodo: string;
  patron: RegExp;
  fetch: (req: Request) => Response | Promise<Response>;
}

/** Ruta relativa a la función, sea cual sea el prefijo con el que llegue (`/partidos`, `/functions/v1/partidos`). */
const subruta = (req: Request) => new URL(req.url).pathname.replace(/^.*?\/partidos(?=\/|$)/, '') || '/';

function publica(metodo: string, patron: RegExp, manejador: (req: Request) => Response | Promise<Response>): Ruta {
  return {
    metodo,
    patron,
    fetch: pipeline([withSupabase({ auth: 'none' })], async (req: Request) => {
      try {
        return await manejador(req);
      } catch (error) {
        return respuestaDeError(error);
      }
    }),
  };
}

function soloAdmin(
  metodo: string,
  patron: RegExp,
  manejador: (req: Request, db: PostgresApi, params: Params) => Promise<Response>,
): Ruta {
  return {
    metodo,
    patron,
    // auth 'user' exige un JWT válido de Supabase Auth. El registro público está
    // desactivado, así que cualquier usuario autenticado (no anónimo) es administrador.
    fetch: pipeline(
      [withSupabase({ auth: 'user' }), withPostgresAdminClient({ pool: { max: 2 } })],
      // deno-lint-ignore no-explicit-any
      async (req: Request, ctx: any) => {
        try {
          if (ctx.jwtClaims?.is_anonymous) throw new ErrorHttp(403, 'Solo el administrador puede hacer esto');
          const params = patron.exec(subruta(req))?.groups ?? {};
          return await manejador(req, ctx.postgresAdmin, params);
        } catch (error) {
          return respuestaDeError(error);
        }
      },
    ),
  };
}

const RUTAS: Ruta[] = [
  publica('GET', /^\/opciones$/, verOpciones),
  publica('GET', /^\/hora$/, verHora),
  soloAdmin('POST', /^\/?$/, (req, db) => crearPartido(req, db)),
  soloAdmin('POST', /^\/(?<id>\d+)\/acciones$/, (req, db, { id }) => ejecutarAccion(req, db, Number(id))),
];

export default {
  fetch(req: Request) {
    const sub = subruta(req);
    const candidatas = RUTAS.filter((r) => r.patron.test(sub));
    if (candidatas.length === 0) return Response.json({ error: 'No encontrado' }, { status: 404 });
    // El preflight CORS lo responde withSupabase de la ruta.
    const ruta = req.method === 'OPTIONS' ? candidatas[0] : candidatas.find((r) => r.metodo === req.method);
    if (!ruta) return Response.json({ error: 'Método no permitido' }, { status: 405 });
    return ruta.fetch(req);
  },
};
