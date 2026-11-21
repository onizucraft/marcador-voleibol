// Prueba de humo contra un Supabase real (local o nube): Auth, Edge Function, PostgREST y RLS.
//
//   ADMIN_EMAIL=... ADMIN_CONTRASENA=... node --env-file=.env.local scripts/prueba-humo.ts
//
// Crea un partido de prueba (queda en el listado como "Prueba humo").

import assert from 'node:assert/strict';
import { createClient, FunctionsHttpError } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL!;
const clave = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const opcionesCliente = { auth: { persistSession: false } };
const publico = createClient(url, clave, opcionesCliente);
const admin = createClient(url, clave, opcionesCliente);

async function invocar(cliente: typeof publico, ruta: string, cuerpo?: object, metodo: 'GET' | 'POST' = 'POST') {
  const { data, error, response } = await cliente.functions.invoke(`partidos${ruta}`, { method: metodo, body: cuerpo });
  if (error instanceof FunctionsHttpError) {
    const r = error.context as Response;
    return { estado: r.status, cuerpo: await r.json().catch(() => null) };
  }
  if (error) throw error;
  return { estado: response!.status, cuerpo: data };
}

function paso(texto: string) {
  console.log(`✔ ${texto}`);
}

const opciones = await invocar(publico, '/opciones', undefined, 'GET');
assert.equal(opciones.estado, 200);
assert.ok(opciones.cuerpo.colores.length > 0);
paso('GET /opciones es público');

const hora = await invocar(publico, '/hora', undefined, 'GET');
assert.equal(hora.estado, 200);
assert.ok(Math.abs(hora.cuerpo.ahora - Date.now()) < 60_000, 'la hora del servidor debería ser razonable');
paso('GET /hora es público y devuelve la hora del servidor');

const sinSesion = await invocar(publico, '', { equipos: {} });
assert.equal(sinSesion.estado, 401);
paso('crear partido sin sesión → 401');

const { error: errorLogin } = await admin.auth.signInWithPassword({
  email: process.env.ADMIN_EMAIL!,
  password: process.env.ADMIN_CONTRASENA!,
});
assert.equal(errorLogin, null);
paso('login de administrador');

const { error: errorRegistro } = await publico.auth.signUp({ email: 'intruso@example.com', password: 'una-contrasena-larga' });
assert.ok(errorRegistro, 'el registro público debería estar desactivado');
paso('registro público desactivado');

const invalido = await invocar(admin, '', { equipos: { local: { color: 'azul' } } });
assert.equal(invalido.estado, 400);
assert.match(invalido.cuerpo.error, /mismo color/);
paso('validación de partido → 400 con mensaje en español');

const sinFecha = await invocar(admin, '', { equipos: {} });
assert.equal(sinFecha.estado, 400);
assert.match(sinFecha.cuerpo.error, /fecha y hora previstas/);
paso('crear partido sin fecha prevista → 400');

const creado = await invocar(admin, '', {
  programadoEn: '2026-12-05T17:30:00.000Z',
  equipos: { local: { nombre: 'Prueba humo A', color: 'azul' }, visitante: { nombre: 'Prueba humo B', color: 'naranja' } },
  config: { jugadores: 4, setsParaGanar: 1, puntosPorSet: 5, puntosUltimoSet: 5, diferenciaDos: true },
});
assert.equal(creado.estado, 201);
const id = creado.cuerpo.id as number;
paso(`partido creado (id ${id})`);

const accion = (cuerpo: object) => invocar(admin, `/${id}/acciones`, cuerpo);
const programacionDe = async () =>
  (await publico.from('partidos').select('estado, programado_en, comenzado_en').eq('id', id).single()).data!;

let f = await programacionDe();
assert.equal(f.estado, 'programado');
assert.equal(new Date(f.programado_en).toISOString(), '2026-12-05T17:30:00.000Z');
assert.equal(f.comenzado_en, null);
const reprogramado = await accion({ tipo: 'editar_programacion', programadoEn: '2026-12-06T10:00:00.000Z' });
assert.equal(reprogramado.cuerpo.programadoEn, '2026-12-06T10:00:00.000Z');
assert.equal((await accion({ tipo: 'editar_programacion', programadoEn: 'pasado mañana' })).estado, 400);
paso('nace como programado y la fecha prevista se puede editar');

let r = await accion({ tipo: 'iniciar_reloj' });
assert.ok(r.cuerpo.reloj.iniciadoEn);
assert.equal((await accion({ tipo: 'iniciar_reloj' })).estado, 409);
await new Promise((ok) => setTimeout(ok, 300));
r = await accion({ tipo: 'pausar_reloj' });
assert.equal(r.cuerpo.reloj.iniciadoEn, null);
assert.ok(r.cuerpo.reloj.acumuladoMs >= 300);
r = await accion({ tipo: 'iniciar_reloj' });
paso('reloj: arrancar, pausar y acumular');

f = await programacionDe();
assert.equal(f.estado, 'en_juego');
assert.ok(f.comenzado_en, 'el primer arranque del reloj marca el comienzo');
assert.notEqual(new Date(f.comenzado_en).toISOString(), new Date(f.programado_en).toISOString());
const comienzo = f.comenzado_en;
paso('el comienzo real se registra solo y es distinto de la hora prevista');

r = await accion({ tipo: 'punto', equipo: 'local' });
assert.equal(r.cuerpo.vista.puntos.local, 1);
r = await accion({ tipo: 'punto', equipo: 'visitante', valor: 2 });
assert.deepEqual(r.cuerpo.vista.puntos, { local: 1, visitante: 2 });
paso('punto y +2');

r = await accion({ tipo: 'deshacer' });
assert.equal(r.cuerpo.vista.puntos.visitante, 0);
r = await accion({ tipo: 'rehacer' });
assert.equal(r.cuerpo.vista.puntos.visitante, 2);
assert.ok(r.cuerpo.reloj.iniciadoEn, 'deshacer/rehacer no deben parar el reloj');
paso('deshacer y rehacer (sin tocar el reloj)');

r = await accion({ tipo: 'deshacer' });
r = await accion({ tipo: 'punto', equipo: 'local' });
assert.equal(r.cuerpo.vista.puedeRehacer, false);
paso('acción nueva tras deshacer descarta el rehacer');

r = await accion({ tipo: 'cambio_lado' });
assert.equal(r.cuerpo.vista.izquierda, 'visitante');
paso('cambio de lado');

r = await accion({ tipo: 'editar_equipo', equipo: 'local', nombre: 'Prueba humo A2', color: 'verde' });
assert.equal(r.estado, 200);
assert.equal(r.cuerpo.vista.equipos.local.nombre, 'Prueba humo A2');
assert.equal(r.cuerpo.vista.equipos.local.color, 'verde');
assert.equal((await accion({ tipo: 'editar_equipo', equipo: 'local', color: 'naranja' })).estado, 400);
r = await accion({ tipo: 'deshacer' });
assert.equal(r.cuerpo.vista.equipos.local.nombre, 'Prueba humo A2', 'deshacer no debe revertir el nombre');
r = await accion({ tipo: 'rehacer' });
const { data: listado } = await publico.from('partidos').select('equipos').eq('id', id).single();
assert.equal(listado!.equipos.local.nombre, 'Prueba humo A2');
paso('editar nombre y color a mitad de partido (fuera de deshacer)');

// Las tres peticiones salen a la vez; el control optimista debe aplicarlas todas.
const concurrentes = await Promise.all([1, 2, 3].map(() => accion({ tipo: 'punto', equipo: 'visitante' })));
assert.ok(concurrentes.every((c) => c.estado === 200), JSON.stringify(concurrentes.map((c) => c.cuerpo)));
const { data: tras } = await publico.from('partidos').select('vista').eq('id', id).single();
assert.deepEqual(tras!.vista.puntos, { local: 2, visitante: 3 });
paso('puntos concurrentes no se pierden');

// Corrección: el visitante tenía 3; uno se anotó por error en medio de la secuencia.
const antes = tras!.vista.historial.length;
r = await accion({ tipo: 'quitar_punto', equipo: 'visitante' });
assert.deepEqual(r.cuerpo.vista.puntos, { local: 2, visitante: 2 });
assert.equal(r.cuerpo.vista.historial.length, antes - 1);
assert.equal(r.cuerpo.vista.historial.at(-1).descripcion.startsWith('Punto para'), true);
assert.equal(r.cuerpo.vista.puedeRehacer, false);
r = await accion({ tipo: 'punto', equipo: 'visitante' });
assert.deepEqual(r.cuerpo.vista.puntos, { local: 2, visitante: 3 });
paso('restar un punto corrige el histórico sin dejar rastro');
assert.equal((await programacionDe()).comenzado_en, comienzo, 'el comienzo no cambia con más jugadas');

await accion({ tipo: 'punto', equipo: 'visitante' });
r = await accion({ tipo: 'punto', equipo: 'visitante' });
assert.equal(r.cuerpo.vista.pendiente?.tipo, 'partido');
const bloqueado = await accion({ tipo: 'punto', equipo: 'local' });
assert.equal(bloqueado.estado, 409);
paso('fin de partido pendiente de confirmar bloquea puntos → 409');

r = await accion({ tipo: 'confirmar' });
assert.equal(r.cuerpo.vista.finalizado, true);
assert.equal(r.cuerpo.vista.ganador, 'visitante');
assert.equal(r.cuerpo.reloj.iniciadoEn, null);
assert.equal((await accion({ tipo: 'iniciar_reloj' })).estado, 409);
paso('confirmar fin de partido (el reloj se para solo)');

const { data: fila } = await publico.from('partidos').select('estado, sets_visitante, ganador, vista').eq('id', id).single();
assert.deepEqual([fila!.estado, fila!.sets_visitante, fila!.ganador], ['finalizado', 1, 'visitante']);
assert.equal(fila!.vista.historial.length, r.cuerpo.vista.historial.length);
paso('el público lee el partido y su vista');

const { data: eventos } = await publico.from('eventos').select('*').eq('partido_id', id);
assert.ok(!eventos || eventos.length === 0, 'eventos no debería ser legible');
const { error: errorEscritura } = await publico.from('partidos').update({ sets_local: 99 }).eq('id', id);
assert.ok(errorEscritura, 'el público no debería poder escribir');
const { error: errorEscrituraAdmin } = await admin.from('partidos').update({ sets_local: 99 }).eq('id', id);
assert.ok(errorEscrituraAdmin, 'ni siquiera el admin escribe directamente: solo la Edge Function');
paso('RLS: eventos privados y nadie escribe en partidos desde el cliente');

const noExiste = await invocar(admin, '/999999999/acciones', { tipo: 'deshacer' });
assert.equal(noExiste.estado, 404);
paso('partido inexistente → 404');

const desechable = await invocar(admin, '', { programadoEn: '2026-12-01T10:00:00.000Z' });
const idDesechable = desechable.cuerpo.id as number;
await invocar(admin, `/${idDesechable}/acciones`, { tipo: 'punto', equipo: 'local' });
assert.equal((await invocar(publico, `/${idDesechable}/eliminar`)).estado, 401);
const eliminado = await invocar(admin, `/${idDesechable}/eliminar`);
assert.equal(eliminado.estado, 200);
const { data: yaNoEsta } = await publico.from('partidos').select('id').eq('id', idDesechable);
assert.equal(yaNoEsta!.length, 0);
assert.equal((await invocar(admin, `/${idDesechable}/eliminar`)).estado, 404);
paso('eliminar partido: solo admin, borra partido y eventos, 404 si ya no existe');

console.log('\nTodo correcto.');
