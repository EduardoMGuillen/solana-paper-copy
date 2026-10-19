# Diseño: ejecución real

Estado: **diseño, no implementado.** Hoy el bot solo opera en papel. Este documento define cómo pasar a dinero real sin cambiar la lógica que ya está validada.

Los puntos marcados **[verificar]** no se pudieron confirmar porque la red de desarrollo bloquea los dominios de Jupiter y Meteora. Hay que confirmarlos en la VM o en una red personal antes de escribir el código.

---

## 1. Principios

1. **Misma lógica en papel y en real.** El motor decide igual que en el backtest; solo cambia quién ejecuta la orden. Si la ejecución real diverge del papel, se mide y se alerta.
2. **Fallar cerrado.** Ante cualquier duda (RPC caído, saldo que no cuadra, precio movido, error desconocido) el bot **no abre** posiciones nuevas y avisa por Telegram. Cerrar posiciones sí se reintenta, porque protege el capital.
3. **No custodia.** Las llaves viven solo en la máquina del dueño. Ningún servidor de terceros (ni del vendedor, si se comercializa) firma por el usuario.
4. **Límites duros fuera del dashboard.** Lo que limita el daño máximo se configura en el servidor, no en la web. Ni un atacante con la contraseña del dashboard ni un error de UI pueden subir el riesgo.
5. **Escalar por etapas:** papel → sombra → micro → real (sección 9).

---

## 2. Arquitectura

```
                 ┌──────────────── ya existe ────────────────┐
 velas Binance → │ motor (strategies + sleeve) decide en el   │
                 │ cierre de vela: comprar / vender / stop     │
                 └───────────────┬────────────────────────────┘
                                 │ Intent { id, mercado, lado, monto, precioDecisión, stop }
                                 ▼
                 ┌──────────── Executor (interfaz) ───────────┐
                 │ PaperExecutor   → llena como hoy            │
                 │ ShadowExecutor  → cotiza en Jupiter, no firma│
                 │ JupiterExecutor → cotiza, firma, envía       │
                 │ MeteoraExecutor → posiciones DLMM            │
                 └───────────────┬────────────────────────────┘
                                 │ Fill { intentId, precioReal, cantidad, comisiones, firma }
                                 ▼
                 sleeve aplica el fill REAL · diario de órdenes (JSONL)
                 · Telegram con enlace a Solscan · conciliación con saldos on-chain
```

### Cambio necesario en el motor

Hoy `sleeve.ts` decide y llena en el mismo paso (`fillAtOpen`). Hay que separarlo en dos:

- **`decide()`** produce un `Intent` en lugar de modificar el saldo.
- **`applyFill(intent, fill)`** actualiza `cash`, `position` y `trades` con el resultado real.

El `PaperExecutor` produce exactamente los fills de hoy. Así los tests de paridad con el backtest se mantienen y demuestran que la refactorización no cambió nada.

```ts
type Intent = {
  id: string;                 // único; sirve para idempotencia
  market: string;
  side: "buy" | "sell";
  /** buy: USD a gastar. sell: fracción de la posición (1 = todo). */
  amount: number;
  decisionPrice: number;      // precio con el que decidió el motor
  stop?: number;
  reason: "senal" | "stop" | "cierre";
  createdAt: number;
};

type Fill =
  | { ok: true; intentId: string; price: number; qty: number; feesUsd: number; signature?: string; at: number }
  | { ok: false; intentId: string; error: string; retryable: boolean };

interface Executor {
  mode: "paper" | "shadow" | "live";
  execute(intent: Intent): Promise<Fill>;
  /** Saldos reales para conciliar (live). */
  balances(): Promise<Record<string, number>>;
}
```

---

## 3. Moneda base y mercados

- **La base es USDC**, igual que en los backtests (todos los pares son contra USD). Al activar el modo real, el bot convierte el SOL depositado a USDC menos la reserva de comisiones (sección 6).
- **La métrica principal sigue siendo "bot vs. mantener el SOL inicial"**, ya implementada en el dashboard.
- **Mercados en real:**
  - SOL, JUP y WIF se operan directo en Jupiter.
  - BTC y ETH se operan como tokens envueltos en Solana (por ejemplo cbBTC/WBTC y wETH). **[verificar]** los mints y que la liquidez soporte el tamaño.
  - BONK y otros de baja liquidez solo con un límite de impacto de precio estricto.
- **Las señales siguen viniendo de las velas de Binance** (más historia y más estables). Antes de ejecutar se valida que el precio de Jupiter no se aleje más de `LIVE_MAX_DEVIATION_BPS` del de Binance. Si se aleja, no se opera y se alerta.

---

## 4. Swaps con Jupiter (trading)

La API v1 (`/quote` + `/swap`) está obsoleta. La actual es la **Swap API v2** en `https://api.jup.ag/swap/v2`, con el flujo `/order` → firmar → `/execute`, y requiere **API key** (`x-api-key`) del portal de desarrolladores. **[verificar]** los nombres exactos de los campos, los límites del plan gratis y si `/execute` confirma la transacción o solo la envía.

### Flujo de una orden

1. **Pre-chequeos** (cualquiera que falle cancela una entrada):
   - modo real activado y archivo de corte de emergencia ausente (sección 7);
   - mint en la lista permitida;
   - monto ≤ `LIVE_MAX_TRADE_USD`;
   - operaciones de hoy < `LIVE_MAX_TRADES_PER_DAY`;
   - pérdida de hoy < `LIVE_MAX_DAILY_LOSS_USD`;
   - saldo de SOL ≥ reserva.
2. **`/order`** con mint de entrada, mint de salida, monto y la wallet como `taker`.
3. **Validar la cotización:**
   - el precio implícito está a menos de `LIVE_MAX_DEVIATION_BPS` del `decisionPrice` (nunca perseguir el precio en una entrada);
   - el impacto de precio es ≤ `LIVE_MAX_PRICE_IMPACT_BPS`;
   - el slippage es ≤ `LIVE_MAX_SLIPPAGE_BPS`.
4. **Escribir en el diario** (`intents.jsonl`) el intento con el `requestId` **antes** de firmar.
5. **Firmar localmente** con la wallet dedicada y simular la transacción (`simulateTransaction`).
6. **`/execute`**, o enviar con un RPC propio, y esperar la confirmación.
7. **Calcular el fill real** a partir de la diferencia de saldos en la transacción confirmada, no de la cotización.
8. **Guardar la firma en el diario**, aplicar el fill y enviar a Telegram el resultado con el enlace a Solscan y el slippage real contra el papel.

### Reintentos

| Situación | Entrada (comprar) | Salida (vender / stop) |
|---|---|---|
| Cotización vencida | Recotizar 1 vez | Recotizar hasta 5 veces |
| El precio se movió más que el límite | **Cancelar** (no perseguir) | Seguir, con slippage creciente hasta el tope |
| Transacción caída o blockhash vencido | Verificar la firma; si no llegó, cancelar | Verificar la firma; si no llegó, reintentar |
| Error desconocido | Cancelar y alertar | Reintentar con backoff y alertar |

### Idempotencia tras un reinicio

Al arrancar, el bot revisa en el diario los intents sin cierre:
- si la firma está confirmada, aplica el fill;
- si la firma falló o vació, marca el intent como fallido;
- si el estado no se puede saber, pausa entradas y alerta.

Así nunca compra dos veces la misma señal.

### Stops

Los swaps spot no tienen stop on-chain, así que el stop lo ejecuta el bot cada 15 s con el precio en vivo. Si el servidor se cae, no hay stop. Mitigaciones:
- **Heartbeat:** el bot hace ping a un servicio externo gratuito (por ejemplo healthchecks.io) en cada ciclo. Si deja de hacerlo por 5 minutos, ese servicio te avisa por Telegram o correo.
- **Exposición limitada:** el riesgo por operación y el tope de exposición limitan el peor caso.
- **[verificar]** si la API de Trigger (órdenes límite) de Jupiter permite órdenes de venta por debajo del precio, que funcionen como stop on-chain.

---

## 5. Posiciones en Meteora DLMM (liquidez)

Se usa el SDK `@meteora-ag/dlmm`, con los métodos confirmados en su README:

```ts
const pool = await DLMM.create(connection, poolAddress);
const { binId } = await pool.getActiveBin();

// Bid-Ask solo con SOL, por debajo del precio actual.
// Si el pool es TOKEN/SOL, el SOL es el token Y.
const position = Keypair.generate();          // la cuenta de posición también firma
const tx = await pool.initializePositionAndAddLiquidityByStrategy({
  positionPubKey: position.publicKey,
  user: wallet.publicKey,
  totalXAmount: new BN(0),
  totalYAmount: lamportsDeSol,
  strategy: { minBinId: binId - N, maxBinId: binId - 1, strategyType: StrategyType.BidAsk },
});
// firmar con [wallet, position] y enviar

// Cerrar: retirar 100%, cobrar comisiones y cerrar la posición en una sola llamada
const txs = await pool.removeLiquidity({
  position: position.publicKey, user: wallet.publicKey,
  fromBinId, toBinId,
  liquiditiesBpsToRemove: bins.map(() => new BN(10_000)),
  shouldClaimAndClose: true,
});
// luego vender a SOL, vía Jupiter, el token que haya quedado
```

### Restricciones que importan con 1 SOL

- **Renta de la posición:** según Decoder Farmer, cada set de 69 bins inmoviliza ~0.056 SOL, que se devuelven al cerrar. Un rango de −75% con bins de 1% necesita 2 posiciones, es decir 0.11 SOL: el 11% de tu capital solo en renta. **Solución:** usar pools con bin step ≥ 200 (2%). Así −75% cabe en ~69 bins y basta una sola posición. **[verificar]** el máximo de bins por posición y la renta actual.
- **Bug conocido del SDK:** hay un fallo corregido en la versión 1.9.4 por el que cerrar una posición con comisiones sin cobrar podía fallar. Hay que fijar la versión ≥ 1.9.4.

### Filtros de seguridad del token (antes de abrir)

- **Autoridades revocadas:** sin autoridad de mint y sin autoridad de congelamiento. Si alguien puede congelar el token, no podrías vender.
- **Antigüedad mínima del pool** y TVL mínimo (los filtros del recolector).
- **Venta posible:** Jupiter debe tener ruta para vender el token con impacto aceptable. Si no hay salida, no hay entrada.
- **Concentración de holders** (opcional): ningún holder no-pool con más de X%.

### Salidas

Las salidas son las mismas del simulador en papel (`src/lib/lp/meteora.ts`), así que lo medido en papel aplica:
- take-profit;
- stop;
- tiempo máximo;
- precio fuera del rango;
- anti-rug: una caída de más de 20% en 1 minuto cierra de inmediato.

---

## 6. Llaves y wallet

- **Wallet nueva y dedicada,** generada en la VM con `solana-keygen new`. Nunca reutilices tu wallet principal.
- **Archivo de la llave:** `/etc/solana-bot/wallet.json`, dueño `solbot`, permisos `600`. **Nunca** en el repo, en variables del dashboard ni en los logs. El dashboard no tiene ningún endpoint que exponga o use la llave directamente.
- **Fondea solo lo que aceptes perder,** y retira las ganancias a tu wallet fría manualmente.
- **Reserva de SOL** (`LIVE_MIN_SOL_RESERVE`, por ejemplo 0.03 SOL) para comisiones y rentas. El bot nunca la opera.
- **RPC propio:** el RPC público de Solana no es confiable para enviar transacciones. Usa un plan gratuito de Helius o QuickNode y guarda la URL en `/etc/solana-bot.env`.
- **Endurecimiento posterior** (para venderlo): un proceso firmante separado que solo firme transacciones dentro de los límites. Así, aunque comprometan el proceso web, no podrían vaciar la wallet.

---

## 7. Límites duros (`/etc/solana-bot.env`, no editables desde la web)

```bash
LIVE_MODE=paper                 # paper | shadow | live
LIVE_MAX_TRADE_USD=30           # tamaño máximo por orden
LIVE_MAX_POSITION_USD=60        # exposición máxima por mercado
LIVE_MAX_DAILY_LOSS_USD=15      # alcanzado: sin entradas hasta mañana
LIVE_MAX_TRADES_PER_DAY=10
LIVE_MAX_SLIPPAGE_BPS=100
LIVE_MAX_PRICE_IMPACT_BPS=150
LIVE_MAX_DEVIATION_BPS=150      # Jupiter vs. Binance / vs. precio de decisión
LIVE_MIN_SOL_RESERVE=0.03
LIVE_ALLOWED_MINTS=...          # lista explícita
LIVE_LP_MAX_SOL=0.3             # máximo en posiciones de Meteora
JUPITER_API_KEY=...
SOLANA_RPC_URL=...
```

- **Corte de emergencia:** si existe el archivo `/var/lib/solana-bot/KILL`, no se abre nada y se intenta cerrar todo. Se activa con `sudo touch /var/lib/solana-bot/KILL`, incluso si el dashboard no responde.
- **Desde el dashboard solo se puede reducir el riesgo:** pausar, cerrar una posición o cerrar todo. Nada que lo aumente.

---

## 8. Conciliación y monitoreo

- **Al arrancar y cada hora:** los saldos on-chain de la wallet deben cuadrar con el estado del bot dentro de una tolerancia. Si no cuadran, se pausan las entradas y se alerta con el detalle. Nunca "corrige" solo comprando o vendiendo.
- **Telegram:** cada fill real (con enlace a Solscan y slippage real vs. papel), cada orden cancelada y por qué, cada descuadre, y el heartbeat.
- **Diario de órdenes** append-only en `/var/lib/solana-bot/intents.jsonl`. Sirve de evidencia del historial para un comprador.

---

## 9. Etapas de lanzamiento

| Etapa | Qué hace | Requisito para avanzar |
|---|---|---|
| **Papel** (hoy) | Decide y llena simulado | 4–8 semanas; resultados coherentes con el backtest |
| **Sombra** | En cada decisión pide cotización real a Jupiter **sin firmar** y registra cuánto habría costado de verdad | 2 semanas; slippage real ≤ el supuesto (0.1% por lado) |
| **Micro** | Real con `LIVE_MAX_TRADE_USD=10` y 0.3 SOL | 20+ operaciones sin descuadres ni errores no manejados |
| **Real** | Tu 1 SOL con los límites de la sección 7 | 2–3 meses de historial público antes de venderlo |

La etapa **sombra** es el siguiente paso recomendado: solo necesita la API key de Jupiter, no expone fondos, y mide el dato que más diferencia hay entre el backtest y la realidad (el costo real de ejecución).

---

## 10. Orden de implementación

1. Refactorizar `sleeve` en `decide()` + `applyFill()` con `PaperExecutor`, manteniendo los tests de paridad.
2. `ShadowExecutor`: cotizaciones reales de Jupiter, informe de slippage en el dashboard.
3. Diario de intents, conciliación y corte de emergencia (`KILL`).
4. `JupiterExecutor`: firma y envío, reintentos e idempotencia.
5. `MeteoraExecutor`: posiciones Bid-Ask, salidas y filtros de seguridad del token.
6. Heartbeat externo; proceso firmante separado (para la versión comercial).

Cada paso va con tests y se prueba en sombra antes de tocar fondos.

## Referencias

- [Jupiter Swap API](https://developers.jup.ag/docs/swap) (v2: `/order`, `/execute`, `/build`)
- [SDK `@meteora-ag/dlmm`](https://www.npmjs.com/package/@meteora-ag/dlmm) · [README](https://github.com/MeteoraAg/dlmm-sdk/blob/main/ts-client/README.md) · [CHANGELOG](https://github.com/MeteoraAg/dlmm-sdk/blob/main/CHANGELOG.md)
- [Decoder Farmer: Meteora DLMM](https://decoder-1.gitbook.io/decoder-farmer/farms/meteora-dlmm)
