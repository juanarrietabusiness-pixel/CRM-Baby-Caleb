-- Catálogo de Baby Caleb — carga desde CERO.
--
-- ⚠️ ESTE ARCHIVO BORRA TODO EL CATÁLOGO (incluido el stock que la dueña haya
--    cargado a mano) y lo vuelve a escribir. Úselo SOLO en una base nueva.
--    Para corregir precios en una base que ya está en producción sin perder
--    las existencias, use src/db/verdad-2026-09.sql.
--
-- Fuente de verdad: PREGUNTAS_BABY_CALEB_usted.docx, entregado por la dueña
-- (Yulilka Godoy) en 2026-09. Donde ese documento contradiga al ADN de la
-- agencia o a cualquier otra cosa del repo, MANDA EL DOCUMENTO.
--
-- Correcciones que trae respecto de la versión anterior de este archivo:
--   · Talla RN: $45.00 → $50.00
--   · Wipes Dany Baby de 1,200: $35.00 → $40.00 (y el código pasa a DANY-AW1200)
--   · Alta de los pañales de PANTS en L, XL y XXL (caja de 160, $55.00)
--   · Alta de la caja de 600 wipes ($25.00) y del fular Moon ($46.00)
--   · Baja de NAT-WIP (wipes Nateen): el documento dice que hoy solo se manejan
--     las toallitas Dany Baby
--
-- Los nombres llevan la cantidad por caja y el rango de peso a propósito: así
-- catalogQuery contesta "cuánto trae y cuánto vale" con una sola llamada y esos
-- datos no tienen que vivir además en la base de conocimiento, donde podrían
-- quedar desfasados. Un dato, un solo dueño (ver docs/FUENTES_DE_VERDAD.md).
--
-- Plata en CENTAVOS de dólar: 50.00 → 5000. El costo es interno: el bot no lo
-- lee nunca (src/db/catalog.ts, PUBLIC_COLS). Los costos que el documento no
-- trae quedan en NULL — un costo inventado ensucia el margen del panel.
--
-- Los productos entran INACTIVOS y con stock en cero a propósito. Un producto
-- activo sin existencias hace que el bot le diga "agotado" a cada clienta que
-- pregunte, que es peor que no ofrecerlo. Cargue el stock desde /admin/catalogo
-- y active cada producto ahí mismo.
--
--   Aplicar:  wrangler d1 execute <tu-db> --file=src/db/seed-catalog.sql --remote

DELETE FROM catalog_items;

-- Pañales NATEEN — hipoalergénicos, sin cloro ni perfumes, fibras de bambú,
-- biodegradables. De cierre hay de RN a XXL; de pants, solo de L a XXL.
-- Wipes de agua DANY BABY — 99% agua pura, sin alcohol, sin perfumes.
-- Fular MOON — prearmado, de bambú, con manual y bolsa de transporte.
INSERT INTO catalog_items (code, name, cost_price, sale_price, stock_qty, branch, active, updated_at) VALUES
  ('NAT-RN', 'Pañal Nateen Talla RN de cierre — caja de 160 (4–11 lbs / 2–5 kg)', 2800, 5000, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-RN', 'Pañal Nateen Talla RN de cierre — caja de 160 (4–11 lbs / 2–5 kg)', 2800, 5000, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-RN', 'Pañal Nateen Talla RN de cierre — caja de 160 (4–11 lbs / 2–5 kg)', 2800, 5000, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('NAT-S', 'Pañal Nateen Talla S de cierre — caja de 160 (6–13 lbs / 3–6 kg)', 3200, 5000, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-S', 'Pañal Nateen Talla S de cierre — caja de 160 (6–13 lbs / 3–6 kg)', 3200, 5000, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-S', 'Pañal Nateen Talla S de cierre — caja de 160 (6–13 lbs / 3–6 kg)', 3200, 5000, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('NAT-M', 'Pañal Nateen Talla M de cierre — caja de 144 (8–19 lbs / 4–9 kg)', 3200, 5000, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-M', 'Pañal Nateen Talla M de cierre — caja de 144 (8–19 lbs / 4–9 kg)', 3200, 5000, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-M', 'Pañal Nateen Talla M de cierre — caja de 144 (8–19 lbs / 4–9 kg)', 3200, 5000, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('NAT-L', 'Pañal Nateen Talla L de cierre — caja de 128 (15–39 lbs / 7–18 kg)', 3000, 4500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-L', 'Pañal Nateen Talla L de cierre — caja de 128 (15–39 lbs / 7–18 kg)', 3000, 4500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-L', 'Pañal Nateen Talla L de cierre — caja de 128 (15–39 lbs / 7–18 kg)', 3000, 4500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('NAT-XL', 'Pañal Nateen Talla XL de cierre — caja de 112 (26–55 lbs / 12–25 kg)', 2800, 4500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-XL', 'Pañal Nateen Talla XL de cierre — caja de 112 (26–55 lbs / 12–25 kg)', 2800, 4500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-XL', 'Pañal Nateen Talla XL de cierre — caja de 112 (26–55 lbs / 12–25 kg)', 2800, 4500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('NAT-XXL', 'Pañal Nateen Talla XXL de cierre — caja de 112 (+55 lbs / +25 kg)', 2920, 4500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-XXL', 'Pañal Nateen Talla XXL de cierre — caja de 112 (+55 lbs / +25 kg)', 2920, 4500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-XXL', 'Pañal Nateen Talla XXL de cierre — caja de 112 (+55 lbs / +25 kg)', 2920, 4500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('NAT-P-L', 'Pañal Nateen Talla L de pants — caja de 160 (15–39 lbs / 7–18 kg)', NULL, 5500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-P-L', 'Pañal Nateen Talla L de pants — caja de 160 (15–39 lbs / 7–18 kg)', NULL, 5500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-P-L', 'Pañal Nateen Talla L de pants — caja de 160 (15–39 lbs / 7–18 kg)', NULL, 5500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('NAT-P-XL', 'Pañal Nateen Talla XL de pants — caja de 160 (26–55 lbs / 12–25 kg)', NULL, 5500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-P-XL', 'Pañal Nateen Talla XL de pants — caja de 160 (26–55 lbs / 12–25 kg)', NULL, 5500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-P-XL', 'Pañal Nateen Talla XL de pants — caja de 160 (26–55 lbs / 12–25 kg)', NULL, 5500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('NAT-P-XXL', 'Pañal Nateen Talla XXL de pants — caja de 160 (+55 lbs / +25 kg)', NULL, 5500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-P-XXL', 'Pañal Nateen Talla XXL de pants — caja de 160 (+55 lbs / +25 kg)', NULL, 5500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-P-XXL', 'Pañal Nateen Talla XXL de pants — caja de 160 (+55 lbs / +25 kg)', NULL, 5500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('DANY-AW1200', 'Water wipes hipoalergénicas Dany Baby — 1,200 toallitas (24 paquetes de 50)', NULL, 4000, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('DANY-AW1200', 'Water wipes hipoalergénicas Dany Baby — 1,200 toallitas (24 paquetes de 50)', NULL, 4000, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('DANY-AW1200', 'Water wipes hipoalergénicas Dany Baby — 1,200 toallitas (24 paquetes de 50)', NULL, 4000, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('DANY-AW600', 'Water wipes hipoalergénicas Dany Baby — caja de 600 toallitas (12 paquetes de 50)', NULL, 2500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('DANY-AW600', 'Water wipes hipoalergénicas Dany Baby — caja de 600 toallitas (12 paquetes de 50)', NULL, 2500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('DANY-AW600', 'Water wipes hipoalergénicas Dany Baby — caja de 600 toallitas (12 paquetes de 50)', NULL, 2500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('MOON-FUL', 'Fular prearmado Moon de bambú — unitalla ajustable XS a 3XL (RN hasta ~25 lbs)', NULL, 4600, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('MOON-FUL', 'Fular prearmado Moon de bambú — unitalla ajustable XS a 3XL (RN hasta ~25 lbs)', NULL, 4600, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('MOON-FUL', 'Fular prearmado Moon de bambú — unitalla ajustable XS a 3XL (RN hasta ~25 lbs)', NULL, 4600, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000);
