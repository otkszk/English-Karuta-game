document.addEventListener("DOMContentLoaded", () => {
    // 日付の初期設定
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    document.getElementById("test-date").value = `${yyyy}-${mm}-${dd}`;

    // 音声の読み込み
    loadVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = loadVoices;
    }
});

// --- グローバル変数 ---
let allQuestions = []; // 選択されたセットの全問題
let availableQuestions = []; // まだ正解していない問題
let imageElements = []; // 表示されている画像要素の配列
let currentQuestion = null; // 現在読み上げられている問題
let selectedVoice = null; // 選択された音声
let speechUtterance = null; // SpeechSynthesisUtteranceオブジェクト
let gameMode = "normal"; // 現在のゲームモード
let startTime; // ゲーム開始時間
let timerInterval; // タイマーのInterval ID
let totalTime = 0; // ゲームの合計時間

// --- 音声関連 ---
function loadVoices() {
    const voices = speechSynthesis.getVoices();
    const voiceSelect = document.getElementById("voice-select");
    voiceSelect.innerHTML = '';
    const englishVoices = voices.filter(voice => voice.lang.startsWith('en'));

    if (englishVoices.length === 0) {
        voiceSelect.innerHTML = '<option value="">英語の音声がありません</option>';
        return;
    }

    const preferredVoices = ["Google US English", "Microsoft David - English (United States)", "Samantha"];
    let defaultSelected = false;

    englishVoices.forEach(voice => {
        let option = document.createElement("option");
        option.textContent = `${voice.name} (${voice.lang})`;
        option.value = voice.name;
        voiceSelect.appendChild(option);
        if (preferredVoices.includes(voice.name) && !defaultSelected) {
            voiceSelect.value = voice.name;
            defaultSelected = true;
        }
    });

    if (!defaultSelected) {
        voiceSelect.value = englishVoices[0].name;
    }
}

function speak(textA, textB, callback = () => {}) {
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
    // Aを再生
    const utteranceA = new SpeechSynthesisUtterance(textA);
    utteranceA.voice = selectedVoice;
    utteranceA.rate = 0.9;
    utteranceA.onend = () => {
        // Aの再生が終わったらすぐにBを再生
        if (textB) {
            const utteranceB = new SpeechSynthesisUtterance(textB);
            utteranceB.voice = selectedVoice;
            utteranceB.rate = 0.9;
            utteranceB.onend = callback;
            speechSynthesis.speak(utteranceB);
        } else {
            callback();
        }
    };
    speechSynthesis.speak(utteranceA);
}

// --- 画面遷移とゲーム設定 ---
async function startGame() {
    const gradeSet = document.getElementById("grade-set").value;
    gameMode = document.getElementById("mode").value;
    selectedVoice = speechSynthesis.getVoices().find(v => v.name === document.getElementById("voice-select").value);

    if (!gradeSet) {
        await showCustomModal("学年とセットを選んでください");
        return;
    }
    if (!selectedVoice) {
        await showCustomModal("英語の音声が利用できません。ブラウザの設定を確認してください。");
        return;
    }

    try {
        const response = await fetch(`data/${gradeSet}.json`);
        if (!response.ok) throw new Error(`Failed to load ${gradeSet}.json`);
        const data = await response.json();
        allQuestions = data;
        initializeGameScreen();
    } catch (error) {
        console.error("データの読み込みエラー:", error);
        await showCustomModal(`問題データの読み込みに失敗しました: ${error.message}`);
    }
}

function initializeGameScreen() {
    document.getElementById("setup").style.display = "none";
    document.getElementById("game-screen").style.display = "flex";
    document.getElementById("timer").textContent = "0:00";
    document.getElementById("start-button").disabled = false;
    document.getElementById("repeat-button").disabled = true;

    const imageGrid = document.getElementById("image-grid");
    imageGrid.innerHTML = '';
    imageElements = [];

    // モードによって画像の表示順を決定
    const displayQuestions = (gameMode === 'random') ? [...allQuestions].sort(() => Math.random() - 0.5) : [...allQuestions];

    displayQuestions.forEach(q => {
        const imgContainer = document.createElement("div");
        imgContainer.classList.add("karuta-image-container");
        imgContainer.dataset.id = q.id;
        imgContainer.style.visibility = 'visible'; // 初期表示はvisible

        const img = document.createElement("img");
        img.src = `images/${q.image}`;
        img.alt = q.A;
        img.classList.add("karuta-image");

        imgContainer.appendChild(img);
        imageGrid.appendChild(imgContainer);
        imageElements.push(imgContainer);

        // クリックイベントはゲーム開始時に設定
        imgContainer.onclick = null;
    });
}

function returnToMenu() {
    location.reload(); // 簡単にするためリロードで対応
}

// --- ゲームロジック ---
function startGameLogic() {
    document.getElementById("start-button").disabled = true;
    document.getElementById("repeat-button").disabled = false;

    availableQuestions = [...allQuestions];
    startTime = new Date().getTime();
    timerInterval = setInterval(updateTimer, 1000);

    // 画像にクリックイベントを設定
    imageElements.forEach(imgContainer => {
        imgContainer.onclick = () => handleImageClick(imgContainer);
    });

    playNextQuestion();
}

function updateTimer() {
    const now = new Date().getTime();
    const elapsed = now - startTime;
    const minutes = Math.floor(elapsed / (1000 * 60));
    const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);
    document.getElementById('timer').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function playNextQuestion() {
    if (availableQuestions.length === 0) {
        endGame();
        return;
    }

    const randomIndex = Math.floor(Math.random() * availableQuestions.length);
    currentQuestion = availableQuestions[randomIndex];
    speak(currentQuestion.A, currentQuestion.B);
}

function repeatSound() {
    if (currentQuestion) {
        speak(currentQuestion.A, currentQuestion.B);
    }
}

function handleImageClick(clickedContainer) {
    if (!currentQuestion || clickedContainer.style.visibility === 'hidden') return;

    if (clickedContainer.dataset.id === currentQuestion.id) {
        // 正解
        new Audio('sounds/pinpon.mp3').play();
        clickedContainer.classList.add('correct-highlight');

        // ハイライトを見せてから消す
        setTimeout(() => {
            clickedContainer.style.visibility = 'hidden';
            clickedContainer.classList.remove('correct-highlight');

            availableQuestions = availableQuestions.filter(q => q.id !== currentQuestion.id);
            
            if (availableQuestions.length > 0) {
                playNextQuestion();
            } else {
                endGame();
            }
        }, 500); // 0.5秒ハイライト

    } else {
        // 不正解
        new Audio('sounds/bu.mp3').play();
        clickedContainer.classList.add('incorrect-shake');
        setTimeout(() => {
            clickedContainer.classList.remove('incorrect-shake');
        }, 400);
    }
}

async function quitGame() {
    const confirmQuit = await showCustomModal("ゲームを中断してメニューに戻りますか？", true);
    if (confirmQuit) {
        clearInterval(timerInterval);
        if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
        }
        returnToMenu();
    }
}

function endGame() {
    clearInterval(timerInterval);
    if (startTime) {
        totalTime = new Date().getTime() - startTime;
    }
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }

    document.getElementById("game-screen").style.display = "none";
    document.getElementById("result").style.display = "flex";

    const minutes = Math.floor(totalTime / (1000 * 60));
    const seconds = Math.floor((totalTime % (1000 * 60)) / 1000);
    document.getElementById("final-time").textContent = `タイム: ${minutes}:${seconds.toString().padStart(2, '0')}`;

    displayResultTable();
}

// --- 結果と履歴 ---
function displayResultTable() {
    const history = JSON.parse(localStorage.getItem("englishTestHistory") || "[]");
    const currentResult = {
        date: document.getElementById("test-date").value,
        gradeSet: document.getElementById("grade-set").options[document.getElementById("grade-set").selectedIndex].text,
        mode: document.getElementById("mode").options[document.getElementById("mode").selectedIndex].text,
        time: totalTime
    };

    const sortedHistory = [...history, currentResult].sort((a, b) => a.time - b.time);
    const top5 = sortedHistory.slice(0, 5);

    let html = `
        <table border="1">
            <tr><th>順位</th><th>実施日</th><th>学年</th><th>モード</th><th>タイム</th></tr>`;

    if (top5.length === 0) {
        html += `<tr><td colspan="5">まだ記録がありません。</td></tr>`;
    } else {
        top5.forEach((h, index) => {
            const minutes = Math.floor(h.time / (1000 * 60));
            const seconds = Math.floor((h.time % (1000 * 60)) / 1000);
            const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            html += `<tr>
                <td>${index + 1}</td>
                <td>${h.date}</td>
                <td>${h.gradeSet}</td>
                <td>${h.mode}</td>
                <td>${formattedTime}</td>
            </tr>`;
        });
    }
    html += "</table>";
    document.getElementById("result-table-container").innerHTML = html;
}

async function saveResult() {
    const history = JSON.parse(localStorage.getItem("englishTestHistory") || "[]");
    const currentResult = {
        date: document.getElementById("test-date").value,
        gradeSet: document.getElementById("grade-set").options[document.getElementById("grade-set").selectedIndex].text,
        mode: document.getElementById("mode").options[document.getElementById("mode").selectedIndex].text,
        time: totalTime
    };
    history.push(currentResult);
    localStorage.setItem("englishTestHistory", JSON.stringify(history));
    await showCustomModal("記録を保存しました");
}

function showHistory() {
    document.getElementById("setup").style.display = "none";
    document.getElementById("history").style.display = "flex";
    const history = JSON.parse(localStorage.getItem("englishTestHistory") || "[]");
    const area = document.getElementById("history-list-table");

    if (!history.length) {
        area.innerHTML = "<p>まだ記録がありません。</p>";
        return;
    }

    history.sort((a, b) => a.time - b.time); // タイムが短い順にソート
    const top10 = history.slice(0, 10);

    let html = `<table border="1"><tr><th>順位</th><th>実施日</th><th>学年</th><th>モード</th><th>タイム</th></tr>`;
    top10.forEach((h, index) => {
        const minutes = Math.floor(h.time / (1000 * 60));
        const seconds = Math.floor((h.time % (1000 * 60)) / 1000);
        const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        html += `<tr>
            <td>${index + 1}</td>
            <td>${h.date}</td>
            <td>${h.gradeSet}</td>
            <td>${h.mode}</td>
            <td>${formattedTime}</td>
        </tr>`;
    });
    html += "</table>";
    area.innerHTML = html;
}

// --- モーダル ---
async function showCustomModal(message, showCancel = false) {
    const modal = document.getElementById("modal");
    const modalMessage = document.getElementById("modal-message");
    const modalOk = document.getElementById("modal-ok");
    const modalCancel = document.getElementById("modal-cancel");

    modalMessage.textContent = message;
    modalCancel.style.display = showCancel ? "inline-block" : "none";
    modal.style.display = "flex";

    return new Promise((resolve) => {
        modalOk.onclick = () => {
            modal.style.display = "none";
            resolve(true);
        };
        modalCancel.onclick = () => {
            modal.style.display = "none";
            resolve(false);
        };
    });
}
