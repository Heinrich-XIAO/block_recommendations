// Content Censor Extension
const BLOCKED_KEYWORDS = ['sex', 'porn', 'anal', 'xxx', 'nsfw', 'erotic', 'hardcore', 'adult'];
const YOUTUBE_TIME_LIMIT = 30 * 60 * 1000; // 30 minutes in milliseconds
const TIME_UPDATE_INTERVAL = 1000; // Update every second
let youtubeTimer = null;

function isYouTube() {
  return window.location.hostname === 'www.youtube.com' || window.location.hostname === 'youtube.com';
}

async function getYouTubeUsageToday() {
  const today = new Date().toDateString();
  const data = await chrome.storage.local.get({ youtubeUsage: {} });
  return data.youtubeUsage[today] || 0;
}

async function saveYouTubeUsage(usageTime) {
  const today = new Date().toDateString();
  const data = await chrome.storage.local.get({ youtubeUsage: {} });
  data.youtubeUsage[today] = usageTime;
  await chrome.storage.local.set({ youtubeUsage: data.youtubeUsage });
}

async function checkYouTubeTimeLimit() {
  const usageToday = await getYouTubeUsageToday();
  if (usageToday >= YOUTUBE_TIME_LIMIT) {
    stopYouTubeTimer();
    showPopup('You have reached your 30-minute daily YouTube limit.');
    return true;
  }
  return false;
}

function updateTimerDisplay() {
  let timerElement = document.getElementById('yt-timer');
  
  if (!timerElement) {
    timerElement = document.createElement('div');
    timerElement.id = 'yt-timer';
    timerElement.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.85);
      color: #4ade80;
      padding: 10px 15px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      z-index: 999999;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    `;
    document.body.appendChild(timerElement);
  }
  
  getYouTubeUsageToday().then(usageToday => {
    const remaining = YOUTUBE_TIME_LIMIT - usageToday;
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  });
}

function startYouTubeTimer() {
  if (youtubeTimer) return;
  
  youtubeTimer = setInterval(async () => {
    const usageToday = await getYouTubeUsageToday();
    await saveYouTubeUsage(usageToday + TIME_UPDATE_INTERVAL);
    updateTimerDisplay();
    await checkYouTubeTimeLimit();
  }, TIME_UPDATE_INTERVAL);
  
  updateTimerDisplay();
}

function stopYouTubeTimer() {
  if (youtubeTimer) {
    clearInterval(youtubeTimer);
    youtubeTimer = null;
  }
  
  const timerElement = document.getElementById('yt-timer');
  if (timerElement) {
    timerElement.remove();
  }
}

async function initYouTubeTracking() {
  if (await checkYouTubeTimeLimit()) {
    return;
  }
  
  if (isYouTube()) {
    startYouTubeTimer();
  } else {
    stopYouTubeTimer();
  }
}

document.addEventListener('visibilitychange', async () => {
  if (isYouTube()) {
    if (document.visibilityState === 'visible') {
      if (!await checkYouTubeTimeLimit()) {
        startYouTubeTimer();
      }
    } else {
      stopYouTubeTimer();
    }
  }
});

window.addEventListener('beforeunload', () => {
  stopYouTubeTimer();
});

function countKeywords(text) {
  const lowerText = text.toLowerCase();
  let count = 0;
  
  BLOCKED_KEYWORDS.forEach(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches) {
      count += matches.length;
    }
  });
  
  return count;
}

function showPopup(message) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: #000000;
    z-index: 999999;
    display: flex;
    justify-content: center;
    align-items: center;
  `;
  
  const popup = document.createElement('div');
  popup.style.cssText = `
    background: #1a1a1a;
    padding: 40px;
    border-radius: 15px;
    text-align: center;
    max-width: 450px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #ffffff;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  `;
  
  popup.innerHTML = `
    <h2 style="color: #ffffff; margin-bottom: 20px; font-size: 24px; font-weight: 600;">Content Blocked</h2>
    <p style="color: #e0e0e0; margin-bottom: 15px; font-size: 16px; line-height: 1.5;">${message}</p>
    <p style="color: #a0a0a0; font-size: 14px;">You will be redirected in 3 seconds...</p>
  `;
  
  overlay.appendChild(popup);
  document.body.appendChild(overlay);
  
  setTimeout(() => {
    window.location.href = 'chrome-extension://dgiopelblkcgmobjhbfpcdecdenihlcb/pages/UrgeTest_initial.html';
  }, 3000);
}

function censorPage() {
  const pageText = document.body.innerText || document.body.textContent || '';
  const keywordCount = countKeywords(pageText);
  
  if (keywordCount > 5) {
    showPopup('This page contains adult content and has been blocked.');
  }
}

// Run when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initYouTubeTracking();
    censorPage();
  });
} else {
  initYouTubeTracking();
  censorPage();
}