-- Reloj de juego, independiente del historial de eventos (deshacer no lo toca).
-- La Edge Function lo arranca, lo pausa y lo para al terminar el partido.
alter table public.partidos
  add column reloj jsonb not null default '{"acumuladoMs": 0, "iniciadoEn": null}';
