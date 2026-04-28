import "dotenv/config";

const requiredEnv = ["BOT_TOKEN", "ADMIN_IDS", "PAYMENT_CARD_NUMBER", "PAYMENT_CARD_OWNER"] as const;

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const parseAdminIds = (value: string) => {
  const rawIds = value.trim().startsWith("[") ? (JSON.parse(value) as unknown[]) : value.split(",");

  return rawIds.map((id) => Number(String(id).trim())).filter((id) => Number.isInteger(id));
};

const adminIds = parseAdminIds(process.env.ADMIN_IDS!);

if (adminIds.length === 0) {
  throw new Error("ADMIN_IDS must contain at least one numeric Telegram user id.");
}

export const config = {
  botToken: process.env.BOT_TOKEN!,
  adminIds,
  botUsername: process.env.BOT_USERNAME?.trim() || undefined,
  port: Number(process.env.PORT || 3000),
  supportUsername: process.env.SUPPORT_USERNAME?.replace(/^@/, "").trim() || undefined,
  paymentCardNumber: process.env.PAYMENT_CARD_NUMBER!,
  paymentCardOwner: process.env.PAYMENT_CARD_OWNER!,
  welcomeMessage:
    process.env.WELCOME_MESSAGE?.trim() ||
    "به ربات فروش کانفیگ VPN خوش آمدی. از اینجا می‌تونی پلن مناسب خودت رو انتخاب کنی، رسید پرداخت رو بفرستی و بعد از تایید ادمین کانفیگت رو دریافت کنی.",
  purchaseNoticeMessage:
    process.env.PURCHASE_NOTICE_MESSAGE?.trim() ||
    "قبل از خرید، لطفا پلن‌ها رو با دقت بررسی کن. بعد از انتخاب پلن، اطلاعات پرداخت نمایش داده می‌شه و باید رسید رو همینجا ارسال کنی.",
};
