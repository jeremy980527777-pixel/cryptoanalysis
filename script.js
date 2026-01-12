// --- 設定變數 ---
const API_URL = "https://delta-scope.net/api/results"; 
let notifyEnabled = false;
let soundEnabled = false;
let volumeLevel = 0.5;
let filterDirection = "all"; 
let userKey = localStorage.getItem("licenseKey") || "";
let deviceId = localStorage.getItem("deviceId");
let processedCoins = new Set();
let myChart = null; // 🔥 圖表實例

if (!deviceId) {
    deviceId = "dev_" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("deviceId", deviceId);
}

// --- DOM 元素 ---
const contentDiv = document.getElementById("content");
const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const notifContainer = document.getElementById("notificationContainer");
const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeBtns = document.getElementsByClassName("close-btn");
const notifyToggle = document.getElementById("notifyToggle");
const soundToggle = document.getElementById("soundToggle");
const volumeSlider = document.getElementById("volumeSlider");
const volValue = document.getElementById("volValue");
const directionSelect = document.getElementById("directionSelect");
const apiKeyInput = document.getElementById("apiKeyInput");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const keyStatus = document.getElementById("keyStatus");
const testNotifyBtn = document.getElementById("testNotifyBtn");
const chartModal = document.getElementById("chartModal"); // 🔥 圖表視窗

// --- 初始化載入設定 ---
if(localStorage.getItem("notify") === "true") { notifyEnabled = true; notifyToggle.checked = true; }
if(localStorage.getItem("sound") === "true") { soundEnabled = true; soundToggle.checked = true; }
if(localStorage.getItem("volume")) { 
    volumeLevel = parseFloat(localStorage.getItem("volume"));
    volumeSlider.value = volumeLevel * 100;
    volValue.innerText = Math.round(volumeLevel * 100) + "%";
}
if(localStorage.getItem("filter")) {
    filterDirection = localStorage.getItem("filter");
    directionSelect.value = filterDirection;
}
apiKeyInput.value = userKey;

// --- 請求權限 ---
if (Notification.permission !== "granted") Notification.requestPermission();

// --- 音效 ---
const alertAudio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-software-interface-start-2574.mp3');

// --- 核心函式 ---
async function fetchData() {
    try {
        const url = `${API_URL}?key=${userKey}&device_id=${deviceId}`;
        const resp = await fetch(url);
        const json = await resp.json();

        if (json.type === "Invalid Key") {
            keyStatus.innerText = "⚠️ 金鑰無效或過期";
            keyStatus.style.color = "#F44336";
        } else if (json.type === "Premium") {
            keyStatus.innerText = `✅ VIP: ${json.user}`;
            keyStatus.style.color = "#4CAF50";
        } else {
            keyStatus.innerText = "👤 訪客模式 (延遲數據)";
            keyStatus.style.color = "#888";
        }

        updateUI(json.data, json.timestamp, json.user);
        
        dot.className = "dot green";
        statusText.innerText = "連線正常";
    } catch (e) {
        console.error(e);
        dot.className = "dot red";
        statusText.innerText = "連線中斷";
    }
}

function updateUI(data, timestamp, user) {
    contentDiv.innerHTML = "";
    
    // 顯示 VIP 狀態列
    const metaDiv = document.createElement("div");
    metaDiv.style.gridColumn = "1 / -1";
    metaDiv.style.textAlign = "center";
    metaDiv.style.marginBottom = "10px";
    metaDiv.style.color = "#666";
    metaDiv.innerHTML = user ? `👑 VIP (${user}) | 更新: ${timestamp}` : `👤 Guest | 更新: ${timestamp}`;
    contentDiv.appendChild(metaDiv);

    let currentWinners = new Set();

    if (filterDirection === "all" || filterDirection === "bull") {
        createSection("🚀 多頭異常", data.bull, "bull", currentWinners);
    }
    if (filterDirection === "all" || filterDirection === "bear") {
        createSection("📉 空頭異常", data.bear, "bear", currentWinners);
    }
    createSection("⚖️ 等待突破", data.neut, "neut", currentWinners);

    checkNewListings(currentWinners, data);
}

function createSection(title, list, type, currentWinners) {
    const section = document.createElement("div");
    section.className = `section ${type}`;
    
    const h3 = document.createElement("h3");
    h3.innerText = title;
    section.appendChild(h3);

    const ul = document.createElement("ul");
    if (list && list.length > 0) {
        list.forEach(item => {
            ul.appendChild(createListItem(item, type));
            currentWinners.add(item.name);
        });
    } else {
        const emptyLi = document.createElement("li");
        emptyLi.innerText = "暫無數據";
        emptyLi.style.color = "#666";
        emptyLi.style.justifyContent = "center";
        ul.appendChild(emptyLi);
    }
    section.appendChild(ul);
    contentDiv.appendChild(section);
}

function createListItem(item, type) {
    const li = document.createElement("li");
    
    // 🔥 新增：點擊事件，開啟圖表 🔥
    li.style.cursor = "pointer";
    li.title = "點擊查看趨勢圖";
    li.onclick = function() {
        openChartModal(item.name, item.trend, type);
    };

    let scoreClass = "badge score-badge";
    if (item.score >= 80) scoreClass += " fire";
    
    li.innerHTML = `
        <span class="coin-name">${item.name}</span>
        <div class="badges">
            <span class="badge msg-badge">${item.msg}</span>
            <span class="${scoreClass}">${item.score}</span>
            <span class="badge msg-badge">⏱ ${item.time_on_board}</span>
        </div>
    `;
    return li;
}

// --- 🔥 圖表與視窗控制邏輯 🔥 ---

function openChartModal(coinName, trendData, type) {
    if (!trendData || trendData.length === 0) {
        // 如果沒有歷史數據 (剛重啟)，造一個假數據避免報錯
        trendData = [0]; 
    }

    const title = document.getElementById("chartTitle");
    const ctx = document.getElementById("trendChart").getContext("2d");

    // 設定標題
    title.innerText = `${coinName} - 近1小時異常分趨勢`;
    chartModal.style.display = "block";

    // 銷毀舊圖表
    if (myChart) myChart.destroy();

    // 設定顏色
    let color = type === 'bear' ? '#F44336' : '#4CAF50';
    let bgColor = type === 'bear' ? 'rgba(244, 67, 54, 0.2)' : 'rgba(76, 175, 80, 0.2)';

    // 產生 X 軸時間標籤
    const labels = trendData.map((_, index) => {
        const mins = (trendData.length - 1 - index) * 5;
        return mins === 0 ? 'Now' : `-${mins}m`;
    });

    // 建立新圖表
    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '異常分數 (Score)',
                data: trendData,
                borderColor: color,
                backgroundColor: bgColor,
                borderWidth: 2,
                fill: true,
                tension: 0.3, // 線條平滑度
                pointRadius: 4,
                pointBackgroundColor: color
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: '#333' },
                    ticks: { color: '#aaa' }
                },
                x: {
                    grid: { color: '#333' },
                    ticks: { color: '#aaa' }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff'
                }
            }
        }
    });
}

// 關閉圖表視窗
window.closeChartModal = function() {
    chartModal.style.display = "none";
}

// --- 通知邏輯 ---
function checkNewListings(currentWinners, data) {
    // 檢查是否有新上榜 (多頭或空頭)
    // 這裡只簡單實作 Toast 通知，你可以保留原本的複雜邏輯
    currentWinners.forEach(coin => {
        if (!processedCoins.has(coin)) {
            // 找出它是多還是空
            let type = "neut";
            let listName = "";
            
            // 檢查它屬於哪個榜單
            if (data.bull.some(x => x.name === coin)) { type = "bull"; listName = "多頭新增"; }
            else if (data.bear.some(x => x.name === coin)) { type = "bear"; listName = "空頭新增"; }
            else { return; } // 觀察區不通知

            showToast(listName, coin, type);
            processedCoins.add(coin);
        }
    });
}

function showToast(title, message, type) {
    if (!notifyEnabled) return;
    
    // 播放音效
    if (soundEnabled) {
        alertAudio.volume = volumeLevel;
        alertAudio.play().catch(e => console.log("Audio play failed", e));
    }

    // 瀏覽器通知
    if (document.hidden) {
        new Notification(title, { body: message, icon: "favicon.ico" });
    }

    // 網頁內通知
    const toast = document.createElement("div");
    toast.className = `toast-alert ${type}`;
    toast.innerHTML = `
        <div class="toast-header">
            <span class="toast-title-text">${title}</span>
            <span class="toast-close" onclick="this.parentElement.parentElement.remove()">×</span>
        </div>
        <div class="toast-body">
            <span class="coin-name">${message}</span>
        </div>
    `;
    notifContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// --- 事件監聽 ---
settingsBtn.onclick = () => settingsModal.style.display = "block";
for (let btn of closeBtns) {
    btn.onclick = function() {
        settingsModal.style.display = "none";
        chartModal.style.display = "none"; // 讓關閉按鈕也能關圖表
    }
}
window.onclick = (event) => {
    if (event.target == settingsModal) settingsModal.style.display = "none";
    if (event.target == chartModal) chartModal.style.display = "none";
}

notifyToggle.onchange = () => {
    notifyEnabled = notifyToggle.checked;
    localStorage.setItem("notify", notifyEnabled);
    if (notifyEnabled) Notification.requestPermission();
}
soundToggle.onchange = () => {
    soundEnabled = soundToggle.checked;
    localStorage.setItem("sound", soundEnabled);
}
volumeSlider.oninput = () => {
    volumeLevel = volumeSlider.value / 100;
    volValue.innerText = volumeSlider.value + "%";
    localStorage.setItem("volume", volumeLevel);
}
directionSelect.onchange = () => {
    filterDirection = directionSelect.value;
    localStorage.setItem("filter", filterDirection);
    fetchData(); 
}
saveKeyBtn.onclick = () => {
    userKey = apiKeyInput.value.trim();
    localStorage.setItem("licenseKey", userKey);
    keyStatus.innerText = "🔄 驗證中...";
    fetchData(); 
}
testNotifyBtn.onclick = () => {
    showToast("測試通知", "這是一條測試訊息", "bull");
}

// --- 啟動 ---
setInterval(fetchData, 5000);
// 心跳包
setInterval(() => {
    fetch(`${API_URL}?key=${userKey}&device_id=${deviceId}&mode=ping`).catch(()=>{});
}, 60000);

fetchData();
