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

-- 1. Códigos que salieron del catálogo.
--    NAT-WIP era el código viejo de los wipes Nateen; hoy se venden como WIPESNAT.
--    DANY-AW1200 (antes DANY-AW2) era el combo de 1,200 wipes Dany Baby: desde
--    el 29-sep-2026 se vende solo la caja de 600.
DELETE FROM catalog_items WHERE code = 'NAT-WIP';
DELETE FROM catalog_items WHERE code = 'DANY-AW2';
DELETE FROM catalog_items WHERE code = 'DANY-AW1200';

-- 3. Precios y nombres corregidos. El stock y el estado activo NO se tocan.
UPDATE catalog_items SET name = 'Pañal Nateen Talla RN de cierre — caja de 160 (4–11 lbs / 2–5 kg)', sale_price = 5000, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-RN';
UPDATE catalog_items SET name = 'Pañal Nateen Talla S de cierre — caja de 160 (6–13 lbs / 3–6 kg)', sale_price = 5000, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-S';
UPDATE catalog_items SET name = 'Pañal Nateen Talla M de cierre — caja de 144 (8–19 lbs / 4–9 kg)', sale_price = 5000, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-M';
UPDATE catalog_items SET name = 'Pañal Nateen Talla L de cierre — caja de 128 (15–39 lbs / 7–18 kg)', sale_price = 4500, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-L';
UPDATE catalog_items SET name = 'Pañal Nateen Talla XL de cierre — caja de 112 (26–55 lbs / 12–25 kg)', sale_price = 4500, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-XL';
UPDATE catalog_items SET name = 'Pañal Nateen Talla XXL de cierre — caja de 112 (+55 lbs / +25 kg)', sale_price = 4500, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-XXL';

-- 3b. Costos que llegaron el 29-sep-2026. El nombre y el precio que la dueña
--     haya puesto en el panel no se tocan.
UPDATE catalog_items SET cost_price = 3600, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-P-L';
UPDATE catalog_items SET cost_price = 3800, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-P-XL';
UPDATE catalog_items SET cost_price = 3800, updated_at = strftime('%s','now') * 1000 WHERE code = 'NAT-P-XXL';
UPDATE catalog_items SET cost_price = 1400, updated_at = strftime('%s','now') * 1000 WHERE code = 'DANY-AW600';
UPDATE catalog_items SET cost_price = 3220, updated_at = strftime('%s','now') * 1000 WHERE code = 'MOON-FUL';

-- 4. Productos que no estaban. Entran inactivos y en cero: INSERT OR IGNORE
--    para que volver a correr esto no pise el stock ya cargado.
INSERT OR IGNORE INTO catalog_items (code, name, cost_price, sale_price, stock_qty, branch, active, updated_at) VALUES
  ('NAT-P-L', 'Pañal Nateen Talla L de pants — caja de 160 (19–31 lbs / 9–14 kg)', 3600, 5500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-P-L', 'Pañal Nateen Talla L de pants — caja de 160 (19–31 lbs / 9–14 kg)', 3600, 5500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-P-L', 'Pañal Nateen Talla L de pants — caja de 160 (19–31 lbs / 9–14 kg)', 3600, 5500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('NAT-P-XL', 'Pañal Nateen Talla XL de pants — caja de 160 (26–37.5 lbs / 12–17 kg)', 3800, 5500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-P-XL', 'Pañal Nateen Talla XL de pants — caja de 160 (26–37.5 lbs / 12–17 kg)', 3800, 5500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-P-XL', 'Pañal Nateen Talla XL de pants — caja de 160 (26–37.5 lbs / 12–17 kg)', 3800, 5500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('NAT-P-XXL', 'Pañal Nateen Talla XXL de pants — caja de 160 (+33 lbs / +15 kg)', 3800, 5500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('NAT-P-XXL', 'Pañal Nateen Talla XXL de pants — caja de 160 (+33 lbs / +15 kg)', 3800, 5500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('NAT-P-XXL', 'Pañal Nateen Talla XXL de pants — caja de 160 (+33 lbs / +15 kg)', 3800, 5500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('DANY-AW600', 'Water wipes hipoalergénicas Dany Baby — caja de 600 toallitas (12 paquetes de 50)', 1400, 2500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('DANY-AW600', 'Water wipes hipoalergénicas Dany Baby — caja de 600 toallitas (12 paquetes de 50)', 1400, 2500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('DANY-AW600', 'Water wipes hipoalergénicas Dany Baby — caja de 600 toallitas (12 paquetes de 50)', 1400, 2500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('WIPESNAT', 'Water wipes hipoalergénicas Nateen — caja de 960 toallitas (12 paquetes de 80)', 2160, 4500, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('WIPESNAT', 'Water wipes hipoalergénicas Nateen — caja de 960 toallitas (12 paquetes de 80)', 2160, 4500, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('WIPESNAT', 'Water wipes hipoalergénicas Nateen — caja de 960 toallitas (12 paquetes de 80)', 2160, 4500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),
  ('MOON-FUL', 'Fular prearmado Moon de bambú — unitalla ajustable XS a 3XL (RN hasta ~25 lbs)', 3220, 4600, 0, 'Bodega Ciudad de Panamá', 0, strftime('%s','now') * 1000),
  ('MOON-FUL', 'Fular prearmado Moon de bambú — unitalla ajustable XS a 3XL (RN hasta ~25 lbs)', 3220, 4600, 0, 'Bodega Panamá Oeste', 0, strftime('%s','now') * 1000),
  ('MOON-FUL', 'Fular prearmado Moon de bambú — unitalla ajustable XS a 3XL (RN hasta ~25 lbs)', 3220, 4600, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000);
