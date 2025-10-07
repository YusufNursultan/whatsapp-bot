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

// Валидация env переменных
const requiredEnvVars = [
  'OPENAI_API_KEY', 
  'ULTRAMSG_INSTANCE_ID', 
  'ULTRAMSG_TOKEN', 
  'OPERATOR_PHONE'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error(`❌ Missing required env vars: ${missingVars.join(', ')}`);
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const sessions = {};

// Полное меню
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

function ensureSession(phone) {
  if (!sessions[phone]) {
    sessions[phone] = { 
      cart: [], 
      conversation: [], 
      address: "", 
      paymentMethod: "",
      orderId: "",
      total: 0
    };
  }
  return sessions[phone];
}

// Системный промт
function buildSystemPrompt(phone) {
  const session = sessions[phone];
  const cartText = session.cart.length
    ? session.cart.map((item, idx) => 
        `${idx + 1}. ${item.name} x${item.quantity} = ${item.price * item.quantity}₸`
      ).join("\n")
    : "🛒 *Корзина пуста*";

  const menuText = Object.entries(menu)
    .map(([name, price]) => `- ${name}: ${price}₸`)
    .join("\n");

  return `
Ты — профессиональный оператор Ali Doner Aktau 🍔🌯.  
Говори на языке клиента (қазақша / по-русски / English), дружелюбно, кратко.

📋 Твоя задача:
— показывать меню при запросе
— добавлять блюда в корзину по названию из меню
— уточнять количество
— запрашивать адрес доставки
— предлагать выбор оплаты (Kaspi или наличными)
— не придумывать цены - используй только из меню

📱 МЕНЮ:
${menuText}

🛒 ТЕКУЩАЯ КОРЗИНА:
${cartText}

💰 ДОСТАВКА: ${deliveryPrice}₸

Важные правила:
1. Цены только из меню
2. При завершении заказа напомни про оплату и доставку
3. Будь вежливым и профессиональным
4. НЕ говори "заказ принят" или "заказ оформлен" пока не сформирован финальный чек с Kaspi ссылкой
5. После выбора оплаты Kaspi - переходи к финальному оформлению заказа
6. Корзина очищается только после отправки Kaspi ссылки
7. Ты должен проверить чек после оплаты6 
`;
}

// Отправка сообщений
async function sendMessage(to, text) {
  try {
    let cleanTo = to.replace("@c.us", "");
    if (cleanTo.length === 10) {
      cleanTo = `7${cleanTo}`;
    } else if (cleanTo.length === 11 && cleanTo.startsWith('8')) {
      cleanTo = `7${cleanTo.slice(1)}`;
    }
    
    const payload = new URLSearchParams({
      token: ULTRAMSG_TOKEN,
      to: cleanTo,
      body: text
    }).toString();
    
    const response = await axios.post(
      `https://api.ultramsg.com/${ULTRAMSG_INSTANCE_ID}/messages/chat`,
      payload,
      { 
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000
      }
    );
    
    console.log(`✅ Message sent to ${cleanTo}`);
    return response.data;
  } catch (err) {
    console.error("❌ sendMessage error:", err.response?.data || err.message);
    throw err;
  }
}

// AI ответ
async function getAIResponse(msg, phone) {
  const session = ensureSession(phone);
  
  session.conversation.push({ role: "user", content: msg });
  if (session.conversation.length > 20) {
    session.conversation = session.conversation.slice(-10);
  }
  
  const systemPrompt = buildSystemPrompt(phone);
  const recentMessages = session.conversation.slice(-6);
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt }, 
        ...recentMessages
      ],
      temperature: 0.7,
      max_tokens: 500,
    });
    
    const reply = completion.choices[0].message.content.trim();
    session.conversation.push({ role: "assistant", content: reply });
    return reply;
  } catch (err) {
    console.error("❌ OpenAI error:", err.response?.data || err.message);
    return "Извините, произошла ошибка. Пожалуйста, попробуйте еще раз.";
  }
}

// Обработка команды очистки корзины
function handleClearCart(phone) {
  const session = ensureSession(phone);
  session.cart = [];
  return "🛒 Корзина очищена. Что бы вы хотели заказать?";
}

// В начале файла остаются все импорты и конфиги без изменений

// ====== Новая функция проверки оплаты Kaspi ======
// Пока пример через имитацию API (заменить на реальный Kaspi webhook или API)
async function checkKaspiPayment(orderId) {
  // TODO: заменить на реальный запрос к Kaspi API
  // Пример ответа:
  // { status: "SUCCESS" | "PENDING" | "FAILED" }
  return "SUCCESS"; // для теста считаем, что оплата прошла
}

// ====== Webhook WhatsApp ======
app.post("/webhook-whatsapp", async (req, res) => {
  try {
    const data = req.body?.data;
    if (!data) return res.sendStatus(200);

    const msg = data.body?.trim();
    const from = data.from;

    if (data.fromMe || !msg) return res.sendStatus(200);

    const session = ensureSession(from);
    const lowerMsg = msg.toLowerCase();

    // Очистка корзины
    if (lowerMsg.includes("очистить корзину") || lowerMsg === "очистить") {
      const reply = handleClearCart(from);
      await sendMessage(from, reply);
      return res.sendStatus(200);
    }

    // Оплата
    if (lowerMsg.includes("оплат") || lowerMsg.includes("kaspi") ||
        lowerMsg.includes("наличн") || lowerMsg.includes("банк")) {

      session.paymentMethod = lowerMsg.includes("kaspi") ? "Kaspi" : "Наличные";

      const cartTotal = session.cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
      const total = Math.round(cartTotal + deliveryPrice);

      if (cartTotal === 0) {
        await sendMessage(from, "🛒 *Ваша корзина пуста*. Добавьте товары перед оформлением заказа.");
        return res.sendStatus(200);
      }

      if (!session.address) {
        await sendMessage(from, "📝 Пожалуйста, укажите адрес доставки:");
        return res.sendStatus(200);
      }

      const orderId = uuidv4().slice(0, 8);
      session.orderId = orderId;
      session.total = total;

      let receipt = formatReceipt(session.cart, session.address, cartTotal, deliveryPrice);

      if (session.paymentMethod === "Kaspi") {
        const paymentLink = createKaspiPaymentLink(total);

        await sendMessage(from, receipt);

        const paymentMessage = `
💳 *ОПЛАТА KASPI*

💰 Сумма: *${total}₸*
🔗 Ссылка для оплаты: *${paymentLink}*

*Инструкция:*
1. Нажмите на ссылку выше
2. Подтвердите оплату в Kaspi приложении
3. Ожидайте доставку 25-35 минут

📞 *Номер заказа:* #${orderId}
`;
        await sendMessage(from, paymentMessage);

        // Проверка оплаты (имитация)
        const paymentStatus = await checkKaspiPayment(orderId);
        if (paymentStatus === "SUCCESS") {
          const paidReceipt = `✅ *Оплата получена!*  
🧾 Заказ:
${session.cart.map(i => `${i.name} x${i.quantity}`).join("\n")}
🚚 Доставка: ${deliveryPrice}₸
💳 Итого: *${total}₸*
🏠 Адрес: ${session.address}`;

          await sendMessage(from, paidReceipt);
          await sendMessage(OPERATOR_PHONE, `📦 *НОВЫЙ ОПЛАЧЕННЫЙ ЗАКАЗ #${orderId}*\n${paidReceipt}`);
        }

      } else { // Наличные
        receipt += `\n\n💵 *Оплата наличными при получении*`;
        receipt += `\n📞 *Номер заказа:* #${orderId}`;
        receipt += `\n⏰ *Время приготовления:* 25-35 минут`;
        await sendMessage(from, receipt);
      }

      const operatorMessage = `📦 *НОВЫЙ ЗАКАЗ #${orderId}*\nОт: ${from}\n${receipt}\nОплата: ${session.paymentMethod}`;
      await sendMessage(OPERATOR_PHONE, operatorMessage);

      session.cart = [];
      return res.sendStatus(200);
    }

    // Обработка адреса
    if (lowerMsg.includes("адрес") || session.conversation.some(m => 
        m.content.includes("адрес") && m.role === "assistant")) {
      session.address = msg;
    }

    // AI ответ
    const reply = await getAIResponse(msg, from);
    await sendMessage(from, reply);

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.status(500).send("Internal Server Error");
  }
});


app.get("/status", (req, res) => {
  res.json({ 
    status: "ok", 
    sessions: Object.keys(sessions).length,
    timestamp: new Date().toISOString()
  });
});

app.get("/sessions", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Not available in production" });
  }
  res.json(sessions);
});

app.listen(PORT, () => {
  console.log(`✅ WhatsApp Bot running on port ${PORT}`);
  console.log(`📞 Operator phone: ${OPERATOR_PHONE}`);
  console.log(`🛍️  Menu items: ${Object.keys(menu).length}`);
});