-- Catálogo inicial de Baby Caleb.
--
-- Fuente: Agencia_Workspace/Baby Caleb/01_ADN_y_Memoria/01_brand_guidelines.md
-- §4 "Productos, tallas y precios (verificado)" — formulario de onboarding
-- confirmado por el cliente el 2026-08-05.
--
-- Plata en CENTAVOS de dólar: 45.00 → 4500.
--
-- Los productos entran INACTIVOS y con stock en cero a propósito. Un producto
-- activo sin existencias hace que el bot le diga "agotado" a cada clienta que
-- pregunte, que es peor que no ofrecerlo. Cargue el stock desde
-- /admin/catalogo y actíve cada producto ahí mismo.
--
-- NO están aquí, porque el ADN no trae su precio: los wipes Nateen y el fular
-- Moon. Créelos desde el panel cuando tenga los precios — un precio inventado
-- en la base es un precio que el bot promete.
--
--   Aplicar:  wrangler d1 execute <tu-db> --file=src/db/seed-catalog.sql --remote

DELETE FROM catalog_items;

-- Pañales NATEEN — hipoalergénicos, sin cloro ni perfumes, fibras de bambú.
INSERT INTO catalog_items (code, name, cost_price, sale_price, stock_qty, branch, active, updated_at) VALUES
  ('NAT-RN',  'Pañal Nateen Talla RN (2–5 kg)',   2800, 4500, 0, 'Bodega Ciudad de Panamá',              0, strftime('%s','now') * 1000),
  ('NAT-RN',  'Pañal Nateen Talla RN (2–5 kg)',   2800, 4500, 0, 'Bodega Panamá Oeste',                  0, strftime('%s','now') * 1000),
  ('NAT-RN',  'Pañal Nateen Talla RN (2–5 kg)',   2800, 4500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),

  ('NAT-S',   'Pañal Nateen Talla S (3–6 kg)',    3200, 5000, 0, 'Bodega Ciudad de Panamá',              0, strftime('%s','now') * 1000),
  ('NAT-S',   'Pañal Nateen Talla S (3–6 kg)',    3200, 5000, 0, 'Bodega Panamá Oeste',                  0, strftime('%s','now') * 1000),
  ('NAT-S',   'Pañal Nateen Talla S (3–6 kg)',    3200, 5000, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),

  ('NAT-M',   'Pañal Nateen Talla M (4–9 kg)',    3200, 5000, 0, 'Bodega Ciudad de Panamá',              0, strftime('%s','now') * 1000),
  ('NAT-M',   'Pañal Nateen Talla M (4–9 kg)',    3200, 5000, 0, 'Bodega Panamá Oeste',                  0, strftime('%s','now') * 1000),
  ('NAT-M',   'Pañal Nateen Talla M (4–9 kg)',    3200, 5000, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),

  ('NAT-L',   'Pañal Nateen Talla L (7–18 kg)',   3000, 4500, 0, 'Bodega Ciudad de Panamá',              0, strftime('%s','now') * 1000),
  ('NAT-L',   'Pañal Nateen Talla L (7–18 kg)',   3000, 4500, 0, 'Bodega Panamá Oeste',                  0, strftime('%s','now') * 1000),
  ('NAT-L',   'Pañal Nateen Talla L (7–18 kg)',   3000, 4500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),

  ('NAT-XL',  'Pañal Nateen Talla XL (12–25 kg)', 2800, 4500, 0, 'Bodega Ciudad de Panamá',              0, strftime('%s','now') * 1000),
  ('NAT-XL',  'Pañal Nateen Talla XL (12–25 kg)', 2800, 4500, 0, 'Bodega Panamá Oeste',                  0, strftime('%s','now') * 1000),
  ('NAT-XL',  'Pañal Nateen Talla XL (12–25 kg)', 2800, 4500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),

  ('NAT-XXL', 'Pañal Nateen Talla XXL (+55 lbs)', 2920, 4500, 0, 'Bodega Ciudad de Panamá',              0, strftime('%s','now') * 1000),
  ('NAT-XXL', 'Pañal Nateen Talla XXL (+55 lbs)', 2920, 4500, 0, 'Bodega Panamá Oeste',                  0, strftime('%s','now') * 1000),
  ('NAT-XXL', 'Pañal Nateen Talla XXL (+55 lbs)', 2920, 4500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000),

  -- Wipes de agua Dany Baby (AquaWipes 100, agua 99% pura). Costo pendiente.
  ('DANY-AW2', 'Combo 2 cajas AquaWipes Dany Baby (1,200 toallitas)', NULL, 3500, 0, 'Bodega Ciudad de Panamá',              0, strftime('%s','now') * 1000),
  ('DANY-AW2', 'Combo 2 cajas AquaWipes Dany Baby (1,200 toallitas)', NULL, 3500, 0, 'Bodega Panamá Oeste',                  0, strftime('%s','now') * 1000),
  ('DANY-AW2', 'Combo 2 cajas AquaWipes Dany Baby (1,200 toallitas)', NULL, 3500, 0, 'Bodega Ciudad de Panamá Este Línea 2', 0, strftime('%s','now') * 1000);
