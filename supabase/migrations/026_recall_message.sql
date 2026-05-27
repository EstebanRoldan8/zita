ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS recall_message TEXT DEFAULT 'Hola {nombre} 👋 Hace un tiempo no te vemos en {negocio}. ¡Te esperamos para tu próxima visita! Escríbenos para agendar fácilmente 😊',
ADD COLUMN IF NOT EXISTS recall_image_url TEXT DEFAULT NULL;
