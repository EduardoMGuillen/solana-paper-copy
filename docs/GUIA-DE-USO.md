# Guía de uso: cómo funciona el bot

## En una frase

El bot analiza gráficos de SOL y otros tokens del ecosistema Solana en velas de 4 horas. **Solo compra cuando hay una tendencia alcista confirmada** y sale con un stop que sube con el precio. Hoy opera **en papel**: precios reales, dinero simulado.

---

## 1. Qué hace, paso a paso

1. **Descarga velas reales** de Binance cada 30 segundos para SOL, BTC, ETH, JUP y WIF (los mercados se cambian en Ajustes).
2. **Valida estrategias una vez al día.** Para cada mercado prueba 6 estrategias sobre ~3 años de historia:
   - aprende con el 70% más antiguo;
   - se evalúa en el 30% más reciente, que no vio al elegir.
   
   Solo usa una estrategia si en ese mercado cumple todo esto:
   - al menos 20 operaciones;
   - factor de beneficio ≥ 1,2 (gana al menos 1,20 US$ por cada 1 US$ que pierde);
   - gana en el periodo que no vio al elegirla;
   - expectativa > 0,1 R por operación;
   - caída máxima razonable para el perfil de riesgo.
   
   **Si ninguna cumple, ese mercado no se opera.**
3. **Decide al cierre de cada vela** de 4 h y ejecuta al abrir la siguiente: nunca usa información del futuro.
4. **Protege cada operación:**
   - un stop inicial calculado con la volatilidad (ATR);
   - un stop que sube con el precio (*trailing*);
   - la salida por señal.
5. **Corta solo** si pierdes demasiado en el día o si la cuenta cae demasiado desde su máximo.
6. **Te avisa por Telegram** de cada compra, venta o corte, y te manda un resumen diario.

### La estrategia que hoy pasa la validación: cruce EMA 20/50

- **Compra** cuando la media de 20 velas cruza por encima de la de 50 **y** el precio está sobre la media de 200 (tendencia de fondo alcista).
- **Vende** cuando la media de 20 cruza por debajo de la de 50, o si salta el stop.
- **Acierta ~40% de las veces**, pero las ganadoras son 2 a 3 veces más grandes que las perdedoras.
- **Pasa mucho tiempo fuera del mercado (~70%).** Eso es intencional: así evita los desplomes.

### Cuánto arriesga

El tamaño de cada compra se calcula para que, **si salta el stop, pierdas un % fijo del capital de ese mercado**:

| Perfil | Riesgo por operación | Corte diario | Corte por caída | Backtest del portafolio |
|---|---|---|---|---|
| Conservador | 2% | 5% | 20% | ~10% anual, caída máx. ~5% |
| **Agresivo** (por defecto) | 5% | 8% | 30% | ~20% anual, caída máx. ~7% |

En la realidad, espera aproximadamente **la mitad del retorno y el doble de caída** que en el backtest.

---

## 2. Cómo leer el dashboard

**Barra superior:**
- Patrimonio en US$ y en SOL, retorno, resultado del día y posiciones abiertas.
- El botón **Pausar entradas** detiene las compras nuevas; las posiciones abiertas siguen con sus stops.

**Tarjeta "Prueba con 1 SOL":** el dato clave es **"Diferencia del bot"**:
- Positivo: el bot le gana a simplemente guardar tu SOL.
- Negativo: te habría ido mejor sin hacer nada.

**Tarjeta "Modo sombra":** cuánto costaría de verdad cada operación en Jupiter, comparado con lo que supone el backtest (sección 4).

**Tarjeta de cada mercado:**
- **Gráfico de velas:** EMA 20 (celeste), EMA 50 (naranja), EMA 200 (morado), ▲ compras, ▼ ventas y línea roja del stop.
- **Lectura del gráfico:** si el régimen es alcista o bajista, si hay impulso a favor o en contra, la fuerza de la tendencia (ADX) y el RSI.
- **Estado:** "Esperando señal", "Compra en la próxima vela", "En posición" o "Sin estrategia validada".
- **"Validación walk-forward"** (se despliega): la tabla de las 6 estrategias en ese mercado, con cuál pasó y por qué fallaron las demás.

**Operaciones cerradas y Bitácora:** el historial y cada decisión del bot con su motivo.

**Ajustes:**
- perfil de riesgo, velas, estrategia, mercados y límites;
- probar Telegram, revalidar y reiniciar la cuenta de papel.
- Cambiar mercados, velas o estrategia **cierra las posiciones y reparte el capital de nuevo**; cambiar solo el riesgo no las toca.

---

## 3. Qué esperar (y qué no)

- **Con velas de 4 h hay pocas operaciones:** unas 10–15 al año por mercado. Puede pasar una semana sin operar, y es normal.
- **En un mercado alcista fuerte, comprar y mantener le gana al bot.** Su valor está en esquivar los desplomes: en el periodo de prueba, WIF cayó 95% y el bot terminó positivo.
- **No es una máquina de dinero pasivo.** Con 1 SOL, ~20% anual son ~20 US$ al año. Esta prueba sirve para demostrar que el sistema funciona antes de escalar el capital.

---

## 4. Modo sombra (costos reales, sin firmar nada)

- Cada operación en papel, y una prueba por hora en cada mercado, se cotiza en Jupiter **sin indicar ninguna wallet**, así que nada se puede firmar.
- **Si la mediana del costo es ≤ 20 bps por lado,** el backtest es creíble.
- **Si es mayor,** el bot te dice cuánto subir la comisión y el deslizamiento en Ajustes.
- **Si un mercado sale "sospechoso",** su mint está mal configurado.

Para activarlo: `LIVE_MODE=shadow` y `JUPITER_API_KEY=...` en `.env.local`. Ver [CORRER-EN-CASA.md](CORRER-EN-CASA.md).

---

## 5. Meteora (investigación tipo Decoder Farmer)

**Qué simula:** la estrategia de Decoder Farmer, que pone **solo SOL** por debajo del precio actual (forma Bid-Ask, hasta −75%) y cobra comisiones mientras el precio oscila dentro de ese rango.

**Cómo se comporta:**

| El token cae | Resultado sin comisiones |
|---|---|
| hasta −50% | −0 a −5% (las comisiones lo cubren) |
| −75% | −34% |
| −95% (rug) | −87% |

**La pregunta clave** es qué tan seguido se desploman esos tokens con la posición abierta. Para responderla:

```powershell
npm run meteora -- scan      # pools actuales y mejores candidatos
npm run meteora -- collect   # guarda una foto (la VM lo hace sola cada 15 min)
npm run meteora -- report    # tras 3-7 días: simulación de posiciones
```

El reporte da el % de ganadoras, el resultado medio, el peor caso y cada cuánto hubo desplomes. Las comisiones se estiman a favor de la estrategia, así que **si aun así sale negativo, no conviene**.

---

## 6. Dónde correrlo

| Dónde | Cómo | Guía |
|---|---|---|
| Tu PC | `npm run dev` y abrir http://127.0.0.1:47231 | [CORRER-EN-CASA.md](CORRER-EN-CASA.md) |
| VM 24/7 (Google Cloud u Oracle) | `sudo bash deploy/install.sh` | [../deploy/GUIA-GOOGLE-CLOUD.md](../deploy/GUIA-GOOGLE-CLOUD.md) |

En la VM el dashboard queda en HTTPS con usuario y contraseña. En tu PC, sin contraseña, solo responde en tu propia máquina.

---

## 7. Hoja de ruta hacia dinero real

| Etapa | Estado |
|---|---|
| Papel, 4–8 semanas | ✅ Listo, en marcha |
| Sombra: costos reales de Jupiter | ✅ Listo (actívalo en casa) |
| Recolector de Meteora | ✅ Listo |
| Micro: real con 0.3 SOL y límites estrictos | 📝 Diseñado en [EJECUCION-REAL.md](EJECUCION-REAL.md) |
| Real con 1 SOL | Después de la etapa micro, con 20+ operaciones sin errores |
| Vender el producto | Con 2–3 meses de historial real verificable |

---

## 8. Preguntas frecuentes

**¿Puede perder mi SOL hoy?** No. Opera en papel y el proyecto no tiene ninguna llave privada.

**¿Por qué no compra ahora?** Lee la "lectura del gráfico" del mercado. Lo más común es que el precio esté bajo la EMA 200 (régimen bajista), y ahí el bot no compra a propósito.

**¿Por qué no usa scalping, apalancamiento o memecoins de pump.fun?** Se probaron con datos y costos reales y perdieron. Los resultados están en el README, sección "What was tested and rejected".

**¿Qué hago si algo falla?** Copia el error de la tarjeta, de la bitácora o de la terminal, y pásaselo a tu asistente de IA junto con [../AGENTS.md](../AGENTS.md), que explica cómo está construido el proyecto.

---

*Esto no es asesoría financiera. Resultados pasados no garantizan resultados futuros; en cripto puedes perder todo el capital que pongas.*
