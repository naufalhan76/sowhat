# Deploy Solofleet ke VPS + PostgreSQL

Panduan ini buat menjalankan dashboard di VPS Linux dengan:
- Node.js
- PM2
- Nginx
- PostgreSQL self-hosted
- custom domain

App sekarang mendukung mode storage prioritas:
1. `PostgreSQL`
2. file lokal `.json`

Kalau `DATABASE_URL` tersedia, app akan otomatis pakai PostgreSQL sebagai storage utama dan mencoba migrasi data lama dari JSON saat startup pertama.

## 1. Install dependency dasar di VPS

```bash
sudo apt update
sudo apt install -y curl git nginx postgresql postgresql-contrib
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 2. Clone project

```bash
cd /var/www
sudo git clone https://github.com/naufalhan76/sowhat.git solofleet
cd solofleet
npm install
```

## 3. Buat database PostgreSQL

Masuk ke user postgres:

```bash
sudo -u postgres psql
```

Lalu buat database dan user:

```sql
create database solofleet;
create user solofleet_app with encrypted password 'GANTI_PASSWORD_DB';
grant all privileges on database solofleet to solofleet_app;
\c solofleet
grant all on schema public to solofleet_app;
alter default privileges in schema public grant all on tables to solofleet_app;
alter default privileges in schema public grant all on sequences to solofleet_app;
```

Keluar dari `psql`:

```sql
\q
```

## 4. Buat file `.env`

Di root project:

```bash
nano .env
```

Isi minimal:

```env
PORT=3001
HOST=127.0.0.1
DATABASE_URL=postgresql://solofleet_app:GANTI_PASSWORD_DB@127.0.0.1:5432/solofleet
```

Catatan:
- `DATABASE_URL` membuat app pindah ke PostgreSQL.

## 5. Build frontend

```bash
npm run build
```

## 6. Jalankan app

```bash
pm2 start server.js --name sowhat
pm2 save
pm2 startup
```

Cek log:

```bash
pm2 logs sowhat
```

Saat boot pertama, cek log untuk pesan seperti:
- `Migrating config to PostgreSQL...`
- `Migrating state to PostgreSQL...`
- `Completed auto-migration of local data to PostgreSQL.`

## 7. Setup Nginx reverse proxy

Buat config:

```bash
sudo nano /etc/nginx/sites-available/solofleet
```

Isi:

```nginx
server {
    listen 80;
    server_name dashboard.domainkamu.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aktifkan:

```bash
sudo ln -s /etc/nginx/sites-available/solofleet /etc/nginx/sites-enabled/solofleet
sudo nginx -t
sudo systemctl reload nginx
```

## 8. Arahkan custom domain

Di DNS provider atau Cloudflare:
- buat `A record`
- host: `dashboard` atau `@`
- value: IP VPS kamu

Contoh:
- `dashboard.domainkamu.com -> 123.123.123.123`

## 9. Pasang HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d dashboard.domainkamu.com
```

## 10. Update aplikasi berikutnya

Kalau ada perubahan baru:

```bash
cd /var/www/solofleet
git pull origin main
npm install
npm run build
pm2 restart sowhat
```

## 11. Validasi migrasi data

Masuk ke PostgreSQL:

```bash
sudo -u postgres psql -d solofleet
```

Cek isi tabel utama:

```sql
select id, updated_at from app_settings;
select id, updated_at from app_state;
select count(*) from dashboard_web_users;
select count(*) from daily_temp_rollups;
select count(*) from pod_snapshots;
```

## 12. Tabel yang dipakai di PostgreSQL

App akan auto-create tabel ini:
- `app_settings`
- `app_state`
- `dashboard_web_users`
- `daily_temp_rollups`
- `pod_snapshots`

Jadi kamu tidak wajib run schema manual di PostgreSQL lokal. App akan buat sendiri saat startup.
