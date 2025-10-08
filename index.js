import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { formatReceipt } from "./kaspi-link.js";

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
if (missingVars.length > 0) {
  console.error(`❌ Missing required env vars: ${missingVars.join(", ")}`);
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
      total: 0,
      paymentConfirmed: false,
    };
  }
  return sessions[phone];
}

// ==== AI ====
async function getAIResponse(msg, phone) {
  const session = ensureSession(phone);
  session.conversation.push({ role: "user", content: msg });
  if (session.conversation.length > 20)
    session.conversation = session.conversation.slice(-10);

  const cartText = session.cart.length
    ? session.cart
        .map(
          (item, i) =>
            `${i + 1}. ${item.name} x${item.quantity} = ${
              item.price * item.quantity
            }₸`
        )
        .join("\n")
    : "Корзина пуста.";

  const systemPrompt = `
Ты — профессиональный оператор кафе Ali Doner Aktau 🌯🍔. 
Говори вежливо, без приветствий.  
Действуй строго по шагам:
1. Добавь товары из меню, если клиент пишет название блюда.
2. Когда корзина готова — спроси адрес доставки.
3. После адреса спроси способ оплаты: Kaspi, наличными или другим банком.
4. Если Kaspi — выдай *только ссылку Kaspi*, без суммы.  
5. Если наличными — просто пришли чек.  
6. Если клиент пишет "Оплатил", подтверди оплату.

📋 Меню:
${Object.entries(menu)
  .map(([n, p]) => `- ${n}: ${p}₸`)
  .join("\n")}
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }, ...session.conversation],
      temperature: 0.7,
      max_tokens: 400,
    });

    const reply = completion.choices[0].message.content.trim();
    session.conversation.push({ role: "assistant", content: reply });
    return reply;
  } catch (err) {
    console.error("❌ OpenAI error:", err.message);
    return "Извините, произошла ошибка. Попробуйте ещё раз.";
  }
}

// ==== Отправка сообщений ====
async function sendMessage(to, text) {
  try {
    let cleanTo = to.replace("@c.us", "");
    if (cleanTo.length === 10) cleanTo = `7${cleanTo}`;
    if (cleanTo.length === 11 && cleanTo.startsWith("8"))
      cleanTo = `7${cleanTo.slice(1)}`;

    const payload = new URLSearchParams({
      token: ULTRAMSG_TOKEN,
      to: cleanTo,
      body: text,
    }).toString();

    await axios.post(
      `https://api.ultramsg.com/${ULTRAMSG_INSTANCE_ID}/messages/chat`,
      payload,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    console.log(`✅ Sent to ${cleanTo}`);
  } catch (err) {
    console.error("❌ sendMessage error:", err.response?.data || err.message);
  }
}

// ==== Webhook ====
app.post("/webhook-whatsapp", async (req, res) => {
  try {
    const data = req.body?.data;
    if (!data) return res.sendStatus(200);

    const msg = data.body?.trim();
    const from = data.from;
    if (!msg || data.fromMe) return res.sendStatus(200);

    const session = ensureSession(from);
    const lowerMsg = msg.toLowerCase();

    // Очистить корзину
    if (lowerMsg.includes("очистить")) {
      session.cart = [];
      await sendMessage(from, "🧺 Корзина очищена. Можете начать заново.");
      return res.sendStatus(200);
    }

    // Подтверждение оплаты
    if (lowerMsg.includes("оплатил") || lowerMsg.includes("оплатилa")) {
      if (!session.orderId) {
        await sendMessage(from, "Не найден активный заказ для подтверждения оплаты.");
        return res.sendStatus(200);
      }

      session.paymentConfirmed = true;
      await sendMessage(
        from,
        `✅ *Оплата подтверждена!*  
Спасибо! Ваш заказ #${session.orderId} принят в работу.  
⏰ Доставка 25–35 минут.`
      );
      await sendMessage(
        OPERATOR_PHONE,
        `💰 *ПОДТВЕРЖДЕНА ОПЛАТА*  
Заказ #${session.orderId}\nАдрес: ${session.address}`
      );
      return res.sendStatus(200);
    }

    // Обработка выбора оплаты
    if (
      lowerMsg.includes("kaspi") ||
      lowerMsg.includes("оплат") ||
      lowerMsg.includes("налич") ||
      lowerMsg.includes("банк")
    ) {
      const cartTotal = session.cart.reduce(
        (s, i) => s + i.price * i.quantity,
        0
      );

      if (cartTotal === 0) {
        await sendMessage(
          from,
          "🛒 *Корзина пуста.* Добавьте товары перед оформлением."
        );
        return res.sendStatus(200);
      }

      if (!session.address) {
        await sendMessage(from, "📍 Пожалуйста, укажите адрес доставки:");
        return res.sendStatus(200);
      }

      const orderId = uuidv4().slice(0, 8);
      session.orderId = orderId;
      session.total = cartTotal + deliveryPrice;

      const receipt = formatReceipt(
        session.cart,
        session.address,
        cartTotal,
        deliveryPrice
      );

      if (lowerMsg.includes("kaspi")) {
        session.paymentMethod = "Kaspi";
        const kaspiLink = "pay.kaspi.kz/pay/3ofujmgr";

        await sendMessage(from, receipt);
        await sendMessage(
          from,
          `
💳 *Kaspi Оплата*  
🔗 Ссылка: ${kaspiLink}

Пожалуйста, оплатите *точную сумму из чека*  
и напишите "Оплатил" после перевода.  

📞 *Номер заказа:* #${orderId}
`
        );

        await sendMessage(
          OPERATOR_PHONE,
          `📦 *НОВЫЙ ЗАКАЗ #${orderId}*  
Оплата: Kaspi  
${receipt}`
        );
        return res.sendStatus(200);
      }

      // --- Наличка / другие банки ---
      session.paymentMethod = lowerMsg.includes("банк")
        ? "Другой банк"
        : "Наличные";

      await sendMessage(
        from,
        `${receipt}\n\n💵 *Оплата: ${session.paymentMethod}*\n📞 *Номер заказа:* #${orderId}\n⏰ Ожидайте доставку 25–35 минут.`
      );

      await sendMessage(
        OPERATOR_PHONE,
        `📦 *НОВЫЙ ЗАКАЗ #${orderId}*  
Оплата: ${session.paymentMethod}\n${receipt}`
      );
      return res.sendStatus(200);
    }

    // Сохраняем адрес
    if (lowerMsg.includes("ул") || lowerMsg.includes("дом") || lowerMsg.includes("адрес")) {
      session.address = msg;
      await sendMessage(from, `📍 Адрес доставки сохранён: ${msg}`);
      return res.sendStatus(200);
    }

    // AI ответ
    const reply = await getAIResponse(msg, from);
    await sendMessage(from, reply);
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.status(500).send("Internal Error");
  }
});

app.get("/status", (req, res) =>
  res.json({ status: "ok", sessions: Object.keys(sessions).length })
);

app.listen(PORT, () => {
  console.log(`✅ WhatsApp Bot running on port ${PORT}`);
});
