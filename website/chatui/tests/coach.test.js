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
        respond: (ok, data) => respond({ ok, json: async () => ({ data }) }) };
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
