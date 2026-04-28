import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { adminKeyboard, cancelKeyboard, userMainKeyboard } from "./keyboards.js";

type AddPlanState = {
  step: "title" | "price" | "volume" | "duration" | "description";
  data: {
    title?: string;
    priceToman?: number;
    volumeGb?: number;
    durationDays?: number;
  };
};

type PurchaseState = {
  planId: number;
};

type SendConfigState = {
  orderId: string;
};

type RejectOrderState = {
  orderId: string;
};

type EditPlanField = "title" | "priceToman" | "volumeGb" | "durationDays" | "description";

type EditPlanState = {
  planId: number;
  field: EditPlanField;
};

type SettingKey = "WELCOME_MESSAGE" | "PURCHASE_NOTICE_MESSAGE" | "SUPPORT_USERNAME" | "PAYMENT_CARD_NUMBER" | "PAYMENT_CARD_OWNER";

type EditSettingState = {
  key: SettingKey;
};

const addPlanStates = new Map<number, AddPlanState>();
const purchaseStates = new Map<number, PurchaseState>();
const sendConfigStates = new Map<number, SendConfigState>();
const rejectOrderStates = new Map<number, RejectOrderState>();
const editPlanStates = new Map<number, EditPlanState>();
const editSettingStates = new Map<number, EditSettingState>();
const processingOrderIds = new Set<string>();

const money = new Intl.NumberFormat("fa-IR");

const settingLabels: Record<SettingKey, string> = {
  WELCOME_MESSAGE: "پیام خوش‌آمدگویی",
  PURCHASE_NOTICE_MESSAGE: "پیام قبل از خرید",
  SUPPORT_USERNAME: "یوزرنیم پشتیبانی",
  PAYMENT_CARD_NUMBER: "شماره کارت",
  PAYMENT_CARD_OWNER: "نام صاحب کارت",
};

const statusText = {
  PENDING: "در انتظار تایید",
  APPROVED: "تایید شده",
  REJECTED: "رد شده",
} as const;

export const bot = new Telegraf(config.botToken);

const isAdmin = (userId?: number): boolean => Boolean(userId && config.adminIds.includes(userId));

const parsePositiveInt = (value: string) => {
  const number = Number(value.replace(/[,\s]/g, ""));
  return Number.isInteger(number) && number > 0 ? number : null;
};

const getSetting = async (key: SettingKey, fallback: string) => {
  const setting = await prisma.setting.findUnique({ where: { key } });
  return setting?.value || fallback;
};

const getSupportUsername = async () => {
  const username = await getSetting("SUPPORT_USERNAME", config.supportUsername || "");
  return username.replace(/^@/, "").trim();
};

const getPaymentInfo = async () => ({
  cardNumber: await getSetting("PAYMENT_CARD_NUMBER", config.paymentCardNumber),
  cardOwner: await getSetting("PAYMENT_CARD_OWNER", config.paymentCardOwner),
});

const formatPlan = (plan: {
  id: number;
  title: string;
  priceToman: number;
  volumeGb: number;
  durationDays: number;
  description: string | null;
  isActive: boolean;
}) => {
  const status = plan.isActive ? "فعال" : "غیرفعال";

  return [
    `📌 #${plan.id} - ${plan.title}`,
    `💳 قیمت: ${money.format(plan.priceToman)} تومان`,
    `📶 حجم: ${money.format(plan.volumeGb)} گیگ`,
    `⏳ مدت: ${money.format(plan.durationDays)} روز`,
    `⚙️ وضعیت: ${status}`,
    plan.description ? `📝 توضیح: ${plan.description}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
};

const formatOrderForAdmin = (order: {
  id: string;
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  status?: keyof typeof statusText;
  rejectionReason?: string | null;
  createdAt: Date;
  plan: {
    title: string;
    priceToman: number;
    volumeGb: number;
    durationDays: number;
  };
}) => {
  const userLine = order.username ? `@${order.username}` : order.firstName || "بدون نام";

  return [
    "🧾 سفارش جدید",
    `🔖 کد سفارش: ${order.id}`,
    `👤 کاربر: ${userLine}`,
    `🆔 آیدی عددی: ${order.telegramUserId}`,
    "",
    `📌 پلن: ${order.plan.title}`,
    `💳 قیمت: ${money.format(order.plan.priceToman)} تومان`,
    `📶 حجم: ${money.format(order.plan.volumeGb)} گیگ`,
    `⏳ مدت: ${money.format(order.plan.durationDays)} روز`,
    order.status ? `📍 وضعیت: ${statusText[order.status]}` : undefined,
    order.rejectionReason ? `📝 دلیل رد: ${order.rejectionReason}` : undefined,
    `🕒 زمان: ${order.createdAt.toLocaleString("fa-IR")}`,
  ]
    .filter(Boolean)
    .join("\n");
};

const orderActionKeyboard = (orderId: string) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ تایید", `approve_order:${orderId}`),
      Markup.button.callback("❌ رد", `reject_order:${orderId}`),
    ],
  ]);

const orderAdminKeyboard = (order: {
  id: string;
  status: keyof typeof statusText;
  configChatId: string | null;
  configMessageId: number | null;
}) => {
  if (order.status === "PENDING") {
    return orderActionKeyboard(order.id);
  }

  if (order.status === "APPROVED" && order.configChatId && order.configMessageId) {
    return Markup.inlineKeyboard([[Markup.button.callback("📤 ارسال دوباره کانفیگ", `resend_config:${order.id}`)]]);
  }

  return undefined;
};

const showUserMenu = async (ctx: Context) => {
  const welcomeMessage = await getSetting("WELCOME_MESSAGE", config.welcomeMessage);
  await ctx.reply(`👋 سلام\n\n${welcomeMessage}\n\n👇 از منوی زیر انتخاب کن:`, userMainKeyboard);
};

const showAdminMenu = async (ctx: Context) => {
  await ctx.reply("🛠 پنل ادمین\n\nیکی از گزینه‌های مدیریتی را انتخاب کن:", adminKeyboard);
};

const showActivePlans = async (ctx: Context) => {
  const purchaseNoticeMessage = await getSetting("PURCHASE_NOTICE_MESSAGE", config.purchaseNoticeMessage);
  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  if (plans.length === 0) {
    await ctx.reply("📭 فعلا پلنی برای خرید ثبت نشده است.");
    return;
  }

  await ctx.reply(
    `🛒 خرید کانفیگ\n\n${purchaseNoticeMessage}\n\n👇 یکی از پلن‌ها را انتخاب کن:`,
    Markup.inlineKeyboard(
      plans.map((plan) => [
        Markup.button.callback(
          `📌 ${plan.title} | 💳 ${money.format(plan.priceToman)} تومان`,
          `buy_plan:${plan.id}`,
        ),
      ]),
    ),
  );
};

const showAllPlansForAdmin = async (ctx: Context) => {
  const plans = await prisma.plan.findMany({
    orderBy: { createdAt: "desc" },
  });

  if (plans.length === 0) {
    await ctx.reply("📭 هنوز هیچ پلنی ثبت نشده است.");
    return;
  }

  for (const plan of plans) {
    await ctx.reply(
      formatPlan(plan),
      Markup.inlineKeyboard([
        [Markup.button.callback("✏️ ویرایش", `edit_plan:${plan.id}`)],
        [
          Markup.button.callback(plan.isActive ? "🚫 غیرفعال کردن" : "✅ فعال کردن", `toggle_plan:${plan.id}`),
          Markup.button.callback("🗑 حذف", `delete_plan:${plan.id}`),
        ],
      ]),
    );
  }
};

const showPendingOrdersForAdmin = async (ctx: Context) => {
  const orders = await prisma.order.findMany({
    where: { status: "PENDING" },
    include: { plan: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  if (orders.length === 0) {
    await ctx.reply("✅ سفارش بازی وجود ندارد.");
    return;
  }

  for (const order of orders) {
    await ctx.reply(formatOrderForAdmin(order), orderActionKeyboard(order.id));
  }
};

const showAllOrdersForAdmin = async (ctx: Context) => {
  const orders = await prisma.order.findMany({
    include: { plan: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  if (orders.length === 0) {
    await ctx.reply("📭 هنوز سفارشی ثبت نشده است.");
    return;
  }

  for (const order of orders) {
    const keyboard = orderAdminKeyboard(order);
    if (keyboard) {
      await ctx.reply(formatOrderForAdmin(order), keyboard);
    } else {
      await ctx.reply(formatOrderForAdmin(order));
    }
  }
};

const showSalesReport = async (ctx: Context) => {
  const [pendingCount, rejectedCount, approvedOrders] = await Promise.all([
    prisma.order.count({ where: { status: "PENDING" } }),
    prisma.order.count({ where: { status: "REJECTED" } }),
    prisma.order.findMany({
      where: { status: "APPROVED" },
      include: { plan: true },
    }),
  ]);

  const totalRevenue = approvedOrders.reduce((sum, order) => sum + order.plan.priceToman, 0);

  await ctx.reply(
    [
      "📊 گزارش فروش",
      "",
      `✅ سفارش‌های تایید شده: ${money.format(approvedOrders.length)}`,
      `⏳ سفارش‌های باز: ${money.format(pendingCount)}`,
      `❌ سفارش‌های رد شده: ${money.format(rejectedCount)}`,
      `💰 فروش کل تایید شده: ${money.format(totalRevenue)} تومان`,
    ].join("\n"),
  );
};

const showSettingsMenu = async (ctx: Context) => {
  const settings = await Promise.all(
    (Object.keys(settingLabels) as SettingKey[]).map(async (key) => {
      const fallback = {
        WELCOME_MESSAGE: config.welcomeMessage,
        PURCHASE_NOTICE_MESSAGE: config.purchaseNoticeMessage,
        SUPPORT_USERNAME: config.supportUsername || "",
        PAYMENT_CARD_NUMBER: config.paymentCardNumber,
        PAYMENT_CARD_OWNER: config.paymentCardOwner,
      }[key];

      return [key, await getSetting(key, fallback)] as const;
    }),
  );

  const message = [
    "⚙️ تنظیم متن‌ها",
    "",
    ...settings.map(([key, value]) => `• ${settingLabels[key]}:\n${value || "ثبت نشده"}`),
    "",
    "برای تغییر، یکی از گزینه‌های زیر را انتخاب کن.",
  ].join("\n\n");

  await ctx.reply(
    message,
    Markup.inlineKeyboard(
      (Object.keys(settingLabels) as SettingKey[]).map((key) => [
        Markup.button.callback(`✏️ ${settingLabels[key]}`, `edit_setting:${key}`),
      ]),
    ),
  );
};

const clearUserState = (userId: number) => {
  const sendConfigState = sendConfigStates.get(userId);
  const rejectOrderState = rejectOrderStates.get(userId);
  if (sendConfigState) processingOrderIds.delete(sendConfigState.orderId);
  if (rejectOrderState) processingOrderIds.delete(rejectOrderState.orderId);

  addPlanStates.delete(userId);
  purchaseStates.delete(userId);
  sendConfigStates.delete(userId);
  rejectOrderStates.delete(userId);
  editPlanStates.delete(userId);
  editSettingStates.delete(userId);
};

const handleAddPlanText = async (ctx: Context, text: string, state: AddPlanState) => {
  const adminId = ctx.from!.id;

  if (state.step === "title") {
    state.data.title = text;
    state.step = "price";
    await ctx.reply("💳 قیمت پلن را به تومان و فقط عددی بفرست.\nمثال: 150000");
    return;
  }

  if (state.step === "price") {
    const price = Number(text.replace(/[,\s]/g, ""));
    if (!Number.isInteger(price) || price <= 0) {
      await ctx.reply("⚠️ قیمت معتبر نیست. فقط عدد مثبت بفرست.");
      return;
    }

    state.data.priceToman = price;
    state.step = "volume";
    await ctx.reply("📶 حجم پلن را به گیگ و فقط عددی بفرست.\nمثال: 50");
    return;
  }

  if (state.step === "volume") {
    const volume = Number(text.replace(/[,\s]/g, ""));
    if (!Number.isInteger(volume) || volume <= 0) {
      await ctx.reply("⚠️ حجم معتبر نیست. فقط عدد مثبت بفرست.");
      return;
    }

    state.data.volumeGb = volume;
    state.step = "duration";
    await ctx.reply("⏳ مدت پلن را به روز و فقط عددی بفرست.\nمثال: 30");
    return;
  }

  if (state.step === "duration") {
    const duration = Number(text.replace(/[,\s]/g, ""));
    if (!Number.isInteger(duration) || duration <= 0) {
      await ctx.reply("⚠️ مدت معتبر نیست. فقط عدد مثبت بفرست.");
      return;
    }

    state.data.durationDays = duration;
    state.step = "description";
    await ctx.reply("📝 توضیح پلن را بفرست. اگر توضیح ندارد، بنویس: -");
    return;
  }

  const description = text === "-" ? null : text;
  const plan = await prisma.plan.create({
    data: {
      title: state.data.title!,
      priceToman: state.data.priceToman!,
      volumeGb: state.data.volumeGb!,
      durationDays: state.data.durationDays!,
      description,
    },
  });

  addPlanStates.delete(adminId);
  await ctx.reply(`✅ پلن ثبت شد:\n\n${formatPlan(plan)}`, adminKeyboard);
};

const showUserOrders = async (ctx: Context) => {
  const userId = ctx.from?.id.toString();
  if (!userId) return;

  const orders = await prisma.order.findMany({
    where: { telegramUserId: userId },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (orders.length === 0) {
    await ctx.reply("📭 هنوز سفارشی ثبت نکرده‌ای.");
    return;
  }

  const message = orders
    .map((order) =>
      [
        `🔖 کد سفارش: ${order.id}`,
        `📌 پلن: ${order.plan.title}`,
        `📍 وضعیت: ${statusText[order.status]}`,
        `🕒 زمان: ${order.createdAt.toLocaleString("fa-IR")}`,
      ].join("\n"),
    )
    .join("\n\n");

  await ctx.reply(message);
};

bot.start(async (ctx) => {
  await showUserMenu(ctx);
});

bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply("⛔️ شما دسترسی ادمین ندارید.");
    return;
  }

  await showAdminMenu(ctx);
});

bot.command("cancel", async (ctx) => {
  clearUserState(ctx.from.id);
  await ctx.reply("❌ عملیات لغو شد.", isAdmin(ctx.from.id) ? adminKeyboard : userMainKeyboard);
});

bot.hears(["🛒 خرید کانفیگ", "خرید کانفیگ"], showActivePlans);
bot.hears(["📦 سرویس‌های من", "سرویس‌های من"], showUserOrders);

bot.hears(["☎️ پشتیبانی", "پشتیبانی"], async (ctx) => {
  const supportUsername = await getSupportUsername();
  if (!supportUsername) {
    await ctx.reply("📭 راه ارتباط پشتیبانی هنوز ثبت نشده است.");
    return;
  }

  await ctx.reply(`☎️ پشتیبانی\n\nبرای پشتیبانی پیام بده:\n@${supportUsername}`);
});

bot.hears(["📘 راهنما", "راهنما"], async (ctx) => {
  await ctx.reply(
    [
      "📘 راهنمای خرید",
      "",
      "1. گزینه 🛒 خرید کانفیگ را بزن.",
      "2. پلن موردنظرت را انتخاب کن.",
      "3. مبلغ را به کارت نمایش داده‌شده واریز کن.",
      "4. عکس یا فایل رسید را همینجا بفرست.",
      "5. بعد از تایید ادمین، کانفیگ برایت ارسال می‌شود.",
      "",
      "برای لغو هر مرحله می‌توانی /cancel یا «❌ لغو عملیات» را بفرستی.",
    ].join("\n"),
  );
});

bot.hears(["🏠 بازگشت به منوی کاربر", "بازگشت به منوی کاربر"], showUserMenu);

bot.hears(["❌ لغو عملیات", "لغو عملیات"], async (ctx) => {
  clearUserState(ctx.from.id);
  await ctx.reply("❌ عملیات لغو شد.", isAdmin(ctx.from.id) ? adminKeyboard : userMainKeyboard);
});

bot.hears("➕ افزودن پلن", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;

  addPlanStates.set(ctx.from.id, { step: "title", data: {} });
  await ctx.reply("📌 عنوان پلن را بفرست.\nمثال: یک ماهه 50 گیگ", cancelKeyboard);
});

bot.hears("📋 لیست پلن‌ها", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await showAllPlansForAdmin(ctx);
});

bot.hears("🧾 سفارش‌های باز", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await showPendingOrdersForAdmin(ctx);
});

bot.hears("📚 همه سفارش‌ها", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await showAllOrdersForAdmin(ctx);
});

bot.hears("📊 گزارش فروش", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await showSalesReport(ctx);
});

bot.hears("⚙️ تنظیم متن‌ها", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await showSettingsMenu(ctx);
});

bot.action(/^buy_plan:(\d+)$/, async (ctx) => {
  const planId = Number(ctx.match[1]);
  const plan = await prisma.plan.findFirst({ where: { id: planId, isActive: true } });

  if (!plan) {
    await ctx.answerCbQuery("این پلن در دسترس نیست.");
    return;
  }

  purchaseStates.set(ctx.from.id, { planId });
  const paymentInfo = await getPaymentInfo();

  await ctx.answerCbQuery();
  await ctx.reply(
    [
      "✅ پلن انتخابی:",
      formatPlan(plan),
      "",
      "💳 لطفا مبلغ را به کارت زیر واریز کن و عکس یا فایل رسید را همینجا بفرست:",
      `شماره کارت: ${paymentInfo.cardNumber}`,
      `به نام: ${paymentInfo.cardOwner}`,
      "",
      "برای لغو خرید، «❌ لغو عملیات» را بفرست.",
    ].join("\n"),
    cancelKeyboard,
  );
});

bot.action(/^edit_plan:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("دسترسی ندارید.");
    return;
  }

  const planId = Number(ctx.match[1]);
  const plan = await prisma.plan.findUnique({ where: { id: planId } });

  if (!plan) {
    await ctx.answerCbQuery("پلن پیدا نشد.");
    return;
  }

  await ctx.answerCbQuery();
  await ctx.reply(
    `✏️ ویرایش پلن\n\n${formatPlan(plan)}\n\nکدام بخش را می‌خواهی تغییر بدهی؟`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback("عنوان", `edit_plan_field:${plan.id}:title`),
        Markup.button.callback("قیمت", `edit_plan_field:${plan.id}:priceToman`),
      ],
      [
        Markup.button.callback("حجم", `edit_plan_field:${plan.id}:volumeGb`),
        Markup.button.callback("مدت", `edit_plan_field:${plan.id}:durationDays`),
      ],
      [Markup.button.callback("توضیح", `edit_plan_field:${plan.id}:description`)],
    ]),
  );
});

bot.action(/^edit_plan_field:(\d+):(title|priceToman|volumeGb|durationDays|description)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("دسترسی ندارید.");
    return;
  }

  const planId = Number(ctx.match[1]);
  const field = ctx.match[2] as EditPlanField;
  const plan = await prisma.plan.findUnique({ where: { id: planId } });

  if (!plan) {
    await ctx.answerCbQuery("پلن پیدا نشد.");
    return;
  }

  editPlanStates.set(ctx.from.id, { planId, field });
  await ctx.answerCbQuery();
  await ctx.reply(
    field === "description"
      ? "📝 توضیح جدید را بفرست. اگر توضیح ندارد، بنویس: -"
      : "مقدار جدید را بفرست.",
    cancelKeyboard,
  );
});

bot.action(/^edit_setting:(WELCOME_MESSAGE|PURCHASE_NOTICE_MESSAGE|SUPPORT_USERNAME|PAYMENT_CARD_NUMBER|PAYMENT_CARD_OWNER)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("دسترسی ندارید.");
    return;
  }

  const key = ctx.match[1] as SettingKey;
  editSettingStates.set(ctx.from.id, { key });
  await ctx.answerCbQuery();
  await ctx.reply(`✏️ مقدار جدید برای «${settingLabels[key]}» را بفرست.`, cancelKeyboard);
});

bot.action(/^toggle_plan:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("دسترسی ندارید.");
    return;
  }

  const planId = Number(ctx.match[1]);
  const plan = await prisma.plan.findUnique({ where: { id: planId } });

  if (!plan) {
    await ctx.answerCbQuery("پلن پیدا نشد.");
    return;
  }

  const updatedPlan = await prisma.plan.update({
    where: { id: planId },
    data: { isActive: !plan.isActive },
  });

  await ctx.answerCbQuery("وضعیت تغییر کرد.");
  await ctx.editMessageText(formatPlan(updatedPlan));
});

bot.action(/^delete_plan:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("دسترسی ندارید.");
    return;
  }

  const planId = Number(ctx.match[1]);
  const orderCount = await prisma.order.count({ where: { planId } });

  if (orderCount > 0) {
    await ctx.answerCbQuery("این پلن سفارش دارد و قابل حذف نیست.");
    return;
  }

  await prisma.plan.delete({ where: { id: planId } });
  await ctx.answerCbQuery("پلن حذف شد.");
  await ctx.editMessageText("🗑 پلن حذف شد.");
});

bot.action(/^approve_order:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("دسترسی ندارید.");
    return;
  }

  const order = await prisma.order.findUnique({
    where: { id: ctx.match[1] },
    include: { plan: true },
  });

  if (!order) {
    await ctx.answerCbQuery("سفارش پیدا نشد.");
    return;
  }

  if (order.status !== "PENDING") {
    await ctx.answerCbQuery("این سفارش قبلا بررسی شده است.");
    return;
  }

  if (processingOrderIds.has(order.id)) {
    await ctx.answerCbQuery("این سفارش توسط یک ادمین در حال بررسی است.");
    return;
  }

  processingOrderIds.add(order.id);
  sendConfigStates.set(ctx.from.id, { orderId: order.id });
  await ctx.answerCbQuery("سفارش تایید شد.");
  await ctx.editMessageReplyMarkup(undefined);

  await ctx.reply(
    [
      "✅ سفارش تایید اولیه شد.",
      "",
      `🔖 کد سفارش: ${order.id}`,
      `📌 پلن: ${order.plan.title}`,
      "",
      "حالا کانفیگ این کاربر را همینجا بفرست.",
      "می‌تواند متن، لینک، عکس یا فایل باشد.",
      "",
      "برای لغو ارسال کانفیگ، «❌ لغو عملیات» را بفرست.",
    ].join("\n"),
    cancelKeyboard,
  );
});

bot.action(/^reject_order:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("دسترسی ندارید.");
    return;
  }

  const order = await prisma.order.findUnique({
    where: { id: ctx.match[1] },
    include: { plan: true },
  });

  if (!order) {
    await ctx.answerCbQuery("سفارش پیدا نشد.");
    return;
  }

  if (order.status !== "PENDING") {
    await ctx.answerCbQuery("این سفارش قبلا بررسی شده است.");
    return;
  }

  if (processingOrderIds.has(order.id)) {
    await ctx.answerCbQuery("این سفارش توسط یک ادمین در حال بررسی است.");
    return;
  }

  processingOrderIds.add(order.id);
  rejectOrderStates.set(ctx.from.id, { orderId: order.id });
  await ctx.answerCbQuery("سفارش رد شد.");
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply(
    [
      "❌ دلیل رد سفارش را بفرست.",
      "",
      `🔖 کد سفارش: ${order.id}`,
      `📌 پلن: ${order.plan.title}`,
      "",
      "این دلیل برای کاربر ارسال می‌شود.",
    ].join("\n"),
    cancelKeyboard,
  );
});

bot.action(/^resend_config:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCbQuery("دسترسی ندارید.");
    return;
  }

  const order = await prisma.order.findUnique({
    where: { id: ctx.match[1] },
    include: { plan: true },
  });

  if (!order || order.status !== "APPROVED" || !order.configChatId || !order.configMessageId) {
    await ctx.answerCbQuery("کانفیگ قابل ارسال مجدد نیست.");
    return;
  }

  await bot.telegram.sendMessage(
    Number(order.telegramUserId),
    `📤 ارسال مجدد کانفیگ\n📌 پلن: ${order.plan.title}`,
  );
  await bot.telegram.copyMessage(Number(order.telegramUserId), Number(order.configChatId), order.configMessageId);
  await ctx.answerCbQuery("کانفیگ دوباره ارسال شد.");
});

bot.on("message", async (ctx, next) => {
  const state = sendConfigStates.get(ctx.from.id);
  if (!state || !isAdmin(ctx.from.id)) {
    return next();
  }

  const order = await prisma.order.findUnique({
    where: { id: state.orderId },
    include: { plan: true },
  });

  if (!order) {
    sendConfigStates.delete(ctx.from.id);
    processingOrderIds.delete(state.orderId);
    await ctx.reply("⚠️ سفارش پیدا نشد.", adminKeyboard);
    return;
  }

  if (order.status !== "PENDING") {
    sendConfigStates.delete(ctx.from.id);
    processingOrderIds.delete(state.orderId);
    await ctx.reply("⚠️ این سفارش قبلا بررسی شده است.", adminKeyboard);
    return;
  }

  await bot.telegram.sendMessage(
    Number(order.telegramUserId),
    `✅ سفارش شما تایید شد.\n📌 پلن: ${order.plan.title}\n\nکانفیگ شما:`,
  );
  await bot.telegram.copyMessage(Number(order.telegramUserId), ctx.chat.id, ctx.message.message_id);

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: "APPROVED",
      configChatId: ctx.chat.id.toString(),
      configMessageId: ctx.message.message_id,
    },
  });

  sendConfigStates.delete(ctx.from.id);
  processingOrderIds.delete(order.id);
  await ctx.reply("✅ کانفیگ برای کاربر ارسال شد و سفارش تایید شد.", adminKeyboard);
});

bot.on("message", async (ctx, next) => {
  if (!("text" in ctx.message)) {
    return next();
  }

  const state = rejectOrderStates.get(ctx.from.id);
  if (!state || !isAdmin(ctx.from.id)) {
    return next();
  }

  const reason = ctx.message.text.trim();
  if (!reason) {
    await ctx.reply("⚠️ دلیل رد نمی‌تواند خالی باشد.");
    return;
  }

  const order = await prisma.order.update({
    where: { id: state.orderId },
    data: { status: "REJECTED", rejectionReason: reason },
    include: { plan: true },
  });

  rejectOrderStates.delete(ctx.from.id);
  processingOrderIds.delete(order.id);
  await bot.telegram.sendMessage(
    Number(order.telegramUserId),
    [`❌ سفارش شما رد شد.`, `📌 پلن: ${order.plan.title}`, `📝 دلیل: ${reason}`].join("\n"),
  );
  await ctx.reply("✅ سفارش با دلیل رد شد و پیام برای کاربر ارسال شد.", adminKeyboard);
});

bot.on("message", async (ctx, next) => {
  if (!("text" in ctx.message)) {
    return next();
  }

  const state = editPlanStates.get(ctx.from.id);
  if (!state || !isAdmin(ctx.from.id)) {
    return next();
  }

  const text = ctx.message.text.trim();
  const data: Partial<{
    title: string;
    priceToman: number;
    volumeGb: number;
    durationDays: number;
    description: string | null;
  }> = {};

  if (state.field === "title") {
    data.title = text;
  } else if (state.field === "description") {
    data.description = text === "-" ? null : text;
  } else {
    const number = parsePositiveInt(text);
    if (!number) {
      await ctx.reply("⚠️ مقدار معتبر نیست. فقط عدد مثبت بفرست.");
      return;
    }
    data[state.field] = number;
  }

  const plan = await prisma.plan.update({
    where: { id: state.planId },
    data,
  });

  editPlanStates.delete(ctx.from.id);
  await ctx.reply(`✅ پلن ویرایش شد:\n\n${formatPlan(plan)}`, adminKeyboard);
});

bot.on("message", async (ctx, next) => {
  if (!("text" in ctx.message)) {
    return next();
  }

  const state = editSettingStates.get(ctx.from.id);
  if (!state || !isAdmin(ctx.from.id)) {
    return next();
  }

  const value = ctx.message.text.trim();
  if (!value) {
    await ctx.reply("⚠️ مقدار نمی‌تواند خالی باشد.");
    return;
  }

  await prisma.setting.upsert({
    where: { key: state.key },
    create: { key: state.key, value },
    update: { value },
  });

  editSettingStates.delete(ctx.from.id);
  await ctx.reply(`✅ «${settingLabels[state.key]}» ذخیره شد.`, adminKeyboard);
});

bot.on("message", async (ctx, next) => {
  if (!("text" in ctx.message)) {
    return next();
  }

  const state = addPlanStates.get(ctx.from.id);
  if (state && isAdmin(ctx.from.id)) {
    await handleAddPlanText(ctx, ctx.message.text.trim(), state);
    return;
  }

  return next();
});

bot.on("message", async (ctx, next) => {
  const purchaseState = purchaseStates.get(ctx.from.id);
  if (!purchaseState) {
    return next();
  }

  const photo = "photo" in ctx.message ? ctx.message.photo.at(-1) : undefined;
  const document = "document" in ctx.message ? ctx.message.document : undefined;

  if (!photo && !document) {
    await ctx.reply("🧾 لطفا عکس یا فایل رسید پرداخت را بفرست.");
    return;
  }

  const receiptFileId = photo?.file_id || document!.file_id;
  const receiptType = photo ? "PHOTO" : "DOCUMENT";

  const order = await prisma.order.create({
    data: {
      telegramUserId: ctx.from.id.toString(),
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      planId: purchaseState.planId,
      receiptFileId,
      receiptType,
    },
    include: { plan: true },
  });

  purchaseStates.delete(ctx.from.id);
  await ctx.reply("✅ رسید دریافت شد.\nسفارش برای ادمین ارسال شد و بعد از بررسی اطلاع می‌دهیم.", userMainKeyboard);

  const caption = formatOrderForAdmin(order);
  let isFirstAdminMessage = true;

  for (const adminId of config.adminIds) {
    const sentMessage = photo
      ? await bot.telegram.sendPhoto(adminId, receiptFileId, {
          caption,
          ...orderActionKeyboard(order.id),
        })
      : await bot.telegram.sendDocument(adminId, receiptFileId, {
          caption,
          ...orderActionKeyboard(order.id),
        });

    if (isFirstAdminMessage) {
      await prisma.order.update({
        where: { id: order.id },
        data: { adminMessageId: sentMessage.message_id },
      });
      isFirstAdminMessage = false;
    }
  }
});

bot.catch((error) => {
  console.error("Telegram bot error:", error);
});
