// kaspi-link.js
import 'dotenv/config';

const CONFIG = {
  SHOP_ALIAS: process.env.KASPI_SHOP_ALIAS || "AliDoner",
  KASPI_PAY_BASE_URL: 'https://pay.kaspi.kz/pay/3ofujmgr'
};

/**
 * Создает платежную ссылку Kaspi Pay
 */
export function createKaspiPaymentLink(amount) {
  // Округляем сумму до целого числа
  const roundedAmount = Math.round(Number(amount));
  
  if (isNaN(roundedAmount) || roundedAmount <= 0) {
    throw new Error(`Неверная сумма для оплаты: ${amount}`);
  }

  const link = `${CONFIG.KASPI_PAY_BASE_URL}?amount=${roundedAmount}`;
  console.log(`🔗 Generated Kaspi link for ${roundedAmount}₸: ${link}`);
  return link;
}

/**
 * Формирование текста чека
 */
export function formatReceipt(order, address, amount, deliveryPrice) {
  const total = amount + deliveryPrice;
  
  // Форматируем список товаров с количеством и общей стоимостью
  const orderText = order.map((item, i) => {
    const itemTotal = item.price * (item.quantity || 1);
    return `${i + 1}. ${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''} — ${itemTotal}₸`;
  }).join("\n");

  return `
🧾 *Чек Ali Doner Aktau*

📦 *Ваш заказ:*
${orderText}

🚚 *Доставка:* ${deliveryPrice}₸
🏠 *Адрес:* ${address}
────────────────
💰 *Итого к оплате:* ${total}₸

Спасибо за заказ! 🌯🍔🍟
`;
}