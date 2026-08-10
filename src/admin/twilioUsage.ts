// Jala el costo REAL de Twilio (mensajería WhatsApp + renta de números, etc.)
// desde la Usage Records API, usando las credenciales que ya viven como secrets
// del Worker (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN). Así el dashboard muestra
// lo que Twilio de verdad cobró, no un estimado.
//
// Docs: GET /2010-04-01/Accounts/{Sid}/Usage/Records/{Period}.json
//   Period ∈ ThisMonth | Today | Yesterday | LastMonth | AllTime
//   Cada registro trae { category, usage, usage_unit, price, price_unit }.
import type { Env } from "../env";

export interface TwilioUsageCategory {
  category: string; // categoría cruda de Twilio (ej. "channels-messaging")
  label: string; // etiqueta amigable en español
  usage: number;
  unit: string;
  price: number; // USD
}

export interface TwilioUsage {
  available: boolean; // false si faltan credenciales o falló la llamada
  error?: string;
  total: number; // suma de todo lo cobrado en el periodo (USD)
  messagingTotal: number; // mensajería (Twilio + conversaciones WhatsApp/Meta)
  numbersTotal: number; // renta de números
  waConversations: number; // # de conversaciones de WhatsApp (informativo)
  categories: TwilioUsageCategory[]; // solo las que cobraron (price > 0), desc
  period: string;
}

const LABELS: Record<string, string> = {
  "channels-messaging": "Mensajes (Twilio)",
  "channels-whatsapp": "Conversaciones WhatsApp",
  "channels-whatsapp-conversation-marketing": "WhatsApp · marketing (Meta)",
  "channels-whatsapp-conversation-utility": "WhatsApp · utilidad (Meta)",
  "channels-whatsapp-conversation-authentication": "WhatsApp · autenticación (Meta)",
  "channels-whatsapp-conversation-service": "WhatsApp · servicio (Meta)",
  "channels-whatsapp-template-marketing": "Plantilla WhatsApp · marketing",
  "channels-whatsapp-template-utility": "Plantilla WhatsApp · utilidad",
  "phonenumbers-local": "Renta de número(s)",
  "phonenumbers": "Renta de número(s)",
  "phonenumbers-mobile": "Renta de número(s) móvil",
  "smsmessages-outbound-domestic": "SMS salientes",
  "mms-outbound": "MMS salientes",
  "recordings": "Grabaciones",
};

function friendly(cat: string): string {
  return LABELS[cat] ?? cat.replace(/-/g, " ");
}

const EMPTY = (period: string, error?: string): TwilioUsage => ({
  available: false,
  error,
  total: 0,
  messagingTotal: 0,
  numbersTotal: 0,
  waConversations: 0,
  categories: [],
  period,
});

export async function fetchTwilioUsage(
  env: Env,
  period: "ThisMonth" | "Today" | "LastMonth" = "ThisMonth",
): Promise<TwilioUsage> {
  const sid = env.TWILIO_ACCOUNT_SID;
  const tok = env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return EMPTY(period, "Twilio no está configurado en este bot.");

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Usage/Records/${period}.json?PageSize=250`;
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${btoa(`${sid}:${tok}`)}` },
    });
    if (!res.ok) return EMPTY(period, `Twilio respondió HTTP ${res.status}`);
    const data = (await res.json()) as {
      usage_records?: Array<{
        category: string;
        usage: string;
        usage_unit: string;
        price: string;
      }>;
    };
    const recs = data.usage_records ?? [];

    let total = 0;
    let messagingTotal = 0;
    let numbersTotal = 0;
    let waConversations = 0;
    const categories: TwilioUsageCategory[] = [];

    for (const r of recs) {
      const price = parseFloat(r.price ?? "0") || 0;
      const usage = parseFloat(r.usage ?? "0") || 0;
      if (r.category === "channels-whatsapp") waConversations = usage;
      if (price > 0) {
        total += price;
        if (r.category.startsWith("phonenumbers")) numbersTotal += price;
        else messagingTotal += price;
        categories.push({
          category: r.category,
          label: friendly(r.category),
          usage,
          unit: r.usage_unit,
          price,
        });
      }
    }
    categories.sort((a, b) => b.price - a.price);
    return {
      available: true,
      total,
      messagingTotal,
      numbersTotal,
      waConversations,
      categories,
      period,
    };
  } catch (e) {
    return EMPTY(period, e instanceof Error ? e.message : "error desconocido");
  }
}
