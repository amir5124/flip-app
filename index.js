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
// 🚀 ENDPOINT 1: INQUIRY BANK (Cek Nama)
// ==========================================

app.get('/inquirybank', async (req, res) => {
    const { kodeproduk, tujuan, jenis } = req.query;

    // Konfigurasi API Vendor
    const params = {
        id: "AR25083",
        pin: "0986",
        user: "D66538",
        pass: "61399D",
        kodeproduk: kodeproduk,
        tujuan: tujuan,
        counter: "1",
        idtrx: generateUniqueId(),
        jenis: jenis,
    };

    try {
        const response = await axios.get("http://103.102.15.203:9494/api/h2h", { params });
        console.log("Inquiry Response:", JSON.stringify(response.data));
        res.send(response.data);
    } catch (error) {
        console.error("Error during inquiry:", error.message);
        res.status(500).send("Error during inquiry");
    }
});

// ==========================================
// 🚀 ENDPOINT 2: SUBMIT TRANSFER & NOTIFIKASI
// ==========================================

app.post('/submit-transfer', upload.single('foto_ktp'), async (req, res) => {
    try {
        const {
            nama_pengirim,
            whatsapp,
            bank_tujuan,
            rekening_tujuan,
            nama_penerima,
            nominal,
            kode_unik,
            total_bayar,
            catatan
        } = req.body;

        const fotoKtpBuffer = req.file ? req.file.buffer : null;
        const totalFormatted = `Rp ${parseInt(total_bayar).toLocaleString('id-ID')}`;

        // 1. Simpan ke Database
        const sql = `INSERT INTO transaksi_flip 
            (nama_pengirim, whatsapp_pengirim, bank_tujuan, rekening_tujuan, nama_penerima, nominal_transfer, kode_unik, total_bayar, catatan, foto_ktp) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const [result] = await db.execute(sql, [
            nama_pengirim, whatsapp, bank_tujuan, rekening_tujuan,
            nama_penerima, parseInt(nominal), parseInt(kode_unik),
            parseInt(total_bayar), catatan || null, fotoKtpBuffer
        ]);

        const orderId = result.insertId;

        // 2. Format Pesan Detail
        const pesanDetail = `📌 *DETAIL TRANSAKSI #${orderId}*\n\n` +
            `👤 *Pengirim:* ${nama_pengirim}\n` +
            `📱 *WhatsApp:* ${whatsapp}\n` +
            `🏦 *Bank Tujuan:* ${bank_tujuan}\n` +
            `💳 *No. Rekening:* ${rekening_tujuan}\n` +
            `✍️ *Atas Nama:* ${nama_penerima}\n` +
            `💰 *Total Bayar:* ${totalFormatted}\n` +
            `📝 *Catatan:* ${catatan || '-'}\n\n`;

        // 3. Notifikasi WA ke ADMIN
        try {
            await twilioClient.messages.create({
                from: TWILIO_WA_NUMBER,
                to: ADMIN_WA,
                body: `🔔 *TRANSAKSI BARU MASUK*\n\n${pesanDetail}Mohon segera verifikasi bukti transfer dan data KTP.`
            });
        } catch (e) { console.error("WA Admin Error:", e.message); }

        // 4. Notifikasi WA ke PENGIRIM
        try {
            const userWA = formatToWA(whatsapp);
            await twilioClient.messages.create({
                from: TWILIO_WA_NUMBER,
                to: userWA,
                body: `Halo *${nama_pengirim}*,\n\nTerima kasih! Transaksi Anda sedang kami *DIVERIFIKASI*. Tim kami akan segera memproses transfer Anda.\n\n${pesanDetail}Harap simpan struk transfer Anda jika sewaktu-waktu diperlukan.`
            });
        } catch (e) { console.error("WA User Error:", e.message); }

        // 5. Notifikasi Email ke ADMIN (dengan Lampiran KTP)
        const mailOptions = {
            from: `"Sistem Transfer Flip" <${DEFAULT_EMAIL}>`,
            to: DEFAULT_EMAIL,
            subject: `🔥 [NEW] Transaksi #${orderId} - ${nama_pengirim}`,
            html: `<h3>Detail Transaksi Baru #${orderId}</h3>` + pesanDetail.replace(/\n/g, '<br>'),
            attachments: fotoKtpBuffer ? [{ filename: `KTP_${nama_pengirim}.jpg`, content: fotoKtpBuffer }] : []
        };
        await transporter.sendMail(mailOptions);

        res.json({ status: 'success', message: 'Data tersimpan dan notifikasi terkirim', id: orderId });

    } catch (err) {
        console.error("Submit Error:", err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});


app.get('/view-ktp/:id', async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT foto_ktp FROM transaksi_flip WHERE id = ?", [req.params.id]);
        if (rows.length === 0 || !rows[0].foto_ktp) return res.status(404).send("Foto tidak ditemukan");
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(rows[0].foto_ktp);
    } catch (err) { res.status(500).send("Error fetching image"); }
});

// Jalankan Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Flip Server running on port ${PORT}`));