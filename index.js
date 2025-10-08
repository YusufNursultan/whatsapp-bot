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
const KASPI_PHONE = process.env.KASPI_PHONE || "77777777777"; // Номер Kaspi для переводов
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
      total: 0,
      awaitingAddress: false
    };
  }
  return sessions[phone];
}

// Функция для создания Kaspi ссылки
function createKaspiPaymentLink(amount, orderId) {
  // Kaspi deeplink формат для переводов
  return `https://kaspi.kz/pay/${KASPI_PHONE}?amount=${amount}&comment=Заказ_${orderId}`;
}

// Форматирование чека
function formatReceipt(cart, address, cartTotal, delivery) {
  let receipt = "🧾 *ВАШ ЗАКАЗ:*\n\n";
  cart.forEach((item, idx) => {
    receipt += `${idx + 1}. ${item.name} x${item.quantity} = ${item.price * item.quantity}₸\n`;
  });
  receipt += `\n🚚 Доставка: ${delivery}₸`;
  receipt += `\n💰 *ИТОГО: ${cartTotal + delivery}₸*`;
  receipt += `\n🏠 Адрес: ${address}`;
  return receipt;
}

// Системный промт для AI
function buildSystemPrompt(phone) {
  const session = sessions[phone];
  const cartText = session.cart.length
    ? session.cart.map((item, idx) => 
        `${idx + 1}. ${item.name} x${item.quantity} = ${item.price * item.quantity}₸`
      ).join("\n")
    : "Корзина пуста";

  const menuText = Object.entries(menu)
    .map(([name, price]) => `${name}: ${price}₸`)
    .join("\n");

  return `Ты — оператор кафе Ali Doner Aktau.
Говори кратко, дружелюбно, на языке клиента (русский/казахский/английский).

ВАЖНО: Ты ТОЛЬКО консультируешь клиента. Корзину заполняет система автоматически.

Твои задачи:
1. Показать меню если спрашивают
2. Помочь выбрать блюда
3. Ответить на вопросы о составе, размерах, времени доставки
4. НЕ говори "я добавил" - система добавит сама когда клиент напишет четко

Текущая корзина клиента:
${cartText}

Меню:
${menuText}

Стоимость доставки: ${deliveryPrice}₸

Когда клиент готов оформить, спроси адрес и способ оплаты (Kaspi или наличные).`;
}

// Парсинг заказа из сообщения клиента
function parseOrder(msg) {
  const items = [];
  const normalizedMsg = msg.toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .replace(/см/g, ' см')
    .replace(/cm/g, ' см')
    .trim();
  
  console.log(`🔍 Parsing: "${normalizedMsg}"`);
  
  // Ищем упоминания блюд из меню
  for (const [itemName, price] of Object.entries(menu)) {
    const normalizedItemName = itemName.toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Гибкий поиск: убираем пробелы для сравнения
    const msgNoSpaces = normalizedMsg.replace(/\s/g, '');
    const itemNoSpaces = normalizedItemName.replace(/\s/g, '');
    
    // Проверяем вхождение (без пробелов)
    if (msgNoSpaces.includes(itemNoSpaces) || normalizedMsg.includes(normalizedItemName)) {
      // Ищем количество
      const quantityPatterns = [
        /(\d+)\s*шт/i,
        /(\d+)\s*х/i,
        /х\s*(\d+)/i,
        /(\d+)\s+[а-яa-z]/i
      ];
      
      let quantity = 1;
      for (const pattern of quantityPatterns) {
        const match = msg.match(pattern);
        if (match) {
          quantity = parseInt(match[1]);
          break;
        }
      }
      
      console.log(`✅ Found: ${itemName} x${quantity}`);
      
      items.push({
        name: itemName,
        price: price,
        quantity: quantity
      });
      
      break; // Нашли блюдо, выходим из цикла
    }
  }
  
  return items;
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

    console.log(`📨 Message from ${from}: ${msg}`);

    // === КОМАНДА: Очистить корзину ===
    if (lowerMsg === "очистить" || lowerMsg === "очистить корзину") {
      session.cart = [];
      await sendMessage(from, "🛒 Корзина очищена. Что бы вы хотели заказать?");
      return res.sendStatus(200);
    }

    // === КОМАНДА: Показать корзину ===
    if (lowerMsg === "корзина" || lowerMsg === "моя корзина") {
      if (session.cart.length === 0) {
        await sendMessage(from, "🛒 Ваша корзина пуста");
      } else {
        const cartText = session.cart.map((item, idx) => 
          `${idx + 1}. ${item.name} x${item.quantity} = ${item.price * item.quantity}₸`
        ).join("\n");
        const total = session.cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
        await sendMessage(from, `🛒 *Ваша корзина:*\n\n${cartText}\n\n💰 Сумма: ${total}₸`);
      }
      return res.sendStatus(200);
    }

    // === ПАРСИНГ ЗАКАЗА (проверяем в любом случае, кроме команд) ===
    if (!lowerMsg.includes("оформ") && !lowerMsg.includes("готов") && 
        !lowerMsg.includes("меню") && !session.awaitingAddress) {
      
      const parsedItems = parseOrder(msg);
      if (parsedItems.length > 0) {
        parsedItems.forEach(item => {
          const existingItem = session.cart.find(i => i.name === item.name);
          if (existingItem) {
            existingItem.quantity += item.quantity;
          } else {
            session.cart.push(item);
          }
        });
        
        const cartText = session.cart.map((item, idx) => 
          `${idx + 1}. ${item.name} x${item.quantity}`
        ).join("\n");
        const total = session.cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
        
        await sendMessage(from, `✅ Добавлено в корзину!\n\n${cartText}\n\n💰 Сумма: ${total}₸\n\nХотите что-то еще или оформляем заказ?`);
        return res.sendStatus(200);
      }
    }

    // === ОФОРМЛЕНИЕ ЗАКАЗА ===
    if (lowerMsg.includes("оформ") || lowerMsg.includes("заказ") || 
        lowerMsg.includes("готов") || lowerMsg.includes("оплат")) {
      
      if (session.cart.length === 0) {
        await sendMessage(from, "🛒 Ваша корзина пуста. Добавьте товары перед оформлением заказа.");
        return res.sendStatus(200);
      }

      if (!session.address) {
        session.awaitingAddress = true;
        await sendMessage(from, "📍 Укажите адрес доставки:");
        return res.sendStatus(200);
      }

      // Спросить способ оплаты
      await sendMessage(from, "💳 Выберите способ оплаты:\n\n1️⃣ Kaspi перевод\n2️⃣ Наличными при получении\n\nНапишите: *Kaspi* или *Наличные*");
      return res.sendStatus(200);
    }

    // === СОХРАНЕНИЕ АДРЕСА ===
    if (session.awaitingAddress && !session.address) {
      session.address = msg;
      session.awaitingAddress = false;
      await sendMessage(from, `✅ Адрес сохранен: ${msg}\n\n💳 Выберите способ оплаты:\n\n1️⃣ Kaspi перевод\n2️⃣ Наличными при получении`);
      return res.sendStatus(200);
    }

    // === ОБРАБОТКА ОПЛАТЫ ===
    if (lowerMsg.includes("kaspi") || lowerMsg.includes("каспи")) {
      if (session.cart.length === 0) {
        await sendMessage(from, "🛒 Корзина пуста");
        return res.sendStatus(200);
      }
      if (!session.address) {
        await sendMessage(from, "📍 Сначала укажите адрес доставки");
        return res.sendStatus(200);
      }

      const cartTotal = session.cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
      const total = Math.round(cartTotal + deliveryPrice);
      const orderId = uuidv4().slice(0, 8);

      session.orderId = orderId;
      session.total = total;
      session.paymentMethod = "Kaspi";

      const receipt = formatReceipt(session.cart, session.address, cartTotal, deliveryPrice);
      const paymentLink = createKaspiPaymentLink(total, orderId);

      // Отправляем чек
      await sendMessage(from, receipt);

      // Отправляем инструкцию по оплате с РАБОЧЕЙ ссылкой
      const paymentMessage = `
💳 *ОПЛАТА ЧЕРЕЗ KASPI*

💰 Сумма к оплате: *${total}₸*
📱 Номер Kaspi: *${KASPI_PHONE}*
📝 Комментарий: *Заказ ${orderId}*

*ВАЖНО:* Откройте Kaspi приложение → Переводы → укажите номер выше → сумму ${total}₸ → в комментарии напишите: Заказ ${orderId}

Или нажмите ссылку: ${paymentLink}

⏰ После оплаты ваш заказ будет готов через 25-35 минут
📞 Номер заказа: *#${orderId}*`;

      await sendMessage(from, paymentMessage);

      // Уведомление оператору
      const operatorMsg = `📦 *НОВЫЙ ЗАКАЗ #${orderId}*\nОт: ${from}\nОплата: Kaspi\n\n${receipt}`;
      await sendMessage(OPERATOR_PHONE, operatorMsg);

      return res.sendStatus(200);
    }

    if (lowerMsg.includes("наличн") || lowerMsg.includes("налич")) {
      if (session.cart.length === 0) {
        await sendMessage(from, "🛒 Корзина пуста");
        return res.sendStatus(200);
      }
      if (!session.address) {
        await sendMessage(from, "📍 Сначала укажите адрес доставки");
        return res.sendStatus(200);
      }

      const cartTotal = session.cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
      const total = Math.round(cartTotal + deliveryPrice);
      const orderId = uuidv4().slice(0, 8);

      session.orderId = orderId;
      session.total = total;
      session.paymentMethod = "Наличные";

      const receipt = formatReceipt(session.cart, session.address, cartTotal, deliveryPrice);
      
      await sendMessage(from, `${receipt}\n\n💵 *Оплата наличными при получении*\n📞 Номер заказа: *#${orderId}*\n⏰ Время доставки: 25-35 минут`);

      // Уведомление оператору
      const operatorMsg = `📦 *НОВЫЙ ЗАКАЗ #${orderId}*\nОт: ${from}\nОплата: Наличные\n\n${receipt}`;
      await sendMessage(OPERATOR_PHONE, operatorMsg);

      return res.sendStatus(200);
    }

    // === AI КОНСУЛЬТАЦИЯ ===
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

app.listen(PORT, () => {
  console.log(`✅ WhatsApp Bot running on port ${PORT}`);
  console.log(`📞 Operator phone: ${OPERATOR_PHONE}`);
  console.log(`💳 Kaspi phone: ${KASPI_PHONE}`);
  console.log(`🛍️  Menu items: ${Object.keys(menu).length}`);
});