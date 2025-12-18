require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mysql = require('mysql2/promise');
const multer = require('multer');
const twilio = require('twilio');
const nodemailer = require('nodemailer');


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
            rekening_admin_bank,
            rekening_admin_no,
            nominal,
            kode_unik,
            total_bayar,
            catatan
        } = req.body;

        const fotoKtpBuffer = req.file ? req.file.buffer : null;
        const totalFormatted = `Rp ${parseInt(total_bayar).toLocaleString('id-ID')}`;

        // A. Simpan ke Database
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

        // B. Desain Email Admin
        const emailDesignHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
                <div style="background-color: #f97316; padding: 20px; text-align: center; color: white;">
                    <h1 style="margin: 0;">Transaksi Baru #${orderId}</h1>
                </div>
                <div style="padding: 20px;">
                    <p><b>Pelanggan:</b> ${nama_pengirim}</p>
                    <p><b>WA:</b> ${whatsapp}</p>
                    <p><b>Transfer Ke:</b> ${rekening_admin_bank} (${rekening_admin_no})</p>
                    <hr>
                    <p><b>Target:</b> ${bank_tujuan} - ${rekening_tujuan}</p>
                    <p><b>A/n:</b> ${nama_penerima}</p>
                    <p style="font-size: 18px; color: #f97316;"><b>Total: ${totalFormatted}</b></p>
                </div>
            </div>`;

        // C. Kirim WA Admin (9 Variabel)
        try {
            await twilioClient.messages.create({
                from: TWILIO_WA_NUMBER,
                to: ADMIN_WA,
                contentSid: 'HX99e559b9adb630024681d0172f3176ac',
                contentVariables: JSON.stringify({
                    "1": nama_pengirim,
                    "2": whatsapp,
                    "3": rekening_admin_bank,
                    "4": rekening_admin_no,
                    "5": bank_tujuan,
                    "6": rekening_tujuan,
                    "7": nama_penerima,
                    "8": totalFormatted,
                    "9": catatan || "-"
                })
            });
        } catch (e) { console.error("WA Admin Error:", e.message); }

        // D. Kirim WA Pengguna (7 Variabel)
        try {
            await twilioClient.messages.create({
                from: TWILIO_WA_NUMBER,
                to: formatToWA(whatsapp),
                contentSid: 'HXd07c512d9aba38d44109fdf0828941ae', // Gunakan SID template user yang baru disetujui
                contentVariables: JSON.stringify({
                    "1": nama_pengirim,
                    "2": rekening_admin_bank,
                    "3": rekening_admin_no,
                    "4": totalFormatted,
                    "5": bank_tujuan,
                    "6": rekening_tujuan,
                    "7": nama_penerima
                })
            });
        } catch (e) { console.error("WA User Error:", e.message); }

        // E. Kirim Email Admin
        await transporter.sendMail({
            from: `"Flip System" <${DEFAULT_EMAIL}>`,
            to: DEFAULT_EMAIL,
            subject: `🔥 [TF #${orderId}] ${nama_pengirim}`,
            html: emailDesignHtml,
            attachments: fotoKtpBuffer ? [{ filename: `KTP_${nama_pengirim}.jpg`, content: fotoKtpBuffer }] : []
        });

        res.json({ status: 'success', id: orderId });

    } catch (err) {
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