import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { createKaspiPaymentLink, formatReceipt } from "./kaspi-link.js";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 4000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ULTRAMSG_INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN;
const OPERATOR_PHONE = process.env.OPERATOR_PHONE;
const deliveryPrice = 700;

if (!OPENAI_API_KEY || !ULTRAMSG_INSTANCE_ID || !ULTRAMSG_TOKEN) {
  console.error("❌ Missing required env vars.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const sessions = {};

function ensureSession(phone) {
  if (!sessions[phone]) sessions[phone] = { cart: [], conversation: [], address: "", paymentMethod: "" };
  return sessions[phone];
}

// Меню
const menu = { /* ... твое меню ... */ };

// Системный промт
function buildSystemPrompt(phone) {
  const session = sessions[phone];
  const cartText = session.cart.length
    ? session.cart.map((i, idx) => `${idx + 1}. ${i.name} x${i.quantity} = ${i.price * i.quantity}₸`).join("\n")
    : "🛒 *Корзина пуста*";

  const menuText = Object.entries(menu).map(([k,v]) => `- ${k}: ${v}₸`).join("\n");

  return `
Ты — профессиональный оператор Ali Doner Aktau 🍔🌯.  
Говори на языке клиента (қазақша / по-русски / English), дружелюбно, кратко.

📋 Твоя задача:
— показать меню
— добавлять блюда в корзину
— уточнять количество
— запрашивать адрес и способ оплаты
— выдавать чек с жирными важными полями (сумма, доставка, оплата)
— при Kaspi отправлять ссылку
— отправлять копию чека оператору (${OPERATOR_PHONE})

🧾 Текущий заказ:
${cartText}

МЕНЮ:
${menuText}
`;
}

// Отправка сообщений
async function sendMessage(to, text) {
  try {
    const cleanTo = to.replace("@c.us", "");
    const payload = new URLSearchParams({ token: ULTRAMSG_TOKEN, to: cleanTo, body: text }).toString();
    const resp = await axios.post(`https://api.ultramsg.com/${ULTRAMSG_INSTANCE_ID}/messages/chat`, payload, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    return resp.data;
  } catch (err) {
    console.error("❌ sendMessage error:", err?.response?.data || err.message);
  }
}

// AI ответ
async function getAIResponse(msg, phone) {
  const session = ensureSession(phone);
  session.conversation.push({ role: "user", content: msg });
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

// Webhook WhatsApp
app.post("/webhook-whatsapp", async (req, res) => {
  const data = req.body?.data;
  if (!data) return res.sendStatus(200);

  const msg = data.body?.trim();
  const from = data.from;
  if (data.fromMe || !msg) return res.sendStatus(200);

  const session = ensureSession(from);

  // Оплата
  const lower = msg.toLowerCase();
  if (lower.includes("оплат") || lower.includes("kaspi") || lower.includes("наличн") || lower.includes("банк")) {
    session.paymentMethod = lower.includes("kaspi") ? "Kaspi" : "Other";

    const total = (session.cart.reduce((s,i)=>s+i.price*i.quantity,0)||0) + deliveryPrice;
    if (total === 0) {
      await sendMessage(from, "🛒 *Ваша корзина пуста*.");
      return res.sendStatus(200);
    }

    const orderId = uuidv4();
    session.orderId = orderId;
    session.total = total;

    let receipt = formatReceipt(session.cart, session.address, session.cart.reduce((s,i)=>s+i.price*i.quantity,0), deliveryPrice);

    if (session.paymentMethod === "Kaspi") {
      const paymentLink = createKaspiPaymentLink(total);
      receipt = receipt + `\n💳 *Оплатить Kaspi:* ${paymentLink}`;
    } else {
      receipt = receipt + `\n💳 *Оплата при получении / другой банк*`;
    }

    await sendMessage(from, receipt);
    await sendMessage(OPERATOR_PHONE, `📦 *Новый заказ от ${from}*\n${receipt}`);
    return res.sendStatus(200);
  }

  // AI обработка
  const reply = await getAIResponse(msg, from);
  await sendMessage(from, reply);
  res.sendStatus(200);
});

app.get("/", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`✅ WhatsApp Bot running on port ${PORT}`));
