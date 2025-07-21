// budaCards.js (Merged and Enhanced Version)

// 模組變數
let _allPosts, _getImageUrl, _showCustomAlert, _showModal, _PWA_SUB_PATH, _gachaContainer;
let _drawCardBtn, _gachaModalOverlay, _gachaModal, _closeGachaBtn, _rollDiceBtn, _drawAgainBtn, _diceResultDisplay, _drawnCardsContainer, _gachaInstructions;
let _diceContainer, _diceCube, _diceTextResult; // Added _diceTextResult as per old code for consistency
let _selectedGachaCardElement = null;

const MAX_DAILY_DRAWS = 3;
const STORAGE_KEY_DRAWS = 'dailyDraws', STORAGE_KEY_DATE = 'lastDrawDate';
let currentDraws = 0, nextResetTime = null, countdownInterval = null;

// Fisher-Yates Shuffle
const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

// 日期工具
const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getMidnightTomorrow = () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0); // Set to midnight of tomorrow
    return tomorrow.getTime();
};

const showGachaModal = () => {
    updateDrawCountDisplay(); // Update counts before showing
    const remainingDraws = MAX_DAILY_DRAWS - currentDraws;

    if (remainingDraws <= 0) {
        _showCustomAlert(`今日抽卡機會已用完，請等待倒數計時結束或明天再來。`);
        // If no draws left, still show the modal, but disable buttons and show countdown
        _gachaModalOverlay.classList.add('visible');
        document.body.style.overflow = 'hidden';
        _rollDiceBtn.style.display = 'none'; // Disable roll dice button
        _drawAgainBtn.style.display = 'none'; // Disable draw again button
        _gachaInstructions.textContent = `今日抽卡機會已用完。`;
        _diceResultDisplay.innerHTML = ''; // Clear dice result area
        _diceContainer.classList.add('hidden'); // Hide 3D dice
        _diceTextResult.style.display = 'none'; // Hide text result (if visible)
        _drawnCardsContainer.innerHTML = ''; // Clear drawn cards
        startCountdown(); // Ensure countdown starts
        return;
    }

    _gachaModalOverlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
    resetGachaState(); // Reset state for a fresh draw
};

const hideGachaModal = () => {
    _gachaModalOverlay.classList.remove('visible');
    document.body.style.overflow = 'auto';
};

const resetGachaState = () => {
    _gachaInstructions.textContent = '點擊「擲骰子」來決定抽卡數量';
    _diceResultDisplay.innerHTML = '';
    _diceContainer.classList.add('hidden');
    _diceTextResult.style.display = 'none'; // Ensure text result is hidden
    _drawnCardsContainer.innerHTML = '';
    _rollDiceBtn.style.display = 'inline-block';
    _drawAgainBtn.style.display = 'none';
    _selectedGachaCardElement = null;

    // Ensure all cards' pointer events are enabled (if they were disabled from previous selection)
    Array.from(_drawnCardsContainer.children).forEach(card => {
        card.style.pointerEvents = 'auto';
    });
};

const updateDrawCountDisplay = () => {
    const today = formatDate(new Date());
    const lastDrawDate = localStorage.getItem(STORAGE_KEY_DATE);

    if (lastDrawDate === today) {
        currentDraws = parseInt(localStorage.getItem(STORAGE_KEY_DRAWS) || '0', 10);
        nextResetTime = getMidnightTomorrow();
    } else {
        currentDraws = 0;
        localStorage.setItem(STORAGE_KEY_DRAWS, '0');
        localStorage.setItem(STORAGE_KEY_DATE, today);
        nextResetTime = getMidnightTomorrow();
    }
    
    const remainingDraws = MAX_DAILY_DRAWS - currentDraws;
    _drawCardBtn.disabled = remainingDraws <= 0;
    _drawCardBtn.style.cursor = remainingDraws <= 0 ? 'not-allowed' : 'pointer';

    if (remainingDraws <= 0) {
        _drawCardBtn.textContent = '今日機會已用完';
        _drawCardBtn.style.opacity = '0.6';
        if (_gachaModalOverlay.classList.contains('visible')) {
            _rollDiceBtn.style.display = 'none';
            _drawAgainBtn.style.display = 'none';
            _rollDiceBtn.disabled = true; // Also disable the button inside the modal
            _drawAgainBtn.disabled = true;
            _gachaInstructions.textContent = `今日抽卡機會已用完。`;
            _diceResultDisplay.innerHTML = ''; // Clear dice result area
        }
        startCountdown();
    } else {
        _drawCardBtn.textContent = `抽仙佛 (${remainingDraws}/${MAX_DAILY_DRAWS})`;
        _drawCardBtn.style.opacity = '1';
        if (_gachaModalOverlay.classList.contains('visible')) {
            _rollDiceBtn.disabled = false; // Enable if in modal
            _drawAgainBtn.disabled = false;
        }
        stopCountdown();
    }
};

const startCountdown = () => {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        const timeLeft = nextResetTime - Date.now();
        if (timeLeft <= 0) {
            stopCountdown();
            updateDrawCountDisplay();
            if (_gachaModalOverlay.classList.contains('visible')) resetGachaState(); // Reset if modal is open and time passed
            return;
        }
        const h = String(Math.floor(timeLeft / 3600000)).padStart(2, '0');
        const m = String(Math.floor((timeLeft % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((timeLeft % 60000) / 1000)).padStart(2, '0');
        const countdownText = `下次機會：${h}:${m}:${s}`;
        
        // Update text based on modal visibility and draw count
        if (_gachaModalOverlay.classList.contains('visible') && (MAX_DAILY_DRAWS - currentDraws <= 0)) {
            _gachaInstructions.textContent = `今日抽卡機會已用完，請等待 ${countdownText}`;
            _diceResultDisplay.innerHTML = ''; // Clear dice area in modal
            _diceContainer.classList.add('hidden'); // Hide 3D dice
            _diceTextResult.style.display = 'none'; // Hide text result (if visible)
        } else if (_drawCardBtn.disabled) { // If main button is disabled (no draws left)
             _drawCardBtn.textContent = `今日機會已用完 (${countdownText})`;
        }
    }, 1000);
};

const stopCountdown = () => {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = null;
};

/**
 * 根據骰子點數和隨機計算的索引獲取指定數量的文章。
 * 這個函數會確保獲取的文章有圖片，且索引計算符合 (隨機數 R + 骰子點數 N = 最終索引 T)。
 *
 * @param {number} diceRollCount - 骰子點數，即要獲取的文章數量 N。
 * @param {Array<Object>} allAvailablePosts - 所有文章，從中計算索引。
 * @returns {Array<Object>} 包含 luckyNumber, diceRoll, randomValue 的文章物件陣列。
 */
const getPostsByCalculatedIndex = (diceRollCount, allAvailablePosts) => {
    const selectedPosts = [];
    const usedRandomValues = new Set(); // To track used random values (R) for this batch
    const maxPostsLength = allAvailablePosts.length;

    if (maxPostsLength === 0) {
        _showCustomAlert('文章數據為空，無法進行抽卡。');
        return [];
    }
    
    const MAX_OVERALL_RETRIES = 50; // Max overall attempts for the entire batch
    const MAX_CARD_RETRIES = 10; // Max attempts per single card
    let overallAttempts = 0;

    for (let i = 0; i < diceRollCount; i++) {
        let postFound = false;
        let currentCardAttempts = 0;

        while (!postFound && currentCardAttempts < MAX_CARD_RETRIES && overallAttempts < MAX_OVERALL_RETRIES) {
            currentCardAttempts++;
            overallAttempts++;

            // Step 1: Generate a random value R from 1 to maxPostsLength
            let randomValue;
            let isRandomValueUnique = false;
            let uniqueRandomValueCheckAttempts = 0;
            const MAX_UNIQUE_RANDOM_VALUE_ATTEMPTS = 100;

            do {
                randomValue = Math.floor(Math.random() * maxPostsLength) + 1; // R in [1, maxPostsLength]
                uniqueRandomValueCheckAttempts++;
                if (!usedRandomValues.has(randomValue) || usedRandomValues.size === maxPostsLength) {
                    isRandomValueUnique = true;
                }
            } while (!isRandomValueUnique && uniqueRandomValueCheckAttempts < MAX_UNIQUE_RANDOM_VALUE_ATTEMPTS);
            
            if (!isRandomValueUnique && usedRandomValues.size < maxPostsLength) {
                console.warn(`Could not find a unique randomValue for card ${i+1}. Proceeding with potential duplicate.`);
            }
            usedRandomValues.add(randomValue);

            // Step 2: Calculate the target index T = R + N
            let calculatedIndex = randomValue + diceRollCount;

            // Step 3: Convert to 0-based array index and handle wrap-around
            const postIndex = (calculatedIndex - 1) % maxPostsLength;

            const candidatePost = allAvailablePosts[postIndex];

            // Check if post exists, has an image, and has not been selected in this batch already (by checking original post.id)
            const isDuplicatePostInSelection = selectedPosts.some(p => p.id === candidatePost.id);

            if (candidatePost && candidatePost.image && !isDuplicatePostInSelection) {
                const postToAdd = { ...candidatePost };
                postToAdd.luckyNumber = calculatedIndex; // Final T = R + N value
                postToAdd.diceRoll = diceRollCount; // N
                postToAdd.randomValue = randomValue; // R (from 1 to maxPostsLength)
                selectedPosts.push(postToAdd);
                postFound = true;
            } else {
                console.log(`Attempting to find post for card ${i+1}: Post at index ${postIndex} is missing image, already selected, or invalid. Retrying random number... (Current attempt ${currentCardAttempts}/${MAX_CARD_RETRIES})`);
            }
        }
        
        if (!postFound) {
            console.warn(`Could not find a valid and unique post for card ${i+1} within ${MAX_CARD_RETRIES} attempts. Actual number of cards drawn may be less than dice roll.`);
        }
    }
    return selectedPosts;
};

const startGachaProcess = async () => {
    if (MAX_DAILY_DRAWS - currentDraws <= 0) {
        _showCustomAlert('今日抽卡機會已用完！');
        return;
    }
    
    // Increment draw count and store
    currentDraws++;
    localStorage.setItem(STORAGE_KEY_DRAWS, String(currentDraws));
    localStorage.setItem(STORAGE_KEY_DATE, formatDate(new Date())); // Update date
    updateDrawCountDisplay(); // Update external button count

    if (_allPosts.length === 0) { 
        _showCustomAlert('沒有文章數據可供抽取。請檢查 posts.json。');
        currentDraws--; // Revert draw count for failed attempt
        localStorage.setItem(STORAGE_KEY_DRAWS, String(currentDraws));
        updateDrawCountDisplay();
        _rollDiceBtn.disabled = true; // Disable until posts are available
        return;
    }

    _gachaInstructions.textContent = '擲骰子中...';
    _diceResultDisplay.innerHTML = '';
    _drawnCardsContainer.innerHTML = ''; 
    _rollDiceBtn.style.display = 'none'; 
    _drawAgainBtn.style.display = 'none';
    _selectedGachaCardElement = null; // Reset selected card state

    _diceContainer.classList.remove('hidden'); // Show 3D dice
    _diceCube.classList.remove('show-1', 'show-2', 'show-3', 'show-4', 'show-5', 'show-6'); // Clear all face classes
    _diceCube.style.animation = 'roll-tumble 1.5s linear infinite'; // Start rolling animation
    
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate dice roll delay

    const diceRoll = Math.floor(Math.random() * 6) + 1; // 1 to 6 random number
    
    _diceCube.style.animation = 'none'; // Stop rolling animation
    _diceCube.classList.add(`show-${diceRoll}`); // Apply final face

    await new Promise(resolve => setTimeout(resolve, 800)); // Wait for dice to settle (CSS transition duration)

    _diceContainer.classList.add('hidden'); // Hide 3D dice
    _diceResultDisplay.innerHTML = `骰出：<span style="font-size: 2em; color: var(--primary-color, #5a4fcf);">${diceRoll}</span> 張仙佛小卡！`;
    
    const selectedPosts = getPostsByCalculatedIndex(diceRoll, _allPosts); // Use the robust function
    
    if (selectedPosts.length < diceRoll) {
        _gachaInstructions.textContent = `卡片數量不足！實際只找到了 ${selectedPosts.length} 張。請點擊一張小卡。`;
    } else {
        _gachaInstructions.textContent = '請點擊其中一張您感應到的仙佛小卡！';
    }
    
    displayDrawnCards(selectedPosts);

    if (MAX_DAILY_DRAWS - currentDraws > 0) {
        _drawAgainBtn.textContent = `再抽一次 (${MAX_DAILY_DRAWS - currentDraws}/${MAX_DAILY_DRAWS})`;
        _drawAgainBtn.style.display = 'inline-block';
    } else {
        _gachaInstructions.textContent = `今日抽卡機會已用完，請明天再來。`;
        startCountdown();
    }
};

const displayDrawnCards = (cards) => {
    _drawnCardsContainer.innerHTML = '';
    if (cards.length === 0) {
        _drawnCardsContainer.innerHTML = '<p>沒有足夠的仙佛小卡可以抽取。</p>';
        return;
    }
    cards.forEach(card => {
        const cardElement = document.createElement('div');
        cardElement.className = 'drawn-card';
        cardElement.cardData = card; // Store the full card data, including luckyNumber

        const imageUrl = _getImageUrl(card.image);
        const cardBackImageUrl = _getImageUrl('icons/濟公報logo.png'); 

        const displayText = (card.text || '').replace(/\n/g, ' '); 

        const luckyNumberDisplay = (card.luckyNumber !== undefined) ? 
            `<div class="card-lucky-number">仙佛緣號: ${card.luckyNumber}</div>` 
            : '<div class="card-lucky-number" style="font-size:0.95em; font-weight:bold; color:#888; margin-top:5px;">仙佛緣號: 未知</div>';

        cardElement.innerHTML = `
            <div class="card-inner">
                <div class="card-face card-back">
                    <img src="${cardBackImageUrl}" alt="卡背" onerror="this.src='${_getImageUrl('icons/placeholder.png')}'; this.alt='圖片載入失敗';">
                </div>
                <div class="card-face card-front">
                    <img src="${imageUrl}" alt="仙佛小卡" onerror="this.src='${_getImageUrl('icons/placeholder.png')}'; this.alt='圖片載入失敗';">
                    ${luckyNumberDisplay} 
                    <div class="card-date">${card.date || ''}</div>
                    <div class="card-text">${displayText}</div>
                </div>
            </div>
        `;

        cardElement.addEventListener('click', () => {
            const cardInner = cardElement.querySelector('.card-inner');
            
            if (_selectedGachaCardElement !== null) { // Prevent multiple selections
                return;
            }

            _selectedGachaCardElement = cardElement;
            cardInner.classList.add('selected'); // Trigger flip animation

            // Disable pointer events for all cards after one is selected
            Array.from(_drawnCardsContainer.children).forEach(otherCard => {
                otherCard.style.pointerEvents = 'none';
            });

            setTimeout(() => {
                hideGachaModal();
                const selectedPostData = cardElement.cardData;
                // Find original index from _allPosts for correct navigation in image modal
                const originalIndex = _allPosts.findIndex(p => 
                    p.date === selectedPostData.date && 
                    p.text === selectedPostData.text && 
                    p.image === selectedPostData.image
                );
                
                if (originalIndex !== -1) {
                     _showModal(selectedPostData.image, originalIndex); 
                } else {
                    _showModal(selectedPostData.image); 
                    console.warn("Selected card could not find its original index in main data. Image modal navigation might be affected.", selectedPostData);
                }
            }, 600); 
        });
        _drawnCardsContainer.appendChild(cardElement);
    });
};

/**
 * 外部調用接口，用於初始化抽卡邏輯。
 * 接收來自 `index.html` 的核心數據和函數。
 * @param {object} options - 包含所有必要依賴的物件
 * @param {HTMLElement} options.container - 抽卡遊戲將被注入的 HTML 容器元素
 * @param {Array<object>} options.allPosts - 所有文章數據
 * @param {function} options.getImageUrl - 圖片路徑處理函數
 * @param {function} options.showCustomAlert - 自定義彈窗函數
 * @param {function} options.showModal - 顯示大圖模態視窗函數
 * @param {string} options.PWA_SUB_PATH - PWA 子路徑 (用於 getImageUrl 內部處理)
 */
function initializeBudaCardsLogic(options) {
    ({ container: _gachaContainer, allPosts: _allPosts, getImageUrl: _getImageUrl, showCustomAlert: _showCustomAlert, showModal: _showModal, PWA_SUB_PATH: _PWA_SUB_PATH } = options);

    _gachaContainer.innerHTML = `
        <style>
            /* --- 抽卡遊戲相關樣式 (UI/UX 增強版) --- */
            #drawCardBtn {
              padding: 0.7em 1.5em; font-size: 1.1em; background: var(--primary-color); color: white;
              border: none; border-radius: 8px; cursor: pointer; margin-top: 1.5em; margin-bottom: 2em;
              transition: background-color 0.2s ease, transform 0.1s; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
              font-weight: bold;
              text-shadow: 1px 1px 2px rgba(0,0,0,0.2);
            }
            body.dark-mode #drawCardBtn { background-color: var(--primary-color-dark); color: var(--background-dark); }
            #drawCardBtn:hover { background-color: #483dbb; transform: translateY(-2px); }
            body.dark-mode #drawCardBtn:hover { background-color: #a46de5; }
            #drawCardBtn:active { transform: translateY(0); }
            #drawCardBtn:disabled {
                background-color: #777;
                color: #ccc;
                cursor: not-allowed;
                transform: none;
                box-shadow: none;
            }

            /* 抽卡模態視窗 */
            #gachaModal {
              background-color: var(--surface-light); color: var(--text-light); padding: 30px; border-radius: 12px;
              box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4); width: clamp(320px, 95vw, 800px); max-height: 90vh;
              overflow-y: auto; display: flex; flex-direction: column; align-items: center; gap: 20px; position: relative;
            }
            body.dark-mode #gachaModal {
              background-color: var(--surface-dark); color: var(--text-dark); box-shadow: 0 8px 30px rgba(255, 255, 255, 0.15);
            }
            #gachaModal .close-button { position: absolute; top: 15px; right: 15px; }

            #diceResultDisplay {
              font-size: 1.2em; font-weight: bold; color: var(--primary-color); min-height: 100px; display: flex;
              align-items: center; justify-content: center; flex-direction: column; text-align: center;
              transition: all 0.3s ease; /* UX: Add transition for smoother text changes */
            }
            body.dark-mode #diceResultDisplay { color: var(--primary-color-dark); }

            /* 3D Dice Styles */
            #dice-container {
                width: 100px; height: 100px; margin: 20px auto; perspective: 500px;
                display: flex; align-items: center; justify-content: center; pointer-events: none;
            }
            #dice-container.hidden { display: none; }
            #dice-cube {
                width: 100%; height: 100%; position: relative; transform-style: preserve-3d;
                transition: transform 0.8s ease-out; transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg);
            }
            #dice-cube .face {
                position: absolute; width: 100px; height: 100px; border: 1px solid #ccc; background-color: white;
                display: flex; align-items: center; justify-content: center;
                -webkit-backface-visibility: hidden; backface-visibility: hidden; border-radius: 8px;
                box-shadow: inset 0 0 10px rgba(0,0,0,0.2);
            }
            body.dark-mode #dice-cube .face {
                background-color: #1e1e1e; border-color: #555; color: #e0e0e0;
                box-shadow: inset 0 0 10px rgba(255,255,255,0.1);
            }
            .front  { transform: rotateY(   0deg) translateZ(50px); }
            .back   { transform: rotateY( 180deg) translateZ(50px); }
            .right  { transform: rotateY(  90deg) translateZ(50px); }
            .left   { transform: rotateY( -90deg) translateZ(50px); }
            .top    { transform: rotateX(  90deg) translateZ(50px); }
            .bottom { transform: rotateX( -90deg) translateZ(50px); }

            .dot {
                position: absolute; width: 15px; height: 15px; background-color: #333;
                border-radius: 50%; box-shadow: inset 0 0 5px rgba(0,0,0,0.5);
            }
            body.dark-mode .dot { background-color: #e0e0e0; box-shadow: inset 0 0 5px rgba(255,255,255,0.2); }
            
            /* Dice dots layout */
            /* 1 dot */
            .face.front { display: flex; align-items: center; justify-content: center; }
            /* 2 dots */
            .face.bottom { display: flex; justify-content: space-between; align-items: center; padding: 0 15px; }
            .face.bottom .dot:first-child { align-self: flex-start; }
            .face.bottom .dot:last-child { align-self: flex-end; }
            /* 3 dots */
            .face.right { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); place-items: center; }
            .face.right .dot:nth-child(1) { grid-area: 1 / 1; }
            .face.right .dot:nth-child(2) { grid-area: 2 / 2; }
            .face.right .dot:nth-child(3) { grid-area: 3 / 3; }
            /* 4 dots */
            .face.left, .face.top { display: grid; grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(2, 1fr); place-items: center; padding: 15px; }
            .face.left .dot:nth-child(1) { grid-area: 1 / 1; }
            .face.left .dot:nth-child(2) { grid-area: 1 / 2; }
            .face.left .dot:nth-child(3) { grid-area: 2 / 1; }
            .face.left .dot:nth-child(4) { grid-area: 2 / 2; }
            .face.top .dot:nth-child(1) { grid-area: 1 / 1; }
            .face.top .dot:nth-child(2) { grid-area: 1 / 2; }
            .face.top .dot:nth-child(3) { grid-area: 2 / 1; }
            .face.top .dot:nth-child(4) { grid-area: 2 / 2; }
            /* 5 dots */
            .face.top { /* Re-used from 4 dots, just add the center dot */ }
            .face.top .dot:nth-child(5) { position: absolute; }
            /* 6 dots */
            .face.back { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 1fr); place-items: center; padding: 15px; }
            .face.back .dot:nth-child(1) { grid-area: 1 / 1; }
            .face.back .dot:nth-child(2) { grid-area: 1 / 3; }
            .face.back .dot:nth-child(3) { grid-area: 2 / 1; }
            .face.back .dot:nth-child(4) { grid-area: 2 / 3; }
            .face.back .dot:nth-child(5) { grid-area: 1 / 2; }
            .face.back .dot:nth-child(6) { grid-area: 2 / 2; }

            @keyframes roll-tumble {
                0% { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); }
                100% { transform: rotateX(720deg) rotateY(720deg) rotateZ(360deg); }
            }
            .show-1 { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); }
            .show-2 { transform: rotateX(-90deg); }
            .show-3 { transform: rotateY(90deg); }
            .show-4 { transform: rotateY(-90deg); }
            .show-5 { transform: rotateX(90deg); }
            .show-6 { transform: rotateY(180deg); }
            
            #drawnCardsContainer {
              display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;
              width: 100%; max-width: 600px; justify-content: center; padding: 10px; box-sizing: border-box;
            }
            @media (max-width: 500px) { #drawnCardsContainer { grid-template-columns: 1fr; } }
            
            .drawn-card {
              width: 100%; height: 250px; perspective: 1000px; border-radius: 8px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1); cursor: pointer; transition: box-shadow 0.2s ease, transform 0.3s ease-out;
              background-color: transparent; /* Card itself transparent, inner handles color */
            }
            body.dark-mode .drawn-card { box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
            .drawn-card:hover { 
                transform: translateY(-8px) scale(1.03); 
                box-shadow: 0 8px 20px rgba(0,0,0,0.25); 
            }
            body.dark-mode .drawn-card:hover { box-shadow: 0 8px 20px rgba(255,255,255,0.2); }
            
            .card-inner {
              position: relative; width: 100%; height: 100%; text-align: center;
              transition: transform 0.6s; transform-style: preserve-3d; border-radius: 8px; overflow: hidden;
            }
            .drawn-card.selected .card-inner { transform: rotateY(180deg); }
            
            .card-face {
              position: absolute; width: 100%; height: 100%; -webkit-backface-visibility: hidden; backface-visibility: hidden;
              border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center;
              padding: 10px; box-sizing: border-box;
            }
            .card-back { background-color: var(--primary-color); color: white; transform: rotateY(0deg); }
            body.dark-mode .card-back { background-color: var(--primary-color-dark); color: var(--background-dark); }
            .card-back img { max-width: 90%; max-height: 80%; object-fit: contain; margin: 0; }
            
            .card-front {
              background: white; color: #333; transform: rotateY(180deg); justify-content: space-between; padding-top: 20px;
            }
            body.dark-mode .card-front { background: var(--surface-dark); color: var(--text-dark); }
            .card-front img {
              max-width: 100%; max-height: 120px; object-fit: contain; border-radius: 4px; margin-top: 0; margin-bottom: 8px;
            }
            .card-front .card-lucky-number { font-size: 0.95em; font-weight:bold; color:var(--primary-color); margin-top:5px; }
            body.dark-mode .card-front .card-lucky-number { color:var(--primary-color-dark); }
            .card-front .card-date { font-size: 0.8em; color: var(--text-muted-light); margin-bottom: 5px; }
            body.dark-mode .card-front .card-date { color: var(--text-muted-dark); }
            .card-front .card-text {
              font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
              -webkit-line-clamp: 3; -webkit-box-orient: vertical; line-height: 1.3em; height: 3.9em; flex-grow: 1; margin-bottom: 10px;
            }
            body.dark-mode .card-front .card-text { color: var(--text-dark); }
            
            .gacha-buttons { display: flex; gap: 15px; margin-top: 20px; }
            .gacha-buttons button {
              padding: 10px 20px; border-radius: 8px; font-size: 1.1em; cursor: pointer; border: none;
              font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.1);
              transition: background-color 0.2s, transform 0.1s;
            }
            #rollDiceBtn { background-color: var(--primary-color); color: white; }
            #rollDiceBtn:hover { background-color: #483dbb; transform: scale(1.05); }
            body.dark-mode #rollDiceBtn { background-color: var(--primary-color-dark); color: var(--background-dark); }
            body.dark-mode #rollDiceBtn:hover { background-color: #a46de5; }
            #drawAgainBtn { background-color: #28a745; color: white; }
            #drawAgainBtn:hover { background-color: #218838; transform: scale(1.05); }
        </style>

        <button id="drawCardBtn">抽仙佛</button>

        <div id="gachaModalOverlay" class="custom-prompt-overlay">
            <div id="gachaModal" class="custom-prompt">
                <button id="closeGachaBtn" class="close-button" title="關閉抽卡">×</button>
                <h2>抽仙佛小卡</h2>
                <p id="gachaInstructions">點擊「擲骰子」來決定抽卡數量</p>
                <div id="diceResultDisplay">
                    <div id="dice-container" class="hidden">
                        <div id="dice-cube">
                            <!-- Face 1 -->
                            <div class="face front"><div class="dot center"></div></div>
                            <!-- Face 2 -->
                            <div class="face bottom"><div class="dot tl"></div><div class="dot br"></div></div>
                            <!-- Face 3 -->
                            <div class="face right"><div class="dot tl"></div><div class="dot center"></div><div class="dot br"></div></div>
                            <!-- Face 4 -->
                            <div class="face left">
                                <div class="dot tl"></div><div class="dot tr"></div>
                                <div class="dot bl"></div><div class="dot br"></div>
                            </div>
                            <!-- Face 5 -->
                            <div class="face top">
                                <div class="dot tl"></div><div class="dot tr"></div>
                                <div class="dot bl"></div><div class="dot br"></div>
                                <div class="dot center"></div>
                            </div>
                            <!-- Face 6 -->
                            <div class="face back">
                                <div class="dot c1r1"></div><div class="dot c3r1"></div>
                                <div class="dot c1r2"></div><div class="dot c3r2"></div>
                                <div class="dot c2r1"></div><div class="dot c2r2"></div>
                            </div>
                        </div>
                    </div>
                    <span id="dice-text-result" style="display: none; font-size: 1.5em;"></span>
                </div>
                <div id="drawnCardsContainer"></div>
                <div class="gacha-buttons">
                    <button id="rollDiceBtn">擲骰子</button>
                    <button id="drawAgainBtn" style="display: none;">再抽一次</button>
                </div>
            </div>
        </div>
    `;

    // 獲取 DOM 元素 (確保在 HTML 注入後獲取)
    _drawCardBtn = document.getElementById('drawCardBtn');
    _gachaModalOverlay = document.getElementById('gachaModalOverlay');
    _gachaModal = document.getElementById('gachaModal');
    _closeGachaBtn = document.getElementById('closeGachaBtn');
    _rollDiceBtn = document.getElementById('rollDiceBtn'); 
    _drawAgainBtn = document.getElementById('drawAgainBtn');
    _diceResultDisplay = document.getElementById('diceResultDisplay');
    _drawnCardsContainer = document.getElementById('drawnCardsContainer');
    _gachaInstructions = document.getElementById('gachaInstructions');

    _diceContainer = document.getElementById('dice-container');
    _diceCube = document.getElementById('dice-cube');
    _diceTextResult = document.getElementById('dice-text-result');

    // 初始化時先更新按鈕顯示，檢查抽卡次數
    updateDrawCountDisplay();

    // 設置事件監聽器
    _drawCardBtn.addEventListener('click', showGachaModal); 
    _closeGachaBtn.addEventListener('click', hideGachaModal);
    _rollDiceBtn.addEventListener('click', startGachaProcess); 
    _drawAgainBtn.addEventListener('click', startGachaProcess); 
    _gachaModalOverlay.addEventListener('click', (event) => {
        // 點擊背景關閉模態框，但機會用完時不應關閉
        if (event.target === _gachaModalOverlay) {
             const remainingDraws = MAX_DAILY_DRAWS - currentDraws;
             // 如果還有機會，或倒計時已經停止了（表示時間已過並已重置），才允許點擊背景關閉
             if (remainingDraws > 0 || countdownInterval === null) {
                hideGachaModal();
             }
        }
    });
}

// 將初始化函數暴露到全局作用域，以便 index.html 可以調用
window.initializeBudaCardsLogic = initializeBudaCardsLogic;