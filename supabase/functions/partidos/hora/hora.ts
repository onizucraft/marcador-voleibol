/**
 * GET /partidos/hora — hora del servidor en ms. Público.
 * Los navegadores la usan para corregir el desfase de su reloj local y que el
 * tiempo de juego se vea igual en todos los dispositivos.
 */
export function verHora(): Response {
  return Response.json({ ahora: Date.now() }, { headers: { 'cache-control': 'no-store' } });
}
