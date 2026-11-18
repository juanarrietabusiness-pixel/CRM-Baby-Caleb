/**
 * El canal de WhatsApp por QR se portó desde PanaClaw, donde el panel tutea.
 *
 * Aquí no. La dueña de Baby Caleb trata de usted a todas sus clientas y el bot
 * hace lo mismo — el tuteo es del marketing de la agencia, no de la atención
 * (CLAUDE.md). Esta pantalla es la que el dueño ve en el teléfono mientras
 * vincula el número, así que es texto de atención como cualquier otro.
 *
 * Este candado existe porque el port es la vía por la que el tuteo entra sin
 * que nadie lo decida: se copia un archivo que funcionaba en otro repo y con él
 * viene un registro que aquí está mal.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { enCastellano, renderWhatsappQrPanel } from "../../src/admin/views/whatsappQr";
import { renderConexiones } from "../../src/admin/views/conexiones";
import type { Env } from "../../src/env";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Las formas de tuteo que este canal podría arrastrar del repo de origen. */
const TUTEO = [
  /\bEscanea\b/,
  /\bToca\b/,
  /\bVincula\b/,
  /\bAbre\b/,
  /\bVuelve\b/,
  /\bRevisa\b/,
  /\bPuedes\b/,
  /\bTu número\b/,
];

describe("el canal de WhatsApp por QR habla de usted", () => {
  it("los estados traducidos no tutean", () => {
    for (const estado of ["conectada", "esperando-qr", "desvinculada", "cerrada", "arrancando", undefined]) {
      const { titulo, detalle } = enCastellano(estado);
      for (const forma of TUTEO) {
        expect(`${titulo} ${detalle}`, `estado "${estado}"`).not.toMatch(forma);
      }
    }
  });

  it("dice 'Escanee' y 'Su número', no 'Escanea' ni 'Tu número'", () => {
    expect(enCastellano("esperando-qr").detalle).toContain("Escanee");
    expect(enCastellano("conectada").detalle).toContain("Su número");
    expect(enCastellano("desvinculada").detalle).toContain("Escanee");
  });

  it("las instrucciones del QR y el aviso del latido tampoco", () => {
    const html = renderWhatsappQrPanel(
      { contenedor: { conexion: "esperando-qr" }, latido: { vencido: true } },
      "data:image/png;base64,AAAA",
    );
    for (const forma of TUTEO) expect(html).not.toMatch(forma);
    expect(html).toContain("Abra WhatsApp");
    expect(html).toContain("Vaya a");
    expect(html).toContain("Toque");
  });

  it("la tarjeta de Conexiones tampoco, que es donde vive el panel", () => {
    const fuente = readFileSync(resolve(ROOT, "src/admin/views/conexiones.ts"), "utf8");
    // Solo el bloque de este canal: el resto de la pestaña es anterior a esta
    // regla y se arregla aparte, no de contrabando dentro de un port.
    const ini = fuente.indexOf('id: "whatsapp-qr"');
    expect(ini).toBeGreaterThan(-1);
    const bloque = fuente.slice(ini, fuente.indexOf('id: "meta"', ini));
    expect(bloque).toContain("Vincule");
    expect(bloque).toContain("Escanee");
    expect(bloque).not.toMatch(/\bVincula\b/);
    expect(bloque).not.toMatch(/\bEscanea\b/);
  });
});

// ── El badge que decía CONECTADO sin que nada estuviera conectado ─────────
//
// Con los secrets puestos y el puente sin desplegar, la tarjeta salía verde y
// decía CONECTADO mientras su propio cuerpo mostraba en rojo que no se podía
// hablar con el servicio de WhatsApp. Es la misma clase de fallo que el latido
// que medía `container.running`: una señal que sale verde tanto si el sistema
// funciona como si no.

const CON_QR = {
  WA_PUENTE_URL: "https://juancitoads-bot-wa.ejemplo.workers.dev",
  WA_TOKEN: "un-token-de-prueba-solo-ascii-1234",
  BOT_NAME: "Baby Caleb",
  BUSINESS_NAME: "Baby Caleb",
  DASHBOARD_BASE_URL: "https://juancitoads-bot.ejemplo.workers.dev",
} as unknown as Env;

describe("el badge de WhatsApp por QR no promete lo que no sabe", () => {
  it("con los secrets puestos dice CONFIGURADO, no CONECTADO", () => {
    const html = renderConexiones(CON_QR);
    const ini = html.indexOf("WhatsApp (por código QR)");
    expect(ini).toBeGreaterThan(-1);
    // La tarjeta empieza antes del título; se mira el trozo que la rodea.
    const tarjeta = html.slice(Math.max(0, ini - 1200), ini + 1200);
    expect(tarjeta).toContain("CONFIGURADO");
  });

  it("los demás canales conservan CONECTADO", () => {
    // El campo es opcional a propósito: solo este canal lo necesita. Si alguien
    // cambiara el valor por defecto, Telegram y compañía cambiarían con él.
    const conTelegram = { ...CON_QR, TELEGRAM_BOT_TOKEN: "123:abc" } as unknown as Env;
    const html = renderConexiones(conTelegram);
    const ini = html.indexOf("Telegram");
    const tarjeta = html.slice(Math.max(0, ini - 600), ini + 1200);
    expect(tarjeta).toContain("CONECTADO");
    expect(tarjeta).not.toContain("CONFIGURADO");
  });
});
