import { llamar } from './supabase.ts';

// Desfase entre el reloj del dispositivo y el del servidor, al estilo NTP:
// se toman varias muestras y se usa la de menor ida y vuelta (la más fiable).

const MUESTRAS = 4;
const RESINCRONIZAR_MS = 5 * 60_000;

let desfaseMs = 0;

export const ahoraServidor = () => Date.now() + desfaseMs;

export async function sincronizarHora(): Promise<void> {
  let mejor: { idaYVuelta: number; desfase: number } | null = null;
  for (let i = 0; i < MUESTRAS; i++) {
    const envio = Date.now();
    const { ahora } = await llamar<{ ahora: number }>('/hora', { metodo: 'GET' });
    const recepcion = Date.now();
    const idaYVuelta = recepcion - envio;
    const desfase = ahora + idaYVuelta / 2 - recepcion;
    if (!mejor || idaYVuelta < mejor.idaYVuelta) mejor = { idaYVuelta, desfase };
  }
  desfaseMs = mejor!.desfase;
}

/** Sincroniza ahora, cada pocos minutos y al volver a la pestaña. Los fallos no rompen el reloj. */
export function mantenerHoraSincronizada(alSincronizar: () => void) {
  const sincronizar = () => sincronizarHora().then(alSincronizar).catch(() => {});
  sincronizar();
  setInterval(sincronizar, RESINCRONIZAR_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sincronizar();
  });
}
