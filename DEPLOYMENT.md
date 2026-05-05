# 🚀 Production Deployment Guide

## Prerequisites

- ✅ VPS with Docker & Docker Compose installed
- ✅ Nginx Proxy Manager running
- ✅ Domain name pointing to your VPS

## Step 1: Deploy Application

```bash
# 1. Clone repository hoặc copy files lên VPS
cd /opt
git clone https://github.com/hienhoceo-dpsmedia/docker-backup.git
cd docker-backup

# 2. Tạo .env file
cp .env.example .env
nano .env
# Điền thông tin Telegram (optional)

# 3. Pull latest image
docker pull ghcr.io/hienhoceo-dpsmedia/docker-backup:latest

# 4. Deploy
docker-compose -f docker-compose.prod.yml up -d

# 5. Verify
docker-compose -f docker-compose.prod.yml logs -f
curl http://172.17.0.1:3005  # Should return HTML
```

## Step 2: Setup Authentication trong NPM

### Tạo Access List

1. Login vào Nginx Proxy Manager
2. Vào **Access Lists** → **Add Access List**
3. Điền thông tin:
   - **Name:** `Docker Backup Auth`
   - **Satisfy Any:** ☑️ (checked)
   
4. Tab **Authorization:**
   - Click **Add user**
   - **Username:** `admin` (hoặc tên bạn muốn)
   - **Password:** `********` (password mạnh)
   - Click **Add** để confirm user

5. Click **Save**

### Tạo Proxy Host với Auth

1. Vào **Hosts** → **Proxy Hosts** → **Add Proxy Host**

2. Tab **Details:**
   - **Domain Names:** `backup.yourdomain.com`
   - **Scheme:** `http`
   - **Forward Hostname/IP:** `docker-backup-manager`
   - **Forward Port:** `3000` (internal port, không phải 3005!)
   - **Cache Assets:** ☑️
   - **Block Common Exploits:** ☑️
   - **Websockets Support:** ☑️

3. Tab **SSL:**
   - **SSL Certificate:** `Request a new SSL Certificate`
   - **Force SSL:** ☑️
   - **HTTP/2 Support:** ☑️
   - **HSTS Enabled:** ☑️
   - Email: your@email.com
   - **I Agree to the Let's Encrypt Terms**

4. Tab **Access List:**
   - **Access List:** Select `Docker Backup Auth`

5. Click **Save**

## Step 3: Test Authentication

```bash
# Test truy cập qua domain
curl https://backup.yourdomain.com
# Should return 401 Unauthorized

# Test với credentials
curl -u admin:yourpassword https://backup.yourdomain.com
# Should return HTML
```

Browser access: **https://backup.yourdomain.com**
- Browser sẽ hiện popup yêu cầu username/password
- Nhập credentials đã tạo trong Access List
- Click OK → Vào được dashboard

## 🔒 Security Notes

- ✅ Port 3005 chỉ bind vào `172.17.0.1` (không public)
- ✅ HTTP Basic Auth protect tất cả requests
- ✅ HTTPS enforce với Let's Encrypt
- ✅ Docker socket mount với read-only flag
- ✅ Block common exploits enabled

## 📊 Managing Users

Để thêm/xóa users:
1. Vào **Access Lists** → Edit `Docker Backup Auth`
2. Tab **Authorization** → Add/Remove users
3. Save → NPM tự động apply

Để tạm thời disable auth:
1. Edit Proxy Host
2. Tab **Access List** → Select `Publicly Accessible`
3. Save

## 🔄 Update Application

```bash
cd /opt/docker-backup

# Pull latest image
docker pull ghcr.io/hienhoceo-dpsmedia/docker-backup:latest

# Recreate container
docker-compose -f docker-compose.prod.yml up -d --force-recreate

# Verify
docker-compose -f docker-compose.prod.yml logs -f
```

## GitHub Actions Production Deploy

Repository hiện có 2 workflow tách biệt:

- `deploy.yml`: build và push image mới lên GHCR khi push `master` hoặc `main`
- `deploy-production.yml`: deploy production bằng tay qua `workflow_dispatch`

Để dùng deploy production workflow, cần cấu hình GitHub Environment `production` với các secrets:

- `PRODUCTION_HOST`
- `PRODUCTION_PORT` (optional, mặc định `22`)
- `PRODUCTION_USER`
- `PRODUCTION_SSH_KEY`
- `PRODUCTION_APP_PATH`
- `GHCR_USERNAME` (optional nếu package GHCR private)
- `GHCR_TOKEN` (optional nếu package GHCR private; cần quyền pull package)

Luồng chuẩn:

1. push code lên `master`
2. chờ image mới build xong trên GHCR
3. vào Actions -> `Deploy Production`
4. tick `confirm_production`
5. chạy workflow để VPS pull `latest` và recreate service `backup-manager`
6. nếu GHCR package private, workflow sẽ login trên VPS trước khi pull

## 📝 Troubleshooting

### "502 Bad Gateway"
```bash
# Check container running
docker ps | grep backup-manager

# Check logs
docker-compose -f docker-compose.prod.yml logs
```

### "Authentication required" loop
- Clear browser cache/cookies
- Check Access List có user chưa
- Verify password đúng

### Cannot access from NPM
```bash
# Verify container joined NPM network
docker inspect docker-backup-manager | grep nginx-proxy-manager

# If not found, recreate:
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d
```

## 🎯 Next Steps (Optional)

- [ ] Add multiple admin users trong Access List
- [ ] Setup Telegram notifications (edit `.env`)
- [ ] Configure backup schedules trong UI
- [ ] Setup Rclone cho cloud backups
- [ ] Monitor với Netdata/Uptime Kuma
