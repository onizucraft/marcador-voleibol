import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accionDeReloj,
  CONFIG_POR_DEFECTO,
  editarEquipo,
  RELOJ_INICIAL,
  relojTrasCambio,
  ErrorDominio,
  resolverAccion,
  validarNuevoPartido,
  type Config,
  type PartidoGuardado,
} from './marcador.ts';

const AHORA = '2026-11-21T10:00:00.000Z';

function nuevoPartido(config: Partial<Config> = {}): PartidoGuardado {
  const { equipos } = validarNuevoPartido({});
  return { config: { ...CONFIG_POR_DEFECTO, ...config }, equipos, cursor: 0, eventos: [] };
}

/** Ejecuta acciones encadenadas como lo haría la Edge Function (guardando entre medias). */
function jugar(partido: PartidoGuardado, ...acciones: object[]) {
  let actual = partido;
  let cambio;
  for (const accion of acciones) {
    cambio = resolverAccion(actual, accion, AHORA);
    const eventos = cambio.escribir
      ? [...actual.eventos.slice(0, cambio.escribir.desde - 1), ...cambio.escribir.eventos]
      : actual.eventos;
    actual = { ...actual, cursor: cambio.cursor, eventos };
  }
  return { partido: actual, vista: cambio!.vista };
}

const puntos = (equipo: string, n: number) => Array.from({ length: n }, () => ({ tipo: 'punto', equipo }));

test('al hacer click suma un punto y la opción +2 suma dos', () => {
  const { vista } = jugar(nuevoPartido(), { tipo: 'punto', equipo: 'local' }, { tipo: 'punto', equipo: 'visitante', valor: 2 });
  assert.deepEqual(vista.puntos, { local: 1, visitante: 2 });
  assert.equal(vista.historial[1].descripcion, 'Punto para Visitante (+2)');
});

test('el set no se cierra solo: queda pendiente de confirmar y bloquea más puntos', () => {
  const { partido, vista } = jugar(nuevoPartido(), ...puntos('local', 25));
  assert.deepEqual(vista.pendiente, { tipo: 'set', ganador: 'local', set: 1 });
  assert.throws(() => resolverAccion(partido, { tipo: 'punto', equipo: 'local' }, AHORA), ErrorDominio);
});

test('al confirmar el set suma el set, pone los puntos a cero y cambia de lado', () => {
  const { vista } = jugar(nuevoPartido(), ...puntos('local', 25), { tipo: 'confirmar' });
  assert.deepEqual(vista.sets, { local: 1, visitante: 0 });
  assert.deepEqual(vista.puntos, { local: 0, visitante: 0 });
  assert.equal(vista.izquierda, 'visitante');
  assert.deepEqual(vista.parciales, [{ local: 25, visitante: 0, ganador: 'local' }]);
});

test('con diferencia de dos, 25-24 no cierra el set', () => {
  const { vista } = jugar(nuevoPartido(), ...puntos('visitante', 24), ...puntos('local', 25));
  assert.equal(vista.pendiente, null);
  const fin = jugar(nuevoPartido(), ...puntos('visitante', 24), ...puntos('local', 26));
  assert.equal(fin.vista.pendiente?.ganador, 'local');
});

test('sin diferencia de dos, 25-24 cierra el set', () => {
  const { vista } = jugar(nuevoPartido({ diferenciaDos: false }), ...puntos('visitante', 24), ...puntos('local', 25));
  assert.equal(vista.pendiente?.ganador, 'local');
});

test('el set de desempate se juega a los puntos del último set', () => {
  const config = { setsParaGanar: 2, puntosPorSet: 25, puntosUltimoSet: 15 };
  const { vista } = jugar(
    nuevoPartido(config),
    ...puntos('local', 25), { tipo: 'confirmar' },
    ...puntos('visitante', 25), { tipo: 'confirmar' },
  );
  assert.equal(vista.setActual, 3);
  assert.equal(vista.setDecisivo, true);
  assert.equal(vista.objetivo, 15);
});

test('el último set ganado pide confirmar el final del partido', () => {
  const config = { setsParaGanar: 2, puntosPorSet: 5, puntosUltimoSet: 3 };
  const antes = jugar(nuevoPartido(config), ...puntos('local', 5), { tipo: 'confirmar' }, ...puntos('local', 5));
  assert.equal(antes.vista.pendiente?.tipo, 'partido');
  const { vista } = jugar(antes.partido, { tipo: 'confirmar' });
  assert.equal(vista.finalizado, true);
  assert.equal(vista.ganador, 'local');
  assert.equal(vista.fin, AHORA);
  // Al acabar el partido no se cambia de lado.
  assert.equal(vista.izquierda, 'visitante');
});

test('deshacer y rehacer mueven el cursor sin perder eventos', () => {
  const jugado = jugar(nuevoPartido(), ...puntos('local', 3));
  const deshecho = jugar(jugado.partido, { tipo: 'deshacer' }, { tipo: 'deshacer' });
  assert.equal(deshecho.vista.puntos.local, 1);
  assert.equal(deshecho.vista.puedeRehacer, true);
  const rehecho = jugar(deshecho.partido, { tipo: 'rehacer' });
  assert.equal(rehecho.vista.puntos.local, 2);
});

test('una acción nueva tras deshacer descarta lo que se podía rehacer', () => {
  const deshecho = jugar(nuevoPartido(), ...puntos('local', 3), { tipo: 'deshacer' }, { tipo: 'deshacer' });
  const { partido, vista } = jugar(deshecho.partido, { tipo: 'punto', equipo: 'visitante' });
  assert.deepEqual(vista.puntos, { local: 1, visitante: 1 });
  assert.equal(vista.puedeRehacer, false);
  assert.equal(partido.eventos.length, 2);
});

test('deshacer la confirmación vuelve a dejar el set pendiente', () => {
  const { vista } = jugar(nuevoPartido(), ...puntos('local', 25), { tipo: 'confirmar' }, { tipo: 'deshacer' });
  assert.equal(vista.pendiente?.tipo, 'set');
  assert.equal(vista.izquierda, 'local');
});

test('restablecer pone todo a cero y se puede deshacer', () => {
  const jugado = jugar(nuevoPartido(), ...puntos('local', 25), { tipo: 'confirmar' }, ...puntos('visitante', 4), { tipo: 'reset' });
  assert.deepEqual(jugado.vista.sets, { local: 0, visitante: 0 });
  assert.deepEqual(jugado.vista.puntos, { local: 0, visitante: 0 });
  const { vista } = jugar(jugado.partido, { tipo: 'deshacer' });
  assert.deepEqual(vista.sets, { local: 1, visitante: 0 });
  assert.equal(vista.puntos.visitante, 4);
});

test('cambio de lado manual', () => {
  const { vista } = jugar(nuevoPartido(), { tipo: 'cambio_lado' });
  assert.equal(vista.izquierda, 'visitante');
  assert.equal(vista.derecha, 'local');
});

test('validación de un partido nuevo', () => {
  const { config, equipos } = validarNuevoPartido({
    equipos: { local: { nombre: ' Galapagar A ', color: 'verde' } },
    config: { setsParaGanar: 2 },
  });
  assert.equal(equipos.local.nombre, 'Galapagar A');
  assert.equal(equipos.local.hex, '#2e7d32');
  assert.equal(config.setsParaGanar, 2);
  assert.equal(config.puntosUltimoSet, 15);
  assert.throws(() => validarNuevoPartido({ equipos: { local: { color: 'azul' } } }), /mismo color/);
  assert.throws(() => validarNuevoPartido({ config: { puntosPorSet: 0 } }), /Puntos por set/);
  assert.throws(() => validarNuevoPartido({ equipos: { local: { color: 'fucsia' } } }), /Color no válido/);
});

test('acciones no válidas', () => {
  assert.throws(() => resolverAccion(nuevoPartido(), { tipo: 'deshacer' }, AHORA), /nada que deshacer/);
  assert.throws(() => resolverAccion(nuevoPartido(), { tipo: 'punto', equipo: 'arbitro' }, AHORA), /Equipo no válido/);
  assert.throws(() => resolverAccion(nuevoPartido(), { tipo: 'punto', equipo: 'local', valor: 3 }, AHORA), /1 o 2/);
  assert.throws(() => resolverAccion(nuevoPartido(), { tipo: 'confirmar' }, AHORA), /pendiente/);
  assert.throws(() => resolverAccion(nuevoPartido(), { tipo: 'borrar_todo' }, AHORA), /desconocida/);
});

test('el reloj arranca, pausa y acumula el tiempo', () => {
  let reloj = accionDeReloj(RELOJ_INICIAL, 'iniciar_reloj', '2026-11-21T10:00:00.000Z', false);
  assert.equal(reloj.iniciadoEn, '2026-11-21T10:00:00.000Z');
  reloj = accionDeReloj(reloj, 'pausar_reloj', '2026-11-21T10:01:30.000Z', false);
  assert.deepEqual(reloj, { acumuladoMs: 90_000, iniciadoEn: null });
  reloj = accionDeReloj(reloj, 'iniciar_reloj', '2026-11-21T10:05:00.000Z', false);
  reloj = accionDeReloj(reloj, 'pausar_reloj', '2026-11-21T10:05:10.000Z', false);
  assert.equal(reloj.acumuladoMs, 100_000);
});

test('el reloj no admite acciones repetidas ni arrancar un partido terminado', () => {
  const enMarcha = accionDeReloj(RELOJ_INICIAL, 'iniciar_reloj', AHORA, false);
  assert.throws(() => accionDeReloj(enMarcha, 'iniciar_reloj', AHORA, false), /ya está en marcha/);
  assert.throws(() => accionDeReloj(RELOJ_INICIAL, 'pausar_reloj', AHORA, false), /ya está parado/);
  assert.throws(() => accionDeReloj(RELOJ_INICIAL, 'iniciar_reloj', AHORA, true), /ya ha terminado/);
});

test('al confirmar el final del partido el reloj se para solo', () => {
  const config = { setsParaGanar: 1, puntosPorSet: 2 };
  const enMarcha = { acumuladoMs: 0, iniciadoEn: '2026-11-21T09:59:00.000Z' };
  const pendiente = jugar(nuevoPartido(config), ...puntos('local', 2));
  assert.deepEqual(relojTrasCambio(enMarcha, pendiente.vista, AHORA), enMarcha);
  const { vista } = jugar(pendiente.partido, { tipo: 'confirmar' });
  assert.deepEqual(relojTrasCambio(enMarcha, vista, AHORA), { acumuladoMs: 60_000, iniciadoEn: null });
});

test('editar un equipo a mitad de partido conserva el marcador y actualiza el historial', () => {
  const { partido } = jugar(nuevoPartido(), ...puntos('local', 3), { tipo: 'deshacer' });
  const { equipos, vista } = editarEquipo(partido, { equipo: 'local', nombre: ' Galapagar A ', color: 'verde' });
  assert.deepEqual(equipos.local, { nombre: 'Galapagar A', color: 'verde', hex: '#2e7d32', texto: '#ffffff', tinta: '#4caf50' });
  assert.deepEqual(equipos.visitante, partido.equipos.visitante);
  assert.equal(vista.puntos.local, 2);
  assert.equal(vista.puedeRehacer, true);
  assert.equal(vista.historial[0].descripcion, 'Punto para Galapagar A');
});

test('editar solo el color (o solo el nombre) mantiene lo demás', () => {
  const partido = nuevoPartido();
  assert.equal(editarEquipo(partido, { equipo: 'visitante', color: 'verde' }).equipos.visitante.nombre, 'Visitante');
  assert.equal(editarEquipo(partido, { equipo: 'visitante', nombre: 'B' }).equipos.visitante.color, 'azul');
});

test('editar equipo valida color, nombre y lado', () => {
  const partido = nuevoPartido();
  assert.throws(() => editarEquipo(partido, { equipo: 'local', color: 'azul' }), /mismo color/);
  assert.throws(() => editarEquipo(partido, { equipo: 'local', nombre: 'x'.repeat(31) }), /30 caracteres/);
  assert.throws(() => editarEquipo(partido, { equipo: 'arbitro', nombre: 'X' }), /Equipo no válido/);
});

const historialSinHora = (vista: { historial: { descripcion: string; puntos: object }[] }) =>
  vista.historial.map((h) => `${h.descripcion} → ${JSON.stringify(h.puntos)}`);

test('quitar un punto corrige el histórico como si nunca se hubiera anotado', () => {
  const conError = jugar(nuevoPartido(), { tipo: 'punto', equipo: 'local' }, { tipo: 'punto', equipo: 'local' }, { tipo: 'punto', equipo: 'visitante' });
  const { partido, vista } = jugar(conError.partido, { tipo: 'quitar_punto', equipo: 'local' });
  const limpio = jugar(nuevoPartido(), { tipo: 'punto', equipo: 'local' }, { tipo: 'punto', equipo: 'visitante' });
  assert.deepEqual(vista.puntos, { local: 1, visitante: 1 });
  assert.deepEqual(historialSinHora(vista), historialSinHora(limpio.vista));
  assert.equal(vista.historial.some((h) => /quit|correc|-1|−1/i.test(h.descripcion)), false);
  assert.equal(partido.eventos.length, 2);
});

test('quitar un punto de un +2 lo deja en +1', () => {
  const { vista } = jugar(nuevoPartido(), { tipo: 'punto', equipo: 'visitante', valor: 2 }, { tipo: 'quitar_punto', equipo: 'visitante' });
  assert.equal(vista.puntos.visitante, 1);
  assert.equal(vista.historial[0].descripcion, 'Punto para Visitante');
});

test('quitar el punto que cerraba el set anula el aviso de fin de set', () => {
  const pendiente = jugar(nuevoPartido(), ...puntos('local', 25));
  assert.ok(pendiente.vista.pendiente);
  const { vista } = jugar(pendiente.partido, { tipo: 'quitar_punto', equipo: 'local' });
  assert.equal(vista.pendiente, null);
  assert.equal(vista.puntos.local, 24);
});

test('quitar punto solo afecta al set actual y descarta el rehacer', () => {
  const cerrado = jugar(nuevoPartido(), ...puntos('local', 25), { tipo: 'confirmar' });
  assert.throws(() => resolverAccion(cerrado.partido, { tipo: 'quitar_punto', equipo: 'local' }, AHORA), /no tiene puntos que quitar/);
  const conRehacer = jugar(cerrado.partido, ...puntos('local', 2), { tipo: 'deshacer' });
  assert.equal(conRehacer.vista.puedeRehacer, true);
  const { vista } = jugar(conRehacer.partido, { tipo: 'quitar_punto', equipo: 'local' });
  assert.deepEqual([vista.puntos.local, vista.sets.local, vista.puedeRehacer], [0, 1, false]);
});

test('la vista usa la paleta actual y respeta colores antiguos', () => {
  const partido = nuevoPartido();
  partido.equipos.local = { nombre: 'Viejo', color: 'indigo', hex: '#3f51b5' } as never;
  const { vista } = jugar(partido, { tipo: 'punto', equipo: 'local' });
  assert.equal(vista.equipos.local.hex, '#3f51b5');
  assert.equal(vista.equipos.local.texto, '#ffffff');
  assert.equal(vista.equipos.visitante.tinta, '#5c8dff');
  assert.equal(editarEquipo(partido, { equipo: 'local', nombre: 'Nuevo' }).equipos.local.color, 'indigo');
});
