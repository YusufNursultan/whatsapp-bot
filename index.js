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

// 💬 Системный промт
const SYSTEM_PROMPT = `
Ты — умный ассистент фастфуда под названием "Мой Изи".  
Ты общаешься на двух языках: қазақша 🇰🇿 және орысша 🇷🇺 — выбирай язык клиента автоматически.  

🔹 Твоя цель — принять заказ максимально корректно.  
🔹 Всегда отвечай вежливо и коротко, как живой оператор.  

Твоя логика общения:
1. Если клиент просит "меню", отправь список блюд из меню. 
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

2. Если клиент пишет блюдо (даже с ошибкой, например “донэр”, “бургерр”, “донр”):
   - Определи, что он имел в виду.
   - Уточни вариант (например: "Донер с курицей или говядиной?").

3. Храни все выбранные позиции в корзине до подтверждения (бот не должен забывать старые блюда, пока клиент не скажет “растамақпын” / “подтверждаю заказ”).

4. После подтверждения — сформируй чек:

5. Когда клиент напишет адрес и номер — выдай финальное сообщение:

6. После этого — сохрани чек в базе данных (например MongoDB) с:
- Номер телефона клиента
- Состав заказа
- Общую сумму
- Время и статус (“в обработке”)

7. Если этот клиент напишет снова — бот может вспомнить прошлый заказ и предложить:  
“Сол тапсырысты қайталайсыз ба?” / “Хотите повторить прошлый заказ?” или если клиент хочеть отменить или изменить заказ, чтобы можно было отменить или изменить.

---

💡 Дополнительно:
- Никогда не очищай корзину без подтверждения клиента.  
- Если клиент пишет непонятно — уточни.  
- Не используй сложные фразы, отвечай просто и дружелюбно.  
- Не задавай лишних вопросов, только по заказу.  
- Всегда поддерживай один стиль: доброжелательный и быстрый.

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
