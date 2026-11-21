import { ErrorDominio } from './dominio/marcador.ts';

export class ErrorHttp extends Error {
  estado: number;
  constructor(estado: number, mensaje: string) {
    super(mensaje);
    this.estado = estado;
  }
}

export async function leerJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ErrorHttp(400, 'El cuerpo de la petición no es JSON válido');
  }
}

/** Traduce errores de dominio y HTTP a respuestas `{ error }`; el resto es un 500 genérico. */
export function respuestaDeError(error: unknown): Response {
  if (error instanceof ErrorDominio) {
    return Response.json({ error: error.message }, { status: error.tipo === 'conflicto' ? 409 : 400 });
  }
  if (error instanceof ErrorHttp) {
    return Response.json({ error: error.message }, { status: error.estado });
  }
  console.error(error);
  return Response.json({ error: 'Error interno del servidor' }, { status: 500 });
}
