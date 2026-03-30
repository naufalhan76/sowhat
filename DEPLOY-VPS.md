# 🚀 Panduan Deployment Solofleet ke VPS

Panduan ini berisi langkah-langkah untuk memindahkan project Solofleet dari komputer lokal kamu (Windows) ke dalam VPS (Virtual Private Server) berbasis Linux (seperti Ubuntu/Debian), dan menjalankannya agar online 24/7 menggunakan **PM2**.

---

## 📋 Langkah 1: Persiapan di VPS
Pastikan VPS kamu sudah terinstall **Node.js** dan **npm**. Jika belum, jalankan perintah ini di terminal VPS kamu:

```bash
# Update package list
sudo apt update

# Install Node.js (Versi 20.x atau 22.x disarankan)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Install **PM2** secara global di VPS:
```bash
sudo npm install -g pm2
```

---

## 📦 Langkah 2: Pindahkan Project ke VPS
Kamu bisa memindahkan file menggunakan **Git** (paling disarankan) ataupun **SCP / SFTP** (FileZilla).

### Opsi A: Menggunakan Git (Disarankan)
Jika project kamu sudah di-push ke GitHub/GitLab:
```bash
git clone <URL_REPO_KAMU> solofleet
cd solofleet
```

### Opsi B: Menggunakan SCP (Upload manual dari laptop lokal)
Buka terminal/PowerShell di **komputer lokal** kamu (di folder project A:\Solofleet), lalu ketik:
```bash
# Ganti user@ip_vps dengan username dan IP VPS kamu
# PERHATIAN: Jangan sertakan folder node_modules!
scp -r ./* user@ip_vps:~/solofleet/
```
Atau cukup gunakan aplikasi seperti **FileZilla** untuk drag-and-drop file ke VPS. Pastikan tidak membawa folder `node_modules` atau folder `.git`.

---

## ⚙️ Langkah 3: Setup Konfigurasi (.env)
Karena kita tidak mengirim file `.env` (sudah di-ignore oleh Git), kita wajib membuatnya di VPS:

1. Masuk ke folder project di VPS:
   ```bash
   cd ~/solofleet
   ```
2. Buat file `.env` baru:
   ```bash
   nano .env
   ```
3. Input data berikut (Sesuaikan dengan kredensial Supabase kamu):
   ```properties
   PORT=3000
   SUPABASE_URL=URL_SUPABASE_KAMU
   SUPABASE_SERVICE_ROLE_KEY=KODE_SERVICE_ROLE_KAMU
   ```
4. Simpan file (`Ctrl+X`, ketik `Y`, lalu `Enter`).

---

## 🔨 Langkah 4: Install Dependencies & Build Frontend
Di dalam folder project VPS (`~/solofleet`), instal semua package NPM yang dibutuhkan dan build file antarmuka (frontend).

```bash
# Install module backend & frontend
npm install

# Build file frontend React (Vite)
npm run build
```
*(Catatan: `npm run build` wajib dijalankan agar hasil generate UI React masuk ke folder `web-dist`, yang nantinya akan disajikan oleh `server.js`)*

---

## 🚀 Langkah 5: Jalankan Aplikasi Menggunakan PM2
Agar aplikasi berjalan otomatis di background, otomatis restart jika terjadi error/crash, dan menyala saat VPS direboot, kita siapkan PM2:

1. **Jalankan aplikasi:**
   ```bash
   pm2 start server.js --name "solofleet"
   ```

2. **Periksa status jalannya aplikasi:**
   ```bash
   pm2 status
   # atau untuk melihat log proses:
   pm2 logs solofleet
   ```

3. **Buat PM2 otomatis menyala sewaktu VPS Reboot:**
   Jalankan perintah ini:
   ```bash
   pm2 startup
   ```
   *(PM2 akan memberikan sebuah perintah baru di layar. Copy perintah tersebut dan paste lagi ke terminal, lalu Enter).*
   
   Simpan daftar PM2 saat ini:
   ```bash
   pm2 save
   ```

---

## ✅ Selesai!
Sekarang aplikasi kamu sudah berjalan tanpa henti di VPS pada port **3000**.
Kamu bisa mengeceknya dari browser dengan membuka:
`http://IP_VPS_KAMU:3000`

### Perintah Berguna PM2 
Jika suatu saat ada update kode / fitur baru:
- `pm2 restart solofleet` (Untuk merestart aplikasi setelah update kode)
- `pm2 stop solofleet` (Untuk mematikan aplikasi)
- `pm2 logs solofleet` (Untuk melihat pesan error jika aplikasi bermasalah)
- `pm2 monit` (Untuk melihat penggunaan CPU dan RAM backend)