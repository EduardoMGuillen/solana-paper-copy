# PolloTraderBot

Bot de liquidez para **Meteora DLMM** en Solana, con interfaz de terminal verde y app de escritorio para Windows y Linux.

Pone SOL en pools Bid-Ask, por debajo del precio, y cierra cada posición al llegar a la toma de ganancia, al stop o al tiempo máximo. Lee el valor de la posición en la cadena, comisiones incluidas, nunca de un modelo.

> **Mueve dinero real.** Con Start, el bot firma transacciones con tu wallet dedicada. Úsala solo para el bot y pon en ella solo lo que estés dispuesto a perder. Los límites duros (`LIVE_LP_MAX_SOL`, `LIVE_MIN_SOL_RESERVE`, el archivo `KILL`) viven en la configuración y la interfaz no los puede cambiar. El diseño completo está en [docs/EJECUCION-REAL.md](docs/EJECUCION-REAL.md).

## Estrategia

Cada 15 s, si hay SOL libre, el bot elige entre los pools token/SOL que pasan el filtro el que más comisiones cobra por su liquidez. Pone el 25% del SOL libre por debajo del precio, en forma Bid-Ask hasta −75%. Cierra al +8%, al −20% o a las 24 h, medido con el valor real de la posición en la cadena. Si el precio cae 20% de golpe entre dos lecturas, cierra de inmediato.

Backtest por hora del último mes (26 sep – 26 oct 2026, 105 pools SOL), en SOL, donde mantener el SOL = 0%:

| Perfil | Comisiones realistas | Comisiones pesimistas | Peor posición |
|---|---|---|---|
| **Recomendado** (por defecto) | +5% a +7% | −2% a 0% | −21% |
| Conservador (pools de 14+ días, TVL 50k+) | −2% a −4% | −4% a −5% | −10% |
| Agresivo | +23% a +24% | +6% a +7% | −8% (solo 36 posiciones) |
| La estrategia anterior (10%, reabrir al +10%) | −7% a −17% | −10% a −20% | −21% |

Es **un solo mes**. El historial solo trae los pools que siguen vivos y usa el TVL de hoy, así que los pools que se hundieron no cuentan. La realidad probablemente es peor. El panel `history` registra el resultado real de cada posición cerrada: esa es la medida que cuenta.

## App de escritorio

### Instalar

| Sistema | Archivo | Notas |
|---|---|---|
| Windows | `PolloTraderBot Setup x.y.z.exe` | Lo genera el workflow `desktop` de GitHub Actions (Actions → desktop → Run workflow). |
| Windows (portable) | `PolloTraderBot-x.y.z-win.zip` | Descomprime y abre `PolloTraderBot.exe`. Se puede generar desde Linux, pero sale con el ícono genérico de Electron. |
| Linux (Ubuntu/Debian) | `pollotraderbot_x.y.z_amd64.deb` | **Recomendado en Linux.** `sudo apt install ./pollotraderbot_*.deb`. Configura el sandbox de Chromium. |
| Linux (otras) | `PolloTraderBot-x.y.z.AppImage` | En Ubuntu 24.04 o más nuevo, AppArmor bloquea el sandbox de los AppImage: usa el `.deb` o ábrelo con `--no-sandbox`. |

### Primer uso

1. Abre PolloTraderBot. Como todavía no hay wallet, aparece el panel `wallet.import`.
2. Pega la **clave privada** de la wallet que usas para el bot (Phantom → Exportar clave privada, o el arreglo de `solana-keygen`). La dirección pública es opcional, pero sirve para comprobar que pegaste la correcta.
   - La clave va del formulario al proceso principal de la app, nunca por HTTP, y se guarda en `~/.solana-paper-bot/wallet.json` (en Windows, `C:\Users\<tú>\.solana-paper-bot`) con permisos de solo dueño.
   - El bot nunca reemplaza una wallet que ya existe, porque podría tener fondos o posiciones. Para cambiarla, mueve esa carpeta a mano.
3. Revisa los parámetros (`config` → `[mostrar]`) y pulsa **START**.

### Ventana, bandeja y configuración

- **Cerrar la ventana no detiene el bot.** La app queda en la bandeja del sistema, junto al reloj, y sigue vigilando las posiciones abiertas. Para apagarla del todo usa bandeja → **Salir (detiene el bot)**.
- **Configuración:** bandeja → *Abrir configuración* abre la carpeta de datos. Ahí está `config.env`, con Telegram, RPC propio y los límites `LIVE_*`; la plantilla es [.env.example](.env.example). Después de cambiarlo, sal y vuelve a abrir la app.
- **Reembolsos de Helius:** con un RPC de Helius la app agrega `rebate-address` a la URL, y por defecto los reembolsos de MEV van a la wallet del autor (`J723mhkAUyjKrR469XfHeMC2wGfcCU6EACMQtW6dQDBd`). Para cobrarlos tú, pon tu dirección en `HELIUS_REBATE_ADDRESS`; para desactivarlo, pon `off`.
- **Log del servidor:** `logs/server.log`, en esa misma carpeta.

### Generar los instaladores

```bash
npm run desktop -- --linux    # AppImage + .deb
npm run desktop -- --win      # instalador NSIS (en Windows, o en Linux con Wine)
npm run desktop -- --win zip -c.win.signAndEditExecutable=false   # Windows portable desde Linux sin Wine
npm run desktop:dev           # solo la carpeta sin empaquetar, para probar
```

Todo sale en `dist-desktop/release/`. El script [scripts/desktop.mjs](scripts/desktop.mjs):

1. compila Next en modo standalone;
2. agrega el SDK de Meteora, que se carga en tiempo de ejecución y Next no rastrea;
3. empaqueta `desktop/main.ts` y `desktop/preload.ts` con esbuild;
4. llama a electron-builder.

Los íconos salen del logo con `npm run icons`.

## Desarrollo

Requiere **Node 22** o más nuevo.

```bash
npm install
npm run dev            # panel en http://127.0.0.1:47231
npm test               # vitest
npx tsc --noEmit -p .  # tipos
npm run lint
npm run build

npm run wallet                       # crea una wallet dedicada nueva (solo imprime la dirección)
npm run wallet -- import [DIRECCION] # importa tu clave; se escribe oculta en la terminal
npm run meteora -- scan | collect | report   # investigación de pools Meteora
```

En el navegador, el panel `wallet.import` solo muestra el comando `npm run wallet -- import`. El formulario para pegar la clave existe únicamente en la app de escritorio.

### Servidor 24/7

Para correrlo en una VM con HTTPS y contraseña, sigue [deploy/GUIA-GOOGLE-CLOUD.md](deploy/GUIA-GOOGLE-CLOUD.md). La VM usa `next start`, no la app de escritorio.

## Historia

Antes de llamarse PolloTraderBot, este repo era un bot de análisis técnico en papel, con un libro de papel de Meteora y modo sombra con Jupiter. Esas partes se quitaron en el commit `67066c8`. Sus backtests, resultados y las ideas rechazadas siguen en el historial de git.
