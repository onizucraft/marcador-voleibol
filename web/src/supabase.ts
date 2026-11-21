import { createClient, FunctionsHttpError } from '@supabase/supabase-js';

// En desarrollo se pasa por el proxy de Vite (ver vite.config.ts) para que funcione
// desde cualquier dispositivo de la red; en producción, directo a Supabase.
const url = import.meta.env.DEV ? `${location.origin}/supabase` : import.meta.env.VITE_SUPABASE_URL;

export const supabase = createClient(url, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

export class ErrorSesion extends Error {}

/** Llama a la Edge Function `partidos` y devuelve el JSON, o lanza con el mensaje del servidor. */
export async function llamar<T>(ruta: string, opciones: { metodo?: 'GET' | 'POST'; cuerpo?: unknown } = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`partidos${ruta}`, {
    method: opciones.metodo ?? 'POST',
    body: opciones.cuerpo as Record<string, unknown> | undefined,
  });
  if (!error) return data as T;
  if (error instanceof FunctionsHttpError) {
    const respuesta = error.context as Response;
    const mensaje = await respuesta.json().then((j) => j.error ?? j.message).catch(() => null);
    if (respuesta.status === 401) throw new ErrorSesion(mensaje ?? 'Sesión caducada');
    throw new Error(mensaje ?? `Error ${respuesta.status}`);
  }
  throw new Error('No se ha podido conectar con el servidor');
}

/** Solo decide qué botones se muestran; quien autoriza es la Edge Function. */
export async function haySesion(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return data.session !== null;
}
