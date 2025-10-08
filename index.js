// index.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ULTRAMSG_INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN;
const OPERATOR_PHONE = process.env.OPERATOR_PHONE;
const deliveryPrice = 700;

const requiredEnvVars = [
  "OPENAI_API_KEY",
  "ULTRAMSG_INSTANCE_ID",
  "ULTRAMSG_TOKEN",
  "OPERATOR_PHONE",
];

const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingVars.length) {
  console.error(`❌ Missing env vars: ${missingVars.join(", ")}`);
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const sessions = {};

// Меню
const menu = {
  "Doner Classic 30 см": 1790,
  "Doner Classic 40 см": 1990,
  "Doner Beef 30 см": 2090,
  "Doner Beef 40 см": 2290,
  "Panini Classic": 1890,
  "Panini Beef": 2190,
  "HOT-DOG": 890,
  "BIG HOT-DOG": 1090,
  "Фри": 890,
  "Наггетсы": 990,
  "Coca Cola 0.5L": 590,
  "Coca Cola 1L": 890,
  "Fuse Tea 0.5L": 690,
};

function ensureSession(phone) {
  if (!sessions[phone]) {
    sessions[phone] = {
      cart: [],
      address: "",
      awaitingAddress: false,
      awaitingPayment: false,
    };
  }
  return sessions[phone];
}

// Форматирование чека
function formatReceipt(cart, address, deliveryPrice) {
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const total = cartTotal + deliveryPrice;
  const list = cart
    .map((i, n) => `${n + 1}. ${i.name} x${i.quantity} = ${i.price * i.quantity}₸`)
    .join("\n");
  return `🧾 *ВАШ ЗАКАЗ:*\n\n${list}\n\n🚚 Доставка: ${deliveryPrice}₸\n💰 *Итого: ${total}₸*\n🏠 Адрес: ${address}`;
}

// Отправка сообщений
async function sendMessage(to, text) {
  try {
    const payload = new URLSearchParams({
      token: ULTRAMSG_TOKEN,
      to: to.replace(/[^0-9]/g, ""),
      body: text,
    });
    await axios.post(
      `https://api.ultramsg.com/${ULTRAMSG_INSTANCE_ID}/messages/chat`,
      payload,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    console.log(`✅ Sent to ${to}: ${text.slice(0, 40)}...`);
  } catch (e) {
    console.error("❌ sendMessage error:", e.response?.data || e.message);
  }
}

// Поиск блюда
function parseOrder(msg) {
  const items = [];
  const clean = msg.toLowerCase();
  for (const [name, price] of Object.entries(menu)) {
    if (clean.includes(name.toLowerCase())) {
      const qtyMatch = msg.match(/(\d+)\s*шт/i);
      const quantity = qtyMatch ? parseInt(qtyMatch[1]) : 1;
      items.push({ name, price, quantity });
    }
  }
  return items;
}

// Ответ ИИ
async function getAIResponse(msg, phone) {
  const session = ensureSession(phone);
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Ты помощник кафе Ali Doner Aktau.
Отвечай дружелюбно и коротко. Не добавляй блюда — это делает система.
Если клиент закончил заказ, спроси адрес и способ оплаты (наличные или Kaspi, просто как текст).`,
      },
      { role: "user", content: msg },
    ],
  });
  return completion.choices[0].message.content.trim();
}

// Основной webhook
app.post("/webhook-whatsapp", async (req, res) => {
  try {
    const msg = req.body?.data?.body?.trim();
    const from = req.body?.data?.from;
    if (!msg || !from) return res.sendStatus(200);
    const session = ensureSession(from);
    const lower = msg.toLowerCase();

    // Игнорировать сообщения, отправленные ботом
if (req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from === process.env.WHATSAPP_NUMBER) {
  return res.sendStatus(200);
}


    console.log(`📩 ${from}: ${msg}`);

    // Очистка корзины
    if (lower === "очистить") {
      session.cart = [];
      await sendMessage(from, "🧺 Корзина очищена. Что добавим?");
      return res.sendStatus(200);
    }

    // Парсинг заказа
    const found = parseOrder(msg);
    if (found.length > 0) {
      for (const item of found) {
        const exist = session.cart.find((i) => i.name === item.name);
        if (exist) exist.quantity += item.quantity;
        else session.cart.push(item);
      }
      const total = session.cart.reduce((s, i) => s + i.price * i.quantity, 0);
      await sendMessage(
        from,
        `✅ Добавлено в корзину.\n💰 Сумма: ${total}₸\nХотите что-то еще или оформляем заказ?`
      );
      return res.sendStatus(200);
    }

    // Адрес
    if (session.awaitingAddress) {
      session.address = msg;
      session.awaitingAddress = false;
      const receipt = formatReceipt(session.cart, msg, deliveryPrice);
      await sendMessage(from, `${receipt}\n\n✅ *Заказ принят!* ⏰ Доставка 25–35 мин.`);
      await sendMessage(OPERATOR_PHONE, `📦 *НОВЫЙ ЗАКАЗ*\nОт: ${from}\n\n${receipt}`);
      session.cart = [];
      return res.sendStatus(200);
    }

    // Оформление заказа
    if (
      lower.includes("оформ") ||
      lower.includes("готов") ||
      lower.includes("всё") ||
      lower.includes("нет")
    ) {
      if (session.cart.length === 0) {
        await sendMessage(from, "🛒 Ваша корзина пуста.");
      } else {
        session.awaitingAddress = true;
        await sendMessage(from, "📍 Укажите адрес доставки:");
      }
      return res.sendStatus(200);
    }

    // Ответ от ИИ
    const reply = await getAIResponse(msg, from);
    await sendMessage(from, reply);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error:", err);
    res.sendStatus(500);
  }
});

app.get("/status", (req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

app.listen(PORT, () => console.log(`✅ Bot running on port ${PORT}`));
