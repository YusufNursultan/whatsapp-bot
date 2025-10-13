import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import 'dotenv/config';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const ULTRAMSG_INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPERATOR_NUMBER = process.env.OPERATOR_NUMBER;

// 🧠 Храним состояние пользователей
const sessions = {};
const userStages = {};
const userOrders = {};
const userAddresses = {};
const userPhones = {};
const userTotals = {};

// 🍔 Меню
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

// 📩 Отправка сообщений
async function sendMessage(to, body) {
  try {
    await axios.post(`https://api.ultramsg.com/${ULTRAMSG_INSTANCE_ID}/messages/chat`, {
      token: ULTRAMSG_TOKEN,
      to,
      body,
    });
  } catch (e) {
    console.error("Ошибка отправки:", e.response?.data || e.message);
  }
}

// 💳 Кнопки оплаты
async function sendPaymentButtons(to, total) {
  const message = `
💰 Төлем түрін таңдаңыз:
1️⃣ Kaspi (${total}₸)
2️⃣ Наличные
3️⃣ Halyk
`;
  await sendMessage(to, message);
}

// 💳 Ссылки оплаты
const PAYMENT_LINKS = {
  Kaspi: "https://pay.kaspi.kz/pay/3ofujmgr",
  Halyk: "https://halykbank.kz/pay/your_shop_id",
};

// 🚀 Основной вебхук
app.post("/webhook", async (req, res) => {
  const data = req.body?.data;
  if (!data || !data.from || !data.body) return res.sendStatus(200);

  const from = data.from;
  const text = data.body.trim();
  const isFromMe = data.fromMe;

  if (isFromMe) return res.sendStatus(200);

  console.log(`📩 ${from}: ${text}`);

  // Инициализация
  if (!userStages[from]) userStages[from] = "start";

  // === ЭТАПЫ ===

  // 1️⃣ Начало
  if (userStages[from] === "start") {
    await sendMessage(from, "Сәлеметсіз бе! Бұл - Ali Doner Ақтау 🍔\nТапсырысыңызды жазыңыз:");
    userStages[from] = "ordering";
    userOrders[from] = [];
    return res.sendStatus(200);
  }

  // 2️⃣ Принимаем заказы
  if (userStages[from] === "ordering") {
    const found = Object.keys(menu).find(item => text.toLowerCase().includes(item.toLowerCase().split(" ")[0]));
    if (found) {
      userOrders[from].push({ name: found, qty: 1 });
      await sendMessage(from, `Сіз "${found}" таңдадыңыз. Қанша дана?`);
      userStages[from] = "waiting_qty";
      return res.sendStatus(200);
    } else {
      await sendMessage(from, "Менюдан таңдаңыз (мысалы: Doner Classic 30 см).");
      return res.sendStatus(200);
    }
  }

  // 3️⃣ Количество
  if (userStages[from] === "waiting_qty") {
    const qty = parseInt(text);
    if (isNaN(qty) || qty <= 0) {
      await sendMessage(from, "Қанша дана екенін жазыңыз (мысалы: 2)");
      return res.sendStatus(200);
    }
    userOrders[from][userOrders[from].length - 1].qty = qty;
    await sendMessage(from, "Жеткізу мекенжайын жазыңыз (мысалы: 12мкр 47үй 72пәтер)");
    userStages[from] = "waiting_address";
    return res.sendStatus(200);
  }

  // 4️⃣ Адрес
  if (userStages[from] === "waiting_address") {
    if (!/\d/.test(text)) {
      await sendMessage(from, "Мекенжай түсініксіз. Қайта жазыңыз (мысалы: 12мкр 47үй 72пәтер)");
      return res.sendStatus(200);
    }
    userAddresses[from] = text;
    await sendMessage(from, "Телефон нөміріңізді жазыңыз (мысалы: 87771234567)");
    userStages[from] = "waiting_phone";
    return res.sendStatus(200);
  }

  // 5️⃣ Телефон
  if (userStages[from] === "waiting_phone") {
    if (!/^\d{11}$/.test(text)) {
      await sendMessage(from, "Телефон нөмірі қате. Мысалы: 87771234567");
      return res.sendStatus(200);
    }
    userPhones[from] = text;

    // Формируем чек
    const order = userOrders[from];
    const total = order.reduce((sum, i) => sum + (menu[i.name] || 0) * i.qty, 0);
    userTotals[from] = total;

    const receipt = `
✅ Тапсырысыңыз:
${order.map(i => `- ${i.name} ×${i.qty} — ${(menu[i.name] || 0) * i.qty}₸`).join("\n")}
Жалпы: ${total}₸  
Мекенжай: ${userAddresses[from]}  
Телефон: ${userPhones[from]}  
Болжаған жеткізу уақыты: 35 минут  
`;

    await sendMessage(from, receipt);
    await sendPaymentButtons(from, total);
    userStages[from] = "waiting_payment";
    return res.sendStatus(200);
  }

  // 6️⃣ Оплата
  if (userStages[from] === "waiting_payment") {
    if (/kaspi/i.test(text)) {
      await sendMessage(from, `Kaspi арқылы төлеу үшін төмендегі сілтемені басыңыз:\n${PAYMENT_LINKS.Kaspi}`);
      await sendMessage(from, "Тапсырысыңыз қабылданды! Рақмет ❤️");
      await sendMessage(OPERATOR_NUMBER, `📋 Kaspi төлемі арқылы жаңа тапсырыс:\n${JSON.stringify(userOrders[from], null, 2)}\nМекенжай: ${userAddresses[from]}\nТелефон: ${userPhones[from]}\nЖалпы: ${userTotals[from]}₸`);
      userStages[from] = "done";
      return res.sendStatus(200);
    }

    if (/halyk/i.test(text)) {
      await sendMessage(from, `Halyk арқылы төлеу үшін төмендегі сілтемені басыңыз:\n${PAYMENT_LINKS.Halyk}`);
      await sendMessage(from, "Тапсырысыңыз қабылданды! Рақмет ❤️");
      await sendMessage(OPERATOR_NUMBER, `📋 Halyk төлемі арқылы жаңа тапсырыс:\n${JSON.stringify(userOrders[from], null, 2)}\nМекенжай: ${userAddresses[from]}\nТелефон: ${userPhones[from]}\nЖалпы: ${userTotals[from]}₸`);
      userStages[from] = "done";
      return res.sendStatus(200);
    }

    if (/нал/i.test(text) || /қолма/i.test(text)) {
      await sendMessage(from, "✅ Наличныемен төлем қабылданды. Тапсырысыңыз өңдеуде ❤️");
      await sendMessage(OPERATOR_NUMBER, `📋 Новый заказ (наличные):\n${JSON.stringify(userOrders[from], null, 2)}\nМекенжай: ${userAddresses[from]}\nТелефон: ${userPhones[from]}\nЖалпы: ${userTotals[from]}₸`);
      userStages[from] = "done";
      return res.sendStatus(200);
    }

    await sendMessage(from, "Төлем түрін таңдаңыз: Kaspi / Наличные / Halyk");
    return res.sendStatus(200);
  }

  // 7️⃣ Новый заказ после завершения
  if (userStages[from] === "done") {
    userStages[from] = "start";
    await sendMessage(from, "Жаңа тапсырыс бере аласыз 😊");
    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

// 🌐 Проверка
app.get("/", (req, res) => res.send("🤖 Ali Doner бот работает!"));

app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
