import { $, avisarError } from './dom.ts';
import { supabase } from './supabase.ts';

// Solo se vuelve a páginas propias, para no convertir el login en una redirección abierta.
const volver = new URLSearchParams(location.search).get('volver') ?? '';
const destino = /^[a-z]+\.html(\?[\w=&%-]*)?$/.test(volver) ? volver : './';

const formulario = $<HTMLFormElement>('#formulario');
formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const datos = new FormData(formulario);
  const boton = formulario.querySelector('button')!;
  boton.disabled = true;
  const { error } = await supabase.auth.signInWithPassword({
    email: String(datos.get('email')),
    password: String(datos.get('contrasena')),
  });
  boton.disabled = false;
  if (error) {
    avisarError(error.code === 'invalid_credentials' ? 'Email o contraseña incorrectos' : error.message);
    return;
  }
  location.href = destino;
});
