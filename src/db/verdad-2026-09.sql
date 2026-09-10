-- Baby Caleb — el documento de la dueña, aplicado SIN perder el stock.
--
-- Fuente de verdad: PREGUNTAS_BABY_CALEB_usted.docx (Yulilka Godoy, 2026-09).
-- Donde ese documento contradiga al ADN de la agencia o a cualquier otra cosa
-- del repo, manda el documento.
--
-- Use ESTE archivo, y no seed-catalog.sql, si la base ya está en producción:
-- seed-catalog.sql empieza con DELETE y le borraría las existencias cargadas.
-- Este es idempotente — puede correrlo dos veces sin romper nada.
--
--   wrangler d1 execute <tu-db> --file=src/db/verdad-2026-09.sql --remote
--
-- Después, en /admin/catalogo: cargue el stock de los productos nuevos y
-- actívelos. Entran inactivos a propósito, para que el bot no los ofrezca
-- como agotados mientras tanto.

-- 1. Wipes Nateen fuera. El documento: "Por el momento únicamente nos
--    mantendremos con las toallitas húmedas de Dany Baby".
DELETE FROM catalog_items WHERE code = 'NAT-WIP';

-- 2. El combo de 1,200 toallitas pasa de DANY-AW2 a DANY-AW1200: el código
--    viejo decía "2 cajas" y ahora convive con la caja de 600, así que el
--    número de toallitas es lo que distingue a uno del otro sin ambigüedad.
--    OR REPLACE cubre el caso de que alguien ya hubiera creado DANY-AW1200 a
--    mano; el stock que gana es el del código viejo, que es el que se ha
--    venido usando.
UPDATE OR REPLACE catalog_items SET code = 'DANY-AW1200' WHERE code = 'DANY-AW2';

-- 3. Precios y nombres corregidos. El stock y el estado activo NO se tocan.
UPDATE catalog_items SET name = 'Pañal Nateen Talla RN de cierre — caja de 160 (4–11 lbs / 2–5 kg)', sale_price = 5000, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-RN';
UPDATE catalog_items SET name = 'Pañal Nateen Talla S de cierre — caja de 160 (6–13 lbs / 3–6 kg)', sale_price = 5000, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-S';
UPDATE catalog_items SET name = 'Pañal Nateen Talla M de cierre — caja de 144 (8–19 lbs / 4–9 kg)', sale_price = 5000, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-M';
UPDATE catalog_items SET name = 'Pañal Nateen Talla L de cierre — caja de 128 (15–39 lbs / 7–18 kg)', sale_price = 4500, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-L';
UPDATE catalog_items SET name = 'Pañal Nateen Talla XL de cierre — caja de 112 (26–55 lbs / 12–25 kg)', sale_price = 4500, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-XL';
UPDATE catalog_items SET name = 'Pañal Nateen Talla XXL de cierre — caja de 112 (+55 lbs / +25 kg)', sale_price = 4500, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-XXL';
UPDATE catalog_items SET name = 'Water wipes hipoalergénicas Dany Baby — 1,200 toallitas (24 paquetes de 50)', sale_price = 4000, updated_at = strftime('%s','now') * 1000 WHERE code = 'DANY-AW1200';

-- 4. Productos que el documento trae y no estaban. Entran inactivos y en cero:
--    INSERT OR IGNORE para que volver a correr esto no pise el stock ya cargado.
INSERT OR IGNORE INTO catalog_items (code, name, cost_price, sale_price, stock_qty, branch, active, updated_at) VALUES
  ('NAT-P-L', 'Pañal Nateen Talla L de pants — caja de 160 (15–39 lbs / 7–18 kg)', NULL, 5500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-P-L', 'Pañal Nateen Talla L de pants — caja de 160 (15–39 lbs / 7–18 kg)', NULL, 5500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-P-L', 'Pañal Nateen Talla L de pants — caja de 160 (15–39 lbs / 7–18 kg)', NULL, 5500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('NAT-P-XL', 'Pañal Nateen Talla XL de pants — caja de 160 (26–55 lbs / 12–25 kg)', NULL, 5500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-P-XL', 'Pañal Nateen Talla XL de pants — caja de 160 (26–55 lbs / 12–25 kg)', NULL, 5500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-P-XL', 'Pañal Nateen Talla XL de pants — caja de 160 (26–55 lbs / 12–25 kg)', NULL, 5500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('NAT-P-XXL', 'Pañal Nateen Talla XXL de pants — caja de 160 (+55 lbs / +25 kg)', NULL, 5500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-P-XXL', 'Pañal Nateen Talla XXL de pants — caja de 160 (+55 lbs / +25 kg)', NULL, 5500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-P-XXL', 'Pañal Nateen Talla XXL de pants — caja de 160 (+55 lbs / +25 kg)', NULL, 5500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('DANY-AW600', 'Water wipes hipoalergénicas Dany Baby — caja de 600 toallitas (12 paquetes de 50)', NULL, 2500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('DANY-AW600', 'Water wipes hipoalergénicas Dany Baby — caja de 600 toallitas (12 paquetes de 50)', NULL, 2500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('DANY-AW600', 'Water wipes hipoalergénicas Dany Baby — caja de 600 toallitas (12 paquetes de 50)', NULL, 2500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('MOON-FUL', 'Fular prearmado Moon de bambú — unitalla ajustable XS a 3XL (RN hasta ~25 lbs)', NULL, 4600, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('MOON-FUL', 'Fular prearmado Moon de bambú — unitalla ajustable XS a 3XL (RN hasta ~25 lbs)', NULL, 4600, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('MOON-FUL', 'Fular prearmado Moon de bambú — unitalla ajustable XS a 3XL (RN hasta ~25 lbs)', NULL, 4600, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000);
