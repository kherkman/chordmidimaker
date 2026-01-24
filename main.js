/**
 * main.js
 * Chord Sequencer & Generator Logic
 * Multi-Track Support (Chords, Bass, Lead), Ghost Notes, Bass Generation.
 */

// --- KONFIGURAATIO JA VAKIOT ---
const CONFIG = {
    baseFreq: 261.63, // C4
    loopStart: 0.0,
    loopEnd: 2.0, // Sample loop points (if needed)
    lookahead: 25.0, // ms
    scheduleAheadTime: 0.1, // s
    ppq: 24, // Pulses per quarter note
    noteHeight: 14, // px per key
    pxPerBeat: 50,  // Leveys per isku
    
    // Värit (Päivitetään teeman mukaan, mutta tässä kanavakohtaiset oletukset)
    colors: {
        bg: '#0f0f0f',
        gridLines: '#222',
        gridBlack: '#1a1a1a', 
        gridWhite: '#2a2a2a', 
        gridScale: '#2e1c36', 
        
        // Kanavien värit
        ch0: '#9c27b0', // Chords (Violetti)
        ch1: '#00bcd4', // Bass (Cyan)
        ch2: '#ff9800', // Lead (Oranssi)
        
        playhead: '#ff4081',   
        text: '#888',
        selection: 'rgba(255, 255, 255, 0.3)' 
    }
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Laajennettu sointukirjasto
const CHORD_FORMULAS = {
    // Triads
    "maj": [0, 4, 7],
    "min": [0, 3, 7],
    "sus2": [0, 2, 7],
    "sus4": [0, 5, 7],
    "dim": [0, 3, 6],
    "aug": [0, 4, 8],
    // 6th
    "6": [0, 4, 7, 9],
    "m6": [0, 3, 7, 9],
    // 7th
    "7": [0, 4, 7, 10],       
    "maj7": [0, 4, 7, 11],    
    "m7": [0, 3, 7, 10],      
    "mmaj7": [0, 3, 7, 11],   
    "dim7": [0, 3, 6, 9],     
    "m7b5": [0, 3, 6, 10],    
    // Extensions
    "add9": [0, 4, 7, 14],
    "9": [0, 4, 7, 10, 14],
    "11": [0, 7, 10, 14, 17],
    "13": [0, 7, 10, 14, 21]
};

// --- GLOBAL STATE ---
const State = {
    audioCtx: null,
    // Puskurit kolmelle instrumentille
    buffers: [null, null, null], 
    
    bpm: 120,
    isPlaying: false,
    startTime: 0, 
    nextNoteTime: 0.0,
    
    // Sekvensserin tila
    channelTimes: null,
    channelIndices: [0, 0, 0], // Jokaisen kanavan eteneminen erikseen
    
    scale: new Set([0, 2, 4, 5, 7, 9, 11]), // C Major oletus
    
    // MONIRAITA TUKI
    // channels[0] = Chords, channels[1] = Bass, channels[2] = Lead
    channels: [[], [], []], 
    activeChannel: 0, // 0, 1, tai 2
    
    // UI Valinnat
    selectedOctave: 3,
    selectedRoot: null, 
    selectedType: 'maj',
    selectedInv: 0,
    selectedDur: 4, // 4 = 1 beat
    
    // Editointi tila
    selectedStepIndex: -1, // Kohdistuu aina activeChanneliin
    
    // ARP Tila
    arpOctaveLow: false,
    arpOctaveHigh: false,
    
    transpose: 0, 
    midiOutput: null,
    animationId: null
};

// --- AUDIO ENGINE ---

async function initAudio() {
    if (State.audioCtx) return;
    
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    State.audioCtx = new AudioContext();
    
    // Ladataan 3 eri samplea
    const fileNames = ['sound1.wav', 'sound2.wav', 'sound3.wav'];
    
    try {
        const promises = fileNames.map(async (file, index) => {
            const response = await fetch(file);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await State.audioCtx.decodeAudioData(arrayBuffer);
            State.buffers[index] = audioBuffer;
        });
        await Promise.all(promises);
        console.log("Audio buffers loaded.");
    } catch (e) {
        console.error("Virhe ladatessa äänitiedostoja", e);
    }
}

function playSound(midiNote, durationTime, startTime, channelIndex) {
    // Valitse oikea puskuri kanavan mukaan
    const buffer = State.buffers[channelIndex];
    if (!buffer) return;

    // Transponointi (Global)
    const finalNote = midiNote + State.transpose;
    
    const source = State.audioCtx.createBufferSource();
    source.buffer = buffer;
    
    // Pitch shift (Base C4 = 60 kaikille sampleille oletuksena)
    const playbackRate = Math.pow(2, (finalNote - 60) / 12);
    source.playbackRate.value = playbackRate;
    
    source.loop = true;
    source.loopStart = CONFIG.loopStart;
    source.loopEnd = CONFIG.loopEnd;
    
    const gainNode = State.audioCtx.createGain();
    source.connect(gainNode);
    gainNode.connect(State.audioCtx.destination);
    
    const attack = 0.02;
    const release = 0.05;
    
    // Envelope
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.8, startTime + attack);
    
    const stopTime = startTime + durationTime;
    if (stopTime > startTime) {
        gainNode.gain.setValueAtTime(0.8, Math.max(startTime + attack, stopTime - release));
        gainNode.gain.linearRampToValueAtTime(0, stopTime);
        
        source.start(startTime);
        source.stop(stopTime + 0.1);
    }
}

// --- MIDI ENGINE ---

function initMidi() {
    if (navigator.requestMIDIAccess) {
        navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure);
    }
}

function onMIDISuccess(midiAccess) {
    const outputs = midiAccess.outputs;
    const select = document.getElementById('midiOutSelect');
    select.innerHTML = '<option value="">-- MIDI Out --</option>';
    
    outputs.forEach(output => {
        const option = document.createElement('option');
        option.value = output.id;
        option.text = output.name;
        select.appendChild(option);
    });
    
    select.addEventListener('change', (e) => {
        const id = e.target.value;
        State.midiOutput = id ? midiAccess.outputs.get(id) : null;
    });
}

function onMIDIFailure() {
    console.warn("Web MIDI ei saatavilla.");
}

function sendMidiNote(note, durationTime, channel) {
    if (!State.midiOutput) return;
    const finalNote = note + State.transpose;
    // MIDI Channel: 0x90 = Ch1, 0x91 = Ch2, 0x92 = Ch3
    const noteOnStatus = 0x90 + channel;
    const noteOffStatus = 0x80 + channel;
    
    State.midiOutput.send([noteOnStatus, finalNote, 100]);
    setTimeout(() => {
        State.midiOutput.send([noteOffStatus, finalNote, 0]);
    }, durationTime * 1000);
}

// --- SEQUENCER LOGIC ---

function scheduler() {
    if (!State.channelTimes) {
        State.channelTimes = [State.nextNoteTime, State.nextNoteTime, State.nextNoteTime];
    }

    // LASKETAAN PISIN KANAVA LOOPPAAKSEEN
    const channelLengths = State.channels.map(ch => {
        if (!ch || ch.length === 0) return 0;
        return ch.reduce((sum, s) => sum + (s.duration / 4), 0);
    });
    const maxChannelLength = Math.max(...channelLengths);
    
    for (let ch = 0; ch < 3; ch++) {
        while (State.channelTimes[ch] < State.audioCtx.currentTime + CONFIG.scheduleAheadTime) {
            const seq = State.channels[ch];
            if (seq && seq.length > 0) {
                const idx = State.channelIndices[ch];
                const step = seq[idx];
                
                if (step) {
                    const beats = step.duration / 4;
                    const durationSeconds = (60.0 / State.bpm) * beats;
                    
                    if (step.notes.length > 0) {
                        step.notes.forEach(note => {
                            playSound(note, durationSeconds, State.channelTimes[ch], ch);
                            const delay = (State.channelTimes[ch] - State.audioCtx.currentTime) * 1000;
                            if (delay > 0) {
                                setTimeout(() => sendMidiNote(note, durationSeconds, ch), delay);
                            } else {
                                sendMidiNote(note, durationSeconds, ch);
                            }
                        });
                    }
                    
                    // Siirrä aikaa eteenpäin tämän kanavan osalta
                    State.channelTimes[ch] += durationSeconds;
                    
                    // TARKISTA LOOPPIPISTE (PISIN KANAVA)
                    // Lasketaan tämän kanavan kuluneet beatit
                    const currentBeats = (State.channelTimes[ch] - State.startTime) / (60.0 / State.bpm);
                    
                    // Jos olemme ylittäneet pisimmän kanavan pituuden,
                    // nollataan kaikki kanavat takaisin alkuun
                    if (currentBeats >= maxChannelLength) {
                        // Resetoi kaikkien kanavien indeksit ja ajat
                        for (let i = 0; i < 3; i++) {
                            State.channelIndices[i] = 0;
                            State.channelTimes[i] = State.startTime;
                        }
                        
                        // Lähdetään uudelleen laskemaan pisimmästä kanavasta
                        break;
                    } else {
                        // Normaali eteneminen
                        State.channelIndices[ch]++;
                        if (State.channelIndices[ch] >= seq.length) {
                            State.channelIndices[ch] = 0;
                        }
                    }
                } else {
                    // Tyhjä askel
                    State.channelTimes[ch] += 0.1;
                    State.channelIndices[ch]++;
                }
            } else {
                State.channelTimes[ch] += 0.5; // Idle
            }
        }
    }
    
    // Päivitetään globaali nextNoteTime
    State.nextNoteTime = Math.min(...State.channelTimes);

    if (State.isPlaying) {
        setTimeout(scheduler, CONFIG.lookahead);
    }
}

function updatePlayingHighlight() {
    if (!State.isPlaying) return;
    
    // Etsi kanava ja step joka on parhaillaan soimassa
    for (let ch = 0; ch < 3; ch++) {
        const seq = State.channels[ch];
        if (!seq || seq.length === 0) continue;
        
        const secondsPerBeat = 60.0 / State.bpm;
        const timeElapsed = State.audioCtx.currentTime - State.startTime;
        
        // Lasketaan pisimmän kanavan pituus
        const channelLengths = State.channels.map(channel => {
            if (!channel || channel.length === 0) return 0;
            return channel.reduce((sum, s) => sum + (s.duration / 4), 0);
        });
        const maxChannelLength = Math.max(...channelLengths);
        
        // Loopattu aika
        const currentBeats = (timeElapsed / secondsPerBeat) % maxChannelLength;
        
        // Etsi step joka on soimassa
        let beatCounter = 0;
        for (let i = 0; i < seq.length; i++) {
            const stepBeats = seq[i].duration / 4;
            if (currentBeats >= beatCounter && currentBeats < beatCounter + stepBeats) {
                // Jos tämä on aktiivinen kanava, päivitä highlight
                if (ch === State.activeChannel && i !== State.selectedStepIndex) {
                    State.selectedStepIndex = i;
                    highlightChordInText(i);
                    return;
                }
                break;
            }
            beatCounter += stepBeats;
        }
    }
}


function animate() {
    if (!State.isPlaying) {
        drawPianoRoll(); 
        return;
    }
    
    updatePlayingHighlight(); // Päivitä highlight soivan stepin mukaan
    drawPianoRoll(); 
    State.animationId = requestAnimationFrame(animate);
}

// --- PLAYBACK CONTROLS ---

function togglePlay() {
    if (!State.buffers[0]) initAudio();
    if (State.audioCtx && State.audioCtx.state === 'suspended') State.audioCtx.resume();
    
    State.isPlaying = !State.isPlaying;
    const btn = document.getElementById('btnPlay');
    
    if (State.isPlaying) {
        btn.innerHTML = "⏸ Pause";
        btn.classList.add('selected');
        
        // Reset counters
        State.channelIndices = [0, 0, 0];
        
        const startTime = State.audioCtx.currentTime + 0.05;
        State.startTime = startTime;
        State.nextNoteTime = startTime;
        State.channelTimes = [startTime, startTime, startTime];
        
        // Sync playhead to selection if possible
        if (State.selectedStepIndex !== -1) {
            // Käytetään vain aktiivista kanavaa visualisointiin
            State.channelIndices[State.activeChannel] = State.selectedStepIndex;
            // Lasketaan aika offset
            const seq = State.channels[State.activeChannel];
            let beats = 0;
            for(let i = 0; i < State.selectedStepIndex && i < seq.length; i++) {
                beats += seq[i].duration / 4;
            }
            const secondsPerBeat = 60.0 / State.bpm;
            const timeOffset = beats * secondsPerBeat;
            State.channelTimes[State.activeChannel] = startTime + timeOffset;
        }

        scheduler();
        animate();
    } else {
        btn.innerHTML = "▶ Play";
        btn.classList.remove('selected');
        if (State.animationId) cancelAnimationFrame(State.animationId);
        drawPianoRoll(); 
    }
}

function stopPlay() {
    State.isPlaying = false;
    const btn = document.getElementById('btnPlay');
    btn.innerHTML = "▶ Play";
    btn.classList.remove('selected');
    
    State.channelIndices = [0, 0, 0];
    
    if (State.animationId) cancelAnimationFrame(State.animationId);
    drawPianoRoll();
}

function getBeatTimeForStep(index, channelIndex) {
    const seq = State.channels[channelIndex];
    if (!seq) return 0;
    let beats = 0;
    for (let i = 0; i < index && i < seq.length; i++) {
        beats += seq[i].duration / 4;
    }
    return beats;
}

// --- CHORD & THEORY LOGIC ---

function getMidiNotes(root, type, octave, inversion) {
    if (root === 'pause') return [];
    
    const rootMidi = (octave + 1) * 12 + parseInt(root);
    const formula = CHORD_FORMULAS[type] || CHORD_FORMULAS['maj'];
    
    let notes = formula.map(interval => rootMidi + interval);
    
    for (let i = 0; i < inversion; i++) {
        const noteToShift = notes.shift();
        notes.push(noteToShift + 12);
    }
    
    return notes;
}

function getChordName(root, type, inversion) {
    if (root === 'pause') return "Pause";
    
    let typeDisplay = type;
    if (type === '7') typeDisplay = '7';
    if (type === 'maj7') typeDisplay = 'Maj7';
    if (type === 'm7') typeDisplay = 'm7';
    
    let name = NOTE_NAMES[root] + typeDisplay;
    if (inversion > 0) name += ` (Inv${inversion})`;
    
    return name;
}

function checkScaleFit(notes) {
    if (!notes.length) return true;
    return notes.every(midi => {
        const pc = midi % 12;
        return State.scale.has(pc);
    });
}

function updateUIDimming() {
    document.querySelectorAll('#rootButtons button:not(.pause-btn)').forEach(btn => {
        const note = parseInt(btn.dataset.root);
        if (State.scale.has(note)) btn.classList.remove('dimmed');
        else btn.classList.add('dimmed');
    });
    
    if (State.selectedRoot !== null && State.selectedRoot !== 'pause') {
        document.querySelectorAll('#typeButtons button').forEach(btn => {
            const type = btn.dataset.type;
            const notes = getMidiNotes(State.selectedRoot, type, State.selectedOctave, 0);
            if (checkScaleFit(notes)) btn.classList.remove('dimmed');
            else btn.classList.add('dimmed');
        });
    }
}

function generateArpSequence() {
    if (State.selectedRoot === null) return;
    
    let baseNotes = getMidiNotes(State.selectedRoot, State.selectedType, State.selectedOctave, State.selectedInv);
    if (baseNotes.length === 0 && State.selectedRoot === 'pause') {
        addChordToSequence(); 
        return;
    }

    let pool = [...baseNotes];
    if (State.arpOctaveLow) {
        const lowNotes = baseNotes.map(n => n - 12);
        pool = [...lowNotes, ...pool];
    }
    if (State.arpOctaveHigh) {
        const highNotes = baseNotes.map(n => n + 12);
        pool = [...pool, ...highNotes];
    }
    
    const seqInput = document.getElementById('arpSeqInput').value; 
    const parts = seqInput.split(/[\s,-]+/).filter(s => s.trim() !== "");
    
    if (parts.length === 0) return;
    
    parts.forEach(part => {
        const num = parseInt(part);
        if (isNaN(num)) return;
        
        let notes = [];
        let name = "ARP";
        
        if (num === 0) {
            notes = [];
            name = "Pause";
        } else {
            const index = (num - 1) % pool.length;
            const note = pool[index];
            notes = [note];
            name = NOTE_NAMES[note % 12] + (Math.floor(note/12)-1); 
        }
        
        getActiveSequence().push({
            notes: notes,
            duration: parseFloat(State.selectedDur),
            name: name
        });
    });
    
    updateSequenceDisplay();
    scrollToEnd();
}

// --- BASS GENERATION (NEW) ---

function generateBassTrack() {
    // Generoi bassoraita Channel 1 (Bass) Channel 0 (Chords) perusteella.
    const chords = State.channels[0];
    const bassTrack = [];
    const targetDur = parseFloat(State.selectedDur);
    
    if (!chords || chords.length === 0) {
        alert("Luo ensin sointuja kanavalle 1 (Chords).");
        return;
    }

    chords.forEach(step => {
        const stepBeats = step.duration / 4;
        const bassBeats = targetDur / 4;
        
        const repetitions = Math.floor(stepBeats / bassBeats);
        
        let bassMidi = null;
        if (step.notes.length > 0) {
            const root = Math.min(...step.notes);
            
            let candidate = root - 12;
            if (candidate < 36) {
                candidate = root;
                while (candidate < 36) candidate += 12;
            } else {
                while (candidate >= 60) candidate -= 12;
            }
            bassMidi = candidate;
        }

        for (let i = 0; i < repetitions; i++) {
            bassTrack.push({
                notes: bassMidi !== null ? [bassMidi] : [],
                duration: targetDur,
                name: bassMidi !== null ? NOTE_NAMES[bassMidi % 12] + (Math.floor(bassMidi/12)-1) : "Pause"
            });
        }
        
        const remainder = stepBeats - (repetitions * bassBeats);
        if (remainder > 0.01) {
             bassTrack.push({
                notes: [],
                duration: remainder * 4,
                name: "Fill"
            });
        }
    });

    State.channels[1] = bassTrack;
    drawPianoRoll();
}

// --- EDITING & MANIPULATION ---

function getActiveSequence() {
    return State.channels[State.activeChannel];
}

function moveSelection(direction) {
    const seq = getActiveSequence();
    if (State.selectedStepIndex === -1 && seq.length > 0) {
        State.selectedStepIndex = 0;
    } else if (State.selectedStepIndex === -1) {
        return;
    }
    
    const newIndex = State.selectedStepIndex + direction;
    
    if (newIndex >= 0 && newIndex < seq.length) {
        State.selectedStepIndex = newIndex;
        syncPlayheadToSelection();
        drawPianoRoll();
        
        const step = seq[State.selectedStepIndex];
        if (step && step.notes.length > 0) {
             step.notes.forEach(n => playSound(n, 0.1, State.audioCtx.currentTime, State.activeChannel));
        }
        highlightChordInText(State.selectedStepIndex);
    }
}

function syncPlayheadToSelection() {
    if (State.selectedStepIndex === -1) return;
    
    if (State.isPlaying) {
        const beatTime = getBeatTimeForStep(State.selectedStepIndex, State.activeChannel);
        const seconds = beatTime * (60.0 / State.bpm);
        State.startTime = State.audioCtx.currentTime - seconds;
        State.channelIndices[State.activeChannel] = State.selectedStepIndex;
    }
}

function deleteSelection() {
    const seq = getActiveSequence();
    if (State.selectedStepIndex === -1) return;
    seq.splice(State.selectedStepIndex, 1);
    
    if (State.selectedStepIndex >= seq.length) {
        State.selectedStepIndex = seq.length - 1;
    }
    updateSequenceDisplay();
}

function replaceSelection() {
    if (State.selectedStepIndex === -1) return;
    if (State.selectedRoot === null) return;
    
    let notes = getMidiNotes(State.selectedRoot, State.selectedType, State.selectedOctave, State.selectedInv);
    let name = getChordName(State.selectedRoot, State.selectedType, State.selectedInv);
    let duration = parseFloat(State.selectedDur);
    
    const seq = getActiveSequence();
    seq[State.selectedStepIndex] = {
        notes: notes,
        duration: duration,
        name: name
    };
    updateSequenceDisplay();
    if (notes.length > 0) {
        playSound(notes[0], 0.1, State.audioCtx.currentTime, State.activeChannel);
    }
}

function shiftSelectionPitch(semitones) {
    if (State.selectedStepIndex === -1) return;
    const seq = getActiveSequence();
    const step = seq[State.selectedStepIndex];
    if (!step || step.notes.length === 0) return;
    
    // Siirrä jokainen nuotti
    step.notes = step.notes.map(n => {
        const newNote = n + semitones;
        // Pidä nuotit MIDI-alueella (0-127)
        return Math.max(0, Math.min(127, newNote));
    });
    
    // Päivitä nimi
    if (step.notes.length === 1) {
        const n = step.notes[0];
        step.name = NOTE_NAMES[n % 12] + (Math.floor(n/12)-1);
    } else if (step.notes.length > 0) {
        step.name = identifyChord(step.notes);
    }
    
    // Päivitä näkymä
    drawPianoRoll();
    
    // Soita preview
    step.notes.forEach(n => playSound(n, 0.1, State.audioCtx.currentTime, State.activeChannel));
    
    // Päivitä tekstikenttä
    updateSequenceDisplay();
}

function updateFromText() {
    const input = document.getElementById('chordStringInput');
    const text = input.value;
    const newSequence = [];
    
    if (!text.trim()) {
        State.channels[State.activeChannel] = [];
        drawPianoRoll();
        return;
    }
    
    const items = text.split(' - ');
    items.forEach(item => {
        item = item.trim();
        if (!item) return;
        if (item === "Pause") {
            newSequence.push({ notes: [], duration: 4, name: "Pause" });
            return;
        }
        
        let root = null;
        let rootNameLen = 0;
        for (let i = 0; i < NOTE_NAMES.length; i++) {
            if (item.startsWith(NOTE_NAMES[i]) && NOTE_NAMES[i].length > rootNameLen) {
                root = i;
                rootNameLen = NOTE_NAMES[i].length;
            }
        }
        if (root === null) return;
        
        let rest = item.substring(rootNameLen).trim();
        let inversion = 0;
        const invMatch = rest.match(/\(Inv(\d+)\)/);
        if (invMatch) {
            inversion = parseInt(invMatch[1]);
            rest = rest.replace(invMatch[0], '').trim();
        }
        let type = 'maj';
        if (CHORD_FORMULAS[rest] || rest === "") {
             if (rest !== "") type = rest;
             const notes = getMidiNotes(root, type, 3, inversion); 
             newSequence.push({ notes, duration: 4, name: item });
        }
    });
    
    State.channels[State.activeChannel] = newSequence;
    drawPianoRoll();
}

function highlightChordInText(index) {
    const input = document.getElementById('chordStringInput');
    const text = input.value;
    const parts = text.split(' - ');
    
    // Tarkista että index on voimassa
    if (index < 0 || index >= parts.length) return;
    
    // Laske valinnan sijainti tekstissä
    let start = 0;
    for (let i = 0; i < index; i++) start += parts[i].length + 3; // " - " on 3 merkkiä
    let end = start + parts[index].length;
    
    input.focus();
    input.setSelectionRange(start, end);
}

// --- RND & ADD ---

function generateRandomChord(prevNotes) {
    const scaleArray = Array.from(State.scale);
    if (scaleArray.length === 0) return null;
    
    let newRootPC = scaleArray[Math.floor(Math.random() * scaleArray.length)];
    const types = Object.keys(CHORD_FORMULAS);
    let validTypes = types.filter(t => checkScaleFit(getMidiNotes(newRootPC, t, 3, 0)));
    let newType = validTypes.length > 0 ? validTypes[Math.floor(Math.random() * validTypes.length)] : 'maj';

    let candidates = [];
    const isBass = State.activeChannel === 1;
    const isLead = State.activeChannel === 2;
    const startOct = isBass ? 2 : 3;
    const endOct = isBass ? 3 : 5;
    
    for (let o = startOct; o <= endOct; o++) {
        for (let inv = 0; inv < 3; inv++) {
            let n = getMidiNotes(newRootPC, newType, o, inv);
            if (isBass || isLead) n = [n[0]]; // Bassolle ja Leadille vain yksi nuotti
            candidates.push({ notes: n, oct: o, inv: inv });
        }
    }
    
    // LISÄÄ VOICE LEADING LÄHDE main-ääni.js:stä
    if (prevNotes && prevNotes.length > 0) {
        const avgPrev = prevNotes.reduce((a,b) => a + b, 0) / prevNotes.length;
        candidates.sort((a, b) => {
            const avgA = a.notes.reduce((x,y) => x + y, 0) / a.notes.length;
            const avgB = b.notes.reduce((x,y) => x + y, 0) / b.notes.length;
            return Math.abs(avgA - avgPrev) - Math.abs(avgB - avgPrev);
        });
    }
    
    const best = candidates[0]; // Käytä nyt ensimmäistä (parasta) eikä satunnaista
    State.selectedOctave = best.oct; 
    
    return {
        notes: best.notes,
        duration: parseFloat(State.selectedDur),
        name: getChordName(newRootPC, newType, best.inv)
    };
}

function addChordToSequence() {
    if (State.selectedRoot === null) return;

    let notes = getMidiNotes(State.selectedRoot, State.selectedType, State.selectedOctave, State.selectedInv);
    
    if (State.activeChannel === 1 || State.activeChannel === 2) {
        notes = [notes[0]];
    }
    
    let name = getChordName(State.selectedRoot, State.selectedType, State.selectedInv);
    let duration = parseFloat(State.selectedDur);

    getActiveSequence().push({ notes, duration, name });
    updateSequenceDisplay();
    scrollToEnd();
}

function updateSequenceDisplay() {
    const input = document.getElementById('chordStringInput');
    const seq = getActiveSequence();
    input.value = seq.map(s => s.name).join(' - ');
    drawPianoRoll();
}

function scrollToEnd() {
    setTimeout(() => {
        const wrapper = document.getElementById('pianoRollWrapper');
        wrapper.scrollLeft = wrapper.scrollWidth;
    }, 50);
}

// --- TRANSPOSITION ---

function shiftScale(semitones) {
    const newScale = new Set();
    State.scale.forEach(note => {
        let newNote = (note + semitones) % 12;
        if (newNote < 0) newNote += 12;
        newScale.add(newNote);
    });
    State.scale = newScale;
    
    document.querySelectorAll('.key').forEach(key => {
        const note = parseInt(key.dataset.note);
        if (State.scale.has(note)) key.classList.add('active');
        else key.classList.remove('active');
    });
    
    updateUIDimming();
    drawPianoRoll();
}

// --- PIANO ROLL DRAWING (MULTI-TRACK GHOSTING) ---

function drawPianoRoll() {
    const canvas = document.getElementById('pianoRollCanvas');
    const ctx = canvas.getContext('2d');
    const wrapper = document.getElementById('pianoRollWrapper');
    
    const seq = getActiveSequence();
    const totalBeats = seq.reduce((sum, s) => sum + (s.duration / 4), 0);
    const minWidth = wrapper.clientWidth;
    const contentWidth = Math.max(minWidth, totalBeats * CONFIG.pxPerBeat + 100);
    const totalKeys = 128; 
    const contentHeight = totalKeys * CONFIG.noteHeight;
    
    if (canvas.width !== contentWidth || canvas.height !== contentHeight) {
        canvas.width = contentWidth;
        canvas.height = contentHeight;
    }
    
    // 1. Background
    ctx.fillStyle = CONFIG.colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 2. Grid & Names (tämä piirtää myös nuottien nimet)
    drawGrid(ctx, canvas.width, totalKeys);
    
    // 3. PIIRRÄ NUOTIT (ensimmäinen kerros)
    const channelsToDraw = [0, 1, 2].filter(c => c !== State.activeChannel);
    channelsToDraw.push(State.activeChannel);
    
    channelsToDraw.forEach(ch => {
        const isGhost = (ch !== State.activeChannel);
        drawChannel(ctx, ch, isGhost, canvas.height);
    });
    
    // 4. Playhead
    drawPlayhead(ctx, canvas.height, totalBeats, wrapper);
    
    // 5. PIIRRÄ NUOTTINIMMET UUDELLEEN PÄÄLLIMMÄISENÄ
    drawNoteNamesOnTop(ctx, canvas.height);
}

function drawNoteNamesOnTop(ctx, canvasHeight) {
    const totalKeys = 128;
    
    for (let i = 0; i < totalKeys; i++) {
        const midiNote = 127 - i; 
        const y = i * CONFIG.noteHeight;
        const pc = midiNote % 12;
        
        // Piirrä nuottinimi päällimmäisenä
        if (State.scale.has(pc) || pc === 0) {
            ctx.fillStyle = '#ffffff'; // Valkoinen teksti näkyy parhaiten
            ctx.font = "bold 10px sans-serif";
            
            let noteText;
            if (State.scale.has(pc)) {
                noteText = NOTE_NAMES[pc];
            } else if (pc === 0) {
                // Näytä C-nuotit aina
                noteText = "C" + (Math.floor(midiNote / 12) - 1);
            }
            
            // Piirrä musta taustalaatikko tekstin taakse
            const textMetrics = ctx.measureText(noteText);
            const textWidth = textMetrics.width + 4;
            const textHeight = 12;
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(2, y + CONFIG.noteHeight - textHeight - 1, textWidth, textHeight);
            
            // Piirrä teksti
            ctx.fillStyle = '#ffffff';
            ctx.fillText(noteText, 4, y + CONFIG.noteHeight - 3);
        }
    }
}

function drawGrid(ctx, width, totalKeys) {
    for (let i = 0; i < totalKeys; i++) {
        const midiNote = 127 - i; 
        const y = i * CONFIG.noteHeight;
        const pc = midiNote % 12;
        const isBlack = [1, 3, 6, 8, 10].includes(pc);
        
        if (State.scale.has(pc)) {
            ctx.fillStyle = isBlack ? '#1e1024' : '#25152b'; 
            if (CONFIG.colors.gridScale !== '#2e1c36') ctx.fillStyle = hexToRgba(CONFIG.colors.ch0, 0.1);
        } else {
            ctx.fillStyle = isBlack ? CONFIG.colors.gridBlack : CONFIG.colors.gridWhite;
        }
        ctx.fillRect(0, y, width, CONFIG.noteHeight);
        
        ctx.strokeStyle = CONFIG.colors.gridLines;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        
        // Note names
        if (State.scale.has(pc)) {
            ctx.fillStyle = CONFIG.colors.text;
            ctx.font = "10px sans-serif";
            ctx.fillText(NOTE_NAMES[pc], 2, y + CONFIG.noteHeight - 3);
        }
        if (pc === 0) { 
            ctx.strokeStyle = '#444';
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
            if(!State.scale.has(0)) {
                 ctx.fillStyle = CONFIG.colors.text;
                 ctx.fillText("C" + (Math.floor(midiNote / 12) - 1), 2, y + CONFIG.noteHeight - 3);
            }
        }
    }
}

function drawChannel(ctx, channelIndex, isGhost, canvasHeight) {
    const sequence = State.channels[channelIndex];
    if (!sequence) return;
    
    let baseColor = CONFIG.colors.ch0;
    if (channelIndex === 1) baseColor = CONFIG.colors.ch1;
    if (channelIndex === 2) baseColor = CONFIG.colors.ch2;
    
    let currentX = 0;
    
    // LASKETAAN PISIN KANAVA LOOPPAAKSEEN
    const channelLengths = State.channels.map(ch => {
        if (!ch || ch.length === 0) return 0;
        return ch.reduce((sum, s) => sum + (s.duration / 4), 0);
    });
    const maxChannelLength = Math.max(...channelLengths);
    
    let currentSequenceTime = 0;
    if (State.isPlaying) {
        const secondsPerBeat = 60.0 / State.bpm;
        currentSequenceTime = (State.audioCtx.currentTime - State.startTime) / secondsPerBeat;
        // TARKISTA LOOPPAUS
        currentSequenceTime = currentSequenceTime % maxChannelLength;
    }

    sequence.forEach((step, index) => {
        const stepBeats = step.duration / 4;
        const stepWidth = stepBeats * CONFIG.pxPerBeat;
        
        // TÄRKEÄ MUUTOS: Tarkista onko tämä step parhaillaan soimassa
        const stepStartBeat = currentX / CONFIG.pxPerBeat;
        const stepEndBeat = stepStartBeat + stepBeats;
        
        // KORJATTU EHTO: Käytä currentSequenceTimea joka on jo loopattu
        const isPlayingNow = State.isPlaying && 
                            (currentSequenceTime >= stepStartBeat && 
                             currentSequenceTime < stepEndBeat);
        
        // PÄIVITÄ MYÖS VALITTU STEPIN KOROSTUS
        if (!isGhost && index === State.selectedStepIndex) {
            ctx.fillStyle = CONFIG.colors.selection;
            ctx.fillRect(currentX, 0, stepWidth, canvasHeight);
        }
        
        // Piirrä jokainen nuotti
        step.notes.forEach((note, noteIndex) => {
            const y = (127 - note) * CONFIG.noteHeight;
            
            if (isGhost) {
                ctx.fillStyle = hexToRgba(baseColor, 0.2);
                ctx.fillRect(currentX, y + 1, stepWidth - 1, CONFIG.noteHeight - 2);
            } else {
                // KORJATTU: Soiva step saa eri värin
                const noteColor = isPlayingNow ? 
                    adjustColorBrightness(baseColor, 40) : 
                    adjustColorBrightness(baseColor, (noteIndex * -5));
                
                ctx.fillStyle = noteColor;
                ctx.fillRect(currentX, y + 1, stepWidth - 1, CONFIG.noteHeight - 2);
                
                ctx.strokeStyle = adjustColorBrightness(baseColor, -30);
                ctx.lineWidth = 1;
                ctx.strokeRect(currentX, y + 1, stepWidth - 1, CONFIG.noteHeight - 2);
            }
        });
        
        // Lisää extra-korostus soivalle stepille (valinnainen)
        if (isPlayingNow && !isGhost) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.strokeRect(currentX + 1, 1, stepWidth - 2, canvasHeight - 2);
        }
        
        if (!isGhost) {
            // Pystyviiva stepin lopussa
            ctx.strokeStyle = '#333';
            ctx.beginPath(); 
            ctx.moveTo(currentX + stepWidth, 0); 
            ctx.lineTo(currentX + stepWidth, canvasHeight); 
            ctx.stroke();
        }
        
        currentX += stepWidth;
    });
}

function drawPlayhead(ctx, height, totalBeats, wrapper) {
    let playheadX = -1;
    
    if (State.isPlaying) {
        const secondsPerBeat = 60.0 / State.bpm;
        const timeElapsed = State.audioCtx.currentTime - State.startTime;
        
        // LASKETAAN PISIN KANAVA LOOPPAAKSEEN
        const channelLengths = State.channels.map(ch => {
            if (!ch || ch.length === 0) return 0;
            return ch.reduce((sum, s) => sum + (s.duration / 4), 0);
        });
        const maxChannelLength = Math.max(...channelLengths);
        
        // Laske playhead-position modulo pisimmän kanavan pituudella
        const currentBeats = timeElapsed / secondsPerBeat;
        const loopedBeats = currentBeats % maxChannelLength;
        playheadX = loopedBeats * CONFIG.pxPerBeat;
        
    } else if (State.selectedStepIndex !== -1) {
        const seq = getActiveSequence();
        let beats = 0;
        for(let i = 0; i < State.selectedStepIndex && i < seq.length; i++) {
            beats += seq[i].duration / 4;
        }
        playheadX = beats * CONFIG.pxPerBeat;
    }

    if (playheadX >= 0) {
        // Piirrä playhead
        ctx.strokeStyle = CONFIG.colors.playhead;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, height);
        ctx.stroke();
        
        // Piirrä myös looppipiste (punainen viiva pisimmän kanavan lopussa)
        const channelLengths = State.channels.map(ch => {
            if (!ch || ch.length === 0) return 0;
            return ch.reduce((sum, s) => sum + (s.duration / 4), 0);
        });
        const maxChannelLength = Math.max(...channelLengths);
        const loopEndX = maxChannelLength * CONFIG.pxPerBeat;
        
        if (loopEndX > 0 && loopEndX < ctx.canvas.width) {
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]); // Katkoviiva
            ctx.beginPath();
            ctx.moveTo(loopEndX, 0);
            ctx.lineTo(loopEndX, height);
            ctx.stroke();
            ctx.setLineDash([]); // Nollaa katkoviiva
        }
        
        // Autoscroll playheadin mukana
        if (State.isPlaying && wrapper) {
            const wRect = wrapper.getBoundingClientRect();
            if (playheadX > wrapper.scrollLeft + wRect.width - 50) {
                wrapper.scrollLeft = playheadX - 50;
            } else if (playheadX < wrapper.scrollLeft) {
                wrapper.scrollLeft = playheadX - 50;
            }
        }
    }
}

// --- EVENTS ---

function initCanvasEvents() {
    const canvas = document.getElementById('pianoRollCanvas');
    const wrapper = document.getElementById('pianoRollWrapper');
    
    setTimeout(() => {
        wrapper.scrollTop = (127 - 60) * CONFIG.noteHeight - (wrapper.clientHeight / 2);
    }, 100);

    let dragStartParams = null;
    let isDraggingNote = false;

    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        
        // OIKEA KOORDINAATTIEN LASKENTA:
        // 1. Laske klikkaus canvasin sisällä (ilman scrollia)
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;
        
        // 2. Huomioi wrapperin scrollaus
        const x = canvasX + wrapper.scrollLeft;
        const y = canvasY + wrapper.scrollTop;
        
        console.log("Click at:", { canvasX, canvasY, x, y, scrollLeft: wrapper.scrollLeft, scrollTop: wrapper.scrollTop });
        
        const seq = getActiveSequence();
        let scanX = 0;
        let found = null;
        let clickedStepIndex = -1;
        
        // LASKETAAN STEPIN LEVEYS
        for (let i = 0; i < seq.length; i++) {
            const step = seq[i];
            const stepBeats = step.duration / 4;
            const stepWidth = stepBeats * CONFIG.pxPerBeat;
            
            // Tarkista X-akseli
            if (x >= scanX && x < scanX + stepWidth) {
                clickedStepIndex = i;
                
                // Tarkista Y-akseli (MIDI-nuotti)
                if (step.notes.length > 0) {
                    // Laske MIDI-nuotti Y-koordinaatista
                    // canvasY käytetään, koska draw funktio käyttää samaa logiikkaa
                    const clickedMidi = 127 - Math.floor(canvasY / CONFIG.noteHeight);
                    
                    console.log("Checking note:", clickedMidi, "in step notes:", step.notes);
                    
                    // Tarkista onko tämä nuotti stepissä
                    if (step.notes.includes(clickedMidi)) {
                        found = { 
                            stepIndex: i, 
                            note: clickedMidi, 
                            startY: canvasY, // TÄRKEÄ: käytä canvasY, ei y
                            noteIndex: step.notes.indexOf(clickedMidi),
                            stepStartX: scanX
                        };
                        break;
                    }
                }
            }
            scanX += stepWidth;
        }
        
        if (found) {
            // Raahataan yksittäistä nuottia
            isDraggingNote = true;
            dragStartParams = found;
            canvas.style.cursor = 'grabbing';
            
            console.log("Dragging note:", found.note, "in step", found.stepIndex);
            
            // Soita nuotti previewna
            playSound(found.note, 0.2, State.audioCtx.currentTime, State.activeChannel);
            e.preventDefault();
        } else if (clickedStepIndex !== -1) {
            // Valitaan koko sointu
            isDraggingNote = false;
            State.selectedStepIndex = clickedStepIndex;
            drawPianoRoll();
            
            // Korosta tekstikentässä
            highlightChordInText(clickedStepIndex);
            
            // Soita preview
            const step = seq[clickedStepIndex];
            if (step.notes.length > 0) {
                playSound(step.notes[0], 0.1, State.audioCtx.currentTime, State.activeChannel);
            }
        } else {
            // Klikattu tyhjää - poista valinta
            isDraggingNote = false;
            State.selectedStepIndex = -1;
            drawPianoRoll();
        }
    });
    
    // Nuotin raahauslogiikka
    window.addEventListener('mousemove', (e) => {
        if (!dragStartParams || !isDraggingNote) return;
        
        const canvasRect = canvas.getBoundingClientRect();
        const canvasY = e.clientY - canvasRect.top;
        
        const diffPx = dragStartParams.startY - canvasY;
        const diffSemi = Math.round(diffPx / CONFIG.noteHeight);
        
        console.log("Dragging diff:", diffPx, "semitones:", diffSemi);
        
        if (diffSemi !== 0) {
            const seq = getActiveSequence();
            const step = seq[dragStartParams.stepIndex];
            const oldNote = dragStartParams.note;
            const newNote = oldNote + diffSemi;
            
            // Rajatarkistus (0-127)
            if (newNote < 0 || newNote > 127) return;
            
            const noteIdx = dragStartParams.noteIndex;
            if (noteIdx !== -1) {
                // Päivitä nuotti
                step.notes[noteIdx] = newNote;
                step.notes.sort((a,b) => a-b);
                
                // Päivitä nimi
                if (step.notes.length === 1) {
                    step.name = NOTE_NAMES[newNote % 12] + (Math.floor(newNote/12)-1);
                } else {
                    // Yritä tunnistaa sointu
                    step.name = identifyChord(step.notes);
                }
                
                // Päivitä raahauksen tilaa
                dragStartParams.note = newNote;
                dragStartParams.startY = canvasY;
                
                // Päivitä näkymä
                updateSequenceDisplay();
                
                // Soita uusi nuotti
                playSound(newNote, 0.1, State.audioCtx.currentTime, State.activeChannel);
            }
        }
    });
    
    window.addEventListener('mouseup', () => {
        if (dragStartParams && isDraggingNote) {
            console.log("Finished dragging note");
        }
        
        isDraggingNote = false;
        dragStartParams = null;
        canvas.style.cursor = 'default';
    });
}

function identifyChord(notes) {
    if (!notes || notes.length === 0) return "Pause";
    if (notes.length === 1) {
        const note = notes[0];
        return NOTE_NAMES[note % 12] + (Math.floor(note/12)-1);
    }

    // Järjestä nuotit
    const sorted = [...notes].sort((a,b) => a-b);
    const rootMidi = sorted[0];
    const rootName = NOTE_NAMES[rootMidi % 12];
    
    // Laske intervallit rootista modulo 12
    const intervals = sorted.map(n => (n - rootMidi) % 12).sort((a,b)=>a-b);
    const uniqueIntervals = [...new Set(intervals)];
    
    // Tunnista sointutyyppi intervallien perusteella
    let typeName = "";
    
    // Tarkista ensin triadeja
    if (uniqueIntervals.includes(4) && uniqueIntervals.includes(7)) {
        typeName = "maj";
    } else if (uniqueIntervals.includes(3) && uniqueIntervals.includes(7)) {
        typeName = "min";
    } else if (uniqueIntervals.includes(2) && uniqueIntervals.includes(7)) {
        typeName = "sus2";
    } else if (uniqueIntervals.includes(5) && uniqueIntervals.includes(7)) {
        typeName = "sus4";
    } else if (uniqueIntervals.includes(3) && uniqueIntervals.includes(6)) {
        typeName = "dim";
    } else if (uniqueIntervals.includes(4) && uniqueIntervals.includes(8)) {
        typeName = "aug";
    }
    
    // Tarkista 7-soinnut
    if (uniqueIntervals.includes(4) && uniqueIntervals.includes(7) && uniqueIntervals.includes(10)) {
        if (typeName === "maj") typeName = "7";
        else if (typeName === "min") typeName = "m7";
    } else if (uniqueIntervals.includes(4) && uniqueIntervals.includes(7) && uniqueIntervals.includes(11)) {
        if (typeName === "maj") typeName = "maj7";
    } else if (uniqueIntervals.includes(3) && uniqueIntervals.includes(7) && uniqueIntervals.includes(11)) {
        if (typeName === "min") typeName = "mmaj7";
    } else if (uniqueIntervals.includes(3) && uniqueIntervals.includes(6) && uniqueIntervals.includes(9)) {
        typeName = "dim7";
    } else if (uniqueIntervals.includes(3) && uniqueIntervals.includes(6) && uniqueIntervals.includes(10)) {
        typeName = "m7b5";
    }
    
    // Tarkista laajennukset
    if (uniqueIntervals.includes(4) && uniqueIntervals.includes(7) && uniqueIntervals.includes(14)) {
        typeName = "add9";
    }
    
    if (typeName === "") {
        typeName = "Custom";
    }
    
    return `${rootName}${typeName}`;
}

function transposeAllNotes(semitones) {
    for (let ch = 0; ch < State.channels.length; ch++) {
        const seq = State.channels[ch];
        seq.forEach(step => {
            if (step.notes && step.notes.length > 0) {
                // Siirrä jokainen nuotti
                step.notes = step.notes.map(n => {
                    const newNote = n + semitones;
                    // Pidä nuotit MIDI-alueella (0-127)
                    return Math.max(0, Math.min(127, newNote));
                });
                
                // Päivitä nuotin nimi
                if (step.notes.length === 1) {
                    const n = step.notes[0];
                    step.name = NOTE_NAMES[n % 12] + (Math.floor(n/12)-1);
                } else if (step.notes.length > 0) {
                    // Päivitä sointunimi
                    step.name = identifyChord(step.notes);
                }
            }
        });
    }
    
    // Päivitä tekstiesitys
    updateSequenceDisplay();
}

function initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;

        const rootMap = {
            'Digit1': 0, 'Digit2': 1, 'Digit3': 2, 'Digit4': 3, 'Digit5': 4, 'Digit6': 5, 
            'Digit7': 6, 'Digit8': 7, 'Digit9': 8, 'Digit0': 9, 'KeyI': 10, 'KeyO': 11, 'KeyP': 'pause'
        };

        if (e.code in rootMap) {
            const val = rootMap[e.code];
            const btnSelector = val === 'pause' 
                ? `#rootButtons button[data-root="pause"]`
                : `#rootButtons button[data-root="${val}"]`;
            const btn = document.querySelector(btnSelector);
            if(btn) btn.click();
            return;
        }

        switch(e.code) {
            case 'Space': e.preventDefault(); togglePlay(); break;
            case 'KeyS': stopPlay(); break;
            case 'KeyA': addChordToSequence(); 
                const btnA = document.getElementById('btnAddChord'); 
                btnA.style.borderColor = '#fff'; 
                setTimeout(() => btnA.style.borderColor = '', 100); 
                break;
            case 'KeyR': document.getElementById('btnRnd').click(); break;
            case 'KeyD': deleteSelection(); break;
            case 'ArrowLeft': e.preventDefault(); moveSelection(-1); break;
            case 'ArrowRight': e.preventDefault(); moveSelection(1); break;
            case 'KeyQ': e.preventDefault(); moveSelection(-1); break;
            case 'KeyE': e.preventDefault(); moveSelection(1); break;
            case 'KeyZ': 
                e.preventDefault(); 
                if (State.selectedStepIndex !== -1) {
                    shiftSelectionPitch(-1);
                }
                break;
            case 'KeyX': 
                e.preventDefault(); 
                if (State.selectedStepIndex !== -1) {
                    shiftSelectionPitch(1);
                }
                break;
            case 'Digit1': if (e.ctrlKey) changeChannel(0); break;
            case 'Digit2': if (e.ctrlKey) changeChannel(1); break;
            case 'Digit3': if (e.ctrlKey) changeChannel(2); break;
            // pikanäppäimet kaikkien nuottien transponointiin:
            case 'BracketLeft': // [ - Siirrä kaikkia nuotteja alas
                if (e.ctrlKey) {
                    State.transpose--;
                    transposeAllNotes(-1);
                    drawPianoRoll();
                }
                break;
            case 'BracketRight': // ] - Siirrä kaikkia nuotteja ylös
                if (e.ctrlKey) {
                    State.transpose++;
                    transposeAllNotes(1);
                    drawPianoRoll();
                }
                break;
        }
    });
}

function changeChannel(channelIndex) {
    State.activeChannel = channelIndex;
    State.selectedStepIndex = -1; // Resetoi valinta kanavan vaihdon yhteydessä
    
    // Päivitä UI
    updateChannelUI();
    
    // Päivitä näkymä
    updateSequenceDisplay();
    drawPianoRoll();
    
    console.log(`Kanava vaihdettu: ${channelIndex} (${['Chords', 'Bass', 'Lead'][channelIndex]})`);
}

function updateChannelUI() {
    // Päivitä painikkeiden aktiivinen tila
    document.querySelectorAll('.channel-btn').forEach(btn => {
        const channel = parseInt(btn.dataset.channel);
        btn.classList.toggle('active', channel === State.activeChannel);
    });
    
    // Näytä/piilota Generoi Basso -nappi
    const btnGenBass = document.getElementById('btnGenBass');
    if (btnGenBass) {
        btnGenBass.style.display = (State.activeChannel === 1) ? 'inline-block' : 'none';
    }
    
    // Päivitä kanavan nimi näkyviin
    const channelNames = ['Chords', 'Bass', 'Lead'];
    const channelDisplay = document.getElementById('channelDisplay');
    if (channelDisplay) {
        channelDisplay.textContent = `Active: ${channelNames[State.activeChannel]}`;
    }
}

// --- HELPERS ---

function updateThemeColor(color) {
    document.documentElement.style.setProperty('--primary-color', color);
    CONFIG.colors.ch0 = color;
    drawPianoRoll();
}

function adjustColorBrightness(hex, percent) {
    let r = parseInt(hex.substring(1, 3), 16);
    let g = parseInt(hex.substring(3, 5), 16);
    let b = parseInt(hex.substring(5, 7), 16);
    r = parseInt(r * (100 + percent) / 100);
    g = parseInt(g * (100 + percent) / 100);
    b = parseInt(b * (100 + percent) / 100);
    r = (r<255)?r:255; g = (g<255)?g:255; b = (b<255)?b:255;
    const RR = ((r.toString(16).length==1)?"0"+r.toString(16):r.toString(16));
    const GG = ((g.toString(16).length==1)?"0"+g.toString(16):g.toString(16));
    const BB = ((b.toString(16).length==1)?"0"+b.toString(16):b.toString(16));
    return "#"+RR+GG+BB;
}

function hexToRgba(hex, alpha) {
    let r = parseInt(hex.substring(1, 3), 16);
    let g = parseInt(hex.substring(3, 5), 16);
    let b = parseInt(hex.substring(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- INIT ---

function init() {
    initAudio();
    initMidi();
    initKeyboardShortcuts();
    initCanvasEvents();
    
    // Color Picker
    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.value = '#9c27b0';
    colorPicker.style.marginLeft = '10px';
    colorPicker.addEventListener('input', (e) => updateThemeColor(e.target.value));
    document.querySelector('.transpose-controls').appendChild(colorPicker);

    // Project Buttons
    const midiControls = document.querySelector('.midi-controls');
    const btnSave = document.createElement('button');
    btnSave.innerText = "Save Project";
    btnSave.className = "small-btn";
    btnSave.addEventListener('click', () => {
        if(typeof ProjectManager !== 'undefined') {
            const saveState = {
                channels: State.channels,
                bpm: State.bpm,
                scale: Array.from(State.scale), // Muunna taulukoksi tallennusta varten
                transpose: State.transpose,
                activeChannel: State.activeChannel
            };
            ProjectManager.saveProject(saveState);
        }
    });
    
    const btnLoad = document.createElement('button');
    btnLoad.innerText = "Load Project";
    btnLoad.className = "small-btn";
    btnLoad.addEventListener('click', () => {
        if(typeof ProjectManager !== 'undefined') {
            ProjectManager.loadProject((newState) => {
                if (newState.channels) {
                    State.channels = newState.channels;
                }
                if (newState.bpm) State.bpm = newState.bpm;
                if (newState.scale) State.scale = new Set(newState.scale);
                if (newState.transpose) State.transpose = newState.transpose;
                if (newState.activeChannel !== undefined) {
                    State.activeChannel = newState.activeChannel;
                    // Päivitä UI suoraan
                    updateChannelUI();
                }
                
                document.getElementById('tempoInput').value = State.bpm;
                updateUIDimming();
                document.querySelectorAll('.key').forEach(key => {
                    const note = parseInt(key.dataset.note);
                    if (State.scale.has(note)) key.classList.add('active');
                    else key.classList.remove('active');
                });
                
                // Päivitä näkymä
                updateSequenceDisplay();
                drawPianoRoll();
                
                console.log("Projekti ladattu, aktiivinen kanava:", State.activeChannel);
            });
        }
    });
    
    midiControls.insertBefore(btnLoad, midiControls.firstChild);
    midiControls.insertBefore(btnSave, midiControls.firstChild);

    // Luo kanavanvaihtopainikkeet ja näyttö jos niitä ei ole HTML:ssä
    setupChannelControls();

    // Piano Scale
    document.querySelectorAll('.key').forEach(key => {
        key.addEventListener('click', () => {
            const note = parseInt(key.dataset.note);
            if (State.scale.has(note)) {
                State.scale.delete(note);
                key.classList.remove('active');
            } else {
                State.scale.add(note);
                key.classList.add('active');
            }
            updateUIDimming();
            drawPianoRoll(); 
        });
        if (State.scale.has(parseInt(key.dataset.note))) {
            key.classList.add('active');
        }
    });
    
    // Octave
    document.querySelectorAll('#octaveButtons button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#octaveButtons button').forEach(b => b.classList.remove('selected'));
            e.target.classList.add('selected');
            State.selectedOctave = parseInt(e.target.dataset.oct);
            updateUIDimming();
        });
    });
    
    // Root
    document.querySelectorAll('#rootButtons button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            initAudio(); 
            document.querySelectorAll('#rootButtons button').forEach(b => b.classList.remove('selected'));
            e.target.classList.add('selected');
            
            const val = e.target.dataset.root;
            State.selectedRoot = val === 'pause' ? 'pause' : parseInt(val);
            
            updateUIDimming();
            if (State.selectedRoot !== 'pause') {
                const previewNotes = getMidiNotes(State.selectedRoot, State.selectedType, State.selectedOctave, State.selectedInv);
                previewNotes.forEach(n => playSound(n, 0.4, State.audioCtx.currentTime, State.activeChannel));
            }
        });
    });
    
    // Type
    document.querySelectorAll('#typeButtons button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#typeButtons button').forEach(b => b.classList.remove('selected'));
            e.target.classList.add('selected');
            State.selectedType = e.target.dataset.type;
        });
    });
    
    // Inversion
    document.querySelectorAll('#invButtons button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#invButtons button').forEach(b => b.classList.remove('selected'));
            e.target.classList.add('selected');
            State.selectedInv = parseInt(e.target.dataset.inv);
        });
    });
    
    // Duration
    document.querySelectorAll('#durButtons button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#durButtons button').forEach(b => b.classList.remove('selected'));
            e.target.classList.add('selected');
            State.selectedDur = parseFloat(e.target.dataset.dur);
        });
    });
    
    // ARP Controls
    document.getElementById('btnArpOctLow').addEventListener('click', (e) => {
        State.arpOctaveLow = !State.arpOctaveLow;
        e.target.classList.toggle('selected', State.arpOctaveLow);
    });
    document.getElementById('btnArpOctHigh').addEventListener('click', (e) => {
        State.arpOctaveHigh = !State.arpOctaveHigh;
        e.target.classList.toggle('selected', State.arpOctaveHigh);
    });
    document.getElementById('btnArp').addEventListener('click', generateArpSequence);
    
    // Edit Controls
    document.getElementById('btnMoveLeft').addEventListener('click', () => moveSelection(-1));
    document.getElementById('btnMoveRight').addEventListener('click', () => moveSelection(1));
    document.getElementById('btnReplace').addEventListener('click', replaceSelection);
    document.getElementById('btnDelete').addEventListener('click', deleteSelection);
    document.getElementById('btnUpdateText').addEventListener('click', updateFromText);

    // Main Actions
    document.getElementById('btnAddChord').addEventListener('click', addChordToSequence);
    
    document.getElementById('btnRnd').addEventListener('click', () => {
        const activeSeq = getActiveSequence();
        let prevNotes = null;
        if (activeSeq.length > 0) {
            prevNotes = activeSeq[activeSeq.length - 1].notes;
        }
        
        const newChord = generateRandomChord(prevNotes);
        if (newChord) {
            activeSeq.push(newChord);
            updateSequenceDisplay();
            newChord.notes.forEach(n => playSound(n, 0.5, State.audioCtx.currentTime, State.activeChannel));
            scrollToEnd();
        }
    });
    
    document.getElementById('btnClear').addEventListener('click', () => {
        const activeSeq = getActiveSequence();
        activeSeq.length = 0;
        State.selectedStepIndex = -1;
        updateSequenceDisplay();
    });
    
    document.getElementById('btnPlay').addEventListener('click', togglePlay);
    document.getElementById('btnStop').addEventListener('click', stopPlay);
    
    document.getElementById('tempoInput').addEventListener('input', (e) => {
        State.bpm = parseInt(e.target.value);
    });
    
    let lastTap = 0;
    document.getElementById('btnTap').addEventListener('click', () => {
        const now = Date.now();
        const diff = now - lastTap;
        lastTap = now;
        if (diff > 200 && diff < 3000) {
            const tapBpm = Math.round(60000 / diff);
            State.bpm = tapBpm;
            document.getElementById('tempoInput').value = tapBpm;
        }
    });
    
    // Transponointi napit
    document.getElementById('btnTransUp').addEventListener('click', () => {
        State.transpose++;
        shiftScale(1);
        // Siirrä kaikkien kanavien nuotteja ylös
        transposeAllNotes(1);
        // Päivitä näkymä
        drawPianoRoll();
    });
    document.getElementById('btnTransDown').addEventListener('click', () => {
        State.transpose--;
        shiftScale(-1);
        // Siirrä kaikkien kanavien nuotteja alas
        transposeAllNotes(-1);
        // Päivitä näkymä
        drawPianoRoll();
    });
    
    document.getElementById('btnExport').addEventListener('click', () => {
        if (typeof MidiExporter !== 'undefined') {
            // VIE KAIKKI 3 RAITAA YHDESSÄ
            MidiExporter.downloadMidi(State.channels, State.bpm);
        } else {
            alert('Midi Export module not loaded.');
        }
    });
    
    const btnPitchDown = document.getElementById('btnPitchDown');
    const btnPitchUp = document.getElementById('btnPitchUp');

    if (btnPitchDown && btnPitchUp) {
        btnPitchDown.addEventListener('click', (e) => {
            e.preventDefault();
            console.log("Pitch Down clicked");
            shiftSelectionPitch(-1);
        });
        
        btnPitchUp.addEventListener('click', (e) => {
            e.preventDefault();
            console.log("Pitch Up clicked");
            shiftSelectionPitch(1);
        });
        
        console.log("Pitch buttons initialized");
    } else {
        console.error("Pitch buttons not found in DOM");
    }
    
    // Aseta oikea kanava näkyviin
    updateChannelUI();
    updateUIDimming();
    drawPianoRoll();
    
    console.log("Sovellus alustettu, aktiivinen kanava:", State.activeChannel);
}

function setupChannelControls() {
    // Tarkista onko kanavanvaihtopainikkeet jo HTML:ssä
    if (!document.querySelector('.channel-controls')) {
        const channelContainer = document.createElement('div');
        channelContainer.className = 'channel-controls';
        channelContainer.style.margin = '10px 0';
        channelContainer.style.padding = '10px';
        channelContainer.style.backgroundColor = '#1a1a1a';
        channelContainer.style.borderRadius = '5px';
        
        // Lisää kanavan näyttö
        const channelDisplay = document.createElement('div');
        channelDisplay.id = 'channelDisplay';
        channelDisplay.style.marginBottom = '8px';
        channelDisplay.style.fontWeight = 'bold';
        channelDisplay.style.color = '#fff';
        channelDisplay.textContent = 'Active: Chords';
        channelContainer.appendChild(channelDisplay);
        
        // Lisää painikkeet
        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.display = 'flex';
        buttonsContainer.style.gap = '8px';
        
        const channels = [
            { id: 0, name: 'Chords', color: CONFIG.colors.ch0 },
            { id: 1, name: 'Bass', color: CONFIG.colors.ch1 },
            { id: 2, name: 'Lead', color: CONFIG.colors.ch2 }
        ];
        
        channels.forEach(channel => {
            const btn = document.createElement('button');
            btn.className = 'channel-btn';
            if (channel.id === 0) btn.classList.add('active');
            btn.dataset.channel = channel.id;
            btn.textContent = channel.name;
            btn.style.backgroundColor = channel.color;
            btn.style.color = '#fff';
            btn.style.border = 'none';
            btn.style.padding = '6px 12px';
            btn.style.borderRadius = '4px';
            btn.style.cursor = 'pointer';
            btn.style.fontWeight = 'bold';
            
            btn.addEventListener('mouseover', () => {
                btn.style.opacity = '0.8';
            });
            btn.addEventListener('mouseout', () => {
                btn.style.opacity = '1';
            });
            
            buttonsContainer.appendChild(btn);
        });
        
        channelContainer.appendChild(buttonsContainer);
        
        // Lisää Generoi Basso -nappi
        const btnGenBass = document.createElement('button');
        btnGenBass.id = 'btnGenBass';
        btnGenBass.className = 'small-btn';
        btnGenBass.textContent = 'Generate Bass from Chords';
        btnGenBass.style.marginTop = '10px';
        btnGenBass.style.backgroundColor = CONFIG.colors.ch1;
        btnGenBass.style.color = '#fff';
        btnGenBass.style.border = 'none';
        btnGenBass.style.padding = '6px 12px';
        btnGenBass.style.borderRadius = '4px';
        btnGenBass.style.cursor = 'pointer';
        btnGenBass.style.display = 'none';
        
        channelContainer.appendChild(btnGenBass);
        
        // Lisää kontrollit sivulle
        const controlsSection = document.querySelector('.controls');
        if (controlsSection) {
            controlsSection.insertBefore(channelContainer, document.querySelector('.chord-controls'));
        }
    }
    
    // Lisää event listenerit kanavanvaihtopainikkeille
    document.querySelectorAll('.channel-btn').forEach(btn => {
        // Poista vanhat listenerit ensin
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('click', (e) => {
            const channelIndex = parseInt(e.target.dataset.channel);
            changeChannel(channelIndex);
        });
    });
    
    // Lisää event listener Generoi Basso -napille
    const btnGenBass = document.getElementById('btnGenBass');
    if (btnGenBass) {
        btnGenBass.addEventListener('click', generateBassTrack);
    }
}

window.addEventListener('DOMContentLoaded', init);
