const API_URL = "https://api.delta-scope.net/api/results";

// 1. 生成唯一裝置 ID
let deviceId = localStorage.getItem("device_id");
if (!deviceId) {
    deviceId = "dev_" + Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem("device_id", deviceId);
}

// 狀態變數
let previousDataMap = { bull: [], bear: [] }; 
let isFirstLoad = true;
let pollInterval = null; // 數據更新計時器
let pingInterval = null; // 🔥 心跳檢查計時器

let settings = {
    notifications: false,
    sound: false,
    volume: 0.5,
    direction: 'all',
    apiKey: ""
};

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function playBell() {
    if (!settings.sound) return;
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;
    const vol = settings.volume;

    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.connect(gain1); gain1.connect(audioContext.destination);
    osc1.type = 'sine'; osc1.frequency.setValueAtTime(1100, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(vol, now + 0.01);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    osc1.start(now); osc1.stop(now + 1.5);

    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.connect(gain2); gain2.connect(audioContext.destination);
    osc2.type = 'sine'; osc2.frequency.setValueAtTime(1650, now);
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(vol * 0.5, now + 0.01);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.start(now); osc2.stop(now + 0.5);
}

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    setupModal();
    updateDashboard(true); // 首次載入 (Claim)
    startPolling();
    setInterval(updateToastTimes, 60000);
});

function startPolling() {
    // 1. 數據更新：每 30 秒一次 (大流量)
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => {
        updateDashboard(false);
    }, 30000);

    // 2. 🔥 心跳偵測：每 3 秒一次 (極小流量) 🔥
    if (pingInterval) clearInterval(pingInterval);
    if (settings.apiKey) {
        pingInterval = setInterval(() => {
            checkAuthHeartbeat();
        }, 3000);
    }
}

// 專門用來檢查是否被踢出的輕量函式
async function checkAuthHeartbeat() {
    if (!settings.apiKey) return;
    // 加上 mode=ping，告訴伺服器不要回傳數據，只要檢查權限
    let url = `${API_URL}?key=${encodeURIComponent(settings.apiKey)}&device_id=${deviceId}&mode=ping`;

    try {
        const res = await fetch(url, { headers: { "ngrok-skip-browser-warning": "true" } });
        if (res.status === 409) {
            handleKickOut(); // 被踢出
        }
    } catch (e) { } // 網路波動忽略
}

async function updateDashboard(isClaiming = false) {
    const statusText = document.getElementById('statusText');
    const dot = document.getElementById('dot');
    
    let url = `${API_URL}?t=${new Date().getTime()}&device_id=${deviceId}`;
    if (settings.apiKey) {
        url += `&key=${encodeURIComponent(settings.apiKey)}`;
        if (isClaiming) url += `&claim=true`;
    }

    try {
        const res = await fetch(url, {
            headers: new Headers({ "ngrok-skip-browser-warning": "true" }),
        });

        if (res.status === 409) {
            handleKickOut();
            return;
        }

        const json = await res.json();
        
        if (json.status === 'success') {
            const isVIP = json.type === 'Premium';
            const userLabel = isVIP ? `👑 VIP (${json.user})` : 'Guest (30m延遲)';
            
            statusText.innerText = `${userLabel} | 更新: ${json.timestamp}`;
            statusText.style.color = '#666';
            dot.className = isVIP ? 'dot orange' : 'dot green';
            dot.style.boxShadow = isVIP ? "0 0 8px #FFD700" : "0 0 5px #4CAF50";

            renderLists(json.data);
            checkDiffAndNotify(json.data);
            
            previousDataMap.bull = json.data.bull.map(i => i.name);
            previousDataMap.bear = json.data.bear.map(i => i.name);
            isFirstLoad = false;

            // 成功連上VIP，更新狀態字
            if (isVIP) {
                const keyStatus = document.getElementById("keyStatus");
                if (keyStatus) {
                    keyStatus.innerText = "✅ 已連線";
                    keyStatus.style.color = "#4CAF50";
                }
                // 如果是第一次連上VIP，啟動心跳檢查
                if (!pingInterval) startPolling();
            } else if (json.error) {
                // key 錯誤
                const keyStatus = document.getElementById("keyStatus");
                if (keyStatus) {
                    keyStatus.innerText = "❌ 金鑰無效";
                    keyStatus.style.color = "#F44336";
                }
            }

        } else if (json.status === 'waiting') {
            statusText.innerText = '伺服器正在運算中...';
            dot.className = 'dot orange';
        } else {
            statusText.innerText = '伺服器錯誤';
            dot.className = 'dot red';
        }
    } catch (e) {
        console.error(e);
        statusText.innerText = '無法連線';
        dot.className = 'dot red';
    }
}

function handleKickOut() {
    // 停止所有更新
    if (pollInterval) clearInterval(pollInterval);
    if (pingInterval) clearInterval(pingInterval);
    
    const statusText = document.getElementById('statusText');
    const dot = document.getElementById('dot');

    statusText.innerText = '🚫 已斷線：帳號在其他裝置登入';
    statusText.style.color = '#F44336';
    dot.className = 'dot red';
    dot.style.boxShadow = "none";

    const keyStatus = document.getElementById("keyStatus");
    if (keyStatus) {
        keyStatus.innerText = "❌ 已被強制登出";
        keyStatus.style.color = "#F44336";
    }

    // 避免重複跳視窗
    if (!document.getElementById("kickout-toast")) {
        const t = showToastAlert("連線中斷", "您的金鑰已在另一台裝置使用。<br>本機已停止更新。", "bear");
        if(t) t.id = "kickout-toast";
    }
}

function checkDiffAndNotify(newData) {
    if (isFirstLoad) return; 
    const currBull = newData.bull.map(i => i.name);
    const currBear = newData.bear.map(i => i.name);
    const bullDiff = getDiff(previousDataMap.bull, currBull);
    const bearDiff = getDiff(previousDataMap.bear, currBear);

    let shouldNotify = false;
    let notifyDetails = [];
    let alertType = 'mixed';

    const watchBull = settings.direction === 'all' || settings.direction === 'bull';
    const watchBear = settings.direction === 'all' || settings.direction === 'bear';

    if (watchBull && (bullDiff.added.length > 0 || bullDiff.removed.length > 0)) {
        shouldNotify = true;
        if (bullDiff.added.length > 0) notifyDetails.push(`<span class="added">🚀 多頭新增: ${bullDiff.added.join(', ')}</span>`);
        if (bullDiff.removed.length > 0) notifyDetails.push(`<span class="removed">💨 多頭移除: ${bullDiff.removed.join(', ')}</span>`);
        alertType = 'bull';
    }

    if (watchBear && (bearDiff.added.length > 0 || bearDiff.removed.length > 0)) {
        shouldNotify = true;
        if (bearDiff.added.length > 0) notifyDetails.push(`<span class="added">📉 空頭新增: ${bearDiff.added.join(', ')}</span>`);
        if (bearDiff.removed.length > 0) notifyDetails.push(`<span class="removed">💨 空頭移除: ${bearDiff.removed.join(', ')}</span>`);
        alertType = (watchBull && (bullDiff.added.length || bullDiff.removed.length)) ? 'mixed' : 'bear';
    }

    if (shouldNotify) {
        playBell();
        showToastAlert("市場名單變動", notifyDetails.join('<br>'), alertType);
        if (settings.notifications && Notification.permission === "granted") {
            const summary = notifyDetails.map(s => s.replace(/<[^>]*>/g, '')).join('\n');
            new Notification("Kynetic Alert", { body: summary });
        }
    }
}

function getDiff(prev, curr) {
    return {
        added: curr.filter(x => !prev.includes(x)),
        removed: prev.filter(x => !curr.includes(x))
    };
}

function showToastAlert(title, htmlContent, type) {
    const container = document.getElementById('notificationContainer');
    const toast = document.createElement('div');
    const nowTimestamp = Date.now();
    toast.setAttribute('data-timestamp', nowTimestamp);
    toast.className = `toast-alert ${type}`;
    toast.innerHTML = `
        <div class="toast-header">
            <div class="toast-title-group"><span class="toast-title-text">${title}</span><span class="toast-time">剛剛</span></div>
            <span class="toast-close" onclick="this.closest('.toast-alert').remove()">✕</span>
        </div>
        <div class="toast-body">${htmlContent}</div>
    `;
    container.prepend(toast);
    return toast;
}

function getRelativeTime(timestamp) {
    const now = Date.now();
    const diffInSeconds = Math.floor((now - timestamp) / 1000);
    if (diffInSeconds < 60) return "剛剛";
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes} 分鐘前`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} 小時前`;
    return "超過 1 天";
}

function updateToastTimes() {
    const toasts = document.querySelectorAll('.toast-alert');
    toasts.forEach(toast => {
        const timestamp = parseInt(toast.getAttribute('data-timestamp'));
        const timeLabel = toast.querySelector('.toast-time');
        if (timestamp && timeLabel) timeLabel.innerText = getRelativeTime(timestamp);
    });
}

function renderLists(data) {
    const container = document.getElementById('content');
    container.innerHTML = ''; 
    const createSection = (title, list, typeClass, icon) => {
        const sec = document.createElement('div');
        sec.className = `section ${typeClass}`;
        let listHtml = list.length === 0 ? '<div class="empty-msg">無</div>' : '<ul>' + list.map(item => `
            <li>
                <span class="coin-name">${item.name}</span>
                <div class="badges">
                    <span class="badge msg-badge">${item.msg.replace('爆量','<span class="fire">🔥爆量</span>')}</span>
                    <span class="badge score-badge">${item.score}</span>
                    <span class="badge time-badge" style="background:#444;color:#ddd;font-size:0.8em;padding:4px 8px;">⏱ ${item.time_on_board || "New"}</span>
                </div>
            </li>`).join('') + '</ul>';
        sec.innerHTML = `<h3>${icon} ${title}</h3>${listHtml}`;
        return sec;
    };
    container.appendChild(createSection('多頭異常', data.bull, 'bull', '🚀'));
    container.appendChild(createSection('空頭異常', data.bear, 'bear', '📉'));
    container.appendChild(createSection('等待突破', data.neut, 'neut', '⚖️'));
}

function setupModal() {
    const modal = document.getElementById("settingsModal");
    const btn = document.getElementById("settingsBtn");
    const close = document.getElementsByClassName("close-btn")[0];
    const apiKeyInput = document.getElementById("apiKeyInput");
    const saveKeyBtn = document.getElementById("saveKeyBtn");

    btn.onclick = () => { modal.style.display = "block"; apiKeyInput.value = settings.apiKey || ""; };
    close.onclick = () => modal.style.display = "none";
    window.onclick = (e) => { if (e.target == modal) modal.style.display = "none"; }

    const notifyToggle = document.getElementById("notifyToggle");
    const soundToggle = document.getElementById("soundToggle");
    const directionSelect = document.getElementById("directionSelect");
    const volSlider = document.getElementById("volumeSlider");
    const volText = document.getElementById("volValue");
    const testBtn = document.getElementById("testNotifyBtn");

    notifyToggle.checked = settings.notifications;
    soundToggle.checked = settings.sound;
    directionSelect.value = settings.direction;
    volSlider.value = settings.volume * 100;
    volText.innerText = Math.round(settings.volume * 100) + "%";

    notifyToggle.onchange = () => {
        settings.notifications = notifyToggle.checked;
        if (settings.notifications && Notification.permission !== "granted") Notification.requestPermission();
        saveSettings();
    };
    soundToggle.onchange = () => { settings.sound = soundToggle.checked; saveSettings(); };
    directionSelect.onchange = () => { settings.direction = directionSelect.value; saveSettings(); };
    volSlider.oninput = () => {
        settings.volume = volSlider.value / 100;
        volText.innerText = volSlider.value + "%";
        saveSettings();
    };

    saveKeyBtn.onclick = () => {
        const val = apiKeyInput.value.trim();
        settings.apiKey = val;
        saveSettings();
        saveKeyBtn.innerText = "驗證中...";
        // 觸發一次 Claim
        updateDashboard(true).then(() => {
            saveKeyBtn.innerText = "驗證/儲存";
            startPolling(); // 重啟輪詢，確保 Heartbeat 啟動
        });
    };

    testBtn.onclick = () => {
        playBell();
        showToastAlert("測試通知", "<span class='added'>🚀 多頭新增: BTC</span>", "mixed");
    };
}

function saveSettings() { localStorage.setItem('cryptoMonitorSettings', JSON.stringify(settings)); }
function loadSettings() {
    const saved = localStorage.getItem('cryptoMonitorSettings');
    if (saved) settings = { ...settings, ...JSON.parse(saved) };
}
