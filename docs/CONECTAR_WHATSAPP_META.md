# Conectar Baby Caleb al WhatsApp oficial de Meta (Cloud API)

> Escrito el 2026-08-18. Runbook específico de **este** bot. La guía genérica
> (para cualquier cliente) vive en `skill/references/channel-setup-guides/whatsapp-cloud.md`;
> acá están los valores reales de Baby Caleb y el orden exacto.

## Lo importante en una línea

El código del canal **ya está listo y probado** (`src/channels/whatsapp.ts`, 
`/webhooks/whatsapp` en `src/index.ts`). Lo único que falta es **configuración**:
cuatro credenciales en Cloudflare — **como Secret, no como Text** — y el webhook
apuntado en Meta.

## Los datos de este bot

| Qué | Valor |
|---|---|
| Worker | `juancitoads-bot` (cuenta Juanarrietabusiness) |
| URL pública | `https://juancitoads-bot.juanarrietabusiness.workers.dev` |
| **Webhook para Meta** | `https://juancitoads-bot.juanarrietabusiness.workers.dev/webhooks/whatsapp` |
| Campo a suscribir en Meta | `messages` (solo ese) |
| App de Meta | Baby Caleb CRM (portafolio comercial) |
| Panel de estado | `/admin/conexiones` → tarjeta **WhatsApp (Oficial · Cloud API)** |

## Paso 1 — Las cuatro credenciales, y de dónde sale cada una

| Variable | De dónde se saca | Para qué la usa el bot |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Meta → WhatsApp → **API Setup**, debajo del número de prueba. Es un número largo, **no** el teléfono | Es el remitente: `POST graph.facebook.com/<id>/messages` |
| `WHATSAPP_ACCESS_TOKEN` | El identificador **que no caduca** del System User (rol admin) con los activos *Baby Caleb CRM* + *Test WhatsApp Business Account* | Autoriza enviar respuestas y descargar audios/fotos |
| `WHATSAPP_APP_SECRET` | Meta → tu app → **Configuración → Básica → Clave secreta de la app** (botón *Mostrar*) | Valida la firma `X-Hub-Signature-256` de cada webhook, y firma las URLs del proxy de media |
| `WHATSAPP_VERIFY_TOKEN` | **Lo inventas tú** (ej. `baby-caleb-wa-7h2k9`). No sale de ningún lado | El apretón de manos cuando Meta registra el webhook |

Permisos que debe tener el token del System User: `whatsapp_business_messaging` y
`whatsapp_business_management`.

> Si algún día se conecta también Instagram/Messenger con la **misma** app, el bot
> reutiliza `META_APP_SECRET` y `META_VERIFY_TOKEN` cuando los de WhatsApp no están
> definidos (ver `src/index.ts`). No hay que duplicar nada.

## Paso 2 — Guardarlas en Cloudflare **como Secret**

⚠️ **Esto es lo que más se rompe.** En *Settings → Variables and Secrets* del Worker,
cada fila tiene un selector **Text / Secret**. Las cuatro tienen que quedar en **Secret**:

- Una variable **Text** creada desde el panel **la borra el próximo deploy**. El deploy
  de este repo (`.github/workflows/deploy.yml` → `wrangler deploy`) reemplaza todas las
  vars de texto por las del `wrangler.toml`, y ahí no están las de WhatsApp. Cloudflare lo
  documenta así: *"si cambias tus variables de entorno en el dashboard, Wrangler las va a
  sobrescribir en el próximo deploy"*.
- Un **Secret** nunca lo borra un deploy: solo `wrangler secret delete`.
- Y de paso: el access token y el app secret son llaves maestras. En Text quedan
  **visibles en el panel**; en Secret quedan cifradas.

Dos formas de hacerlo (cualquiera sirve):

**A · Desde el panel de Cloudflare** — borra las cuatro filas que quedaron en *Text*,
créalas de nuevo eligiendo **Secret**, pega el valor y dale **Deploy**.

**B · Desde la terminal** (entrada oculta, no se ve el valor):

```bash
pnpm wrangler secret put WHATSAPP_PHONE_NUMBER_ID
pnpm wrangler secret put WHATSAPP_ACCESS_TOKEN
pnpm wrangler secret put WHATSAPP_APP_SECRET
pnpm wrangler secret put WHATSAPP_VERIFY_TOKEN
```

Nunca pegues estos valores en un chat, un issue o un commit.

## Paso 3 — Apuntar el webhook en Meta

En la app **Baby Caleb CRM** → **WhatsApp → Configuración**:

1. **URL de devolución de llamada**: `https://juancitoads-bot.juanarrietabusiness.workers.dev/webhooks/whatsapp`
2. **Token de verificación**: exactamente el mismo `WHATSAPP_VERIFY_TOKEN` del paso 2.
3. **Verificar y guardar**. Meta hace un `GET` con `hub.challenge`; el Worker responde solo.
4. En **Campos del webhook**, busca la fila `messages` y dale **Suscribirse**.
   Sin esa suscripción no llega ni un mensaje, aunque el webhook diga verificado.

El orden importa: si le das *Verificar y guardar* antes de que el secret esté guardado y
desplegado, Meta responde error y hay que reintentar.

## Paso 4 — Probar

1. Abre `/admin/conexiones`: la tarjeta **WhatsApp (Oficial · Cloud API)** debe estar en
   verde y sin faltantes.
2. Desde el celular que ya verificaste como destinatario, escríbele **al número de prueba**
   de Meta (el mismo del que te llegó la plantilla).
3. El bot contesta en segundos. Prueba también una **nota de voz** y una **foto**: las
   entiende sin configurar nada extra (el proxy firmado de media hace el trabajo).
4. Revisa la conversación en `/admin/conversaciones`.

## Lo que hay que saber del modo prueba

- El número de prueba **solo** habla con los destinatarios que verificaste (hasta ~5).
- La plantilla que te llegó es de otra cosa: sirve para **iniciar** conversaciones. Para
  **responder** —que es lo que hace el bot— no hace falta ninguna plantilla, siempre que
  el cliente haya escrito en las últimas **24 horas** (la ventana de servicio de WhatsApp).
  Fuera de esa ventana Meta rechaza el texto libre; el error queda en los logs del Worker
  (`whatsapp sendReply <status>: ...`).
- Para atender a cualquier cliente hace falta número propio + verificación del negocio.
  Cuando llegue ese día: se cambia **solo** `WHATSAPP_PHONE_NUMBER_ID` por el del número
  nuevo y se vuelve a desplegar. Nada más del código cambia.

## Si algo falla

| Síntoma | Causa casi siempre |
|---|---|
| "Verificar y guardar" falla en Meta | El `WHATSAPP_VERIFY_TOKEN` guardado y el pegado en Meta no son idénticos, o no se ha desplegado desde que lo guardaste |
| El webhook quedó verde pero el bot no responde | Falta suscribir el campo `messages` |
| Responde y al día siguiente deja de responder | Se usó el token temporal de 24 h en vez del del System User |
| La tarjeta de `/admin/conexiones` se puso gris sola | Las variables estaban como **Text** y un deploy las borró. Vuelve al paso 2 |
| Meta manda mensajes pero el Worker responde 403 | `WHATSAPP_APP_SECRET` equivocado (tiene que ser el de la app **Baby Caleb CRM**) |
| No entiende audios ni fotos | Sin `WHATSAPP_APP_SECRET` no se pueden firmar las URLs del proxy de media |

## Nota técnica de este cambio

`src/channels/whatsapp.ts` pasó de Graph `v21.0` a `v23.0`. Cada versión de Graph vive
unos dos años y la v21.0 (octubre 2024) se vence a finales de 2026 — mejor mover el reloj
antes de conectar el canal que descubrirlo el día que Meta la apague. El contrato de
`/messages` y de `/<media_id>` es el mismo en ambas.
