# 🚀 Hướng Dẫn Deploy "Docker Guard" (Production)

Đây là hướng dẫn chi tiết để triển khai **Docker Guard** (Team Backup Pro) lên một VPS Production để quản lý backup cho các Docker Container.

## 1. Yêu Cầu Hệ Thống
*   VPS chạy Linux (Ubuntu, CentOS, Debian, etc.).
*   Đã cài đặt **Docker** và **Docker Compose**.
    *   *Chưa cài?* Chạy lệnh setup nhanh sau:
        ```bash
        curl -fsSL https://get.docker.com | sh
        ```

## 2. Cài Đặt 
Cách đơn giản nhất là copy source code vào VPS.

1.  **Tạo thư mục dự án:**
    ```bash
    mkdir -p /opt/docker-guard
    cd /opt/docker-guard
    ```

2.  **Upload Source Code:**
    *   Upload toàn bộ file trong thư mục dự án hiện tại lên `/opt/docker-guard`.
    *   *Hoặc nếu dùng git:* `git clone <your-repo> .`

3.  **Cấu hình Environment (Tùy chọn):**
    *   Mở file `docker-compose.prod.yml` để điền thông tin Telegram nếu muốn nhận thông báo.
    ```yaml
    environment:
      - TELEGRAM_TOKEN=xxxxx
      - CHAT_ID=xxxxx
    ```

## 3. Khởi Chạy (Production Mode)

Sử dụng file `docker-compose.prod.yml` dể chạy **chỉ riêng Tool** (không kèm các container test rác).

```bash
# Tại thư mục /opt/docker-guard
docker compose -f docker-compose.prod.yml up -d --build
```
*(Nếu dùng docker-compose cũ thì gõ: `docker-compose -f docker-compose.prod.yml up -d --build`)*

## 4. Sử Dụng

1.  **Truy cập:** Mở trình duyệt và vào `http://<IP-Cua-VPS>:3000`
2.  **Kết nối:** Tool sẽ tự động nhận diện tất cả Container đang chạy trên VPS đó (nhờ việc mount `/var/run/docker.sock`).
3.  **Backup Thử:**
    *   Chọn tab **Dashboard**.
    *   Tìm một container bất kỳ.
    *   Bấm **"Start Backup"**.
    *   Vào tab **History Log** để xem tiến trình.

## 5. Lưu Ý Quan Trọng
*   **Dữ liệu Backup:** File backup nằm tại thư mục `/opt/docker-guard/backups` trên VPS. Bạn có thể mount thư mục này ra ngoài hoặc dùng rclone sync đi nơi khác.
*   **Port:** Mặc định chạy port `3000`. Nếu trùng, sửa trong `docker-compose.prod.yml` (ví dụ `"8080:3000"`).
*   **Bảo Mật:** Hiện tại Tool chưa có Login. Nếu Public ra Internet, hãy thiết lập Firewall (UFW) cài thêm Basic Auth Nginx hoặc chỉ cho phép IP của bạn truy cập.

---

---

## 6. Cấu Hình Tên Miền (Nginx Proxy Manager)
Nếu bạn đang dùng **Nginx Proxy Manager** (như trong ảnh bạn gửi), hãy cấu hình như sau để trỏ tên miền về Tool:

1.  Đăng nhập Nginx Proxy Manager -> Bấm **"Add Proxy Host"**.
2.  **Tab Details:**
    *   **Domain Names:** Điền tên miền muốn dùng (ví dụ: `backup.dpsmedia.vn`).
    *   **Scheme:** `http`
    *   **Forward Hostname / IP:** `172.17.0.1` 
        *   *(Đây là IP Gateway mặc định của Docker, giúp NPM trỏ về chính VPS này)*.
        *   *Nếu không chạy, hãy thử nhập IP Public của VPS.*
    *   **Forward Port:** `3005`
    *   **Websockets Support:** [x] Bật (Quan trọng cho tính năng real-time).
    *   **Block Common Exploits:** [x] Bật.
3.  **Tab SSL:**
    *   **SSL Certificate:** Chọn "Request a new SSL Certificate".
    *   **Force SSL:** [x] Bật.
    *   **HTTP/2 Support:** [x] Bật.
    *   **Email:** Điền email của bạn.
    *   **Agree to Terms of Service:** [x] Bật.
4.  Bấm **Save**.

Sau đó bạn có thể truy cập Tool qua `https://backup.dpsmedia.vn` thay vì IP:3000.

## 7. Bảo Mật (Chặn truy cập trực tiếp Port 3005)
Để người lạ không thể truy cập trực tiếp qua `http://IP-VPS:3005`, hãy sửa file `docker-compose.prod.yml`:
```yaml
ports:
  - "172.17.0.1:3005:3000" # Chỉ cho phép truy cập từ nội bộ Docker (NPM)
```
Sau đó chạy lại: `docker compose -f docker-compose.prod.yml up -d`
Lúc này chỉ có Nginx Proxy Manager mới kết nối được vào Tool, còn truy cập trực tiếp từ ngoài sẽ bị chặn.


## 8. 🔄 Hướng Dẫn Update (Cập Nhật Phiên Bản Mới)

Khi có code mới (như bản v1.4.0 vừa fix), bạn làm các bước sau để update trên VPS Production mà không mất dữ liệu backup:

1.  **Sync Code Mới:**
    *   **Cách 1 (Git):** `git pull origin main`
    *   **Cách 2 (Tarball):** Upload file `deploy.tar.gz` vào `/opt/docker-guard`, sau đó chạy:
        ```bash
        cd /opt/docker-guard
        tar -xzf deploy.tar.gz
        ```
    *   **Cách 3 (Direct Copy - Khuyên dùng):**
        Nếu bạn chạy lệnh từ máy tính cá nhân (có cài Git Bash hoặc WSL), dùng `rsync` để copy thẳng code (tự bỏ qua file rác):
        ```bash
        # Chạy từ thư mục code trên máy tính của bạn
        rsync -avz --exclude 'node_modules' --exclude '.next' --exclude '.git' --exclude 'backups' --exclude 'data' . root@<IP_VPS>:/opt/docker-guard
        ```

2.  **Rebuild & Restart:**
    Chạy lệnh sau để Docker build lại image mới nhất và khởi động lại:
    ```bash
    docker compose -f docker-compose.prod.yml up -d --build
    ```

3.  **Dọn dẹp (Optional):**
    Xóa các image cũ cho sạch disk:
    ```bash
    docker image prune -f
    ```

4.  **Kiểm tra:**
    F5 lại trình duyệt, thấy header hiện **v1.4.0** là thành công!
