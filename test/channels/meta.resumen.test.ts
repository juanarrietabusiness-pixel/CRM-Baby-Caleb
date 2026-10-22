import { describe, it, expect } from "vitest";
import { resumirMetaEventos, describirResumen, parseMetaEvents } from "../../src/channels/meta";

// `parseMetaEvents` descarta cuatro clases de evento en silencio. El resumen
// existe para que el panel pueda decir CUÁL de las cuatro fue — y, sobre todo,
// para que un mensaje de verdad que llega como adjunto raro (respuesta a una
// historia, producto compartido) no se confunda con un recibo de lectura.
function ev(message: any, sender: any = { id: "999" }) {
  return { sender, recipient: { id: "17841400000000000" }, message };
}

function body(...messaging: any[]) {
  return { object: "instagram", entry: [{ id: "17841400000000000", messaging }] };
}

describe("resumirMetaEventos", () => {
  it("separa las cuatro razones por las que se descarta un evento", () => {
    const r = resumirMetaEventos(
      body(
        ev({ mid: "1", text: "hola" }), // con mensaje
        ev({ mid: "2", text: "eco", is_echo: true }), // eco
        ev({ mid: "3", quick_reply: { payload: "x" }, text: "Sí" }), // tap de botón
        ev({ mid: "4", text: "sin remitente" }, null), // sin remitente (null, no undefined: undefined toma el valor por defecto)
        { recipient: { id: "1" }, read: { watermark: 1 } }, // recibo: no trae message
      ),
    );
    expect(r).toMatchObject({ total: 5, conMensaje: 1, echo: 1, quickReply: 1, sinRemitente: 1, recibo: 1 });
  });

  it("delata los adjuntos que NO procesamos, que es donde se pierde un DM real", () => {
    const r = resumirMetaEventos(
      body(
        ev({ mid: "1", attachments: [{ type: "story_mention", payload: { url: "https://x" } }] }),
        ev({ mid: "2", attachments: [{ type: "share", payload: { url: "https://y" } }] }),
      ),
    );
    expect(r.sinContenido).toBe(2);
    expect(describirResumen(r)).toContain("adjunto que NO procesamos (story_mention, share)");
    expect([...r.tipos].sort()).toEqual(["share", "story_mention"]);
  });

  it("una foto o un audio sí cuentan como mensaje", () => {
    const r = resumirMetaEventos(
      body(
        ev({ mid: "1", attachments: [{ type: "image", payload: { url: "https://i" } }] }),
        ev({ mid: "2", attachments: [{ type: "audio", payload: { url: "https://a" } }] }),
      ),
    );
    expect(r.conMensaje).toBe(2);
    expect(r.sinContenido).toBe(0);
  });

  it("cuenta lo mismo que parseMetaEvents procesa de verdad", () => {
    const b = body(
      ev({ mid: "1", text: "hola" }),
      ev({ mid: "2", text: "eco", is_echo: true }),
      ev({ mid: "3", attachments: [{ type: "story_mention" }] }),
    );
    expect(resumirMetaEventos(b).conMensaje).toBe(parseMetaEvents(b as any).length);
  });

  it("lo resume en una línea legible", () => {
    const r = resumirMetaEventos(body(ev({ mid: "1", text: "hola" }), ev({ mid: "2", is_echo: true, text: "x" })));
    expect(describirResumen(r)).toBe("2 evento(s): 1 con mensaje, 1 eco de la propia cuenta");
  });
});
