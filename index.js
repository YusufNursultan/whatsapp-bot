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
const OPERATOR_NUMBER = process.env.OPERATOR_NUMBER; // номер для уведомлений

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

// 💬 Системный промт
const SYSTEM_PROMPT = `
Ты — вежливый ассистент WhatsApp для фастфуда *Ali Doner Ақтау*.
1. Приветствуй на двух языках (каз/рус).
2. Принимай заказ, адрес и способ оплаты.
3. Если всё получено — отправь чек и скажи, что доставка примерно 40 мин.
4. Никогда не отвечай на свои собственные сообщения.
5. Пиши кратко, дружелюбно, с уважением.
`;

// 📩 Функция отправки сообщений через UltraMsg
async function sendMessage(to, text) {
  await axios.post(`https://api.ultramsg.com/${ULTRAMSG_INSTANCE_ID}/messages/chat`, {
    token: ULTRAMSG_TOKEN,
    to,
    body: text,
  });
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

// 🚀 Вебхук от UltraMsg
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;

    if (!data || !data.data || !data.data.from || !data.data.body) {
      return res.sendStatus(200);
    }

    const from = data.data.from; // номер клиента
    const text = data.data.body.trim();
    const isFromMe = data.data.fromMe; // ⚠️ если сообщение от бота — игнорим

    if (isFromMe) return res.sendStatus(200);

    console.log(`📩 Получено сообщение от ${from}: ${text}`);

    // 🧠 Инициализация сессии
    if (!sessions[from]) {
      sessions[from] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "assistant", content: "Сәлеметсіз бе!\nЗдравствуйте!\nAli Doner Ақтау\nТапсырысыңыз, мекен-жай, байланыс нөміріңізді жазыңыз:\nНапишите ваш заказ, адрес доставки, контактный номер:" }
      ];
    }

    // Добавляем сообщение пользователя
    sessions[from].push({ role: "user", content: text });

    // 🧠 Запрос к OpenAI
    const completion = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4o-mini",
      messages: sessions[from],
    }, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });

    const reply = completion.data.choices[0].message.content;

    // Добавляем ответ в контекст
    sessions[from].push({ role: "assistant", content: reply });

    // ✉️ Отправляем ответ пользователю
    await sendMessage(from, reply);

    res.sendStatus(200);
  } catch (err) {
    console.error("Ошибка:", err.message);
    res.sendStatus(500);
  }
});

// 🌐 Проверка
app.get("/", (req, res) => {
  res.send("🤖 Ali Doner бот работает!");
});

app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
