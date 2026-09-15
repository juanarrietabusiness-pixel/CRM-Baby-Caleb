import { describe, it, expect } from "vitest";
import {
  renderWhatsappQrPanel,
  renderWhatsappQrCard,
  enCastellano,
} from "../../src/admin/views/whatsappQr";
import type { Env } from "../../src/env";

const configurado = {
  WA_PUENTE_URL: "https://puente.ejemplo",
  WA_TOKEN: "token-de-prueba-1234567890abcdef",
} as unknown as Env;

const QR_FALSO = "data:image/png;base64,AAAA";

describe("enCastellano", () => {
  it("traduce el estado técnico a algo que el dueño entiende", () => {
    // "cerrada" no significa nada para quien solo quiere que su WhatsApp
    // conteste. El panel no es para quien escribió el código.
    expect(enCastellano("conectada").titulo).toBe("Conectado");
    expect(enCastellano("cerrada").titulo).toBe("Reconectando");
    expect(enCastellano("esperando-qr").titulo).toBe("Esperando el código");
  });

  it("habla de usted, como el resto de la atención", () => {
    expect(enCastellano("esperando-qr").detalle).toMatch(/Escanee/);
    expect(enCastellano("desvinculada").detalle).toMatch(/Escanee/);
    for (const estado of ["conectada", "cerrada", "esperando-qr", "desvinculada"]) {
      expect(enCastellano(estado).detalle).not.toMatch(/\b(escanea|tienes|puedes)\b/i);
    }
  });

  it("no deja un estado desconocido sin explicación", () => {
    const r = enCastellano("algo-que-no-existe");
    expect(r.titulo).toBeTruthy();
    expect(r.detalle).toBeTruthy();
    expect(r.color).toBe("bad");
  });
});

describe("renderWhatsappQrPanel", () => {
  it("muestra el QR cuando hace falta vincular", () => {
    const html = renderWhatsappQrPanel({ contenedor: { conexion: "esperando-qr" } }, QR_FALSO);
    expect(html).toContain(QR_FALSO);
    expect(html).toMatch(/Dispositivos vinculados/);
  });

  it("NO sirve el QR cuando ya está conectado", () => {
    // Regla de seguridad, no estética: un QR servido con la sesión ya activa
    // deja que cualquiera con el panel abierto vincule OTRO teléfono al bot.
    const html = renderWhatsappQrPanel({ contenedor: { conexion: "conectada" } }, QR_FALSO);
    expect(html).not.toContain(QR_FALSO);
  });

  it("ofrece desvincular solo si hay algo que desvincular", () => {
    const conectado = renderWhatsappQrPanel({ contenedor: { conexion: "conectada" } }, null);
    expect(conectado).toMatch(/Desvincular/);

    const sinVincular = renderWhatsappQrPanel({ contenedor: { conexion: "desvinculada" } }, null);
    expect(sinVincular).not.toMatch(/>\s*Desvincular/);
  });

  it("pide confirmación antes de desvincular", () => {
    const html = renderWhatsappQrPanel({ contenedor: { conexion: "conectada" } }, null);
    expect(html).toMatch(/hx-confirm/);
  });

  it("muestra el error técnico, pero detrás de un detalle plegado", () => {
    // Esconderlo del todo fue un error que ya cometimos: la pantalla decía
    // "esperando" mientras el error real estaba en otra ruta.
    const html = renderWhatsappQrPanel(
      { contenedor: { conexion: "cerrada", ultimoError: "cierre 515" } },
      null,
    );
    expect(html).toMatch(/<details/);
    expect(html).toContain("cierre 515");
  });

  it("dice algo útil si el puente no responde", () => {
    const html = renderWhatsappQrPanel(null, null);
    expect(html).toMatch(/No se pudo hablar con el servicio/);
  });

  it("escapa lo que viene del puente", () => {
    const html = renderWhatsappQrPanel(
      { contenedor: { conexion: "cerrada", ultimoError: "<img src=x onerror=alert(1)>" } },
      null,
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("respeta el piso de 44 px táctiles del design-system", () => {
    const html = renderWhatsappQrPanel({ contenedor: { conexion: "conectada" } }, null);
    const botones = html.match(/<button[^>]*>/g) ?? [];
    expect(botones.length).toBeGreaterThan(0);
    for (const b of botones) expect(b).toMatch(/min-height:44px/);
  });

  it("no usa emojis en la interfaz (§6 del design-system)", () => {
    const html = renderWhatsappQrPanel({ contenedor: { conexion: "conectada" } }, QR_FALSO);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("renderWhatsappQrCard", () => {
  it("se recarga sola con htmx en vez de JS propio", () => {
    const html = renderWhatsappQrCard(configurado);
    expect(html).toMatch(/hx-get="\/admin\/whatsapp-qr\/estado"/);
    expect(html).toMatch(/every 5s/);
    expect(html).not.toMatch(/<script/);
  });

  it("nunca pone el token en el HTML que va al navegador", () => {
    // El panel es un proxy: el token se queda en el Worker. Si viajara al
    // cliente, cualquiera con el panel abierto podría vincular otro teléfono.
    const html = renderWhatsappQrCard(configurado);
    expect(html).not.toContain(configurado.WA_TOKEN as string);
  });

  it("dice exactamente qué falta si no está configurado", () => {
    const html = renderWhatsappQrCard({} as Env);
    expect(html).toContain("WA_PUENTE_URL");
    expect(html).toContain("WA_TOKEN");
  });
});
