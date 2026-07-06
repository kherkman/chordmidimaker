/**
 * midi-export.js
 * Muuntaa moniraitaisen sointudatan MIDI-tiedostoksi (Format 1) ja tuo standardeja MIDI-tiedostoja (Import).
 * Sisältää tempo-infon säädön (vienti & tuonti) sekä tarkan binary-lukijan.
 */

// --- BINAARI-MIDI LUKIJA (TUONTI) ---
class BinaryReader {
    constructor(arrayBuffer) {
        this.bytes = new Uint8Array(arrayBuffer);
        this.pos = 0;
    }
    
    readString(length) {
        let str = "";
        for (let i = 0; i < length; i++) {
            str += String.fromCharCode(this.bytes[this.pos++]);
        }
        return str;
    }
    
    readUInt32() {
        const b = this.bytes;
        const val = (b[this.pos] << 24) | (b[this.pos + 1] << 16) | (b[this.pos + 2] << 8) | b[this.pos + 3];
        this.pos += 4;
        return val >>> 0; 
    }
    
    readUInt16() {
        const b = this.bytes;
        const val = (b[this.pos] << 8) | b[this.pos + 1];
        this.pos += 2;
        return val;
    }
    
    readByte() {
        return this.bytes[this.pos++];
    }
    
    readVarInt() {
        let value = 0;
        let b;
        do {
            b = this.readByte();
            value = (value << 7) | (b & 0x7F);
        } while (b & 0x80);
        return value;
    }
    
    eof() {
        return this.pos >= this.bytes.length;
    }
}

function parseMidiFile(arrayBuffer) {
    const reader = new BinaryReader(arrayBuffer);
    const headerSig = reader.readString(4);
    if (headerSig !== "MThd") {
        throw new Error("Tiedosto ei ole kelvollinen MIDI-tiedosto.");
    }
    
    const headerLength = reader.readUInt32();
    const format = reader.readUInt16();
    const numTracks = reader.readUInt16();
    const ppq = reader.readUInt16(); 
    
    if (headerLength > 6) {
        reader.pos += (headerLength - 6);
    }
    
    const parsedTracks = [];
    
    for (let t = 0; t < numTracks; t++) {
        const trackSig = reader.readString(4);
        if (trackSig !== "MTrk") {
            // Hypätään tuntemattomien lohkojen yli
            const len = reader.readUInt32();
            reader.pos += len;
            continue;
        }
        
        const trackLength = reader.readUInt32();
        const endPos = reader.pos + trackLength;
        
        let absoluteTicks = 0;
        let runningStatus = 0;
        const events = [];
        let trackName = `Track ${t + 1}`;
        
        while (reader.pos < endPos && !reader.eof()) {
            const deltaTime = reader.readVarInt();
            absoluteTicks += deltaTime;
            
            let statusByte = reader.readByte();
            if (statusByte < 0x80) {
                statusByte = runningStatus;
                reader.pos--; 
            } else {
                runningStatus = statusByte;
            }
            
            const eventType = statusByte & 0xF0;
            const channel = statusByte & 0x0F;
            
            if (statusByte === 0xFF) {
                const metaType = reader.readByte();
                const len = reader.readVarInt();
                
                if (metaType === 0x03) {
                    let name = "";
                    for (let i = 0; i < len; i++) {
                        name += String.fromCharCode(reader.readByte());
                    }
                    trackName = name.trim() || trackName;
                } else if (metaType === 0x51 && len === 3) {
                    const mspqn = (reader.readByte() << 16) | (reader.readByte() << 8) | reader.readByte();
                    const bpm = Math.round(60000000 / mspqn);
                    events.push({ type: 'tempo', ticks: absoluteTicks, bpm: bpm });
                } else {
                    reader.pos += len;
                }
            } else if (statusByte === 0xF0 || statusByte === 0xF7) {
                const len = reader.readVarInt();
                reader.pos += len;
            } else {
                if (eventType === 0x90 || eventType === 0x80) {
                    const note = reader.readByte();
                    const velocity = reader.readByte();
                    const isNoteOn = (eventType === 0x90) && (velocity > 0);
                    
                    events.push({
                        type: isNoteOn ? 'note_on' : 'note_off',
                        ticks: absoluteTicks,
                        note: note,
                        velocity: velocity,
                        channel: channel
                    });
                } else if (eventType === 0xA0 || eventType === 0xB0 || eventType === 0xE0) {
                    reader.pos += 2;
                } else if (eventType === 0xC0 || eventType === 0xD0) {
                    reader.pos += 1;
                }
            }
        }
        
        parsedTracks.push({
            index: t,
            name: trackName,
            events: events,
            ppq: ppq
        });
        
        reader.pos = endPos;
    }
    
    return parsedTracks;
}

// --- MIDI EXPORTER & IMPORTER OBJ ---
const MidiExporter = {
    
    /**
     * Lataa nykyiset raidat standardiksi MIDI-tiedostoksi.
     */
    downloadMidi: function(channels, bpm) {
        if (!channels || !Array.isArray(channels)) {
            alert("Virheellinen data MIDI-vientiin.");
            return;
        }
        
        const hasData = channels.some(ch => ch && ch.length > 0);
        if (!hasData) {
            alert("Ei nuotteja vietäväksi.");
            return;
        }
        
        console.log("Viedään MIDI:", { 
            channelCount: channels.length,
            chords: channels[0]?.length || 0,
            lead: channels[1]?.length || 0,
            bass: channels[2]?.length || 0,
            drums: channels[3]?.length || 0,
            bpm: bpm 
        });

        const data = this.buildMidiFile(channels, bpm);
        const blob = new Blob([new Uint8Array(data)], { type: "audio/midi" });
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "multitrack_sequence.mid";
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);
    },

    /**
     * Standardi MIDI-tuontitoiminto tiedostosta.
     */
    importMidi: function(file, callback) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const arrayBuffer = e.target.result;
                const parsedTracks = parseMidiFile(arrayBuffer);
                
                // Suodatetaan vain ne raidat, joissa on todellisia nuottitapahtumia
                const activeTracks = parsedTracks.filter(t => t.events.some(evt => evt.type === 'note_on'));
                
                if (activeTracks.length === 0) {
                    alert("MIDI-tiedostosta ei löytynyt soitettavia nuotteja.");
                    return;
                }
                
                // Etsitään mahdollinen tempo-tieto
                let bpm = null;
                for (let t of parsedTracks) {
                    const tempoEvt = t.events.find(evt => evt.type === 'tempo');
                    if (tempoEvt) {
                        bpm = tempoEvt.bpm;
                        break;
                    }
                }
                
                callback(activeTracks, bpm);
            } catch (err) {
                console.error("MIDI-tuonti epäonnistui:", err);
                alert("MIDI-tuontivirhe: " + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    },

    /**
     * Rakentaa MIDI-tiedoston tavukokonaisuuden (Format 1).
     */
    buildMidiFile: function(channels, bpm) {
        const PPQ = 480; 
        const trackCount = channels.length; 
        
        // HEADER CHUNK
        const header = [
            0x4D, 0x54, 0x68, 0x64, 
            0x00, 0x00, 0x00, 0x06, 
            0x00, 0x01,             // Format 1
            (trackCount >> 8) & 0xFF, trackCount & 0xFF, 
            (PPQ >> 8) & 0xFF, PPQ & 0xFF 
        ];

        let allTracksData = [];
        const trackNames = ["Chords", "Lead", "Bass", "Drums"];

        for (let i = 0; i < trackCount; i++) {
            const isFirstTrack = (i === 0);
            const trackEvents = this.buildTrackEvents(channels[i], i, bpm, PPQ, isFirstTrack, trackNames[i]);
            
            const trackLen = trackEvents.length;
            const trackHeader = [
                0x4D, 0x54, 0x72, 0x6B, 
                (trackLen >> 24) & 0xFF,
                (trackLen >> 16) & 0xFF,
                (trackLen >> 8) & 0xFF,
                trackLen & 0xFF
            ];
            
            allTracksData = allTracksData.concat(trackHeader, trackEvents);
        }

        return header.concat(allTracksData);
    },

    buildTrackEvents: function(sequence, channelIndex, bpm, PPQ, includeTempo, trackName) {
        let events = [];

        // Meta (Track Name)
        if (trackName) {
            events.push(0x00); 
            events.push(0xFF);
            events.push(0x03);
            const nameBytes = this.stringToBytes(trackName);
            events.push(nameBytes.length);
            events.push(...nameBytes);
        }

        // Meta (Tempo) - Sisältää tarkan tempo-tiedon
        if (includeTempo) {
            const microsecondsPerBeat = Math.round(60000000 / bpm);
            events.push(0x00); 
            events.push(0xFF);
            events.push(0x51);
            events.push(0x03);
            events.push((microsecondsPerBeat >> 16) & 0xFF);
            events.push((microsecondsPerBeat >> 8) & 0xFF);
            events.push(microsecondsPerBeat & 0xFF);
        }

        let absEvents = [];
        let currentTick = 0;

        if (sequence && Array.isArray(sequence)) {
            sequence.forEach(step => {
                const stepDurationTicks = Math.round(step.duration * (PPQ / 4)); // 1 unit of duration is 1/16th note
                
                if (step.notes && step.notes.length > 0) {
                    step.notes.forEach(note => {
                        const safeNote = Math.max(0, Math.min(127, note));
                        
                        absEvents.push({
                            tick: currentTick,
                            type: 'on',
                            note: safeNote,
                            velocity: 90
                        });
                        
                        absEvents.push({
                            tick: currentTick + stepDurationTicks,
                            type: 'off',
                            note: safeNote,
                            velocity: 0
                        });
                    });
                }
                currentTick += stepDurationTicks;
            });
        }

        absEvents.sort((a, b) => a.tick - b.tick);

        let previousTick = 0;
        
        absEvents.forEach(evt => {
            const delta = evt.tick - previousTick;
            const vlq = this.toVLQ(delta);
            events.push(...vlq);
            
            const typeNibble = (evt.type === 'on') ? 0x90 : 0x80;
            // Rumpukanava (index 3) ohjataan standardille rumpukanavalle Ch 10 (indeksi 9)
            const midiChannel = (channelIndex === 3) ? 9 : channelIndex;
            const status = typeNibble | (midiChannel & 0x0F);
            
            events.push(status);
            events.push(evt.note);
            events.push(evt.velocity);
            
            previousTick = evt.tick;
        });

        events.push(0x00);
        events.push(0xFF);
        events.push(0x2F);
        events.push(0x00);

        return events;
    },

    toVLQ: function(num) {
        let bytes = [];
        let temp = num;
        do {
            let byte = temp & 0x7F;
            temp = temp >> 7;
            if (bytes.length > 0) byte = byte | 0x80;
            bytes.unshift(byte);
        } while (temp > 0);
        return bytes;
    },

    stringToBytes: function(str) {
        let bytes = [];
        for (let i = 0; i < str.length; i++) {
            bytes.push(str.charCodeAt(i));
        }
        return bytes;
    }
};
