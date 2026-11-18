-- Las credenciales de WhatsApp, fuera del disco del contenedor.
--
-- Esto es lo que reemplaza a `useMultiFileAuthState` de Baileys: allá los
-- archivos viven en un directorio, aquí son filas. La diferencia importa porque
-- el disco del contenedor es descartable — Cloudflare puede moverlo, reiniciarlo
-- o reemplazarlo cuando quiera. Con las credenciales en D1 eso es invisible para
-- el dueño del bot; con ellas en disco, cada vez habría que re-escanear el QR.
--
-- La fila que decide todo es `creds`: mientras exista, no hay QR nuevo. Las
-- demás son llaves de sesión de Signal, y Baileys las regenera si faltan.
--
-- `actualizado_en` no es decorativo: es el testigo externo de que el canal está
-- vivo. Una `creds` con fecha reciente y filas `lid-mapping` significan socket
-- abierto y autenticado, y se leen sin tocar el contenedor.
CREATE TABLE IF NOT EXISTS wa_auth (
  clave          TEXT PRIMARY KEY,
  valor          TEXT NOT NULL,
  actualizado_en INTEGER NOT NULL
);

-- La poda de pre-keys ordena por fecha sobre un prefijo; sin índice sería un
-- barrido completo de una tabla que llega a miles de filas.
CREATE INDEX IF NOT EXISTS idx_wa_auth_actualizado ON wa_auth (actualizado_en);
