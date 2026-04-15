// ไฟล์: netlify/functions/send-to-telegram.js

exports.handler = async (event) => {
  // 1 ตรวจสอบ Method
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // 2 ดึง Environment Variables
  const {
    TELEGRAM_BOT_TOKEN,

    // แยก 4 ห้องตาม "ตำแหน่ง"
    CHAT_ID_BANGSAEN_FULLTIME, // บางแสน - พนักงานประจำสาขา
    CHAT_ID_BANGSAEN_SUN_PT,   // บางแสน - พาร์ทไทม์เฉพาะอาทิตย์
    CHAT_ID_AOAUDOM_PT,        // อ่าวอุดม - พาร์ทไทม์
    CHAT_ID_AMATA_WEEKEND_PT,  // อมตะนคร - พาร์ทไทม์เสาร์-อาทิตย์

    // ห้องกลาง (สำรอง)
    TELEGRAM_CHAT_ID
  } = process.env;

  if (
    !TELEGRAM_BOT_TOKEN ||
    !CHAT_ID_BANGSAEN_FULLTIME ||
    !CHAT_ID_BANGSAEN_SUN_PT ||
    !CHAT_ID_AOAUDOM_PT || 
    !CHAT_ID_AMATA_WEEKEND_PT
  ) {
    return { statusCode: 500, body: "Missing environment variables" };
  }

  // 3 ดึงข้อมูลจาก body
  const data = JSON.parse(event.body || "{}");
  const positionText = data.position || "";

  // 4 เลือกห้องปลายทางตาม "ตำแหน่ง"
  const detectPositionKey = (text) => {
    const t = String(text || "");

    // บางแสน - พนักงานประจำสาขา
    if (t.includes("บางแสน") && (t.includes("ประจำ") || t.includes("Fulltime") || t.includes("FULLTIME"))) {
      return "BANGSAEN_FULLTIME";
    }

    // บางแสน - พาร์ทไทม์เฉพาะอาทิตย์ (วันละ 475)
    if (t.includes("บางแสน") && (t.includes("เฉพาะวันอาทิตย์") || t.includes("วันละ 475") || t.includes("475"))) {
      return "BANGSAEN_SUN_PT";
    }

    // อ่าวอุดม - พาร์ทไทม์ (อัปเดตคีย์เวิร์ดใหม่)
    if (t.includes("อ่าวอุดม")) {
      return "AOAUDOM_PT";
    }

    // อมตะนคร - พาร์ทไทม์เสาร์-อาทิตย์
    if (t.includes("อมตะนคร")) {
      return "AMATA_WEEKEND_PT";
    }

    return "UNKNOWN";
  };

  const positionKey = detectPositionKey(positionText);

  let targetChatId;
  switch (positionKey) {
    case "BANGSAEN_FULLTIME":
      targetChatId = CHAT_ID_BANGSAEN_FULLTIME;
      break;
    case "BANGSAEN_SUN_PT":
      targetChatId = CHAT_ID_BANGSAEN_SUN_PT;
      break;
    case "AOAUDOM_PT":
      targetChatId = CHAT_ID_AOAUDOM_PT;
      break;
    case "AMATA_WEEKEND_PT":
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

      // ถ้าไม่มีอะไรกรอกเลยในงานที่ i ให้ข้ามได้
      if (!workplace && !position && !description) continue;

      workHistoryText += `<b>${i}. ${escape(workplace || "ไม่ระบุสถานที่ทำงาน")}</b>\n`;
      workHistoryText += `   <i>ตำแหน่ง</i> ${escape(position || "N/A")}\n`;
      workHistoryText += `   <i>สิ่งที่ทำ</i> ${escape(description || "N/A")}\n`;
    }
  }

  // 7 การศึกษา (รองรับ "กำลังศึกษาอยู่")
  let educationText = escape(data.education);
  if (data.education === "กำลังศึกษาอยู่") {
    const lvl = escape(data.studying_level || "ไม่ได้ระบุระดับ");
    const major = escape(data.studying_major || "ไม่ได้ระบุสาขา");
    educationText = `กำลังศึกษาอยู่ (${lvl})\n<i>สาขา</i> ${major}`;
  }

  // 8 วันที่พร้อมเริ่มงาน (ปรับให้ดึงจาก Form หรือใช้ "พร้อมเริ่มงานได้ทันที" เลย)
  let startDateText = "N/A";

  if (data.start_date_type === "specific") {
    startDateText = `วันที่ ${escape(data.specific_start_date) || "ไม่ได้ระบุ"}`;
  } else {
    // immediate -> ตอนนี้ทุกสาขาพร้อมเริ่มงานทันทีหมดแล้ว
    startDateText = "พร้อมเริ่มงานได้ทันที";
  }

  // 9 ความพร้อมสาขาอ่าวอุดม (อัปเดตตัวแปรใหม่)
  let aoaudomAvailabilityText = "N/A";
  if (data.aoaudom_availability) {
    aoaudomAvailabilityText = escape(data.aoaudom_availability);
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

  // แสดงเฉพาะเคสสาขาอ่าวอุดมเท่านั้นที่มีคำถามเรื่องเวลา
  if (positionKey === "AOAUDOM_PT") {
    text += `<b>เวลาที่สะดวก (อ่าวอุดม)</b> ${aoaudomAvailabilityText}\n`;
  }

  text += `<b>ประวัติการทำงาน</b> ${workHistoryText}\n\n`;

  if (data.photo_url) {
    text += `<a href="${escape(data.photo_url)}"><b>🔗 ดูรูปถ่ายผู้สมัคร</b></a>`;
  } else {
    text += `<b>🔗 ดูรูปถ่ายผู้สมัคร</b> <i>ไม่มีการแนบไฟล์</i>`;
  }

  // 11 ฟังก์ชันยิงไป Telegram
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
    // ส่งรูปก่อน ถ้ามี
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

    // ส่งข้อความรายละเอียด
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
