import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import OpenAI from "openai";

// ⚙️ Express app
const app = express();
app.use(bodyParser.json());

// ====== CONFIG ======
const PORT = process.env.PORT || 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ULTRAMSG_INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN;
const OPERATOR_PHONE = process.env.OPERATOR_PHONE;

// Проверка переменных окружения
if (!OPENAI_API_KEY || !ULTRAMSG_INSTANCE_ID || !ULTRAMSG_TOKEN) {
  console.error("❌ Missing required env vars. Check Render environment settings.");
  process.exit(1);
}

// ====== OpenAI init ======
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ====== In-memory sessions ======
const sessions = {}; // { phone: { conversation: [], cart: [], seen:Set, seenQueue:[] } }

function ensureSession(from) {
  if (!sessions[from]) {
    sessions[from] = { conversation: [], cart: [], seen: new Set(), seenQueue: [] };
  }
  return sessions[from];
}

function markSeen(session, messageId) {
  if (!messageId) return;
  session.seen.add(messageId);
  session.seenQueue.push(messageId);
  if (session.seenQueue.length > 500) {
    const old = session.seenQueue.shift();
    session.seen.delete(old);
  }
}

// ====== Menu ======
const menu = {
  "Doner Classic 30 см": 1790,
  "Doner Classic 40 см": 1990,
  // ... остальное меню
};
const deliveryPrice = 700;

// ====== System prompt ======
function buildSystemPrompt(phone) {
  const cart = sessions[phone]?.cart || [];
  const cartText = cart.length
    ? `Корзина клиента:\n${cart
        .map((i, idx) => `${idx + 1}. ${i.name} x${i.quantity} = ${i.price * i.quantity}₸`)
        .join("\n")}\n\nСумма (без доставки): ${cart.reduce((s, i) => s + i.price * i.quantity, 0)}₸`
    : "Корзина пока пуста.";

  const menuText = Object.entries(menu)
    .map(([k, v]) => `- ${k}: ${v}₸`)
    .join("\n");

  return `
Ты — оператор кафе "Ali Doner Aktau". Говори по-человечески, используй немного эмодзи 🍔🌯🍟🚚.
Задача — принять заказ через WhatsApp и оформить доставку.

ПРАВИЛА:
1) Показывай меню по запросу "меню".
2) Добавляй блюда в корзину, уточняй параметры.
3) После добавления предложи оформить заказ.
4) Проси адрес и подтверждение.
5) После подтверждения — выведи чек: сумма еды, доставка ${deliveryPrice}₸, адрес, итог.
6) Не начинай разговор заново и не повторяйся.

МЕНЮ:
${menuText}

Доставка: ${deliveryPrice}₸
${cartText}
  `.trim();
}

// ====== sendMessage ======
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

    const sentId = resp.data?.id || resp.data?.messageId;
    if (sentId) {
      const session = ensureSession(to);
      markSeen(session, sentId);
    }

    return resp.data;
  } catch (err) {
    console.error("❌ sendMessage error:", err?.response?.data || err.message);
  }
}

// ====== getAIResponse ======
async function getAIResponse(userMessage, phone) {
  const session = ensureSession(phone);
  session.conversation.push({ role: "user", content: userMessage });

  const system = buildSystemPrompt(phone);
  const recent = session.conversation.slice(-7);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, ...recent],
      temperature: 0.7,
      max_tokens: 800,
    });

    const reply = completion.choices[0].message.content.trim();
    session.conversation.push({ role: "assistant", content: reply });
    return reply;
  } catch (err) {
    console.error("❌ OpenAI error:", err?.response?.data || err.message);
    return "Извините, возникла ошибка. Попробуйте позже.";
  }
}

// ====== Webhook ======
app.post("/webhook-whatsapp", async (req, res) => {
  const data = req.body;

  // Проверяем, что есть сообщение
  if (!data || !data.message) {
    console.log("📨 Webhook ping received");
    return res.sendStatus(200);
  }

  const from = data.message.from;
  const text = data.message.body?.trim();
  const isFromMe = data.message.fromMe; // ⚠️ UltraMsg присылает это поле

  // 🚫 Игнорируем сообщения, отправленные самим ботом
  if (isFromMe) {
    console.log("⏩ Игнорируем сообщение, отправленное ботом");
    return res.sendStatus(200);
  }

  console.log("📩 Получено сообщение от пользователя:", from, text);

  try {
    // Получаем ответ от AI
    const reply = await getAIResponse(text, from);
    console.log("🤖 Ответ AI:", reply);

    // Отправляем ответ пользователю
    await sendMessage(from, reply);
    console.log("✅ Ответ отправлен пользователю");

  } catch (err) {
    console.error("❌ Ошибка при обработке сообщения:", err);
  }

  res.sendStatus(200);
});

// ====== Health check ======
app.get("/", (req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ====== Запуск сервера ======
app.listen(PORT, () => {
  console.log(`✅ WhatsApp Bot running on port ${PORT}`);
  console.log(`ℹ️ Health check: http://localhost:${PORT}/`);
});