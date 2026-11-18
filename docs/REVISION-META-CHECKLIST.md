# La revisión de Meta para los DMs de Instagram

## Por qué llegamos aquí

El bot está bien configurado. Se comprobó una por una, con el token real y
contra la API de Meta:

| Comprobación | Estado |
|---|---|
| Token de Página, permanente, emitido por Baby Cale CRM | ✅ |
| Permisos dentro del token (los cinco) | ✅ |
| Página suscrita con `messages` y `messaging_postbacks` | ✅ |
| Instagram @babycalebpanama vinculado a la Página | ✅ |
| Webhook del objeto Instagram con `messages` suscrito | ✅ |
| Una sola app conectada a la Página y a la cuenta | ✅ |
| Nada llega en `standby` (no es protocolo de transferencia) | ✅ |
| Nuestro código no descarta mensajes buenos | ✅ |

Y el comportamiento es inequívoco: **los DMs de cuentas con rol en la app
entran y el bot responde; los de terceros no llegan al webhook en ninguna
forma.** Es, palabra por palabra, la regla que Meta documenta:

> *Standard Access — Webhooks will only be sent if the person using your app
> has a role on the app.*
> *Advanced Access — Webhooks will be sent when any person uses your app.*

No queda nada por configurar. Falta el permiso.

## Meta lo dijo con todas las letras (23-oct-2026)

Al pedir las conversaciones de Instagram de Baby Caleb —desde la **app del
calendario**, que es otra app, de otro portafolio— Meta respondió:

> *"Tu consulta ha caducado porque tienes demasiadas conversaciones con
> usuarios que no tienen un rol en la aplicación. **Solicita acceso avanzado al
> permiso `instagram_manage_messages`** o reduce el número de hilos existentes
> en tu negocio de IG con usuarios sin rol en la aplicación."*

Eso cierra el caso y corrige dos cosas que este documento daba por otra vía:

1. **El `Timeout (-2/2534084)` era el límite de acceso disfrazado.** No era un
   buzón grande ni un servidor lento: Meta intenta filtrar los hilos de gente
   sin rol y, cuando hay muchos, la consulta muere. Por eso ninguna
   configuración lo movía.
2. **El calendario no es ninguna excepción: está en acceso estándar y choca
   con la misma pared.** Funciona con otros clientes porque esas cuentas tienen
   pocos hilos con gente sin rol; Baby Caleb tiene muchos.

La segunda salida que ofrece Meta —"reduce el número de hilos"— significa
borrar conversaciones de clientas. No es una opción para un negocio que vende.

## Paso 1 — Verificar el negocio Baby Kaleb (lo lento: empezar ya)

Meta exige verificación del negocio para dar acceso avanzado. El portfolio
**Baby Kaleb** figura como "Sin verificar", y además tiene datos incompletos,
que es lo primero que hace fallar una verificación:

- Sin teléfono.
- Sin Página principal asignada.
- Con una URL de Facebook como sitio web.

Antes de pedir la verificación, completar eso en Meta Business Suite →
Configuración → Información del negocio:

- Razón social **exactamente como aparece en los documentos legales** del
  negocio. Si no coincide, la rechazan.
- Dirección física, teléfono y sitio web propios. Si no hay web propia,
  cualquier dominio del negocio sirve mejor que un enlace de Facebook.

Después: **Iniciar verificación de empresa**, que pide documentos legales
(registro de la empresa, factura de servicios o similar a nombre del negocio).

> Alternativa a considerar: el portfolio **Juancito Ads** ya tiene razón
> social, dirección, teléfono y sitio web. Si la app se pudiera mover a ese
> portfolio, la verificación saldría más rápido. Hay que confirmar si Meta
> permite ese traslado para esta app.

## Paso 2 — Grabar el video

Esto se puede hacer **hoy**, y es la pieza que más pesa en la revisión. El
estado actual es justo el que sirve: con una cuenta que tiene rol en la app, el
flujo entero funciona.

Qué tiene que verse, sin cortes, en una sola toma:

1. La pantalla de Instagram de un cliente escribiendo un DM a
   **@babycalebpanama** (una pregunta real: un precio, una talla).
2. El DM llegando.
3. **La respuesta automática del bot** apareciendo en esa misma conversación.
4. El panel del negocio (`/admin/conversaciones`) mostrando esa conversación,
   para que se vea para qué se usa el permiso: que la dueña lea y atienda.
5. Si da, una segunda vuelta: el cliente repregunta y el bot responde.

Reglas que hacen fallar videos: que no se vea el nombre de la app, que se note
un corte entre la pregunta y la respuesta, o que el flujo no sea reproducible
con lo que se escribe en las instrucciones.

## Paso 3 — Enviar la solicitud

En la app Baby Cale CRM, pedir con "Añadir a la revisión de la aplicación":

- `instagram_manage_messages` ← el que importa
- `pages_messaging`
- Mencionar `business_management` como **dependencia** — Meta lo pide
  explícitamente para `instagram_manage_messages`.

### Descripción del caso de uso (para pegar)

> Baby Caleb es una tienda de productos para bebé en Panamá que atiende a sus
> clientes por mensajes directos de Instagram. La aplicación lee los mensajes
> que llegan a la cuenta profesional del propio negocio y responde
> automáticamente las preguntas frecuentes (precios, tallas, disponibilidad,
> formas de pago y envío), consultando el catálogo y la base de conocimiento
> del negocio. Cuando la consulta requiere a una persona, la aplicación avisa
> a la dueña y deja de responder en esa conversación. Los mensajes se muestran
> en un panel privado para que la dueña pueda leerlos y continuar la
> conversación. La aplicación la usa únicamente el negocio dueño de la cuenta;
> no atiende cuentas de terceros.

### Instrucciones para el revisor (en inglés, para pegar)

> Our app provides automated customer support for the Instagram professional
> account @babycalebpanama, which belongs to the business that owns this app.
>
> `instagram_manage_messages` is required to (1) receive Instagram Direct
> messages sent to the business account via webhooks, and (2) send the
> automated reply back to the customer in the same conversation.
>
> How it works, as shown in the screencast:
> 1. A customer sends a Direct Message to @babycalebpanama asking about a
>    product (price, size or availability).
> 2. Our webhook receives the message.
> 3. The app answers automatically with information from the business's own
>    product catalog and knowledge base.
> 4. The conversation is shown in the business owner's private dashboard, where
>    she can take over and reply as a human at any time.
>
> The app serves only the Instagram account owned by this business. It does not
> manage messages for third-party accounts.

## Lo que NO hay que hacer

- No regenerar el token ni rehacer el otorgamiento: ya están correctos y
  comprobados.
- No tocar los webhooks ni la suscripción de la Página.
- No tocar la app del calendario.

## Mientras tanto

Messenger sigue funcionando con normalidad, y los DMs de Instagram de cuentas
con rol en la app también. Para atender a algunas personas concretas antes de
la aprobación, se les puede dar rol de **Evaluador** en la app (es por cuenta
de Facebook, no de Instagram). No escala a clientela real, pero sirve para
seguir probando.
