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

const MO_CONFIG = {
    userId: 'C1505',
    secret: 'aed960bc3a1f896c16bc4b35ed09071c7e246951dff849b438ab68d39bfc5007',
    baseUrl: 'https://mesinotomatis.com/api/bank/'
};

const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// 🛠️ UTILITY FUNCTIONS
// ==========================================

const generateUniqueId = () => Math.floor(100000 + Math.random() * 900000).toString();

function formatToWA(phone) {
    if (!phone) return "";
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '62' + cleaned.substring(1);
    else if (cleaned.startsWith('8')) cleaned = '62' + cleaned;
    return `whatsapp:+${cleaned}`;
}

async function checkMutationMO(bankCode, accountNumber, targetAmount) {
    try {
        const params = new URLSearchParams();
        params.append('inquiry', 'CHECK.MUTATION');
        params.append('bank', bankCode.toLowerCase());
        params.append('account', accountNumber);
        params.append('reference', 'amount');
        params.append('key', targetAmount.toString());

        const response = await axios.post(MO_CONFIG.baseUrl, params, {
            headers: {
                'mo-userid': MO_CONFIG.userId,
                'mo-secret': MO_CONFIG.secret,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const data = response.data;
        if (data.result === 'success' && data.message && data.message.length > 0) {
            return data.message.find(m => parseInt(m.amount) === parseInt(targetAmount) && m.type === 'K');
        }
        return null;
    } catch (error) {
        console.error("MO API Error:", error.message);
        return null;
    }
}

// ==========================================
// 🚀 ENDPOINTS
// ==========================================

// 1. Inquiry Bank
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

// 2. Submit Transfer & Initial Check
app.post('/submit-transfer', upload.single('foto_ktp'), async (req, res) => {
    try {
        const {
            nama_pengirim, whatsapp, bank_tujuan, rekening_tujuan,
            nama_penerima, rekening_admin_bank, rekening_admin_no,
            nominal, kode_unik, total_bayar, catatan
        } = req.body;

        const fotoKtpBuffer = req.file ? req.file.buffer : null;
        const totalFormatted = `Rp ${parseInt(total_bayar).toLocaleString('id-ID')}`;

        const sql = `INSERT INTO transaksi_flip 
            (nama_pengirim, whatsapp_pengirim, bank_tujuan, rekening_tujuan, nama_penerima, 
             rekening_admin_bank, rekening_admin_no, nominal_transfer, kode_unik, total_bayar, catatan, foto_ktp, status_transaksi) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`;

        const [result] = await db.execute(sql, [
            nama_pengirim, whatsapp, bank_tujuan, rekening_tujuan, nama_penerima,
            rekening_admin_bank, rekening_admin_no,
            parseInt(nominal), parseInt(kode_unik), parseInt(total_bayar), catatan || null, fotoKtpBuffer
        ]);

        const orderId = result.insertId;

        // Cek Mutasi Langsung
        const isPaid = await checkMutationMO(rekening_admin_bank, rekening_admin_no, total_bayar);
        let statusMsg = "Menunggu Verifikasi Manual";

        if (isPaid) {
            await db.execute("UPDATE transaksi_flip SET status_transaksi = 'SUCCESS' WHERE id = ?", [orderId]);
            statusMsg = "TERVERIFIKASI OTOMATIS";
        }

        // Notifikasi WA Admin & User (Opsional: jalankan async agar respon cepat)
        const sendNotifications = async () => {
            try {
                // WA Admin
                await twilioClient.messages.create({
                    from: TWILIO_WA_NUMBER,
                    to: ADMIN_WA,
                    contentSid: 'HX99e559b9adb630024681d0172f3176ac',
                    contentVariables: JSON.stringify({
                        "1": nama_pengirim, "2": whatsapp, "3": rekening_admin_bank, "4": rekening_admin_no,
                        "5": bank_tujuan, "6": rekening_tujuan, "7": nama_penerima, "8": totalFormatted,
                        "9": `Status: ${statusMsg} | Catatan: ${catatan || "-"}`
                    })
                });
                // WA User
                await twilioClient.messages.create({
                    from: TWILIO_WA_NUMBER,
                    to: formatToWA(whatsapp),
                    contentSid: 'HXd07c512d9aba38d44109fdf0828941ae',
                    contentVariables: JSON.stringify({
                        "1": nama_pengirim, "2": rekening_admin_bank, "3": rekening_admin_no,
                        "4": totalFormatted, "5": bank_tujuan, "6": rekening_tujuan, "7": nama_penerima
                    })
                });
            } catch (e) { console.error("Notification Error:", e.message); }
        };
        sendNotifications();

        res.json({
            status: 'success',
            id: orderId,
            auto_verified: !!isPaid,
            message: isPaid ? "Pembayaran ditemukan!" : "Menunggu verifikasi manual."
        });

    } catch (err) {
        console.error("Submit Error:", err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// 3. Polling Endpoint (Check Status & Re-verify)
app.get('/check-status/:id', async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT * FROM transaksi_flip WHERE id = ?", [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ message: "Not found" });

        let transaction = rows[0];

        // Jika masih pending, coba cek mutasi lagi
        if (transaction.status_transaksi === 'PENDING') {
            const isPaidNow = await checkMutationMO(transaction.rekening_admin_bank, transaction.rekening_admin_no, transaction.total_bayar);
            if (isPaidNow) {
                await db.execute("UPDATE transaksi_flip SET status_transaksi = 'SUCCESS' WHERE id = ?", [req.params.id]);
                transaction.status_transaksi = 'SUCCESS';
            }
        }

        res.json({ status_transaksi: transaction.status_transaksi });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. View KTP
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