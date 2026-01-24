/**
 * project-manager.js
 * Hoitaa projektin tallentamisen JSON-tiedostoon ja lataamisen sieltä.
 * Päivitetty tukemaan moniraitaisuutta (Channels).
 */

const ProjectManager = {

    /**
     * Tallentaa nykyisen tilan JSON-tiedostoksi.
     * @param {Object} state - Sovelluksen globaali State-objekti main.js:stä
     */
    saveProject: function(state) {
        if (!state) {
            console.error("ProjectManager: State puuttuu.");
            return;
        }

        // Muunnetaan State tallennuskelpoiseen muotoon
        const projectData = {
            version: "2.0", // Versio nostettu moniraitaisuuden vuoksi
            timestamp: new Date().toISOString(),
            bpm: state.bpm,
            transpose: state.transpose,
            // Set -> Array
            scale: Array.from(state.scale), 
            
            // TALLENNETAAN KAIKKI KANAVAT
            // Jos state.channels on olemassa, käytetään sitä. 
            // Fallback: tallennetaan vanha sequence arraynä arrayn sisällä.
            channels: state.channels || [state.sequence, [], []],
            
            // Tallennetaan UI-valinnat
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
        const filename = `chord_project_multitrack_${dateStr}.json`;

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
     * @param {Function} onLoadedCallback - Kutsutaan kun data on valmis.
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
                    
                    // Alustava validointi
                    if (typeof data.bpm === 'undefined') {
                        throw new Error("Tiedosto ei vaikuta validilta projektilta.");
                    }

                    // Palautettava tila
                    const restoredState = {
                        bpm: data.bpm,
                        transpose: data.transpose || 0,
                        scale: new Set(data.scale || [0, 2, 4, 5, 7, 9, 11]), 
                        
                        // KANAVIEN KÄSITTELY
                        // 1. Jos uusi format (channels array), käytä sitä
                        // 2. Jos vanha format (sequence array), laita se kanavalle 0
                        channels: data.channels 
                            ? data.channels 
                            : [data.sequence || [], [], []],
                        
                        // UI-arvot
                        ui: {
                            selectedOctave: data.ui?.selectedOctave ?? 3,
                            selectedRoot: data.ui?.selectedRoot ?? null,
                            selectedType: data.ui?.selectedType ?? 'maj',
                            selectedInv: data.ui?.selectedInv ?? 0,
                            selectedDur: data.ui?.selectedDur ?? 4,
                            activeChannel: data.ui?.activeChannel ?? 0
                        }
                    };

                    console.log("Projekti ladattu.");
                    onLoadedCallback(restoredState);

                } catch (err) {
                    console.error("Virhe ladatessa:", err);
                    alert("Virhe ladatessa tiedostoa: " + err.message);
                }
            };

            reader.readAsText(file);
        };

        input.click();
    }
};