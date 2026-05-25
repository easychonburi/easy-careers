// ไฟล์: netlify/functions/send-to-telegram.js

exports.handler = async (event) => {
  // 1 ตรวจสอบ Method
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // 2 ดึง Environment Variables
  // หมายเหตุ: ใช้ env vars เดิมที่มีอยู่ใน Netlify แล้ว
  // CHAT_ID_AOAUDOM_PT     → ตอนนี้ใช้รับใบสมัครสาขาอ่าวอุดม (ประจำ)
  // CHAT_ID_AMATA_WEEKEND_PT → ตอนนี้ใช้รับใบสมัครสาขาอมตะนคร (Part Time)
  const {
    TELEGRAM_BOT_TOKEN,
    CHAT_ID_AOAUDOM_PT,
    CHAT_ID_AMATA_WEEKEND_PT,
    TELEGRAM_CHAT_ID  // fallback กรณีฉุกเฉิน
  } = process.env;

  if (!TELEGRAM_BOT_TOKEN || !CHAT_ID_AOAUDOM_PT || !CHAT_ID_AMATA_WEEKEND_PT) {
    return { statusCode: 500, body: "Missing environment variables" };
  }

  // 3 ดึงข้อมูลจาก body
  const data = JSON.parse(event.body || "{}");
  const positionText = data.position || "";

  // 4 เลือกห้องปลายทาง
  const detectPositionKey = (text) => {
    const t = String(text || "");
    if (t.includes("อ่าวอุดม")) return "AOAUDOM_FT";
    if (t.includes("อมตะนคร")) return "AMATA_PT";
    return "UNKNOWN";
  };

  const positionKey = detectPositionKey(positionText);

  let targetChatId;
  switch (positionKey) {
    case "AOAUDOM_FT":
      targetChatId = CHAT_ID_AOAUDOM_PT;
      break;
    case "AMATA_PT":
      targetChatId = CHAT_ID_AMATA_WEEKEND_PT;
      break;
    default:
      targetChatId = TELEGRAM_CHAT_ID || CHAT_ID_AOAUDOM_PT;
      break;
  }

  // 5 ฟังก์ชัน escape text สำหรับ HTML
  const escape = (str) => {
    if (!str) return "N/A";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };

  // 6 จัดการประวัติการทำงาน
  let workHistoryText = "N/A (ไม่เคยทำงาน)";
  const rawWorkCount = data.workCount || "";

  let numericCount = 0;
  if (rawWorkCount === "5+") {
    numericCount = 5;
  } else if (rawWorkCount && !Number.isNaN(parseInt(rawWorkCount, 10))) {
    numericCount = parseInt(rawWorkCount, 10);
  }

  if (numericCount > 0) {
    const displayCount = rawWorkCount === "5+" ? "มากกว่า 5" : rawWorkCount;
    workHistoryText = `\n(เคยทำงาน ${escape(displayCount)} ที่)\n`;

    for (let i = 1; i <= numericCount; i++) {
      const workplace = data[`workplace${i}`];
      const position = data[`position${i}`];
      const description = data[`description${i}`];

      if (!workplace && !position && !description) continue;

      workHistoryText += `<b>${i}. ${escape(workplace || "ไม่ระบุสถานที่ทำงาน")}</b>\n`;
      workHistoryText += `   <i>ตำแหน่ง</i> ${escape(position || "N/A")}\n`;
      workHistoryText += `   <i>สิ่งที่ทำ</i> ${escape(description || "N/A")}\n`;
    }
  }

  // 7 การศึกษา
  let educationText = escape(data.education);
  if (data.education === "กำลังศึกษาอยู่") {
    const lvl = escape(data.studying_level || "ไม่ได้ระบุระดับ");
    const major = escape(data.studying_major || "ไม่ได้ระบุสาขา");
    educationText = `กำลังศึกษาอยู่ (${lvl})\n<i>สาขา</i> ${major}`;
  }

  // 8 วันที่พร้อมเริ่มงาน
  let startDateText = "N/A";
  if (data.start_date_type === "specific") {
    startDateText = `วันที่ ${escape(data.specific_start_date) || "ไม่ได้ระบุ"}`;
  } else {
    startDateText = "พร้อมเริ่มงานได้ทันที";
  }

  // 9 ตัวเลือกเวลา (สาขาอมตะนคร Part Time)
  let availabilityText = "N/A";
  if (data.availability_choice) {
    availabilityText = escape(data.availability_choice);
  }

  // 10 ประกอบข้อความหลัก
  let text = `<b>🔔 มีใบสมัครงานใหม่</b>\n\n`;
  text += `<b>ตำแหน่ง</b> ${escape(data.position)}\n`;
  text += `<b>ชื่อ นามสกุล</b> ${escape(data.first_name)} ${escape(data.last_name)} (${escape(data.nickname)})\n`;
  text += `<b>อายุ น้ำหนัก ส่วนสูง</b> ${escape(data.age)} ปี / ${escape(data.weight)} กก. / ${escape(data.height)} ซม.\n`;
  text += `<b>ติดต่อ</b> ${escape(data.phone)} (Line ${escape(data.line_id)})\n`;
  text += `<b>การศึกษา</b> ${educationText}\n`;
  text += `<b>ที่อยู่</b> ${escape(data.address)}\n`;
  text += `<b>พร้อมเริ่มงาน</b> ${startDateText}\n`;

  // แสดงเฉพาะตำแหน่งที่มีตัวเลือกเวลา (สาขาอมตะนคร Part Time)
  if (positionKey === "AMATA_PT") {
    text += `<b>เวลาที่สะดวก (อมตะนคร)</b> ${availabilityText}\n`;
  }

  text += `<b>ประวัติการทำงาน</b> ${workHistoryText}\n\n`;

  if (data.photo_url) {
    text += `<a href="${escape(data.photo_url)}"><b>🔗 ดูรูปถ่ายผู้สมัคร</b></a>`;
  } else {
    text += `<b>🔗 ดูรูปถ่ายผู้สมัคร</b> <i>ไม่มีการแนบไฟล์</i>`;
  }

  // 11 ยิงไป Telegram
  const telegramURL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  const sendTelegram = async (endpoint, payload) => {
    const res = await fetch(`${telegramURL}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`Telegram API error ${endpoint} ${res.status} ${res.statusText}`);
    }
  };

  try {
    if (data.photo_url) {
      const caption =
        `ใบสมัครงานจาก <b>${escape(data.first_name)} ${escape(data.last_name)}</b>\n` +
        `ตำแหน่ง <b>${escape(data.position)}</b>`;

      await sendTelegram("sendPhoto", {
        chat_id: targetChatId,
        photo: data.photo_url,
        caption,
        parse_mode: "HTML"
      });
    }

    await sendTelegram("sendMessage", {
      chat_id: targetChatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false
    });

    return { statusCode: 200, body: JSON.stringify({ message: "Success" }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ message: err.message }) };
  }
};
