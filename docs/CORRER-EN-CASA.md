# Correr el bot en casa (modo sombra + Meteora)

Esta guía es para Windows; en Mac o Linux los comandos son los mismos. Necesitas Node.js 22 o más reciente (https://nodejs.org) y Git.

> La red del trabajo bloquea Jupiter y Meteora; por eso hay que correrlo en casa o en la VM.

## 1. Bajar la última versión

```powershell
git clone https://github.com/EduardoMGuillen/solana-paper-copy.git
cd solana-paper-copy
npm install
```

Si ya lo tenías clonado: `git pull` y luego `npm install`.

## 2. Obtener la API key de Jupiter (gratis)

1. Entra a https://developers.jup.ag e inicia sesión.
2. Crea una API key en el panel. El plan gratuito alcanza: el modo sombra hace unas 10 consultas por hora.

## 3. Configurar

```powershell
copy .env.example .env.local
notepad .env.local
```

Llena como mínimo:

```
LIVE_MODE=shadow
JUPITER_API_KEY=tu-key
```

Si quieres alertas, agrega también `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`; cómo obtenerlos está en `deploy/GUIA-GOOGLE-CLOUD.md`, sección "Alertas por Telegram".

## 4. Arrancar

```powershell
npm run dev
```

Abre http://127.0.0.1:47231. En tu PC no pide contraseña.

## 5. Qué revisar

**Tarjeta "Modo sombra"** (aparece en ~15 segundos):
- **Activo**, con cotizaciones que crecen cada hora.
- **Sin errores.** Si sale *"difiere más de 20% de Binance"*, el mint de ese mercado está mal; avísame cuál es.
- **Las medianas por mercado** son el costo real de ejecutar en Jupiter. Si quedan por debajo de los 20 bps por lado que supone el backtest, los resultados del backtest son creíbles. Si quedan por encima, el bot te dice cuánto subir la comisión.

**Pools de Meteora** (en otra terminal, también en la carpeta del proyecto):

```powershell
npm run meteora -- scan
```

Muestra los pools DLMM con SOL que pasan los filtros tipo Decoder Farmer, ordenados por comisiones/TVL.

Para el reporte de posiciones simuladas hace falta historia: corre `npm run meteora -- collect` cada 15 minutos (en la VM lo hace solo) y luego `npm run meteora -- report`.

## Seguridad

- **Nada se firma.** En modo sombra el bot pide cotizaciones sin indicar wallet, así que Jupiter no devuelve ninguna transacción. No hay llaves privadas en el proyecto.
- **`.env.local` nunca se sube a GitHub** (está en `.gitignore`). No compartas tu API key ni tu token de Telegram.
- **Si algo falla, pégame el error de la tarjeta o de la terminal** y lo ajusto.
