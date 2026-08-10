#!/usr/bin/env node
// Regenera los iconos de marca de public/ a partir del logo del sitio.
//
//   node scripts/brand-icons.mjs ../PAGINA-JUANCITO-ADS/public/logo.png
//
// El logo del sitio es cuadrado, con mucho aire alrededor y la palabra
// "JUANCITO" debajo de la marca. El panel lo dibuja a 34 px (menú) y 42 px
// (entrada), tamaños a los que esa palabra es una mancha: por eso el script
// RECORTA solo la banda de la marca —el megáfono con las letras JA— y descarta
// el resto. Ver public/README.md.
//
// Sin dependencias: PNG se decodifica y se vuelve a codificar con zlib, que
// viene en Node. Solo entiende PNG de 8 bits RGBA (color type 6), que es lo
// que exporta el logo; si algún día cambia, el script avisa en vez de escribir
// basura.

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const NAVY = [5, 13, 31]; // --bg de la marca; ver docs/design-system.md §1
// El aire que se deja alrededor de la marca dentro del lienzo cuadrado. Sin
// nada, el logo toca el borde; con mucho, se ve diminuto en su caja.
const PADDING = 1.04;

const SALIDAS = [
  { nombre: "logo.png", tam: 256, fondo: null },
  { nombre: "favicon-32.png", tam: 32, fondo: null },
  { nombre: "favicon-192.png", tam: 192, fondo: null },
  // iOS rellena de negro lo transparente: este va compuesto sobre el azul marino.
  { nombre: "apple-touch-icon.png", tam: 180, fondo: NAVY },
];

function decodePng(ruta) {
  const d = readFileSync(ruta);
  if (d.readUInt32BE(0) !== 0x89504e47) throw new Error(`${ruta} no es un PNG`);
  const w = d.readUInt32BE(16);
  const h = d.readUInt32BE(20);
  const bits = d[24];
  const tipo = d[25];
  if (bits !== 8 || tipo !== 6) {
    throw new Error(`${ruta}: se esperaba PNG de 8 bits RGBA (bits=${bits}, tipo=${tipo})`);
  }
  const trozos = [];
  for (let i = 8; i < d.length;) {
    const len = d.readUInt32BE(i);
    if (d.toString("ascii", i + 4, i + 8) === "IDAT") trozos.push(d.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(trozos));
  const stride = w * 4;
  const px = Buffer.alloc(stride * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const filtro = raw[o++];
    const fila = px.subarray(y * stride, (y + 1) * stride);
    raw.copy(fila, 0, o, o + stride);
    o += stride;
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? fila[x - 4] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= 4 ? prev[x - 4] : 0;
      if (filtro === 1) fila[x] = (fila[x] + a) & 255;
      else if (filtro === 2) fila[x] = (fila[x] + b) & 255;
      else if (filtro === 3) fila[x] = (fila[x] + ((a + b) >> 1)) & 255;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        fila[x] = (fila[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
  }
  return { w, h, px };
}

function encodePng(ruta, w, h, px, conAlfa) {
  const canales = conAlfa ? 4 : 3;
  const raw = Buffer.alloc((w * canales + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * canales + 1)] = 0; // filtro "none": el peso extra no importa aquí
    px.copy(raw, y * (w * canales + 1) + 1, y * w * canales, (y + 1) * w * canales);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = conAlfa ? 6 : 2;
  const trozo = (tipo, datos) => {
    const cab = Buffer.alloc(4);
    cab.writeUInt32BE(datos.length, 0);
    const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo), 0);
    return Buffer.concat([cab, cuerpo, crc]);
  };
  writeFileSync(ruta, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", deflateSync(raw, { level: 9 })),
    trozo("IEND", Buffer.alloc(0)),
  ]));
}

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Bandas horizontales con contenido, separadas por filas transparentes. */
function bandas(w, h, px) {
  const perfil = [];
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x += 4) s += px[(y * w + x) * 4 + 3];
    perfil.push(s);
  }
  const umbral = Math.max(...perfil) * 0.01;
  const out = [];
  let ini = null;
  perfil.forEach((v, y) => {
    if (v > umbral && ini === null) ini = y;
    else if (v <= umbral && ini !== null) { out.push([ini, y]); ini = null; }
  });
  if (ini !== null) out.push([ini, h]);
  return out;
}

const origen = resolve(process.argv[2] ?? "../PAGINA-JUANCITO-ADS/public/logo.png");
const { w, h, px } = decodePng(origen);
console.log(`origen: ${origen}  (${w}x${h})`);

// La marca es la banda más alta; la palabra "JUANCITO" es la de abajo.
const bandasContenido = bandas(w, h, px);
const [y0, y1] = bandasContenido.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
if (bandasContenido.length > 1) {
  console.log(`  descartadas ${bandasContenido.length - 1} banda(s) bajo la marca (el texto del logo)`);
}
let x0 = w, x1 = 0;
for (let x = 0; x < w; x++) {
  let s = 0;
  for (let y = y0; y < y1; y += 4) s += px[(y * w + x) * 4 + 3];
  if (s > 0) { if (x < x0) x0 = x; x1 = x + 1; }
}
console.log(`  marca: x ${x0}-${x1}, y ${y0}-${y1}`);

const lado = Math.round(Math.max(x1 - x0, y1 - y0) * PADDING);
const sx = ((x0 + x1) >> 1) - (lado >> 1);
const sy = ((y0 + y1) >> 1) - (lado >> 1);

/** Promedio por caja del recorte cuadrado hacia `tam`x`tam`. */
function escalar(tam, fondo) {
  const canales = fondo ? 3 : 4;
  const out = Buffer.alloc(tam * tam * canales);
  const paso = lado / tam;
  for (let oy = 0; oy < tam; oy++) {
    for (let ox = 0; ox < tam; ox++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const ay1 = sy + Math.floor((oy + 1) * paso);
      const ax1 = sx + Math.floor((ox + 1) * paso);
      for (let y = Math.max(sy + Math.floor(oy * paso), 0); y < Math.min(ay1, h); y++) {
        for (let x = Math.max(sx + Math.floor(ox * paso), 0); x < Math.min(ax1, w); x++) {
          const i = (y * w + x) * 4;
          const al = px[i + 3];
          r += px[i] * al; g += px[i + 1] * al; b += px[i + 2] * al;
          a += al; n++;
        }
      }
      // El color se promedia PONDERADO por alfa: si no, los píxeles del borde
      // (transparentes pero con color basura) ensucian el contorno.
      const media = n ? a / n : 0;
      const [pr, pg, pb] = a ? [r / a, g / a, b / a] : [0, 0, 0];
      const o = (oy * tam + ox) * canales;
      if (fondo) {
        const k = media / 255;
        out[o] = pr * k + fondo[0] * (1 - k);
        out[o + 1] = pg * k + fondo[1] * (1 - k);
        out[o + 2] = pb * k + fondo[2] * (1 - k);
      } else {
        out[o] = pr; out[o + 1] = pg; out[o + 2] = pb; out[o + 3] = media;
      }
    }
  }
  return out;
}

for (const { nombre, tam, fondo } of SALIDAS) {
  const destino = join(PUBLIC_DIR, nombre);
  encodePng(destino, tam, tam, escalar(tam, fondo), !fondo);
  console.log(`  ${nombre.padEnd(22)} ${tam}x${tam}  ${(readFileSync(destino).length / 1024).toFixed(1)} KB`);
}
