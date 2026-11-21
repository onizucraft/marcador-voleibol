type Hijo = Node | string | null | undefined | false;

/** Crea un elemento. Los textos van siempre por textContent, nunca como HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  etiqueta: K,
  atributos: Record<string, string | boolean | undefined> = {},
  ...hijos: Hijo[]
): HTMLElementTagNameMap[K] {
  const nodo = document.createElement(etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor === false || valor === undefined) continue;
    nodo.setAttribute(nombre, valor === true ? '' : valor);
  }
  for (const hijo of hijos) {
    if (hijo) nodo.append(hijo);
  }
  return nodo;
}

export function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const nodo = document.querySelector<T>(selector);
  if (!nodo) throw new Error(`No existe ${selector}`);
  return nodo;
}

export function avisarError(mensaje: string) {
  avisar(mensaje, 'error');
}

/** Aviso breve en la parte inferior de la pantalla. */
export function avisar(mensaje: string, tipo: 'error' | 'info' = 'info') {
  const aviso = document.querySelector<HTMLElement>('#aviso-error') ?? document.body.appendChild(el('div', { id: 'aviso-error', role: 'alert' }));
  aviso.textContent = mensaje;
  aviso.classList.toggle('info', tipo === 'info');
  aviso.classList.add('visible');
  clearTimeout(Number(aviso.dataset.temporizador));
  aviso.dataset.temporizador = String(setTimeout(() => aviso.classList.remove('visible'), 4000));
}

/** Diálogo modal. Devuelve el `valor` de la opción pulsada, o null si se cierra sin elegir. */
export function preguntar(
  titulo: string,
  texto: string,
  opciones: { texto: string; valor: string; principal?: boolean; peligro?: boolean }[],
): { respuesta: Promise<string | null>; cerrar: () => void } {
  const dialogo = el('dialog', { class: 'dialogo' });
  const botones = opciones.map((o) =>
    el('button', { type: 'button', class: o.peligro ? 'boton peligro' : o.principal ? 'boton principal' : 'boton', value: o.valor }, o.texto),
  );
  dialogo.append(el('h2', {}, titulo), el('p', {}, texto), el('div', { class: 'botones' }, ...botones));
  document.body.append(dialogo);
  const respuesta = new Promise<string | null>((resolver) => {
    for (const boton of botones) boton.addEventListener('click', () => dialogo.close(boton.value));
    dialogo.addEventListener('close', () => {
      dialogo.remove();
      resolver(dialogo.returnValue || null);
    });
  });
  dialogo.showModal();
  // En acciones peligrosas el foco queda en la opción segura.
  (opciones.some((o) => o.peligro) ? botones.find((_, i) => !opciones[i].peligro) : botones.find((b) => b.classList.contains('principal')))?.focus();
  return { respuesta, cerrar: () => dialogo.open && dialogo.close() };
}
