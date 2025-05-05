# Proactive Seamless Handover for WebRTC Video Calls Using Network and Video Quality Feedback


This project is a WebRTC-based peer-to-peer video calling system that monitors network quality and switches between network paths (e.g., Wi-Fi to LTE) when degradation is detected. It uses a Node.js signaling server with Socket.IO and includes a dashboard to display live statistics and trigger seamless ICE restarts.

## Steps to run the project

### 1. Clone the Repository
```bash
git clone (https://github.com/Abhiram014/Proactive-Seamless-Handover-for-WebRTC-Video-Calls-Using-Network-and-Video-Quality-Feedback
cd Proactive-Seamless-Handover-for-WebRTC-Video-Calls-Using-Network-and-Video-Quality-Feedback
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Start the Signaling Server
```bash
node server.js
```

### 4. Open the Application
- Open `index.html` in a browser window.
- Open it in another browser window or on a different device for the second peer.

### 5. Testing Across Devices (Optional)
If testing on different devices or networks, use **Ngrok** to expose the local server:
```bash
ngrok http 3000
```
- Replace `localhost:3000` in your code with the Ngrok URL (e.g., `https://abcd.ngrok-free.app`).
