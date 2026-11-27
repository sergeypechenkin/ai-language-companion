(() => {
    const $ = id => document.getElementById(id);
    const form = $("coach-form"), input = $("coach-input"), language = $("coach-language");
    const record = $("coach-record"), send = $("coach-send"), status = $("coach-status");
    const result = $("coach-result"), original = $("coach-original"), improved = $("coach-improved");
    const play = $("coach-play"), stop = $("coach-stop");
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition, recording = false, processing = false, dictated = false;
    let resultLanguage = "", playbackId = 0, playbackTimer;

    function updateControls() {
        send.disabled = processing || recording || !input.value.trim();
        record.disabled = processing || !Recognition;
        language.disabled = processing || recording;
        $("coach-speech-language").disabled = processing || recording;
        input.readOnly = processing || recording;
        record.textContent = recording ? "Stop dictation" : "Start dictation";
    }

    function stopPlayback() {
        playbackId++;
        clearTimeout(playbackTimer);
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        stop.disabled = true;
        play.disabled = false;
    }

    function playResult(automatic = false) {
        stopPlayback();
        if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
            status.textContent = "Playback is not supported in this browser.";
            return;
        }
        const id = playbackId;
        const utterance = new SpeechSynthesisUtterance(improved.textContent);
        utterance.lang = resultLanguage;
        const voices = window.speechSynthesis.getVoices();
        const voice = voices.find(v => v.lang.toLowerCase() === resultLanguage.toLowerCase()) ||
            voices.find(v => v.lang.toLowerCase().split("-")[0] === resultLanguage.toLowerCase().split("-")[0]);
        if (voice) utterance.voice = voice;
        stop.disabled = false;
        play.disabled = true;
        status.textContent = "Starting playback…";
        utterance.onstart = () => {
            if (id !== playbackId) return;
            clearTimeout(playbackTimer);
            status.textContent = "Playing.";
        };
        utterance.onend = () => {
            if (id !== playbackId) return;
            stopPlayback();
            status.textContent = "Playback finished.";
        };
        utterance.onerror = () => {
            if (id !== playbackId) return;
            stopPlayback();
            status.textContent = "Playback failed. Press Play to try again.";
        };
        try {
            window.speechSynthesis.speak(utterance);
            playbackTimer = setTimeout(() => {
                if (id !== playbackId) return;
                stopPlayback();
                status.textContent = automatic ? "Autoplay unavailable. Press Play to listen." : "Playback could not start. Press Play to try again.";
            }, 3000);
        } catch {
            stopPlayback();
            status.textContent = "Playback failed. Press Play to try again.";
        }
    }

    $("chat-mode").addEventListener("click", () => {
        $("chat-panel").hidden = false;
        $("coach-panel").hidden = true;
        $("chat-mode").setAttribute("aria-pressed", "true");
        $("coach-mode").setAttribute("aria-pressed", "false");
        if (recording) recognition.stop();
        stopPlayback();
    });
    $("coach-mode").addEventListener("click", () => {
        $("chat-panel").hidden = true;
        $("coach-panel").hidden = false;
        $("chat-mode").setAttribute("aria-pressed", "false");
        $("coach-mode").setAttribute("aria-pressed", "true");
    });
    input.addEventListener("input", () => {
        if (!input.value.trim()) dictated = false;
        updateControls();
    });
    record.addEventListener("click", () => {
        if (recording) {
            recognition.stop();
            return;
        }
        if (!Recognition) return;
        recognition = new Recognition();
        recognition.lang = $("coach-speech-language").value;
        recognition.interimResults = false;
        recognition.onresult = event => {
            let transcript = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) transcript += event.results[i][0].transcript;
            }
            if (transcript) {
                input.value += (input.value && !/\s$/.test(input.value) ? " " : "") + transcript;
                dictated = true;
            }
        };
        recognition.onerror = () => {
            status.textContent = "Dictation failed. Check microphone permissions and try again; your text is retained.";
        };
        recognition.onend = () => {
            recording = false;
            updateControls();
            if (status.textContent === "Recording…") status.textContent = "Dictation stopped. Review your text before sending.";
        };
        try {
            recording = true;
            updateControls();
            status.textContent = "Recording…";
            recognition.start();
        } catch {
            recording = false;
            updateControls();
            status.textContent = "Could not start dictation. Check microphone permissions and try again.";
        }
    });
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (processing || recording || !input.value.trim()) return;
        const text = input.value, selectedLanguage = language.value, wasDictated = dictated;
        processing = true;
        updateControls();
        stopPlayback();
        status.textContent = "Processing…";
        try {
            const response = await fetch("/coach", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text, language: selectedLanguage })
            });
            if (!response.ok) throw new Error("request failed");
            const data = await response.json();
            if (typeof data.data !== "string" || !data.data.trim()) throw new Error("empty response");
            original.textContent = text;
            improved.textContent = data.data;
            resultLanguage = selectedLanguage;
            result.hidden = false;
            status.textContent = "Ready.";
            if (wasDictated && !$("coach-panel").hidden) playResult(true);
        } catch {
            status.textContent = "Coach could not process your text. Please try again; your text is retained.";
        } finally {
            processing = false;
            updateControls();
        }
    });
    play.addEventListener("click", () => playResult());
    stop.addEventListener("click", () => {
        stopPlayback();
        status.textContent = "Playback stopped.";
    });
    updateControls();
    if (!Recognition) status.textContent = "Dictation is not supported in this browser. You can still type.";
})();
