import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
console.log("KASPI_API_URL:", process.env.KASPI_API_URL);
console.log("KASPI_API_KEY:", process.env.KASPI_API_KEY ? "OK" : "MISSING");
console.log("KASPI_MERCHANT_ID:", process.env.KASPI_MERCHANT_ID || "none");

const testKaspi = async () => {
  try {
    const response = await axios.get(process.env.KASPI_API_URL, {
      headers: {
        "Authorization": `Bearer ${process.env.KASPI_API_KEY}`,
        "Content-Type": "application/json",
      },
    });
    console.log("✅ Connected to Kaspi API:", response.data);
  } catch (error) {
    console.error("❌ Kaspi API error:", error.message);
  }
};

testKaspi();
