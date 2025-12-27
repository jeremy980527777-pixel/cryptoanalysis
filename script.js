// 【重要】請確認這裡
const API_URL = "https://55ozekq59jfu.share.zrok.io/api/results";

// 狀態變數
let previousDataMap = { bull: [], bear: [] }; // 用來存上一輪的幣種名單
let isFirstLoad = true; // 第一次載入不跳通知

let settings = {
    notifications: false,
    sound: false,
    volume: 0.5,
    direction: 'all' // all, bull, bear
};

// 初始化音效環境
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// --- 鈴聲音效 (Bell) ---
function playBell() {
    if (!settings.sound) return;
    if (audioContext.state === 'suspended') audioContext.resume();

    const now = audioContext.currentTime;
    const vol = settings.volume;

    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.connect(gain1);
    gain1.connect(audioContext.destination);
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1100, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(vol, now + 0.01);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    osc1.start(now);
    osc1.stop(now + 1.5);

    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1650, now);
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(vol * 0.5, now + 0.01);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.start(now);
    osc2.stop(now + 0.5);
}

// --- 初始化 ---
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    setupModal();
    updateDashboard();
    setInterval(updateDashboard, 10000); 
});

async function updateDashboard() {
    const statusText = document.getElementById('statusText');
    const dot = document.getElementById('dot');
    
    try {
        const res = await fetch(`${API_URL}?t=${new Date().getTime()}`, {
            headers: new Headers({ "ngrok-skip-browser-warning": "true" }),
        });
        const json = await res.json();
        
        if (json.status === 'success') {
            statusText.innerText = `最後更新: ${json.timestamp}`;
            dot.className = 'dot green';
            
            // 渲染畫面
            renderLists(json.data);

            // 檢查變動並通知
            checkDiffAndNotify(json.data);
            
            // 更新「上一輪」狀態
            previousDataMap.bull = json.data.bull.map(i => i.name);
            previousDataMap.bear = json.data.bear.map(i => i.name);
            isFirstLoad = false;

        } else if (json.status === 'waiting') {
            statusText.innerText = '伺服器正在爬取運算中...';
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

// --- 核心邏輯：比對變動 ---
function checkDiffAndNotify(newData) {
    if (isFirstLoad) return; // 第一次打開不通知

    const currBull = newData.bull.map(i => i.name);
    const currBear = newData.bear.map(i => i.name);

    // 計算變動
    const bullDiff = getDiff(previousDataMap.bull, currBull);
    const bearDiff = getDiff(previousDataMap.bear, currBear);

    let shouldNotify = false;
    let notifyTitle = "";
    let notifyDetails = [];
    let alertType = 'mixed'; // bull, bear, mixed

    // 根據設定過濾
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
        // 如果同時有多空變動，type 設為 mixed，否則設為 bear
        alertType = (watchBull && (bullDiff.added.length || bullDiff.removed.length)) ? 'mixed' : 'bear';
    }

    if (shouldNotify) {
        playBell();
        
        // 1. 網頁內彈窗 (Toast)
        showToastAlert("市場名單變動", notifyDetails.join('<br>'), alertType);

        // 2. 系統通知 (簡略版)
        if (settings.notifications && Notification.permission === "granted") {
            const summary = notifyDetails.map(s => s.replace(/<[^>]*>/g, '')).join('\n');
            new Notification("監控名單更新", { body: summary, icon: "https://cdn-icons-png.flaticon.com/512/2272/2272825.png" });
        }
    }
}

// 輔助函式：取得陣列差異
function getDiff(prev, curr) {
    return {
        added: curr.filter(x => !prev.includes(x)),
        removed: prev.filter(x => !curr.includes(x))
    };
}

// 顯示浮動通知視窗
function showToastAlert(title, htmlContent, type) {
    const container = document.getElementById('notificationContainer');
    const toast = document.createElement('div');
    toast.className = `toast-alert ${type}`;
    
    toast.innerHTML = `
        <div class="toast-header">
            <span>${title}</span>
            <span class="toast-close" onclick="this.parentElement.parentElement.remove()">✕</span>
        </div>
        <div class="toast-body">${htmlContent}</div>
    `;

    container.appendChild(toast);
    
    // 15秒後自動消失，避免堆積太多
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 15000);
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
                </div>
            </li>`).join('') + '</ul>';
        sec.innerHTML = `<h3>${icon} ${title}</h3>${listHtml}`;
        return sec;
    };

    container.appendChild(createSection('多頭異常', data.bull, 'bull', '🚀'));
    container.appendChild(createSection('空頭異常', data.bear, 'bear', '📉'));
    container.appendChild(createSection('等待突破', data.neut, 'neut', '⚖️'));
}

// --- 設定介面邏輯 ---
function setupModal() {
    const modal = document.getElementById("settingsModal");
    const btn = document.getElementById("settingsBtn");
    const close = document.getElementsByClassName("close-btn")[0];
    btn.onclick = () => modal.style.display = "block";
    close.onclick = () => modal.style.display = "none";
    window.onclick = (e) => { if (e.target == modal) modal.style.display = "none"; }

    const notifyToggle = document.getElementById("notifyToggle");
    const soundToggle = document.getElementById("soundToggle");
    const directionSelect = document.getElementById("directionSelect"); // 新增
    const volSlider = document.getElementById("volumeSlider");
    const volText = document.getElementById("volValue");
    const testBtn = document.getElementById("testNotifyBtn");

    // 載入 UI
    notifyToggle.checked = settings.notifications;
    soundToggle.checked = settings.sound;
    directionSelect.value = settings.direction; // 載入方向設定
    volSlider.value = settings.volume * 100;
    volText.innerText = Math.round(settings.volume * 100) + "%";

    // 事件
    notifyToggle.onchange = () => {
        settings.notifications = notifyToggle.checked;
        if (settings.notifications && Notification.permission !== "granted") Notification.requestPermission();
        saveSettings();
    };
    soundToggle.onchange = () => {
        settings.sound = soundToggle.checked;
        if (settings.sound && audioContext.state === 'suspended') audioContext.resume();
        saveSettings();
    };
    directionSelect.onchange = () => { // 新增
        settings.direction = directionSelect.value;
        saveSettings();
    };
    volSlider.oninput = () => {
        settings.volume = volSlider.value / 100;
        volText.innerText = volSlider.value + "%";
        saveSettings();
    };
    testBtn.onclick = () => {
        playBell();
        showToastAlert("測試通知", "<span class='added'>🚀 多頭新增: BTC</span><br><span class='removed'>💨 空頭移除: ETH</span>", "mixed");
    };
}

function saveSettings() { localStorage.setItem('cryptoMonitorSettings', JSON.stringify(settings)); }
function loadSettings() {
    const saved = localStorage.getItem('cryptoMonitorSettings');
    if (saved) settings = { ...settings, ...JSON.parse(saved) };

}


