document.addEventListener("DOMContentLoaded", () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    document.getElementById("test-date").value = `${yyyy}-${mm}-${dd}`;

    loadVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = loadVoices;
    }

    document.getElementById("mode").addEventListener("change", (event) => {
        const normalModeElements = document.querySelectorAll(".normal-mode-only");
        if (event.target.value === "normal") {
            normalModeElements.forEach(el => el.style.display = "flex");
        } else {
            normalModeElements.forEach(el => el.style.display = "none");
        }
    });

    // Initialize display based on default mode
    const initialMode = document.getElementById("mode").value;
    const normalModeElements = document.querySelectorAll(".normal-mode-only");
    if (initialMode === "normal") {
        normalModeElements.forEach(el => el.style.display = "flex");
    } else {
        normalModeElements.forEach(el => el.style.display = "none");
    }
});

let questions = []; // 問題データ
let currentQuestionIndex = 0; // 現在の問題インデックス
let correct = 0; // 正解数 (通常モード用)
let missed = []; // 間違えた問題 (通常モード用)
let selectedVoice = null; // 選択された音声
let speechUtterance = null; // SpeechSynthesisUtterance オブジェクトを保持
let levelDelay = 2000; // レベルに応じた遅延時間 (ミリ秒)
let gameMode = "normal"; // 現在のモード

// Karuta specific variables
let karutaImages = []; // Array to hold references to image elements
let currentKarutaQuestion = null; // The question whose A sound is currently playing
let startTime; // To store the start time of the game
let timerInterval; // To store the interval for the timer
let availableQuestions = []; // Questions that haven't been "removed" yet
let totalTime = 0; // To store the final game time (for Karuta mode)
let correctSound = new Audio('sounds/pinpon.mp3'); // Preload sounds
let incorrectSound = new Audio('sounds/bu.mp3');

function loadVoices() {
    const voices = speechSynthesis.getVoices();
    const voiceSelect = document.getElementById("voice-select");
    voiceSelect.innerHTML = ''; // Clear existing options

    // 英語の音声のみをフィルタリングして表示
    const englishVoices = voices.filter(voice => voice.lang.startsWith('en'));

    if (englishVoices.length === 0) {
        let option = document.createElement("option");
        option.textContent = "英語の音声がありません";
        option.value = "";
        voiceSelect.appendChild(option);
        return;
    }

    // 特定の英語の声を優先的に選択 (例: Google US English, Microsoft David)
    const preferredVoices = [
        "Google US English",
        "Microsoft David - English (United States)",
        "Microsoft Zira - English (United States)",
        "Samantha", // iOS Safari often has Samantha
        "Alex" // macOS Safari often has Alex
    ];

    let defaultOptionSelected = false;
    for (let preferredName of preferredVoices) {
        const foundVoice = englishVoices.find(voice => voice.name === preferredName);
        if (foundVoice) {
            let option = document.createElement("option");
            option.textContent = `${foundVoice.name} (${foundVoice.lang})`;
            option.value = foundVoice.name;
            voiceSelect.appendChild(option);
            if (!defaultOptionSelected) {
                voiceSelect.value = foundVoice.name;
                defaultOptionSelected = true;
            }
        }
    }

    // 残りの英語の声をアルファベット順に追加
    englishVoices.sort((a, b) => a.name.localeCompare(b.name)).forEach(voice => {
        if (!preferredVoices.includes(voice.name)) {
            let option = document.createElement("option");
            option.textContent = `${voice.name} (${voice.lang})`;
            option.value = voice.name;
            voiceSelect.appendChild(option);
        }
    });

    // If no preferred voice was found, just select the first available English voice
    if (!defaultOptionSelected && englishVoices.length > 0) {
        voiceSelect.value = englishVoices[0].name;
    }
}

async function showCustomModal(message, showCancel = false) {
    const modal = document.getElementById("modal");
    const modalMessage = document.getElementById("modal-message");
    const modalOk = document.getElementById("modal-ok");
    const modalCancel = document.getElementById("modal-cancel");

    modalMessage.textContent = message;
    modalCancel.style.display = showCancel ? "inline-block" : "none";

    modal.style.display = "flex"; // Flex to center content

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

function speak(text, callback = () => {}) {
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
    speechUtterance = new SpeechSynthesisUtterance(text);
    speechUtterance.voice = selectedVoice;
    speechUtterance.rate = 0.8; // Adjust speed if needed
    speechUtterance.onend = callback;
    speechSynthesis.speak(speechUtterance);
}

async function startGame() { // Renamed from startTest
    gameMode = document.getElementById("mode").value; // Get the selected mode

    if (gameMode === 'normal') {
        const saved = JSON.parse(localStorage.getItem("englishTestProgress"));
        if (saved) {
            const confirmResume = await showCustomModal("前回の途中から再開しますか？", true);
            if (confirmResume) {
                loadSavedProgress(saved);
                return;
            } else {
                localStorage.removeItem("englishTestProgress");
            }
        }

        const gradeSet = document.getElementById("grade-set").value;
        const level = document.getElementById("level").value;
        const voiceSelect = document.getElementById("voice-select");
        selectedVoice = speechSynthesis.getVoices().find(v => v.name === voiceSelect.value);

        // レベルに応じた遅延時間を設定
        switch (level) {
            case 'easy': levelDelay = 3000; break;
            case 'normal': levelDelay = 2000; break;
            case 'hard': levelDelay = 1000; break;
        }

        if (!gradeSet) {
            await showCustomModal("学年とセットを選んでください");
            return;
        }
        if (!selectedVoice) {
            await showCustomModal("英語の音声が利用できません。ブラウザの設定を確認してください。");
            return;
        }

        fetch(`data/${gradeSet}.json`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to load ${gradeSet}.json: ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                questions = data;
                currentQuestionIndex = 0;
                correct = 0;
                missed = [];
                document.getElementById("setup").style.display = "none";
                document.getElementById("quiz").style.display = "flex";
                document.getElementById("result").style.display = "none";
                showQuestion();
            })
            .catch(error => {
                console.error("データの読み込みエラー:", error);
                showCustomModal(`問題データの読み込みに失敗しました: ${error.message}`);
            });

    } else if (gameMode === 'random') { // かるたモード
        const gradeSet = document.getElementById("grade-set").value;
        if (!gradeSet) {
            await showCustomModal("学年とセットを選んでください");
            return;
        }
        selectedVoice = speechSynthesis.getVoices().find(v => v.name === document.getElementById("voice-select").value);
        if (!selectedVoice) {
            await showCustomModal("英語の音声が利用できません。ブラウザの設定を確認してください。");
            return;
        }

        fetch(`data/${gradeSet}.json`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to load ${gradeSet}.json: ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                questions = data; // All questions for the selected grade
                availableQuestions = [...questions]; // Copy all questions to available
                document.getElementById("setup").style.display = "none";
                document.getElementById("karuta-game").style.display = "flex"; // Show karuta game screen
                initializeKarutaGame();
            })
            .catch(error => {
                console.error("データの読み込みエラー:", error);
                showCustomModal(`問題データの読み込みに失敗しました: ${error.message}`);
            });
    }
}


// Normal Mode Functions (existing)
function showQuestion() {
    if (currentQuestionIndex < questions.length) {
        document.getElementById("progress").textContent = `問題 ${currentQuestionIndex + 1} / ${questions.length}`;
        document.getElementById("current-question").textContent = questions[currentQuestionIndex].B;
        // 最初は通常モードでAを話す
        showNormalMode();
    } else {
        endTest();
    }
}

function showNormalMode() {
    speak(questions[currentQuestionIndex].A, () => {
        setTimeout(() => speak(questions[currentQuestionIndex].B), levelDelay);
    });
}

function showASpeechMode() {
    speak(questions[currentQuestionIndex].A);
}

function showBSpeechMode() {
    speak(questions[currentQuestionIndex].B);
}

function answer(isCorrect) {
    if (isCorrect) {
        correct++;
    } else {
        missed.push(questions[currentQuestionIndex]);
    }
    currentQuestionIndex++;
    saveProgress(); // Progress saved after each answer
    showQuestion();
}

function interruptTest() {
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
    document.getElementById("quiz").style.display = "none";
    document.getElementById("setup").style.display = "flex";
    localStorage.removeItem("englishTestProgress"); // Clear progress on interruption
}

function endTest() {
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
    document.getElementById("quiz").style.display = "none";
    document.getElementById("result").style.display = "block";
    const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
    document.getElementById("score").textContent = `点数: ${score}点`;

    showCurrentResultTableNormal(score); // Display current result
    showMissedList(); // Display missed list
    localStorage.removeItem("englishTestProgress"); // Clear progress on completion
}

function showMissedList() {
    const missedListDiv = document.getElementById("missed-list");
    missedListDiv.innerHTML = ""; // Clear previous content

    if (missed.length > 0) {
        const missedTitle = document.createElement("h3");
        missedTitle.textContent = "間違えた問題:";
        missedListDiv.appendChild(missedTitle);

        const ul = document.createElement("ul");
        missed.forEach(item => {
            const li = document.createElement("li");
            li.innerHTML = `<span class="correct-answer">${item.A}</span> / <span class="missed-answer">${item.B}</span>`;
            ul.appendChild(li);
        });
        missedListDiv.appendChild(ul);
    } else {
        const p = document.createElement("p");
        p.textContent = "おめでとうございます！全問正解です！";
        missedListDiv.appendChild(p);
    }
}

function showCurrentResultTableNormal(score) {
    const date = document.getElementById("test-date").value;
    const gradeSet = document.getElementById("grade-set").options[document.getElementById("grade-set").selectedIndex].text;
    const mode = document.getElementById("mode").options[document.getElementById("mode").selectedIndex].text;

    const html = `
        <table border="1">
            <tr><th>実施日</th><th>学年</th><th>モード</th><th>点数</th></tr>
            <tr><td>${date}</td><td>${gradeSet}</td><td>${mode}</td><td>${score}点</td></tr>
        </table>`;
    document.getElementById("current-result-table").innerHTML = html;
}

function saveProgress() {
    const progress = {
        currentQuestionIndex,
        correct,
        missed,
        gradeSet: document.getElementById("grade-set").value,
        level: document.getElementById("level").value,
        voiceName: document.getElementById("voice-select").value,
        questions: questions // 保存時にも問題データ全体を保存
    };
    localStorage.setItem("englishTestProgress", JSON.stringify(progress));
}

function loadSavedProgress(saved) {
    questions = saved.questions;
    currentQuestionIndex = saved.currentQuestionIndex;
    correct = saved.correct;
    missed = saved.missed;
    document.getElementById("grade-set").value = saved.gradeSet;
    document.getElementById("level").value = saved.level;
    document.getElementById("voice-select").value = saved.voiceName;
    selectedVoice = speechSynthesis.getVoices().find(v => v.name === saved.voiceName);

    document.getElementById("setup").style.display = "none";
    document.getElementById("quiz").style.display = "flex";
    document.getElementById("result").style.display = "none";
    showQuestion();
}


// Karuta Game Functions (newly added/modified)
function initializeKarutaGame() {
    const imageGrid = document.getElementById("image-grid");
    imageGrid.innerHTML = ''; // Clear any existing images
    karutaImages = []; // Clear previous image references

    // Shuffle questions to randomize initial display order
    const shuffledQuestions = [...questions].sort(() => Math.random() - 0.5);

    shuffledQuestions.forEach(q => {
        const imgContainer = document.createElement("div");
        imgContainer.classList.add("karuta-image-container");
        imgContainer.dataset.id = q.id; // Assuming each question has a unique 'id'
        imgContainer.dataset.image = q.image; // Store image path
        imgContainer.dataset.A = q.A; // Store A text

        const img = document.createElement("img");
        img.src = `images/${q.image}`;
        img.alt = q.A; // Alt text for accessibility
        img.classList.add("karuta-image");

        imgContainer.appendChild(img);
        imageGrid.appendChild(imgContainer);
        karutaImages.push(imgContainer); // Store reference
    });

    // Reset timer display
    document.getElementById('timer').textContent = '0:00';
    // Enable start button
    document.querySelector('#karuta-game .button-group button:first-child').disabled = false;
}

async function startKarutaGame() {
    // Disable the start button to prevent multiple clicks
    document.querySelector('#karuta-game .button-group button:first-child').disabled = true;

    startTime = new Date().getTime();
    timerInterval = setInterval(updateTimer, 1000);

    await playRandomKarutaSound();

    // Attach event listeners to all images for clicking
    karutaImages.forEach(imgContainer => {
        // Ensure image is visible if it was hidden from a previous game
        imgContainer.style.display = 'block';
        imgContainer.onclick = () => handleKarutaImageClick(imgContainer);
    });
}

function updateTimer() {
    const now = new Date().getTime();
    const elapsed = now - startTime;
    const minutes = Math.floor(elapsed / (1000 * 60));
    const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);
    document.getElementById('timer').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

async function playRandomKarutaSound() {
    if (availableQuestions.length === 0) {
        endKarutaGame();
        return;
    }

    // Pick a random question from the available ones
    const randomIndex = Math.floor(Math.random() * availableQuestions.length);
    currentKarutaQuestion = availableQuestions[randomIndex];

    // Play the A sound
    speak(currentKarutaQuestion.A, () => {
        // Callback when speech ends, no specific action needed here for Karuta
    });
}

async function handleKarutaImageClick(clickedImageContainer) {
    if (!currentKarutaQuestion) return; // No sound playing yet

    const clickedImageId = clickedImageContainer.dataset.id;
    const correctImageId = currentKarutaQuestion.id;

    if (clickedImageId === correctImageId) {
        // Correct answer
        correctSound.play();
        clickedImageContainer.style.display = 'none'; // Hide the image

        // Remove the question from availableQuestions
        availableQuestions = availableQuestions.filter(q => q.id !== correctImageId);

        if (availableQuestions.length > 0) {
            // Play the next random sound after a short delay
            setTimeout(() => {
                playRandomKarutaSound();
            }, 500); // Small delay before next sound
        } else {
            endKarutaGame(); // All images found
        }
    } else {
        // Incorrect answer
        incorrectSound.play();
        // Optional: Briefly highlight incorrect image
        clickedImageContainer.classList.add('incorrect');
        setTimeout(() => {
            clickedImageContainer.classList.remove('incorrect');
        }, 300);
    }
}

function endKarutaGame() {
    clearInterval(timerInterval);
    totalTime = new Date().getTime() - startTime; // Time in milliseconds

    document.getElementById("karuta-game").style.display = "none";
    document.getElementById("result").style.display = "block";

    const minutes = Math.floor(totalTime / (1000 * 60));
    const seconds = Math.floor((totalTime % (1000 * 60)) / 1000);
    document.getElementById("score").textContent = `タイム: ${minutes}:${seconds.toString().padStart(2, '0')}`;

    showCurrentResultTableKaruta(minutes, seconds); // Display current result
    // Karuta mode doesn't have a missed list like normal mode, so hide/clear it if present
    const missedListDiv = document.getElementById("missed-list");
    if (missedListDiv) missedListDiv.innerHTML = "";
}

async function quitKarutaGame() {
    const confirmQuit = await showCustomModal("やめてもいいですか？", true);
    if (confirmQuit) {
        clearInterval(timerInterval);
        document.getElementById("karuta-game").style.display = "none";
        document.getElementById("setup").style.display = "flex"; // Return to setup
        localStorage.removeItem("englishTestProgress"); // Clear any partial progress
        // Reset game state if needed
        availableQuestions = [];
        currentKarutaQuestion = null;
        if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
        }
        // Ensure all images are visible again if the user quits and then starts a new game
        karutaImages.forEach(imgContainer => {
            imgContainer.style.display = 'block';
        });
    }
}

function showCurrentResultTableKaruta(minutes, seconds) {
    const date = document.getElementById("test-date").value;
    const gradeSet = document.getElementById("grade-set").options[document.getElementById("grade-set").selectedIndex].text;
    const mode = document.getElementById("mode").options[document.getElementById("mode").selectedIndex].text;
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const html = `
        <table border="1">
            <tr><th>実施日</th><th>学年</th><th>モード</th><th>タイム</th></tr>
            <tr><td>${date}</td><td>${gradeSet}</td><td>${mode}</td><td>${formattedTime}</td></tr>
        </table>`;
    document.getElementById("current-result-table").innerHTML = html;
}

// Global functions modified for both modes
async function saveResult() {
    const date = document.getElementById("test-date").value;
    const gradeSet = document.getElementById("grade-set").options[document.getElementById("grade-set").selectedIndex].text;
    const mode = document.getElementById("mode").options[document.getElementById("mode").selectedIndex].text;
    const history = JSON.parse(localStorage.getItem("englishTestHistory") || "[]");

    if (gameMode === 'normal') {
        const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
        history.push({ date, gradeSet, mode, score, missed });
    } else if (gameMode === 'random') { // Karuta mode
        history.push({ date, gradeSet, mode, time: totalTime });
    }

    localStorage.setItem("englishTestHistory", JSON.stringify(history));
    await showCustomModal("記録を保存しました");
}

function showHistory() {
    document.getElementById("setup").style.display = "none";
    document.getElementById("history").style.display = "block";
    const history = JSON.parse(localStorage.getItem("englishTestHistory") || "[]");
    const area = document.getElementById("history-list-table");

    if (!history.length) {
        area.innerHTML = "<p>まだ記録がありません。</p>";
        return;
    }

    // Separate normal and karuta history
    const normalHistory = history.filter(h => h.mode !== 'ランダムモード');
    const karutaHistory = history.filter(h => h.mode === 'ランダムモード');

    // Sort Karuta history by time (shortest first)
    karutaHistory.sort((a, b) => a.time - b.time);

    let html = "<table border='1'><tr><th>実施日</th><th>学年</th><th>モード</th><th>結果</th><th>詳細</th></tr>";

    // Display normal history (latest first)
    [...normalHistory].reverse().forEach(h => {
        const missedItems = h.missed.map(item => `${item.A} / ${item.B}`).join(", ");
        html += `<tr><td>${h.date}</td><td>${h.gradeSet}</td><td>${h.mode}</td><td>${h.score}点</td><td>${missedItems}</td></tr>`;
    });

    // Display Karuta history (sorted by time)
    karutaHistory.forEach(h => {
        const minutes = Math.floor(h.time / (1000 * 60));
        const seconds = Math.floor((h.time % (1000 * 60)) / 1000);
        const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        html += `<tr><td>${h.date}</td><td>${h.gradeSet}</td><td>${h.mode}</td><td>${formattedTime}</td><td>全問正解</td></tr>`;
    });

    html += "</table>";
    area.innerHTML = html;
}
