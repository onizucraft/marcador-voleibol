-- Fecha y hora previstas (las pone el admin) y comienzo real (lo registra la Edge Function
-- con el primer punto o el primer arranque del reloj). Son datos distintos a propósito.
alter table public.partidos
  add column programado_en timestamptz,
  add column comenzado_en  timestamptz;

update public.partidos p
   set programado_en = p.creado_en,
       comenzado_en  = (select min(e.creado_en) from public.eventos e where e.partido_id = p.id);

alter table public.partidos alter column programado_en set not null;

-- Nuevo estado para los partidos que aún no han empezado.
alter table public.partidos drop constraint partidos_estado_check;
update public.partidos set estado = 'programado' where estado = 'en_juego' and comenzado_en is null;
alter table public.partidos
  add constraint partidos_estado_check check (estado in ('programado', 'en_juego', 'finalizado'));
alter table public.partidos alter column estado set default 'programado';

create index partidos_programado_en_idx on public.partidos (programado_en);
