import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";

// ⚙️ Express app
const app = express();
app.use(bodyParser.json());

// ====== CONFIG ======
const PORT = process.env.PORT || 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ULTRAMSG_INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN;
const OPERATOR_PHONE = process.env.OPERATOR_PHONE;
const KASPI_API_KEY = process.env.KASPI_API_KEY;
const KASPI_MERCHANT_ID = process.env.KASPI_MERCHANT_ID;

// Проверка обязательных ключей
if (!OPENAI_API_KEY || !ULTRAMSG_INSTANCE_ID || !ULTRAMSG_TOKEN) {
  console.error("❌ Missing required env vars. Check Render environment settings.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ====== In-memory sessions ======
const sessions = {}; // { phone: { cart: [], address: "", orderId, total, conversation: [] } }

function ensureSession(phone) {
  if (!sessions[phone]) sessions[phone] = { cart: [], conversation: [] };
  return sessions[phone];
}

// ====== MENU ======
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

// ====== SYSTEM PROMPT ======
function buildSystemPrompt(phone) {
  const cart = sessions[phone]?.cart || [];
  const cartText =
    cart.length > 0
      ? cart
          .map(
            (i, idx) => `${idx + 1}. ${i.name} x${i.quantity} = ${i.price * i.quantity}₸`
          )
          .join("\n")
      : "🛒 Корзина пуста / Себет бос / Cart is empty.";

  const menuText = Object.entries(menu)
    .map(([k, v]) => `- ${k}: ${v}₸`)
    .join("\n");

  return `
Ты — оператор кафе "Ali Doner Aktau" 🍔🌯.  
Говори на языке клиента (қазақша / по-русски / English).  
Будь вежлив, пиши коротко, дружелюбно и с эмодзи.  

📋 Твоя задача:
— показать меню по запросу ("меню", "menu", "тағамдар")
— добавить блюда в корзину
— уточнить количество
— предложить оформить заказ
— запросить адрес и оплату
— создать оплату через Kaspi
— после успешной оплаты выдать чек клиенту и оператору (${OPERATOR_PHONE})

🚚 Доставка: ${deliveryPrice}₸

🧾 Текущий заказ:
${cartText}

МЕНЮ:
${menuText}
`;
}

// ====== sendMessage ======
async function sendMessage(to, text) {
  try {
    const cleanTo = to.replace("@c.us", "");
    const payload = new URLSearchParams({
      token: ULTRAMSG_TOKEN,
      to: cleanTo,
      body: text,
    }).toString();

    const resp = await axios.post(
      `https://api.ultramsg.com/${ULTRAMSG_INSTANCE_ID}/messages/chat`,
      payload,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
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
      max_tokens: 700,
    });

    const reply = completion.choices[0].message.content.trim();
    session.conversation.push({ role: "assistant", content: reply });
    return reply;
  } catch (err) {
    console.error("❌ OpenAI error:", err?.response?.data || err.message);
    return "Извините, произошла ошибка.";
  }
}

// ====== Kaspi Payment ======
async function createKaspiPayment(amount, orderId) {
  try {
    const resp = await axios.post(
      "https://api.kaspi.kz/payments/v2/orders",
      {
        amount,
        currency: "KZT",
        description: `Оплата заказа №${orderId}`,
        merchantId: KASPI_MERCHANT_ID,
        callbackUrl: "https://whatsapp-bot-opz3.onrender.com/kaspi-webhook",
      },
      {
        headers: { Authorization: `Bearer ${KASPI_API_KEY}` },
      }
    );
    return resp.data.paymentUrl; // URL для оплаты
  } catch (err) {
    console.error("❌ Kaspi API error:", err?.response?.data || err.message);
    return null;
  }
}

// ====== Kaspi webhook ======
app.post("/kaspi-webhook", async (req, res) => {
  const { orderId, status, amount } = req.body;
  console.log("💰 Kaspi webhook:", req.body);

  if (status === "SUCCESS") {
    const session = Object.values(sessions).find((s) => s.orderId === orderId);
    if (session) {
      const receipt = `
✅ Оплата получена: ${amount}₸
🧾 Заказ:
${session.cart.map((i) => `${i.name} x${i.quantity}`).join("\n")}
🚚 Доставка: ${deliveryPrice}₸
🏠 Адрес: ${session.address}
💳 Итого: ${session.total}₸
      `.trim();

      await sendMessage(session.phone, `Рақмет 🙏 Спасибо за оплату!\n${receipt}`);
      await sendMessage(OPERATOR_PHONE, `📦 Новый оплаченный заказ:\n${receipt}`);
    }
  }
  res.sendStatus(200);
});

// ====== Webhook WhatsApp ======
app.post("/webhook-whatsapp", async (req, res) => {
  const data = req.body?.data;
  if (!data) return res.sendStatus(200);

  const msg = data.body?.trim();
  const from = data.from;
  const lower = msg.toLowerCase();

  if (data.fromMe || !msg) return res.sendStatus(200);

  const session = ensureSession(from);

  // 💳 Если клиент хочет оплатить
  if (lower.includes("оплат") || lower.includes("kaspi")) {
    const total =
      (session.cart?.reduce((s, i) => s + i.price * i.quantity, 0) || 0) + deliveryPrice;
    if (total === 0) {
      await sendMessage(from, "🛒 Ваша корзина пуста.");
      return res.sendStatus(200);
    }

    const orderId = uuidv4();
    session.orderId = orderId;
    session.total = total;

    const link = await createKaspiPayment(total, orderId);
    if (link) {
      await sendMessage(
        from,
        `💳 Для оплаты перейдите по ссылке:\n${link}\n\nПосле оплаты бот подтвердит автоматически ✅`
      );
    } else {
      await sendMessage(from, "❌ Не удалось создать ссылку Kaspi.");
    }
    return res.sendStatus(200);
  }

  // 🤖 AI обработка
  const reply = await getAIResponse(msg, from);
  await sendMessage(from, reply);
  res.sendStatus(200);
});

// ====== Health Check ======
app.get("/", (req, res) => res.json({ status: "ok" }));

// ====== START SERVER ======
app.listen(PORT, () => {
  console.log(`✅ WhatsApp Bot running on port ${PORT}`);
});
