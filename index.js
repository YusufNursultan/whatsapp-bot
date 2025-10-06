import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import OpenAI from "openai";

// ⚠️ Убираем dotenv — Render сам подставляет env
const app = express();
app.use(bodyParser.json());

// ====== CONFIG ======
const PORT = process.env.PORT || 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ULTRAMSG_INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN;
const OPERATOR_PHONE = process.env.OPERATOR_PHONE;

if (!OPENAI_API_KEY || !ULTRAMSG_INSTANCE_ID || !ULTRAMSG_TOKEN) {
  console.error("❌ Missing required env vars. Check Render environment settings.");
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`✅ WhatsApp Bot running on port ${PORT}`);
});


const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ====== In-memory sessions ======
const sessions = {}; // { phone: { conversation: [], cart: [], seen:Set, seenQueue:[] } }

// Ensure session exists
function ensureSession(from) {
  if (!sessions[from]) {
    sessions[from] = { conversation: [], cart: [], seen: new Set(), seenQueue: [] };
  }
  return sessions[from];
}

// Mark message id as seen and keep queue to limit memory
function markSeen(session, messageId) {
  if (!messageId) return;
  session.seen.add(messageId);
  session.seenQueue.push(messageId);
  const MAX_SEEN = 500;
  if (session.seenQueue.length > MAX_SEEN) {
    const old = session.seenQueue.shift();
    session.seen.delete(old);
  }
}

// ====== Menu & delivery ======
const menu = {
  "Doner Classic 30 см": 1790,
  "Doner Classic 40 см": 1990,
  "Doner Beef 30 см": 2090,
  "Doner Beef 40 см": 2290,
  "Doner Assorti 30 см": 2090,
  "Doner Assorti 40 см": 2290,
  "Doner Cheese 30 см": 1950,
  "Doner Cheese 40 см": 2150,
  "Doner Crispy 30 см": 1990,
  "Doner Crispy 40 см": 2190,
  "Doner Hot 30 см": 1950,
  "Doner Hot 40 см": 2150,
  "Panini Classic": 1890,
  "Panini Assorti": 2190,
  "Panini Beef": 2190,
  "Panini Cheese": 2050,
  "Panini Crispy": 2090,
  "Panini Hot": 2050,
  "HOT-DOG": 890,
  "BIG HOT-DOG": 1090,
  "CRUNCH HOT-DOG": 1390,
  "TEXAS HOT-DOG": 1390,
  "ЛАВАШ HOT-DOG": 1390,
  "BASKET S": 4090,
  "BASKET M": 5090,
  "BASKET L": 6490,
  "BASKET XL": 7490,
  "Фри": 890,
  "Наггетсы": 990,
  "Луковые кольца": 990,
  "Картофельные шарики": 990,
  "Картофель по-деревенский": 990,
  "Combo Twin": 6720,
  "Combo Friends": 13240,
  "Box Time": 3980,
  "Coca Cola 0.5L": 590,
  "Coca Cola 1L": 890,
  "Айран турецкий": 490,
  "Fuse Tea 0.5L": 690,
  "Fuse Tea 1L": 890,
};
const deliveryPrice = 700;

// ====== System prompt builder (contains full prompt + current cart summary) ======
function buildSystemPrompt(phone) {
  const cart = sessions[phone]?.cart || [];

  const cartText = cart.length
    ? `Корзина клиента:\n${cart
        .map((i, idx) => `${idx + 1}. ${i.name} x${i.quantity} = ${i.price * i.quantity}₸`)
        .join("\n")}\n\nСумма (без доставки): ${cart.reduce((s, i) => s + i.price * i.quantity, 0)}₸`
    : "Корзина пока пуста.";

  // Compose a clear system prompt — concise but full rules
  const menuText = Object.entries(menu)
    .map(([k, v]) => `- ${k}: ${v}₸`)
    .join("\n");

  return `
Ты — живой и дружелюбный оператор кафе "Ali Doner Aktau". Говори по-человечески, используй эмодзи в меру (например 🍔🌯🍟🚚).
Твоя задача: принимать заказы через WhatsApp, заполнять корзину, уточнять размеры/варианты, просить адрес и выдавать финальный чек.

ПРАВИЛА:
1) Если клиент пишет "меню" — покажи краткий список блюд и цены (одно сообщение).
2) Если клиент называет блюдо — добавь его в корзину. Если не хватает параметров (размер, острый/не острый) — уточни.
3) Всегда помни, что уже в корзине (см. блок "Корзина").
4) После добавления товаров предложи посмотреть корзину и оформить доставку.
5) Попроси адрес (адрес может быть цифровым: 12-47-72, с буквой 34А, либо улица и дом).
6) После получения адреса попроси подтверждение ("Да", "Подтверждаю", "Ок"). После подтверждения — выведи чек: список, сумма за еду, доставка ${deliveryPrice}₸, адрес, итог, время доставки до 90 минут.
7) Не повторяйся. Не начинай разговор заново, если уже поздоровались.
8) Если клиент просит цену или "сколько" — покажи корзину и итог.
9) Если не понимаешь — вежливо спроси уточнение.

МЕНЮ:
${menuText}

Доставка: ${deliveryPrice}₸
ТЕКУЩАЯ КОРЗИНА:
${cartText}

Отвечай кратко, дружелюбно и ясно.
  `.trim();
}

// ====== sendMessage: send to UltraMsg and mark outgoing id as seen ======
async function sendMessage(to, text) {
  try {
    const payload = new URLSearchParams({
      token: ULTRAMSG_TOKEN,
      to,
      body: text,
    }).toString();

    const resp = await axios.post(
      `https://api.ultramsg.com/${ULTRAMSG_INSTANCE_ID}/messages/chat`,
      payload,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 }
    );

    // try to extract sent id (provider-dependent)
    const sentId = resp.data?.id || resp.data?.messageId || resp.data?.result?.id;
    if (sentId) {
      // if we have a session for this recipient, mark outgoing id as seen
      const session = sessions[to];
      if (session) {
        markSeen(session, sentId);
        console.log(`🟢 Marked outgoing message as seen for ${to}: ${sentId}`);
      } else {
        // ensureSession and mark too (safe)
        const s = ensureSession(to);
        markSeen(s, sentId);
        console.log(`🟢 Marked outgoing message (new session) as seen for ${to}: ${sentId}`);
      }
    }

    return resp.data;
  } catch (err) {
    console.error("❌ sendMessage error:", err?.response?.data || err.message);
    throw err;
  }
}

// ====== getAIResponse: push user msg, send limited context (last 7 messages) + system prompt ======
async function getAIResponse(userMessage, phone) {
  const session = ensureSession(phone);

  // Save user message in full history
  session.conversation.push({ role: "user", content: userMessage });

  // Prepare recent history (max 7 messages)
  const recent = session.conversation.slice(-7);

  // Build system prompt including cart snapshot
  const system = buildSystemPrompt(phone);

  const startMs = Date.now();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        ...recent,
      ],
      temperature: 0.7,
      max_tokens: 800,
    });

    const reply = completion.choices[0].message.content.trim();

    // save assistant reply into full history
    session.conversation.push({ role: "assistant", content: reply });

if (reply.includes("✅ Заказ подтвержден") && OPERATOR_PHONE) {
  const cart = sessions[phone].cart || [];
  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0) + deliveryPrice;

  const operatorMsg = `
  📢 Новый заказ от клиента ${phone}
  🏠 Адрес: ${sessions[phone].address || "адрес не указан"}
  🛒 Корзина:
  ${cart.map((i, idx) => `${idx + 1}. ${i.name} x${i.quantity} = ${i.price * i.quantity}₸`).join("\n")}

  💰 Итог: ${total}₸ (включая доставку)
  `;

  await sendMessage(OPERATOR_PHONE, operatorMsg);
}

    const duration = ((Date.now() - startMs) / 1000).toFixed(2);
    console.log(`⏱ OpenAI response time: ${duration}s for ${phone}`);

    return reply;
  } catch (err) {
    console.error("❌ OpenAI error:", err?.response?.data || err.message);
    // graceful fallback message
    const fallback = "Извините, временные технические неполадки. Попробуйте, пожалуйста, через минуту.";
    session.conversation.push({ role: "assistant", content: fallback });
    return fallback;
  }
}

// ====== Webhook handler ======
app.post("/webhook-whatsapp", (req, res) => {
  try {
    const body = req.body;
    const data = body.data || body || {};

    // Normalize fields (support different shapes)
    const type = data.type || data.event_type || data.event;
    const messageId = data.id || data.message_id || (data.data && data.data.id) || "";
    const from = data.from || (data.data && data.data.from) || "";
    const text = (data.body || data.message || (data.data && data.data.body) || "").toString().trim();

    // Only handle chat / message received events
    const isIncomingChat = type === "chat" || type === "message_received" || data.event_type === "message_received";
    if (!isIncomingChat) {
      // ignore other events (onCreate, onAck, reactions etc.)
      // console.log("Ignored non-chat event:", type);
      return res.sendStatus(200);
    }

    if (!from || !text) {
      return res.sendStatus(200);
    }

    const session = ensureSession(from);

    // If messageId indicates outgoing (_out) -> ignore (prevents bot processing its own outgoing)
    if (messageId && messageId.toString().includes("_out")) {
      console.log(`🤖 Ignored outgoing webhook (id contains _out): ${messageId}`);
      return res.sendStatus(200);
    }

    // Some providers use from_me/fromMe flags
    if (data.from_me === true || data.fromMe === true) {
      console.log("🤖 Ignored outgoing webhook (from_me flag).");
      return res.sendStatus(200);
    }

    // Deduplicate by messageId
    if (messageId && session.seen.has(messageId)) {
      console.log(`⚠️ Duplicate ignored: ${messageId} from ${from}`);
      return res.sendStatus(200);
    }

    // Mark incoming message id as seen immediately
    if (messageId) markSeen(session, messageId);

    // Log incoming
    console.log(`📩 Incoming from ${from} id=${messageId}: "${text.replace(/\n/g, " ")}"`);

    // Respond 200 immediately to prevent retries
    res.sendStatus(200);

    // Process in background
    (async () => {
      try {
        const reply = await getAIResponse(text, from);
        console.log(`📤 Reply to ${from}: "${reply.replace(/\n/g, " ").slice(0, 250)}"`);

        // Send reply and mark outgoing id as seen inside sendMessage
        await sendMessage(from, reply);
      } catch (err) {
        console.error("❌ Background processing error:", err);
        try {
          await sendMessage(from, "⚠️ Ошибка обработки. Попробуйте, пожалуйста, ещё раз.");
        } catch (_) {}
      }
    })();

  } catch (err) {
    console.error("❌ Webhook top-level error:", err);
    try { res.sendStatus(200); } catch (_) {}
  }
});

// ====== Health endpoints ======
app.get("/", (req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString(), sessions: Object.keys(sessions).length });
});

// ====== Start server ======
app.listen(PORT, () => {
  console.log(`✅ WhatsApp Bot running on port ${PORT}`);
  console.log(`ℹ️ Health check: http://localhost:${PORT}/`);
});
