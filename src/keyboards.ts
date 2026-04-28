import { Markup } from "telegraf";

export const userMainKeyboard = Markup.keyboard([
  ["🛒 خرید کانفیگ"],
  ["📦 سرویس‌های من", "☎️ پشتیبانی"],
  ["📘 راهنما"],
]).resize();

export const adminKeyboard = Markup.keyboard([
  ["➕ افزودن پلن", "📋 لیست پلن‌ها"],
  ["🧾 سفارش‌های باز", "📚 همه سفارش‌ها"],
  ["📊 گزارش فروش", "⚙️ تنظیم متن‌ها"],
  ["🏠 بازگشت به منوی کاربر"],
]).resize();

export const cancelKeyboard = Markup.keyboard([["❌ لغو عملیات"]]).resize();
