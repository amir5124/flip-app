require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mysql = require('mysql2/promise');
const multer = require('multer');
const twilio = require('twilio');
const nodemailer = require('nodemailer');
const moment = require('moment-timezone');

const app = express();

// ==========================================
// 🔐 KONFIGURASI & MIDDLEWARE
// ==========================================

const corsOptions = {
    origin: '*',
    methods: 'GET, POST, PUT, DELETE',
    allowedHeaders: 'Content-Type, Authorization'
};
app.use(cors(corsOptions));
app.use(express.json());

const db = mysql.createPool({
    host: '103.55.39.44',
    user: 'linkucoi_klikoo',
    password: 'E+,,zAIh6VNI',
    database: 'linkucoi_klikoo',
    waitForConnections: true,
    connectionLimit: 10
});

const DEFAULT_EMAIL = 'linkutransport@gmail.com';
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: DEFAULT_EMAIL, pass: 'qbckptzxgdumxtdm' }
});

const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_WA_NUMBER = 'whatsapp:+62882005447472';
const ADMIN_WA = 'whatsapp:+6282323907426';

const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// 🛠️ UTILITY FUNCTIONS
// ==========================================

const generateUniqueId = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

function formatToWA(phone) {
    if (!phone) return "";
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1);
    else if (cleaned.startsWith('8')) cleaned = '62' + cleaned;
    return `whatsapp:+${cleaned}`;
}

// ==========================================
// 🚀 ENDPOINTS
// ==========================================

// 1. Inquiry Bank (Cek Nama)
app.get('/inquirybank', async (req, res) => {
    const { kodeproduk, tujuan, jenis } = req.query;
    const params = {
        id: "AR25083", pin: "0986", user: "D66538", pass: "61399D",
        kodeproduk, tujuan, counter: "1", idtrx: generateUniqueId(), jenis
    };
    try {
        const response = await axios.get("http://103.102.15.203:9494/api/h2h", { params });
        res.send(response.data);
    } catch (error) {
        res.status(500).send("Error during inquiry");
    }
});

// 2. Submit Transfer (Simpan & Notifikasi)
app.post('/submit-transfer', upload.single('foto_ktp'), async (req, res) => {
    try {
        const {
            nama_pengirim,
            whatsapp,
            bank_tujuan,
            rekening_tujuan,
            nama_penerima,
            rekening_admin_bank, // Kolom baru
            rekening_admin_no,   // Kolom baru
            nominal,
            kode_unik,
            total_bayar,
            catatan
        } = req.body;

        const fotoKtpBuffer = req.file ? req.file.buffer : null;
        const totalFormatted = `Rp ${parseInt(total_bayar).toLocaleString('id-ID')}`;

        // A. Simpan ke Database (Tabel Updated)
        const sql = `INSERT INTO transaksi_flip 
            (nama_pengirim, whatsapp_pengirim, bank_tujuan, rekening_tujuan, nama_penerima, 
             rekening_admin_bank, rekening_admin_no, nominal_transfer, kode_unik, total_bayar, catatan, foto_ktp) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const [result] = await db.execute(sql, [
            nama_pengirim, whatsapp, bank_tujuan, rekening_tujuan, nama_penerima,
            rekening_admin_bank, rekening_admin_no,
            parseInt(nominal), parseInt(kode_unik), parseInt(total_bayar), catatan || null, fotoKtpBuffer
        ]);

        const orderId = result.insertId;

        // B. Format Pesan Detail (Sesuai Kebutuhan)
        const pesanDetail = `📌 *DETAIL TRANSAKSI #${orderId}*\n\n` +
            `👤 *Pengirim:* ${nama_pengirim}\n` +
            `📱 *WhatsApp:* ${whatsapp}\n` +
            `🏦 *Ke Rekening Flip:* ${rekening_admin_bank} (${rekening_admin_no})\n` +
            `---------------------------\n` +
            `🎯 *Tujuan Transfer:* ${bank_tujuan}\n` +
            `💳 *No. Rekening:* ${rekening_tujuan}\n` +
            `✍️ *Atas Nama:* ${nama_penerima}\n` +
            `💰 *Total Bayar:* ${totalFormatted}\n` +
            `📝 *Catatan:* ${catatan || '-'}\n\n`;

        // C. Kirim WhatsApp Admin
        try {
            await twilioClient.messages.create({
                from: TWILIO_WA_NUMBER,
                to: ADMIN_WA,
                body: `🔔 *PESANAN BARU*\n\n${pesanDetail}Cek mutasi pada rekening ${rekening_admin_bank}!`
            });
        } catch (e) { console.error("WA Admin Error"); }

        // D. Kirim WhatsApp Pengirim
        try {
            await twilioClient.messages.create({
                from: TWILIO_WA_NUMBER,
                to: formatToWA(whatsapp),
                body: `Halo *${nama_pengirim}*,\n\nPermintaan transfer Anda sedang *DIVERIFIKASI*.\n\n${pesanDetail}Pastikan Anda telah transfer tepat *${totalFormatted}* ke rekening ${rekening_admin_bank} kami.`
            });
        } catch (e) { console.error("WA User Error"); }

        // E. Kirim Email Admin (Lampiran KTP)
        const mailOptions = {
            from: `"Flip System" <${DEFAULT_EMAIL}>`,
            to: DEFAULT_EMAIL,
            subject: `🔥 [TF #${orderId}] ${nama_pengirim} -> ${bank_tujuan}`,
            html: `<h3>Detail Transaksi Baru</h3>` + pesanDetail.replace(/\n/g, '<br>'),
            attachments: fotoKtpBuffer ? [{ filename: `KTP_${nama_pengirim}.jpg`, content: fotoKtpBuffer }] : []
        };
        await transporter.sendMail(mailOptions);

        res.json({ status: 'success', id: orderId });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/view-ktp/:id', async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT foto_ktp FROM transaksi_flip WHERE id = ?", [req.params.id]);
        if (rows.length === 0 || !rows[0].foto_ktp) return res.status(404).send("Not Found");
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(rows[0].foto_ktp);
    } catch (err) { res.status(500).send("Error"); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server berjalan di port ${PORT}`));