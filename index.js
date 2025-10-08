import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import 'dotenv/config';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const OPERATOR_NUMBER = process.env.OPERATOR_PHONE; // твой номер WhatsApp для уведомлений
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

// 🧠 Контекст диалогов
const sessions = {};

// 🍔 Меню
const menu = {
  "Doner Classic 30 см": 1790,
  "Doner Classic 40 см": 1990,
  "Doner Beef 30 см": 2090,
  "Doner Beef 40 см": 2290,
  "Panini Classic": 1890,
  "Panini Beef": 2190,
  "Фри": 890,
  "Coca Cola 0.5L": 590,
};

// 💬 ИИ-ПРОМТ
const SYSTEM_PROMPT = `
Ты — профессиональный ассистент WhatsApp для фастфуда *Ali Doner Ақтау*.

1. Приветствуй клиентов вежливо на двух языках:
"Сәлеметсіз бе!
Здравствуйте!
Ali Doner Ақтау
Тапсырысыңыз, мекен-жай, байланыс нөміріңізді жазыңыз:
Напишите ваш заказ, адрес доставки, контактный номер:"

2. Принимай заказы, адрес и способ оплаты.
   Если нет адреса — попроси его вежливо.
   Если заказ завершён — отправь чек с итого и временем доставки (примерно 40 мин).

3. После подтверждения пиши:
   "✅ *Заказ қабылданды!*  
   ⏰ Доставка примерно через 40 минут.  
   Рахмет!"

4. Не отправляй ссылки и не обсуждай оплату Kaspi.
5. Никогда не отвечай на свои собственные сообщения (игнорируй их).
6. Пиши коротко, дружелюбно, с уважением. Выделяй важные слова жирным.
`;

// 📩 Отправка сообщения в WhatsApp
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v17.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

// 🧾 Формирование чека
function formatReceipt(order, address) {
  let total = order.reduce((sum, i) => sum + (menu[i.name] || 0) * i.qty, 0);
  let list = order
    .map((i) => `• ${i.name} x${i.qty} — ${menu[i.name] || 0}₸`)
    .join("\n");

  return `
🧾 *Чек Ali Doner Ақтау*  
${list}

🚚 Доставка: 700₸  
💰 *Итого:* ${total + 700}₸  
📍 Адрес: ${address}  
⏰ Примерно 40 минут
`;
}

// 🚀 Вебхук для WhatsApp
app.post("/webhook-whatsapp", async (req, res) => {
  try {
    const data = req.body;
    if (!data.entry) return res.sendStatus(200);

    const message = data.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || !message.from) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body?.trim();
    const botNumber = process.env.BOT_PHONE_ID; // твой ID бота в WhatsApp

    // ⚠️ Игнорируем свои сообщения
    if (message.from === botNumber || message.type !== "text") return res.sendStatus(200);

    console.log(`Сообщение от ${from}: ${text}`);

    if (!sessions[from]) sessions[from] = { order: [], address: "", step: "start" };
    const session = sessions[from];

    if (session.step === "start") {
      await sendMessage(
        from,
        "Сәлеметсіз бе!\nЗдравствуйте!\nAli Doner Ақтау\n\nТапсырысыңыз, мекен-жай, байланыс нөміріңізді жазыңыз:\nНапишите ваш заказ, адрес доставки, контактный номер:"
      );
      session.step = "ordering";
    } else if (session.step === "ordering") {
      // ищем блюда в тексте
      const foundItems = Object.keys(menu).filter((item) =>
        text.toLowerCase().includes(item.toLowerCase().split(" ")[0])
      );

      if (foundItems.length) {
        foundItems.forEach((item) => session.order.push({ name: item, qty: 1 }));
        await sendMessage(from, `Добавлено: ${foundItems.join(", ")}.`);
        await sendMessage(from, "Пожалуйста, напишите адрес доставки:");
        session.step = "address";
      } else {
        await sendMessage(from, "Не нашёл блюдо в меню, повторите заказ 🙏");
      }
    } else if (session.step === "address") {
      session.address = text;
      const receipt = formatReceipt(session.order, session.address);
      await sendMessage(from, "✅ *Ваш заказ принят!*");
      await sendMessage(from, receipt);
      await sendMessage(from, "Рахмет! Доставка примерно через 40 минут 🙏");

      // уведомляем оператора
      if (OPERATOR_NUMBER) await sendMessage(OPERATOR_NUMBER, `📢 Новый заказ от ${from}:\n${receipt}`);

      session.step = "done";
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Ошибка:", err.message);
    res.sendStatus(500);
  }
});

// 🌐 Проверка токена при настройке вебхука
app.get("/webhook-whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.listen(PORT, () => console.log(`✅ Бот запущен на порту ${PORT}`));
