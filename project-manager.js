/**
 * project-manager.js
 * Hoitaa projektin tallentamisen JSON-tiedostoon ja lataamisen sieltä.
 * Päivitetty tukemaan moniraitaisuutta (4 kanavaa: Chords, Lead, Bass, Drums).
 */

const ProjectManager = {

    /**
     * Tallentaa nykyisen tilan JSON-tiedostoksi.
     */
    saveProject: function(state) {
        if (!state) {
            console.error("ProjectManager: State puuttuu.");
            return;
        }

        const projectData = {
            version: "3.0", // Korotettu versio uuden Drums-kanavan vuoksi
            timestamp: new Date().toISOString(),
            bpm: state.bpm,
            transpose: state.transpose,
            scale: Array.from(state.scale), 
            
            // TALLENNETAAN KAIKKI 4 KANAVAA
            channels: state.channels || [state.sequence, [], [], []],
            
            ui: {
                selectedOctave: state.selectedOctave,
                selectedRoot: state.selectedRoot,
                selectedType: state.selectedType,
                selectedInv: state.selectedInv,
                selectedDur: state.selectedDur,
                activeChannel: state.activeChannel || 0
            }
        };

        const jsonString = JSON.stringify(projectData, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `chord_project_4track_${dateStr}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);
    },

    /**
     * Avaa tiedostonvalinnan ja lataa projektin.
     */
    loadProject: function(onLoadedCallback) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    
                    if (typeof data.bpm === 'undefined') {
                        throw new Error("Tiedosto ei ole yhteensopiva sekvensseriprojekti.");
                    }

                    // Palautetaan ja varmistetaan 4-kanavainen asettelu
                    const restoredState = {
                        bpm: data.bpm,
                        transpose: data.transpose || 0,
                        scale: new Set(data.scale || [0, 2, 4, 5, 7, 9, 11]), 
                        
                        channels: data.channels 
                            ? data.channels 
                            : [data.sequence || [], [], [], []],
                        
                        ui: {
                            selectedOctave: data.ui?.selectedOctave ?? 3,
                            selectedRoot: data.ui?.selectedRoot ?? null,
                            selectedType: data.ui?.selectedType ?? 'maj',
                            selectedInv: data.ui?.selectedInv ?? 0,
                            selectedDur: data.ui?.selectedDur ?? 4,
                            activeChannel: data.ui?.activeChannel ?? 0
                        }
                    };

                    // Jos ladatussa projektissa oli vain 3 kanavaa, täydennetään neljänneksi tyhjä kanava rummulle
                    while (restoredState.channels.length < 4) {
                        restoredState.channels.push([]);
                    }

                    console.log("Projekti ladattu onnistuneesti (4 kanavaa).");
                    onLoadedCallback(restoredState);

                } catch (err) {
                    console.error("Virhe ladatessa projektia:", err);
                    alert("Virhe projektin lataamisessa: " + err.message);
                }
            };

            reader.readAsText(file);
        };

        input.click();
    }
};
