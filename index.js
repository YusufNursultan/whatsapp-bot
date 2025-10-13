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

// 🧠 Контексты пользователей
const sessions = {};

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

const SYSTEM_PROMPT = `
Ты — умный ассистент фастфуда "Ali Doner Ақтау".
Ты общаешься на двух языках: қазақша 🇰🇿 және орысша 🇷🇺.
Определи язык клиента по первому сообщению и придерживайся его до конца диалога.

📋 Меню (только это, без выдумок):
${Object.entries(menu)
  .map(([name, price]) => `- ${name}: ${price}₸`)
  .join("\n")}

🎯 Твоя цель — принять заказ точно, вежливо и структурированно.

🧠 Алгоритм общения:
1. Если клиент приветствует — отвечай на том языке на каком языке написал клиент в формате:
  - Қазақша: "Сәлеметсізбе?! Бұл - Ali Doner Ақтау операторы. Қандай көмек көрсете аламын?" 
  - Русский: "Здравствуйте?! Это оператор - Ali Doner Ақтау. Как я могу вам помочь?"
2. Если клиент пишет блюдо (даже с ошибкой, например "донэр", "бургерр") — найди ближайшее совпадение из меню.
3. После выбора блюда спроси количество (например: "Қанша дана?" / "Сколько штук?").
4. После того как клиент закончил выбирать блюда — спроси адрес доставки в формате:
   — Қазақша: "Жеткізу мекенжайын жазыңыз (мысалы: 12мкр 47үй 72пәтер )"
   — Русский: "Введите адрес в формате: улица, дом, квартира (например: 12мкр 47дом 72кв )"
   Адрес должен содержать хотя бы одно число и слова вроде "үй", "дом", "мкр", "кв", "пәтер". Зона доставки с 1 по 40 микрорайоны, Толкын-1,2, и шыгыс 1,2,3. 
   Если формат не понятный — переспроси.
5. После получения корректного адреса спроси номер телефона:
   — Қазақша: "Телефон нөміріңізді жазыңыз (мысалы: 87771234567)"
   — Русский: "Напишите номер телефона (например: 87771234567)" 
   Если телефон номер не состоит из 11 цифр или 11 цифр то переспроси.
   
6. После того как адрес и телефон получены — сформируй чек:
   ---
   ✅ Тапсырысыңыз / Ваш заказ:
   - Донер (тауық еті) ×2 — 2400₸  
   - Картошка фри ×1 — 400₸  
   Жалпы / Итого: 2800₸  
   Мекенжай / Адрес: 12мкр 47үй 72пәтер  
   Телефон: 87771234567 
   Болжаған жеткізу уақыты / Примерное время доставки: 35 минут  
   ---
   и спрашивай спопсобы оплаты:
   На казахском: 
   💰 Төлем түрін таңдаңыз:
1️⃣ Kaspi
2️⃣ Наличные
3️⃣ Halyk
   На русском: 
   💰 Выберите способ оплаты:
1️⃣ Kaspi
2️⃣ Наличные
3️⃣ Halyk
7. Если клиент выберет Каспи или Халык бот отправляет ссылку на оплату.
8. Если наличные сразу уходить оператору.

9. После подтверждения напиши:
   "Тапсырысыңыз қабылданды! Рақмет ❤️" / "Ваш заказ принят! Спасибо ❤️"
   и больше ничего не спрашивай.
10. Если клиент пишет новое сообщение после завершения — начинай новый заказ.
11. Если клиент делает ошибку (например “донер классикк”) — не ругай, а уточни: “Сіз ‘Донер’ айтқыңыз келді ме?” / “Вы имели в виду ‘Донер’?”
12. Никогда не очищай корзину без подтверждения.
13. Не меняй язык без причины.
14. Будь кратким, дружелюбным и естественным.

❗ Важно:
— Не придумывай блюда.  
— Не показывай меню больше одного раза, если клиент уже его видел.  
— Не спрашивай адрес и телефон одновременно.  
— Не начинай чек, пока не получил всё (адрес + телефон).  
— Не добавляй ничего, чего нет в меню.
`;



// 📩 Отправка сообщений через UltraMsg
async function sendMessage(to, text) {
  console.log(`📤 Отправка сообщения клиенту ${to}:`);
  console.log(text);
  try {
    await axios.post(`https://api.ultramsg.com/${ULTRAMSG_INSTANCE_ID}/messages/chat`, {
      token: ULTRAMSG_TOKEN,
      to,
      body: text,
    });
  } catch (error) {
    console.error("❌ Ошибка при отправке:", error.response?.data || error.message);
  }
}

// 🧾 Формирование чека
function formatReceipt(order, address) {
  let total = order.reduce((sum, i) => sum + (menu[i.name] || 0) * i.qty, 0);
  let list = order.map((i) => `• ${i.name} x${i.qty} — ${menu[i.name]}₸`).join("\n");
  return `
🧾 *Чек Ali Doner Ақтау*  
${list}

🚚 Доставка: 700₸  
💰 *Итого:* ${total + 700}₸  
📍 Адрес: ${address}  
⏰ Примерно 40 минут
`;
}

async function sendPaymentButton(to, amount, type) {
  const urls = {
    Kaspi: "https://pay.kaspi.kz/pay/3ofujmgr", // 🔁 вставь свой ID
    Halyk: "https://halykbank.kz/pay/your_shop_id"
  };

  const paymentUrl = urls[type];

  await axios.post(`https://api.ultramsg.com/${ULTRAMSG_INSTANCE_ID}/messages/chat`, {
    token: ULTRAMSG_TOKEN,
    to,
    body: `💳 ${type} арқылы ${amount}₸ төлеу үшін сілтемені басыңыз:\n${paymentUrl}`
  });
}



// 🚀 Вебхук UltraMsg
app.post("/webhook", async (req, res) => {
  try {
    console.log("🟢 Получен запрос от UltraMsg:");
    console.log(JSON.stringify(req.body, null, 2));

    const data = req.body;
    if (!data || !data.data || !data.data.from || !data.data.body) {
      console.log("⚠️ Нет данных сообщения.");
      return res.sendStatus(200);
    }

    const from = data.data.from;
    const text = data.data.body.trim();
    const isFromMe = data.data.fromMe;

    if (isFromMe) {
      console.log("⛔ Игнорируем своё сообщение (бот отправил сам себе).");
      return res.sendStatus(200);
    }

    console.log(`📩 Сообщение от ${from}: ${text}`);

    // 🧠 Контекст
    if (!sessions[from]) {
      sessions[from] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "assistant", content: "Сәлеметсіз бе!\nЗдравствуйте!\nAli Doner Ақтау\nТапсырысыңыз, мекен-жай, байланыс нөміріңізді жазыңыз:\nНапишите ваш заказ, адрес доставки, контактный номер:" }
      ];
      console.log(`🆕 Новая сессия создана для ${from}`);
    }

    sessions[from].push({ role: "user", content: text });

    console.log("🧠 Текущий контекст диалога:");
    console.log(JSON.stringify(sessions[from], null, 2));

// 🧠 Убедимся, что system-промт есть
if (!sessions[from].some(msg => msg.role === "system")) {
  sessions[from].unshift({ role: "system", content: SYSTEM_PROMPT });
}

// 🚀 Запрос к OpenAI
console.log("🚀 Отправляем запрос к OpenAI...");
const completion = await axios.post(
  "https://api.openai.com/v1/chat/completions",
  {
    model: "gpt-4o-mini",
    messages: sessions[from],
  },
  {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
  }
);


// 🧠 Исправлено: правильный доступ к ответу
const reply = completion.data.choices?.[0]?.message?.content || "Извините, произошла ошибка.";

console.log("🤖 Ответ от OpenAI:");
console.log(reply);

// Убираем неверный console.log(res.data...)
sessions[from].push({ role: "assistant", content: reply });

// Отправляем сообщение клиенту
await sendMessage(from, reply);
// --- После получения адреса от клиента ---
if (userStage === "address_collected") {
  const total = order.reduce((sum, i) => sum + (menu[i.name] || 0) * i.qty, 0);

  const receipt = `
✅ Тапсырысыңыз:
${order.map(i => `- ${i.name} ×${i.qty} — ${(menu[i.name] || 0) * i.qty}₸`).join("\n")}
Жалпы: ${total}₸
Мекенжай: ${address}
Телефон: ${phone}

💰 Төлем түрін таңдаңыз:
1️⃣ Kaspi
2️⃣ Наличные
3️⃣ Halyk
`;

  sessions[from].push({
    role: "assistant",
    content: receipt
  });

  await sendMessage(from, receipt);
  userStage = "waiting_payment_method";
}
// --- Обработка выбора способа оплаты ---
if (userStage === "waiting_payment_method") {
  if (/kaspi/i.test(text)) {
    await sendMessage(from, "Kaspi арқылы төлеу үшін төмендегі сілтемені басыңыз 👇");
    await sendPaymentButton(from, total, "Kaspi");
    userStage = "waiting_payment_confirmation";

  } else if (/halyk/i.test(text)) {
    await sendMessage(from, "Halyk арқылы төлеу үшін төмендегі сілтемені басыңыз 👇");
    await sendPaymentButton(from, total, "Halyk");
    userStage = "waiting_payment_confirmation";

  } else if (/нал/i.test(text) || /қолма/i.test(text)) {
    const confirmMsg = "✅ Наличныемен төлем қабылданды. Тапсырысыңыз өңдеуде ❤️";
    await sendMessage(from, confirmMsg);
    await sendMessage(OPERATOR_NUMBER, `📋 Новый заказ (наличные):\n${receipt}`);
    console.log(`📨 Чек отправлен оператору: ${OPERATOR_NUMBER}`);
    userStage = "done";
  } else {
    await sendMessage(from, "Төлем түрін таңдаңыз: Kaspi / Наличные / Halyk");
  }
}


res.sendStatus(200);

  } catch (err) {
    console.error("❌ Ошибка в обработке запроса:", err.message);
    res.sendStatus(500);
  }
});

// 🌐 Проверка работы
app.get("/", (req, res) => {
  res.send("🤖 Ali Doner бот работает и пишет в консоль!");
});

app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
