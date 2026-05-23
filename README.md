# ✦ QuickNote

Ứng dụng ghi chú nổi trên desktop, đồng bộ 2 chiều với Notion.

![Electron](https://img.shields.io/badge/Electron-33-blue?logo=electron)
![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Tính năng

- ⌨️ **Phím tắt toàn cục** — `Cmd+Shift+N` hiện/ẩn từ bất kỳ app nào
- 📌 **Always on Top** — Nổi trên tất cả cửa sổ, toggle bật/tắt
- 🎨 **Glassmorphism UI** — Dark/Light theme đẹp mắt
- ☁️ **Notion 2-way Sync** — Tự đẩy lên Notion + kéo về từ Notion
- 📥 **Auto Restore** — Xoá local → mở app → tự kéo từ Notion về
- 📤 **Offline Queue** — Mất mạng → lưu local → có mạng tự sync
- 💾 **Auto-save** — Tự lưu sau 500ms ngừng gõ
- 🔍 **Tìm kiếm** — Lọc notes theo tiêu đề/nội dung
- 🔔 **System Tray** — Chạy nền, icon trên menu bar

## ⌨️ Phím tắt

| Phím tắt | Chức năng |
|---|---|
| `Cmd+Shift+N` | Hiện/ẩn cửa sổ (global) |
| `Cmd+Shift+S` | Sync thủ công với Notion |
| `Cmd+N` | Tạo note mới |
| `Cmd+F` | Focus tìm kiếm |
| `Cmd+B` | Ẩn/hiện sidebar |
| `Esc` | Ẩn cửa sổ |

## 🚀 Cài đặt & Chạy

### Dùng file DMG (khuyến nghị)
1. Download file `QuickNote-1.0.0-arm64.dmg` từ Releases
2. Mở DMG → Kéo QuickNote vào Applications
3. Mở QuickNote → Sử dụng!

### Chạy từ source code
```bash
git clone https://github.com/YOUR_USERNAME/quicknote.git
cd quicknote
npm install
npm start
```

### Build app
```bash
npm run make
# Output: out/make/QuickNote-1.0.0-arm64.dmg
```

## 🏗️ Cấu trúc

```
quicknote/
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.js     # Window, tray, shortcuts
│   │   ├── store.js    # Data + 2-way sync logic
│   │   └── notion.js   # Notion API integration
│   ├── preload/        # Context bridge
│   └── renderer/       # UI (HTML/CSS/JS)
├── package.json
└── forge.config.js
```

## 📝 License

MIT
