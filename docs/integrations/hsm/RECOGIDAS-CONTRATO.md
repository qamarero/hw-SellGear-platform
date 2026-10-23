# Recogidas HSM → MainOps — Contrato

**Versión:** 1.0 · 2026-10-23
**Estado:** preparado, pendiente de que TIPSA confirme que nuestra cuenta puede
grabar recogidas por WebService. Nada de esto está desplegado.

## Qué resuelve

Hoy, para que TIPSA recoja un equipo en casa de un cliente, hay que pedírselo a
la comercial. Con esto:

1. En **HSM**, desde un RMA con logística «Nosotros recogemos y enviamos», el
   técnico pulsa **Pedir recogida a MainOps**.
2. La petición llega a **MainOps** y aparece en *Logística → Recogidas* con un
   contador rojo. Logística la revisa y pulsa **Programar**: MainOps la da de
   alta en TIPSA (`GrabaRecogida`).
3. MainOps sigue la recogida (estados de TIPSA y, cuando se recoge, el envío
   que genera) y **avisa a HSM** de cada cambio de estado.

MainOps es el único que habla con TIPSA: tiene las credenciales y el cliente
SOAP. HSM solo pide y escucha.

```
HSM (RMA)                         MainOps                          TIPSA
   │ POST /api/external/hsm/pickups  │                                │
   ├────────────────────────────────►│ estado «solicitada»            │
   │                                 │ (logística pulsa Programar)    │
   │                                 ├── GrabaRecogida ──────────────►│
   │◄──── webhook «programada» ──────┤                                │
   │                                 │◄── cron: ConsRecEstados, ──────┤
   │◄──── webhook «incidencia» / ────┤    ConsRecogida, ConsEnvEstados│
   │      «en_curso» / «recibida»    │                                │
```

## Estados

| `status` | Etiqueta | Cuándo |
|---|---|---|
| `solicitada` | Solicitada | HSM la ha pedido; aún no se ha enviado a TIPSA |
| `programada` | Programada | TIPSA la ha aceptado y ha devuelto código de recogida |
| `incidencia` | Incidencia | El último estado de TIPSA es 4 (p. ej. ausente) |
| `en_curso` | Recogida · en camino | TIPSA ha generado el envío de la recogida (ya está recogida) |
| `recibida` | Recibida | El envío generado está ENTREGADO (código 3) en destino |
| `anulada` | Anulada | Cancelada por HSM (solo si estaba `solicitada`) o por logística |

Terminales: `recibida` y `anulada`.

Regla para no inventar significados (ver «Las tres trampas» en
`docs/integrations/tipsa/HANDOFF.md`): la recogida pasa a `en_curso` **solo**
cuando `ConsRecogida` devuelve un albarán en `V_COD_ENV`. Los códigos 11, 12, 13
y 14 se muestran en el historial con su etiqueta, pero no mueven el estado.

## Autenticación

Las dos direcciones usan la cabecera `X-API-Key`, comparada con
`crypto.timingSafeEqual`, igual que el resto de integraciones de ambas apps.
Son **dos secretos distintos**:

| Dirección | Cabecera enviada | Env var en MainOps | Env var en HSM |
|---|---|---|---|
| HSM → MainOps | `X-API-Key` | `HSM_API_KEY` | `MAINOPS_API_KEY` |
| MainOps → HSM (webhook) | `X-API-Key` | `HSM_WEBHOOK_KEY` | `MAINOPS_WEBHOOK_KEY` |

Además: `HSM_BASE_URL` en MainOps y `MAINOPS_BASE_URL` en HSM.

Los endpoints de escritura de MainOps **no** aceptan `QARVIS_API_KEY` (Qarvis
es de solo lectura).

---

## 1. `POST /api/external/hsm/pickups` (HSM → MainOps)

Crea la solicitud de recogida de un RMA.

### Body

```json
{
  "rma_id": "8f0c2b0e-…",
  "rma_number": "RMA-2026-00123",
  "requested_by": { "name": "Ana Técnica", "email": "ana@qamarero.com" },
  "origin": {
    "name": "Bar La Esquina",
    "contact_name": "Laura",
    "phone": "600000000",
    "email": "laura@example.com",
    "address": "C/ Ejemplo 12",
    "postal_code": "28004",
    "city": "Madrid",
    "province": "Madrid"
  },
  "destination": {
    "type": "sat",
    "name": "SAT 10POS",
    "contact_name": "Recepción",
    "phone": "930000000",
    "address": "Pol. Ind. Ejemplo, nave 3",
    "postal_code": "08040",
    "city": "Barcelona"
  },
  "items": [{ "description": "10POS 10D-21 J6412", "serial": "10D21-2405-01187" }],
  "instructions": "Preguntar por el encargado",
  "packages": 1,
  "weight_kg": 3
}
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `rma_id` | sí | id interno del RMA en HSM. Clave de idempotencia |
| `rma_number` | sí | `RMA-YYYY-NNNNN`. Se usa como referencia en TIPSA |
| `origin.name`, `address`, `postal_code`, `city`, `phone` | sí | CP de 5 dígitos |
| `origin.contact_name`, `email`, `province` | no | |
| `destination.type` | sí | `oficina` (nuestro almacén) o `sat` (SAT del proveedor) |
| `destination.*` resto | solo si `type = sat` | Con `oficina` MainOps usa la dirección de TIPSA_SENDER |
| `items` | no | Lo que se recoge. Va al campo «contenido» de TIPSA |
| `instructions` | no | Observaciones para el repartidor |
| `packages`, `weight_kg` | no | Por defecto 1 bulto y 1 kg; logística lo ajusta al programar |
| `requested_by` | no | Quién lo pidió, para el historial |

`destination.type = "cliente"` (envío directo al cliente) no es una recogida:
responde 400.

### Respuestas

- `201` — creada. Body `{ "pickup": PickupDTO }`.
- `200` — ya existía una recogida **activa** (no `anulada`) para ese `rma_id`.
  Devuelve esa misma, sin duplicar. Un doble clic en HSM es inocuo.
- `400` — `{ "error": "…", "field": "origin.postal_code" }`.
- `401` / `403` — falta la clave o no es válida. `503` si MainOps no tiene
  `HSM_API_KEY`.

## 2. `GET /api/external/hsm/pickups?rma_id=…` (HSM → MainOps)

Para resincronizar si se perdió un webhook. Devuelve
`{ "pickups": PickupDTO[] }`, la más reciente primero, incluidas las anuladas.

## 3. `POST /api/external/hsm/pickups/{pickup_id}/cancel` (HSM → MainOps)

Anula una solicitud. Body opcional `{ "reason": "texto" }`.

- `200` — `{ "pickup": PickupDTO }` con `status = "anulada"`.
- `409` — ya está `programada` o más avanzada: la anulación tiene que hacerla
  logística desde MainOps (implica anularla también en TIPSA).
- `404` — no existe.

## 4. Webhook `POST {HSM_BASE_URL}/api/webhooks/mainops/pickups` (MainOps → HSM)

MainOps lo envía cada vez que cambia el `status` de una recogida que vino de
HSM.

```json
{
  "event": "pickup.status_changed",
  "pickup": { …PickupDTO… }
}
```

- HSM responde `2xx` si lo ha procesado. Cualquier otra respuesta se reintenta
  en la siguiente pasada del cron de MainOps (cada 30 min) hasta que llegue un
  `2xx`.
- **Idempotente**: el mismo estado puede llegar más de una vez. HSM debe
  ignorar un webhook cuyo `status` y `updated_at` ya tiene.
- HSM **no** cambia el estado del RMA automáticamente: lo registra en el
  historial y, como mucho, propone la transición al técnico.

## PickupDTO

```json
{
  "pickup_id": "RC-202610-0001",
  "rma_id": "8f0c2b0e-…",
  "rma_number": "RMA-2026-00123",
  "status": "programada",
  "status_label": "Programada",
  "pickup_date": "2026-10-26",
  "time_from": "09:00",
  "time_to": "14:00",
  "tipsa_code": "0028850418",
  "albaran": null,
  "incidence": null,
  "last_event": { "code": "12", "label": "Leída repartidor", "date": "2026-10-26T06:12:00.000Z" },
  "cancel_reason": null,
  "created_at": "2026-10-23T15:02:11.000Z",
  "updated_at": "2026-10-23T16:40:00.000Z"
}
```

- `pickup_date`, `time_from`, `time_to`, `tipsa_code`: `null` hasta que se
  programa.
- `albaran`: el envío que TIPSA genera al recoger. Es el valor que HSM puede
  copiar en «Seguimiento (envío)» del RMA.
- `incidence`: `{ "code": "AS", "label": "Ausente", "observations": "…" }`
  cuando `status = "incidencia"`; si no, `null`.
- Fechas de evento en ISO UTC. `pickup_date` es fecha local (Madrid).
