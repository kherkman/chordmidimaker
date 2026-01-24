/**
 * midi-export.js
 * Muuntaa moniraitaisen sointudatan MIDI-tiedostoksi (Format 1).
 * Luo erilliset raidat Chords, Bass ja Lead -kanaville.
 */

const MidiExporter = {
    
    /**
     * Pääfunktio: Lataa MIDI-tiedoston.
     * @param {Array<Array>} channels - Array, joka sisältää raita-arrayt [ [chords], [bass], [lead] ]
     * @param {Number} bpm - Tempo
     */
    downloadMidi: function(channels, bpm) {
        // Varmista että channels on oikeanlainen taulukko
        if (!channels || !Array.isArray(channels)) {
            alert("Virheellinen data MIDI-vientiin.");
            return;
        }
        
        // Jos channels on yksi sekvenssi (vanha tapa), muuta se moniraita-formaattiin
        if (channels.length && channels[0].notes !== undefined) {
            // Tämä on yhden kanavan sekvenssi, luo moniraita-array
            console.warn("Yhden kanavan data havaittu, muunnetaan moniraita-formaattiin");
            channels = [channels, [], []]; // Chords, tyhjä Bass, tyhjä Lead
        }
        
        // Varmistetaan että meillä on dataa edes yhdessä kanavassa
        const hasData = channels.some(ch => ch && ch.length > 0);
        if (!hasData) {
            alert("Ei nuotteja vietäväksi.");
            return;
        }
        
        console.log("Viedään MIDI:", { 
            channelCount: channels.length,
            chords: channels[0]?.length || 0,
            bass: channels[1]?.length || 0,
            lead: channels[2]?.length || 0,
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
     * Rakentaa koko MIDI-tiedoston (Format 1).
     */
    buildMidiFile: function(channels, bpm) {
        const PPQ = 480; 
        const trackCount = channels.length; // Yleensä 3
        
        // 1. HEADER CHUNK
        // "MThd", Length(6), Format(1=MultiTrack), Tracks(N), PPQ
        const header = [
            0x4D, 0x54, 0x68, 0x64, 
            0x00, 0x00, 0x00, 0x06, 
            0x00, 0x01,             // Format 1
            (trackCount >> 8) & 0xFF, trackCount & 0xFF, 
            (PPQ >> 8) & 0xFF, PPQ & 0xFF 
        ];

        // 2. TRACK CHUNKS
        let allTracksData = [];

        // Määritellään raitojen nimet
        const trackNames = ["Chords", "Bass", "Lead"];

        for (let i = 0; i < trackCount; i++) {
            // Ensimmäiseen raitaan lisätään Tempo-tieto
            const isFirstTrack = (i === 0);
            const trackEvents = this.buildTrackEvents(channels[i], i, bpm, PPQ, isFirstTrack, trackNames[i]);
            
            // Rakenna MTrk Header
            const trackLen = trackEvents.length;
            const trackHeader = [
                0x4D, 0x54, 0x72, 0x6B, // "MTrk"
                (trackLen >> 24) & 0xFF,
                (trackLen >> 16) & 0xFF,
                (trackLen >> 8) & 0xFF,
                trackLen & 0xFF
            ];
            
            allTracksData = allTracksData.concat(trackHeader, trackEvents);
        }

        return header.concat(allTracksData);
    },

    /**
     * Rakentaa yksittäisen raidan tapahtumat (MTrk body).
     */
    buildTrackEvents: function(sequence, channelIndex, bpm, PPQ, includeTempo, trackName) {
        let events = [];

        // 1. Meta Events (Track Name)
        // Delta 0, FF 03, len, text bytes
        if (trackName) {
            events.push(0x00); // Delta
            events.push(0xFF);
            events.push(0x03);
            const nameBytes = this.stringToBytes(trackName);
            events.push(nameBytes.length);
            events.push(...nameBytes);
        }

        // 2. Meta Events (Tempo) - Vain 1. raidalle
        if (includeTempo) {
            const microsecondsPerBeat = Math.round(60000000 / bpm);
            events.push(0x00); // Delta
            events.push(0xFF);
            events.push(0x51);
            events.push(0x03);
            events.push((microsecondsPerBeat >> 16) & 0xFF);
            events.push((microsecondsPerBeat >> 8) & 0xFF);
            events.push(microsecondsPerBeat & 0xFF);
        }

        // 3. Nuottitapahtumat (Note On / Note Off)
        // Luodaan ensin lista absoluuttisen ajan tapahtumista
        let absEvents = [];
        let currentTick = 0;

        if (sequence && Array.isArray(sequence)) {
            sequence.forEach(step => {
                const stepDurationTicks = Math.round(step.duration * PPQ);
                
                if (step.notes && step.notes.length > 0) {
                    step.notes.forEach(note => {
                        // Varmistetaan että nuotti on välillä 0-127
                        const safeNote = Math.max(0, Math.min(127, note));
                        
                        // Note On
                        absEvents.push({
                            tick: currentTick,
                            type: 'on',
                            note: safeNote,
                            velocity: 90
                        });
                        
                        // Note Off
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

        // Järjestä tapahtumat ajan mukaan
        absEvents.sort((a, b) => a.tick - b.tick);

        // Muunna Delta-ajaksi ja tavuiksi
        let previousTick = 0;
        
        absEvents.forEach(evt => {
            const delta = evt.tick - previousTick;
            const vlq = this.toVLQ(delta);
            events.push(...vlq);
            
            // Status byte: 0x9n (Note On) tai 0x8n (Note Off)
            // n = MIDI kanava (0-15). Käytetään channelIndexiä.
            // Chords=0 (Ch1), Bass=1 (Ch2), Lead=2 (Ch3)
            const typeNibble = (evt.type === 'on') ? 0x90 : 0x80;
            const status = typeNibble | (channelIndex & 0x0F);
            
            events.push(status);
            events.push(evt.note);
            events.push(evt.velocity);
            
            previousTick = evt.tick;
        });

        // End of Track (Delta 0, FF 2F 00)
        events.push(0x00);
        events.push(0xFF);
        events.push(0x2F);
        events.push(0x00);

        return events;
    },

    /** Apu: VLQ Muunnos */
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

    /** Apu: Merkkijono tavuiksi */
    stringToBytes: function(str) {
        let bytes = [];
        for (let i = 0; i < str.length; i++) {
            bytes.push(str.charCodeAt(i));
        }
        return bytes;
    }
};