import { el } from './dom.ts';
import { llamar } from './supabase.ts';
import type { Color, Config, Lado } from '../../supabase/functions/partidos/dominio/marcador.ts';

export interface Opciones {
  colores: Color[];
  configPorDefecto: Config;
  equiposPorDefecto: Record<Lado, { nombre: string; color: string }>;
  limites: Record<string, { min: number; max: number }>;
}

let opciones: Promise<Opciones> | null = null;

/** Catálogo de colores y reglas por defecto; lo sirve la Edge Function y se pide una vez. */
export function cargarOpciones(): Promise<Opciones> {
  opciones ??= llamar<Opciones>('/opciones', { metodo: 'GET' });
  return opciones;
}

/** Radios de colores con el nombre de campo `nombre`; marca `elegido`. */
export function crearPaleta(nombre: string, colores: Color[], elegido: string, etiqueta: string): HTMLElement {
  const paleta = el('div', { class: 'paleta', role: 'radiogroup', 'aria-label': etiqueta });
  paleta.append(...colores.map((color) => {
    const opcion = el('label', { class: 'color', title: color.nombre },
      el('input', { type: 'radio', name: nombre, value: color.id, checked: color.id === elegido, 'aria-label': color.nombre }),
    );
    opcion.style.setProperty('--color', color.hex);
    return opcion;
  }));
  return paleta;
}
