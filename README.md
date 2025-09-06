**This is the live demo link to the website** -- https://p2pfile-transfer.netlify.app/

<img width="100" height="100" alt="https___p2pfile-transfer netlify app_" src="https://github.com/user-attachments/assets/6ee7f95f-2f27-43a1-9b10-93560f80a6fd" />

# DirectDrop – Secure P2P File Sharing 🔗✨

DirectDrop is a fast, **privacy-focused, serverless file sharing app** that uses **WebRTC** to connect devices directly 🌍💫. No central server ever handles your files — only you and your peers.  

It’s lightweight, encrypted, and works directly from your browser. You can even install it as a **Progressive Web App (PWA)** 📱💻.

---

## 🚀 Features

- **🔒 End-to-End Encryption (AES-GCM)**
- **👥 1-to-1 Private Sharing** or **📡 Group Broadcasting**
- **📂 Share Anything**
  - Files, folders (auto-zipped), notes, links, code snippets
- **⚡ Smooth & Simple**
  - Real-time progress indicators ⏳  
  - Drag & Drop file sharing 📤  
  - Dark Mode UI 🌙  
  - Built-in chat 💬
- **🔗 Easy Connections**
  - Instant session link  
  - Share via QR code 📷
- **🧹 Privacy-First Design**
  - Rooms auto-delete after use (1-to-1 instantly, groups after 1 hour)

---

## ⚙️ How It Works

1. 🏠 **Host starts a session** → A unique room link + QR code generated.  
2. 👤 **Peers join** → Firestore handles initial signaling.  
3. 🔗 **Direct peer-to-peer connection** via WebRTC is established.  
4. 📦 **Transfer files & messages** directly and securely.  
5. 🧹 **Auto-cleanup** → Signaling data removed for max privacy.  

---

## 📖 Getting Started

### As Host
1. Open DirectDrop.  
2. Choose *1-to-1 Sharing* or *Broadcast to a Group*.  
3. (Optional) Add a session password 🔐.  
4. Share the unique **link** or **QR code**.  
5. Start sharing files instantly 🎉.  

### As Peer
1. Open the session link or scan the QR code 🔗📷.  
2. Enter password if required 🔑.  
3. Start receiving files in real-time ⚡⬇️.  

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript (ES Modules)  
- **UI Styling:** Tailwind CSS 🎨  
- **P2P Engine:** WebRTC (RTCPeerConnection + RTCDataChannel) 🔗  
- **Signaling:** Firebase Firestore ☁️  
- **Compression:** JSZip 📦  
- **Encryption:** Web Crypto API (AES-GCM) 🛡️  
- **QR Codes:** qrcode.js 📷  

---

## 🖼️ Preview (Coming Soon)

*(Screenshot or demo GIF of the app UI here)*

---

## 📌 Roadmap

- [ ] File preview before sending 📑  
- [ ] Multi-device sync option 🔄  
- [ ] Offline-ready transfers 🔌  

---

## 👨‍💻 Contributing

Contributions are welcome!  
1. Fork the repo 🍴  
2. Create your feature branch 🌱  
3. Commit changes ✅  
4. Push and create a Pull Request 🔀  

---

## 📜 License

This project is licensed under the **MIT License**.  
See [LICENSE](LICENSE) for more details.

---

✨ With **DirectDrop**, sharing is as simple as **Click ➝ Connect ➝ Send** 🚀🔗🎉
