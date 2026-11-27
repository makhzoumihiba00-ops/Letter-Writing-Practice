document.addEventListener("DOMContentLoaded", () => {
  // =========================================================
  // State & Configuration
  // =========================================================
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const POSITIVE_MESSAGES = [
    { text: "Good job!", emoji: "🌟" },
    { text: "Amazing!", emoji: "🎉" },
    { text: "Well Done!", emoji: "🏆" }
  ];

  let currentIndex = 0;
  let isDrawing = false;
  let currentTool = "pen"; // "pen" | "eraser"
  let strokeColor = "#1cb0f6";
  let soundEnabled = true;
  let hasDrawnOnCurrent = false;
  let feedbackTimeout = null;
  let autoCheckTimeout = null;

  // =========================================================
  // DOM Elements
  // =========================================================
  const alphabetGrid = document.getElementById("alphabetGrid");
  const currentLetterBadge = document.getElementById("currentLetterBadge");
  const letterCounter = document.getElementById("letterCounter");
  const letterGuide = document.getElementById("letterGuide");
  const canvasStage = document.getElementById("canvasStage");
  const canvas = document.getElementById("drawingCanvas");
  const ctx = canvas.getContext("2d");

  const penToolBtn = document.getElementById("penToolBtn");
  const eraserToolBtn = document.getElementById("eraserToolBtn");
  const colorSwatches = document.querySelectorAll(".color-swatch");

  const clearBtn = document.getElementById("clearBtn");
  const retryBtn = document.getElementById("retryBtn");
  const doneBtn = document.getElementById("doneBtn");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");

  const feedbackPill = document.getElementById("feedbackPill");
  const feedbackText = document.getElementById("feedbackText");
  const feedbackEmoji = document.getElementById("feedbackEmoji");

  // Celebration Modal Elements
  const celebrationModal = document.getElementById("celebrationModal");
  const celebrationBackdrop = document.getElementById("celebrationBackdrop");
  const celebrationTitle = document.getElementById("celebrationTitle");
  const celebrationSubtitle = document.getElementById("celebrationSubtitle");
  const celebrationLetterStat = document.getElementById("celebrationLetterStat");
  const celebrationProgressStat = document.getElementById("celebrationProgressStat");
  const modalRetryBtn = document.getElementById("modalRetryBtn");
  const modalNextBtn = document.getElementById("modalNextBtn");
  const bottomStarsCrowd = document.getElementById("bottomStarsCrowd");

  const soundToggleBtn = document.getElementById("soundToggleBtn");
  const soundIcon = document.getElementById("soundIcon");
  const successAudio = document.getElementById("successAudio");

  // =========================================================
  // Build Alphabet Selector Cards (A - Z)
  // =========================================================
  function renderAlphabetCards() {
    alphabetGrid.innerHTML = "";
    ALPHABET.forEach((letter, index) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "letter-card";
      card.textContent = letter;
      card.setAttribute("role", "option");
      card.setAttribute("aria-label", `Letter ${letter}`);
      card.dataset.index = index;

      if (index === currentIndex) {
        card.classList.add("selected");
        card.setAttribute("aria-selected", "true");
      } else {
        card.setAttribute("aria-selected", "false");
      }

      card.addEventListener("click", () => {
        selectLetter(index);
      });

      alphabetGrid.appendChild(card);
    });
  }

  // =========================================================
  // Canvas Sizing & High-DPI Support
  // =========================================================
  function resizeCanvas(preserveDrawing = true) {
    const rect = canvasStage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    let tempCanvas = null;
    if (preserveDrawing && canvas.width > 0 && canvas.height > 0) {
      tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.drawImage(canvas, 0, 0);
    }

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    configureBrush();

    if (tempCanvas) {
      ctx.drawImage(
        tempCanvas,
        0,
        0,
        tempCanvas.width,
        tempCanvas.height,
        0,
        0,
        rect.width,
        rect.height
      );
    }

    const guideSize = Math.round(Math.min(rect.width * 0.62, rect.height * 0.68));
    letterGuide.style.fontSize = `${guideSize}px`;
  }

  function configureBrush() {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (currentTool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = 30;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 22;
    }
  }

  function clearCanvas() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    hasDrawnOnCurrent = false;
    clearTimeout(autoCheckTimeout);
    configureBrush();
  }

  // =========================================================
  // Smart Letter Tracing Evaluation (Pixel Comparison)
  // =========================================================
  function evaluateTracing() {
    const rect = canvasStage.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w === 0 || h === 0) return { valid: false, reason: "empty" };

    const letter = ALPHABET[currentIndex];
    const guideSize = Math.round(Math.min(w * 0.62, h * 0.68));

    // 1. Render reference letter onto an offscreen canvas at exact center
    const refCanvas = document.createElement("canvas");
    refCanvas.width = w;
    refCanvas.height = h;
    const refCtx = refCanvas.getContext("2d");

    refCtx.fillStyle = "#000000";
    refCtx.font = `700 ${guideSize}px "Fredoka", "Nunito", sans-serif`;
    refCtx.textAlign = "center";
    refCtx.textBaseline = "middle";
    // Slight dilation via stroke so child-friendly tolerance zone around the letter is generous
    refCtx.lineWidth = 18;
    refCtx.lineJoin = "round";
    refCtx.strokeStyle = "#000000";
    refCtx.strokeText(letter, w / 2, h / 2 + guideSize * 0.03);
    refCtx.fillText(letter, w / 2, h / 2 + guideSize * 0.03);

    // 2. Render user's drawing scaled to CSS dimensions (w x h)
    const userCanvas = document.createElement("canvas");
    userCanvas.width = w;
    userCanvas.height = h;
    const userCtx = userCanvas.getContext("2d");
    userCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, w, h);

    const refData = refCtx.getImageData(0, 0, w, h).data;
    const userData = userCtx.getImageData(0, 0, w, h).data;

    let refPixels = 0;
    let userPixels = 0;
    let matchedPixels = 0;
    let outsidePixels = 0;

    // Sample every 2nd pixel for instant mobile performance
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const idx = (y * w + x) * 4 + 3; // Alpha channel
        const isRef = refData[idx] > 40;
        const isUser = userData[idx] > 40;

        if (isRef) refPixels++;
        if (isUser) {
          userPixels++;
          if (isRef) {
            matchedPixels++;
          } else {
            outsidePixels++;
          }
        }
      }
    }

    if (userPixels < 25) {
      return {
        valid: false,
        message: `Trace the letter ${letter} first!`,
        emoji: "✏️"
      };
    }

    const coverage = refPixels > 0 ? matchedPixels / refPixels : 0; // How much of the letter was covered
    const accuracy = userPixels > 0 ? matchedPixels / userPixels : 0; // How much stayed on the letter vs scribbling outside

    // Child-friendly thresholds:
    // - Must cover at least 48% of the letter shape
    // - At least 45% of what they drew must be on the letter (rejects random scribbling)
    if (coverage >= 0.48 && accuracy >= 0.45) {
      return { valid: true };
    }

    if (accuracy < 0.45) {
      return {
        valid: false,
        message: `Stay inside the letter ${letter}! Try again`,
        emoji: "🎯"
      };
    }

    return {
      valid: false,
      message: `Almost! Finish tracing all of ${letter}`,
      emoji: "💪"
    };
  }

  // =========================================================
  // Letter Selection & Navigation
  // =========================================================
  function selectLetter(index) {
    if (index < 0 || index >= ALPHABET.length) return;
    currentIndex = index;
    const letter = ALPHABET[currentIndex];

    currentLetterBadge.textContent = `Letter ${letter}`;
    letterCounter.textContent = `${currentIndex + 1} of ${ALPHABET.length}`;
    letterGuide.textContent = letter;

    letterGuide.classList.remove("pop");
    void letterGuide.offsetWidth;
    letterGuide.classList.add("pop");

    const cards = alphabetGrid.querySelectorAll(".letter-card");
    cards.forEach((card, idx) => {
      const isSelected = idx === currentIndex;
      card.classList.toggle("selected", isSelected);
      card.setAttribute("aria-selected", String(isSelected));
      if (isSelected) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    });

    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex === ALPHABET.length - 1;

    closeCelebrationModal();
    hideFeedback();
    clearCanvas();
    setTool("pen");
  }

  // =========================================================
  // Smooth Pointer Drawing (Mouse, Touch, Stylus)
  // =========================================================
  function getPointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0 && event.pointerType === "mouse") {
      return;
    }
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);

    isDrawing = true;
    clearTimeout(autoCheckTimeout);
    configureBrush();

    const pos = getPointerPosition(event);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(pos.x + 0.01, pos.y + 0.01);
    ctx.stroke();

    if (currentTool === "pen") {
      hasDrawnOnCurrent = true;
    }
  }

  function handlePointerMove(event) {
    if (!isDrawing) return;
    event.preventDefault();

    const pos = getPointerPosition(event);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function handlePointerUp(event) {
    if (!isDrawing) return;
    isDrawing = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    ctx.beginPath();

    // Auto-check when child pauses after drawing
    if (hasDrawnOnCurrent && currentTool === "pen") {
      clearTimeout(autoCheckTimeout);
      autoCheckTimeout = setTimeout(() => {
        const result = evaluateTracing();
        if (result.valid) {
          const pick = POSITIVE_MESSAGES[Math.floor(Math.random() * POSITIVE_MESSAGES.length)];
          showToast(pick.text, pick.emoji, true);
        } else if (result.message) {
          showToast(result.message, result.emoji, false);
        }
      }, 1100);
    }
  }

  // =========================================================
  // Tools & Colors
  // =========================================================
  function setTool(tool) {
    currentTool = tool;
    const isPen = tool === "pen";

    penToolBtn.classList.toggle("active", isPen);
    penToolBtn.setAttribute("aria-pressed", String(isPen));

    eraserToolBtn.classList.toggle("active", !isPen);
    eraserToolBtn.setAttribute("aria-pressed", String(!isPen));

    canvas.classList.toggle("eraser-cursor", !isPen);
    configureBrush();
  }

  penToolBtn.addEventListener("click", () => setTool("pen"));
  eraserToolBtn.addEventListener("click", () => setTool("eraser"));

  colorSwatches.forEach((swatch) => {
    swatch.addEventListener("click", () => {
      colorSwatches.forEach((s) => s.classList.remove("active"));
      swatch.classList.add("active");
      strokeColor = swatch.dataset.color;
      setTool("pen");
    });
  });

  // =========================================================
  // Feedback Toast, Celebration Modal & Sound
  // =========================================================
  function playCheerfulSound() {
    if (!soundEnabled) return;

    if (successAudio && successAudio.readyState >= 2) {
      successAudio.currentTime = 0;
      successAudio.play().catch(() => playSynthChime());
    } else {
      playSynthChime();
    }
  }

  function playGentleTryAgainSound() {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const notes = [392.0, 329.63]; // G4 -> E4 gentle boop

      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;

        const startTime = audioCtx.currentTime + idx * 0.12;
        gain.gain.setValueAtTime(0.14, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.26);
      });
    } catch (_) {}
  }

  function playSynthChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const notes = [523.25, 659.25, 783.99, 1046.5];

      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;

        const startTime = audioCtx.currentTime + idx * 0.08;
        gain.gain.setValueAtTime(0.16, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.36);
      });
    } catch (_) {}
  }

  function showToast(text, emoji, isSuccess = true) {
    if (!feedbackPill) return;
    feedbackText.textContent = text;
    feedbackEmoji.textContent = emoji;
    feedbackPill.style.borderColor = isSuccess ? "#58cc02" : "#ff9600";
    feedbackPill.classList.add("show");

    clearTimeout(feedbackTimeout);
    feedbackTimeout = setTimeout(() => {
      hideFeedback();
    }, 2400);
  }

  function hideFeedback() {
    if (feedbackPill) {
      feedbackPill.classList.remove("show");
    }
  }

  function spawnBottomStars() {
    if (!bottomStarsCrowd) return;
    bottomStarsCrowd.innerHTML = "";

    const starConfigs = [
      { size: 78, delay: "0s" },
      { size: 96, delay: "0.2s" },
      { size: 74, delay: "0.4s" },
      { size: 102, delay: "0.15s" },
      { size: 82, delay: "0.35s" },
      { size: 92, delay: "0.1s" },
      { size: 76, delay: "0.3s" }
    ];

    starConfigs.forEach((cfg) => {
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.classList.add("crowd-star");
      svg.style.setProperty("--size", `${cfg.size}px`);
      svg.style.setProperty("--delay", cfg.delay);

      svg.innerHTML = `
        <path
          d="M50 6 L63 34 L94 38 L71 60 L77 91 L50 76 L23 91 L29 60 L6 38 L37 34 Z"
          fill="#FFE14D"
          stroke="#F59E0B"
          stroke-width="5"
          stroke-linejoin="round"
        />
        <circle cx="40" cy="48" r="4" fill="#4A2E00" />
        <circle cx="60" cy="48" r="4" fill="#4A2E00" />
        <ellipse cx="34" cy="54" rx="4.5" ry="2.5" fill="#FF8A80" />
        <ellipse cx="66" cy="54" rx="4.5" ry="2.5" fill="#FF8A80" />
        <path d="M44 55 Q50 62 56 55" stroke="#4A2E00" stroke-width="3.5" fill="none" stroke-linecap="round" />
      `;

      bottomStarsCrowd.appendChild(svg);
    });
  }

  function openCelebrationModal() {
    hideFeedback();
    playCheerfulSound();

    const letter = ALPHABET[currentIndex];
    const pick = POSITIVE_MESSAGES[Math.floor(Math.random() * POSITIVE_MESSAGES.length)];

    if (celebrationModal) {
      if (celebrationTitle) celebrationTitle.textContent = pick.text;
      if (celebrationSubtitle) {
        celebrationSubtitle.textContent = `You traced the letter ${letter}!`;
      }
      if (celebrationLetterStat) celebrationLetterStat.textContent = `Letter ${letter}`;
      if (celebrationProgressStat) {
        celebrationProgressStat.textContent = `${currentIndex + 1} / ${ALPHABET.length}`;
      }
      if (modalNextBtn) {
        modalNextBtn.textContent =
          currentIndex < ALPHABET.length - 1 ? "Next Letter →" : "Start Over ↻";
      }

      spawnBottomStars();
      celebrationModal.hidden = false;
    }
  }

  function closeCelebrationModal() {
    if (celebrationModal) {
      celebrationModal.hidden = true;
    }
  }

  // =========================================================
  // Control Buttons & Event Listeners
  // =========================================================
  clearBtn.addEventListener("click", () => {
    hideFeedback();
    clearCanvas();
  });

  retryBtn.addEventListener("click", () => {
    closeCelebrationModal();
    hideFeedback();
    clearCanvas();
    setTool("pen");
    letterGuide.classList.remove("pop");
    void letterGuide.offsetWidth;
    letterGuide.classList.add("pop");
  });

  // Verify letter before celebrating!
  doneBtn.addEventListener("click", () => {
    clearTimeout(autoCheckTimeout);
    const result = evaluateTracing();

    if (result.valid) {
      openCelebrationModal();
    } else {
      playGentleTryAgainSound();
      showToast(result.message, result.emoji, false);
      // Shake guide gently so child sees what to trace
      letterGuide.classList.remove("pop");
      void letterGuide.offsetWidth;
      letterGuide.classList.add("pop");
    }
  });

  if (modalRetryBtn) {
    modalRetryBtn.addEventListener("click", () => {
      closeCelebrationModal();
      clearCanvas();
      setTool("pen");
    });
  }

  if (modalNextBtn) {
    modalNextBtn.addEventListener("click", () => {
      closeCelebrationModal();
      if (currentIndex < ALPHABET.length - 1) {
        selectLetter(currentIndex + 1);
      } else {
        selectLetter(0);
      }
    });
  }

  if (celebrationBackdrop) {
    celebrationBackdrop.addEventListener("click", closeCelebrationModal);
  }

  prevBtn.addEventListener("click", () => {
    if (currentIndex > 0) {
      selectLetter(currentIndex - 1);
    }
  });

  nextBtn.addEventListener("click", () => {
    if (currentIndex < ALPHABET.length - 1) {
      selectLetter(currentIndex + 1);
    }
  });

  soundToggleBtn.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    soundToggleBtn.setAttribute("aria-pressed", String(soundEnabled));
    soundIcon.textContent = soundEnabled ? "🔊" : "🔇";
  });

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerUp);

  canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  window.addEventListener("resize", () => resizeCanvas(true));

  // =========================================================
  // Initialize App
  // =========================================================
  renderAlphabetCards();
  resizeCanvas(false);
  selectLetter(0);
});