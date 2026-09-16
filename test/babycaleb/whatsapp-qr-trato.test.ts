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
