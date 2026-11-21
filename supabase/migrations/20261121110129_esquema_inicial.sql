-- Esquema del marcador. La base de datos solo guarda datos y restricciones:
-- las reglas del partido viven en la Edge Function `partidos`.

create table public.partidos (
  id             bigint generated always as identity primary key,
  creado_en      timestamptz not null default now(),
  config         jsonb       not null,
  equipos        jsonb       not null,
  -- Eventos aplicados (los que tienen seq > cursor están deshechos y se pueden rehacer).
  cursor         integer     not null default 0 check (cursor >= 0),
  total          integer     not null default 0 check (total >= cursor),
  -- Control de concurrencia optimista: cada escritura comprueba y sube la versión.
  version        integer     not null default 0,
  -- Vista calculada por la Edge Function tras cada acción; es lo que lee el público.
  vista          jsonb       not null,
  -- Resumen desnormalizado para listar partidos sin cargar la vista.
  estado         text        not null default 'en_juego' check (estado in ('en_juego', 'finalizado')),
  sets_local     smallint    not null default 0,
  sets_visitante smallint    not null default 0,
  ganador        text        check (ganador in ('local', 'visitante'))
);

create index partidos_creado_en_idx on public.partidos (creado_en desc);

create table public.eventos (
  partido_id bigint      not null references public.partidos (id) on delete cascade,
  seq        integer     not null check (seq > 0),
  tipo       text        not null check (tipo in ('punto', 'confirmar', 'cambio_lado', 'reset')),
  equipo     text        check (equipo in ('local', 'visitante')),
  valor      smallint    check (valor in (1, 2)),
  creado_en  timestamptz not null,
  primary key (partido_id, seq),
  check ((tipo = 'punto') = (equipo is not null and valor is not null))
);

-- Acceso: el público (anon y authenticated) solo lee partidos. Nadie escribe desde
-- el cliente; la Edge Function escribe con conexión directa de servidor.
alter table public.partidos enable row level security;
alter table public.eventos enable row level security;

revoke all on public.partidos, public.eventos from anon, authenticated;
grant select on public.partidos to anon, authenticated;

create policy "Los partidos son públicos"
  on public.partidos for select
  to anon, authenticated
  using (true);

-- Marcador en vivo para el público.
alter publication supabase_realtime add table public.partidos;
