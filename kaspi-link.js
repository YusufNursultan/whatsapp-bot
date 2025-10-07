// kaspi-link.js
import 'dotenv/config';

const SHOP_ALIAS = process.env.KASPI_SHOP_ALIAS || "AliDoner"; // твой Kaspi Pay логин
const OPERATOR_PHONE = process.env.OPERATOR_PHONE;

// Функция создания ссылки оплаты
export function createKaspiPaymentLink(amount) {
  const link = `https://kaspi.kz/pay/${SHOP_ALIAS}/${amount}`;
  return link;
}

// Формирование текста чека
export function formatReceipt(order, address, amount, deliveryPrice) {
  const total = amount + deliveryPrice;
  return `
🧾 *Чек Ali Doner Aktau*

📦 Заказ:
${order.map((item, i) => `${i + 1}. ${item.name} — ${item.price}₸`).join("\n")}

🚚 Доставка: ${deliveryPrice}₸
🏠 Адрес: ${address}
💰 Итого: ${total}₸

Спасибо за заказ! 🌯🍔🍟
`;
}
