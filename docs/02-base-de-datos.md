# ZITA - Base de Datos

## Tablas Principales

### businesses
```sql
id                       UUID PK
user_id                  UUID (references auth.users)
name                     TEXT NOT NULL
business_type            TEXT DEFAULT 'barberia'
status                   TEXT DEFAULT 'trial'
owner_email              TEXT NOT NULL
phone                    TEXT
address                  TEXT
whatsapp_token           TEXT (encriptado AES-256)
whatsapp_phone_number_id TEXT
created_at               TIMESTAMPTZ
```

### products
```sql
id              UUID PK
business_id     UUID NOT NULL (references businesses)
name            TEXT NOT NULL
stock           INT DEFAULT 0
min_stock       INT DEFAULT 5
price           NUMERIC(10,2) DEFAULT 0
is_active       BOOLEAN DEFAULT true
created_at      TIMESTAMPTZ
category        TEXT
updated_at      TIMESTAMPTZ
has_variants    BOOLEAN DEFAULT false
image_url       TEXT
```

### product_variants
```sql
id              UUID PK
product_id      UUID NOT NULL (references products)
business_id     UUID NOT NULL (references businesses)
attributes      JSONB DEFAULT '{}'  -- {"talla": "M", "color": "Rojo"}
stock           INT DEFAULT 0
is_active       BOOLEAN DEFAULT true
created_at      TIMESTAMPTZ
```

### product_sales
```sql
id              UUID PK
business_id     UUID NOT NULL
product_id      UUID NOT NULL
variant_id      UUID (nullable, references product_variants)
quantity        INT NOT NULL
total_amount    NUMERIC NOT NULL
client_id       UUID (nullable)
appointment_id  UUID (nullable)
sold_via        TEXT DEFAULT 'presencial'  -- presencial | whatsapp
created_at      TIMESTAMPTZ
```

### appointments
```sql
id              UUID PK
business_id     UUID NOT NULL
client_id       UUID (nullable)
service_id      UUID (nullable)
scheduled_at    TIMESTAMPTZ NOT NULL
status          TEXT DEFAULT 'pending'  -- pending | confirmed | completed | cancelled
price           NUMERIC(10,2)
source          TEXT DEFAULT 'manual'   -- manual | whatsapp
notes           TEXT
created_at      TIMESTAMPTZ
```

### clients
```sql
id              UUID PK
business_id     UUID NOT NULL
name            TEXT NOT NULL
phone           TEXT NOT NULL
email           TEXT
total_spent     NUMERIC(10,2) DEFAULT 0
visits_count    INT DEFAULT 0
created_at      TIMESTAMPTZ
UNIQUE (business_id, phone)
```

### services
```sql
id              UUID PK
business_id     UUID NOT NULL
name            TEXT NOT NULL
description     TEXT
duration_minutes INT DEFAULT 30
price           NUMERIC(10,2) DEFAULT 0
active          BOOLEAN DEFAULT true
created_at      TIMESTAMPTZ
```

### employees
```sql
id              UUID PK
business_id     UUID NOT NULL
name            TEXT NOT NULL
phone           TEXT
email           TEXT
commission_percent NUMERIC(5,2)
commission_fixed NUMERIC(10,2)
active          BOOLEAN DEFAULT true
created_at      TIMESTAMPTZ
```

### income
```sql
id              UUID PK
business_id     UUID NOT NULL
amount          NUMERIC NOT NULL
category        TEXT  -- servicios | productos | otro
description     TEXT
date            DATE NOT NULL
created_at      TIMESTAMPTZ
```

### expenses
```sql
id              UUID PK
business_id     UUID NOT NULL
amount          NUMERIC NOT NULL
category        TEXT
description     TEXT
date            DATE NOT NULL
created_at      TIMESTAMPTZ
```

### whatsapp_conversations
```sql
id              UUID PK
business_id     UUID NOT NULL
client_phone    TEXT NOT NULL
client_name     TEXT
state           TEXT DEFAULT 'greeting'
context         JSONB DEFAULT '{}'
last_message_at TIMESTAMPTZ
created_at      TIMESTAMPTZ
UNIQUE (business_id, client_phone)
```

### support_conversations
```sql
id              UUID PK
business_id     UUID NOT NULL
status          TEXT DEFAULT 'bot'  -- bot | human | closed
assigned_to     TEXT
created_at      TIMESTAMPTZ
```

## Migraciones Ejecutadas (001-021)

| Migración | Descripción |
|-----------|-------------|
| 001 | Esquema inicial: businesses, services, clients, appointments, conversations |
| 002 | RLS policies y funciones: get_business_id_for_user() |
| 003 | Funciones de negocio adicionales |
| 004 | Phase 2: products, loyalty_points |
| 005 | Phase 3: expansión de tablas |
| 006 | Employees: sueldos, comisiones, rendimiento |
| 007 | Expenses: egresos |
| 008 | Income: ingresos |
| 009 | Business config: horarios, días cerrados |
| 010 | Products: min_stock, category, is_active |
| 011-015 | Loyalty program: puntos, visitas, canjes |
| 016 | WhatsApp setup |
| 018 | Employee last_appointment tracking |
| 019 | Business type: barberia, spa, veterinaria, etc. |
| 020 | Product variants: has_variants, image_url, product_variants table |
| 021 | Product sales variant: variant_id column |

## Políticas RLS Críticas

### Superadmin (esteban.zita.ia@gmail.com)
```sql
-- Bypasea todo RLS, ve todos los datos
FOR ALL USING (auth.email() = 'esteban.zita.ia@gmail.com')
```

### Business Owner (usuario autenticado)
```sql
-- Solo ve sus propios datos via business_id
FOR ALL USING (business_id = get_business_id_for_user(auth.uid()))
```

### Clientes WhatsApp
- No tienen acceso web
- Solo interactúan vía WhatsApp → Chatbot
- Los datos se guardan en clients + whatsapp_conversations

## Función Crítica

```sql
CREATE OR REPLACE FUNCTION get_business_id_for_user(uid UUID)
RETURNS UUID AS $$
  SELECT id FROM businesses WHERE user_id = uid LIMIT 1;
$$ LANGUAGE SQL;
```

**Uso:** `WHERE business_id = get_business_id_for_user(auth.uid())`
