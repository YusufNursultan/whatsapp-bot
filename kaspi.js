// kaspi.js
require("dotenv").config();

const KASPI_PAY_LINK = "https://pay.kaspi.kz/pay/3ofujmgr"; // твоя постоянная ссылка

function generateKaspiPaymentLink(totalAmount) {
  if (!totalAmount || isNaN(totalAmount)) {
    throw new Error("Некорректная сумма для Kaspi оплаты");
  }

  // округлим на случай копеек
  const amount = Math.round(totalAmount);

  // добавляем параметр суммы в ссылку
  return `${KASPI_PAY_LINK}?amount=${amount}`;
}

module.exports = { generateKaspiPaymentLink };

