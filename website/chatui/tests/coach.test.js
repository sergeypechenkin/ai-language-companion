const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function setup() {
    const ids = ["coach-form", "coach-input", "coach-language", "coach-speech-language", "coach-record",
        "coach-send", "coach-status", "coach-result", "coach-original", "coach-improved", "coach-play",
        "coach-stop", "chat-mode", "coach-mode", "chat-panel", "coach-panel"];
    const elements = Object.fromEntries(ids.map(id => [id, {
        value: "", textContent: "", disabled: false, hidden: false, handlers: {},
        addEventListener(type, handler) { this.handlers[type] = handler; },
        setAttribute() {},
        fire(type, event = {}) { return this.handlers[type]({ preventDefault() {}, ...event }); }
    }]));
    elements["coach-language"].value = "es-ES";
    elements["coach-speech-language"].value = "en-US";
    let recognition, spoken, timer;
    class Recognition {
        constructor() { recognition = this; }
        start() {}
        stop() { this.onend(); }
    }
    class Utterance { constructor(text) { this.text = text; } }
    const synth = {
        cancels: 0,
        getVoices: () => [], cancel() { this.cancels++; },
        speak(utterance) { spoken = utterance; }
    };
    const requests = [];
    let respond;
    const fetch = (url, options) => {
        requests.push({ url, ...options });
        return new Promise(resolve => { respond = resolve; });
    };
    const context = {
        window: { SpeechRecognition: Recognition, speechSynthesis: synth, SpeechSynthesisUtterance: Utterance },
        document: { getElementById: id => elements[id] },
        SpeechSynthesisUtterance: Utterance, fetch,
        setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => { timer = null; }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../wwwroot/js/coach.js"), "utf8"), context);
    return { elements, requests, synth, get recognition() { return recognition; },
        get spoken() { return spoken; }, get timer() { return timer; },
        respond: (ok, data) => respond({ ok, json: async () => ({ data }) }),
        respondError: body => respond({ ok: false, json: async () => body }),
        respondInvalidJson: () => respond({ ok: false, json: async () => { throw new SyntaxError("Invalid JSON"); } }) };
}

test("typed input waits for Send, sends selected language once, and plays only on demand", async () => {
    const app = setup(), e = app.elements;
    e["coach-input"].value = "  ";
    e["coach-input"].fire("input");
    await e["coach-form"].fire("submit");
    assert.equal(app.requests.length, 0);
    e["coach-input"].value = "Hello";
    e["coach-input"].fire("input");
    assert.equal(app.requests.length, 0);
    const pending = e["coach-form"].fire("submit");
    await e["coach-form"].fire("submit");
    assert.equal(app.requests.length, 1);
    assert.deepEqual(JSON.parse(app.requests[0].body), { text: "Hello", language: "es-ES" });
    app.respond(true, "Hola");
    await pending;
    assert.equal(e["coach-original"].textContent, "Hello");
    assert.equal(e["coach-improved"].textContent, "Hola");
    assert.equal(e["coach-improved"].lang, "es-ES");
    assert.equal(app.spoken, undefined);
    e["coach-play"].fire("click");
    assert.equal(app.spoken.text, "Hola");
    assert.equal(app.spoken.lang, "es-ES");
    e["coach-stop"].fire("click");
    assert.equal(e["coach-stop"].disabled, true);
});

test("dictation remains editable, waits for Send and falls back when autoplay cannot start", async () => {
    const app = setup(), e = app.elements;
    e["coach-record"].fire("click");
    assert.equal(app.recognition.lang, "en-US");
    const alternative = [{ transcript: "Hello" }];
    alternative.isFinal = true;
    app.recognition.onresult({ resultIndex: 0, results: [alternative] });
    assert.equal(app.requests.length, 0);
    app.recognition.onend();
    e["coach-input"].value = "Hello there";
    e["coach-input"].fire("input");
    const pending = e["coach-form"].fire("submit");
    app.respond(true, "Hola");
    await pending;
    assert.equal(app.spoken.lang, "es-ES");
    app.timer();
    assert.match(e["coach-status"].textContent, /Autoplay unavailable/);
    assert.equal(e["coach-play"].disabled, false);
    e["coach-play"].fire("click");
    app.spoken.onstart();
    assert.equal(e["coach-status"].textContent, "Playing.");
    app.spoken.onend();
    assert.equal(e["coach-play"].disabled, false);
});

test("request and dictation errors retain input and previous results", async () => {
    const app = setup(), e = app.elements;
    e["coach-input"].value = "Try again";
    e["coach-input"].fire("input");
    const pending = e["coach-form"].fire("submit");
    app.respond(false);
    await pending;
    assert.equal(e["coach-input"].value, "Try again");
    assert.match(e["coach-status"].textContent, /try again/i);
    e["coach-record"].fire("click");
    app.recognition.onerror();
    app.recognition.onend();
    assert.equal(e["coach-input"].value, "Try again");
    assert.match(e["coach-status"].textContent, /Dictation failed/);
});

test("replacing a dictated draft is typed input and recording stops playback", async () => {
    const app = setup(), e = app.elements;
    e["coach-record"].fire("click");
    const alternative = [{ transcript: "Hello" }];
    alternative.isFinal = true;
    app.recognition.onresult({ resultIndex: 0, results: [alternative] });
    app.recognition.onend();
    e["coach-input"].selectionStart = 0;
    e["coach-input"].selectionEnd = e["coach-input"].value.length;
    e["coach-input"].fire("beforeinput", { inputType: "insertText" });
    e["coach-input"].value = "Typed replacement";
    e["coach-input"].fire("input");
    const pending = e["coach-form"].fire("submit");
    app.respond(true, "Replacement");
    await pending;
    assert.equal(app.spoken, undefined);
    e["coach-play"].fire("click");
    const cancels = app.synth.cancels;
    e["coach-record"].fire("click");
    assert.equal(app.synth.cancels, cancels + 1);
    assert.equal(e["coach-play"].disabled, true);
    app.recognition.onend();
    assert.equal(e["coach-play"].disabled, false);
});

test("server errors are displayed as text while the draft and previous result are retained", async () => {
    const app = setup(), e = app.elements;
    e["coach-input"].value = "Hello";
    e["coach-input"].fire("input");
    let pending = e["coach-form"].fire("submit");
    app.respond(true, "Hola");
    await pending;
    e["coach-input"].value = "Try again";
    e["coach-input"].fire("input");
    pending = e["coach-form"].fire("submit");
    app.respondError({ error: "Coach is not configured. Please contact the administrator." });
    await pending;
    assert.equal(e["coach-status"].textContent,
        "Coach is not configured. Please contact the administrator. Your text is retained.");
    assert.equal(e["coach-input"].value, "Try again");
    assert.equal(e["coach-original"].textContent, "Hello");
    assert.equal(e["coach-improved"].textContent, "Hola");
    assert.equal(e["coach-send"].disabled, false);
});

test("invalid or missing server error bodies use the generic fallback", async () => {
    const app = setup(), e = app.elements;
    e["coach-input"].value = "Hello";
    for (const body of [null, {}, { error: "" }, { error: 503 }]) {
        const pending = e["coach-form"].fire("submit");
        app.respondError(body);
        await pending;
        assert.match(e["coach-status"].textContent, /Please try again; your text is retained/);
    }
    const pending = e["coach-form"].fire("submit");
    app.respondInvalidJson();
    await pending;
    assert.match(e["coach-status"].textContent, /Please try again; your text is retained/);
    assert.equal(e["coach-input"].value, "Hello");
});

test("resubmitting an unchanged dictated draft autoplays in the newly selected language", async () => {
    const app = setup(), e = app.elements;
    e["coach-record"].fire("click");
    const alternative = [{ transcript: "Hello" }];
    alternative.isFinal = true;
    app.recognition.onresult({ resultIndex: 0, results: [alternative] });
    app.recognition.onend();
    let pending = e["coach-form"].fire("submit");
    app.respond(true, "Hola");
    await pending;
    const firstPlayback = app.spoken;
    e["coach-language"].value = "fr-FR";
    pending = e["coach-form"].fire("submit");
    app.respond(true, "Bonjour");
    await pending;
    assert.notEqual(app.spoken, firstPlayback);
    assert.equal(app.spoken.text, "Bonjour");
    assert.equal(app.spoken.lang, "fr-FR");
    assert.equal(e["coach-improved"].lang, "fr-FR");
});

test("clearing a submitted dictated draft resets autoplay for the next typed draft", async () => {
    const app = setup(), e = app.elements;
    e["coach-record"].fire("click");
    const alternative = [{ transcript: "Hello" }];
    alternative.isFinal = true;
    app.recognition.onresult({ resultIndex: 0, results: [alternative] });
    app.recognition.onend();
    let pending = e["coach-form"].fire("submit");
    app.respond(true, "Hola");
    await pending;
    const firstPlayback = app.spoken;
    e["coach-input"].value = "";
    e["coach-input"].fire("input");
    e["coach-input"].value = "Typed draft";
    e["coach-input"].fire("input");
    pending = e["coach-form"].fire("submit");
    app.respond(true, "Texto escrito");
    await pending;
    assert.equal(app.spoken, firstPlayback);
});

for (const started of [false, true]) {
    test(`switching to Chat resets ${started ? "active" : "starting"} playback without losing the result`, async () => {
        const app = setup(), e = app.elements;
        e["coach-input"].value = "Hello";
        const pending = e["coach-form"].fire("submit");
        app.respond(true, "Hola");
        await pending;
        e["coach-play"].fire("click");
        const utterance = app.spoken;
        const timeout = app.timer;
        if (started) utterance.onstart();
        const cancels = app.synth.cancels;
        e["chat-mode"].fire("click");
        assert.equal(app.synth.cancels, cancels + 1);
        assert.equal(app.timer, null);
        assert.equal(e["coach-stop"].disabled, true);
        assert.equal(e["coach-play"].disabled, false);
        utterance.onstart();
        utterance.onend();
        utterance.onerror();
        timeout();
        e["coach-mode"].fire("click");
        assert.equal(e["coach-status"].textContent, "Playback stopped.");
        assert.equal(e["coach-original"].textContent, "Hello");
        assert.equal(e["coach-improved"].textContent, "Hola");
        e["coach-play"].fire("click");
        assert.notEqual(app.spoken, utterance);
        assert.equal(app.spoken.text, "Hola");
    });
}

test("switching modes preserves processing and server error status", async () => {
    const app = setup(), e = app.elements;
    e["coach-input"].value = "Hello";
    const pending = e["coach-form"].fire("submit");
    e["chat-mode"].fire("click");
    e["coach-mode"].fire("click");
    assert.equal(e["coach-status"].textContent, "Processing…");
    assert.equal(e["coach-send"].disabled, true);
    app.respondError({ error: "Coach is not configured. Please contact the administrator." });
    await pending;
    const error = e["coach-status"].textContent;
    e["chat-mode"].fire("click");
    e["coach-mode"].fire("click");
    assert.equal(e["coach-status"].textContent, error);
    assert.equal(e["coach-input"].value, "Hello");
});
