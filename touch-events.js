/**
 * touch-events.js
 * Kosketusnäytön tuki sovellukselle
 */

class TouchManager {
    constructor() {
        this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        this.activeTouch = null;
        this.lastTapTime = 0;
        this.doubleTapDelay = 300; // ms
        this.longPressTimer = null;
        this.longPressDelay = 500; // ms
        
        this.initTouchEvents();
    }
    
    initTouchEvents() {
        if (!this.isTouchDevice) return;
        
        const canvas = document.getElementById('pianoRollCanvas');
        const wrapper = document.getElementById('pianoRollWrapper');
        
        if (!canvas) return;
        
        // Estä oletus touch-toiminnot (zoomaus, vieritys canvasilla)
        canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
        canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        canvas.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
        canvas.addEventListener('touchcancel', this.handleTouchCancel.bind(this), { passive: false });
        
        // Lisää touch-tuki pianonäppäimille
        document.querySelectorAll('.key').forEach(key => {
            key.addEventListener('touchstart', (e) => {
                e.preventDefault();
                key.click();
                // Lisää visual feedback
                key.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    key.style.transform = '';
                }, 150);
            }, { passive: false });
        });
        
        // Kosketustuki painikkeille
        document.querySelectorAll('button').forEach(button => {
            button.addEventListener('touchstart', (e) => {
                // Visual feedback
                button.style.opacity = '0.7';
                button.style.transform = 'scale(0.98)';
            }, { passive: false });
            
            button.addEventListener('touchend', (e) => {
                button.style.opacity = '';
                button.style.transform = '';
            }, { passive: false });
            
            button.addEventListener('touchcancel', (e) => {
                button.style.opacity = '';
                button.style.transform = '';
            }, { passive: false });
        });
        
        console.log("Touch events initialized");
    }
    
    handleTouchStart(e) {
        if (!State.isPlaying) {
            e.preventDefault(); // Estä vieritys vain soittamattomassa tilassa
        }
        
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            this.activeTouch = {
                id: touch.identifier,
                startX: touch.clientX,
                startY: touch.clientY,
                startTime: Date.now(),
                target: e.target
            };
            
            // Aloita pitkä painallus -timer
            this.longPressTimer = setTimeout(() => {
                this.handleLongPress(touch);
            }, this.longPressDelay);
            
            // Kaksoistapaus -tarkistus
            const now = Date.now();
            if (now - this.lastTapTime < this.doubleTapDelay) {
                this.handleDoubleTap(touch);
                this.lastTapTime = 0;
            } else {
                this.lastTapTime = now;
            }
            
            // Kutsu olemassa olevaa hiiritapahtumakäsittelijää
            this.simulateMouseEvent('mousedown', touch);
        }
    }
    
    handleTouchMove(e) {
        if (this.activeTouch && e.touches.length === 1) {
            const touch = e.touches[0];
            if (touch.identifier === this.activeTouch.id) {
                // Peruuta pitkä painallus jos liikutaan
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }
                
                // Simuloi hiiren liikettä
                this.simulateMouseEvent('mousemove', touch);
                
                // Estä sivun vieritys canvas-alueella
                if (e.target.id === 'pianoRollCanvas') {
                    e.preventDefault();
                }
            }
        }
    }
    
    handleTouchEnd(e) {
        if (this.activeTouch) {
            // Peruuta pitkä painallus
            if (this.longPressTimer) {
                clearTimeout(this.longPressTimer);
                this.longPressTimer = null;
            }
            
            // Simuloi hiiren nostoa
            this.simulateMouseEvent('mouseup', e.changedTouches[0]);
            
            // Napsautus (jos ei ollut liikettä)
            const touch = e.changedTouches[0];
            if (touch.identifier === this.activeTouch.id) {
                const dx = Math.abs(touch.clientX - this.activeTouch.startX);
                const dy = Math.abs(touch.clientY - this.activeTouch.startY);
                
                if (dx < 10 && dy < 10) {
                    // Pieni liike = napsautus
                    this.simulateMouseEvent('click', touch);
                }
            }
            
            this.activeTouch = null;
        }
    }
    
    handleTouchCancel(e) {
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
        this.activeTouch = null;
        
        // Palauta kaikkien painikkeiden tila
        document.querySelectorAll('button').forEach(button => {
            button.style.opacity = '';
            button.style.transform = '';
        });
    }
    
    handleLongPress(touch) {
        console.log("Long press detected");
        // Voit lisätä pitkän painalluksen toiminnon tähän
        // Esim. soinnun poistaminen, context menu, jne.
        
        // Visual feedback
        const canvas = document.getElementById('pianoRollCanvas');
        if (canvas) {
            canvas.style.boxShadow = '0 0 0 3px #ff4081';
            setTimeout(() => {
                canvas.style.boxShadow = '';
            }, 300);
        }
    }
    
    handleDoubleTap(touch) {
        console.log("Double tap detected");
        // Kaksoistapaus: vaihda kanavaa tai toista sointu
        
        // Visual feedback
        const canvas = document.getElementById('pianoRollCanvas');
        if (canvas) {
            canvas.style.filter = 'brightness(1.3)';
            setTimeout(() => {
                canvas.style.filter = '';
            }, 200);
        }
    }
    
    simulateMouseEvent(type, touch) {
        const canvas = document.getElementById('pianoRollCanvas');
        if (!canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        const mouseEvent = new MouseEvent(type, {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: touch.clientX,
            clientY: touch.clientY,
            screenX: touch.screenX,
            screenY: touch.screenY
        });
        
        canvas.dispatchEvent(mouseEvent);
    }
    
    // Lisää pinch-to-zoom tuki canvasille (valinnainen)
    initPinchZoom() {
        let initialDistance = null;
        
        document.getElementById('pianoRollCanvas').addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                initialDistance = Math.sqrt(dx * dx + dy * dy);
            }
        });
        
        document.getElementById('pianoRollCanvas').addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && initialDistance !== null) {
                e.preventDefault();
                
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const currentDistance = Math.sqrt(dx * dx + dy * dy);
                
                const scale = currentDistance / initialDistance;
                
                // Voit toteuttaa zoomauksen tähän
                // console.log("Pinch zoom scale:", scale);
            }
        });
        
        document.getElementById('pianoRollCanvas').addEventListener('touchend', () => {
            initialDistance = null;
        });
    }
}

// Alusta touch manager kun sivu latautuu
let touchManager = null;
document.addEventListener('DOMContentLoaded', () => {
    touchManager = new TouchManager();
});