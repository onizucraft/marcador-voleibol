# Marcador Ancora

Marcador web público para los partidos de voleibol del Ancora Galapagar. Cualquiera puede seguir los partidos en
directo; solo el administrador puede crearlos y llevar el marcador.

- Sumar un punto con un toque en el panel del equipo, o **+2** (tres toques tras recibir).
- Deshacer / rehacer, restablecer el marcador y cambiar de lado.
- Fin de set y de partido con confirmación; cambio de lado automático al confirmar un set.
- Reglas configurables: jugadores, sets para ganar, puntos por set y del set de desempate,
  diferencia de dos puntos.
- Nombre y color (de una paleta) para cada equipo.
- Historial jugada a jugada y listado de partidos en juego y anteriores.

## Arquitectura

| Pieza | Qué hace |
| --- | --- |
| `supabase/functions/partidos` | Edge Function con **toda la lógica**. Una carpeta por caso de uso (`crear`, `acciones`, `opciones`) y el dominio puro en `dominio/marcador.ts`. |
| `supabase/migrations` | Esquema: tablas, claves, checks y RLS. Sin lógica en la base de datos. |
| `web/` | Front con Vite + TypeScript sin framework. Solo pinta la vista que calcula el servidor. |

Un partido es una lista de **eventos** (`punto`, `confirmar`, `cambio_lado`, `reset`) más un
**cursor**. Deshacer y rehacer mueven el cursor y el historial sale de los eventos. Después de
cada acción, la Edge Function recalcula la vista y la guarda en `partidos.vista`. El público
lee esa columna y recibe los cambios por Realtime.

Cada escritura es una sola sentencia SQL con control optimista (`partidos.version`). Si dos
administradores pulsan a la vez, la función reintenta sobre el estado nuevo.

Seguridad: el público solo puede leer `partidos` (RLS). Nadie escribe desde el cliente,
tampoco el admin: solo la Edge Function. El registro de usuarios está desactivado, así que
cualquier usuario de Supabase Auth es administrador.

## Desarrollo local

Requisitos: Node ≥ 24, Docker y la [CLI de Supabase](https://supabase.com/docs/guides/cli).

```bash
npm install
supabase start                 # Postgres, Auth, Realtime… en Docker; aplica las migraciones
supabase functions serve       # en otra terminal
cp .env.example .env.local     # y rellena con la URL y la publishable key de `supabase status`
npm run dev                    # http://127.0.0.1:5173
```

Crear el administrador local: desde Studio (http://127.0.0.1:54323 → Authentication → Add user)
o con la API de admin usando la *secret key* de `supabase status`.

```bash
npm test                       # tests del dominio (node --test)
ADMIN_EMAIL=… ADMIN_CONTRASENA=… node --env-file=.env.local scripts/prueba-humo.ts
                               # prueba de humo contra la API real (crea un partido "Prueba humo")
```

## Despliegue

**Supabase** (proyecto `xagqwfzokhmetoblbxlb`):

```bash
supabase db push --remote             # migraciones
supabase functions deploy partidos     # Edge Function
```

No uses `supabase config push`: subiría también los valores por defecto de desarrollo de
`config.toml` (MFA, pooler…). En producción solo se han cambiado, vía Management API,
`disable_signup = true` y `site_url`.

El usuario administrador se crea en el panel: Authentication → Users → Add user.

Tras un cambio en el formato de la vista o en la paleta, los partidos ya guardados se
actualizan recalculando su vista (no toca eventos, puntos ni reloj). Necesita la clave
secreta del proyecto (`sb_secret_…`, Project Settings → API Keys):

```bash
curl -X POST -H "apikey: <clave secreta>" https://xagqwfzokhmetoblbxlb.supabase.co/functions/v1/partidos/recalcular
```

**Front** (GitHub Pages, https://onizucraft.github.io/marcador-voleibol/): lo publica
`.github/workflows/web.yml` al hacer push a la rama por defecto, con la URL y la publishable
key de `.env.production` (públicas por diseño). Pages tiene que estar en *Source: GitHub Actions*.

Para probar desde el móvil en la red local: `npm run dev:red` y abrir `http://<IP-del-PC>:5173`
(en WSL hace falta además reenviar el puerto desde Windows).

## Créditos

Fuente de 7 segmentos [DSEG](https://github.com/keshikan/DSEG) (SIL Open Font License 1.1).
Iconos de [Material Icons](https://fonts.google.com/icons) (Apache 2.0).
