// kaspi-link.js
import 'dotenv/config';


/**
 * Создает платежную ссылку Kaspi Pay - УПРОЩЕННАЯ ВЕРСИЯ
 */
export function createKaspiPaymentLink(amount) {
  // Просто создаем ссылку без валидации
  const link = `https://pay.kaspi.kz/pay/3ofujmgr?amount`;
  console.log(`🔗 Generated Kaspi link: ${link}`);
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