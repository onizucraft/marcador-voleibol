-- Corregir el histórico (restar un punto) reescribe los eventos desde una posición,
-- renumerando los siguientes. Para hacerlo en una sola sentencia atómica, la unicidad
-- de (partido_id, seq) se comprueba al final de la sentencia y no fila a fila.
alter table public.eventos drop constraint eventos_pkey;
alter table public.eventos
  add constraint eventos_pkey primary key (partido_id, seq) deferrable initially immediate;
