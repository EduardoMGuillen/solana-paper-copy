# Cambios hechos con Claude

Registro de los commits hechos con Claude (los que llevan `Co-Authored-By: Claude`). El más nuevo va arriba. Los commits sin esa marca (`e4b25ad`, `8afd224`, `6fea6a1`, `9d9343d`, `8b86b54`, `0446c99`, `7a26afc`) no salen aquí.

Agrega una entrada cada vez que Claude haga un commit.

---

## 2026-10-21 · `bc3c370` · Meteora live: cerrar cuando el precio se aleja hacia arriba

**Qué cambió:**
- Si el token sube **10% o más** sobre el precio de entrada, la posición se cierra con el motivo `above`. La nota dice "El precio subió lejos del rango. Cerrando para reabrir".
- En la siguiente pasada el bot puede volver a abrir en el precio nuevo.

**Por qué:**
- Bid-Ask SOL-only pone todo el SOL *debajo* del precio de apertura. Si el token sube, el SOL queda quieto y no cobra fees.
- Antes de este cambio, esa posición se quedaba así hasta la salida por tiempo (24 h).

**Archivos:**
- `src/lib/exec/lp-plan.ts`: la constante `RECENTER_ABOVE = 0.1` y la regla en `markAt`.
- `src/lib/exec/live-book.ts`: el motivo `above`.

**Tests:**
- En `lp-plan.test.ts`, la posición:
  - cierra en la línea;
  - no cierra con la mitad de la subida;
  - no cierra si el precio volvió dentro del rango.
- En `live-book.test.ts`, el motivo sobrevive a la relectura de `bot.json`.

**Pendiente / ojo:**
- **El 10% no está validado con datos.** Hay que revisarlo con el collector de la VM (`npm run meteora -- report`).
- Cada reapertura cuesta dos transacciones. La renta se devuelve al cerrar, pero si hace falta un bin array nuevo la apertura se rechaza.
- Si el token sube en escalones, puede cerrar y reabrir varias veces.
- El libro paper no tiene esta regla.

---

## 2026-10-21 · `b9126ea` · Meteora live: salidas con el valor on-chain y recuperación de posiciones

- El take-profit, el stop y la salida por caída brusca leen la posición en la cadena, fees incluidas, en lugar del modelo Bid-Ask. Si no se puede leer la posición, solo corre la salida por tiempo.
- Las aperturas guardan la firma en el journal antes del broadcast. Si la confirmación falla, el bot le pregunta a la cadena antes de darse por vencido.
- Cada pasada adopta las posiciones firmadas que están en la cadena pero no en el libro.
- Las aperturas que necesitan bin arrays nuevos se rechazan por defecto (`LIVE_MAX_BIN_ARRAY_RENT_SOL`).
- Un pool cuya apertura falla queda fuera 6 h.
- Las transacciones llevan priority fee (`LIVE_PRIORITY_MICROLAMPORTS`).
- El token sobrante sin vender se reintenta cada 5 minutos.
- Archivos: `lp-chain.ts`, `lp-plan.ts`, `lp-runner.ts`, `wallet.ts`, `live-book.ts`, `sell-rule.ts`, `.env.example` y `AGENTS.md`, con sus tests.

## 2026-10-19 · `e04c02e` · Guía de uso y AGENTS.md

- `docs/GUIA-DE-USO.md` explica en español:
  - qué hace el bot y cómo decide;
  - cómo leer el panel y qué son los perfiles de riesgo;
  - el modo shadow y la investigación de Meteora;
  - dónde correrlo y el camino a dinero real.
- `AGENTS.md` reúne la arquitectura, el mapa de archivos, las variables de entorno, los comandos de verificación y las reglas que no se rompen.
- El README abre con un bloque en español que enlaza todas las guías.

## 2026-10-19 · `824a300` · Modo shadow (Jupiter sin firmar)

- Con `LIVE_MODE=shadow` y `JUPITER_API_KEY`, cada fill paper se cotiza en Jupiter Swap API v2. Además, cada mercado recibe una sonda horaria de compra y venta.
- Las cotizaciones se piden sin `taker`, así que no hay nada que firmar; un test lo comprueba.
- El costo real por lado se compara con el precio de Binance. Si la cotización se aleja más de 20%, se marca como sospechosa (probable mint equivocado).
- El panel muestra la mediana y el p90 por mercado. Telegram avisa si un trade real costaría más del doble de lo que asume el backtest.
- Agrega `.env.example` y `docs/CORRER-EN-CASA.md`.

## 2026-10-19 · `9249137` · Alertas de Telegram y diseño de ejecución real

- Las alertas se agrupan en lotes HTML: compras, ventas, avisos, cambios de estrategia, caídas y vueltas del feed de datos, y un resumen diario UTC.
- Nunca ponen el token del bot en los errores. El panel tiene un botón para enviar una alerta de prueba.
- `docs/EJECUCION-REAL.md` es el diseño para operar con dinero real:
  - interfaz de ejecutor (paper, shadow, live);
  - límites duros fuera del panel;
  - journal de intents y reconciliación con la cadena;
  - despliegue por etapas.

## 2026-10-19 · `2d7bd2f` · Collector de pools Meteora DLMM y test paper Bid-Ask

- `src/lib/lp` modela una posición Bid-Ask SOL-only: rango -75%, bins de 1%.
- `scripts/meteora.ts` tiene tres comandos: `scan`, `collect` y `report`.
- En la VM, el collector corre cada 15 min como timer de systemd separado y con memoria limitada.

## 2026-10-19 · `257e121` · Contraseña y deploy en Google Cloud

- `src/proxy.ts` pone el panel y las APIs detrás de HTTP Basic auth. Sin `BOT_PASSWORD`, la app solo responde en localhost.
- `deploy/install.sh` instala la VM con un solo comando: swap, Node 22, servicio systemd endurecido y Caddy con HTTPS.
- El panel consulta cada 30 s y se detiene si la pestaña está oculta, para caber en el egress gratuito.

## 2026-10-19 · `a09f63c` · Perfil agresivo, cuenta paper de 1 SOL e ideas rechazadas

- La cuenta paper empieza con 1 SOL y se mide en SOL y contra solo mantener ese SOL.
- Agrega los perfiles Conservador y Agresivo.
- Prueba VWAP + EMA en 3m/15m y la rotación de momentum. Ambas se rechazaron con datos reales y quedaron registradas en el README.

## 2026-10-19 · `bd47466` · Bot de análisis técnico validado

- Reemplaza el copy desk, cuyas ganancias salían de datos de demo, por estrategias propias con velas reales.
- Cada estrategia se valida walk-forward por mercado.
- El live usa el mismo paso de barra que el backtest, y un test de paridad lo comprueba.
- Sizing por riesgo, stops ATR, y halts por pérdida diaria y por drawdown.
