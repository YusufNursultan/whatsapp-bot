import axios from "axios";

const KASPI_API_URL = process.env.KASPI_API_URL;
const KASPI_API_KEY = process.env.KASPI_API_KEY;

export async function createKaspiPayment(orderId, amount, description) {
  try {
    const resp = await axios.post(
      `${KASPI_API_URL}/create`,
      {
        orderId,
        amount,
        description,
        currency: "KZT",
        redirectUrl: "https://whatsapp.com", // куда вернётся клиент после оплаты
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KASPI_API_KEY}`,
        },
      }
    );

    return resp.data; // Обычно содержит ссылку на оплату
  } catch (err) {
    console.error("❌ Kaspi API error:", err.response?.data || err.message);
    throw err;
  }
}
