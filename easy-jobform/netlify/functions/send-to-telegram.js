// ไฟล์: netlify/functions/send-to-telegram.js

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const {
    TELEGRAM_BOT_TOKEN,
    CHAT_ID_AOAUDOM_PT,
    CHAT_ID_AMATA_WEEKEND_PT,
    CHAT_ID_PHRAYA_PT,
    TELEGRAM_CHAT_ID
  } = process.env;

  if (!TELEGRAM_BOT_TOKEN) {
    return { statusCode: 500, body: "Missing Bot Token environment variable" };
  }

  const data = JSON.parse(event.body || "{}");
  const positionText = data.position || "";

  const detectPositionKey = (text) => {
    const t = String(text || "");
    if (t.includes("อ่าวอุดม")) return "AOAUDOM_FT";
    if (t.includes("อมตะนคร")) return "AMATA_PT";
    if (t.includes("พระยาสัจจา")) return "PHRAYA_PT";
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
    case "PHRAYA_PT":
      targetChatId = CHAT_ID_PHRAYA_PT || TELEGRAM_CHAT_ID;
      break;
    default:
      targetChatId = TELEGRAM_CHAT_ID || CHAT_ID_AOAUDOM_PT;
      break;
  }

  const escape = (str) => {
    if (!str) return "N/A";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };

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

  let educationText = escape(data.education);
  if (data.education === "กำลังศึกษาอยู่") {
    const lvl = escape(data.studying_level || "ไม่ได้ระบุระดับ");
    const major = escape(data.studying_major || "ไม่ได้ระบุสาขา");
    educationText = `กำลังศึกษาอยู่ (${lvl})\n<i>สาขา</i> ${major}`;
  }

  let startDateText = "N/A";
  if (data.start_date_type === "specific") {
    startDateText = `วันที่ ${escape(data.specific_start_date) || "ไม่ได้ระบุ"}`;
  } else {
    startDateText = "พร้อมเริ่มงานได้ทันที";
  }

  let availabilityText = "N/A";
  if (data.availability_choice) {
    availabilityText = escape(data.availability_choice);
  }

  // เตรียมข้อความทั้งหมดที่จะส่ง
  let text = `<b>🔔 ใบสมัครงานใหม่</b>\n\n`;
  text += `<b>ตำแหน่ง:</b> ${escape(data.position)}\n`;
  text += `<b>ชื่อ:</b> ${escape(data.first_name)} ${escape(data.last_name)} (${escape(data.nickname)})\n`;
  text += `<b>อายุ:</b> ${escape(data.age)} ปี <b>น้ำหนัก:</b> ${escape(data.weight)} กก. <b>ส่วนสูง:</b> ${escape(data.height)} ซม.\n`;
  text += `<b>ติดต่อ:</b> ${escape(data.phone)} (Line: ${escape(data.line_id)})\n`;
  text += `<b>การศึกษา:</b> ${educationText}\n`;
  text += `<b>ที่อยู่:</b> ${escape(data.address)}\n`;
  text += `<b>เริ่มงาน:</b> ${startDateText}\n`;

  if (positionKey === "AMATA_PT" || positionKey === "PHRAYA_PT") {
    text += `<b>เวลาที่สะดวก:</b> ${availabilityText}\n`;
  }

  text += `<b>ประวัติการทำงาน:</b> ${workHistoryText}`;

  const telegramURL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  try {
    if (data.photo_base64 && data.photo_base64.startsWith("data:image")) {
      // ดึงเฉพาะเนื้อหาไฟล์ออกมา (ตัด "data:image/jpeg;base64," ทิ้ง)
      const base64Data = data.photo_base64.split(",")[1];
      const buffer = Buffer.from(base64Data, "base64");

      const formData = new FormData();
      formData.append("chat_id", targetChatId);
      formData.append("photo", new Blob([buffer], { type: "image/jpeg" }), "photo.jpg");
      
      // ป้องกันข้อความยาวเกิน 1,024 ตัวอักษร (ข้อจำกัด Caption ของ Telegram)
      let finalCaption = text;
      if (finalCaption.length > 1024) {
        finalCaption = finalCaption.substring(0, 1020) + "...";
      }

      formData.append("caption", finalCaption);
      formData.append("parse_mode", "HTML");

      const photoRes = await fetch(`${telegramURL}/sendPhoto`, {
        method: "POST",
        body: formData
      });

      if (!photoRes.ok) {
        throw new Error("Failed to send photo");
      }
    } else {
      // ถ้าไม่มีรูป ให้ส่งแบบข้อความธรรมดา
      text += `\n\n<i>⚠️ ผู้สมัครไม่ได้แนบรูปถ่าย หรือเกิดข้อผิดพลาดในการโหลดรูป</i>`;
      
      const textRes = await fetch(`${telegramURL}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: targetChatId,
          text,
          parse_mode: "HTML"
        })
      });

      if (!textRes.ok) {
        throw new Error("Failed to send message");
      }
    }

    return { statusCode: 200, body: JSON.stringify({ message: "Success" }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ message: err.message }) };
  }
};
