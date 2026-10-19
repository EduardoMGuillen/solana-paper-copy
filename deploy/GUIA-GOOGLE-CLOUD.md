# Desplegar el bot en Google Cloud (24/7)

El bot queda corriendo en una VM pequeña, con HTTPS y contraseña. Sigue operando en papel: no firma ni envía transacciones.

## Costo real

| Recurso | Costo |
|---|---|
| VM `e2-micro` en `us-central1`, `us-west1` o `us-east1` | Gratis (Always Free) |
| Disco **estándar** de 30 GB | Gratis |
| Salida de datos (1 GB/mes gratis) | Gratis; el dashboard envía poco y comprimido |
| **IP pública** | **~3.65 US$/mes** (Google cobra la IPv4 desde 2024; el plan gratis cubre 1 h/mes) |

Si tu cuenta es nueva, los 300 US$ de crédito de prueba cubren la IP durante 90 días. Para que todo sea gratis, el mismo instalador funciona en Oracle Cloud Always Free (ver al final).

## 1. Cuenta y alerta de gasto

1. Crea la cuenta en https://console.cloud.google.com (pide tarjeta para verificar).
2. Ve a **Facturación → Presupuestos y alertas → Crear presupuesto**: monto **5 US$**, alertas al 50%, 90% y 100%. Así te enteras si algo empieza a costar más de lo esperado.

## 2. Crear la VM

**Compute Engine → Instancias de VM → Crear instancia**:

| Campo | Valor |
|---|---|
| Nombre | `solana-bot` |
| Región | `us-central1` (Iowa); también sirven `us-west1` o `us-east1`. **Otras regiones no son gratis.** |
| Tipo de máquina | Serie E2 → **`e2-micro`** |
| Disco de arranque | **Debian 12**, tipo **"Disco persistente estándar"**, 30 GB. **No dejes "Balanceado"**, que se cobra. |
| Firewall | Marca **Permitir tráfico HTTP** y **Permitir tráfico HTTPS** |

Pulsa **Crear**. No abras ningún otro puerto: la app escucha solo dentro de la VM, y Caddy es la única entrada (por HTTPS).

## 3. Instalar

En la lista de instancias, pulsa **SSH** junto a la VM. Se abre una terminal en el navegador. Ahí ejecuta:

```bash
curl -fsSL https://raw.githubusercontent.com/EduardoMGuillen/solana-paper-copy/main/deploy/install.sh -o install.sh
less install.sh        # revisa lo que hace (sal con q)
sudo bash install.sh
```

Tarda unos 5–10 minutos (compilar en una e2-micro es lento). Al final muestra algo así:

```
Dashboard:  https://34-123-45-67.sslip.io
Usuario:    admin
Contraseña: Xk3...
```

Guarda la contraseña en tu gestor de contraseñas. `sslip.io` es un dominio gratuito que apunta a tu IP y permite tener HTTPS sin comprar un dominio.

## 4. Uso diario

```bash
sudo systemctl status solana-bot          # ¿está corriendo?
sudo journalctl -u solana-bot -f          # ver el log en vivo (Ctrl+C para salir)
sudo grep BOT_PASSWORD /etc/solana-bot.env  # ver la contraseña
sudo bash install.sh                      # actualizar a la última versión de GitHub
```

- **Actualizar** conserva la contraseña y la cuenta de papel.
- **El estado** vive en `/var/lib/solana-bot/bot-state.json`. Para respaldarlo: `sudo cp /var/lib/solana-bot/bot-state.json ~/respaldo-$(date +%F).json`.
- **Cambiar la contraseña**: edita `BOT_PASSWORD` con `sudo nano /etc/solana-bot.env` y luego `sudo systemctl restart solana-bot`.
- **Si apagas y enciendes la VM**, la IP puede cambiar. Vuelve a ejecutar `sudo bash install.sh` para que el HTTPS use la nueva dirección.

## Alertas por Telegram

El bot te avisa por Telegram cuando:
- compra o vende (con el resultado en US$ y en R);
- se activa un corte por pérdida diaria o por drawdown, o pausas o reanudas el bot;
- cambia la estrategia de un mercado;
- un mercado pierde o recupera los datos de precios.

Además envía un **resumen diario** a las 00:00 UTC.

1. En Telegram, abre **@BotFather**, envía `/newbot` y sigue los pasos. Te da un **token** como `123456:ABC-...`.
2. Abre tu bot nuevo y envíale cualquier mensaje, por ejemplo "hola".
3. En la terminal SSH de la VM, obtén tu **chat id**:
   ```bash
   curl -s "https://api.telegram.org/bot<TU_TOKEN>/getUpdates" | grep -o '"chat":{"id":[-0-9]*'
   ```
4. Agrega las dos líneas al archivo de configuración y reinicia el servicio:
   ```bash
   sudo nano /etc/solana-bot.env
   #   TELEGRAM_BOT_TOKEN=123456:ABC-...
   #   TELEGRAM_CHAT_ID=987654321
   sudo systemctl restart solana-bot
   ```
5. En el dashboard, en **Ajustes**, pulsa **Probar alerta de Telegram**.

El token es secreto: quien lo tenga puede escribir como tu bot. Vive solo en `/etc/solana-bot.env`, con permisos de root.

## Investigación de pools de Meteora (estilo Decoder Farmer)

El instalador deja un recolector que guarda cada 15 minutos una foto de los pools DLMM con SOL. No opera nada; solo registra datos.

```bash
sudo meteora-lp scan     # pools actuales: comisiones/TVL y los mejores candidatos
sudo meteora-lp report   # simulación en papel de posiciones Bid-Ask sobre las fotos guardadas
systemctl list-timers solana-bot-meteora.timer   # cuándo corre la próxima foto
```

Corre `report` después de 3 a 7 días de fotos. Muestra:
- **% de ganadoras** de las posiciones simuladas;
- **resultado medio y peor caso** por posición;
- **cada cuánto el token cayó más de 60%** con la posición abierta.

Las comisiones del reporte son una estimación **optimista**: si aun así la media sale negativa, la estrategia pierde.

## Seguridad

- **Contraseña:** todo el sitio (dashboard y API) pide usuario y contraseña, que es aleatoria de 28 caracteres.
- **HTTPS:** el certificado es automático (Let's Encrypt, vía Caddy), así que la contraseña nunca viaja en texto plano.
- **Sin contraseña no responde:** si falta `BOT_PASSWORD`, la app solo contesta en `localhost`. Nunca queda abierta por accidente.
- **Servicio aislado:** corre con un usuario sin privilegios, sistema de archivos de solo lectura salvo sus datos y sin acceso a `/home`.
- **Antes de operar SOL real:** la llave de la wallet **nunca** debe ir en el repositorio. Ese paso se diseña aparte, con una wallet dedicada y límites.

## Alternativa 100% gratis: Oracle Cloud

Oracle Always Free incluye la IP pública. En **Compute → Instances → Create** elige:
- imagen **Ubuntu 22.04 o 24.04**;
- forma **VM.Standard.A1.Flex** (1 OCPU, 6 GB) o **VM.Standard.E2.1.Micro**.

En la **Security List** de la VCN agrega reglas de entrada para TCP 80 y 443. Luego ejecuta los mismos comandos del paso 3 (el instalador abre también el firewall interno de Ubuntu de Oracle).

Ten en cuenta que Oracle puede reclamar VMs gratis "inactivas" (uso de CPU, red y RAM bajo 20% durante 7 días). Pasar la cuenta a *Pay As You Go* evita esa regla, y sigues sin pagar mientras no excedas lo gratuito.
