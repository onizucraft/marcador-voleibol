import { el } from './dom.ts';
import { haySesion, supabase } from './supabase.ts';

/** Pinta "Entrar" o "Salir" en la cabecera y devuelve si hay administrador conectado. */
export async function pintarSesion(contenedor: HTMLElement): Promise<boolean> {
  const admin = await haySesion();
  document.body.classList.toggle('es-admin', admin);
  if (admin) {
    const salir = el('button', { type: 'button', class: 'enlace' }, 'Salir');
    salir.addEventListener('click', async () => {
      await supabase.auth.signOut();
      location.reload();
    });
    contenedor.replaceChildren(salir);
  } else {
    const volver = encodeURIComponent(location.pathname.split('/').pop() + location.search);
    contenedor.replaceChildren(el('a', { href: `login.html?volver=${volver}`, class: 'enlace' }, 'Entrar'));
  }
  return admin;
}
